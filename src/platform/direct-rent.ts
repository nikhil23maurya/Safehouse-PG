import express from "express";
import {z} from "zod";
import {prisma} from "../db.js";
import {assert} from "../errors.js";
import {accountSession,atomic,audit} from "./service.js";
import {entitlement} from "./billing.js";
import {passwordMatches} from "./passwords.js";
import {randomCode} from "./tokens.js";

const vpa=z.string().trim().toLowerCase().regex(/^[a-z0-9._-]{2,128}@[a-z0-9.-]{2,64}$/);
export async function createDirectClaim(accountId:string,membershipId:string,invoiceId:string,key:string) {
  return atomic(async tx=>{
    const member=await tx.pgMembership.findFirst({where:{id:membershipId,accountId,role:"RESIDENT",status:"ACTIVE"}});
    assert(member?.actorUserId,403,"RESIDENT_REQUIRED","Select your active resident workspace.");
    const student=await tx.student.findFirst({where:{userId:member.actorUserId,propertyId:member.propertyId,status:"ACTIVE"}});
    assert(student,403,"RESIDENT_INACTIVE","This residency is not active.");
    const prior=await tx.pgDirectRentClaim.findUnique({where:{accountId_requestKey:{accountId,requestKey:key}}});
    if(prior){assert(prior.invoiceId===invoiceId&&prior.propertyId===member.propertyId,409,"IDEMPOTENCY_CONFLICT","This request belongs to a different invoice.");return prior;}
    const invoice=await tx.rentInvoice.findFirst({where:{id:invoiceId,studentId:student.id,propertyId:member.propertyId}});
    const payee=await tx.pgOwnerUpi.findUnique({where:{propertyId:member.propertyId}});
    assert(invoice&&invoice.status==="DUE"&&invoice.totalPaise>invoice.paidPaise,409,"RENT_NOT_PAYABLE","This rent is not currently payable.");
    assert(payee?.enabled,409,"OWNER_UPI_UNAVAILABLE","Your owner has not supplied a direct UPI address. Ask your owner for payment arrangements.");
    const open=await tx.paymentAttempt.findFirst({where:{invoiceId,status:{in:["CREATED","VERIFIED"]}}});
    assert(!open,409,"PAYMENT_ATTEMPT_OPEN","Check the existing provider payment before sending a separate bank transfer.");
    const existing=await tx.pgDirectRentClaim.findFirst({where:{invoiceId,accountId,status:"PENDING_OWNER_CONFIRMATION"}});
    if(existing)return existing; // Network retries or another device never encourage a second transfer.
    const claim=await tx.pgDirectRentClaim.create({data:{accountId,invoiceId,studentId:student.id,propertyId:member.propertyId,requestKey:key,
      payeeAddress:payee.upiAddress,payeeName:payee.payeeName,payeeRevision:payee.revision,
      amountPaise:invoice.totalPaise-invoice.paidPaise,reference:`PGO${randomCode().slice(0,24)}`}});
    await audit(tx,accountId,member.organisationId,"DIRECT_RENT_INTENT_CREATED",claim.id,{invoiceId,amountPaise:claim.amountPaise});return claim;
  });
}
export function directIntent(claim:{payeeAddress:string;payeeName:string;amountPaise:number;reference:string}) {
  return `upi://pay?${new URLSearchParams({pa:claim.payeeAddress,pn:claim.payeeName,am:(claim.amountPaise/100).toFixed(2),cu:"INR",tr:claim.reference,tn:"PG rent - owner bank confirmation required"})}`;
}
// Confirmation attaches an existing owner-recorded bank receipt. It NEVER posts another credit.
export async function confirmDirectClaim(accountId:string,propertyId:string,claimId:string,paymentId:string) {
  return atomic(async tx=>{
    const member=await tx.pgMembership.findFirst({where:{accountId,propertyId,role:"OWNER",status:"ACTIVE"},include:{organisation:true}});
    assert(member&&member.organisation.ownerAccountId===accountId,403,"FORBIDDEN","Select your own property.");
    const claim=await tx.pgDirectRentClaim.findFirst({where:{id:claimId,propertyId}});
    assert(claim,404,"CLAIM_NOT_FOUND","Payment reference not found in this property.");
    if(claim.status==="OWNER_CONFIRMED"){assert(claim.confirmedPaymentId===paymentId,409,"CLAIM_ALREADY_CONFIRMED","This reference already has a receipt.");return claim;}
    assert(claim.status==="PENDING_OWNER_CONFIRMATION"&&claim.bankReference,409,"BANK_REFERENCE_REQUIRED","Wait for the resident's bank reference and verify your bank before confirming.");
    const payment=await tx.payment.findFirst({where:{OR:[{id:paymentId},{receiptNumber:paymentId}],propertyId,studentId:claim.studentId,invoiceId:claim.invoiceId,
      source:"MANUAL",method:"BANK_TRANSFER",amountPaise:claim.amountPaise,paidAt:{gte:new Date(claim.createdAt.getTime()-86400000)}}});
    assert(payment,409,"MANUAL_RECEIPT_MISMATCH","Record the exact received bank transfer through Rent Dues first, then select its receipt.");
    const fresh=await tx.pgDirectRentClaim.updateMany({where:{id:claim.id,status:"PENDING_OWNER_CONFIRMATION"},data:{status:"OWNER_CONFIRMED",confirmedPaymentId:payment.id,confirmedAt:new Date()}});
    assert(fresh.count===1,409,"CLAIM_CHANGED","Refresh this payment reference.");
    await audit(tx,accountId,member.organisationId,"DIRECT_RENT_OWNER_CONFIRMED",claim.id,{paymentId:payment.id,providerVerified:false});
    return tx.pgDirectRentClaim.findUniqueOrThrow({where:{id:claim.id}});
  });
}
export const directRentRouter=express.Router();
directRentRouter.use((_req,res,next)=>{res.setHeader("Cache-Control","no-store");next();});
const session=(req:express.Request)=>accountSession((req.header("authorization")||"").replace(/^Bearer /,""));
directRentRouter.get("/owner",async(req,res)=>{
  const {account,membership}=await session(req);assert(membership?.role==="OWNER",403,"FORBIDDEN","Select an owner workspace.");
  const [payee,claims]=await Promise.all([prisma.pgOwnerUpi.findUnique({where:{propertyId:membership.propertyId}}),
    prisma.pgDirectRentClaim.findMany({where:{propertyId:membership.propertyId},orderBy:{createdAt:"desc"},take:100})]);
  res.json({payee,claims});
});
directRentRouter.post("/owner",async(req,res)=>{
  const {account,membership}=await session(req);assert(membership?.role==="OWNER"&&!account.passwordChangeRequired,403,"FORBIDDEN","Select an owner workspace.");
  assert(await entitlement(membership.organisationId),402,"SUBSCRIPTION_REQUIRED","Activate PGOne first.");
  const input=z.object({upiAddress:vpa,payeeName:z.string().trim().min(2).max(100),password:z.string().max(128),accepted:z.literal(true),enabled:z.boolean()}).strict().parse(req.body);
  assert(await passwordMatches(input.password,account.passwordHash),401,"INVALID_CREDENTIALS","Confirm your password to change rent payment details.");
  await atomic(async tx=>{await tx.pgOwnerUpi.upsert({where:{propertyId:membership.propertyId},
    create:{propertyId:membership.propertyId,ownerAccountId:account.id,upiAddress:input.upiAddress,payeeName:input.payeeName,enabled:input.enabled},
    update:{upiAddress:input.upiAddress,payeeName:input.payeeName,enabled:input.enabled,revision:{increment:1}}});
    await audit(tx,account.id,membership.organisationId,"DIRECT_OWNER_UPI_UPDATED",membership.propertyId,{enabled:input.enabled});});
  res.json({ok:true});
});
directRentRouter.post("/invoices/:id",async(req,res)=>{
  const {account,membership}=await session(req);assert(membership,403,"WORKSPACE_REQUIRED","Select your residency.");
  const {key}=z.object({key:z.string().regex(/^[A-Za-z0-9_-]{16,100}$/)}).parse(req.body);
  const claim=await createDirectClaim(account.id,membership.id,String(req.params.id),key);
  res.json({claim,intent:directIntent(claim),providerVerified:false});
});
directRentRouter.post("/claims/:id/reference",async(req,res)=>{
  const {account,membership}=await session(req);assert(membership?.role==="RESIDENT",403,"FORBIDDEN","Select your residency.");
  const {reference}=z.object({reference:z.string().trim().regex(/^[A-Za-z0-9-]{6,40}$/)}).parse(req.body);
  await atomic(async tx=>{const claim=await tx.pgDirectRentClaim.findFirst({where:{id:String(req.params.id),accountId:account.id,propertyId:membership.propertyId,status:"PENDING_OWNER_CONFIRMATION"}});
    assert(claim,404,"CLAIM_NOT_FOUND","Pending payment reference not found.");
    assert(!claim.bankReference||claim.bankReference===reference,409,"BANK_REFERENCE_IMMUTABLE","An existing bank reference cannot be replaced. Ask your owner to review it.");
    await tx.pgDirectRentClaim.update({where:{id:claim.id},data:{bankReference:reference}});
    await audit(tx,account.id,membership.organisationId,"DIRECT_RENT_REFERENCE_SUBMITTED",claim.id,{providerVerified:false});});res.json({ok:true,status:"PENDING_OWNER_CONFIRMATION"});
});
directRentRouter.post("/claims/:id/confirm",async(req,res)=>{
  const {account,membership}=await session(req);assert(membership?.role==="OWNER",403,"FORBIDDEN","Select an owner workspace.");
  assert(await entitlement(membership.organisationId),402,"SUBSCRIPTION_REQUIRED","Renew PGOne before managing payments.");
  const {paymentId,bankChecked}=z.object({paymentId:z.string().min(1).max(100),bankChecked:z.literal(true)}).parse(req.body);
  res.json(await confirmDirectClaim(account.id,membership.propertyId,String(req.params.id),paymentId));
});
