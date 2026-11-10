import {markPath,markFold} from "./brand.js";
import type {Response} from "express";
import PDFDocument from "pdfkit";
import {prisma} from "../db.js";
import {assert} from "../errors.js";
import {ownerOrganisation} from "./service.js";
export async function planReceipt(accountId:string,organisationId:string,receiptId:string,res:Response){
  const org=await ownerOrganisation(accountId,organisationId);
  const receipt=await prisma.pgPlanReceipt.findFirst({where:{id:receiptId,organisationId}});
  assert(receipt,404,"RECEIPT_NOT_FOUND","This receipt does not belong to your organisation.");
  res.setHeader("Cache-Control","no-store");res.setHeader("Content-Type","application/pdf");
  res.setHeader("Content-Disposition",`attachment; filename="${receipt.receiptNumber}.pdf"`);
  const doc=new PDFDocument({size:"A4",margin:48});doc.pipe(res);
  doc.save().translate(44,42).scale(.5).path(markPath).fill("#2056EF").path(markFold).fill("#0B2148").restore();
  doc.fillColor("#0B2148").font("Helvetica-Bold").fontSize(25).text("PGOne",84,48);doc.font("Helvetica").moveDown();doc.fillColor("#15213a").fontSize(16).text("Monthly access payment receipt");doc.moveDown();
  const date=(value:Date)=>value.toLocaleString("en-IN",{timeZone:"Asia/Kolkata"});
  const rows=[["Receipt",receipt.receiptNumber],["Organisation",org.name],["Payment",receipt.providerPaymentId],
    ["Paid",date(receipt.paidAt)],["Total",`INR ${(receipt.amountPaise/100).toFixed(2)}`],
    ["GST",receipt.taxPaise?`INR ${(receipt.taxPaise/100).toFixed(2)} included`:"Not charged"],
    ["Access from",date(receipt.periodStart)],["Access until",date(receipt.periodEnd)],
    ["Payment status",receipt.status],["Refunded",`INR ${(receipt.refundedPaise/100).toFixed(2)}`]];
  for(const [label,value]of rows)doc.fontSize(11).text(`${label}: ${value}`).moveDown(.5);
  doc.moveDown().fontSize(10).text("Manual monthly payment. No automatic debit. This receipt is for PGOne access; resident rent is separate.");doc.end();
}
