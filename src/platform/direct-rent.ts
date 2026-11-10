import express from "express";
import {z} from "zod";
import {prisma} from "../db.js";
import {assert,AppError} from "../errors.js";
import {accountSession,atomic,audit} from "./service.js";
import {entitlement} from "./billing.js";
import {passwordMatches} from "./passwords.js";
import {randomCode} from "./tokens.js";

const vpa=z.string().trim().toLowerCase().regex(/^[a-z0-9._-]{2,128}@[a-z0-9.-]{2,64}$/);
export function directClaimIssue(claim:any,invoice:any,payee:any) {
  if(claim.status==="OWNER_CONFIRMED")return null;
  if(!invoice || invoice.status!=="DUE" || invoice.totalPaise<=invoice.paidPaise)return "This invoice is already settled or being processed. Ask your owner to reconcile the existing payment reference.";
  if(claim.amountPaise!==invoice.totalPaise-invoice.paidPaise)return "The invoice balance changed after this request. Do not pay this old amount. Ask your owner to reconcile the existing reference.";
  if(!payee?.enabled || payee.revision!==claim.payeeRevision || payee.upiAddress!==claim.payeeAddress || payee.payeeName!==claim.payeeName)return "Your owner's payment details changed. Do not pay this old request. Ask your owner to review it.";
  return null;
}
export async function directRentStatus(accountId:string,membershipId:string,invoiceId:string) {
  const member=await prisma.pgMembership.findFirst({where:{id:membershipId,accountId,role:"RESIDENT",status:"ACTIVE"}});
  assert(member?.actorUserId,403,"RESIDENT_REQUIRED","Select your active resident workspace.");
  const student=await prisma.student.findFirst({where:{userId:member.actorUserId,propertyId:member.propertyId,status:"ACTIVE"}});
  assert(student,403,"RESIDENT_INACTIVE","This residency is not active.");
  const invoice=await prisma.rentInvoice.findFirst({where:{id:invoiceId,studentId:student.id,propertyId:member.propertyId}});
  assert(invoice,404,"INVOICE_NOT_FOUND","This invoice does not belong to your residency.");
  const [claim,payee,open]=await Promise.all([
    prisma.pgDirectRentClaim.findFirst({where:{invoiceId,accountId,propertyId:member.propertyId},orderBy:{createdAt:"desc"}}),
    prisma.pgOwnerUpi.findUnique({where:{propertyId:member.propertyId}}),
    prisma.paymentAttempt.findFirst({where:{invoiceId,status:{in:["CREATED","VERIFIED"]}}}),
  ]);
  const issue=claim ? directClaimIssue(claim,invoice,payee) : null;
  const settled=["PAID","WAIVED"].includes(invoice.status)||invoice.totalPaise<=invoice.paidPaise;
  const payable=Boolean(claim && !issue && !settled && !open && claim.status==="PENDING_OWNER_CONFIRMATION" && !claim.bankReference);
  return {claim,remainingPaise:Math.max(0,invoice.totalPaise-invoice.paidPaise),settled,issue,
    ownerConfigured:Boolean(payee?.enabled),canPrepare:!claim&&!settled&&!open&&Boolean(payee?.enabled),
    payable,intent:payable?directIntent(claim!):null,providerVerified:false};
}
export async function createDirectClaim(accountId:string,membershipId:string,invoiceId:string,key:string) {
  return atomic(async tx=>{
    const member=await tx.pgMembership.findFirst({where:{id:membershipId,accountId,role:"RESIDENT",status:"ACTIVE"}});
    assert(member?.actorUserId,403,"RESIDENT_REQUIRED","Select your active resident workspace.");
    const student=await tx.student.findFirst({where:{userId:member.actorUserId,propertyId:member.propertyId,status:"ACTIVE"}});
    assert(student,403,"RESIDENT_INACTIVE","This residency is not active.");
    const prior=await tx.pgDirectRentClaim.findUnique({where:{accountId_requestKey:{accountId,requestKey:key}}});
    if(prior)assert(prior.invoiceId===invoiceId&&prior.propertyId===member.propertyId,409,"IDEMPOTENCY_CONFLICT","This request belongs to a different invoice.");
    const invoice=await tx.rentInvoice.findFirst({where:{id:invoiceId,studentId:student.id,propertyId:member.propertyId}});
    const payee=await tx.pgOwnerUpi.findUnique({where:{propertyId:member.propertyId}});
    const existing=prior || await tx.pgDirectRentClaim.findFirst({where:{invoiceId,accountId,status:"PENDING_OWNER_CONFIRMATION"}});
    if(existing){
      if(existing.status==="OWNER_CONFIRMED")return existing;
      assert(!directClaimIssue(existing,invoice,payee),409,"RENT_REQUEST_CHANGED",directClaimIssue(existing,invoice,payee) || "Review this payment first.");
      return existing;
    }
    assert(invoice&&invoice.status==="DUE"&&invoice.totalPaise>invoice.paidPaise,409,"RENT_NOT_PAYABLE","This rent is not currently payable.");
    assert(payee?.enabled,409,"OWNER_UPI_UNAVAILABLE","Your owner has not supplied a direct UPI address. Ask your owner for payment arrangements.");
    const open=await tx.paymentAttempt.findFirst({where:{invoiceId,status:{in:["CREATED","VERIFIED"]}}});
    assert(!open,409,"PAYMENT_ATTEMPT_OPEN","Check the existing provider payment before sending a separate bank transfer.");
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
    if(claim.status==="OWNER_CONFIRMED"){
      const recorded=await tx.payment.findFirst({where:{id:claim.confirmedPaymentId || "",propertyId,OR:[{id:paymentId},{receiptNumber:paymentId}]}});
      assert(recorded,409,"CLAIM_ALREADY_CONFIRMED","This reference already has a different receipt.");return claim;
    }
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
export async function saveOwnerUpi(accountId:string,membershipId:string,input:{upiAddress:string;payeeName:string;password:string;accepted:true;enabled:boolean}) {
  const membership=await prisma.pgMembership.findFirst({where:{id:membershipId,accountId,role:"OWNER",status:"ACTIVE"},include:{organisation:true,property:true,account:true}});
  assert(membership&&membership.organisation.ownerAccountId===accountId&&membership.property.ownerId===membership.organisation.legacyOwnerId&&
    !membership.account.passwordChangeRequired,403,"FORBIDDEN","Select an owner workspace.");
  assert(await entitlement(membership.organisationId),402,"SUBSCRIPTION_REQUIRED","Activate PGOne first.");
  if(!await passwordMatches(input.password,membership.account.passwordHash))throw new AppError(403,"PASSWORD_CONFIRMATION_FAILED","Your password did not match. Your account is still signed in.",
    {fieldErrors:{password:["Enter your current PGOne password."]}});
  const upiAddress=vpa.parse(input.upiAddress),payeeName=z.string().trim().min(2).max(100).parse(input.payeeName);
  assert(input.accepted,400,"CONFIRMATION_REQUIRED","Confirm this is your rent-receiving account.");
  return atomic(async tx=>{
    const prior=await tx.pgOwnerUpi.findUnique({where:{propertyId:membership.propertyId}});
    assert(!prior||prior.ownerAccountId===accountId,409,"PAYEE_OWNERSHIP_REVIEW","This PG's receiving account needs an ownership review.");
    if(prior&&prior.upiAddress===upiAddress&&prior.payeeName===payeeName&&prior.enabled===input.enabled)return prior;
    const payee=await tx.pgOwnerUpi.upsert({where:{propertyId:membership.propertyId},
      create:{propertyId:membership.propertyId,ownerAccountId:accountId,upiAddress,payeeName,enabled:input.enabled},
      update:{upiAddress,payeeName,enabled:input.enabled,revision:{increment:1}}});
    await audit(tx,accountId,membership.organisationId,"DIRECT_OWNER_UPI_UPDATED",membership.propertyId,{enabled:input.enabled,revision:payee.revision});
    return payee;
  });
}
directRentRouter.get("/owner",async(req,res)=>{
  const {account,membership}=await session(req);assert(membership?.role==="OWNER",403,"FORBIDDEN","Select an owner workspace.");
  const [payee,claims]=await Promise.all([prisma.pgOwnerUpi.findUnique({where:{propertyId:membership.propertyId}}),
    prisma.pgDirectRentClaim.findMany({where:{propertyId:membership.propertyId},orderBy:{createdAt:"desc"},take:100})]);
  res.json({payee,claims});
});
directRentRouter.post("/owner",async(req,res)=>{
  const {account,membership}=await session(req);assert(membership?.role==="OWNER"&&!account.passwordChangeRequired,403,"FORBIDDEN","Select an owner workspace.");
  const input=z.object({upiAddress:vpa,payeeName:z.string().trim().min(2).max(100),password:z.string().max(128),accepted:z.literal(true),enabled:z.boolean()}).strict().parse(req.body);
  const payee=await saveOwnerUpi(account.id,membership.id,input);
  res.json({ok:true,state:payee.enabled?"DETAILS_SAVED":"NOT_CONNECTED",providerVerified:false,payee});
});
directRentRouter.get("/invoices/:id",async(req,res)=>{
  const {account,membership}=await session(req);assert(membership,403,"WORKSPACE_REQUIRED","Select your residency.");
  res.json(await directRentStatus(account.id,membership.id,String(req.params.id)));
});
directRentRouter.post("/invoices/:id",async(req,res)=>{
  const {account,membership}=await session(req);assert(membership,403,"WORKSPACE_REQUIRED","Select your residency.");
  const {key}=z.object({key:z.string().regex(/^[A-Za-z0-9_-]{16,100}$/)}).parse(req.body);
  const claim=await createDirectClaim(account.id,membership.id,String(req.params.id),key);
  res.json(await directRentStatus(account.id,membership.id,String(req.params.id)));
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
