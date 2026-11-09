export function currentPeriod(timeZone = "Asia/Kolkata", now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "numeric",
  }).formatToParts(now);
  return {
    year: Number(parts.find((x) => x.type === "year").value),
    month: Number(parts.find((x) => x.type === "month").value),
  };
}

export const state = {
  tokens: null,
  user: null,
  property: null,
  properties: [],
  student: null,
  platform: null,
  onboardingDraft: null,
  period: currentPeriod(),
  route: { name: "welcome", params: {} },
  pendingPayment: null,
  authEpoch: 0,
};

export function contextKey(s = state) {
  return `${s.authEpoch}:${s.user?.id || "guest"}:${s.property?.id || "none"}:${s.period.year}-${s.period.month}`;
}

export function periodQuery(period = state.period) {
  return new URLSearchParams({
    year: String(period.year),
    month: String(period.month),
  }).toString();
}

export function matchesContext(data, snapshot) {
  return (
    (!data?.property || data.property.id === snapshot.property?.id) &&
    (!data?.period ||
      (data.period.year === snapshot.period.year &&
        data.period.month === snapshot.period.month))
  );
}

export class ResourceCache {
  #values = new Map();
  async get(key, loader, ttl = 30_000) {
    const found = this.#values.get(key);
    if (found && Date.now() - found.at < ttl) return found.promise;
    const entry = { at: Date.now(), promise: Promise.resolve().then(loader) };
    this.#values.set(key, entry);
    try {
      return await entry.promise;
    } catch (error) {
      if (this.#values.get(key) === entry) this.#values.delete(key);
      throw error;
    }
  }
  clear() {
    this.#values.clear();
  }
}
