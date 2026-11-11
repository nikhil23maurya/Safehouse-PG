import express from "express";
import {z} from "zod";
import {prisma} from "../db.js";
import {assert} from "../errors.js";
import {accountSession,ownerOrganisation} from "./service.js";
import {entitlement} from "./billing.js";
import {PLAN_PAID_AMOUNTS} from "./config.js";
export const planStatusRouter=express.Router();
const current=(req:express.Request)=>accountSession((req.header("authorization")||"").replace(/^Bearer /,""));
const id=z.string().min(1).max(100);
planStatusRouter.use((_req,res,next)=>{res.setHeader("Cache-Control","no-store");next();});
// Presentation status for one exact provider order. Existing reconciliation
// remains the only writer of receipts and paid access.
planStatusRouter.get("/organisations/:id/plan/orders/:order/state",async(req,res)=>{
  const {account}=await current(req);
  const organisationId=id.parse(req.params.id);
  await ownerOrganisation(account.id,organisationId);
  const providerOrderId=z.string().regex(/^order_[a-zA-Z0-9]+$/).parse(req.params.order);
  const order=await prisma.pgPlanOrder.findFirst({where:{organisationId,providerOrderId},include:{receipt:true}});
  assert(order,404,"ORDER_NOT_FOUND","Payment request not found.");
  const receipt=order.receipt;
  const captured=receipt?.status==="CAPTURED"&&receipt.amountPaise===order.amountPaise&&PLAN_PAID_AMOUNTS.includes(receipt.amountPaise)&&receipt.refundedPaise===0;
  res.json({orderId:providerOrderId,status:order.status,captured,entitled:await entitlement(organisationId),
    receipt:captured?{id:receipt.id,number:receipt.receiptNumber,amountPaise:receipt.amountPaise,paidAt:receipt.paidAt,periodEnd:receipt.periodEnd}:null});
});
