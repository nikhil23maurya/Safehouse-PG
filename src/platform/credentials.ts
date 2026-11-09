type SubscriptionKeys = {
  PGONE_SUBSCRIPTION_KEY_ID?: string;
  PGONE_SUBSCRIPTION_KEY_SECRET?: string;
};
type ExistingKeys = {
  RAZORPAY_KEY_ID?: string;
  RAZORPAY_KEY_SECRET?: string;
};

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
