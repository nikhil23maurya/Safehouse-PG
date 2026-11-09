const INDIA_OFFSET = 330 * 60 * 1000;

export function indiaDay(date: Date) {
  return new Date(date.getTime() + INDIA_OFFSET).getUTCDate();
}

/** Preserve the original renewal day across February and short months. */
export function nextCalendarMonth(start: Date, anchorDay = indiaDay(start)) {
  if (!Number.isFinite(start.getTime()) || !Number.isInteger(anchorDay) || anchorDay < 1 || anchorDay > 31)
    throw new Error("Invalid calendar period");
  const local = new Date(start.getTime() + INDIA_OFFSET);
  const year = local.getUTCFullYear(), month = local.getUTCMonth() + 1;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, month, Math.min(anchorDay, lastDay),
    local.getUTCHours(), local.getUTCMinutes(), local.getUTCSeconds(), local.getUTCMilliseconds()) - INDIA_OFFSET);
}

export function paidAccessChain(now: Date, periods: Array<{ periodStart: Date; periodEnd: Date; anchorDay: number }>) {
  let end = now, anchorDay = indiaDay(now);
  let active = false, gap = false;
  for (const period of [...periods].sort((a,b) => a.periodStart.getTime() - b.periodStart.getTime())) {
    if (period.periodEnd <= now) continue;
    if (period.periodStart > end) { gap = true; break; }
    if (period.periodEnd > end) {
      active = true; end = period.periodEnd; anchorDay = period.anchorDay;
    }
  }
  return { end, anchorDay, active, gap };
}
