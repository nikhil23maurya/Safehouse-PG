import test from "node:test";
import assert from "node:assert/strict";
import {
  money,
  parseRupees,
  invoiceStatus,
  trustedQr,
  verifiedCapture,
} from "../src/domain/finance.js";
import {
  currentPeriod,
  matchesContext,
  ResourceCache,
} from "../src/core/state.js";

test("money preserves paise and does not invent zero for missing amounts", () => {
  assert.equal(money(850099), "₹8,500.99");
  assert.equal(money(0), "₹0");
  for (const value of [null, undefined, NaN, 1.5, "0"])
    assert.equal(money(value), "—");
});
test("rupee inputs use exact decimal validation", () => {
  assert.equal(parseRupees("8500.99"), 8500.99);
  assert.equal(parseRupees("0.01"), 0.01);
  for (const value of ["1.005", "1e4", "-1", "", "NaN", "Infinity", "8,500"])
    assert.throws(() => parseRupees(value));
  assert.throws(() => parseRupees("100.01", { max: 100 }));
});
test("invoice states respect paid, waived and processing before due dates", () => {
  assert.equal(
    invoiceStatus({ status: "PAID", dueDate: "2000-01-01" }).label,
    "Paid",
  );
  assert.equal(
    invoiceStatus({ status: "WAIVED", dueDate: "2000-01-01" }).label,
    "Waived",
  );
  assert.equal(
    invoiceStatus({ status: "PROCESSING", dueDate: "2000-01-01" }).label,
    "Verifying",
  );
  assert.equal(
    invoiceStatus({ status: "DUE", dueDate: "2000-01-01" }).label,
    "Overdue",
  );
});
test("QR URLs require an exact provider host and integer paise", () => {
  const qr = {
    id: "qr_fixture1",
    amountPaise: 850000,
    expiresAt: 1234567890,
    imageUrl: "https://rzp.io/i/test",
  };
  assert.ok(trustedQr(qr));
  for (const imageUrl of [
    "http://rzp.io/x",
    "https://razorpay.com.evil.test/qr",
    "https://evilrazorpay.com/qr",
    "javascript:alert(1)",
    "https://user:pass@rzp.io/x",
  ])
    assert.equal(trustedQr({ ...qr, imageUrl }), false);
  assert.equal(trustedQr({ ...qr, amountPaise: 1.5 }), false);
});
test("success requires capture and the exact fully-paid invoice", () => {
  const good = {
    paid: true,
    attemptStatus: "CAPTURED",
    invoiceStatus: "PAID",
    invoice: { id: "invoice1", status: "PAID", remainingPaise: 0 },
  };
  assert.ok(verifiedCapture(good, "invoice1"));
  for (const patch of [
    { paid: false },
    { attemptStatus: "VERIFIED" },
    { attemptStatus: "CREATED" },
    { invoiceStatus: "PROCESSING" },
    { invoice: { ...good.invoice, remainingPaise: 1 } },
    { invoice: { ...good.invoice, id: "invoice2" } },
  ])
    assert.equal(verifiedCapture({ ...good, ...patch }, "invoice1"), false);
});
test("property timezone determines the billing month at UTC boundaries", () => {
  assert.deepEqual(
    currentPeriod("Asia/Kolkata", new Date("2026-10-31T20:00:00Z")),
    { year: 2026, month: 11 },
  );
  assert.deepEqual(
    currentPeriod("America/New_York", new Date("2026-11-01T01:00:00Z")),
    { year: 2026, month: 10 },
  );
});
test("responses from another property or period are rejected", () => {
  const s = { property: { id: "one" }, period: { year: 2026, month: 11 } };
  assert.ok(
    matchesContext(
      { property: { id: "one" }, period: { year: 2026, month: 11 } },
      s,
    ),
  );
  assert.equal(matchesContext({ property: { id: "two" } }, s), false);
  assert.equal(matchesContext({ period: { year: 2026, month: 10 } }, s), false);
});
test("cache coalesces reads and evicts failures", async () => {
  const cache = new ResourceCache();
  let calls = 0;
  const load = async () => {
    calls++;
    return ["actual response"];
  };
  await Promise.all([
    cache.get("property1", load),
    cache.get("property1", load),
  ]);
  assert.equal(calls, 1);
  await cache.get("property2", load);
  assert.equal(calls, 2);
  await assert.rejects(
    cache.get("failure", async () => {
      throw new Error("offline");
    }),
  );
  assert.equal(
    await cache.get("failure", async () => "recovered"),
    "recovered",
  );
  cache.clear();
  await cache.get("property1", load);
  assert.equal(calls, 3);
});
