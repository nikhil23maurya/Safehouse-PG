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
    getSupportedUpiIntentApps() { return Promise.resolve(["phonepe"]); }
    checkPaymentAdapter() { throw new Error("GPay-only adapter detection must not be used for other UPI apps"); }
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

test("Android uses the provider-supported generic chooser without guessing installed apps",async()=>{
  let payment;
  class SDK {
    on() {}
    getSupportedUpiIntentApps(){return Promise.resolve(["gpay","phonepe","navi","any","any","untrusted-app"]);}
    checkPaymentAdapter(){return Promise.reject(new Error("Legacy detection rejects installed apps"));}
    createPayment(data,options){payment={data,options};}
  }
  const client=new CustomUpiPayment({Razorpay:SDK,keyId:"synthetic-key",onSigned:()=>{},onUncertain:()=>{}});
  assert.deepEqual(await client.availableApps(),[["any","Choose a UPI app"]]);
  assert.throws(()=>client.pay({orderId:"order_Test01",contact:"9123456789",email:"owner@example.test",app:"untrusted-app"}));
  assert.equal(client.pay({orderId:"order_Test01",contact:"9123456789",email:"owner@example.test",app:"any"}),true);
  assert.equal(payment.options.app,"any");assert.equal(payment.data.order_id,"order_Test01");
  assert.equal(payment.data.amount,24900);assert.equal(payment.data.subscription_id,undefined);
});

test("unsupported browsers and failed discovery never invent a payment-app option",async()=>{
  for(const result of [[],["untrusted-app"],{phonepe:true},null]){
    class SDK {on(){} getSupportedUpiIntentApps(){return Promise.resolve(result);} createPayment(){assert.fail("Must not pay without an offered app");}}
    const client=new CustomUpiPayment({Razorpay:SDK,keyId:"synthetic-key",onSigned:()=>{},onUncertain:()=>{}});
    assert.deepEqual(await client.availableApps(),[]);
    assert.throws(()=>client.pay({orderId:"order_Test01",contact:"9123456789",app:"any"}));
  }
  class Unavailable {on(){} getSupportedUpiIntentApps(){return Promise.reject(new Error("Unavailable"));}}
  const client=new CustomUpiPayment({Razorpay:Unavailable,keyId:"synthetic-key",onSigned:()=>{},onUncertain:()=>{}});
  assert.deepEqual(await client.availableApps(),[]);
});
