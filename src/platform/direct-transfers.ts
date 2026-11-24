import {createHash} from "node:crypto";
import {prisma} from "../db.js";
import {assert} from "../errors.js";
import {receiptNumber} from "../utils.js";
import {atomic,audit} from "./service.js";
import {directIntent,directClaimIssue} from "./direct-rent.js";
import {residentContext,ownerContext} from "./rent-evidence.js";
import {randomCode} from "./tokens.js";
import type {Prisma} from "../generated/prisma/client.js";

const transferSelect={id:true,invoiceId:true,billId:true,rentClaimId:true,rentPaise:true,electricityPaise:true,amountPaise:true,payeeAddress:true,payeeName:true,payeeRevision:true,reference:true,status:true,receiptNumber:true,rentPaymentId:true,createdAt:true,confirmedAt:true};
const proofSelect={id:true,bankReference:true,evidenceId:true,status:true,reason:true,createdAt:true};
export async function saveElectricity(accountId:string,membershipId:string,invoiceId:string,input:{amountPaise:number;meterEvidenceId:string}){
  assert(Number.isSafeInteger(input.amountPaise)&&input.amountPaise>0&&input.amountPaise<=10000000,400,"INVALID_AMOUNT","Enter an electricity amount between ₹0.01 and ₹1,00,000.");
  return atomic(async tx=>{
    const {member,student}=await residentContext(tx,accountId,membershipId);
    const invoice=await tx.rentInvoice.findFirst({where:{id:invoiceId,propertyId:member.propertyId,studentId:student.id}});
    assert(invoice,404,"INVOICE_NOT_FOUND","Choose your own billing month.");
    assert(invoice.electricityPaise===0,409,"ELECTRICITY_ALREADY_BILLED","Electricity is already included in this rent invoice. Ask your owner to review it before adding another bill.");
    const image=await tx.pgRentEvidence.findFirst({where:{id:input.meterEvidenceId,accountId,propertyId:member.propertyId,purpose:"METER"}});
    assert(image,400,"METER_PHOTO_REQUIRED","Attach your meter photo.");
    const prior=await tx.pgElectricityBill.findUnique({where:{invoiceId}});
    if(prior){
      assert(prior.accountId===accountId,403,"FORBIDDEN","This bill belongs to another residency.");
      if(prior.amountPaise===input.amountPaise&&prior.meterEvidenceId===image.id)return prior;
      assert(prior.status==="DUE"&&!await tx.pgDirectTransfer.findFirst({where:{billId:prior.id,status:{not:"CANCELLED"}}}),409,"BILL_LOCKED","This bill has a payment in progress or is paid. Ask your owner to review it.");
    }
    const bill=await tx.pgElectricityBill.upsert({where:{invoiceId},create:{invoiceId,propertyId:member.propertyId,studentId:student.id,accountId,amountPaise:input.amountPaise,meterEvidenceId:image.id},update:{amountPaise:input.amountPaise,meterEvidenceId:image.id,revision:{increment:1}}});
    await audit(tx,accountId,member.organisationId,"ELECTRICITY_BILL_SUBMITTED",bill.id,{amountPaise:bill.amountPaise,revision:bill.revision,meterEvidenceId:image.id});return bill;
  });
}
async function openInvoice(tx:any,accountId:string,membershipId:string,invoiceId:string){
  const {member,student}=await residentContext(tx,accountId,membershipId);
  const invoice=await tx.rentInvoice.findFirst({where:{id:invoiceId,propertyId:member.propertyId,studentId:student.id}});
  assert(invoice,404,"INVOICE_NOT_FOUND","Choose your own rent invoice.");return {member,student,invoice};
}
async function blocks(tx:any,invoiceId:string){
  assert(!await tx.paymentAttempt.findFirst({where:{invoiceId,status:{in:["CREATED","VERIFIED"]}}})&&!await tx.pgOwnerRentOrder.findFirst({where:{invoiceId,open:true}}),409,"PAYMENT_ATTEMPT_OPEN","Reconcile the existing gateway payment first. Do not send another transfer.");
}
export async function prepareTransfer(accountId:string,membershipId:string,invoiceId:string,input:{rent:boolean;electricity:boolean;key:string}){
  assert(input.rent||input.electricity,400,"CHOOSE_CHARGE","Choose rent, electricity, or both.");
  return atomic(async tx=>{
    const {member,student,invoice}=await openInvoice(tx,accountId,membershipId,invoiceId);
    const prior=await tx.pgDirectTransfer.findUnique({where:{accountId_requestKey:{accountId,requestKey:input.key}}});
    if(prior){assert(prior.invoiceId===invoiceId&&Boolean(prior.rentPaise)===input.rent&&Boolean(prior.electricityPaise)===input.electricity,409,"IDEMPOTENCY_CONFLICT","This request belongs to a different payment.");return prior;}
    const payee=await tx.pgOwnerUpi.findUnique({where:{propertyId:member.propertyId}});
    assert(payee?.enabled,409,"OWNER_UPI_UNAVAILABLE","Your owner must save their rent-receiving UPI ID first.");
    // Rent and electricity may be paid independently, including while the other
    // proof awaits review. Only overlapping charge allocations are reserved.
    const pending=await tx.pgDirectTransfer.findFirst({where:{invoiceId,status:{in:["READY","SUBMITTED","REJECTED"]},OR:[...(input.rent?[{rentPaise:{gt:0}}]:[]),...(input.electricity?[{electricityPaise:{gt:0}}]:[])]}});
    if(pending){assert(Boolean(pending.rentPaise)===input.rent&&Boolean(pending.electricityPaise)===input.electricity,409,"TRANSFER_PENDING","Review your existing payment before choosing another amount.");return pending;}
    await blocks(tx,invoiceId);
    const rentPaise=input.rent?invoice.totalPaise-invoice.paidPaise:0;
    assert(!input.rent||(invoice.status==="DUE"&&rentPaise>0),409,"RENT_NOT_PAYABLE","Rent is already paid or being processed.");
    const bill=input.electricity?await tx.pgElectricityBill.findUnique({where:{invoiceId}}):null;
    assert(!input.electricity||(bill?.status==="DUE"&&bill.accountId===accountId),409,"ELECTRICITY_NOT_PAYABLE","Save your electricity amount and meter photo first, or check whether it is already paid.");
    let claim:any=null;
    if(input.rent){
      claim=await tx.pgDirectRentClaim.findFirst({where:{invoiceId,status:"PENDING_OWNER_CONFIRMATION"}});
      if(claim){assert(claim.accountId===accountId&&!claim.bankReference&&!directClaimIssue(claim,invoice,payee),409,"OLD_TRANSFER_PENDING","Your earlier transfer needs owner review before a new payment.");}
      else claim=await tx.pgDirectRentClaim.create({data:{accountId,invoiceId,studentId:student.id,propertyId:member.propertyId,requestKey:input.key,payeeAddress:payee.upiAddress,payeeName:payee.payeeName,payeeRevision:payee.revision,amountPaise:rentPaise,reference:`PGO${randomCode().slice(0,24)}`}});
    }
    const amountPaise=rentPaise+(bill?.amountPaise||0);assert(Number.isSafeInteger(amountPaise)&&amountPaise<=2147483647,400,"INVALID_AMOUNT","This combined amount exceeds the supported transfer size. Pay charges separately.");
    const transfer=await tx.pgDirectTransfer.create({data:{accountId,propertyId:member.propertyId,studentId:student.id,invoiceId,rentClaimId:claim?.id,billId:bill?.id,rentPaise,electricityPaise:bill?.amountPaise||0,amountPaise,payeeAddress:payee.upiAddress,payeeName:payee.payeeName,payeeRevision:payee.revision,reference:`PGT${randomCode().slice(0,24)}`,requestKey:input.key}});
    await audit(tx,accountId,member.organisationId,"DIRECT_TRANSFER_PREPARED",transfer.id,{rentPaise,electricityPaise:transfer.electricityPaise,invoiceId});return transfer;
  });
}
function normalizeBankReference(input: string | null | undefined) {
  if (input == null) return null;
  const reference = input.trim().toUpperCase();
  assert(/^[A-Z0-9-]{6,40}$/.test(reference) && reference.replaceAll("-", "").length >= 6,
    400, "INVALID_BANK_REFERENCE", "Enter a valid bank transaction reference.");
  return reference;
}

export async function submitProof(accountId:string,membershipId:string,transferId:string,input:{bankReference?:string;evidenceId:string;key:string}){
  const reference=normalizeBankReference(input.bankReference);
  return atomic(async tx=>{
    const {member}=await residentContext(tx,accountId,membershipId);
    const transfer=await tx.pgDirectTransfer.findFirst({where:{id:transferId,accountId,propertyId:member.propertyId}});
    assert(transfer,404,"TRANSFER_NOT_FOUND","Payment not found in your residency.");
    const prior=await tx.pgTransferProof.findUnique({where:{transferId_requestKey:{transferId,requestKey:input.key}}});
    if(prior){assert(prior.evidenceId===input.evidenceId&&
      (prior.bankReference===reference||(reference===null&&prior.status==="APPROVED")),
      409,"IDEMPOTENCY_CONFLICT","This submission key was already used for different evidence.");return prior;}
    assert(["READY","REJECTED"].includes(transfer.status),409,"PROOF_ALREADY_SUBMITTED","Your proof is already submitted or confirmed. Refresh its status.");
    const image=await tx.pgRentEvidence.findFirst({where:{id:input.evidenceId,accountId,propertyId:member.propertyId,purpose:"PAYMENT"}});
    assert(image,400,"PAYMENT_PROOF_REQUIRED","Attach your payment screenshot.");
    const proof=await tx.pgTransferProof.create({data:{transferId,evidenceId:image.id,bankReference:reference,requestKey:input.key}});
    await tx.pgDirectTransfer.update({where:{id:transferId},data:{status:"SUBMITTED"}});
    await audit(tx,accountId,member.organisationId,"DIRECT_TRANSFER_PROOF_SUBMITTED",proof.id,{transferId,providerVerified:false});return proof;
  });
}
type TransferReview = {
  proofId: string;
  approve: boolean;
  bankChecked?: boolean;
  bankReference?: string;
  reason?: string;
  existingRentReceipt?: string;
};

export async function reviewTransfer(accountId:string,propertyId:string,transferId:string,input:TransferReview){
  return atomic(async tx => {
    const member = await ownerContext(tx, accountId, propertyId);
    return reviewTransferInTransaction(tx, member, accountId, propertyId, transferId, input);
  });
}

async function reviewTransferInTransaction(
  tx: Prisma.TransactionClient, member: Awaited<ReturnType<typeof ownerContext>>,
  accountId: string, propertyId: string, transferId: string, input: TransferReview,
) {
    const transfer=await tx.pgDirectTransfer.findFirst({where:{id:transferId,propertyId}});
    assert(transfer,404,"TRANSFER_NOT_FOUND","Payment not found in this property.");
    const proof=await tx.pgTransferProof.findFirst({where:{id:input.proofId,transferId}});
    assert(proof,404,"PROOF_NOT_FOUND","Payment proof not found.");
    const reference = input.approve ? normalizeBankReference(input.bankReference ?? proof.bankReference) : null;
    if (input.approve && proof.bankReference && reference) {
      assert(reference.replaceAll("-", "") === proof.bankReference.replaceAll("-", ""),
        409, "BANK_REFERENCE_MISMATCH", "The bank reference differs from this proof. Review the payment.");
    }
    if(transfer.status==="CONFIRMED"){assert(input.approve&&proof.status==="APPROVED",409,"REVIEW_CONFLICT","This payment already has a final confirmation.");return transfer;}
    if(proof.status==="REJECTED"&&!input.approve)return transfer;
    assert(transfer.status==="SUBMITTED"&&proof.status==="PENDING",409,"PROOF_CHANGED","Refresh the latest submitted proof.");
    if(!input.approve){
      assert(input.reason?.trim()&&input.reason.trim().length<=500,400,"REASON_REQUIRED","Explain what the resident needs to correct. Do not ask them to pay again until the bank is checked.");
      await tx.pgTransferProof.update({where:{id:proof.id},data:{status:"REJECTED",reason:input.reason!.trim(),reviewedAt:new Date(),reviewerAccountId:accountId}});
      const updated=await tx.pgDirectTransfer.update({where:{id:transferId},data:{status:"REJECTED"}});
      await audit(tx,accountId,member.organisationId,"DIRECT_TRANSFER_PROOF_REJECTED",proof.id,{transferId});return updated;
    }
    assert(input.bankChecked===true,400,"BANK_CHECK_REQUIRED","Confirm the actual bank credit, payee, amount and meter bill before approving.");
    const evidence=await tx.pgRentEvidence.findFirst({where:{id:proof.evidenceId,accountId:transfer.accountId,propertyId,purpose:"PAYMENT"},select:{sha256:true}});
    assert(evidence,409,"PAYMENT_PROOF_REQUIRED","The original payment screenshot needs review.");
    // Historical references retain their original duplicate guard. New screenshot-
    // only confirmations use a payee-bound image fingerprint, never a fake UTR.
    const evidenceKey=createHash("sha256").update(`SCREENSHOT\n${transfer.payeeAddress.toLowerCase()}\n${evidence.sha256}`).digest("hex");
    const bankKey=reference?createHash("sha256").update(`${transfer.payeeAddress.toLowerCase()}\n${reference.replaceAll("-","")}`).digest("hex"):evidenceKey;
    assert(!await tx.pgDirectTransfer.findUnique({where:{bankKey:evidenceKey}}),409,"PAYMENT_PROOF_USED","This screenshot already confirmed a payment to this payee. Check the bank before reviewing another payment.");
    assert(!await tx.pgDirectTransfer.findUnique({where:{bankKey}}),409,"BANK_REFERENCE_USED","This bank reference already confirmed another payment to this payee.");
    const invoice=await tx.rentInvoice.findFirst({where:{id:transfer.invoiceId,propertyId,studentId:transfer.studentId}});
    assert(invoice,409,"INVOICE_CHANGED","The original invoice needs review.");
    await blocks(tx,invoice.id);
    let payment:any=null;const now=new Date();
    if(transfer.rentPaise){
      const claim=await tx.pgDirectRentClaim.findUnique({where:{id:transfer.rentClaimId!}});
      assert(claim&&claim.status==="PENDING_OWNER_CONFIRMATION",409,"RENT_ALREADY_RECORDED","This rent already has a confirmation. Review its existing receipt.");
      if(input.existingRentReceipt){
        payment=await tx.payment.findFirst({where:{OR:[{id:input.existingRentReceipt},{receiptNumber:input.existingRentReceipt}],propertyId,studentId:transfer.studentId,invoiceId:invoice.id,source:"MANUAL",method:"BANK_TRANSFER",amountPaise:transfer.rentPaise}});
        assert(payment&&!await tx.pgDirectRentClaim.findUnique({where:{confirmedPaymentId:payment.id}}),409,"RECEIPT_MISMATCH","Select an unlinked bank receipt for this exact resident, month and rent amount.");
      }else{
        assert(invoice.status==="DUE"&&invoice.totalPaise-invoice.paidPaise===transfer.rentPaise,409,"RENT_BALANCE_CHANGED","Rent balance changed. If you already recorded it manually, enter that receipt number instead of posting again.");
        payment=await tx.payment.create({data:{propertyId,studentId:transfer.studentId,invoiceId:invoice.id,amountPaise:transfer.rentPaise,source:"MANUAL",method:"BANK_TRANSFER",receiptNumber:receiptNumber(now),paidAt:now,metadata:{directTransferId:transferId,bankKey,bankReference:reference,ownerConfirmed:true}}});
        await tx.rentInvoice.update({where:{id:invoice.id},data:{paidPaise:invoice.paidPaise+transfer.rentPaise,status:"PAID"}});
        await tx.auditLog.create({data:{propertyId,actorUserId:member.actorUserId,action:"MANUAL_PAYMENT",entityType:"RentInvoice",entityId:invoice.id,metadata:{amountPaise:transfer.rentPaise,method:"BANK_TRANSFER",directTransferId:transferId}}});
      }
      await tx.pgDirectRentClaim.update({where:{id:claim.id},data:{status:"OWNER_CONFIRMED",bankReference:reference,confirmedPaymentId:payment.id,confirmedAt:now}});
    }
    if(transfer.electricityPaise){
      const bill=await tx.pgElectricityBill.findFirst({where:{id:transfer.billId!,invoiceId:invoice.id,propertyId,status:"DUE",amountPaise:transfer.electricityPaise}});
      assert(bill,409,"ELECTRICITY_CHANGED","Electricity amount changed or is already paid.");
      assert(invoice.electricityPaise===0,409,"ELECTRICITY_ALREADY_BILLED","Electricity was also added to the rent invoice. Resolve the duplicate charge before confirming.");
      await tx.pgElectricityBill.update({where:{id:bill.id},data:{status:"PAID",paidAt:now}});
    }
    await tx.pgTransferProof.update({where:{id:proof.id},data:{status:"APPROVED",bankReference:reference,reviewerAccountId:accountId,reviewedAt:now}});
    const confirmed=await tx.pgDirectTransfer.update({where:{id:transferId},data:{status:"CONFIRMED",bankKey,rentPaymentId:payment?.id,receiptNumber:`PGT-${randomCode().slice(0,20)}`,confirmedAt:now}});
    await audit(tx,accountId,member.organisationId,"DIRECT_TRANSFER_BANK_CONFIRMED",transferId,{rentPaise:transfer.rentPaise,electricityPaise:transfer.electricityPaise,proofId:proof.id,rentPaymentId:payment?.id||null,confirmationBasis:reference?"BANK_REFERENCE_AND_OWNER_CHECK":"SCREENSHOT_AND_OWNER_CHECK",providerVerified:false});return confirmed;
}

export async function reconcileTransfers(
  accountId: string,
  propertyId: string,
  input: { year: number; month: number; amountPaise: number; bankChecked: true;
    payments: { transferId: string; proofId: string; bankReference?: string }[] },
) {
  const ids = input.payments.map(payment => payment.transferId);
  const references = input.payments.map(payment => normalizeBankReference(payment.bankReference)).filter((v):v is string=>v!==null);
  assert(ids.length > 0 && ids.length <= 10 && new Set(ids).size === ids.length,
    400, "INVALID_RECONCILIATION", "Select up to 10 different payments to reconcile.");
  assert(new Set(references.map(reference => reference.replaceAll("-", ""))).size === references.length,
    400, "DUPLICATE_BANK_REFERENCE", "Use a different bank reference for each payment.");
  assert(input.bankChecked === true,400,"BANK_CHECK_REQUIRED","Match the selected credits in your bank before confirming.");
  return atomic(async tx => {
    const member = await ownerContext(tx, accountId, propertyId);
    const transfers = await tx.pgDirectTransfer.findMany({
      where: { id: {in: ids}, propertyId },
      select: { id: true, invoiceId: true, status: true, amountPaise: true },
    });
    const invoices = await tx.rentInvoice.count({
      where: { id: {in: [...new Set(transfers.map(t => t.invoiceId))]}, propertyId, year: input.year, month: input.month },
    });
    const allConfirmed = transfers.every(t => t.status === "CONFIRMED");
    assert(transfers.length === ids.length && invoices === new Set(transfers.map(t => t.invoiceId)).size &&
      (allConfirmed || transfers.every(t => t.status === "SUBMITTED")),
      409, "RECONCILIATION_CHANGED", "The selected payments changed. Refresh the queue and check the bank again.");
    const amountPaise = transfers.reduce((sum, transfer) => sum + transfer.amountPaise, 0);
    assert(amountPaise === input.amountPaise, 409, "RECONCILIATION_TOTAL_MISMATCH",
      "The bank total must match the selected payments.");
    for (const payment of input.payments) {
      await reviewTransferInTransaction(tx, member, accountId, propertyId, payment.transferId,
        { proofId: payment.proofId, bankReference: payment.bankReference, approve: true, bankChecked: true });
    }
    if (!allConfirmed) await audit(tx, accountId, member.organisationId, "DIRECT_TRANSFERS_RECONCILED",
      ids[0]!, { transferIds: ids, amountPaise, year: input.year, month: input.month });
    return { confirmedCount: ids.length, amountPaise };
  });
}
export async function cancelTransfer(accountId:string,membershipId:string,id:string){
 return atomic(async tx=>{
  const {member}=await residentContext(tx,accountId,membershipId);const t=await tx.pgDirectTransfer.findFirst({where:{id,accountId,propertyId:member.propertyId}});
  assert(t&&t.status==="READY"&&!await tx.pgTransferProof.findFirst({where:{transferId:id}}),409,"CANNOT_CANCEL","Submitted or uncertain payments need owner review. Do not pay again.");
  await tx.pgDirectTransfer.update({where:{id},data:{status:"CANCELLED"}});
  // A never-submitted legacy claim can be reused for the same invoice. Never
  // cancel/erase a submitted bank reference or any financial receipt.
  await audit(tx,accountId,member.organisationId,"DIRECT_TRANSFER_NO_DEBIT_CANCELLED",id);return {ok:true};
 });
}
export async function transferPage(accountId:string,membershipId:string,invoiceId:string){
 const {member,student,invoice}=await openInvoice(prisma,accountId,membershipId,invoiceId);
 const [bill,payee,transfers]=await Promise.all([prisma.pgElectricityBill.findUnique({where:{invoiceId}}),prisma.pgOwnerUpi.findUnique({where:{propertyId:member.propertyId}}),prisma.pgDirectTransfer.findMany({where:{invoiceId,accountId,propertyId:member.propertyId},orderBy:{createdAt:"desc"},take:30,select:{...transferSelect,proofs:{orderBy:{createdAt:"desc"},take:5,select:proofSelect}}})]);
 return {invoice:{id:invoice.id,year:invoice.year,month:invoice.month,rentPaise:invoice.rentPaise,remainingPaise:Math.max(0,invoice.totalPaise-invoice.paidPaise),electricityIncludedPaise:invoice.electricityPaise,status:invoice.status},bill,payee:payee?.enabled?{payeeName:payee.payeeName,upiAddress:payee.upiAddress}:null,transfers};
}
export async function transferDetail(accountId:string,membershipId:string,id:string){
 const m=await prisma.pgMembership.findFirst({where:{id:membershipId,accountId,status:"ACTIVE"}});assert(m,403,"WORKSPACE_REQUIRED","Select your workspace.");
 if(m.role==="OWNER")await ownerContext(prisma,accountId,m.propertyId);else await residentContext(prisma,accountId,membershipId);
 const t=await prisma.pgDirectTransfer.findFirst({where:{id,propertyId:m.propertyId,...(m.role==="OWNER"?{}:{accountId})},include:{proofs:{orderBy:{createdAt:"desc"},take:10,select:proofSelect}}});
 assert(t,404,"TRANSFER_NOT_FOUND","Payment not found.");
 const [invoice,bill,student,payee]=await Promise.all([prisma.rentInvoice.findUnique({where:{id:t.invoiceId}}),t.billId?prisma.pgElectricityBill.findUnique({where:{id:t.billId}}):null,prisma.student.findUnique({where:{id:t.studentId},include:{user:{select:{fullName:true}},room:{select:{number:true}}}}),prisma.pgOwnerUpi.findUnique({where:{propertyId:t.propertyId}})]);
 const balanceValid=!t.rentPaise||(invoice?.status==="DUE"&&invoice.totalPaise-invoice.paidPaise===t.rentPaise);
 const payeeValid=payee?.enabled&&payee.revision===t.payeeRevision&&payee.upiAddress===t.payeeAddress;
 return {transfer:t,bill,invoice:{year:invoice?.year,month:invoice?.month},resident:{name:student?.user.fullName,room:student?.room?.number},intent:t.status==="READY"&&balanceValid&&payeeValid?directIntent(t):null,issue:t.status==="READY"&&(!balanceValid||!payeeValid)?"The bill or owner's UPI details changed. Do not pay this old request; ask your owner to review it.":null};
}
export async function ownerTransfers(accountId:string,propertyId:string,cursor?:string){
 await ownerContext(prisma,accountId,propertyId);
 const rows=await prisma.pgDirectTransfer.findMany({where:{propertyId,...(cursor?{id:{lt:cursor}}:{})},orderBy:{id:"desc"},take:51,select:{...transferSelect,studentId:true,proofs:{where:{status:"PENDING"},take:1,select:proofSelect}}});
 const ids=[...new Set(rows.map(t=>t.studentId))];const students=await prisma.student.findMany({where:{id:{in:ids},propertyId},include:{user:{select:{fullName:true}},room:{select:{number:true}}}});
 return {transfers:rows.slice(0,50).map(t=>({...t,resident:students.find(s=>s.id===t.studentId)?.user.fullName||"Resident"})),nextCursor:rows.length>50?rows[49]!.id:null};
}
