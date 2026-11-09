type SubscriptionKeys = {
  PGONE_SUBSCRIPTION_KEY_ID?: string;
  PGONE_SUBSCRIPTION_KEY_SECRET?: string;
};
type ExistingKeys = {
  RAZORPAY_KEY_ID?: string;
  RAZORPAY_KEY_SECRET?: string;
};

export function paymentKeyMode(keyId?: string) {
  if (!keyId) return "UNAVAILABLE";
  if (/^rzp_live_[a-zA-Z0-9]+$/.test(keyId)) return "LIVE";
  if (/^rzp_test_[a-zA-Z0-9]+$/.test(keyId)) return "TEST";
  return "UNKNOWN";
}
export function requiresLivePaymentKey(context: { nodeEnv?: string; render?: string }) {
  return context.nodeEnv === "production" || context.render === "true";
}
export function planPaymentKeyAllowed(keyId: string | undefined, context: { nodeEnv?: string; render?: string }) {
  return !requiresLivePaymentKey(context) || paymentKeyMode(keyId) === "LIVE";
}

/** Never combine credentials from two merchant accounts or rotate legacy keys. */
export function resolveSubscriptionCredentials(
  subscription: SubscriptionKeys,
  existing: ExistingKeys,
) {
  const keyId = subscription.PGONE_SUBSCRIPTION_KEY_ID;
  const keySecret = subscription.PGONE_SUBSCRIPTION_KEY_SECRET;
  if (keyId || keySecret) {
    return keyId && keySecret
      ? { keyId, keySecret, source: "SUBSCRIPTION_OVERRIDE" as const }
      : null;
  }
  return existing.RAZORPAY_KEY_ID && existing.RAZORPAY_KEY_SECRET
    ? {
        keyId: existing.RAZORPAY_KEY_ID,
        keySecret: existing.RAZORPAY_KEY_SECRET,
        source: "EXISTING_RAZORPAY_ACCOUNT" as const,
      }
    : null;
}
