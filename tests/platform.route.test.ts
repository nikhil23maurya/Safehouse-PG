import test from "node:test";
import assert from "node:assert/strict";
Object.assign(process.env, {
  DATABASE_URL: "postgresql://unused:unused@127.0.0.1:1/route_unit",
  JWT_ACCESS_SECRET: "unit-route-access-key-32-characters-long",
  JWT_REFRESH_SECRET: "unit-route-refresh-key-32-characters-long",
  NODE_ENV: "test",
  PGONE_PLATFORM_ENABLED: "true",
  PGONE_RAZORPAY_ROUTE_ENABLED: "true",
  RAZORPAY_KEY_ID: "rzp_test_route_unit_123",
  RAZORPAY_KEY_SECRET: "never-log-test-credential",
});
const {
  routeReference, routeAccountStage, routeTransfer, routeOnboardingInput,
  RazorpayRoute, routeEnabled,
} = await import("../src/platform/razorpay-route.js");

test("Razorpay Route account status requires exact owner reference and verified linked UPI", () => {
  assert.equal(routeEnabled(), true);
  const reference = routeReference("org-alpha");
  assert.notEqual(reference, routeReference("org-beta"));
  const account = {
    id: "acc_ABC123456789", type: "route", reference_id: reference,
    status: "created", tnc: { accepted: true },
    product_config: { product_name: "route", activation_status: "activated",
      active_configuration: { settlement_accounts: [
        { method: "upi", verification_status: "verified", active: true },
      ] } },
  };
  const approved = routeAccountStage(account, reference);
  assert.equal(approved.status, "APPROVED");
  assert.equal(approved.collectionEnabled, false, "a test account must never enable LIVE rent transfers");
  for (const change of [
    { reference_id: routeReference("org-beta") },
    { status: "suspended" },
    { tnc: { accepted: false } },
    { product_config: { ...account.product_config, activation_status: "pending" } },
    { product_config: { ...account.product_config, active_configuration: { settlement_accounts: [
      { method: "upi", verification_status: "pending", active: true },
    ] } } },
  ]) {
    const altered = { ...account, ...change };
    if (change.reference_id) assert.throws(() => routeAccountStage(altered, reference), {code:"ROUTE_ACCOUNT_MISMATCH"});
    else assert.equal(routeAccountStage(altered, reference).collectionEnabled, false);
  }
  assert.throws(() => routeAccountStage(account, reference, "acc_OTHER1234567"), {code:"ROUTE_ACCOUNT_MISMATCH"});
});
test("only exact verified recipient amount and currency may be routed", () => {
  assert.deepEqual(routeTransfer("acc_ABC123456789", 750000),
    { account: "acc_ABC123456789", amount: 750000, currency: "INR", on_hold: false });
  for (const [account, amount] of [["other", 750000],["acc_ABC123456789", 0],
    ["acc_ABC123456789", 149.1],["acc_ABC123456789", 10000001]]) {
    assert.throws(() => routeTransfer(account as string, amount as number), {code:"ROUTE_TRANSFER_INVALID"});
  }
});
test("Razorpay Route onboarding requires real consent, valid PAN, UPI ID and identity", () => {
  const input = { legalName:"Rahul Sharma", email:"rahul@example.com", businessType:"individual", pan:"ABCDE1234F", vpa:"rahul@okhdfcbank", consent:true };
  assert.equal(routeOnboardingInput.safeParse(input).success, true);
  for (const mutation of [{consent:false},{pan:"1234"},{vpa:"upi://something"},
    {businessType:"unknown"},{email:"not-an-email"},{legalName:"X"}]) {
    assert.equal(routeOnboardingInput.safeParse({...input,...mutation}).success, false);
  }
});
test("Route API uses only approved domain, parent credentials and safe response handling", async () => {
  const requests: Array<{url: string; options: any}> = [];
  const provider = new RazorpayRoute(async (url: any, options: any) => {
    requests.push({url:String(url),options});
    return new Response(JSON.stringify({vpa:"rahul@okhdfcbank",success:true,customer_name:"Rahul Sharma"}),{status:200});
  });
  await provider.validateVpa("rahul@okhdfcbank");
  assert.equal(requests[0].url, "https://api.razorpay.com/v1/payments/validate/vpa");
  assert.match(String(requests[0].options.headers.authorization),/^Basic /);
  assert.equal(requests[0].options.redirect, "error");
  await assert.rejects(() => provider.get("../admin"), {code:"ROUTE_INVALID_PATH"});
  const rejected = new RazorpayRoute(async () => new Response("secret-private-error",{status:403}));
  await assert.rejects(() => rejected.get("acc_ABC123456789"),
    (e:any) => e.code==="ROUTE_PROVIDER_UNAVAILABLE" && !e.message.includes("private"));
});

test("rent order carries one immutable linked-account transfer, never a shared PGOne collection", async () => {
  const { createRazorpayOrder } = await import("../src/razorpay.js");
  const original = globalThis.fetch;
  const calls: any[] = [];
  let trusted = true;
  globalThis.fetch = (async (_url: any, options: any) => {
    const body = JSON.parse(options.body);
    calls.push(body);
    return new Response(JSON.stringify({
      id: "order_ROUTESAMPLE123", amount: body.amount, currency: "INR",
      receipt: body.receipt, status: "created",
      transfers: trusted ? [{ recipient:"acc_ABC123456789",amount:body.amount,currency:"INR" }] : [],
    }), {status:200});
  }) as any;
  try {
    const order = await createRazorpayOrder({
      amountPaise: 750000, receipt: "PGO_RENT_ROUTESAMPLE123",
      notes:{invoiceId:"invoice1",studentId:"resident1",propertyId:"prop1"},
      routeAccountId:"acc_ABC123456789",
    });
    assert.equal(order.id, "order_ROUTESAMPLE123");
    assert.deepEqual(calls[0].transfers, [{account:"acc_ABC123456789", amount:750000,currency:"INR",on_hold:false}]);
    assert.equal(calls[0].partial_payment,false);
    trusted = false;
    await assert.rejects(() => createRazorpayOrder({
      amountPaise:750000,receipt:"PGO_BAD_ROUTE",notes:{invoiceId:"invoice1"},routeAccountId:"acc_ABC123456789",
    }),{code:"ROUTE_ORDER_NOT_CONFIRMED"});
  } finally { globalThis.fetch = original; }
});
