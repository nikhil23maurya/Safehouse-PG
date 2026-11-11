import {ownerAtomic as atomic} from "./transaction.js";
import {prisma} from "../../db.js";
import {assert,AppError} from "../../errors.js";
import {audit} from "../service.js";
import {ownerPaymentConfig} from "./config.js";
import {digest,signed} from "./crypto.js";
import {refreshConnection} from "./merchant.js";
import {reconcileRentOrder} from "./rent.js";
import {reconcileSettlement,reconcileSettlementDay} from "./settlements.js";
import {razorpayOwnerProvider,type OwnerProvider} from "./provider.js";

const events=new Set(["account.activated","account.under_review","account.needs_clarification","account.suspended","account.rejected","account.app.authorization_revoked","product.payment_gateway.activated","payment.authorized","payment.captured","payment.failed","order.paid","refund.created","refund.processed","refund.failed","settlement.processed"]);
export async function receiveOwnerWebhook(body:Buffer,signature:string|undefined,eventId:string|undefined) {
 const cfg=ownerPaymentConfig();assert(cfg.RAZORPAY_OWNER_WEBHOOK_SECRET,503,"OWNER_WEBHOOK_NOT_CONFIGURED","Owner payment webhooks are not configured.");
 assert(signed(body,signature,cfg.RAZORPAY_OWNER_WEBHOOK_SECRET),400,"OWNER_WEBHOOK_SIGNATURE_INVALID","Invalid webhook signature.");
 let event:any;try{event=JSON.parse(body.toString("utf8"));}catch{throw new AppError(400,"OWNER_WEBHOOK_INVALID","Invalid webhook payload.");}
 assert(/^acc_[A-Za-z0-9]+$/.test(event.account_id||"")&&typeof event.event==="string",400,"OWNER_WEBHOOK_INVALID","Missing webhook merchant identity.");
 assert(event.account_id!==cfg.PGONE_SUBSCRIPTION_MERCHANT_ACCOUNT_ID,400,"PLATFORM_MERCHANT_FORBIDDEN","Software-fee events cannot be processed as resident rent.");
 if(!events.has(event.event))return {accepted:true,ignored:true};
 assert(Number.isInteger(event.created_at)&&event.created_at>0,400,"OWNER_WEBHOOK_INVALID","Missing provider event time.");
 const product=event.payload?.merchant_product?.entity;
 const p=event.payload?.payment?.entity,r=event.payload?.refund?.entity,s=event.payload?.settlement?.entity,o=event.payload?.order?.entity;
 // Store references only. Provider account payloads can include PAN, full bank
 // numbers and KYC documents; none are retained in the inbox or audit log.
 const bankState=event.payload?.account?.entity?.merchant_detail?.bank_details_verification_status;
 const payload={createdAt:event.created_at,paymentId:p?.id||r?.payment_id||null,providerOrderId:p?.order_id||o?.id||null,settlementId:s?.id||null,productId:product?.id||null,productMerchant:product?.merchant_id||null,bankState:["verified","initiated","pending","failed"].includes(bankState)?bankState:null};
 const hash=digest(body);const key=eventId&&/^[A-Za-z0-9_-]{1,160}$/.test(eventId)?eventId:hash;
 await atomic(async tx=>{const prior=await tx.pgOwnerWebhookInbox.findUnique({where:{mode_eventKey:{mode:cfg.RAZORPAY_OWNER_MODE,eventKey:key}}});
  if(prior){assert(prior.payloadHash===hash,409,"OWNER_WEBHOOK_EVENT_CONFLICT","Webhook identifier was reused with different content.");return;}
  await tx.pgOwnerWebhookInbox.create({data:{mode:cfg.RAZORPAY_OWNER_MODE,eventKey:key,payloadHash:hash,eventType:event.event,providerAccountId:event.account_id,payload}});
 });return {accepted:true};
}
export async function processOwnerEvent(id:string,provider:OwnerProvider=razorpayOwnerProvider) {
 const event=await prisma.pgOwnerWebhookInbox.findUniqueOrThrow({where:{id}});const p=event.payload as any;
 const auth=await prisma.pgOwnerAuthorization.findUnique({where:{mode_providerAccountId:{mode:event.mode,providerAccountId:event.providerAccountId}},include:{merchant:true}});
 assert(auth,503,"OWNER_CONNECTION_NOT_SEEN","Merchant authorization is not available yet. Retain this event for retry.");
 if(event.eventType==="account.app.authorization_revoked"){
  if(p.createdAt*1000<auth.authorizedAt.getTime()-1000)return;
  await atomic(async tx=>{await tx.pgOwnerAuthorization.update({where:{id:auth.id},data:{current:false,status:"DISABLED",paymentEnabled:false,settlementReady:false,accessCipher:null,refreshCipher:null,publicToken:null,revision:{increment:1}}});await audit(tx,null,auth.merchant.organisationId,"OWNER_MERCHANT_AUTHORIZATION_REVOKED",auth.id);});return;
 }
 if(event.eventType.startsWith("account.")||event.eventType==="product.payment_gateway.activated"){
  if(p.bankState&&(!auth.accountEventAt||p.createdAt*1000>=auth.accountEventAt.getTime()))await prisma.pgOwnerAuthorization.update({where:{id:auth.id},data:{bankStatus:p.bankState==="verified"?"VERIFIED":"PENDING",accountEventAt:new Date(p.createdAt*1000),settlementReady:false,paymentEnabled:false,revision:{increment:1}}});
  if(p.productId){assert(p.productMerchant===auth.providerAccountId&&/^acc_prd_[A-Za-z0-9]+$/.test(p.productId),409,"OWNER_PRODUCT_MISMATCH","Wrong merchant payment product.");await prisma.pgOwnerAuthorization.update({where:{id:auth.id},data:{productId:p.productId}});}
  if(auth.current)await refreshConnection(auth.id,provider);return;
 }
 if(p.settlementId){
  const settlement=await reconcileSettlement(auth.id,p.settlementId,provider);
  const date=new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Kolkata",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date(settlement.created_at*1000)).split("-").map(Number);
  assert(date.length===3&&date.every(Number.isInteger),409,"OWNER_SETTLEMENT_DATE_INVALID","Settlement date is not confirmed.");
  await reconcileSettlementDay(auth.id,{year:date[0]!,month:date[1]!,day:date[2]!},provider);return;
 }
 const order=await prisma.pgOwnerRentOrder.findFirst({where:{authorizationId:auth.id,...(p.providerOrderId?{providerOrderId:p.providerOrderId}:{application:{providerPaymentId:p.paymentId||"missing"}})}});
 assert(order,409,"OWNER_WEBHOOK_PAYMENT_UNBOUND","The payment event does not match a rent order for this merchant.");
 await reconcileRentOrder(order.id,provider);
}
export async function drainOwnerEvents(provider:OwnerProvider=razorpayOwnerProvider) {
 const now=new Date();const rows=await prisma.pgOwnerWebhookInbox.findMany({where:{mode:ownerPaymentConfig().RAZORPAY_OWNER_MODE,status:"PENDING",nextAttemptAt:{lte:now},OR:[{leaseUntil:null},{leaseUntil:{lt:now}}]},orderBy:{createdAt:"asc"},take:10});
 for(const row of rows){
  const lease=new Date(Date.now()+120_000),claimed=await prisma.pgOwnerWebhookInbox.updateMany({where:{id:row.id,status:"PENDING",OR:[{leaseUntil:null},{leaseUntil:{lt:now}}]},data:{leaseUntil:lease}});if(!claimed.count)continue;
  try{await processOwnerEvent(row.id,provider);await prisma.pgOwnerWebhookInbox.updateMany({where:{id:row.id,leaseUntil:lease},data:{status:"PROCESSED",processedAt:new Date(),leaseUntil:null}});}
  catch(error:any){const review=error instanceof AppError&&error.statusCode===409;
   await prisma.pgOwnerWebhookInbox.updateMany({where:{id:row.id,leaseUntil:lease},data:{status:review?"REVIEW_REQUIRED":"PENDING",attempts:{increment:1},lastErrorCode:typeof error.code==="string"?error.code.slice(0,100):"OWNER_RECONCILIATION_RETRY",nextAttemptAt:new Date(Date.now()+Math.min(3600,2**Math.min(row.attempts+1,11))*1000),leaseUntil:null}});
   if(review){const payload=row.payload as any;await prisma.pgOwnerRentOrder.updateMany({where:{authorization:{mode:row.mode,providerAccountId:row.providerAccountId},...(payload.providerOrderId?{providerOrderId:payload.providerOrderId}:{application:{providerPaymentId:payload.paymentId||"missing"}})},data:{status:"REVIEW_REQUIRED",lastErrorCode:typeof error.code==="string"?error.code.slice(0,100):"OWNER_REVIEW_REQUIRED"}});}
  }
 }
}
let worker:ReturnType<typeof setInterval>|null=null;
export async function reconcileOwnerHistory(provider:OwnerProvider=razorpayOwnerProvider) {
 const now=new Date();
 const auth=await prisma.pgOwnerAuthorization.findFirst({where:{mode:ownerPaymentConfig().RAZORPAY_OWNER_MODE,current:true,accessCipher:{not:null},orders:{some:{application:{isNot:null}}},OR:[{lastReconciledAt:null},{lastReconciledAt:{lt:new Date(Date.now()-10*60_000)}}],AND:[{OR:[{reconciliationLeaseUntil:null},{reconciliationLeaseUntil:{lt:now}}]}]},orderBy:{lastReconciledAt:{sort:"asc",nulls:"first"}}});
 if(!auth)return;
 const lease=new Date(Date.now()+180_000),claimed=await prisma.pgOwnerAuthorization.updateMany({where:{id:auth.id,OR:[{reconciliationLeaseUntil:null},{reconciliationLeaseUntil:{lt:now}}]},data:{reconciliationLeaseUntil:lease}});if(!claimed.count)return;
 try{
  // Round-robin all historical captures, not only recent ones: late refunds must
  // remain recoverable even when the provider webhook was never delivered.
  const orders=await prisma.pgOwnerRentOrder.findMany({where:{authorizationId:auth.id,application:{isNot:null}},orderBy:{lastCheckedAt:{sort:"asc",nulls:"first"}},take:5});
  for(const order of orders)await reconcileRentOrder(order.id,provider);
  for(let offset=0;offset<3;offset++){
   const day=new Date(Date.now()-offset*86400000),parts=new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Kolkata",year:"numeric",month:"2-digit",day:"2-digit"}).format(day).split("-").map(Number);
   await reconcileSettlementDay(auth.id,{year:parts[0]!,month:parts[1]!,day:parts[2]!},provider);
  }
  await prisma.pgOwnerAuthorization.updateMany({where:{id:auth.id,reconciliationLeaseUntil:lease},data:{lastReconciledAt:new Date(),reconciliationLeaseUntil:null}});
 }catch{await prisma.pgOwnerAuthorization.updateMany({where:{id:auth.id,reconciliationLeaseUntil:lease},data:{lastReconciledAt:new Date(Date.now()-8*60_000),reconciliationLeaseUntil:null}});}
}
export function startOwnerPaymentWorker() {
 if(worker||process.env.NODE_ENV==="test")return;
 const cfg=ownerPaymentConfig();
 console.log("PGONE_OWNER_PAYMENTS_PREFLIGHT",JSON.stringify({enabled:cfg.enabled,configurationAvailable:cfg.configured,configurationValid:cfg.configurationValid,mode:cfg.RAZORPAY_OWNER_MODE,liveProviderVerified:false}));
 let running=false;
 worker=setInterval(async()=>{if(running)return;running=true;try{
  await drainOwnerEvents();
  const orders=await prisma.pgOwnerRentOrder.findMany({where:{authorization:{mode:ownerPaymentConfig().RAZORPAY_OWNER_MODE},open:true,status:{not:"REVIEW_REQUIRED"},OR:[{lastCheckedAt:null},{lastCheckedAt:{lt:new Date(Date.now()-60_000)}}]},orderBy:{updatedAt:"asc"},take:3});
  for(const order of orders)try{await reconcileRentOrder(order.id);}catch{await prisma.pgOwnerRentOrder.update({where:{id:order.id},data:{lastCheckedAt:new Date()}});}
  await reconcileOwnerHistory();
 }catch{/* Persistent inbox retains work. Never log tokens or provider payloads. */}finally{running=false;}},15000);worker.unref();
}
