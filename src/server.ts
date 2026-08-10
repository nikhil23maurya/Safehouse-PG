import "dotenv/config";
import express, { type NextFunction, type Request, type Response } from "express";
import cors from "cors";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import { config } from "./config.js";
import { prisma } from "./db.js";
import { AppError, assert } from "./errors.js";
import { requireAuth, requireRole } from "./middleware.js";
import { createTokenPair, hashPassword, verifyPassword, verifyRazorpayCheckoutSignature, verifyRazorpayWebhookSignature, verifyToken } from "./security.js";
import { ensureInvoices, getOwnerProperty, getStudentProfile } from "./rent.js";
import { createRazorpayOrder } from "./razorpay.js";
import { streamReceiptPdf } from "./receipts.js";
import {
  datePartsInTimeZone,
  invoiceTotal,
  money,
  normalizeEmail,
  normalizeIndianMobile,
  paiseToRupees,
  parseDateOnly,
  receiptNumber,
  rupeesToPaise,
  whatsappReminderUrl
} from "./utils.js";

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use(helmet());
app.use(cors({
  origin(origin, callback) {
    if (!origin || config.corsOrigins.includes("*") || config.corsOrigins.includes(origin)) return callback(null, true);
    callback(new AppError(403, "CORS_BLOCKED", "Origin not allowed"));
  }
}));
app.use(rateLimit({ windowMs: 60_000, limit: 180, standardHeaders: "draft-8", legacyHeaders: false }));

app.get("/health", (_req, res) => res.json({ ok: true, service: "safehouse-api", time: new Date().toISOString() }));
app.get("/ready", async (_req, res) => {
  await prisma.$queryRaw`SELECT 1`;
  res.json({ ok: true, database: "ready" });
});

// IMPORTANT: Razorpay webhook MUST receive the unparsed raw body.
app.post("/api/webhooks/razorpay", express.raw({ type: "application/json", limit: "1mb" }), async (req, res) => {
  const signature = req.header("x-razorpay-signature");
  assert(signature, 400, "MISSING_WEBHOOK_SIGNATURE", "Missing Razorpay webhook signature");
  const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body || "");
  assert(verifyRazorpayWebhookSignature(rawBody, signature), 400, "INVALID_WEBHOOK_SIGNATURE", "Invalid Razorpay webhook signature");

  const event = JSON.parse(rawBody.toString("utf8"));
  if (event.event === "payment.captured") {
    const payment = event?.payload?.payment?.entity;
    if (payment?.id && payment?.order_id) {
      const attempt = await prisma.paymentAttempt.findUnique({
        where: { providerOrderId: payment.order_id },
        include: { invoice: true, student: true }
      });
      if (attempt) {
        assert(Number(payment.amount) === attempt.amountPaise, 400, "PAYMENT_AMOUNT_MISMATCH", "Captured amount does not match the order");
        const existing = await prisma.payment.findUnique({ where: { providerPaymentId: payment.id } });
        if (!existing) {
          const paidAt = new Date(Number(payment.created_at || Math.floor(Date.now() / 1000)) * 1000);
          await prisma.$transaction(async (tx) => {
            const freshInvoice = await tx.rentInvoice.findUnique({ where: { id: attempt.invoiceId } });
            if (!freshInvoice) throw new AppError(404, "INVOICE_NOT_FOUND", "Invoice no longer exists");
            const newPaid = freshInvoice.paidPaise + Number(payment.amount);
            await tx.payment.create({
              data: {
                propertyId: freshInvoice.propertyId,
                studentId: attempt.studentId,
                invoiceId: attempt.invoiceId,
                amountPaise: Number(payment.amount),
                source: "RAZORPAY",
                method: mapPaymentMethod(payment.method),
                providerOrderId: payment.order_id,
                providerPaymentId: payment.id,
                receiptNumber: receiptNumber(paidAt),
                paidAt,
                metadata: { email: payment.email ?? null, contact: payment.contact ?? null }
              }
            });
            await tx.paymentAttempt.update({
              where: { id: attempt.id },
              data: { status: "CAPTURED", providerPaymentId: payment.id }
            });
            await tx.rentInvoice.update({
              where: { id: attempt.invoiceId },
              data: {
                paidPaise: newPaid,
                status: newPaid >= freshInvoice.totalPaise ? "PAID" : "DUE"
              }
            });
          });
        }
      }
    }
  } else if (event.event === "payment.failed") {
    const payment = event?.payload?.payment?.entity;
    if (payment?.order_id) {
      const failedAttempt = await prisma.paymentAttempt.findUnique({ where: { providerOrderId: payment.order_id } });
      if (failedAttempt && failedAttempt.status !== "CAPTURED") {
        await prisma.$transaction([
          prisma.paymentAttempt.update({
            where: { id: failedAttempt.id },
            data: {
              status: "FAILED",
              providerPaymentId: payment.id || undefined,
              failureCode: payment.error_code || null,
              failureDescription: payment.error_description || null
            }
          }),
          prisma.rentInvoice.updateMany({
            where: { id: failedAttempt.invoiceId, status: "PROCESSING" },
            data: { status: "DUE" }
          })
        ]);
      }
    }
  }
  res.json({ ok: true });
});

app.use(express.json({ limit: "1mb" }));

const loginLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 20, standardHeaders: "draft-8", legacyHeaders: false });

const loginSchema = z.object({ email: z.string().email(), password: z.string().min(1) });
app.post("/api/auth/login", loginLimiter, async (req, res) => {
  const input = loginSchema.parse(req.body);
  const user = await prisma.user.findUnique({ where: { email: normalizeEmail(input.email) } });
  if (!user || user.status !== "ACTIVE" || !(await verifyPassword(input.password, user.passwordHash))) {
    throw new AppError(401, "INVALID_CREDENTIALS", "Invalid email or password");
  }
  const context = await getUserContext(user.id, user.role);
  res.json({ user: publicUser(user), ...context, tokens: createTokenPair(user as any) });
});

app.post("/api/auth/refresh", async (req, res) => {
  const { refreshToken } = z.object({ refreshToken: z.string().min(20) }).parse(req.body);
  const payload = verifyToken(refreshToken, "refresh");
  const user = await prisma.user.findUnique({ where: { id: payload.sub } });
  if (!user || user.status !== "ACTIVE" || user.tokenVersion !== payload.ver || user.role !== payload.role) {
    throw new AppError(401, "SESSION_INVALID", "Session is no longer valid");
  }
  res.json({ tokens: createTokenPair(user as any) });
});

app.get("/api/auth/me", requireAuth, async (req, res) => {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: req.authUser!.id } });
  res.json({ user: publicUser(user), ...(await getUserContext(user.id, user.role)) });
});

app.post("/api/auth/change-password", requireAuth, async (req, res) => {
  const input = z.object({ currentPassword: z.string().min(1), newPassword: z.string().min(8).max(128) }).parse(req.body);
  const user = await prisma.user.findUniqueOrThrow({ where: { id: req.authUser!.id } });
  assert(await verifyPassword(input.currentPassword, user.passwordHash), 400, "CURRENT_PASSWORD_WRONG", "Current password is incorrect");
  const updated = await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash: await hashPassword(input.newPassword), mustChangePassword: false, tokenVersion: { increment: 1 } }
  });
  res.json({ ok: true, tokens: createTokenPair(updated as any) });
});

app.post("/api/auth/logout", requireAuth, async (req, res) => {
  await prisma.user.update({ where: { id: req.authUser!.id }, data: { tokenVersion: { increment: 1 } } });
  res.json({ ok: true });
});

// OWNER
const owner = express.Router();
owner.use(requireAuth, requireRole("OWNER" as any));

owner.get("/dashboard", async (req, res) => {
  const property = await ownerPropertyOrThrow(req.authUser!.id);
  const { year, month } = requestedPeriod(req, property.timezone);
  await ensureInvoices(property.id, year, month);
  const [students, rooms, invoices, recentPayments] = await Promise.all([
    prisma.student.findMany({ where: { propertyId: property.id, status: "ACTIVE" }, select: { id: true, roomId: true } }),
    prisma.room.findMany({ where: { propertyId: property.id, active: true }, select: { capacity: true } }),
    prisma.rentInvoice.findMany({ where: { propertyId: property.id, year, month } }),
    prisma.payment.findMany({
      where: { propertyId: property.id }, orderBy: { paidAt: "desc" }, take: 5,
      include: { student: { include: { user: { select: { fullName: true } }, room: { select: { number: true } } } } }
    })
  ]);
  const paidStudents = invoices.filter((i) => i.status === "PAID").length;
  const pending = invoices.filter((i) => i.status !== "PAID" && i.status !== "WAIVED");
  const expectedPaise = invoices.reduce((s, i) => s + i.totalPaise, 0);
  const collectedPaise = invoices.reduce((s, i) => s + i.paidPaise, 0);
  const totalBeds = rooms.reduce((s, r) => s + r.capacity, 0);
  const occupiedBeds = students.filter((s) => s.roomId).length;
  const pendingDues = await duesForProperty(property.id, year, month, 5);
  res.json({
    property: { id: property.id, name: property.name, currency: property.currency, timezone: property.timezone },
    period: { year, month },
    metrics: {
      totalStudents: students.length,
      paidStudents,
      pendingStudents: pending.length,
      overdueStudents: pending.filter((i) => i.dueDate.getTime() < Date.now()).length,
      totalExpectedPaise: expectedPaise,
      totalCollectedPaise: collectedPaise,
      pendingTotalPaise: pending.reduce((s, i) => s + Math.max(0, i.totalPaise - i.paidPaise), 0),
      collectionRate: expectedPaise > 0 ? Number(((collectedPaise / expectedPaise) * 100).toFixed(1)) : 0,
      totalBeds,
      occupiedBeds,
      vacantBeds: Math.max(0, totalBeds - occupiedBeds)
    },
    pendingDues,
    recentPayments: recentPayments.map(paymentDto)
  });
});

owner.get("/property", async (req, res) => {
  const property = await ownerPropertyOrThrow(req.authUser!.id);
  res.json({ property: { id: property.id, name: property.name, currency: property.currency, timezone: property.timezone } });
});

owner.patch("/property", async (req, res) => {
  const property = await ownerPropertyOrThrow(req.authUser!.id);
  const input = z.object({ name: z.string().trim().min(2).max(120).optional(), timezone: z.string().trim().min(3).max(80).optional() }).parse(req.body);
  if (input.timezone) {
    try { new Intl.DateTimeFormat("en-US", { timeZone: input.timezone }).format(new Date()); }
    catch { throw new AppError(400, "INVALID_TIMEZONE", "Invalid IANA timezone"); }
  }
  const updated = await prisma.property.update({ where: { id: property.id }, data: input });
  res.json({ property: { id: updated.id, name: updated.name, currency: updated.currency, timezone: updated.timezone } });
});

owner.get("/students", async (req, res) => {
  const property = await ownerPropertyOrThrow(req.authUser!.id);
  const q = String(req.query.q || "").trim();
  const status = String(req.query.status || "ALL").toUpperCase();
  await ensureInvoices(property.id);
  const current = datePartsInTimeZone(property.timezone);
  const students = await prisma.student.findMany({
    where: {
      propertyId: property.id,
      ...(status === "ACTIVE" ? { status: "ACTIVE" } : {}),
      ...(q ? { OR: [
        { user: { fullName: { contains: q, mode: "insensitive" } } },
        { user: { email: { contains: q, mode: "insensitive" } } },
        { mobile: { contains: q } },
        { room: { number: { contains: q, mode: "insensitive" } } }
      ] } : {})
    },
    include: {
      user: { select: { fullName: true, email: true, status: true, mustChangePassword: true } },
      room: { select: { id: true, number: true } },
      invoices: { where: { year: current.year, month: current.month }, take: 1 }
    },
    orderBy: { user: { fullName: "asc" } }
  });
  let result = students.map(studentDto);
  if (["PAID", "PENDING", "OVERDUE"].includes(status)) {
    result = result.filter((s: any) => {
      if (status === "PAID") return s.currentInvoice?.status === "PAID";
      if (status === "OVERDUE") return s.currentInvoice && s.currentInvoice.status !== "PAID" && new Date(s.currentInvoice.dueDate).getTime() < Date.now();
      return s.currentInvoice && s.currentInvoice.status !== "PAID";
    });
  }
  res.json({ students: result });
});

owner.get("/students/:id", async (req, res) => {
  const property = await ownerPropertyOrThrow(req.authUser!.id);
  const student = await prisma.student.findFirst({
    where: { id: req.params.id, propertyId: property.id },
    include: {
      user: { select: { fullName: true, email: true, status: true, mustChangePassword: true } },
      room: true,
      invoices: { orderBy: [{ year: "desc" }, { month: "desc" }], take: 12, include: { payments: { orderBy: { paidAt: "desc" } } } }
    }
  });
  assert(student, 404, "STUDENT_NOT_FOUND", "Student not found");
  res.json({ student: studentDetailDto(student) });
});

const studentCreateSchema = z.object({
  fullName: z.string().trim().min(2).max(100),
  email: z.string().email(),
  mobile: z.string().min(10),
  roomId: z.string().min(1).nullable().optional(),
  bedLabel: z.string().trim().max(30).nullable().optional(),
  joiningDate: z.string(),
  monthlyRent: z.number().positive().max(1_000_000),
  securityDeposit: z.number().min(0).max(10_000_000).default(0),
  rentDueDay: z.number().int().min(1).max(28).default(5),
  tempPassword: z.string().min(8).max(128),
  notes: z.string().trim().max(1000).nullable().optional()
});

owner.post("/students", async (req, res) => {
  const property = await ownerPropertyOrThrow(req.authUser!.id);
  const input = studentCreateSchema.parse(req.body);
  const email = normalizeEmail(input.email);
  const mobile = normalizeIndianMobile(input.mobile);
  if (input.roomId) await assertRoomHasCapacity(property.id, input.roomId);
  const passwordHash = await hashPassword(input.tempPassword);
  let created;
  try {
    created = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: { email, passwordHash, fullName: input.fullName, role: "STUDENT", mustChangePassword: true }
      });
      const student = await tx.student.create({
        data: {
          propertyId: property.id,
          userId: user.id,
          roomId: input.roomId || null,
          mobile,
          bedLabel: input.bedLabel || null,
          joiningDate: parseDateOnly(input.joiningDate),
          monthlyRentPaise: rupeesToPaise(input.monthlyRent),
          securityDepositPaise: rupeesToPaise(input.securityDeposit),
          rentDueDay: input.rentDueDay,
          notes: input.notes || null
        },
        include: { user: true, room: true }
      });
      await tx.auditLog.create({ data: { propertyId: property.id, actorUserId: req.authUser!.id, action: "STUDENT_CREATED", entityType: "Student", entityId: student.id } });
      return student;
    });
  } catch (error: any) {
    if (error?.code === "P2002") throw new AppError(409, "STUDENT_ALREADY_EXISTS", "A student with this email or mobile number already exists");
    throw error;
  }
  await ensureInvoices(property.id);
  res.status(201).json({ student: studentDto({ ...created, invoices: [] }) });
});

const studentUpdateSchema = z.object({
  fullName: z.string().trim().min(2).max(100).optional(),
  email: z.string().email().optional(),
  mobile: z.string().min(10).optional(),
  roomId: z.string().min(1).nullable().optional(),
  bedLabel: z.string().trim().max(30).nullable().optional(),
  monthlyRent: z.number().positive().max(1_000_000).optional(),
  securityDeposit: z.number().min(0).max(10_000_000).optional(),
  rentDueDay: z.number().int().min(1).max(28).optional(),
  status: z.enum(["ACTIVE", "INACTIVE", "MOVED_OUT"]).optional(),
  notes: z.string().trim().max(1000).nullable().optional()
});

owner.patch("/students/:id", async (req, res) => {
  const property = await ownerPropertyOrThrow(req.authUser!.id);
  const input = studentUpdateSchema.parse(req.body);
  const current = await prisma.student.findFirst({ where: { id: req.params.id, propertyId: property.id }, include: { user: true } });
  assert(current, 404, "STUDENT_NOT_FOUND", "Student not found");
  if (input.roomId && input.roomId !== current.roomId) await assertRoomHasCapacity(property.id, input.roomId);
  const student = await prisma.$transaction(async (tx) => {
    if (input.fullName || input.email || input.status) {
      await tx.user.update({
        where: { id: current.userId },
        data: {
          ...(input.fullName ? { fullName: input.fullName } : {}),
          ...(input.email ? { email: normalizeEmail(input.email) } : {}),
          ...(input.status ? { status: input.status === "ACTIVE" ? "ACTIVE" : "INACTIVE", tokenVersion: input.status === "ACTIVE" ? undefined : { increment: 1 } } : {})
        }
      });
    }
    const updated = await tx.student.update({
      where: { id: current.id },
      data: {
        ...(input.mobile ? { mobile: normalizeIndianMobile(input.mobile) } : {}),
        ...(input.roomId !== undefined ? { roomId: input.roomId } : {}),
        ...(input.bedLabel !== undefined ? { bedLabel: input.bedLabel } : {}),
        ...(input.monthlyRent !== undefined ? { monthlyRentPaise: rupeesToPaise(input.monthlyRent) } : {}),
        ...(input.securityDeposit !== undefined ? { securityDepositPaise: rupeesToPaise(input.securityDeposit) } : {}),
        ...(input.rentDueDay !== undefined ? { rentDueDay: input.rentDueDay } : {}),
        ...(input.status ? { status: input.status, leftAt: input.status === "MOVED_OUT" ? new Date() : null } : {}),
        ...(input.notes !== undefined ? { notes: input.notes } : {})
      },
      include: { user: true, room: true, invoices: { take: 1, orderBy: [{ year: "desc" }, { month: "desc" }] } }
    });
    await tx.auditLog.create({ data: { propertyId: property.id, actorUserId: req.authUser!.id, action: "STUDENT_UPDATED", entityType: "Student", entityId: current.id, metadata: input as any } });
    return updated;
  });
  res.json({ student: studentDto(student) });
});

owner.post("/students/:id/reset-password", async (req, res) => {
  const property = await ownerPropertyOrThrow(req.authUser!.id);
  const { tempPassword } = z.object({ tempPassword: z.string().min(8).max(128) }).parse(req.body);
  const student = await prisma.student.findFirst({ where: { id: req.params.id, propertyId: property.id } });
  assert(student, 404, "STUDENT_NOT_FOUND", "Student not found");
  await prisma.user.update({ where: { id: student.userId }, data: { passwordHash: await hashPassword(tempPassword), mustChangePassword: true, tokenVersion: { increment: 1 } } });
  res.json({ ok: true });
});

owner.get("/rooms", async (req, res) => {
  const property = await ownerPropertyOrThrow(req.authUser!.id);
  const rooms = await prisma.room.findMany({
    where: { propertyId: property.id, active: true },
    include: { students: { where: { status: "ACTIVE" }, select: { id: true } } },
    orderBy: { number: "asc" }
  });
  res.json({ rooms: rooms.map((r) => ({ id: r.id, number: r.number, capacity: r.capacity, occupied: r.students.length, vacant: Math.max(0, r.capacity - r.students.length), full: r.students.length >= r.capacity })) });
});

owner.post("/rooms", async (req, res) => {
  const property = await ownerPropertyOrThrow(req.authUser!.id);
  const input = z.object({ number: z.string().trim().min(1).max(30), capacity: z.number().int().min(1).max(50) }).parse(req.body);
  try {
    const room = await prisma.room.create({ data: { propertyId: property.id, number: input.number, capacity: input.capacity } });
    res.status(201).json({ room });
  } catch (error: any) {
    if (error?.code === "P2002") throw new AppError(409, "ROOM_EXISTS", "This room already exists");
    throw error;
  }
});

owner.patch("/rooms/:id", async (req, res) => {
  const property = await ownerPropertyOrThrow(req.authUser!.id);
  const input = z.object({ number: z.string().trim().min(1).max(30).optional(), capacity: z.number().int().min(1).max(50).optional(), active: z.boolean().optional() }).parse(req.body);
  const room = await prisma.room.findFirst({ where: { id: req.params.id, propertyId: property.id }, include: { students: { where: { status: "ACTIVE" } } } });
  assert(room, 404, "ROOM_NOT_FOUND", "Room not found");
  if (input.capacity !== undefined) assert(input.capacity >= room.students.length, 400, "CAPACITY_TOO_SMALL", "Capacity cannot be less than current occupancy");
  const updated = await prisma.room.update({ where: { id: room.id }, data: input });
  res.json({ room: updated });
});

owner.get("/dues", async (req, res) => {
  const property = await ownerPropertyOrThrow(req.authUser!.id);
  const { year, month } = requestedPeriod(req, property.timezone);
  await ensureInvoices(property.id, year, month);
  const dues = await duesForProperty(property.id, year, month, 1000);
  res.json({ period: { year, month }, dues, totalDuePaise: dues.reduce((s: number, d: any) => s + d.remainingPaise, 0), overdueCount: dues.filter((d: any) => d.overdue).length });
});

owner.post("/rents/generate", async (req, res) => {
  const property = await ownerPropertyOrThrow(req.authUser!.id);
  const input = z.object({ year: z.number().int().min(2020).max(2100).optional(), month: z.number().int().min(1).max(12).optional() }).parse(req.body || {});
  await ensureInvoices(property.id, input.year, input.month);
  res.json({ ok: true });
});

owner.patch("/invoices/:id", async (req, res) => {
  const property = await ownerPropertyOrThrow(req.authUser!.id);
  const input = z.object({ electricity: z.number().min(0).optional(), lateFee: z.number().min(0).optional(), otherCharges: z.number().min(0).optional(), discount: z.number().min(0).optional(), notes: z.string().max(1000).nullable().optional() }).parse(req.body);
  const invoice = await prisma.rentInvoice.findFirst({ where: { id: req.params.id, propertyId: property.id } });
  assert(invoice, 404, "INVOICE_NOT_FOUND", "Invoice not found");
  assert(invoice.status === "DUE", 409, "INVOICE_LOCKED", "Only due invoices can be edited. Finish or fail any payment attempt first.");
  const openAttempt = await prisma.paymentAttempt.findFirst({ where: { invoiceId: invoice.id, status: { in: ["CREATED", "VERIFIED"] } } });
  assert(!openAttempt, 409, "PAYMENT_ATTEMPT_OPEN", "This invoice has an open online payment attempt");
  const values = {
    rentPaise: invoice.rentPaise,
    electricityPaise: input.electricity !== undefined ? rupeesToPaise(input.electricity) : invoice.electricityPaise,
    lateFeePaise: input.lateFee !== undefined ? rupeesToPaise(input.lateFee) : invoice.lateFeePaise,
    otherChargesPaise: input.otherCharges !== undefined ? rupeesToPaise(input.otherCharges) : invoice.otherChargesPaise,
    discountPaise: input.discount !== undefined ? rupeesToPaise(input.discount) : invoice.discountPaise
  };
  const totalPaise = invoiceTotal(values);
  assert(totalPaise >= invoice.paidPaise, 400, "TOTAL_BELOW_PAID", "Invoice total cannot be lower than amount already paid");
  const updated = await prisma.rentInvoice.update({ where: { id: invoice.id }, data: { ...values, totalPaise, ...(input.notes !== undefined ? { notes: input.notes } : {}) } });
  res.json({ invoice: invoiceDto(updated) });
});

owner.post("/invoices/:id/manual-payment", async (req, res) => {
  const property = await ownerPropertyOrThrow(req.authUser!.id);
  const input = z.object({ amount: z.number().positive().optional(), method: z.enum(["CASH", "BANK_TRANSFER", "OTHER"]).default("CASH") }).parse(req.body || {});
  const invoice = await prisma.rentInvoice.findFirst({ where: { id: req.params.id, propertyId: property.id } });
  assert(invoice, 404, "INVOICE_NOT_FOUND", "Invoice not found");
  const remaining = Math.max(0, invoice.totalPaise - invoice.paidPaise);
  assert(remaining > 0, 409, "INVOICE_ALREADY_PAID", "Invoice is already fully paid");
  assert(invoice.status === "DUE", 409, "INVOICE_LOCKED", "Invoice currently has a payment in progress");
  const openAttempt = await prisma.paymentAttempt.findFirst({ where: { invoiceId: invoice.id, status: { in: ["CREATED", "VERIFIED"] } } });
  assert(!openAttempt, 409, "PAYMENT_ATTEMPT_OPEN", "This invoice has an open online payment attempt");
  const amountPaise = input.amount !== undefined ? rupeesToPaise(input.amount) : remaining;
  assert(amountPaise <= remaining, 400, "PAYMENT_TOO_LARGE", "Manual payment cannot exceed remaining due");
  const now = new Date();
  const payment = await prisma.$transaction(async (tx) => {
    const p = await tx.payment.create({ data: { propertyId: property.id, studentId: invoice.studentId, invoiceId: invoice.id, amountPaise, source: "MANUAL", method: input.method, receiptNumber: receiptNumber(now), paidAt: now } });
    const newPaid = invoice.paidPaise + amountPaise;
    await tx.rentInvoice.update({ where: { id: invoice.id }, data: { paidPaise: newPaid, status: newPaid >= invoice.totalPaise ? "PAID" : "DUE" } });
    await tx.auditLog.create({ data: { propertyId: property.id, actorUserId: req.authUser!.id, action: "MANUAL_PAYMENT", entityType: "RentInvoice", entityId: invoice.id, metadata: { amountPaise, method: input.method } } });
    return p;
  });
  res.status(201).json({ payment: paymentDto(payment) });
});

owner.get("/payments", async (req, res) => {
  const property = await ownerPropertyOrThrow(req.authUser!.id);
  const payments = await prisma.payment.findMany({ where: { propertyId: property.id }, orderBy: { paidAt: "desc" }, take: 200, include: { student: { include: { user: true, room: true } }, invoice: true } });
  res.json({ payments: payments.map(paymentDto) });
});

owner.get("/payments/:id/receipt.pdf", async (req, res) => {
  const property = await ownerPropertyOrThrow(req.authUser!.id);
  const payment = await prisma.payment.findFirst({
    where: { id: req.params.id, propertyId: property.id },
    include: { property: true, invoice: true, student: { include: { user: true, room: true } } }
  });
  assert(payment, 404, "PAYMENT_NOT_FOUND", "Payment not found");
  streamReceiptPdf(res, payment);
});

app.use("/api/owner", owner);

// STUDENT
const student = express.Router();
student.use(requireAuth, requireRole("STUDENT" as any));

student.get("/dashboard", async (req, res) => {
  const profile = await studentProfileOrThrow(req.authUser!.id);
  const current = datePartsInTimeZone(profile.property.timezone);
  await ensureInvoices(profile.propertyId, current.year, current.month);
  const invoice = await prisma.rentInvoice.findUnique({ where: { studentId_year_month: { studentId: profile.id, year: current.year, month: current.month } } });
  const recentPayments = await prisma.payment.findMany({ where: { studentId: profile.id }, orderBy: { paidAt: "desc" }, take: 5, include: { invoice: true } });
  res.json({
    student: studentProfileDto(profile),
    currentInvoice: invoice ? invoiceDto(invoice) : null,
    recentPayments: recentPayments.map(paymentDto)
  });
});

student.get("/invoices", async (req, res) => {
  const profile = await studentProfileOrThrow(req.authUser!.id);
  const invoices = await prisma.rentInvoice.findMany({ where: { studentId: profile.id }, orderBy: [{ year: "desc" }, { month: "desc" }], include: { payments: { orderBy: { paidAt: "desc" } } } });
  res.json({ invoices: invoices.map((i) => ({ ...invoiceDto(i), payments: i.payments.map(paymentDto) })) });
});

student.post("/payments/order", async (req, res) => {
  const profile = await studentProfileOrThrow(req.authUser!.id);
  const { invoiceId } = z.object({ invoiceId: z.string().min(1) }).parse(req.body);
  const invoice = await prisma.rentInvoice.findFirst({ where: { id: invoiceId, studentId: profile.id } });
  assert(invoice, 404, "INVOICE_NOT_FOUND", "Invoice not found");
  const remaining = Math.max(0, invoice.totalPaise - invoice.paidPaise);
  assert(remaining > 0 && invoice.status !== "PAID", 409, "INVOICE_ALREADY_PAID", "Invoice is already paid");

  const openAttempt = await prisma.paymentAttempt.findFirst({
    where: { invoiceId: invoice.id, studentId: profile.id, status: { in: ["CREATED", "VERIFIED"] } },
    orderBy: { createdAt: "desc" }
  });

  if (openAttempt?.status === "VERIFIED") {
    throw new AppError(409, "PAYMENT_PROCESSING", "A verified payment is waiting for Razorpay confirmation", { orderId: openAttempt.providerOrderId });
  }

  let orderId: string;
  let statusCode = 201;
  if (openAttempt && openAttempt.amountPaise === remaining) {
    orderId = openAttempt.providerOrderId;
    statusCode = 200;
  } else {
    const order = await createRazorpayOrder({
      amountPaise: remaining,
      receipt: `SH-${invoice.year}${String(invoice.month).padStart(2, "0")}-${invoice.id.slice(-12)}-${Date.now().toString().slice(-5)}`,
      notes: { invoiceId: invoice.id, studentId: profile.id, propertyId: profile.propertyId }
    });
    orderId = order.id;
    await prisma.paymentAttempt.create({ data: { invoiceId: invoice.id, studentId: profile.id, providerOrderId: order.id, amountPaise: remaining } });
  }

  res.status(statusCode).json({
    order: { id: orderId, amountPaise: remaining, currency: "INR" },
    checkout: {
      keyId: config.RAZORPAY_KEY_ID,
      name: profile.property.name,
      description: `${invoice.month}/${invoice.year} PG Rent`,
      prefill: { name: profile.user.fullName, email: profile.user.email, contact: profile.mobile }
    }
  });
});

student.post("/payments/verify", async (req, res) => {
  const profile = await studentProfileOrThrow(req.authUser!.id);
  const input = z.object({ razorpayOrderId: z.string().min(1), razorpayPaymentId: z.string().min(1), razorpaySignature: z.string().min(1) }).parse(req.body);
  const attempt = await prisma.paymentAttempt.findFirst({ where: { providerOrderId: input.razorpayOrderId, studentId: profile.id } });
  assert(attempt, 404, "PAYMENT_ATTEMPT_NOT_FOUND", "Payment attempt not found");
  assert(verifyRazorpayCheckoutSignature(input.razorpayOrderId, input.razorpayPaymentId, input.razorpaySignature), 400, "INVALID_PAYMENT_SIGNATURE", "Payment signature verification failed");
  await prisma.paymentAttempt.update({ where: { id: attempt.id }, data: { status: attempt.status === "CAPTURED" ? "CAPTURED" : "VERIFIED", providerPaymentId: input.razorpayPaymentId, signatureVerifiedAt: new Date() } });
  await prisma.rentInvoice.updateMany({ where: { id: attempt.invoiceId, status: "DUE" }, data: { status: "PROCESSING" } });
  // The invoice is intentionally NOT marked PAID here. payment.captured webhook is the source of truth.
  res.json({ ok: true, status: attempt.status === "CAPTURED" ? "PAID" : "PROCESSING", message: "Signature verified. Waiting for Razorpay capture webhook." });
});

student.get("/payments/orders/:orderId/status", async (req, res) => {
  const profile = await studentProfileOrThrow(req.authUser!.id);
  const attempt = await prisma.paymentAttempt.findFirst({ where: { providerOrderId: req.params.orderId, studentId: profile.id }, include: { invoice: true } });
  assert(attempt, 404, "PAYMENT_ATTEMPT_NOT_FOUND", "Payment attempt not found");
  res.json({ attemptStatus: attempt.status, invoiceStatus: attempt.invoice.status, paid: attempt.invoice.status === "PAID", invoice: invoiceDto(attempt.invoice) });
});

student.get("/payments/:id/receipt.pdf", async (req, res) => {
  const profile = await studentProfileOrThrow(req.authUser!.id);
  const payment = await prisma.payment.findFirst({ where: { id: req.params.id, studentId: profile.id }, include: { property: true, invoice: true, student: { include: { user: true, room: true } } } });
  assert(payment, 404, "PAYMENT_NOT_FOUND", "Payment not found");
  streamReceiptPdf(res, payment);
});

app.use("/api/student", student);

app.use((_req, _res, next) => next(new AppError(404, "NOT_FOUND", "Route not found")));
app.use((error: any, _req: Request, res: Response, _next: NextFunction) => {
  if (error instanceof z.ZodError) return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Invalid request", details: error.flatten() } });
  if (error instanceof AppError) return res.status(error.statusCode).json({ error: { code: error.code, message: error.message, details: error.details } });
  if (error?.code === "P2002") return res.status(409).json({ error: { code: "DUPLICATE", message: "A record with this value already exists" } });
  console.error(error);
  res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Something went wrong" } });
});

await bootstrapOwner();
const server = app.listen(config.PORT, "0.0.0.0", () => console.log(`SafeHouse API listening on :${config.PORT}`));

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, async () => {
    server.close(async () => {
      await prisma.$disconnect();
      process.exit(0);
    });
  });
}

function publicUser(user: any) {
  return { id: user.id, email: user.email, fullName: user.fullName, role: user.role, mustChangePassword: user.mustChangePassword };
}

async function getUserContext(userId: string, role: string) {
  if (role === "OWNER") {
    const property = await getOwnerProperty(userId);
    return { property: property ? { id: property.id, name: property.name, currency: property.currency, timezone: property.timezone } : null };
  }
  const profile = await getStudentProfile(userId);
  return { student: profile ? studentProfileDto(profile) : null, property: profile ? { id: profile.property.id, name: profile.property.name, currency: profile.property.currency, timezone: profile.property.timezone } : null };
}

async function ownerPropertyOrThrow(ownerId: string) {
  const property = await getOwnerProperty(ownerId);
  assert(property, 404, "PROPERTY_NOT_FOUND", "Owner property is not configured");
  return property;
}

async function studentProfileOrThrow(userId: string) {
  const profile = await getStudentProfile(userId);
  assert(profile && profile.status === "ACTIVE", 403, "STUDENT_INACTIVE", "Student account is inactive");
  return profile;
}

function requestedPeriod(req: Request, timeZone: string) {
  const current = datePartsInTimeZone(timeZone);
  const year = req.query.year ? Number(req.query.year) : current.year;
  const month = req.query.month ? Number(req.query.month) : current.month;
  assert(Number.isInteger(year) && year >= 2020 && year <= 2100, 400, "INVALID_YEAR", "Invalid year");
  assert(Number.isInteger(month) && month >= 1 && month <= 12, 400, "INVALID_MONTH", "Invalid month");
  return { year, month };
}

async function assertRoomHasCapacity(propertyId: string, roomId: string) {
  const room = await prisma.room.findFirst({ where: { id: roomId, propertyId, active: true }, include: { students: { where: { status: "ACTIVE" }, select: { id: true } } } });
  assert(room, 404, "ROOM_NOT_FOUND", "Room not found");
  assert(room.students.length < room.capacity, 409, "ROOM_FULL", "This room has no vacant beds");
}

async function duesForProperty(propertyId: string, year: number, month: number, take: number) {
  const invoices = await prisma.rentInvoice.findMany({
    where: { propertyId, year, month, status: { in: ["DUE", "PROCESSING"] } },
    include: { student: { include: { user: { select: { fullName: true, email: true } }, room: { select: { number: true } } } } },
    orderBy: { dueDate: "asc" }, take
  });
  return invoices.map((i) => {
    const remainingPaise = Math.max(0, i.totalPaise - i.paidPaise);
    return {
      ...invoiceDto(i),
      remainingPaise,
      student: { id: i.student.id, name: i.student.user.fullName, mobile: i.student.mobile, room: i.student.room?.number || null },
      overdue: i.dueDate.getTime() < Date.now(),
      whatsappUrl: whatsappReminderUrl({ mobile: i.student.mobile, name: i.student.user.fullName, remainingPaise, year: i.year, month: i.month, dueDate: i.dueDate })
    };
  });
}

function invoiceDto(i: any) {
  return {
    id: i.id, year: i.year, month: i.month, dueDate: i.dueDate, status: i.status,
    rentPaise: i.rentPaise, electricityPaise: i.electricityPaise, lateFeePaise: i.lateFeePaise,
    otherChargesPaise: i.otherChargesPaise, discountPaise: i.discountPaise,
    totalPaise: i.totalPaise, paidPaise: i.paidPaise, remainingPaise: Math.max(0, i.totalPaise - i.paidPaise),
    total: paiseToRupees(i.totalPaise), paid: paiseToRupees(i.paidPaise), remaining: paiseToRupees(Math.max(0, i.totalPaise - i.paidPaise))
  };
}

function studentDto(s: any) {
  const inv = s.invoices?.[0];
  return {
    id: s.id,
    name: s.user.fullName,
    email: s.user.email,
    mobile: s.mobile,
    room: s.room ? { id: s.room.id, number: s.room.number } : null,
    bedLabel: s.bedLabel,
    joiningDate: s.joiningDate,
    monthlyRentPaise: s.monthlyRentPaise,
    monthlyRent: paiseToRupees(s.monthlyRentPaise),
    securityDepositPaise: s.securityDepositPaise,
    securityDeposit: paiseToRupees(s.securityDepositPaise),
    rentDueDay: s.rentDueDay,
    status: s.status,
    mustChangePassword: s.user.mustChangePassword,
    currentInvoice: inv ? invoiceDto(inv) : null
  };
}

function studentDetailDto(s: any) {
  return { ...studentDto({ ...s, invoices: [] }), notes: s.notes, invoices: s.invoices.map((i: any) => ({ ...invoiceDto(i), payments: i.payments.map(paymentDto) })) };
}

function studentProfileDto(p: any) {
  return {
    id: p.id,
    name: p.user.fullName,
    email: p.user.email,
    mobile: p.mobile,
    room: p.room ? { id: p.room.id, number: p.room.number } : null,
    bedLabel: p.bedLabel,
    joiningDate: p.joiningDate,
    monthlyRentPaise: p.monthlyRentPaise,
    monthlyRent: paiseToRupees(p.monthlyRentPaise),
    securityDepositPaise: p.securityDepositPaise,
    securityDeposit: paiseToRupees(p.securityDepositPaise),
    rentDueDay: p.rentDueDay,
    mustChangePassword: p.user.mustChangePassword
  };
}

function paymentDto(p: any) {
  return {
    id: p.id,
    amountPaise: p.amountPaise,
    amount: paiseToRupees(p.amountPaise),
    source: p.source,
    method: p.method,
    receiptNumber: p.receiptNumber,
    paidAt: p.paidAt,
    providerOrderId: p.providerOrderId || null,
    providerPaymentId: p.providerPaymentId || null,
    student: p.student ? { id: p.student.id, name: p.student.user?.fullName, room: p.student.room?.number || null } : undefined,
    invoice: p.invoice ? { id: p.invoice.id, year: p.invoice.year, month: p.invoice.month } : undefined
  };
}

function mapPaymentMethod(method: string | undefined): "UPI" | "CARD" | "NETBANKING" | "WALLET" | "OTHER" {
  if (method === "upi") return "UPI";
  if (method === "card") return "CARD";
  if (method === "netbanking") return "NETBANKING";
  if (method === "wallet") return "WALLET";
  return "OTHER";
}

async function bootstrapOwner() {
  const email = config.BOOTSTRAP_OWNER_EMAIL;
  const password = config.BOOTSTRAP_OWNER_PASSWORD;
  const fullName = config.BOOTSTRAP_OWNER_NAME;
  const propertyName = config.BOOTSTRAP_PROPERTY_NAME;
  if (!email && !password && !fullName && !propertyName) return;
  if (!email || !password || !fullName || !propertyName) {
    throw new Error("All BOOTSTRAP_OWNER_* environment variables must be set together");
  }
  const normalized = normalizeEmail(email);
  let user = await prisma.user.findUnique({ where: { email: normalized } });
  if (!user) {
    user = await prisma.user.create({ data: { email: normalized, passwordHash: await hashPassword(password), fullName, role: "OWNER" } });
    console.log(`Bootstrap owner created: ${normalized}`);
  }
  if (user.role !== "OWNER") throw new Error("BOOTSTRAP_OWNER_EMAIL already belongs to a non-owner account");
  const property = await prisma.property.findFirst({ where: { ownerId: user.id } });
  if (!property) {
    await prisma.property.create({ data: { name: propertyName, ownerId: user.id } });
    console.log(`Bootstrap property created: ${propertyName}`);
  }
}
