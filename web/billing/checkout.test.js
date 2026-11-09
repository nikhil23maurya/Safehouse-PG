import test from "node:test";
import assert from "node:assert/strict";
import { CustomUpiPayment } from "./checkout.js";
test("custom one-time UPI payment uses the server order and exact price without a mandate", async () => {
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
  const client = new CustomUpiPayment({
    Razorpay: SDK,
    keyId: "test-key",
    onSigned: () => signed++,
    onUncertain: () => {},
  });
  assert.deepEqual(await client.availableApps(), [["phonepe", "PhonePe"]]);
  const input = {
    orderId: "order_Confirmed01",
    contact: "9123456789",
    email: "owner@example.test",
    app: "phonepe",
  };
  assert.equal(client.pay(input), true);
  assert.equal(client.pay(input), false);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], {
    data: {
      amount: 24900,
      currency: "INR",
      order_id: input.orderId,
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
    client.pay({ ...input, orderId: "client-forged-reference" }),
  );
});
