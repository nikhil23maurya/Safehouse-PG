import express from "express";
import {rateLimit} from "express-rate-limit";
import {z} from "zod";
import {prisma} from "../db.js";
import {assert} from "../errors.js";
import {accountSession,atomic,audit,membershipTokens} from "./service.js";
import {joinProperty,propertyJoinCode,manageJoinCode,joinedResidents,linkResidentRecord} from "./join-codes.js";

export const joinCodeRouter=express.Router();
const current=(req:express.Request)=>accountSession((req.header("authorization")||"").replace(/^Bearer /,""));
const id=z.string().min(1).max(100);
joinCodeRouter.use((_req,res,next)=>{res.setHeader("Cache-Control","no-store");next();});
joinCodeRouter.post("/onboarding-intent",async(req,res)=>{
  const {account}=await current(req);
  const {intent}=z.object({intent:z.enum(["OWNER","RESIDENT"])}).strict().parse(req.body);
  await atomic(async tx=>{
    await tx.pgAccount.update({where:{id:account.id},data:{setupIntent:intent}});
    await audit(tx,account.id,null,"ONBOARDING_INTENT_SELECTED",account.id,{intent});
  });
  res.json({ok:true,intent});
});
joinCodeRouter.post("/join",rateLimit({windowMs:15*60000,limit:40,standardHeaders:"draft-8",legacyHeaders:false}),async(req,res)=>{
  const {account}=await current(req);
  const {code}=z.object({code:z.string().max(50)}).strict().parse(req.body);
  const membership=await joinProperty(account.id,code);
  res.json({tokens:await membershipTokens(account.id,membership.id,account.tokenVersion),membershipId:membership.id,joined:true});
});
joinCodeRouter.get("/properties/:id/join-code",async(req,res)=>{
  const {account}=await current(req);res.json(await propertyJoinCode(account.id,id.parse(req.params.id)));
});
joinCodeRouter.post("/properties/:id/join-code",async(req,res)=>{
  const {account}=await current(req);
  const {action}=z.object({action:z.enum(["ENSURE","ROTATE","DISABLE"])}).strict().parse(req.body);
  res.json(await manageJoinCode(account.id,id.parse(req.params.id),action));
});
joinCodeRouter.get("/properties/:id/joined-residents",async(req,res)=>{
  const {account}=await current(req);res.json(await joinedResidents(account.id,id.parse(req.params.id)));
});
joinCodeRouter.post("/properties/:id/resident-record",async(req,res)=>{
  const {account}=await current(req);
  const input=z.object({membershipId:id,studentId:id,password:z.string().min(1).max(128),identityChecked:z.literal(true)}).strict().parse(req.body);
  res.json(await linkResidentRecord(account.id,id.parse(req.params.id),input));
});
// Presentation status for one exact provider order. Existing reconciliation
// remains the only writer of receipts and paid access.
joinCodeRouter.get("/organisations/:id/plan/orders/:order/state",async(req,res)=>{
  const {account}=await current(req);
  const organisationId=id.parse(req.params.id);
  const {ownerOrganisation}=await import("./service.js");
  await ownerOrganisation(account.id,organisationId);
  const providerOrderId=z.string().regex(/^order_[a-zA-Z0-9]+$/).parse(req.params.order);
  const order=await prisma.pgPlanOrder.findFirst({where:{organisationId,providerOrderId},include:{receipt:true}});
  assert(order,404,"ORDER_NOT_FOUND","Payment request not found.");
  const receipt=order.receipt;
  const captured=receipt?.status==="CAPTURED"&&receipt.amountPaise===24900&&receipt.refundedPaise===0;
  res.json({orderId:providerOrderId,status:order.status,captured,
    receipt:captured?{id:receipt.id,number:receipt.receiptNumber,amountPaise:receipt.amountPaise,paidAt:receipt.paidAt,periodEnd:receipt.periodEnd}:null});
});
