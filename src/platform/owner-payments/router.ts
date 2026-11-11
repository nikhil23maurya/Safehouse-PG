import express,{type Request} from "express";
import {rateLimit} from "express-rate-limit";
import {z} from "zod";
import {prisma} from "../../db.js";
import {assert} from "../../errors.js";
import {accountSession,ownerOrganisation} from "../service.js";
import {ownerPaymentConfig} from "./config.js";
import {merchantView,startConnection,finishConnection,refreshConnection,disconnect} from "./merchant.js";
import {residentStatus,createRentOrder,checkoutSession,reconcileRentOrder} from "./rent.js";
import {collectionDashboard,reconcileSettlementDay} from "./settlements.js";
import {receiveOwnerWebhook} from "./webhooks.js";

export const ownerPaymentsRouter=express.Router(),ownerPaymentWebRouter=express.Router();
const id=z.string().min(1).max(100),limit=rateLimit({windowMs:15*60_000,limit:60,standardHeaders:"draft-8",legacyHeaders:false});
const session=(req:Request)=>accountSession((req.header("authorization")||"").replace(/^Bearer /,""),"access",true);
ownerPaymentsRouter.use(limit);
ownerPaymentsRouter.get("/organisations/:id",async(req,res)=>{const {account}=await session(req);res.json(await merchantView(account.id,id.parse(req.params.id)));});
ownerPaymentsRouter.post("/organisations/:id/connect",async(req,res)=>{
 const {account,claims}=await session(req);assert(!account.passwordChangeRequired&&claims.sid,403,"ACCOUNT_CONFIRMATION_REQUIRED","Finish account setup before connecting payments.");
 z.object({accepted:z.literal(true)}).strict().parse(req.body);
 res.json(await startConnection(account.id,id.parse(req.params.id),claims.sid));
});
ownerPaymentsRouter.post("/organisations/:id/recheck",async(req,res)=>{
 const {account}=await session(req),org=id.parse(req.params.id);await ownerOrganisation(account.id,org);
 const auth=await prisma.pgOwnerAuthorization.findFirst({where:{merchant:{organisationId:org},current:true,mode:ownerPaymentConfig().RAZORPAY_OWNER_MODE}});
 if(auth)await refreshConnection(auth.id);res.json(await merchantView(account.id,org));
});
ownerPaymentsRouter.post("/organisations/:id/disconnect",async(req,res)=>{
 const {account}=await session(req),input=z.object({password:z.string().min(1).max(128)}).strict().parse(req.body);
 await disconnect(account.id,id.parse(req.params.id),input.password);res.json({disconnected:true});
});
ownerPaymentsRouter.get("/organisations/:id/collections",async(req,res)=>{
 const {account}=await session(req),period=z.object({year:z.coerce.number().int().min(2020).max(2100),month:z.coerce.number().int().min(1).max(12)}).parse(req.query);
 res.json(await collectionDashboard(account.id,id.parse(req.params.id),period.year,period.month));
});
ownerPaymentsRouter.post("/organisations/:id/settlements/recheck",async(req,res)=>{
 const {account}=await session(req),org=id.parse(req.params.id);await ownerOrganisation(account.id,org);
 const date=z.object({year:z.number().int().min(2020).max(2100),month:z.number().int().min(1).max(12),day:z.number().int().min(1).max(31)}).strict().parse(req.body);
 assert(new Date(Date.UTC(date.year,date.month-1,date.day)).getUTCMonth()===date.month-1,400,"INVALID_SETTLEMENT_DATE","Choose a valid date.");
 const auth=await prisma.pgOwnerAuthorization.findFirst({where:{merchant:{organisationId:org},current:true,mode:ownerPaymentConfig().RAZORPAY_OWNER_MODE}});assert(auth,409,"OWNER_MERCHANT_UNAVAILABLE","Connect your payment account first.");
 await reconcileSettlementDay(auth.id,date);res.json({checked:true});
});
ownerPaymentsRouter.get("/invoices/:id",async(req,res)=>{const {account,membership}=await session(req);assert(membership,403,"WORKSPACE_REQUIRED","Select your residency.");res.json(await residentStatus(account.id,membership.id,id.parse(req.params.id)));});
ownerPaymentsRouter.post("/invoices/:id/orders",async(req,res)=>{
 const {account,membership}=await session(req);assert(membership,403,"WORKSPACE_REQUIRED","Select your residency.");
 const input=z.object({requestKey:z.string().regex(/^[A-Za-z0-9_-]{16,100}$/)}).strict().parse(req.body);
 res.json(await createRentOrder(account.id,membership.id,id.parse(req.params.id),input.requestKey));
});
ownerPaymentsRouter.post("/invoices/:id/orders/:orderId/checkout",async(req,res)=>{
 const {account,membership}=await session(req);assert(membership,403,"WORKSPACE_REQUIRED","Select your residency.");
 res.json(await checkoutSession(account.id,membership.id,id.parse(req.params.id),id.parse(req.params.orderId)));
});
ownerPaymentsRouter.post("/invoices/:id/orders/:orderId/recheck",async(req,res)=>{
 const {account,membership}=await session(req);assert(membership,403,"WORKSPACE_REQUIRED","Select your residency.");
 const invoice=id.parse(req.params.id),orderId=id.parse(req.params.orderId);await residentStatus(account.id,membership.id,invoice);
 const order=await prisma.pgOwnerRentOrder.findFirst({where:{id:orderId,invoiceId:invoice,accountId:account.id,propertyId:membership.propertyId}});assert(order,404,"OWNER_RENT_ORDER_NOT_FOUND","This payment request is not part of your residency.");
 await reconcileRentOrder(order.id);res.json(await residentStatus(account.id,membership.id,invoice));
});

// Mounted before any JSON parser or workspace middleware. No provider secrets,
// authorization code or state are reflected into the returned HTML.
ownerPaymentWebRouter.post("/webhook",express.raw({type:"application/json",limit:"1mb"}),async(req,res)=>{assert(Buffer.isBuffer(req.body),400,"OWNER_WEBHOOK_RAW_BODY_REQUIRED","Raw webhook body required.");res.status(202).json(await receiveOwnerWebhook(req.body,req.header("x-razorpay-signature"),req.header("x-razorpay-event-id")));});
ownerPaymentWebRouter.get("/callback",async(req,res)=>{
 res.set({"Cache-Control":"no-store","Referrer-Policy":"no-referrer"});
 let done=false;
 try{await finishConnection(z.string().max(100).parse(req.query.state),typeof req.query.code==="string"?req.query.code:undefined,Boolean(req.query.error));done=!req.query.error;}catch{/* The owner gets a safe, authenticated status inside PGOne. */}
 res.status(done?200:400).type("html").send(`<!doctype html><html lang="en"><meta name="viewport" content="width=device-width,initial-scale=1"><title>PGOne payment account</title><body><h1>${done?"Connection received":"Connection not completed"}</h1><p>${done?"Return to PGOne to check your merchant verification. A connected account is not automatically approved for rent collection.":"Return to PGOne and start the secure connection again. Your rent collection has not been activated."}</p><a href="pgone://payments/return">Return to PGOne</a></body></html>`);
});
