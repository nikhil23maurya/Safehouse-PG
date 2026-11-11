import {ownerAtomic as atomic} from "./transaction.js";
import {prisma} from "../../db.js";
import {assert} from "../../errors.js";
import {audit,ownerOrganisation} from "../service.js";
import {accessToken} from "./merchant.js";
import {ownerPaymentConfig} from "./config.js";
import {razorpayOwnerProvider,type OwnerProvider} from "./provider.js";

export async function reconcileSettlement(authorizationId:string,settlementId:string,provider:OwnerProvider=razorpayOwnerProvider) {
 const auth=await prisma.pgOwnerAuthorization.findUniqueOrThrow({where:{id:authorizationId},include:{merchant:true}}),token=await accessToken(auth.id,provider);
 const s=await provider.settlement(token,settlementId);
 assert(s.id===settlementId&&s.entity==="settlement"&&(!s.account_id||s.account_id===auth.providerAccountId)&&["created","processed","failed"].includes(s.status)&&Number.isInteger(s.amount)&&s.amount>=0&&s.currency==="INR",409,"OWNER_SETTLEMENT_MISMATCH","Settlement details did not match this merchant account.");
 const status=s.status==="processed"?"COMPLETED":s.status==="failed"?"FAILED":"PENDING";
 await atomic(async tx=>{
  await tx.pgOwnerSettlement.upsert({where:{authorizationId_providerSettlementId:{authorizationId,providerSettlementId:settlementId}},create:{authorizationId,providerSettlementId:settlementId,status,amountPaise:s.amount,currency:s.currency,utr:status==="COMPLETED"&&typeof s.utr==="string"?s.utr.slice(0,80):null,verifiedAt:new Date()},update:{status,utr:status==="COMPLETED"&&typeof s.utr==="string"?s.utr.slice(0,80):null,verifiedAt:new Date()}});
  await audit(tx,null,auth.merchant.organisationId,"OWNER_SETTLEMENT_VERIFIED",settlementId,{status,amountPaise:s.amount});
 });
 return s;
}
export async function reconcileSettlementDay(authorizationId:string,date:{year:number;month:number;day:number},provider:OwnerProvider=razorpayOwnerProvider) {
 const auth=await prisma.pgOwnerAuthorization.findUniqueOrThrow({where:{id:authorizationId}}),token=await accessToken(auth.id,provider);
 const rows=await provider.recon(token,date.year,date.month,date.day);
 for(const row of rows){
  if(row.type!=="payment"||row.settled!==true||!/^setl_[A-Za-z0-9]+$/.test(row.settlement_id||""))continue;
  const paymentId=row.entity_id;
  const application=await prisma.pgOwnerRentApplication.findFirst({where:{providerPaymentId:paymentId,order:{authorizationId}}});if(!application)continue;
  assert(row.currency==="INR"&&row.amount===application.amountPaise&&[row.credit,row.fee,row.tax].every(v=>Number.isInteger(v)&&v>=0)&&row.credit<=row.amount,409,"OWNER_SETTLEMENT_RECON_MISMATCH","The settlement report needs an owner review.");
  await reconcileSettlement(authorizationId,row.settlement_id,provider);
  await atomic(async tx=>{
   const settlement=await tx.pgOwnerSettlement.findUniqueOrThrow({where:{authorizationId_providerSettlementId:{authorizationId,providerSettlementId:row.settlement_id}}});
   const prior=await tx.pgOwnerSettlementItem.findUnique({where:{settlementId_applicationId:{settlementId:settlement.id,applicationId:application.id}}});
   if(prior){assert(prior.grossPaise===row.amount&&prior.netPaise===row.credit&&prior.feePaise===row.fee&&prior.taxPaise===row.tax,409,"OWNER_SETTLEMENT_RECON_CHANGED","Settlement allocation changed and requires review.");return;}
   await tx.pgOwnerSettlementItem.create({data:{settlementId:settlement.id,applicationId:application.id,grossPaise:row.amount,netPaise:row.credit,feePaise:row.fee,taxPaise:row.tax}});
   if(Number.isInteger(row.settled_at))await tx.pgOwnerSettlement.update({where:{id:settlement.id},data:{settledAt:new Date(row.settled_at*1000)}});
  });
 }
}
export async function collectionDashboard(accountId:string,organisationId:string,year:number,month:number) {
 const org=await ownerOrganisation(accountId,organisationId);
 const properties=await prisma.property.findMany({where:{ownerId:org.legacyOwnerId},select:{id:true,name:true}});
 const invoices=await prisma.rentInvoice.findMany({where:{propertyId:{in:properties.map(p=>p.id)},year,month}});
 const scope={organisationId,invoiceId:{in:invoices.map(i=>i.id)},authorization:{mode:ownerPaymentConfig().RAZORPAY_OWNER_MODE}};
 const [orders,pendingVerification,failedAttempts,refundTotals,failedPayments,settlements]=await Promise.all([
  prisma.pgOwnerRentOrder.findMany({where:scope,include:{application:{include:{refunds:true,settlementItems:{include:{settlement:true}}}}},orderBy:{createdAt:"desc"},take:200}),
  prisma.pgOwnerRentOrder.count({where:{...scope,open:true}}),
  prisma.pgOwnerPaymentObservation.count({where:{order:scope,status:"failed"}}),
  prisma.pgOwnerRentApplication.aggregate({where:{order:scope},_sum:{refundedPaise:true}}),
  prisma.pgOwnerPaymentObservation.findMany({where:{order:scope,status:"failed"},include:{order:{select:{invoiceId:true}}},orderBy:{observedAt:"desc"},take:50}),
  prisma.pgOwnerSettlement.findMany({where:{authorization:{merchant:{organisationId},mode:ownerPaymentConfig().RAZORPAY_OWNER_MODE}},orderBy:{verifiedAt:"desc"},take:30}),
 ]);
 return {period:{year,month},totalBilledPaise:invoices.reduce((n,i)=>n+i.totalPaise,0),totalCollectedPaise:invoices.reduce((n,i)=>n+i.paidPaise,0),outstandingPaise:invoices.reduce((n,i)=>n+Math.max(0,i.totalPaise-i.paidPaise),0),pendingVerification,failedAttempts,
  onlineRefundedPaise:refundTotals._sum.refundedPaise||0,
  failedPayments:failedPayments.map(p=>({reference:p.providerPaymentId,invoiceId:p.order.invoiceId,amountPaise:p.amountPaise,observedAt:p.observedAt})),
  payments:orders.map(o=>({id:o.id,invoiceId:o.invoiceId,propertyId:o.propertyId,status:o.status,amountPaise:o.amountPaise,reference:o.application?.providerPaymentId||o.reference,paidAt:o.application?.paidAt||null,refundedPaise:o.application?.refundedPaise||0,receiptId:o.application?.paymentId||null,settlement:o.application?.settlementItems.map(i=>({status:i.settlement.status,netPaise:i.netPaise,feePaise:i.feePaise,taxPaise:i.taxPaise}))||[]})),
  settlements:settlements.map(s=>({id:s.id,status:s.status,amountPaise:s.amountPaise,utr:s.utr,verifiedAt:s.verifiedAt,settledAt:s.settledAt})),truncated:orders.length===200};
}
