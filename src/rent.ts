import { prisma } from "./db.js";
import { datePartsInTimeZone, dueDateFor } from "./utils.js";

export async function ensureInvoices(propertyId: string, year?: number, month?: number) {
  const property = await prisma.property.findUnique({ where: { id: propertyId }, select: { timezone: true } });
  if (!property) return;
  const current = datePartsInTimeZone(property.timezone);
  const invoiceYear = year ?? current.year;
  const invoiceMonth = month ?? current.month;
  const students = await prisma.student.findMany({
    where: { propertyId, status: "ACTIVE" },
    select: { id: true, joiningDate: true, monthlyRentPaise: true, rentDueDay: true }
  });

  for (const student of students) {
    const joined = datePartsInTimeZone(property.timezone, student.joiningDate);
    if (joined.year > invoiceYear || (joined.year === invoiceYear && joined.month > invoiceMonth)) continue;
    await prisma.rentInvoice.upsert({
      where: { studentId_year_month: { studentId: student.id, year: invoiceYear, month: invoiceMonth } },
      update: {},
      create: {
        propertyId,
        studentId: student.id,
        year: invoiceYear,
        month: invoiceMonth,
        dueDate: dueDateFor(invoiceYear, invoiceMonth, student.rentDueDay),
        rentPaise: student.monthlyRentPaise,
        totalPaise: student.monthlyRentPaise
      }
    });
  }
}

export async function getOwnerProperty(ownerId: string) {
  return prisma.property.findFirst({ where: { ownerId } });
}

export async function getStudentProfile(userId: string) {
  return prisma.student.findUnique({
    where: { userId },
    include: { property: true, room: true, user: { select: { email: true, fullName: true, mustChangePassword: true } } }
  });
}
