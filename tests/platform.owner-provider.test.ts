import test from "node:test";
import assert from "node:assert/strict";
Object.assign(process.env,{RAZORPAY_OWNER_CLIENT_ID:"syntheticPartnerClient",RAZORPAY_OWNER_CLIENT_SECRET:"synthetic-partner-secret-123",RAZORPAY_OWNER_REDIRECT_URI:"https://example.test/api/owner-payments/callback",RAZORPAY_OWNER_MODE:"test",PGONE_SUBSCRIPTION_KEY_SECRET:"SOFTWARE-FEE-SECRET-MUST-NOT-BE-USED"});
const {razorpayOwnerProvider:p,authorizationUrl}=await import("../src/platform/owner-payments/provider.js");
test("official owner OAuth URLs and documented scope use independent partner credentials",async()=>{
 const original=global.fetch,requests:any[]=[];
 global.fetch=async(url:any,options:any)=>{requests.push({url:String(url),...options,body:JSON.parse(options.body)});return new Response(JSON.stringify({access_token:"synthetic-token"}),{status:200});};
 try{
  const auth=new URL(authorizationUrl("synthetic-state"));assert.equal(auth.origin,"https://auth.razorpay.com");assert.equal(auth.pathname,"/authorize");assert.equal(auth.searchParams.get("scope"),"read_write");assert.equal(auth.searchParams.get("redirect_uri"),process.env.RAZORPAY_OWNER_REDIRECT_URI);assert.equal(auth.searchParams.has("client_secret"),false);
  await p.exchange("one-time-code");await p.refresh("synthetic-refresh");await p.revoke("synthetic-access");
  assert.deepEqual(requests.map(r=>r.url),["https://auth.razorpay.com/token","https://auth.razorpay.com/token","https://auth.razorpay.com/revoke"]);
  assert.equal(requests[0].body.grant_type,"authorization_code");assert.equal(requests[1].body.grant_type,"refresh_token");assert.ok(!JSON.stringify(requests).includes(process.env.PGONE_SUBSCRIPTION_KEY_SECRET!));
 }finally{global.fetch=original;}
});
test("owner resource calls use Bearer merchant context and exact official resource paths",async()=>{
 const original=global.fetch,requests:any[]=[];
 global.fetch=async(url:any,options:any)=>{requests.push({url:String(url),...options});return new Response(JSON.stringify(String(url).includes("/payments")||String(url).includes("/refunds")||String(url).includes("/recon/")?{items:[]}:{id:"synthetic"}),{status:200});};
 try{
  await p.account("OWNER-ACCESS","acc_Synthetic");await p.product("OWNER-ACCESS","acc_Synthetic","acc_prd_Synthetic");await p.createOrder("OWNER-ACCESS",{amount:800000,receipt:"SYNTHETIC",notes:{organisationId:"orgA"}});await p.payments("OWNER-ACCESS","order_Synthetic");await p.refunds("OWNER-ACCESS","pay_Synthetic");await p.settlement("OWNER-ACCESS","setl_Synthetic");await p.recon("OWNER-ACCESS",2026,11,11);
  assert.ok(requests.every(r=>r.headers.authorization==="Bearer OWNER-ACCESS"));assert.ok(requests.every(r=>r.url.startsWith("https://api.razorpay.com/")));
  const order=JSON.parse(requests[2].body);assert.equal(order.amount,800000);assert.equal(order.partial_payment,false);assert.equal(order.currency,"INR");assert.equal(order.transfers,undefined);assert.equal(order.application_fee,undefined);
  assert.ok(requests.some(r=>r.url==="https://api.razorpay.com/v1/orders/order_Synthetic/payments"));assert.ok(requests.some(r=>r.url.includes("/v1/settlements/recon/combined?year=2026&month=11&day=11")));
 }finally{global.fetch=original;}
});
test("transport uncertainty never retries order POST or falls back to the fee merchant",async()=>{
 const original=global.fetch;let calls=0;global.fetch=async()=>{calls++;throw new Error("Synthetic transport interruption");};
 try{await assert.rejects(()=>p.createOrder("OWNER-ACCESS",{amount:100,receipt:"SYNTHETIC",notes:{}}),{code:"OWNER_PROVIDER_UNCERTAIN"});assert.equal(calls,1);}finally{global.fetch=original;}
});
test("invalid optional owner configuration disables only the new integration",async()=>{
 const {ownerPaymentConfig}=await import("../src/platform/owner-payments/config.js"),before=process.env.RAZORPAY_OWNER_TOKEN_KEY;
 process.env.RAZORPAY_OWNER_TOKEN_KEY="invalid";
 try{const c=ownerPaymentConfig();assert.equal(c.configurationValid,false);assert.equal(c.enabled,false);}finally{if(before===undefined)delete process.env.RAZORPAY_OWNER_TOKEN_KEY;else process.env.RAZORPAY_OWNER_TOKEN_KEY=before;}
});
