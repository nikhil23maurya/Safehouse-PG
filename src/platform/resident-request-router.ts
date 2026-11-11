import express from "express";
import {z} from "zod";
import {rateLimit} from "express-rate-limit";
import {accountSession} from "./service.js";
import {myResidentRequests,propertyResidentRequests,decideResidentRequest,setupRequestedResident} from "./resident-requests.js";
export const residentRequestRouter=express.Router();
const current=(req:express.Request)=>accountSession((req.header("authorization")||"").replace(/^Bearer /,""));
const id=z.string().min(1).max(150),password=z.string().min(1).max(128);
residentRequestRouter.use((req,res,next)=>req.method==="GET"?next():mutations(req,res,next));
const mutations=rateLimit({windowMs:15*60000,limit:60,standardHeaders:"draft-8",legacyHeaders:false});
residentRequestRouter.get("/resident-requests",async(req,res)=>{const {account}=await current(req);res.json(await myResidentRequests(account.id));});
residentRequestRouter.get("/properties/:property/resident-requests",async(req,res)=>{const {account}=await current(req);const page=z.object({status:z.enum(["OPEN","ALL"]).default("OPEN"),cursor:id.optional()}).parse(req.query);res.json(await propertyResidentRequests(account.id,id.parse(req.params.property),undefined,page));});
residentRequestRouter.get("/properties/:property/resident-requests/:id",async(req,res)=>{const {account}=await current(req);res.json(await propertyResidentRequests(account.id,id.parse(req.params.property),id.parse(req.params.id)));});
residentRequestRouter.post("/properties/:property/resident-requests/:id/decision",async(req,res)=>{
 const {account}=await current(req),input=z.object({decision:z.enum(["ACCEPTED","REJECTED"]),password}).strict().parse(req.body);
 res.json(await decideResidentRequest(account.id,id.parse(req.params.property),id.parse(req.params.id),input.decision,input.password));
});
residentRequestRouter.post("/properties/:property/resident-requests/:id/rent",async(req,res)=>{
 const {account}=await current(req),input=z.object({roomId:id,bedLabel:z.string().trim().max(30).optional(),joiningDate:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),monthlyRentPaise:z.number().int().min(1).max(100000000),securityDepositPaise:z.number().int().min(0).max(1000000000),rentDueDay:z.number().int().min(1).max(28),mobile:z.string().regex(/^\+91[6-9]\d{9}$/),password,identityChecked:z.literal(true),existingStudentId:id.optional()}).strict().parse(req.body);
 res.json(await setupRequestedResident(account.id,id.parse(req.params.property),id.parse(req.params.id),input));
});
