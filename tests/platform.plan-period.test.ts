import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { indiaDay, nextCalendarMonth, paidAccessChain } from "../src/platform/plan-period.js";
process.env.DATABASE_URL ||= "postgresql://ci:ci@127.0.0.1:5432/pgone_test";
process.env.JWT_ACCESS_SECRET ||= "unit-test-access-key-32-characters-long";
process.env.JWT_REFRESH_SECRET ||= "unit-test-refresh-key-32-characters-long";
const { orderSignature, matchingOrder, exactCapturedPayment } = await import("../src/platform/plan-payments.js");

test("calendar months preserve India renewal day, short-month anchor and time instead of adding 30 days", () => {
  const start = new Date("2027-01-31T10:45:20.123+05:30");
  const feb = nextCalendarMonth(start);
  assert.equal(feb.toISOString(), new Date("2027-02-28T10:45:20.123+05:30").toISOString());
  assert.equal(nextCalendarMonth(feb, 31).toISOString(), new Date("2027-03-31T10:45:20.123+05:30").toISOString());
  assert.equal(nextCalendarMonth(new Date("2028-01-31T23:00:00+05:30")).toISOString(), new Date("2028-02-29T23:00:00+05:30").toISOString());
  assert.equal(indiaDay(new Date("2027-01-30T20:00:00Z")), 31);
  assert.equal(nextCalendarMonth(new Date("2027-12-15T00:30:00+05:30")).toISOString(), new Date("2028-01-15T00:30:00+05:30").toISOString());
  assert.throws(() => nextCalendarMonth(start, 32));
});

test("one-time signature uses server order | payment; a recurring signature cannot verify", () => {
  const sign = (text: string) => crypto.createHmac("sha256", "secret").update(text).digest("hex");
  assert.equal(orderSignature("order_A", "pay_A", sign("order_A|pay_A"), "secret"), true);
  for (const value of [sign("pay_A|order_A"), sign("order_B|pay_A"), sign("pay_A|sub_A"), "0".repeat(64)])
    assert.equal(orderSignature("order_A", "pay_A", value, "secret"), false);
});

test("renewal follows contiguous paid months and holds gaps without shifting other paid receipts", () => {
  const now = new Date("2027-01-31T10:00:00+05:30");
  const feb = nextCalendarMonth(now,31), march=nextCalendarMonth(feb,31), april=nextCalendarMonth(march,31);
  const first={periodStart:now,periodEnd:feb,anchorDay:31}, second={periodStart:feb,periodEnd:march,anchorDay:31};
  assert.equal(paidAccessChain(now,[second,first]).end.toISOString(),march.toISOString());
  assert.equal(paidAccessChain(now,[second]).gap,true,"a refund must not advance a future month");
  assert.equal(paidAccessChain(now,[first,{periodStart:march,periodEnd:april,anchorDay:31}]).end.toISOString(),feb.toISOString());
  assert.equal(paidAccessChain(new Date(april.getTime()+1),[first,second]).active,false);
});

test("provider capture must match the immutable order, workspace, price, currency and time", () => {
  const local = { id: "local-a", organisationId: "org-a", receiptReference: "ref-a", providerOrderId: "order_A", providerKeyId: "key", amountPaise: 24900, taxPaise: 0, currency: "INR", createdAt: new Date(Date.now()-60000) };
  const remote = { id: "order_A", receipt: "ref-a", amount: 24900, currency: "INR", partial_payment: false, notes: { pgone_plan_order: "local-a", pgone_organisation_id: "org-a" } };
  assert.equal(matchingOrder(remote, local), true);
  for (const change of [{amount:24901}, {currency:"USD"}, {receipt:"other"}, {partial_payment:true}, {notes:{pgone_plan_order:"local-a",pgone_organisation_id:"org-b"}}])
    assert.equal(matchingOrder({...remote,...change}, local), false);
  const payment = {id:"pay_A",order_id:"order_A",status:"captured",captured:true,amount:24900,currency:"INR",amount_refunded:0,created_at:Math.floor(Date.now()/1000)};
  assert.equal(exactCapturedPayment(payment,local),true);
  for (const change of [{status:"authorized",captured:false},{amount:24901},{order_id:"order_B"},{currency:"USD"},{amount_refunded:25000},{amount_refunded:-1},{created_at:0}])
    assert.equal(exactCapturedPayment({...payment,...change},local),false);
  assert.equal(exactCapturedPayment({...payment,status:"refunded",amount_refunded:24900},local),true);
});
