import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
process.env.DATABASE_URL ||= "postgresql://ci:ci@127.0.0.1:5432/pgone_test";
process.env.JWT_ACCESS_SECRET ||= "unit-test-access-key-32-characters-long";
process.env.JWT_REFRESH_SECRET ||= "unit-test-refresh-key-32-characters-long";
const { platformPair, platformClaims } = await import(
  "../src/platform/tokens.js"
);
const { paidPeriod, verifiedInvoice, webhookSignature } = await import(
  "../src/platform/billing.js"
);
const { taxBreakdown } = await import("../src/platform/config.js");
const { verifyPassword, hashPassword, verifyToken } = await import(
  "../src/security.js"
);

test("platform credentials are domain-separated, membership-scoped and tamper resistant", () => {
  const pair = platformPair(
    { id: "account-a", tokenVersion: 7 },
    "membership-a",
  );
  assert.equal(platformClaims(pair.accessToken).membershipId, "membership-a");
  assert.equal(platformClaims(pair.refreshToken, "refresh").ver, 7);
  assert.throws(() => platformClaims(pair.refreshToken));
  assert.throws(() => verifyToken(pair.accessToken, "access"));
  const parts = pair.accessToken.split(".");
  parts[2] = Buffer.from(
    JSON.stringify({ sub: "account-b", ver: 7, membershipId: "membership-b" }),
  ).toString("base64url");
  assert.throws(() => platformClaims(parts.join(".")));
  assert.throws(() => platformClaims(`${pair.accessToken}.extra`));
});
test("phone-only actors cannot use password login; existing password hashes still verify", async () => {
  assert.equal(await verifyPassword("anything", null), false);
  const hash = await hashPassword("Correct-password-123");
  assert.equal(await verifyPassword("Correct-password-123", hash), true);
  assert.equal(await verifyPassword("Incorrect-password", hash), false);
});
test("inclusive price stays exactly 24900 paise without guessing unconfigured tax", () => {
  assert.equal(taxBreakdown(undefined), null);
  for (const rate of [0, 500, 1200, 1800, 2800]) {
    const tax = taxBreakdown(rate)!;
    assert.equal(tax.taxPaise + tax.taxablePaise, 24900);
    assert.equal(tax.inclusive, true);
  }
});
const invoice = {
  id: "inv_Test01",
  subscription_id: "sub_Test01",
  status: "paid",
  currency: "INR",
  amount: 24900,
  amount_paid: 24900,
  amount_due: 0,
  payment_id: "pay_Test01",
  billing_start: 1800000000,
  billing_end: 1802592000,
};
const payment = {
  id: "pay_Test01",
  status: "captured",
  captured: true,
  amount: 24900,
  currency: "INR",
  amount_refunded: 0,
  created_at: 1800000000,
};
test("only an exact captured provider payment and matching subscription invoice reconcile", () => {
  assert.equal(verifiedInvoice(invoice, payment, "sub_Test01"), true);
  for (const change of [
    { amount: 24899 },
    { amount_paid: 24901 },
    { amount_due: 1 },
    { status: "issued" },
    { currency: "USD" },
    { payment_id: "pay_Other" },
    { subscription_id: "sub_Other" },
    { billing_end: invoice.billing_start },
    { billing_end: invoice.billing_start + 366 * 86400 },
  ])
    assert.equal(
      verifiedInvoice({ ...invoice, ...change }, payment, "sub_Test01"),
      false,
    );
  for (const change of [
    { captured: false },
    { status: "authorized" },
    { amount: 24901 },
    { currency: "USD" },
    { amount_refunded: -1 },
    { amount_refunded: 24901 },
  ])
    assert.equal(
      verifiedInvoice(invoice, { ...payment, ...change }, "sub_Test01"),
      false,
    );
});
test("entitlement requires current fully paid period and revokes upon any refund", () => {
  const now = new Date("2026-11-09T12:00:00Z");
  const p = {
    status: "CAPTURED",
    amountPaise: 24900,
    refundedPaise: 0,
    periodStart: new Date("2026-11-01"),
    periodEnd: new Date("2026-12-01"),
  };
  assert.equal(paidPeriod(p, now), true);
  for (const change of [
    { status: "PENDING" },
    { amountPaise: 100 },
    { refundedPaise: 1 },
    { periodStart: new Date("2026-11-10") },
    { periodEnd: now },
  ])
    assert.equal(paidPeriod({ ...p, ...change }, now), false);
});
test("subscription webhooks verify the exact raw bytes with a separate signing secret", () => {
  const raw = Buffer.from('{"event":"subscription.charged"}'),
    secret = "test-webhook-secret";
  const signature = crypto
    .createHmac("sha256", secret)
    .update(raw)
    .digest("hex");
  assert.equal(webhookSignature(raw, signature, secret), true);
  assert.equal(
    webhookSignature(Buffer.from(`${raw} `), signature, secret),
    false,
  );
  assert.equal(webhookSignature(raw, signature, "different-secret"), false);
  assert.equal(webhookSignature(raw, "xyz", secret), false);
});

const { authorisationSignature } = await import(
  "../src/platform/web-billing.js"
);
test("custom authorisation signatures bind payment to the database subscription", () => {
  const signature = crypto
    .createHmac("sha256", "test-sub-secret")
    .update("pay_Test01|sub_Test01")
    .digest("hex");
  assert.equal(
    authorisationSignature(
      "pay_Test01",
      "sub_Test01",
      signature,
      "test-sub-secret",
    ),
    true,
  );
  assert.equal(
    authorisationSignature(
      "pay_Test01",
      "sub_Other01",
      signature,
      "test-sub-secret",
    ),
    false,
  );
  assert.equal(
    authorisationSignature(
      "pay_Other01",
      "sub_Test01",
      signature,
      "test-sub-secret",
    ),
    false,
  );
  assert.equal(
    authorisationSignature(
      "pay_Test01",
      "sub_Test01",
      signature,
      "wrong-secret",
    ),
    false,
  );
});
