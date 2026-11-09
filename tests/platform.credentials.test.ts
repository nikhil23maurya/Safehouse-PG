import test from "node:test";
import assert from "node:assert/strict";
import { resolveSubscriptionCredentials } from "../src/platform/credentials.js";

const existing = { RAZORPAY_KEY_ID: "existing-id", RAZORPAY_KEY_SECRET: "existing-secret" };

test("subscriptions use the existing Razorpay account when no override is configured", () => {
  assert.deepEqual(resolveSubscriptionCredentials({}, existing), {
    keyId: "existing-id", keySecret: "existing-secret", source: "EXISTING_RAZORPAY_ACCOUNT",
  });
  assert.deepEqual(existing, { RAZORPAY_KEY_ID: "existing-id", RAZORPAY_KEY_SECRET: "existing-secret" });
});
test("a complete subscription override remains an atomic separate account", () => {
  assert.deepEqual(resolveSubscriptionCredentials({
    PGONE_SUBSCRIPTION_KEY_ID: "override-id", PGONE_SUBSCRIPTION_KEY_SECRET: "override-secret",
  }, existing), { keyId: "override-id", keySecret: "override-secret", source: "SUBSCRIPTION_OVERRIDE" });
});
test("partial overrides never fall back or mix credentials from two accounts", () => {
  for (const partial of [{ PGONE_SUBSCRIPTION_KEY_ID: "override-id" }, { PGONE_SUBSCRIPTION_KEY_SECRET: "override-secret" }])
    assert.equal(resolveSubscriptionCredentials(partial, existing), null);
});
test("missing or incomplete existing credentials remain unavailable", () => {
  assert.equal(resolveSubscriptionCredentials({}, {}), null);
  assert.equal(resolveSubscriptionCredentials({}, { RAZORPAY_KEY_ID: "existing-id" }), null);
  assert.equal(resolveSubscriptionCredentials({}, { RAZORPAY_KEY_SECRET: "existing-secret" }), null);
});
