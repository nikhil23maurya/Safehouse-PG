import express from "express";
import {rateLimit} from "express-rate-limit";
import {z} from "zod";
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
  const {code,fullName,mobile}=z.object({code:z.string().max(50),fullName:z.string().trim().min(2).max(100).optional(),mobile:z.string().regex(/^\+91[6-9]\d{9}$/).optional()}).strict().parse(req.body);
  const result=await joinProperty(account.id,code,{fullName,mobile});
  if(result.membership)res.json({tokens:await membershipTokens(account.id,result.membership.id,account.tokenVersion),membershipId:result.membership.id,joined:true});
  else res.json({pendingApproval:true,requestId:result.request!.id,status:result.request!.status});
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
