import { prisma } from "./db.js";
import { datePartsInTimeZone, dueDateFor, invoiceTotal } from "./utils.js";

export async function ensureInvoices(propertyId: string, year?: number, month?: number) {
  const property = await prisma.property.findUnique({ where: { id: propertyId }, select: { timezone: true } });
  if (!property) return;

  const current = datePartsInTimeZone(property.timezone);
  const invoiceYear = year ?? current.year;
  const invoiceMonth = month ?? current.month;

  const students = await prisma.student.findMany({
    where: { propertyId, status: "ACTIVE" },
    select: {
      id: true,
      joiningDate: true,
      monthlyRentPaise: true,
      rentDueDay: true,
      rentRevisions: {
        where: {
          OR: [
            { effectiveYear: { lt: invoiceYear } },
            { effectiveYear: invoiceYear, effectiveMonth: { lte: invoiceMonth } }
          ]
        },
        orderBy: [{ effectiveYear: "desc" }, { effectiveMonth: "desc" }],
        take: 1,
        select: { amountPaise: true }
      }
    }
  });

  for (const student of students) {
    const joined = datePartsInTimeZone(property.timezone, student.joiningDate);
    if (joined.year > invoiceYear || (joined.year === invoiceYear && joined.month > invoiceMonth)) continue;

    const resolvedRentPaise = student.rentRevisions[0]?.amountPaise ?? student.monthlyRentPaise;
    const existing = await prisma.rentInvoice.findUnique({
      where: { studentId_year_month: { studentId: student.id, year: invoiceYear, month: invoiceMonth } },
      include: {
        paymentAttempts: {
          where: { status: { in: ["CREATED", "VERIFIED"] } },
          select: { id: true },
          take: 1
        }
      }
    });

    if (!existing) {
      await prisma.rentInvoice.create({
        data: {
          propertyId,
          studentId: student.id,
          year: invoiceYear,
          month: invoiceMonth,
          dueDate: dueDateFor(invoiceYear, invoiceMonth, student.rentDueDay),
          rentPaise: resolvedRentPaise,
          totalPaise: resolvedRentPaise
        }
      });
      continue;
    }

    // Reconcile only untouched invoices. Once money or a live checkout touches an invoice,
    // that invoice becomes an immutable financial snapshot for its month.
    const canReconcile = existing.status === "DUE" && existing.paidPaise === 0 && existing.paymentAttempts.length === 0;
    if (canReconcile && existing.rentPaise !== resolvedRentPaise) {
      await prisma.rentInvoice.update({
        where: { id: existing.id },
        data: {
          rentPaise: resolvedRentPaise,
          totalPaise: invoiceTotal({
            rentPaise: resolvedRentPaise,
            electricityPaise: existing.electricityPaise,
            lateFeePaise: existing.lateFeePaise,
            otherChargesPaise: existing.otherChargesPaise,
            discountPaise: existing.discountPaise
          })
        }
      });
    }
  }
}

export async function getOwnerProperty(ownerId: string) {
  return prisma.property.findFirst({ where: { ownerId }, orderBy: { createdAt: "asc" } });
}

export async function getStudentProfile(userId: string) {
  return prisma.student.findUnique({
    where: { userId },
    include: { property: true, room: true, user: { select: { email: true, fullName: true, mustChangePassword: true } } }
  });
}
