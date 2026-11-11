import {ownerAtomic as atomic} from "./transaction.js";
import crypto from "node:crypto";
import {prisma} from "../../db.js";
import {assert,AppError} from "../../errors.js";
import {receiptNumber} from "../../utils.js";
import {audit} from "../service.js";
import {ownerPaymentConfig,requireOwnerPayments} from "./config.js";
import {accessToken,canCollect,refreshConnection} from "./merchant.js";
import {digest} from "./crypto.js";
import {razorpayOwnerProvider,type OwnerProvider} from "./provider.js";

export const invoiceSnapshot=(i:any)=>digest(JSON.stringify([i.id,i.propertyId,i.studentId,i.year,i.month,i.totalPaise,i.paidPaise,i.status,i.rentPaise,i.electricityPaise,i.lateFeePaise,i.otherChargesPaise,i.discountPaise]));
async function residency(accountId:string,membershipId:string,invoiceId:string) {
 const m=await prisma.pgMembership.findFirst({where:{id:membershipId,accountId,status:"ACTIVE",role:"RESIDENT",account:{status:"ACTIVE"}},include:{property:true,organisation:true}});
 assert(m?.actorUserId&&m.property.ownerId===m.organisation.legacyOwnerId,403,"RESIDENT_REQUIRED","Select your active residency.");
 const student=await prisma.student.findFirst({where:{userId:m.actorUserId,propertyId:m.propertyId,status:"ACTIVE"}});
 assert(student,403,"RESIDENT_INACTIVE","This residency is not active.");
 const invoice=await prisma.rentInvoice.findFirst({where:{id:invoiceId,studentId:student.id,propertyId:m.propertyId}});
 assert(invoice,404,"INVOICE_NOT_FOUND","This invoice does not belong to your residency.");return {m,student,invoice};
}
export async function residentStatus(accountId:string,membershipId:string,invoiceId:string) {
 const {m,invoice}=await residency(accountId,membershipId,invoiceId),c=ownerPaymentConfig();
 const [auth,order]=await Promise.all([
  prisma.pgOwnerAuthorization.findFirst({where:{merchant:{organisationId:m.organisationId},mode:c.RAZORPAY_OWNER_MODE,current:true}}),
  prisma.pgOwnerRentOrder.findFirst({where:{invoiceId,propertyId:m.propertyId,accountId},orderBy:{createdAt:"desc"},include:{application:{include:{refunds:true,settlementItems:{include:{settlement:true}}}}}}),
 ]);
 const application=order?.application;
 return {invoice:{id:invoice.id,pgName:m.property.name,year:invoice.year,month:invoice.month,dueDate:invoice.dueDate,totalPaise:invoice.totalPaise,remainingPaise:Math.max(0,invoice.totalPaise-invoice.paidPaise),status:invoice.status},
  available:c.enabled&&c.ledgerAllowed&&canCollect(auth),mode:c.RAZORPAY_OWNER_MODE,
  order:order?{id:order.id,status:order.status,open:order.open,amountPaise:order.amountPaise,lastErrorCode:order.lastErrorCode,providerOrderId:order.providerOrderId}:null,
  receipt:application?{id:application.paymentId,reference:application.providerPaymentId,amountPaise:application.amountPaise,refundedPaise:application.refundedPaise,status:application.status,paidAt:application.paidAt}:null,
  settlement:application?.settlementItems.map(item=>({status:item.settlement.status,settledAt:item.settlement.settledAt}))||[],
  requiredAction:!c.enabled||!canCollect(auth)?"Your owner must activate their approved merchant account. Direct UPI requires separate bank confirmation.":null};
}
function validateOrder(remote:any,order:any,auth:any) {
 assert(/^order_[A-Za-z0-9]+$/.test(remote.id||"")&&(!order.providerOrderId||remote.id===order.providerOrderId)&&remote.amount===order.amountPaise&&remote.currency==="INR"&&remote.receipt===order.reference&&remote.notes?.pgRentOrderId===order.id&&remote.notes?.organisationId===order.organisationId&&(!remote.account_id||remote.account_id===auth.providerAccountId),409,"OWNER_ORDER_MISMATCH","Razorpay order details do not match this owner's invoice. Do not pay again.");
}
export async function createRentOrder(accountId:string,membershipId:string,invoiceId:string,requestKey:string,provider:OwnerProvider=razorpayOwnerProvider) {
 const cfg=requireOwnerPayments(),{m,invoice,student}=await residency(accountId,membershipId,invoiceId);
 assert(cfg.ledgerAllowed,503,"TEST_RENT_LEDGER_DISABLED","Test-mode captures cannot pay production rent invoices.");
 let auth=await prisma.pgOwnerAuthorization.findFirst({where:{merchant:{organisationId:m.organisationId},mode:cfg.RAZORPAY_OWNER_MODE,current:true}});
 assert(auth,409,"OWNER_MERCHANT_UNAVAILABLE","Your owner has not connected an approved merchant account.");
 auth=await refreshConnection(auth.id,provider);
 assert(canCollect(auth)&&auth.providerAccountId!==cfg.PGONE_SUBSCRIPTION_MERCHANT_ACCOUNT_ID,409,"OWNER_MERCHANT_NOT_READY","Your owner's payment account is not ready for rent collection.");
 const reservation=await atomic(async tx=>{
  await tx.$queryRaw`SELECT id FROM "RentInvoice" WHERE id=${invoice.id} FOR UPDATE`;
  const fresh=await tx.rentInvoice.findUniqueOrThrow({where:{id:invoice.id}});
  assert(await tx.pgMembership.findFirst({where:{id:membershipId,accountId,role:"RESIDENT",status:"ACTIVE",propertyId:m.propertyId,organisationId:m.organisationId,actorUserId:m.actorUserId,account:{status:"ACTIVE"}}}),403,"RESIDENT_INACTIVE","Your residency changed. Refresh before paying.");
  assert(await tx.student.findFirst({where:{id:student.id,propertyId:m.propertyId,status:"ACTIVE"}}),403,"RESIDENT_INACTIVE","This residency is no longer active.");
  const existing=await tx.pgOwnerRentOrder.findFirst({where:{OR:[{accountId,requestKey},{invoiceId,open:true}]}});
  if(existing){assert(existing.accountId===accountId&&existing.invoiceId===invoiceId&&existing.organisationId===m.organisationId,409,"OWNER_RENT_IDEMPOTENCY_CONFLICT","This request belongs to another payment.");return {order:existing,created:false};}
  assert(fresh.status==="DUE"&&fresh.totalPaise-fresh.paidPaise>=100,409,"RENT_NOT_PAYABLE","This invoice has no payable online balance of at least ₹1.");
  assert(!await tx.paymentAttempt.findFirst({where:{invoiceId,status:{in:["CREATED","VERIFIED"]}}})&&!await tx.pgDirectRentClaim.findFirst({where:{invoiceId,status:"PENDING_OWNER_CONFIRMATION"}}),409,"OTHER_RENT_ATTEMPT_PENDING","Reconcile the previous payment or bank transfer before starting another.");
  const current=await tx.pgOwnerAuthorization.findUniqueOrThrow({where:{id:auth!.id}});assert(canCollect(current),409,"OWNER_MERCHANT_NOT_READY","Your owner's payment account changed. Refresh before paying.");
  const order=await tx.pgOwnerRentOrder.create({data:{organisationId:m.organisationId,propertyId:m.propertyId,invoiceId,studentId:student.id,accountId,authorizationId:auth!.id,requestKey,reference:"PGOR"+crypto.randomBytes(16).toString("hex"),amountPaise:fresh.totalPaise-fresh.paidPaise,invoiceSnapshot:invoiceSnapshot(fresh)}});
  await audit(tx,accountId,m.organisationId,"OWNER_RENT_ORDER_RESERVED",order.id,{invoiceId,amountPaise:order.amountPaise,authorizationId:auth!.id});return {order,created:true};
 });
 const order=reservation.order;
 if(!reservation.created)return {orderId:order.id,status:order.status};
 try {
  const token=await accessToken(auth.id,provider),remote=await provider.createOrder(token,{amount:order.amountPaise,receipt:order.reference,notes:{pgRentOrderId:order.id,organisationId:m.organisationId,invoiceId,context:"OWNER_MERCHANT_RENT"}});
  validateOrder(remote,order,auth);
  await prisma.pgOwnerRentOrder.update({where:{id:order.id},data:{providerOrderId:remote.id,status:"CREATED"}});
 }catch(error){await prisma.pgOwnerRentOrder.update({where:{id:order.id},data:{status:"CREATION_UNCERTAIN",lastErrorCode:"PROVIDER_CREATE_UNCERTAIN"}});throw error;}
 return {orderId:order.id,status:"CREATED"};
}
export async function reconcileRentOrder(orderId:string,provider:OwnerProvider=razorpayOwnerProvider) {
 try{return await reconcileRentOrderInternal(orderId,provider);}catch(error){
  if(error instanceof AppError&&error.statusCode===409)await atomic(async tx=>{
   const order=await tx.pgOwnerRentOrder.findUniqueOrThrow({where:{id:orderId}});
   if(order.status!=="REVIEW_REQUIRED")await audit(tx,null,order.organisationId,"OWNER_RENT_REVIEW_REQUIRED",order.id,{reason:error.code});
   await tx.pgOwnerRentOrder.update({where:{id:orderId},data:{status:"REVIEW_REQUIRED",lastErrorCode:error.code,lastCheckedAt:new Date()}});
  });throw error;
 }
}
async function reconcileRentOrderInternal(orderId:string,provider:OwnerProvider) {
 let order=await prisma.pgOwnerRentOrder.findUniqueOrThrow({where:{id:orderId},include:{authorization:true,application:true}});
 const auth=order.authorization,token=await accessToken(auth.id,provider);
 let remote=order.providerOrderId?await provider.order(token,order.providerOrderId):await provider.findOrder(token,order.reference,Math.floor(order.createdAt.getTime()/1000)-60);
 if(!remote){await prisma.pgOwnerRentOrder.update({where:{id:order.id},data:{status:"CREATION_UNCERTAIN",lastCheckedAt:new Date()}});return;}
 validateOrder(remote,order,auth);
 if(!order.providerOrderId)await prisma.pgOwnerRentOrder.update({where:{id:order.id},data:{providerOrderId:remote.id,status:"CREATED"}});
 const payments=await provider.payments(token,remote.id);
 let captured=false,pending=false,failed=false;
 for(const p of payments){
  assert(p.order_id===remote.id&&(!p.account_id||p.account_id===auth.providerAccountId),409,"OWNER_PAYMENT_MISMATCH","The payment merchant or order did not match this invoice.");
  assert(/^pay_[A-Za-z0-9]+$/.test(p.id)&&Number.isInteger(p.amount)&&p.amount===order.amountPaise&&p.currency==="INR",409,"OWNER_PAYMENT_MISMATCH","The payment amount or currency did not match this invoice.");
  const observed=await prisma.pgOwnerPaymentObservation.findUnique({where:{providerPaymentId:p.id}});
  assert(!observed||observed.orderId===order.id,409,"OWNER_PAYMENT_MISMATCH","The payment reference belongs to another rent order.");
  await prisma.pgOwnerPaymentObservation.upsert({where:{providerPaymentId:p.id},create:{orderId:order.id,providerPaymentId:p.id,amountPaise:p.amount,currency:p.currency,status:p.status},update:{status:p.status,observedAt:new Date()}});
  if(p.captured===true&&["captured","refunded"].includes(p.status)){
   assert(p.amount===order.amountPaise&&p.currency==="INR"&&p.method==="upi"&&/^pay_[A-Za-z0-9]+$/.test(p.id),409,"OWNER_CAPTURE_MISMATCH","Captured payment details require an owner review.");
   await applyCapture(order.id,p,await provider.refunds(token,p.id));captured=true;
  } else if(["created","authorized"].includes(p.status))pending=true;
  else if(p.status==="failed")failed=true;
  else pending=true;
 }
 if(!captured)await prisma.pgOwnerRentOrder.update({where:{id:order.id},data:{status:order.status==="REVIEW_REQUIRED"?"REVIEW_REQUIRED":pending||remote.status==="paid"?"AUTHORIZED":failed?"FAILED":"CREATED",lastCheckedAt:new Date()}});
}
export async function applyCapture(orderId:string,payment:any,refunds:any[]) {
 return atomic(async tx=>{
  const order=await tx.pgOwnerRentOrder.findUniqueOrThrow({where:{id:orderId},include:{authorization:{include:{merchant:true}},application:true}});
  assert(order.authorization.mode==="live"||process.env.NODE_ENV==="test",503,"TEST_RENT_LEDGER_DISABLED","Test-mode captures cannot pay production rent invoices.");
  assert(payment.order_id===order.providerOrderId&&payment.amount===order.amountPaise&&payment.currency==="INR"&&payment.method==="upi"&&payment.captured===true&&["captured","refunded"].includes(payment.status),409,"OWNER_CAPTURE_MISMATCH","Captured rent does not match its invoice order.");
  assert(order.authorization.merchant.organisationId===order.organisationId,409,"OWNER_MERCHANT_MISMATCH","The recipient organisation changed.");
  assert(!await tx.pgPlanReceipt.findUnique({where:{providerPaymentId:payment.id}})&&!await tx.pgBillingPayment.findUnique({where:{providerPaymentId:payment.id}}),409,"SOFTWARE_FEE_IS_NOT_RENT","A PGOne fee cannot pay resident rent.");
  const refundIds=new Set<string>();let refunded=0;
  for(const r of refunds){assert(/^rfnd_[A-Za-z0-9]+$/.test(r.id)&&!refundIds.has(r.id)&&r.payment_id===payment.id&&r.currency==="INR"&&Number.isInteger(r.amount)&&r.amount>0&&["pending","processed","failed"].includes(r.status),409,"OWNER_REFUND_MISMATCH","Refund details do not match this rent payment.");refundIds.add(r.id);if(r.status==="processed")refunded+=r.amount;}
  assert(refunded<=payment.amount&&(!Number.isInteger(payment.amount_refunded)||refunded===payment.amount_refunded),409,"OWNER_REFUND_RECONCILIATION_PENDING","Refund confirmation is still being reconciled.");
  await tx.$queryRaw`SELECT id FROM "RentInvoice" WHERE id=${order.invoiceId} FOR UPDATE`;
  const invoice=await tx.rentInvoice.findUniqueOrThrow({where:{id:order.invoiceId}});
  assert(invoice.propertyId===order.propertyId&&invoice.studentId===order.studentId,409,"OWNER_INVOICE_MISMATCH","The rent invoice relationship changed.");
  let applied=order.application;
  if(!applied){
   assert(invoiceSnapshot(invoice)===order.invoiceSnapshot&&invoice.totalPaise-invoice.paidPaise===order.amountPaise,409,"OWNER_INVOICE_REVIEW_REQUIRED","The invoice changed during payment. The owner must reconcile the captured payment; do not pay again.");
   const paidAt=new Date(Number(payment.created_at)*1000);assert(Number.isFinite(paidAt.getTime()),409,"OWNER_PAYMENT_DATE_INVALID","Payment date is not confirmed.");
   const stored=await tx.payment.create({data:{propertyId:order.propertyId,studentId:order.studentId,invoiceId:order.invoiceId,amountPaise:order.amountPaise,source:"RAZORPAY",method:"UPI",providerOrderId:order.providerOrderId,providerPaymentId:payment.id,receiptNumber:receiptNumber(paidAt),paidAt,metadata:{context:"OWNER_MERCHANT_RENT",authorizationId:order.authorizationId,mode:order.authorization.mode}}});
   applied=await tx.pgOwnerRentApplication.create({data:{orderId:order.id,paymentId:stored.id,providerPaymentId:payment.id,amountPaise:order.amountPaise,paidAt}});
  }
  assert(applied.providerPaymentId===payment.id&&refunded>=applied.refundedPaise,409,"OWNER_PAYMENT_REVIEW_REQUIRED","A different capture or inconsistent refund needs reconciliation.");
  const delta=order.application?-(refunded-applied.refundedPaise):order.amountPaise-refunded;
  const paid=invoice.paidPaise+delta;assert(paid>=0&&paid<=invoice.totalPaise,409,"OWNER_RENT_BALANCE_REVIEW","The rent balance requires an owner review.");
  for(const r of refunds){const prior=await tx.pgOwnerRentRefund.findUnique({where:{providerRefundId:r.id}});
   assert(!prior||(prior.applicationId===applied.id&&prior.amountPaise===r.amount&&!(prior.status==="processed"&&r.status!=="processed")),409,"OWNER_REFUND_MISMATCH","An immutable refund reference changed.");
   await tx.pgOwnerRentRefund.upsert({where:{providerRefundId:r.id},create:{applicationId:applied.id,providerRefundId:r.id,amountPaise:r.amount,status:r.status,processedAt:r.status==="processed"?new Date():null},update:{status:r.status,processedAt:r.status==="processed"?(prior?.processedAt||new Date()):null}});
  }
  const status=refunded===order.amountPaise?"REFUNDED":refunded>0?"PARTIALLY_REFUNDED":"CAPTURED";
  await tx.pgOwnerRentApplication.update({where:{id:applied.id},data:{refundedPaise:refunded,status}});
  await tx.rentInvoice.update({where:{id:invoice.id},data:{paidPaise:paid,status:paid>=invoice.totalPaise?"PAID":"DUE"}});
  await tx.pgOwnerRentOrder.update({where:{id:order.id},data:{status,open:false,lastCheckedAt:new Date()}});
  if(!order.application||delta!==0)await audit(tx,null,order.organisationId,delta<0?"OWNER_RENT_REFUND_APPLIED":"OWNER_RENT_CAPTURE_APPLIED",applied.id,{invoiceId:invoice.id,providerPaymentId:payment.id,netAppliedPaise:delta,refundedPaise:refunded});
  return applied;
 });
}
export async function checkoutSession(accountId:string,membershipId:string,invoiceId:string,orderId:string,provider:OwnerProvider=razorpayOwnerProvider) {
 const cfg=requireOwnerPayments(),{m,invoice}=await residency(accountId,membershipId,invoiceId);
 let order=await prisma.pgOwnerRentOrder.findFirst({where:{id:orderId,accountId,invoiceId,propertyId:m.propertyId,organisationId:m.organisationId},include:{authorization:true}});assert(order,404,"OWNER_RENT_ORDER_NOT_FOUND","This payment request does not belong to your residency.");
 await reconcileRentOrder(order.id,provider);
 await refreshConnection(order.authorizationId,provider);
 order=await prisma.pgOwnerRentOrder.findUniqueOrThrow({where:{id:order.id},include:{authorization:true}});
 assert(order.authorization.mode===cfg.RAZORPAY_OWNER_MODE&&canCollect(order.authorization)&&order.authorization.providerAccountId!==cfg.PGONE_SUBSCRIPTION_MERCHANT_ACCOUNT_ID,409,"OWNER_MERCHANT_NOT_READY","This owner payment account cannot accept a new payment.");
 assert(order.open&&["CREATED","FAILED"].includes(order.status)&&order.providerOrderId&&invoiceSnapshot(invoice)===order.invoiceSnapshot,409,"OWNER_PAYMENT_PENDING","Check your existing payment status. Do not submit another payment while confirmation is pending.");
 return {orderId:order.id,invoiceId,providerOrderId:order.providerOrderId,publicToken:order.authorization.publicToken,amountPaise:order.amountPaise,currency:"INR",mode:order.authorization.mode,pgName:m.property.name};
}
