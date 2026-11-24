import express from "express";
import {z} from "zod";
import {rateLimit} from "express-rate-limit";
import PDFDocument from "pdfkit";
import {assert} from "../errors.js";
import {prisma} from "../db.js";
import {accountSession} from "./service.js";
import {entitlement} from "./billing.js";
import {storeEvidence,readEvidence,ownerContext} from "./rent-evidence.js";
import {saveElectricity,prepareTransfer,submitProof,reviewTransfer,cancelTransfer,transferPage,transferDetail,ownerTransfers,reconcileTransfers} from "./direct-transfers.js";
import {readOwnerDirectOverview} from "./owner-direct-overview.js";

export const directTransferRouter=express.Router();
const key=z.string().regex(/^[A-Za-z0-9_-]{16,100}$/),id=z.string().min(1).max(100);
const period = {
  year: z.coerce.number().int().min(2020).max(2100),
  month: z.coerce.number().int().min(1).max(12),
};
const bankReference = z.string().min(6).max(40);
const session=async(req:express.Request)=>{
 const s=await accountSession((req.header("authorization")||"").replace(/^Bearer /,""));
 assert(s.membership,403,"WORKSPACE_REQUIRED","Select your workspace.");return {...s,membership:s.membership!};
};
directTransferRouter.use((_req,res,next)=>{res.setHeader("Cache-Control","private, no-store");next();});
directTransferRouter.post("/evidence",rateLimit({windowMs:900000,limit:30,standardHeaders:"draft-8",legacyHeaders:false}),async(req,res)=>{
 const {account,membership}=await session(req);const input=z.object({purpose:z.enum(["METER","PAYMENT"]),image:z.string().max(699052)}).strict().parse(req.body);
 res.status(201).json(await storeEvidence(account.id,membership.id,input.purpose,input.image));
});
directTransferRouter.get("/evidence/:id",async(req,res)=>{
 const {account,membership}=await session(req);const bytes=await readEvidence(account.id,membership.id,id.parse(req.params.id));
 res.setHeader("Content-Type","image/jpeg");res.setHeader("X-Content-Type-Options","nosniff");res.setHeader("Content-Disposition","inline; filename=payment-evidence.jpg");res.send(bytes);
});
directTransferRouter.get("/invoices/:id",async(req,res)=>{const {account,membership}=await session(req);res.json(await transferPage(account.id,membership.id,id.parse(req.params.id)));});
directTransferRouter.post("/invoices/:id/electricity",async(req,res)=>{
 const {account,membership}=await session(req);const input=z.object({amountPaise:z.number().int().min(1).max(10000000),meterEvidenceId:id}).strict().parse(req.body);
 res.json({bill:await saveElectricity(account.id,membership.id,id.parse(req.params.id),input)});
});
directTransferRouter.post("/invoices/:id/transfers",async(req,res)=>{
 const {account,membership}=await session(req);const input=z.object({rent:z.boolean(),electricity:z.boolean(),key}).strict().parse(req.body);
 const transfer=await prepareTransfer(account.id,membership.id,id.parse(req.params.id),input);res.json({transferId:transfer.id});
});
directTransferRouter.get("/owner",async(req,res)=>{const {account,membership}=await session(req);res.json(await ownerTransfers(account.id,membership.propertyId,req.query.cursor?id.parse(req.query.cursor):undefined));});
directTransferRouter.get("/owner/overview", async (req, res) => {
  const { account, membership } = await session(req);
  const input = z.object({
    ...period,
    view: z.enum(["overview", "proofs", "electricity"]).default("overview"),
    cursor: id.optional(),
    due: z.string().max(505).optional(),
  }).parse(req.query);
  const dueInvoiceIds = z.array(id).max(5).parse(input.due ? input.due.split(",") : []);
  assert(membership.role === "OWNER", 403, "FORBIDDEN", "Select your owner workspace.");
  await ownerContext(prisma, account.id, membership.propertyId);
  assert(await entitlement(membership.organisationId), 402, "SUBSCRIPTION_REQUIRED", "Renew PGOne before managing payments.");
  res.json(await readOwnerDirectOverview(membership.propertyId, input, input.view, input.cursor, dueInvoiceIds));
});
directTransferRouter.post("/owner/reconcile", async (req, res) => {
  const { account, membership } = await session(req);
  assert(membership.role === "OWNER", 403, "FORBIDDEN", "Select your owner workspace.");
  assert(await entitlement(membership.organisationId), 402, "SUBSCRIPTION_REQUIRED", "Renew PGOne before managing payments.");
  const input = z.object({
    ...period,
    amountPaise: z.number().int().positive(),
    bankChecked: z.literal(true),
    payments: z.array(z.object({ transferId: id, proofId: id, bankReference }).strict()).min(1).max(10),
  }).strict().parse(req.body);
  res.json(await reconcileTransfers(account.id, membership.propertyId, input));
});
directTransferRouter.get("/history",async(req,res)=>{
 const {account,membership}=await session(req);assert(membership.role==="RESIDENT",403,"RESIDENT_REQUIRED","Select your residency.");
 const rows=await prisma.pgDirectTransfer.findMany({where:{accountId:account.id,propertyId:membership.propertyId,status:"CONFIRMED"},orderBy:{confirmedAt:"desc"},take:100,select:{id:true,invoiceId:true,status:true,rentPaise:true,electricityPaise:true,amountPaise:true,receiptNumber:true,rentPaymentId:true,confirmedAt:true}});res.json({transfers:rows});
});
directTransferRouter.get("/transfers/:id",async(req,res)=>{const {account,membership}=await session(req);res.json(await transferDetail(account.id,membership.id,id.parse(req.params.id)));});
directTransferRouter.post("/transfers/:id/proof",async(req,res)=>{
 const {account,membership}=await session(req);const input=z.object({bankReference:bankReference.optional(),evidenceId:id,key}).strict().parse(req.body);
 res.json({proof:await submitProof(account.id,membership.id,id.parse(req.params.id),input)});
});
directTransferRouter.post("/transfers/:id/cancel",async(req,res)=>{
 const {account,membership}=await session(req);z.object({noDebit:z.literal(true)}).strict().parse(req.body);res.json(await cancelTransfer(account.id,membership.id,id.parse(req.params.id)));
});
directTransferRouter.post("/transfers/:id/review",async(req,res)=>{
 const {account,membership}=await session(req);assert(membership.role==="OWNER",403,"FORBIDDEN","Select your owner workspace.");
 assert(await entitlement(membership.organisationId),402,"SUBSCRIPTION_REQUIRED","Renew PGOne before managing payments.");
 const input=z.object({proofId:id,approve:z.boolean(),bankChecked:z.boolean().optional(),bankReference:bankReference.optional(),reason:z.string().max(500).optional(),existingRentReceipt:z.string().max(100).optional()}).strict().parse(req.body);
 res.json({transfer:await reviewTransfer(account.id,membership.propertyId,id.parse(req.params.id),input)});
});
directTransferRouter.get("/transfers/:id/receipt.pdf",async(req,res)=>{
 const {account,membership}=await session(req);const {transfer:t,invoice,resident}=await transferDetail(account.id,membership.id,id.parse(req.params.id));
 assert(t.status==="CONFIRMED",409,"NOT_CONFIRMED","Your owner must verify the bank credit before a receipt is issued.");
 const property=await prisma.property.findUniqueOrThrow({where:{id:membership.propertyId}});
 res.setHeader("Content-Type","application/pdf");res.setHeader("Content-Disposition",`attachment; filename="${t.receiptNumber}.pdf"`);
 const pdf=new PDFDocument({margin:48});pdf.pipe(res);
 const rupees=(p:number)=>`INR ${(p/100).toFixed(2)}`;
 pdf.fontSize(22).text(property.name).moveDown().fontSize(16).text("Owner-confirmed payment receipt").moveDown().fontSize(11);
 for(const [label,value] of [["Receipt",t.receiptNumber],["Resident",resident.name],["Billing month",`${invoice.month}/${invoice.year}`],["Rent / invoice charges",rupees(t.rentPaise)],["Separate electricity",rupees(t.electricityPaise)],["Total received",rupees(t.amountPaise)],["Payee UPI",t.payeeAddress],["Bank reference",t.proofs.find(p=>p.status==="APPROVED")?.bankReference],["Confirmed",t.confirmedAt?.toISOString()]])pdf.text(`${label}: ${value||"-"}`).moveDown(0.5);
 pdf.moveDown().text("Confirmed by the PG owner after checking their bank. This is not gateway-verified payment confirmation. The rent portion is the same receipt credit recorded in rent history; do not add it again.");pdf.end();
});
