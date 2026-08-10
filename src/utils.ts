import crypto from "node:crypto";
import { AppError } from "./errors.js";

export function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

export function normalizeIndianMobile(input: string) {
  const digits = input.replace(/\D/g, "");
  if (digits.length === 10) return `+91${digits}`;
  if (digits.length >= 11 && digits.length <= 15) return `+${digits}`;
  throw new AppError(400, "INVALID_MOBILE", "Enter a valid mobile number");
}

export function rupeesToPaise(value: number) {
  return Math.round(value * 100);
}

export function paiseToRupees(value: number) {
  return Number((value / 100).toFixed(2));
}

export function money(valuePaise: number) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(valuePaise / 100);
}

export function parseDateOnly(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new AppError(400, "INVALID_DATE", "Date must be YYYY-MM-DD");
  const [, y, m, d] = match;
  return new Date(Date.UTC(Number(y), Number(m) - 1, Number(d), 12, 0, 0));
}

export function datePartsInTimeZone(timeZone: string, date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return { year: get("year"), month: get("month"), day: get("day") };
}

export function dueDateFor(year: number, month: number, dueDay: number) {
  const safeDay = Math.min(Math.max(dueDay, 1), 28);
  return new Date(Date.UTC(year, month - 1, safeDay, 12));
}

export function invoiceTotal(input: {
  rentPaise: number;
  electricityPaise: number;
  lateFeePaise: number;
  otherChargesPaise: number;
  discountPaise: number;
}) {
  return Math.max(0, input.rentPaise + input.electricityPaise + input.lateFeePaise + input.otherChargesPaise - input.discountPaise);
}

export function monthName(month: number) {
  return new Intl.DateTimeFormat("en-IN", { month: "long", timeZone: "UTC" }).format(new Date(Date.UTC(2020, month - 1, 1)));
}

export function receiptNumber(date = new Date()) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `SH-${y}${m}-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
}

export function whatsappReminderUrl(input: { mobile: string; name: string; remainingPaise: number; year: number; month: number; dueDate: Date }) {
  const digits = input.mobile.replace(/\D/g, "");
  const due = new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Kolkata" }).format(input.dueDate);
  const text = `Hi ${input.name}, your SafeHouse rent of ${money(input.remainingPaise)} for ${monthName(input.month)} ${input.year} is pending. Due date: ${due}. Please open the SafeHouse app and complete the payment. Thank you.`;
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}
