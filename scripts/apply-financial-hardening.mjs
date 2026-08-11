import fs from 'node:fs';

const file = 'src/server.ts';
let s = fs.readFileSync(file, 'utf8');

if (s.includes('SAFEHOUSE_FINANCIAL_CONTEXT_V1')) {
  console.log('SafeHouse financial hardening already applied.');
  process.exit(0);
}

function mustReplace(oldText, newText, label) {
  if (!s.includes(oldText)) throw new Error(`Financial hardening failed: ${label}`);
  s = s.replace(oldText, newText);
}

function replaceBetween(start, end, replacement, label) {
  const a = s.indexOf(start);
  const b = s.indexOf(end, a + start.length);
  if (a < 0 || b < 0) throw new Error(`Financial hardening failed: ${label}`);
  s = s.slice(0, a) + replacement + s.slice(b);
}

mustReplace(
  'import { ensureInvoices, getOwnerProperty, getStudentProfile } from "./rent.js";',
  'import { ensureInvoices, getOwnerProperty, getStudentProfile } from "./rent.js";\nimport { nextPeriod, periodCompare, type FinancialPeriod } from "./financial.js";',
  'financial imports'
);

mustReplace(
  'owner.use(requireAuth, requireRole("OWNER" as any));',
  'owner.use(requireAuth, requireRole("OWNER" as any));\n// SAFEHOUSE_FINANCIAL_CONTEXT_V1 — every financial read/write is scoped by owner + property + period.',
  'financial marker'
);

replaceBetween(
  'owner.post("/properties",',
  'owner.get("/portfolio",',
`owner.post("/properties", async (req, res) => {
  const input = z.object({
    name: z.string().trim().min(2).max(120),
    timezone: z.string().trim().min(3).max(80).default("Asia/Kolkata")
  }).parse(req.body);
  try { new Intl.DateTimeFormat("en-US", { timeZone: input.timezone }).format(new Date()); }
  catch { throw new AppError(400, "INVALID_TIMEZONE", "Invalid IANA timezone"); }

  const property = await prisma.$transaction(async (tx) => {
    const created = await tx.property.create({ data: { ownerId: req.authUser!.id, name: input.name, timezone: input.timezone } });
    await tx.auditLog.create({
      data: {
        propertyId: created.id,
        actorUserId: req.authUser!.id,
        action: "PROPERTY_CREATED",
        entityType: "Property",
        entityId: created.id
      }
    });
    return created;
  });

  res.status(201).json({ property: { id: property.id, name: property.name, currency: property.currency, timezone: property.timezone } });
});

`,
  'transactional property create'
);

mustReplace(
`    prisma.payment.findMany({
      where: { propertyId: property.id }, orderBy: { paidAt: "desc" }, take: 5,
      include: { student: { include: { user: { select: { fullName: true } }, room: { select: { number: true } } } } }
    })`,
`    prisma.payment.findMany({
      where: { propertyId: property.id, invoice: { is: { year, month } } },
      orderBy: { paidAt: "desc" },
      take: 5,
      include: { student: { include: { user: { select: { fullName: true } }, room: { select: { number: true } } } }, invoice: true }
    })`,
  'dashboard period payments'
);

replaceBetween(
  'owner.get("/students",',
  'owner.get("/students/:id",',
`owner.get("/students", async (req, res) => {
  const property = await ownerPropertyOrThrow(req.authUser!.id, req);
  const { year, month } = requestedPeriod(req, property.timezone);
  const q = String(req.query.q || "").trim();
  const status = String(req.query.status || "ALL").toUpperCase();

  await ensureInvoices(property.id, year, month);

  const students = await prisma.student.findMany({
    where: {
      propertyId: property.id,
      ...(status === "ACTIVE" ? { status: "ACTIVE" as const } : {}),
      ...(q ? { OR: [
        { user: { fullName: { contains: q, mode: "insensitive" as const } } },
        { user: { email: { contains: q, mode: "insensitive" as const } } },
        { mobile: { contains: q } },
        { room: { number: { contains: q, mode: "insensitive" as const } } }
      ] } : {})
    },
    include: {
      user: { select: { fullName: true, email: true, status: true, mustChangePassword: true } },
      room: { select: { id: true, number: true } },
      invoices: { where: { year, month }, take: 1 }
    },
    orderBy: { user: { fullName: "asc" } }
  });

  let result = students.map(studentDto);
  if (["PAID", "PENDING", "OVERDUE"].includes(status)) {
    result = result.filter((row: any) => {
      const inv = row.periodInvoice;
      if (status === "PAID") return inv?.status === "PAID";
      if (status === "OVERDUE") return !!inv && inv.status !== "PAID" && inv.status !== "WAIVED" && new Date(inv.dueDate).getTime() < Date.now();
      return !!inv && inv.status !== "PAID" && inv.status !== "WAIVED";
    });
  }

  res.json({
    property: propertyDto(property),
    period: { year, month },
    students: result
  });
});

`,
  'period-scoped students'
);

replaceBetween(
  'owner.get("/students/:id",',
  'const studentCreateSchema',
`owner.get("/students/:id", async (req, res) => {
  const property = await ownerPropertyOrThrow(req.authUser!.id, req);
  const { year, month } = requestedPeriod(req, property.timezone);
  await ensureInvoices(property.id, year, month);

  const student = await prisma.student.findFirst({
    where: { id: req.params.id, propertyId: property.id },
    include: {
      user: { select: { fullName: true, email: true, status: true, mustChangePassword: true } },
      room: true,
      invoices: { orderBy: [{ year: "desc" }, { month: "desc" }], take: 12, include: { payments: { orderBy: { paidAt: "desc" } } } },
      rentRevisions: { orderBy: [{ effectiveYear: "desc" }, { effectiveMonth: "desc" }], take: 24 }
    }
  });
  assert(student, 404, "STUDENT_NOT_FOUND", "Student not found");

  const periodInvoice = student.invoices.find((invoice) => invoice.year === year && invoice.month === month) || null;
  res.json({
    property: propertyDto(property),
    period: { year, month },
    periodInvoice: periodInvoice ? invoiceDto(periodInvoice) : null,
    student: {
      ...studentDetailDto(student),
      rentRevisions: student.rentRevisions.map((revision) => ({
        id: revision.id,
        amountPaise: revision.amountPaise,
        amount: paiseToRupees(revision.amountPaise),
        effectiveYear: revision.effectiveYear,
        effectiveMonth: revision.effectiveMonth,
        reason: revision.reason
      }))
    }
  });
});

const studentCreateSchema`,
  'period-scoped student detail'
);

replaceBetween(
  'owner.post("/students",',
  'const studentUpdateSchema',
`owner.post("/students", async (req, res) => {
  const property = await ownerPropertyOrThrow(req.authUser!.id, req);
  const input = studentCreateSchema.parse(req.body);
  const email = normalizeEmail(input.email);
  const mobile = normalizeIndianMobile(input.mobile);
  const joiningDate = parseDateOnly(input.joiningDate);
  const joinedPeriod = datePartsInTimeZone(property.timezone, joiningDate);
  const initialRentPaise = rupeesToPaise(input.monthlyRent);

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
          joiningDate,
          monthlyRentPaise: initialRentPaise,
          securityDepositPaise: rupeesToPaise(input.securityDeposit),
          rentDueDay: input.rentDueDay,
          notes: input.notes || null
        },
        include: { user: true, room: true }
      });
      await tx.rentRevision.create({
        data: {
          propertyId: property.id,
          studentId: student.id,
          amountPaise: initialRentPaise,
          effectiveYear: joinedPeriod.year,
          effectiveMonth: joinedPeriod.month,
          reason: "INITIAL_RENT",
          createdByUserId: req.authUser!.id
        }
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

const studentUpdateSchema`,
  'student creation baseline rent revision'
);

replaceBetween(
  'owner.patch("/students/:id",',
  'owner.post("/students/:id/reset-password",',
`owner.patch("/students/:id", async (req, res) => {
  const property = await ownerPropertyOrThrow(req.authUser!.id, req);
  const requestedPeriodValue = requestedPeriod(req, property.timezone);
  const input = studentUpdateSchema.parse(req.body);
  const current = await prisma.student.findFirst({ where: { id: req.params.id, propertyId: property.id }, include: { user: true } });
  assert(current, 404, "STUDENT_NOT_FOUND", "Student not found");
  if (input.roomId && input.roomId !== current.roomId) await assertRoomHasCapacity(property.id, input.roomId);

  const requestedRentPaise = input.monthlyRent !== undefined ? rupeesToPaise(input.monthlyRent) : undefined;
  let rentChange: {
    appliedToSelectedInvoice: boolean;
    effectiveYear: number;
    effectiveMonth: number;
    reason: string;
  } | null = null;

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

    if (requestedRentPaise !== undefined && requestedRentPaise !== current.monthlyRentPaise) {
      const targetInvoice = await tx.rentInvoice.findUnique({
        where: { studentId_year_month: { studentId: current.id, year: requestedPeriodValue.year, month: requestedPeriodValue.month } }
      });
      const openAttempt = targetInvoice ? await tx.paymentAttempt.findFirst({
        where: { invoiceId: targetInvoice.id, status: { in: ["CREATED", "VERIFIED"] } }, select: { id: true }
      }) : null;

      const selectedInvoiceMutable = !targetInvoice || (targetInvoice.status === "DUE" && targetInvoice.paidPaise === 0 && !openAttempt);
      const effective = selectedInvoiceMutable ? requestedPeriodValue : nextPeriod(requestedPeriodValue);
      const reason = !targetInvoice
        ? "SELECTED_INVOICE_NOT_CREATED"
        : targetInvoice.status === "PAID"
          ? "SELECTED_INVOICE_PAID"
          : targetInvoice.paidPaise > 0
            ? "SELECTED_INVOICE_PARTIALLY_PAID"
            : openAttempt
              ? "PAYMENT_IN_PROGRESS"
              : targetInvoice.status === "PROCESSING"
                ? "SELECTED_INVOICE_PROCESSING"
                : "SELECTED_INVOICE_LOCKED";

      await tx.rentRevision.upsert({
        where: { studentId_effectiveYear_effectiveMonth: { studentId: current.id, effectiveYear: effective.year, effectiveMonth: effective.month } },
        update: { amountPaise: requestedRentPaise, reason, createdByUserId: req.authUser!.id },
        create: {
          propertyId: property.id,
          studentId: current.id,
          amountPaise: requestedRentPaise,
          effectiveYear: effective.year,
          effectiveMonth: effective.month,
          reason,
          createdByUserId: req.authUser!.id
        }
      });

      const nextRevision = await tx.rentRevision.findFirst({
        where: {
          studentId: current.id,
          OR: [
            { effectiveYear: { gt: effective.year } },
            { effectiveYear: effective.year, effectiveMonth: { gt: effective.month } }
          ]
        },
        orderBy: [{ effectiveYear: "asc" }, { effectiveMonth: "asc" }]
      });

      const candidateInvoices = await tx.rentInvoice.findMany({
        where: {
          propertyId: property.id,
          studentId: current.id,
          status: "DUE",
          paidPaise: 0,
          OR: [
            { year: { gt: effective.year } },
            { year: effective.year, month: { gte: effective.month } }
          ]
        },
        include: { paymentAttempts: { where: { status: { in: ["CREATED", "VERIFIED"] } }, select: { id: true }, take: 1 } }
      });

      for (const invoice of candidateInvoices) {
        const invoicePeriod: FinancialPeriod = { year: invoice.year, month: invoice.month };
        if (nextRevision && periodCompare(invoicePeriod, { year: nextRevision.effectiveYear, month: nextRevision.effectiveMonth }) >= 0) continue;
        if (invoice.paymentAttempts.length) continue;
        await tx.rentInvoice.update({
          where: { id: invoice.id },
          data: {
            rentPaise: requestedRentPaise,
            totalPaise: invoiceTotal({
              rentPaise: requestedRentPaise,
              electricityPaise: invoice.electricityPaise,
              lateFeePaise: invoice.lateFeePaise,
              otherChargesPaise: invoice.otherChargesPaise,
              discountPaise: invoice.discountPaise
            })
          }
        });
      }

      rentChange = {
        appliedToSelectedInvoice: selectedInvoiceMutable,
        effectiveYear: effective.year,
        effectiveMonth: effective.month,
        reason
      };
    }

    const updated = await tx.student.update({
      where: { id: current.id },
      data: {
        ...(input.mobile ? { mobile: normalizeIndianMobile(input.mobile) } : {}),
        ...(input.roomId !== undefined ? { roomId: input.roomId } : {}),
        ...(input.bedLabel !== undefined ? { bedLabel: input.bedLabel } : {}),
        ...(requestedRentPaise !== undefined ? { monthlyRentPaise: requestedRentPaise } : {}),
        ...(input.securityDeposit !== undefined ? { securityDepositPaise: rupeesToPaise(input.securityDeposit) } : {}),
        ...(input.rentDueDay !== undefined ? { rentDueDay: input.rentDueDay } : {}),
        ...(input.status ? { status: input.status, leftAt: input.status === "MOVED_OUT" ? new Date() : null } : {}),
        ...(input.notes !== undefined ? { notes: input.notes } : {})
      },
      include: { user: true, room: true, invoices: { where: { year: requestedPeriodValue.year, month: requestedPeriodValue.month }, take: 1 } }
    });

    await tx.auditLog.create({
      data: {
        propertyId: property.id,
        actorUserId: req.authUser!.id,
        action: "STUDENT_UPDATED",
        entityType: "Student",
        entityId: current.id,
        metadata: { ...input, selectedPeriod: requestedPeriodValue, ...(rentChange ? { rentChange } : {}) } as any
      }
    });
    return updated;
  });

  await ensureInvoices(property.id, requestedPeriodValue.year, requestedPeriodValue.month);
  res.json({
    property: propertyDto(property),
    period: requestedPeriodValue,
    student: studentDto(student),
    rentChange
  });
});

`,
  'effective-period rent revision'
);

mustReplace(
`  res.json({ period: { year, month }, dues, totalDuePaise: dues.reduce((s: number, d: any) => s + d.remainingPaise, 0), overdueCount: dues.filter((d: any) => d.overdue).length });`,
`  res.json({ property: propertyDto(property), period: { year, month }, dues, totalDuePaise: dues.reduce((s: number, d: any) => s + d.remainingPaise, 0), overdueCount: dues.filter((d: any) => d.overdue).length });`,
  'dues context response'
);

replaceBetween(
  'owner.get("/payments",',
  'owner.get("/payments/:id/receipt.pdf",',
`owner.get("/payments", async (req, res) => {
  const property = await ownerPropertyOrThrow(req.authUser!.id, req);
  const { year, month } = requestedPeriod(req, property.timezone);
  const payments = await prisma.payment.findMany({
    where: { propertyId: property.id, invoice: { is: { year, month } } },
    orderBy: { paidAt: "desc" },
    take: 200,
    include: { student: { include: { user: true, room: true } }, invoice: true }
  });
  res.json({ property: propertyDto(property), period: { year, month }, payments: payments.map(paymentDto) });
});

`,
  'period-scoped owner payments'
);

mustReplace(
`    currentInvoice: inv ? invoiceDto(inv) : null`,
`    periodInvoice: inv ? invoiceDto(inv) : null,\n    currentInvoice: inv ? invoiceDto(inv) : null`,
  'period invoice dto'
);

mustReplace(
`async function ownerPropertyOrThrow(ownerId: string, req?: Request) {`,
`function propertyDto(property: { id: string; name: string; currency: string; timezone: string }) {\n  return { id: property.id, name: property.name, currency: property.currency, timezone: property.timezone };\n}\n\nasync function ownerPropertyOrThrow(ownerId: string, req?: Request) {`,
  'property dto helper'
);

fs.writeFileSync(file, s);
console.log('SafeHouse strict property/month financial hardening applied.');
