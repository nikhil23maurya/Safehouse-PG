export type FinancialPeriod = { year: number; month: number };

export function periodCompare(a: FinancialPeriod, b: FinancialPeriod) {
  if (a.year !== b.year) return a.year - b.year;
  return a.month - b.month;
}

export function periodKey(period: FinancialPeriod) {
  return `${period.year}-${String(period.month).padStart(2, "0")}`;
}

export function nextPeriod(period: FinancialPeriod): FinancialPeriod {
  if (period.month === 12) return { year: period.year + 1, month: 1 };
  return { year: period.year, month: period.month + 1 };
}

export function periodOnOrAfter(candidate: FinancialPeriod, threshold: FinancialPeriod) {
  return periodCompare(candidate, threshold) >= 0;
}
