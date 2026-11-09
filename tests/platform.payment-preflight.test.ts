import test from "node:test";
import assert from "node:assert/strict";
import { paymentPreflight } from "../src/platform/payment-preflight.js";

const settings = {
  PGONE_TAX_BPS: 0,
  PGONE_BILLING_WEB_ORIGIN: "https://billing.example.test",
  PGONE_TERMS_URL: "https://billing.example.test/terms",
  PGONE_PRIVACY_URL: "https://billing.example.test/privacy",
  PGONE_CUSTOM_WEB_BILLING_ENABLED: "false",
};
const credentials = { keyId: "private-merchant-id", keySecret: "private-merchant-secret", source: "EXISTING_RAZORPAY_ACCOUNT" as const };

test("startup preflight only reads provider status and never consumes or exposes the response", async () => {
  let requests = 0, cancelled = false;
  const report = await paymentPreflight(settings, credentials, true, async (url, options) => {
    requests++;
    assert.equal(String(url), "https://api.razorpay.com/v1/orders?count=1");
    assert.equal(options?.method, "GET");
    assert.equal(options?.body, undefined);
    assert.equal(options?.redirect, "error");
    assert.ok(options?.signal);
    const stream = new ReadableStream({ cancel() { cancelled = true; } });
    return new Response(stream, { status: 200 });
  });
  assert.equal(requests, 1);
  assert.equal(cancelled, true);
  assert.deepEqual(report.missingSettings, []);
  assert.equal(report.providerOrderReadStatus, 200);
  assert.equal(report.recurring, false);
  assert.equal(report.customBillingFlagEnabled, false);
  assert.equal(report.customCheckoutAcceptanceVerified, false);
  for (const secret of Object.values(credentials)) {
    if (secret !== credentials.source) assert.equal(JSON.stringify(report).includes(secret), false);
  }
  assert.equal(JSON.stringify(report).includes(settings.PGONE_BILLING_WEB_ORIGIN), false);
});

test("missing credentials skip network access and preserve explicit zero tax", async () => {
  const report = await paymentPreflight({ PGONE_TAX_BPS: 0 }, null, false, async () => {
    assert.fail("Missing credentials must never trigger a provider call");
  });
  assert.equal(report.providerOrderReadStatus, null);
  assert.equal(report.credentialSource, "UNAVAILABLE_OR_PARTIAL");
  assert.equal(report.webhookSecretAvailable, false);
  assert.deepEqual(report.missingSettings, ["PGONE_BILLING_WEB_ORIGIN", "PGONE_TERMS_URL", "PGONE_PRIVACY_URL"]);
});

test("provider rejection and outages remain diagnostic results without leaking errors", async () => {
  const rejected = await paymentPreflight(settings, credentials, false, async () => new Response("private-provider-error", { status: 401 }));
  assert.equal(rejected.providerOrderReadStatus, 401);
  const unavailable = await paymentPreflight(settings, credentials, true, async () => {
    throw new Error(`private transport error ${credentials.keySecret}`);
  });
  assert.equal(unavailable.providerOrderReadStatus, "UNAVAILABLE");
  assert.equal(JSON.stringify([rejected, unavailable]).includes("private"), false);
});
