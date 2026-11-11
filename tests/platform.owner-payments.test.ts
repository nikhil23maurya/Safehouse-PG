import test,{after} from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
Object.assign(process.env,{NODE_ENV:"test",PGONE_PLATFORM_ENABLED:"true",RAZORPAY_OWNER_MERCHANT_ONBOARDING_ENABLED:"true",RAZORPAY_OWNER_MODE:"test",RAZORPAY_OWNER_CLIENT_ID:"syntheticOwnerClient",RAZORPAY_OWNER_CLIENT_SECRET:"synthetic-owner-secret-not-live",RAZORPAY_OWNER_TOKEN_KEY:"ab".repeat(32),RAZORPAY_OWNER_WEBHOOK_SECRET:"synthetic-owner-webhook-not-live",RAZORPAY_OWNER_REDIRECT_URI:"https://example.test/api/owner-payments/callback",PGONE_SUBSCRIPTION_MERCHANT_ACCOUNT_ID:"acc_PGOneSoftwareFee"});
const {prisma}=await import("../src/db.js");
const {registerEmail}=await import("../src/platform/email-auth.js");
const {saveProfile,createProperty}=await import("../src/platform/service.js");
const {issueSession}=await import("../src/platform/sessions.js");
const {platformClaims}=await import("../src/platform/tokens.js");
const {startConnection,finishConnection,merchantView,mapAccount,accessToken,refreshConnection,disconnect}=await import("../src/platform/owner-payments/merchant.js");
const {seal,unseal}=await import("../src/platform/owner-payments/crypto.js");
const {createRentOrder,reconcileRentOrder,residentStatus,checkoutSession}=await import("../src/platform/owner-payments/rent.js");
const {receiveOwnerWebhook,drainOwnerEvents}=await import("../src/platform/owner-payments/webhooks.js");
const {collectionDashboard,reconcileSettlement,reconcileSettlementDay}=await import("../src/platform/owner-payments/settlements.js");
const {entitlement}=await import("../src/platform/billing.js");
import type {OwnerProvider,MerchantToken} from "../src/platform/owner-payments/provider.js";
after(async()=>{await prisma.$disconnect();});
const suffix=()=>crypto.randomBytes(7).toString("hex");
class Provider implements OwnerProvider {
 next="acc_"+suffix();accounts=new Map<string,any>();orders=new Map<string,any>();pays=new Map<string,any[]>();refundList=new Map<string,any[]>();settles=new Map<string,any>();rows:any[]=[];creates=0;refreshes=0;failCreate=false;revokeFails=false;
 token(id=this.next):MerchantToken{return {access_token:"access-credential-"+id,refresh_token:"refresh-credential-"+id,public_token:"rzp_test_oauth_"+id.replace("acc_",""),razorpay_account_id:id,expires_in:86400,token_type:"Bearer"};}
 async exchange(_code:string){return this.token();}
 async refresh(value:string){this.refreshes++;return this.token(value.replace("refresh-credential-",""));}
 async revoke(_token:string){if(this.revokeFails)throw new Error("Synthetic unavailable");}
 async account(_token:string,id:string){return this.accounts.get(id)||{id,status:"activated",live:true,hold_funds:false,merchant_detail:{bank_details_verification_status:"verified"}};}
 async product(_token:string,account:string,id:string){return {id,account_id:account,activation_status:"activated",active_configuration:{payment_capture:{mode:"automatic"},payment_methods:{upi:{enabled:true}},settlements:{account_number:"123456789012",ifsc_code:"SYNTH000001"}}};}
 async createOrder(token:string,input:any){this.creates++;const o={...input,currency:"INR",id:"order_"+suffix(),account_id:token.replace("access-credential-",""),status:"created"};this.orders.set(o.id,o);if(this.failCreate)throw new Error("Synthetic timeout after provider commit");return o;}
 async findOrder(token:string,reference:string){return [...this.orders.values()].find(o=>o.receipt===reference&&o.account_id===token.replace("access-credential-",""))||null;}
 async order(token:string,id:string){const o=this.orders.get(id);assert.equal(o.account_id,token.replace("access-credential-",""));return o;}
 async payments(_token:string,id:string){return this.pays.get(id)||[];}
 async refunds(_token:string,id:string){return this.refundList.get(id)||[];}
 async settlement(_token:string,id:string){return this.settles.get(id);}
 async recon(){return this.rows;}
 capture(order:any){const p={id:"pay_"+suffix(),order_id:order.providerOrderId,amount:order.amountPaise,currency:"INR",status:"captured",captured:true,method:"upi",amount_refunded:0,created_at:Math.floor(Date.now()/1000)};this.pays.set(order.providerOrderId,[p]);return p;}
}
async function owner(provider=new Provider(),connect=true){
 const account=await registerEmail(`${suffix()}@example.test`,"Synthetic private password 123!");await saveProfile(account.id,{fullName:"Synthetic PG Owner",intent:"OWNER"});
 const setup=await createProperty(account.id,{name:"Synthetic PG",city:"Pune",key:crypto.randomUUID()});
 await prisma.pgSubscription.create({data:{organisationId:setup.organisationId,creationReference:suffix(),verifiedAt:new Date(),payments:{create:{providerInvoiceId:suffix(),providerPaymentId:"pay_fee_"+suffix(),amountPaise:24900,taxPaise:0,currency:"INR",status:"CAPTURED",receiptNumber:suffix(),paidAt:new Date(),periodStart:new Date(Date.now()-10000),periodEnd:new Date(Date.now()+30*86400000)}}}});
 const pair=await issueSession(account),sid=platformClaims(pair.accessToken).sid!;
 const start=await startConnection(account.id,setup.organisationId,sid),state=new URL(start.url).searchParams.get("state")!;
 if(connect){await finishConnection(state,"synthetic-once-code",false,provider);const auth=await prisma.pgOwnerAuthorization.findFirstOrThrow({where:{merchant:{organisationId:setup.organisationId},current:true}});await prisma.pgOwnerAuthorization.update({where:{id:auth.id},data:{productId:"acc_prd_"+suffix()}});await refreshConnection(auth.id,provider);}
 const auth=await prisma.pgOwnerAuthorization.findFirst({where:{merchant:{organisationId:setup.organisationId},current:true}});
 return {account,setup,pair,sid,state,auth,provider};
}
async function resident(o:Awaited<ReturnType<typeof owner>>,amount=800000){
 const account=await registerEmail(`${suffix()}@example.test`,"Synthetic resident password 123!");const actor=await prisma.user.create({data:{role:"STUDENT",fullName:"Synthetic Resident"}});
 const student=await prisma.student.create({data:{propertyId:o.setup.propertyId,userId:actor.id,mobile:"9"+String(Math.floor(Math.random()*1e9)).padStart(9,"0"),joiningDate:new Date(),monthlyRentPaise:amount}});
 const membership=await prisma.pgMembership.create({data:{accountId:account.id,organisationId:o.setup.organisationId,propertyId:o.setup.propertyId,role:"RESIDENT",actorUserId:actor.id}});
 const invoice=await prisma.rentInvoice.create({data:{propertyId:o.setup.propertyId,studentId:student.id,year:2026,month:11,dueDate:new Date(),rentPaise:amount,totalPaise:amount}});return {account,membership,invoice};
}
const event=async(o:Awaited<ReturnType<typeof owner>>,type:string,payload:any={},key=suffix())=>{
 const body=Buffer.from(JSON.stringify({account_id:o.auth!.providerAccountId,event:type,created_at:Math.floor(Date.now()/1000),payload}));const signature=crypto.createHmac("sha256",process.env.RAZORPAY_OWNER_WEBHOOK_SECRET!).update(body).digest("hex");await receiveOwnerWebhook(body,signature,key);return {body,signature,key};
};
test("owner tokens use authenticated encryption bound to the exact connection; test keys are independent",()=>{
 const value=seal("private-synthetic-token","connection-A");assert.ok(!value.includes("private-synthetic-token"));assert.equal(unseal(value,"connection-A"),"private-synthetic-token");assert.throws(()=>unseal(value,"connection-B"));
 assert.equal(mapAccount({status:"activated",live:true,hold_funds:false,merchant_detail:{bank_details_verification_status:"initiated"}}).settlementReady,false);
 assert.equal(mapAccount({status:"created"}).status,"KYC_PENDING");assert.equal(mapAccount({status:"under_review"}).status,"UNDER_REVIEW");assert.equal(mapAccount({status:"needs_clarification"}).status,"ACTION_REQUIRED");assert.equal(mapAccount({status:"rejected"}).status,"REJECTED");assert.equal(mapAccount({status:"suspended"}).status,"SUSPENDED");assert.equal(mapAccount({status:"unknown-future-value"}).paymentEnabled,false);
});
test("feature off and ordinary gateway credentials never activate onboarding",async()=>{
 const o=await owner();process.env.RAZORPAY_OWNER_MERCHANT_ONBOARDING_ENABLED="false";
 try{assert.equal((await merchantView(o.account.id,o.setup.organisationId)).collectionEnabled,false);await assert.rejects(()=>startConnection(o.account.id,o.setup.organisationId,o.sid),{code:"OWNER_PAYMENTS_APPROVAL_PENDING"});}finally{process.env.RAZORPAY_OWNER_MERCHANT_ONBOARDING_ENABLED="true";}
});
test("OAuth state is single-use, session-bound, expiring and never activates from a form alone",async()=>{
 const o=await owner(new Provider(),false);assert.equal((await merchantView(o.account.id,o.setup.organisationId)).status,"ONBOARDING_STARTED");
 await finishConnection(o.state,"synthetic-code",false,o.provider);assert.equal((await merchantView(o.account.id,o.setup.organisationId)).collectionEnabled,false);
 await assert.rejects(()=>finishConnection(o.state,"synthetic-code",false,o.provider),{code:"OAUTH_STATE_EXPIRED"});
 const again=await startConnection(o.account.id,o.setup.organisationId,o.sid);await prisma.pgSession.update({where:{id:o.sid},data:{revokedAt:new Date()}});
 await assert.rejects(()=>finishConnection(new URL(again.url).searchParams.get("state")!,"synthetic-code",false,o.provider),{code:"SESSION_INVALID"});
});
test("independent owners cannot connect one merchant twice or connect the PGOne fee merchant",async()=>{
 const a=await owner(),b=await owner(new Provider(),false);b.provider.next=a.auth!.providerAccountId;
 await assert.rejects(()=>finishConnection(b.state,"synthetic-code",false,b.provider),{code:"OWNER_MERCHANT_ALREADY_CONNECTED"});
 const c=await owner(new Provider(),false);c.provider.next=process.env.PGONE_SUBSCRIPTION_MERCHANT_ACCOUNT_ID!;
 await assert.rejects(()=>finishConnection(c.state,"synthetic-code",false,c.provider),{code:"PLATFORM_MERCHANT_FORBIDDEN"});
 await assert.rejects(()=>merchantView(b.account.id,a.setup.organisationId),{code:"FORBIDDEN"});
});
test("merchant KYC, payment capability and settlement hold all fail closed",async()=>{
 const o=await owner(),r=await resident(o);o.provider.accounts.set(o.auth!.providerAccountId,{id:o.auth!.providerAccountId,status:"activated",live:true,hold_funds:true});
 await assert.rejects(()=>createRentOrder(r.account.id,r.membership.id,r.invoice.id,suffix()+suffix(),o.provider),{code:"OWNER_MERCHANT_NOT_READY"});
 assert.equal((await merchantView(o.account.id,o.setup.organisationId)).collectionEnabled,false);assert.equal(o.provider.creates,0);
 o.provider.accounts.set(o.auth!.providerAccountId,{id:o.auth!.providerAccountId,status:"suspended",live:false,hold_funds:true});await refreshConnection(o.auth!.id,o.provider);assert.equal((await merchantView(o.account.id,o.setup.organisationId)).status,"SUSPENDED");
});
test("two owners route separately, concurrent creates reserve once, and wrong residents are rejected",async()=>{
 const a=await owner(),b=await owner(),ra=await resident(a),rb=await resident(b);
 const [one,two]=await Promise.all([createRentOrder(ra.account.id,ra.membership.id,ra.invoice.id,suffix()+suffix(),a.provider),createRentOrder(ra.account.id,ra.membership.id,ra.invoice.id,suffix()+suffix(),a.provider)]);
 assert.equal(one.orderId,two.orderId);assert.equal(a.provider.creates,1);
 await createRentOrder(rb.account.id,rb.membership.id,rb.invoice.id,suffix()+suffix(),b.provider);
 assert.notEqual([...a.provider.orders.values()][0].account_id,[...b.provider.orders.values()][0].account_id);
 await assert.rejects(()=>createRentOrder(ra.account.id,ra.membership.id,rb.invoice.id,suffix()+suffix(),a.provider),{code:"INVOICE_NOT_FOUND"});
 await assert.rejects(()=>checkoutSession(rb.account.id,rb.membership.id,rb.invoice.id,one.orderId,b.provider),{code:"OWNER_RENT_ORDER_NOT_FOUND"});
});
test("uncertain creation recovers the same owner receipt and never creates a replacement order",async()=>{
 const o=await owner(),r=await resident(o);o.provider.failCreate=true;
 await assert.rejects(()=>createRentOrder(r.account.id,r.membership.id,r.invoice.id,suffix()+suffix(),o.provider));
 const order=await prisma.pgOwnerRentOrder.findFirstOrThrow({where:{invoiceId:r.invoice.id}});assert.equal(order.status,"CREATION_UNCERTAIN");
 await reconcileRentOrder(order.id,o.provider);const recovered=await prisma.pgOwnerRentOrder.findUniqueOrThrow({where:{id:order.id}});assert.ok(recovered.providerOrderId);assert.equal(o.provider.creates,1);
 await createRentOrder(r.account.id,r.membership.id,r.invoice.id,suffix()+suffix(),o.provider);assert.equal(o.provider.creates,1);
});
test("authorized/pending payments block resubmission; failed checkout can reuse the reconciled order",async()=>{
 const o=await owner(),r=await resident(o),ref=await createRentOrder(r.account.id,r.membership.id,r.invoice.id,suffix()+suffix(),o.provider),order=await prisma.pgOwnerRentOrder.findUniqueOrThrow({where:{id:ref.orderId}});
 const p={id:"pay_"+suffix(),order_id:order.providerOrderId,amount:order.amountPaise,currency:"INR",status:"authorized",captured:false,method:"upi"};o.provider.pays.set(order.providerOrderId!,[p]);
 await assert.rejects(()=>checkoutSession(r.account.id,r.membership.id,r.invoice.id,order.id,o.provider),{code:"OWNER_PAYMENT_PENDING"});assert.equal((await prisma.rentInvoice.findUniqueOrThrow({where:{id:r.invoice.id}})).paidPaise,0);
 p.status="failed";const checkout=await checkoutSession(r.account.id,r.membership.id,r.invoice.id,order.id,o.provider);assert.equal(checkout.providerOrderId,order.providerOrderId);assert.equal(o.provider.creates,1);
});
test("captured rent posts one receipt exactly once without renewing the separate software fee",async()=>{
 const o=await owner(),r=await resident(o),ref=await createRentOrder(r.account.id,r.membership.id,r.invoice.id,suffix()+suffix(),o.provider),order=await prisma.pgOwnerRentOrder.findUniqueOrThrow({where:{id:ref.orderId}});
 o.provider.capture(order);const fees=await prisma.pgBillingPayment.count(),plans=await prisma.pgPlanReceipt.count();
 await Promise.all([reconcileRentOrder(order.id,o.provider),reconcileRentOrder(order.id,o.provider)]);
 assert.equal(await prisma.payment.count({where:{invoiceId:r.invoice.id}}),1);assert.equal((await prisma.rentInvoice.findUniqueOrThrow({where:{id:r.invoice.id}})).paidPaise,r.invoice.totalPaise);
 const view=await residentStatus(r.account.id,r.membership.id,r.invoice.id);assert.equal(view.receipt?.amountPaise,r.invoice.totalPaise);assert.deepEqual(view.settlement,[]);
 assert.equal(await prisma.pgBillingPayment.count(),fees);assert.equal(await prisma.pgPlanReceipt.count(),plans);assert.equal(await entitlement(o.setup.organisationId),true);
});
test("wrong merchant, wrong amount and changed invoice never receive a paid credit",async()=>{
 const o=await owner(),r=await resident(o),ref=await createRentOrder(r.account.id,r.membership.id,r.invoice.id,suffix()+suffix(),o.provider),order=await prisma.pgOwnerRentOrder.findUniqueOrThrow({where:{id:ref.orderId}}),p=o.provider.capture(order);
 p.account_id="acc_WrongMerchant";await assert.rejects(()=>reconcileRentOrder(order.id,o.provider),{code:"OWNER_PAYMENT_MISMATCH"});delete p.account_id;
 p.amount++;await assert.rejects(()=>reconcileRentOrder(order.id,o.provider),{code:"OWNER_PAYMENT_MISMATCH"});p.amount--;
 await prisma.rentInvoice.update({where:{id:r.invoice.id},data:{totalPaise:{increment:100}}});await assert.rejects(()=>reconcileRentOrder(order.id,o.provider),{code:"OWNER_INVOICE_REVIEW_REQUIRED"});assert.equal(await prisma.payment.count({where:{invoiceId:r.invoice.id}}),0);
});
test("processed partial/full refunds unwind net rent once and preserve the original receipt",async()=>{
 const o=await owner(),r=await resident(o),ref=await createRentOrder(r.account.id,r.membership.id,r.invoice.id,suffix()+suffix(),o.provider),order=await prisma.pgOwnerRentOrder.findUniqueOrThrow({where:{id:ref.orderId}}),p=o.provider.capture(order);await reconcileRentOrder(order.id,o.provider);
 const refund={id:"rfnd_"+suffix(),payment_id:p.id,amount:10000,currency:"INR",status:"pending"};o.provider.refundList.set(p.id,[refund]);await reconcileRentOrder(order.id,o.provider);assert.equal((await prisma.rentInvoice.findUniqueOrThrow({where:{id:r.invoice.id}})).paidPaise,r.invoice.totalPaise);
 refund.status="processed";p.amount_refunded=10000;await reconcileRentOrder(order.id,o.provider);await reconcileRentOrder(order.id,o.provider);assert.equal((await prisma.rentInvoice.findUniqueOrThrow({where:{id:r.invoice.id}})).paidPaise,r.invoice.totalPaise-10000);
 const full={...refund,id:"rfnd_"+suffix(),amount:r.invoice.totalPaise-10000};o.provider.refundList.set(p.id,[refund,full]);p.amount_refunded=r.invoice.totalPaise;p.status="refunded";await reconcileRentOrder(order.id,o.provider);
 const result=await prisma.rentInvoice.findUniqueOrThrow({where:{id:r.invoice.id}});assert.equal(result.paidPaise,0);assert.equal(result.status,"DUE");assert.equal((await prisma.payment.findFirstOrThrow({where:{invoiceId:r.invoice.id}})).amountPaise,r.invoice.totalPaise);
});
test("signed webhook inbox deduplicates, rejects tampering and discards sensitive KYC payloads",async()=>{
 const o=await owner();const e=await event(o,"account.activated",{account:{entity:{id:o.auth!.providerAccountId,merchant_detail:{bank_details_verification_status:"verified",promoter_pan:"PAN-DO-NOT-STORE",bank_account_number:"123456789012"}}}});
 await receiveOwnerWebhook(e.body,e.signature,e.key);assert.equal(await prisma.pgOwnerWebhookInbox.count({where:{eventKey:e.key}}),1);
 await assert.rejects(()=>receiveOwnerWebhook(e.body,"a".repeat(64),suffix()),{code:"OWNER_WEBHOOK_SIGNATURE_INVALID"});
 const stored=JSON.stringify((await prisma.pgOwnerWebhookInbox.findFirstOrThrow({where:{eventKey:e.key}})).payload);assert.ok(!stored.includes("PAN-DO-NOT-STORE")&&!stored.includes("123456789012"));
 await drainOwnerEvents(o.provider);
});
test("delayed/duplicate capture webhooks reconcile provider state once",async()=>{
 const o=await owner(),r=await resident(o),ref=await createRentOrder(r.account.id,r.membership.id,r.invoice.id,suffix()+suffix(),o.provider),order=await prisma.pgOwnerRentOrder.findUniqueOrThrow({where:{id:ref.orderId}}),p=o.provider.capture(order);
 await event(o,"payment.captured",{payment:{entity:p}});await event(o,"payment.captured",{payment:{entity:p}});await drainOwnerEvents(o.provider);await drainOwnerEvents(o.provider);assert.equal(await prisma.payment.count({where:{invoiceId:r.invoice.id}}),1);
});
test("capture is separate from settlement; only exact merchant recon binds bank credit",async()=>{
 const o=await owner(),r=await resident(o),ref=await createRentOrder(r.account.id,r.membership.id,r.invoice.id,suffix()+suffix(),o.provider),order=await prisma.pgOwnerRentOrder.findUniqueOrThrow({where:{id:ref.orderId}}),p=o.provider.capture(order);await reconcileRentOrder(order.id,o.provider);
 const s={id:"setl_"+suffix(),entity:"settlement",account_id:o.auth!.providerAccountId,status:"failed",amount:p.amount,currency:"INR",created_at:Math.floor(Date.now()/1000),utr:null};o.provider.settles.set(s.id,s);
 await reconcileSettlement(o.auth!.id,s.id,o.provider);assert.deepEqual((await residentStatus(r.account.id,r.membership.id,r.invoice.id)).settlement,[]);
 s.status="processed";s.utr="SYNTHETIC-UTR" as any;o.provider.rows=[{entity_id:p.id,type:"payment",settled:true,settlement_id:s.id,currency:"INR",amount:p.amount,credit:p.amount-100,fee:100,tax:0,settled_at:s.created_at}];
 await reconcileSettlementDay(o.auth!.id,{year:2026,month:11,day:11},o.provider);assert.equal((await residentStatus(r.account.id,r.membership.id,r.invoice.id)).settlement[0]?.status,"COMPLETED");
 const dashboard=await collectionDashboard(o.account.id,o.setup.organisationId,2026,11);assert.equal(dashboard.totalCollectedPaise,p.amount);assert.equal(dashboard.outstandingPaise,0);
});
test("new open orders block legacy/direct/manual duplicate channels at the database boundary",async()=>{
 const o=await owner(),r=await resident(o);await createRentOrder(r.account.id,r.membership.id,r.invoice.id,suffix()+suffix(),o.provider);
 await assert.rejects(()=>prisma.paymentAttempt.create({data:{invoiceId:r.invoice.id,studentId:r.invoice.studentId,providerOrderId:"order_"+suffix(),amountPaise:r.invoice.totalPaise}}));
 await assert.rejects(()=>prisma.payment.create({data:{invoiceId:r.invoice.id,studentId:r.invoice.studentId,propertyId:r.invoice.propertyId,amountPaise:r.invoice.totalPaise,source:"MANUAL",method:"BANK_TRANSFER",receiptNumber:suffix(),paidAt:new Date()}}));
});
test("disconnect stops collection before a failed revoke; tokens refresh without exposing credentials",async()=>{
 const o=await owner();await prisma.pgOwnerAuthorization.update({where:{id:o.auth!.id},data:{expiresAt:new Date(Date.now()-1000)}});const token=await accessToken(o.auth!.id,o.provider);assert.ok(token.startsWith("access-credential-"));assert.equal(o.provider.refreshes,1);
 o.provider.revokeFails=true;await assert.rejects(()=>disconnect(o.account.id,o.setup.organisationId,"Synthetic private password 123!",o.provider),{code:"OWNER_REVOKE_PENDING"});
 const view=await merchantView(o.account.id,o.setup.organisationId);assert.equal(view.status,"DISABLED");assert.equal(view.collectionEnabled,false);assert.ok(!JSON.stringify(view).includes("credential"));
});
