import express from "express";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import { prisma } from "../db.js";
import { assert } from "../errors.js";
import { createTokenPair, verifyToken } from "../security.js";
import { atomic, audit, accountSession, linkLegacy, accountSnapshot } from "./service.js";
import { normalizedEmail, passwordHash, passwordMatches } from "./passwords.js";
import { issueSession } from "./sessions.js";
import { hash, randomCode } from "./tokens.js";

export const emailInput = z.string().trim().toLowerCase().max(254).pipe(z.email());
export const passwordInput = z.string().min(12, "Use at least 12 characters.").max(128);
const credentials = z.object({email:emailInput,password:z.string().min(1).max(128)}).strict();
const tokenInput = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
export const mailReady = () => Boolean(process.env.PGONE_MAIL_API_KEY && process.env.PGONE_MAIL_FROM &&
  /^https:\/\//.test(process.env.PGONE_ACCOUNT_WEB_ORIGIN || "https://safehouse-api.onrender.com"));
export type Mailer = (email:string, purpose:string, token:string) => Promise<void>;
export const sendAccountEmail: Mailer = async (email,purpose,token) => {
  assert(mailReady(),503,"EMAIL_DELIVERY_UNAVAILABLE","Account email delivery is not activated. Contact PGOne support.");
  const origin = new URL(process.env.PGONE_ACCOUNT_WEB_ORIGIN || "https://safehouse-api.onrender.com").origin;
  const link = `${origin}/account/#purpose=${encodeURIComponent(purpose)}&token=${encodeURIComponent(token)}`;
  const subject = purpose === "RESET" ? "Reset your PGOne password" : "Confirm your PGOne email";
  const response = await fetch("https://api.resend.com/emails",{method:"POST",signal:AbortSignal.timeout(12000),
    headers:{authorization:`Bearer ${process.env.PGONE_MAIL_API_KEY}`,"content-type":"application/json"},
    body:JSON.stringify({from:process.env.PGONE_MAIL_FROM,to:[email],subject,
      text:`${subject}\n\nOpen this link within 15 minutes:\n${link}\n\nIf you did not request this, ignore this email. Never share this link.`})});
  assert(response.ok,503,"EMAIL_DELIVERY_UNAVAILABLE","The account email could not be sent. Try again later.");
};

export async function registerEmail(email:string,password:string) {
  email = emailInput.parse(email); passwordInput.parse(password);
  const digest = await passwordHash(password);
  return atomic(async tx => {
    const [accounts,legacy] = await Promise.all([
      tx.pgAccount.count({where:{OR:[{credentialEmail:email},{email:{equals:email,mode:"insensitive"}}]}}),
      tx.user.count({where:{email:{equals:email,mode:"insensitive"},passwordHash:{not:null}}}),
    ]);
    assert(!accounts && !legacy,409,"ACCOUNT_EXISTS","An account already uses this email. Sign in or recover your existing account.");
    const account = await tx.pgAccount.create({data:{email,credentialEmail:email,passwordHash:digest}});
    await audit(tx,account.id,null,"EMAIL_ACCOUNT_CREATED",account.id);
    return account;
  });
}

export async function loginEmail(email:string,password:string) {
  email = emailInput.parse(email);
  const attempts=await prisma.pgAudit.count({where:{action:"EMAIL_LOGIN_FAILED",entityId:hash(email),createdAt:{gt:new Date(Date.now()-15*60000)}}});
  assert(attempts<20,429,"LOGIN_RATE_LIMIT","Too many sign-in attempts. Try again in 15 minutes.");
  let account = await prisma.pgAccount.findUnique({where:{credentialEmail:email}});
  if (account?.passwordHash) {
    assert(account.status === "ACTIVE" && await passwordMatches(password,account.passwordHash),401,"INVALID_CREDENTIALS","Invalid email or password.");
    if(account.passwordHash.startsWith("scrypt$")) {
      const upgraded=await passwordHash(password);
      await prisma.pgAccount.updateMany({where:{id:account.id,passwordHash:account.passwordHash},data:{passwordHash:upgraded}});
    }
    return account;
  }
  // Only a proven legacy password may map its existing actor and memberships.
  const legacy = await prisma.user.findMany({where:{email:{equals:email,mode:"insensitive"}},take:2});
  const user = legacy.length === 1 ? legacy[0] : undefined;
  assert(user && user.status === "ACTIVE" && await passwordMatches(password,user.passwordHash),
    401,"INVALID_CREDENTIALS","Invalid email or password.");
  const claims = await prisma.pgAccount.findMany({where:{email:{equals:email,mode:"insensitive"}},take:3});
  assert(claims.every(a => a.legacyUserId === user.id),409,"ACCOUNT_RECOVERY_REVIEW",
    "Historical accounts share this email. Support must verify ownership before linking records.");
  // A temporary-password resident must choose their own password before operational access.
  // linkLegacy retains its requirement; clear only after proving the stored password.
  const originalTemporary = user.mustChangePassword;
  account = await linkLegacy(createTokenPair(user).accessToken,undefined,undefined,true);
  const digest = await passwordHash(password);
  return atomic(async tx => {
    const current = await tx.pgAccount.findUniqueOrThrow({where:{id:account!.id}});
    assert(!current.passwordHash && (!current.credentialEmail || current.credentialEmail === email),409,"ACCOUNT_RECOVERY_REVIEW","Use your existing PGOne password or account recovery.");
    const updated = await tx.pgAccount.update({where:{id:current.id},data:{email,credentialEmail:email,passwordHash:digest,
      passwordChangeRequired:originalTemporary,tokenVersion:{increment:1}}});
    await tx.user.update({where:{id:user.id},data:{passwordHash:null,tokenVersion:{increment:1}}});
    await audit(tx,current.id,null,"LEGACY_PASSWORD_MIGRATED",user.id);
    return updated;
  });
}

/** A valid historical session proves its actor; matching email alone never does. */
export async function upgradeLegacySession(token:string) {
  const claims=verifyToken(token,"refresh");
  const user=await prisma.user.findUnique({where:{id:claims.sub}});
  assert(user&&user.status==="ACTIVE"&&user.tokenVersion===claims.ver&&user.role===claims.role&&user.passwordHash&&user.email,
    401,"SESSION_INVALID","Sign in with your existing email and password.");
  const email=normalizedEmail(user.email);
  const conflicts=await prisma.pgAccount.findMany({where:{OR:[{credentialEmail:email},{email:{equals:email,mode:"insensitive"}}]}});
  assert(conflicts.every(a=>a.legacyUserId===user.id),409,"ACCOUNT_RECOVERY_REVIEW","Historical identities need ownership review. Sign in or contact support.");
  const account=await linkLegacy(createTokenPair(user).accessToken,undefined,undefined,true);
  const updated=await atomic(async tx=>{
    const actor=await tx.user.findUniqueOrThrow({where:{id:user.id}});
    assert(actor.tokenVersion===claims.ver&&actor.passwordHash===user.passwordHash,401,"SESSION_INVALID","Your account changed. Sign in again.");
    const result=await tx.pgAccount.update({where:{id:account.id},data:{email,credentialEmail:email,passwordHash:user.passwordHash,
      passwordChangeRequired:user.mustChangePassword,tokenVersion:{increment:1}}});
    await tx.user.update({where:{id:user.id},data:{passwordHash:null,tokenVersion:{increment:1}}});
    await audit(tx,account.id,null,"LEGACY_SESSION_MIGRATED",user.id);return result;
  });
  const memberships=await prisma.pgMembership.findMany({where:{accountId:account.id,status:"ACTIVE"},take:2});
  return issueSession(updated,memberships.length===1?memberships[0]!.id:null);
}
export async function legacyRefreshHandler(req:express.Request,res:express.Response){
  const {refreshToken}=z.object({refreshToken:z.string().min(20).max(8192)}).parse(req.body);
  res.json({tokens:await upgradeLegacySession(refreshToken)});
}

export async function requestEmailAction(accountId:string,purpose:"RESET"|"VERIFY"|"ENROL",mailer:Mailer=sendAccountEmail,
  enrol?:{email:string;password:string}) {
  const account = await prisma.pgAccount.findUniqueOrThrow({where:{id:accountId}});
  const email = enrol ? emailInput.parse(enrol.email) : account.credentialEmail;
  assert(email && account.status === "ACTIVE",409,"ACCOUNT_RECOVERY_REVIEW","This historical account needs assisted ownership recovery.");
  if (enrol) {
    const existing = await prisma.pgAccount.findFirst({where:{id:{not:accountId},OR:[{credentialEmail:email},{email:{equals:email,mode:"insensitive"}}]}});
    const legacy = await prisma.user.findFirst({where:{email:{equals:email,mode:"insensitive"},id:{not:account.legacyUserId || ""}}});
    assert(!existing && !legacy && !account.passwordHash,409,"ACCOUNT_EXISTS","Use an email that is not linked to another account.");
  }
  const pendingHash = enrol ? await passwordHash(passwordInput.parse(enrol.password)) : null;
  const token = randomCode();
  const action = await atomic(async tx => {
    const recent = await tx.pgEmailAction.count({where:{accountId,purpose,createdAt:{gt:new Date(Date.now()-60000)}}});
    assert(!recent,429,"EMAIL_RATE_LIMIT","Wait a minute before requesting another email.");
    return tx.pgEmailAction.create({data:{accountId,email,purpose,tokenHash:hash(token),passwordHash:pendingHash,
      expiresAt:new Date(Date.now()+15*60000)}});
  });
  try { await mailer(email,purpose,token); }
  catch (error) { await prisma.pgEmailAction.update({where:{id:action.id},data:{usedAt:new Date()}}); throw error; }
}
export async function consumeEmailAction(token:string,purpose:"RESET"|"VERIFY"|"ENROL",password?:string) {
  tokenInput.parse(token);
  const digest = purpose === "RESET" ? await passwordHash(passwordInput.parse(password)) : null;
  return atomic(async tx => {
    const action = await tx.pgEmailAction.findUnique({where:{tokenHash:hash(token)},include:{account:true}});
    assert(action && action.purpose === purpose && !action.usedAt && action.expiresAt > new Date() && action.account.status === "ACTIVE",
      400,"EMAIL_LINK_INVALID","This link is invalid, used or expired. Request a new email.");
    assert(purpose === "ENROL" || action.email === action.account.credentialEmail,400,"EMAIL_LINK_INVALID","Your account email changed. Request a new link.");
    const claimed = await tx.pgEmailAction.updateMany({where:{id:action.id,usedAt:null},data:{usedAt:new Date()}});
    assert(claimed.count === 1,400,"EMAIL_LINK_INVALID","This link has already been used.");
    const changes = purpose !== "VERIFY";
    if (purpose === "ENROL") assert(!action.account.passwordHash && action.passwordHash,409,"ACCOUNT_EXISTS","Email sign-in is already configured.");
    const account = await tx.pgAccount.update({where:{id:action.accountId},data:{emailVerified:true,
      ...(changes ? {passwordHash:digest || action.passwordHash,credentialEmail:action.email,email:action.email,
        passwordChangeRequired:false,tokenVersion:{increment:1}} : {})}});
    if (changes) {
      await tx.pgSession.updateMany({where:{accountId:account.id,revokedAt:null},data:{revokedAt:new Date()}});
      await tx.pgEmailAction.updateMany({where:{accountId:account.id,usedAt:null},data:{usedAt:new Date()}});
      if (account.legacyUserId) await tx.user.update({where:{id:account.legacyUserId},data:{passwordHash:null,tokenVersion:{increment:1},mustChangePassword:false}});
    }
    await audit(tx,account.id,null,`EMAIL_${purpose}_COMPLETED`,action.id);
    return {ok:true};
  });
}
export async function changeEmailPassword(accountId:string,currentPassword:string,newPassword:string) {
  const account = await prisma.pgAccount.findUniqueOrThrow({where:{id:accountId}});
  assert(await passwordMatches(currentPassword,account.passwordHash),400,"CURRENT_PASSWORD_WRONG","Current password is incorrect.");
  const digest = await passwordHash(passwordInput.parse(newPassword));
  return atomic(async tx => {
    const changed = await tx.pgAccount.updateMany({where:{id:accountId,passwordHash:account.passwordHash,tokenVersion:account.tokenVersion},
      data:{passwordHash:digest,passwordChangeRequired:false,tokenVersion:{increment:1}}});
    assert(changed.count === 1,409,"ACCOUNT_CHANGED","Your credentials changed. Sign in again.");
    await tx.pgSession.updateMany({where:{accountId,revokedAt:null},data:{revokedAt:new Date()}});
    await tx.pgEmailAction.updateMany({where:{accountId,usedAt:null},data:{usedAt:new Date()}});
    if (account.legacyUserId) await tx.user.update({where:{id:account.legacyUserId},data:{passwordHash:null,tokenVersion:{increment:1},mustChangePassword:false}});
    await audit(tx,accountId,null,"PASSWORD_CHANGED",accountId);
    return tx.pgAccount.findUniqueOrThrow({where:{id:accountId}});
  });
}

export const emailAuthRouter = express.Router();
const limiter = rateLimit({windowMs:15*60000,limit:20,standardHeaders:"draft-8",legacyHeaders:false});
emailAuthRouter.use(limiter,(_req,res,next)=>{res.setHeader("Cache-Control","no-store");next();});
const current = (req:express.Request) => accountSession((req.header("authorization") || "").replace(/^Bearer /,""),"access",true);
emailAuthRouter.post("/register",async(req,res)=>{
  const input = credentials.extend({password:passwordInput}).parse(req.body);
  const account = await registerEmail(input.email,input.password);
  res.status(201).json({tokens:await issueSession(account),...(await accountSnapshot(account.id))});
});
export async function emailLoginHandler(req:express.Request,res:express.Response) {
  const input = credentials.parse(req.body);
  let account;
  try { account=await loginEmail(input.email,input.password); }
  catch(error:any){
    if(error.code === "INVALID_CREDENTIALS") await prisma.pgAudit.create({data:{action:"EMAIL_LOGIN_FAILED",entityId:hash(input.email)}});
    throw error;
  }
  const memberships = await prisma.pgMembership.findMany({where:{accountId:account.id,status:"ACTIVE"},take:2});
  res.json({tokens:await issueSession(account,memberships.length === 1 ? memberships[0]!.id : null)});
}
emailAuthRouter.post("/login",emailLoginHandler);
emailAuthRouter.post("/forgot-password",async(req,res)=>{
  const email = emailInput.parse(req.body.email);
  assert(mailReady(),503,"EMAIL_DELIVERY_UNAVAILABLE","Account recovery email is not activated. Contact PGOne support.");
  const account = await prisma.pgAccount.findUnique({where:{credentialEmail:email}});
  if (account?.passwordHash && account.status === "ACTIVE") {
    try { await requestEmailAction(account.id,"RESET"); }
    catch { /* Same public response for throttled, inactive and unknown accounts. Monitor provider separately. */ }
  }
  res.json({ok:true,message:"If this email has an eligible account, a recovery link will arrive shortly."});
});
emailAuthRouter.post("/email-link",async(req,res)=>{
  const {account} = await current(req);
  await requestEmailAction(account.id,"VERIFY"); res.json({ok:true});
});
emailAuthRouter.post("/enrol-email",async(req,res)=>{
  const {account} = await current(req);
  const input = credentials.extend({password:passwordInput}).parse(req.body);
  await requestEmailAction(account.id,"ENROL",sendAccountEmail,input); res.json({ok:true});
});
emailAuthRouter.post("/complete",async(req,res)=>{
  const input = z.object({token:tokenInput,purpose:z.enum(["RESET","VERIFY","ENROL"]),password:passwordInput.optional()}).strict().parse(req.body);
  res.json(await consumeEmailAction(input.token,input.purpose,input.password));
});
emailAuthRouter.post("/change-password",async(req,res)=>{
  const {account,membership} = await current(req);
  const input = z.object({currentPassword:z.string().min(1).max(128),newPassword:passwordInput}).strict().parse(req.body);
  const updated = await changeEmailPassword(account.id,input.currentPassword,input.newPassword);
  res.json({ok:true,tokens:await issueSession(updated,membership?.id || null)});
});
