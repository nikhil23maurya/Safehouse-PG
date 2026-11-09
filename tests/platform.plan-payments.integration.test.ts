import test, { after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import express from "express";
import { ZodError } from "zod";
Object.assign(process.env, {
  PGONE_PLATFORM_ENABLED: "true", PGONE_CUSTOM_WEB_BILLING_ENABLED: "true",
  PGONE_SUBSCRIPTION_KEY_ID: "test-unit-key", PGONE_SUBSCRIPTION_KEY_SECRET: "test-unit-secret",
  PGONE_SUBSCRIPTION_WEBHOOK_SECRET: "test-unit-webhook", PGONE_TAX_BPS: "0",
  PGONE_BILLING_WEB_ORIGIN: "https://billing.example.test",
});
// No provider plan or mandate cycles configured: manual payments must work without them.
const { prisma } = await import("../src/db.js");
const { phoneAccount, saveProfile, createProperty } = await import("../src/platform/service.js");
const { entitlement } = await import("../src/platform/billing.js");
const { platformPair } = await import("../src/platform/tokens.js");
const { platformRouter } = await import("../src/platform/router.js");
const { RazorpayPlanOrders, createPlanOrder, reconcilePlanOrder, verifyPlanPayment,
  manualPlanStatus, processPlanWebhook, manualBillingConfigured, manualCheckoutEnabled } = await import("../src/platform/plan-payments.js");
const { config: backendConfig } = await import("../src/config.js");
const app = express();
app.use(express.json());app.use("/api/platform",platformRouter);
app.use((e:any,_req:any,res:any,_next:any)=>res.status(e instanceof ZodError ? 400 : e.statusCode||500).json({error:{code:e.code,message:e.message}}));
const server=app.listen(0,"127.0.0.1");
await new Promise<void>(resolve=>server.on("listening",resolve));
const base=`http://127.0.0.1:${(server.address() as any).port}`;
after(async()=>{server.close();await prisma.$disconnect();});

function manualProvider() {
  const orders = new Map<string, any>(), payments = new Map<string, any>();
  let creations = 0, loseNextCreate = false;
  const provider = new RazorpayPlanOrders(async (url, options) => {
    const parsed = new URL(String(url)), parts = parsed.pathname.split("/");
    let data;
    if (parsed.pathname === "/v1/orders" && options?.method === "POST") {
      const input = JSON.parse(String(options.body));
      assert.equal(input.amount, 24900);assert.equal(input.partial_payment, false);
      assert.equal(input.subscription_id, undefined);
      const id = `order_Manual${++creations}${crypto.randomUUID().replaceAll("-", "")}`;
      data = { ...input, id, status: "created", amount_paid: 0, amount_due: 24900 };
      orders.set(id, data);
      if (loseNextCreate) { loseNextCreate = false; throw new Error("Response lost after provider accepted order"); }
    } else if (parsed.pathname === "/v1/orders") data = { items: [...orders.values()].filter(o => o.receipt === parsed.searchParams.get("receipt")) };
    else if (parts[2] === "orders" && parts[4] === "payments") data = { items: [...payments.values()].filter(p => p.order_id === parts[3]) };
    else if (parts[2] === "orders") data = orders.get(parts[3]!);
    else if (parts[2] === "payments") data = payments.get(parts[3]!);
    assert.ok(data, `Unexpected manual provider path ${parsed.pathname}`);
    return new Response(JSON.stringify(data), { status: 200 });
  });
  return { provider, orders, payments, get creations() { return creations; },
    loseNext() { loseNextCreate = true; },
    pay(orderId: string, status = "captured") {
      const id = `pay_Manual${crypto.randomUUID().replaceAll("-", "")}`;
      const payment = { id, order_id: orderId, amount: 24900, currency: "INR", status,
        captured: status === "captured", amount_refunded: 0, created_at: Math.floor(Date.now()/1000) };
      payments.set(id, payment);
      if (status === "captured") Object.assign(orders.get(orderId), { status: "paid", amount_paid: 24900, amount_due: 0 });
      return payment;
    },
  };
}
async function manualOwner() {
  const suffix=crypto.randomUUID();
  const account=await phoneAccount({uid:`manual-${suffix}`,phoneE164:`+916${String(Math.floor(Math.random()*1e9)).padStart(9,"0")}`});
  await saveProfile(account.id,{fullName:"Manual billing owner",intent:"OWNER"});
  const property=await createProperty(account.id,{name:"Manual Billing House",city:"Pune",key:suffix});
  return {account,organisationId:property.organisationId};
}

test("production blocks order creation and capture reconciliation using non-live credentials",async()=>{
  const {account,organisationId}=await manualOwner(),mock=manualProvider();
  const order=await createPlanOrder(account.id,organisationId,crypto.randomUUID(),mock.provider);
  mock.pay(order.orderId!);
  const previous=backendConfig.NODE_ENV;
  try {
    backendConfig.NODE_ENV="production";
    assert.equal(manualBillingConfigured(),false);assert.equal(manualCheckoutEnabled(),false);
    await assert.rejects(()=>createPlanOrder(account.id,organisationId,crypto.randomUUID(),mock.provider),{code:"PLAN_PAYMENT_UNAVAILABLE"});
    await assert.rejects(()=>reconcilePlanOrder(order.id,mock.provider),{code:"PLAN_KEY_MODE_NOT_LIVE"});
    assert.equal(await prisma.pgPlanReceipt.count({where:{organisationId}}),0);
    assert.equal(await entitlement(organisationId),false);
    assert.equal(mock.creations,1);
  } finally { backendConfig.NODE_ENV=previous; }
});

test("one capture grants a calendar month once; early renewal, immutable periods, signatures and refunds reconcile",async()=>{
  const {account,organisationId}=await manualOwner(),mock=manualProvider(),key=crypto.randomUUID();
  const first=await createPlanOrder(account.id,organisationId,key,mock.provider);
  assert.equal(first.recurring,false);assert.equal(first.payable,true);
  assert.equal((await createPlanOrder(account.id,organisationId,key,mock.provider)).orderId,first.orderId);
  assert.equal(mock.creations,1);
  const auth=mock.pay(first.orderId!,"authorized");
  const signature=crypto.createHmac("sha256","test-unit-secret").update(`${first.orderId}|${auth.id}`).digest("hex");
  const pending=await verifyPlanPayment(account.id,organisationId,first.id,{paymentId:auth.id,signature},mock.provider);
  assert.equal(pending.entitled,false,"signed but uncaptured payment must not grant access");
  await assert.rejects(()=>verifyPlanPayment(account.id,organisationId,first.id,{paymentId:auth.id,signature:"0".repeat(64)},mock.provider),{code:"INVALID_PLAN_SIGNATURE"});
  Object.assign(auth,{status:"captured",captured:true});
  Object.assign(mock.orders.get(first.orderId!),{status:"paid",amount_paid:24900,amount_due:0});
  const now=new Date();
  await Promise.all([reconcilePlanOrder(first.id,mock.provider,now),reconcilePlanOrder(first.id,mock.provider,now)]);
  const receipt=await prisma.pgPlanReceipt.findUniqueOrThrow({where:{orderId:first.id}});
  assert.equal(await entitlement(organisationId),true);
  assert.equal(await prisma.pgPlanReceipt.count({where:{orderId:first.id}}),1);
  const second=await createPlanOrder(account.id,organisationId,crypto.randomUUID(),mock.provider);
  mock.pay(second.orderId!);
  await reconcilePlanOrder(second.id,mock.provider,new Date(now.getTime()+1000));
  const renewal=await prisma.pgPlanReceipt.findUniqueOrThrow({where:{orderId:second.id}});
  assert.equal(renewal.periodStart.toISOString(),receipt.periodEnd.toISOString(),"early renewal preserves unused days");
  assert.equal(renewal.anchorDay,receipt.anchorDay);
  await reconcilePlanOrder(first.id,mock.provider,new Date(now.getTime()+100000));
  assert.equal((await prisma.pgPlanReceipt.findUniqueOrThrow({where:{orderId:first.id}})).periodEnd.toISOString(),receipt.periodEnd.toISOString());
  const status=await manualPlanStatus(account.id,organisationId);
  assert.equal(status.mode,"MANUAL_MONTHLY");assert.equal(status.recurring,false);
  assert.equal(new Date(status.accessEnd!).toISOString(),renewal.periodEnd.toISOString());
  assert.equal(status.subscription.payments.length,2);
  auth.amount=25000;
  await assert.rejects(()=>reconcilePlanOrder(first.id,mock.provider),{code:"PLAN_PAYMENT_MISMATCH"});auth.amount=24900;
  auth.amount_refunded=100;
  const raw=Buffer.from(JSON.stringify({event:"refund.processed",payload:{refund:{entity:{payment_id:auth.id}}}}));
  const sig=crypto.createHmac("sha256","test-unit-webhook").update(raw).digest("hex"),eventId=crypto.randomUUID();
  await processPlanWebhook(raw,sig,eventId,mock.provider);await processPlanWebhook(raw,sig,eventId,mock.provider);
  assert.equal(await entitlement(organisationId),false,"refund revokes its period without pulling a future paid period forward");
  await assert.rejects(()=>createPlanOrder(account.id,organisationId,crypto.randomUUID(),mock.provider),{code:"PLAN_PERIOD_REVIEW_REQUIRED"});
  assert.equal(await prisma.pgProviderEvent.count({where:{provider:"RAZORPAY_PLAN",eventKey:eventId}}),1);
  auth.amount_refunded=0;await reconcilePlanOrder(first.id,mock.provider);
  assert.equal((await prisma.pgPlanReceipt.findUniqueOrThrow({where:{orderId:first.id}})).refundedPaise,100,"a stale snapshot cannot reverse a refund");
  await assert.rejects(()=>processPlanWebhook(raw,"0".repeat(64),crypto.randomUUID(),mock.provider),{code:"INVALID_WEBHOOK_SIGNATURE"});
  const altered=Buffer.from(`${raw} `),alteredSig=crypto.createHmac("sha256","test-unit-webhook").update(altered).digest("hex");
  await assert.rejects(()=>processPlanWebhook(altered,alteredSig,eventId,mock.provider),{code:"EVENT_CONFLICT"});
});

test("lost order responses recover without duplicates; cross-owner and unapproved-origin requests are rejected",async()=>{
  const {account,organisationId}=await manualOwner(),foreign=await manualOwner(),mock=manualProvider();
  mock.loseNext();
  await assert.rejects(()=>createPlanOrder(account.id,organisationId,crypto.randomUUID(),mock.provider),{code:"PLAN_PROVIDER_UNCERTAIN"});
  const recovered=await createPlanOrder(account.id,organisationId,crypto.randomUUID(),mock.provider);
  assert.equal(mock.creations,1);assert.equal(recovered.payable,true);
  await assert.rejects(()=>createPlanOrder(foreign.account.id,organisationId,crypto.randomUUID(),mock.provider),{code:"FORBIDDEN"});
  await assert.rejects(()=>verifyPlanPayment(foreign.account.id,foreign.organisationId,recovered.id,{paymentId:"pay_Foreign",signature:"0".repeat(64)},mock.provider),{code:"PLAN_ORDER_NOT_FOUND"});
  await assert.rejects(()=>manualPlanStatus(foreign.account.id,organisationId),{code:"FORBIDDEN"});
  const headers={authorization:`Bearer ${platformPair(foreign.account).accessToken}`,origin:"https://billing.example.test","content-type":"application/json"};
  const body=JSON.stringify({accepted:true,recurring:false,amountPaise:24900,requestKey:crypto.randomUUID()});
  assert.equal((await fetch(`${base}/api/platform/organisations/${organisationId}/plan/orders`,{method:"POST",headers,body})).status,403);
  assert.equal((await fetch(`${base}/api/platform/organisations/${organisationId}/plan/orders`,{method:"POST",headers:{authorization:`Bearer ${platformPair(account).accessToken}`,"content-type":"application/json"},body})).status,403);
  const ownHeaders={...headers,authorization:`Bearer ${platformPair(account).accessToken}`};
  assert.equal((await fetch(`${base}/api/platform/organisations/${organisationId}/subscription/authorise`,{method:"POST",headers:ownHeaders,body:JSON.stringify({accepted:true,amountPaise:24900,cycles:12})})).status,410,"outdated checkout must never create a recurring mandate");
  assert.equal((await fetch(`${base}/api/platform/organisations/${organisationId}/plan/orders`,{method:"POST",headers:ownHeaders,body:JSON.stringify({accepted:true,recurring:true,amountPaise:24900,requestKey:crypto.randomUUID()})})).status,400,"schema rejects recurring consent before any provider call");
  assert.equal(await prisma.pgSubscription.count({where:{organisationId}}),0,"manual purchases never create a recurring subscription");
  assert.ok(await prisma.pgAudit.count({where:{organisationId,action:"PLAN_ORDER_RECOVERED"}}));
});
