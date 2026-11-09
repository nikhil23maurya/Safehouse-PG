import test from "node:test";
import assert from "node:assert/strict";
import { CustomUpiAuthorisation } from "./checkout.js";
test("custom UPI authorisation uses the server subscription and exact price with a single in-flight SDK request", async () => {
  let calls = [];
  let listeners = {};
  let signed = 0;
  class SDK {
    on(name, callback) {
      listeners[name] = callback;
    }
    checkPaymentAdapter(name) {
      return name === "phonepe"
        ? Promise.resolve()
        : Promise.reject(new Error("Unavailable"));
    }
    createPayment(data, options) {
      calls.push({ data, options });
    }
  }
  const client = new CustomUpiAuthorisation({
    Razorpay: SDK,
    keyId: "test-key",
    onSigned: () => signed++,
    onUncertain: () => {},
  });
  assert.deepEqual(await client.availableApps(), [["phonepe", "PhonePe"]]);
  const input = {
    subscriptionId: "sub_Confirmed01",
    contact: "9123456789",
    email: "owner@example.test",
    app: "phonepe",
  };
  assert.equal(client.authorise(input), true);
  assert.equal(client.authorise(input), false);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], {
    data: {
      amount: 24900,
      currency: "INR",
      subscription_id: input.subscriptionId,
      method: "upi",
      contact: input.contact,
      email: input.email,
    },
    options: { app: "phonepe" },
  });
  assert.equal(signed, 0);
  listeners["payment.success"]({ razorpay_payment_id: "pay_Test01" });
  assert.equal(signed, 1);
  assert.throws(() =>
    client.authorise({ ...input, subscriptionId: "client-forged-reference" }),
  );
});
