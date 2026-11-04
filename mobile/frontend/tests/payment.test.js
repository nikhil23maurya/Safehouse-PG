import test from "node:test";
import assert from "node:assert/strict";
import { PaymentController } from "../src/payments/controller.js";

const invoice = {
  id: "invoice1",
  year: 2026,
  month: 11,
  status: "DUE",
  remainingPaise: 850099,
};
const qr = {
  id: "qr_fixture1",
  imageUrl: "https://rzp.io/i/fixture",
  amountPaise: 850099,
  expiresAt: 2000,
};
const pending = {
  attemptStatus: "CREATED",
  paid: false,
  invoiceStatus: "DUE",
  invoice,
};
const captured = {
  attemptStatus: "CAPTURED",
  paid: true,
  invoiceStatus: "PAID",
  invoice: { ...invoice, status: "PAID", remainingPaise: 0 },
};
const payment = {
  id: "payment1",
  source: "RAZORPAY",
  amountPaise: 850099,
  providerOrderId: qr.id,
  providerPaymentId: "pay_fixture1",
  paidAt: "2026-11-04T10:00:00Z",
  receiptNumber: "TEST-RECEIPT",
};

function harness({
  status = pending,
  history = [{ ...captured.invoice, payments: [payment] }],
  existing = null,
  createError,
  statusError,
} = {}) {
  let saved = existing,
    issued = 0,
    checks = 0,
    settled = 0;
  const timers = [];
  const controller = new PaymentController({
    api: async (path) => {
      if (path.endsWith("/upi-qr")) {
        issued++;
        if (createError) throw createError;
        return { qr };
      }
      if (path.endsWith("/status")) {
        checks++;
        if (statusError) throw statusError;
        return typeof status === "function" ? status() : status;
      }
      if (path.endsWith("/invoices")) return { invoices: history };
      throw new Error(`unexpected test request: ${path}`);
    },
    getPending: () => saved,
    setPending: async (value) => {
      saved = value;
    },
    onSettled: () => settled++,
    now: () => 1_000_000,
    schedule: (fn) => {
      timers.push(fn);
      return timers.length;
    },
    cancel: () => {},
  });
  return {
    controller,
    issued: () => issued,
    checks: () => checks,
    settled: () => settled,
    saved: () => saved,
    timers,
  };
}
test("QR starts hidden until the actual provider image loads", async () => {
  const h = harness();
  await h.controller.open(invoice);
  assert.equal(h.controller.value.phase, "awaiting");
  assert.equal(h.controller.value.imageReady, false);
  h.controller.imageLoaded("qr_wrong");
  assert.equal(h.controller.value.imageReady, false);
  h.controller.imageLoaded(qr.id);
  assert.equal(h.controller.value.imageReady, true);
});
test("a pending or signature-verified payment cannot show success", async () => {
  for (const attemptStatus of ["CREATED", "VERIFIED"]) {
    const h = harness({ status: { ...pending, attemptStatus } });
    await h.controller.open(invoice);
    assert.equal(h.controller.value.phase, "awaiting");
    assert.equal(h.settled(), 0);
  }
});
test("only exact captured status and matching payment produce a receipt", async () => {
  const h = harness({ status: captured });
  await h.controller.open(invoice);
  assert.equal(h.controller.value.phase, "success");
  assert.equal(h.controller.value.payment.id, payment.id);
  assert.equal(h.saved(), null);
  assert.equal(h.settled(), 1);
  await h.controller.check();
  await h.controller.resume();
  assert.equal(h.settled(), 1);
});
test("capture without matching receipt record remains verifying", async () => {
  for (const mismatch of [
    [],
    [{ ...payment, providerOrderId: "qr_other" }],
    [{ ...payment, amountPaise: 1 }],
  ]) {
    const h = harness({
      status: captured,
      history: [{ ...captured.invoice, payments: mismatch }],
    });
    await h.controller.open(invoice);
    assert.equal(h.controller.value.phase, "verifying");
    assert.equal(h.settled(), 0);
  }
});
test("another payment settling the invoice never creates a QR success", async () => {
  const h = harness({ status: { ...captured, attemptStatus: "CREATED" } });
  await h.controller.open(invoice);
  assert.equal(h.controller.value.phase, "settled");
  assert.equal(h.controller.value.payment, null);
});
test("provider-disabled QR is an honest unavailable state", async () => {
  const h = harness({
    createError: Object.assign(new Error("disabled"), {
      code: "UPI_QR_NOT_ENABLED",
    }),
  });
  await h.controller.open(invoice);
  assert.equal(h.controller.value.phase, "unavailable");
  assert.match(h.controller.value.message, /not enabled/);
  assert.equal(h.controller.value.qr, null);
});
test("lost network never implies failure or success and never issues another QR", async () => {
  const h = harness({ statusError: new Error("offline") });
  await h.controller.open(invoice);
  await h.controller.retry();
  assert.equal(h.controller.value.phase, "unavailable");
  assert.equal(h.issued(), 1);
  assert.equal(h.settled(), 0);
});
test("restoration checks the saved attempt before creating any QR", async () => {
  const h = harness({
    existing: { invoiceId: invoice.id, qr },
    status: captured,
  });
  await h.controller.open(invoice);
  assert.equal(h.issued(), 0);
  assert.equal(h.controller.value.phase, "success");
});
test("image loading failure retries the image, not the financial request", async () => {
  const h = harness();
  await h.controller.open(invoice);
  h.controller.imageFailed(qr.id);
  h.controller.retryImage();
  assert.equal(h.controller.value.imageError, false);
  assert.equal(h.issued(), 1);
});
test("failed attempts remain distinct from network failures", async () => {
  const h = harness({ status: { ...pending, attemptStatus: "FAILED" } });
  await h.controller.open(invoice);
  assert.equal(h.controller.value.phase, "failed");
  assert.equal(h.settled(), 0);
});
test("expired QR is reconciled before the backend replacement endpoint is called", async () => {
  const h = harness({
    existing: { invoiceId: invoice.id, qr: { ...qr, expiresAt: 500 } },
  });
  await h.controller.open(invoice);
  assert.equal(h.controller.value.phase, "expired");
  assert.equal(h.issued(), 0);
  await h.controller.retry();
  assert.ok(h.checks() >= 2);
  assert.equal(h.issued(), 1);
});
test("a stale response after leaving payment cannot show a success screen", async () => {
  let release;
  const h = harness();
  h.controller.api = async (path) =>
    path.endsWith("/upi-qr")
      ? { qr }
      : new Promise((resolve) => {
          release = () => resolve(captured);
        });
  const opening = h.controller.open(invoice);
  await new Promise((resolve) => setTimeout(resolve, 0));
  h.controller.stop();
  release();
  await opening;
  assert.notEqual(h.controller.value.phase, "success");
  assert.equal(h.settled(), 0);
});
