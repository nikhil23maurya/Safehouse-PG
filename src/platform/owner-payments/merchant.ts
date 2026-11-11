import {ownerAtomic as atomic} from "./transaction.js";
import crypto from "node:crypto";
import type {PgOwnerAuthorization} from "../../generated/prisma/client.js";
import {prisma} from "../../db.js";
import {assert,AppError} from "../../errors.js";
import {audit,ownerOrganisation} from "../service.js";
import {entitlement} from "../billing.js";
import {passwordMatches} from "../passwords.js";
import {ownerPaymentConfig,requireOwnerPayments} from "./config.js";
import {bankFingerprint,digest,seal,unseal} from "./crypto.js";
import {authorizationUrl,razorpayOwnerProvider,type OwnerProvider,type MerchantToken} from "./provider.js";

export const ONBOARDING_STATES=["NOT_CONNECTED","DRAFT","ONBOARDING_STARTED","DETAILS_SUBMITTED","KYC_PENDING","ACTION_REQUIRED","UNDER_REVIEW","VERIFIED","ACTIVATED","REJECTED","SUSPENDED","DISABLED"] as const;
export function mapAccount(account:any,prior?:any) {
 const states:Record<string,string>={created:account?.merchant_detail?.submitted?"DETAILS_SUBMITTED":"KYC_PENDING",needs_clarification:"ACTION_REQUIRED",under_review:"UNDER_REVIEW",activated:"VERIFIED",suspended:"SUSPENDED",rejected:"REJECTED"};
 const raw=account.status||(account.activated===true?"activated":account.merchant_detail?.activation_status);
 const status=states[raw]||"ACTION_REQUIRED";
 const activated=raw==="activated";
 const bank=account.merchant_detail?.bank_details_verification_status;
 // 'live' and 'hold_funds' are the documented acceptance/settlement capabilities.
 // An explicit pending bank check overrides them; absent fields never erase it.
 const bankStatus=bank==="verified"?"VERIFIED":bank?"PENDING":prior?.bankStatus==="PENDING"?"PENDING":activated&&account.live===true&&account.hold_funds===false?"PROVIDER_CONFIRMED":"UNKNOWN";
 return {status,accountActivated:activated,paymentEnabled:activated&&account.live===true,
  bankStatus,settlementReady:activated&&account.hold_funds===false&&["VERIFIED","PROVIDER_CONFIRMED"].includes(bankStatus)};
}
export function canCollect(auth:any) {
 return Boolean(auth?.current&&auth.status==="ACTIVATED"&&auth.accountActivated&&auth.productActivated&&auth.paymentEnabled&&auth.settlementReady&&auth.accessCipher&&auth.publicToken);
}
export async function merchantView(accountId:string,organisationId:string) {
 await ownerOrganisation(accountId,organisationId);
 const cfg=ownerPaymentConfig(),merchant=await prisma.pgMerchantAccount.findUnique({where:{organisationId},include:{ownerAuthorizations:{where:{mode:cfg.RAZORPAY_OWNER_MODE},orderBy:[{current:"desc"},{authorizedAt:"desc"}],take:1},oauthStates:{orderBy:{createdAt:"desc"},take:1}}});
 const auth=merchant?.ownerAuthorizations[0];const started=merchant?.oauthStates[0];
 return {provider:"RAZORPAY",onboardingAvailable:cfg.enabled,collectionEnabled:cfg.enabled&&cfg.ledgerAllowed&&canCollect(auth),mode:cfg.RAZORPAY_OWNER_MODE,
  status:auth?.status||(started?.status==="STARTED"&&started.expiresAt>new Date()?"ONBOARDING_STARTED":"NOT_CONNECTED"),
  bank:{status:auth?.bankStatus||"UNKNOWN",last4:auth?.bankLast4||null},paymentAcceptance:auth?.paymentEnabled?"ENABLED":"NOT_ENABLED",settlementReadiness:auth?.settlementReady?"READY":"NOT_READY",
  requiredAction:!cfg.enabled?"Razorpay merchant onboarding is awaiting platform activation.":auth?.status==="ACTIVATED"?null:"Complete Razorpay verification, then refresh your account status.",
  connected:Boolean(auth?.current),message:"Rent is processed under your own merchant account. Your PGOne software plan is separate."};
}
export async function startConnection(accountId:string,organisationId:string,sessionId:string) {
 const cfg=requireOwnerPayments();await ownerOrganisation(accountId,organisationId);
 assert(await entitlement(organisationId),402,"SUBSCRIPTION_REQUIRED","Activate PGOne before connecting rent collection.");
 const active=await prisma.pgSession.findFirst({where:{id:sessionId,accountId,revokedAt:null,expiresAt:{gt:new Date()}}});assert(active,401,"SESSION_INVALID","Sign in again before connecting payments.");
 const state=crypto.randomBytes(32).toString("base64url");
 await atomic(async tx=>{
  const m=await tx.pgMerchantAccount.upsert({where:{organisationId},create:{organisationId,provider:"RAZORPAY_EMBEDDED",status:"NOT_CONNECTED"},update:{}});
  await tx.pgOwnerOAuthState.updateMany({where:{merchantId:m.id,status:"STARTED"},data:{status:"SUPERSEDED"}});
  await tx.pgOwnerOAuthState.create({data:{merchantId:m.id,accountId,sessionId,stateHash:digest(state),mode:cfg.RAZORPAY_OWNER_MODE,expiresAt:new Date(Date.now()+15*60_000)}});
  await audit(tx,accountId,organisationId,"OWNER_MERCHANT_CONNECTION_STARTED",m.id,{mode:cfg.RAZORPAY_OWNER_MODE});
 });
 return {url:authorizationUrl(state),expiresInSeconds:900};
}
function validateToken(value:MerchantToken,mode:string,accountId?:string) {
 assert(value.token_type==="Bearer"&&typeof value.access_token==="string"&&value.access_token.length>=16&&value.access_token.length<=16000&&typeof value.refresh_token==="string"&&value.refresh_token.length>=16&&value.refresh_token.length<=16000&&new RegExp(`^rzp_${mode}_oauth_[A-Za-z0-9]+$`).test(value.public_token)&&Number.isInteger(value.expires_in)&&value.expires_in>0&&value.expires_in<=366*86400&&/^acc_[A-Za-z0-9]+$/.test(value.razorpay_account_id||accountId||""),502,"OWNER_AUTHORIZATION_INVALID","Razorpay authorization could not be verified. Reconnect your account.");
 if(accountId)assert(!value.razorpay_account_id||value.razorpay_account_id===accountId,409,"OWNER_MERCHANT_MISMATCH","The merchant account did not match this connection.");
}
export async function finishConnection(state:string,code:string|undefined,denied:boolean,provider:OwnerProvider=razorpayOwnerProvider) {
 const cfg=requireOwnerPayments();assert(/^[A-Za-z0-9_-]{43}$/.test(state),400,"OAUTH_STATE_INVALID","The merchant connection link is invalid.");
 const flow=await prisma.pgOwnerOAuthState.findUnique({where:{stateHash:digest(state)},include:{merchant:true}});
 assert(flow&&flow.status==="STARTED"&&flow.expiresAt>new Date()&&flow.mode===cfg.RAZORPAY_OWNER_MODE,400,"OAUTH_STATE_EXPIRED","This connection link expired. Start again from PGOne.");
 const session=await prisma.pgSession.findFirst({where:{id:flow.sessionId,accountId:flow.accountId,revokedAt:null,expiresAt:{gt:new Date()}}});assert(session,401,"SESSION_INVALID","Sign in again before connecting payments.");
 await ownerOrganisation(flow.accountId,flow.merchant.organisationId);
 const used=await prisma.pgOwnerOAuthState.updateMany({where:{id:flow.id,status:"STARTED"},data:{status:denied?"DENIED":"EXCHANGING"}});assert(used.count===1,409,"OAUTH_STATE_USED","This connection was already handled.");
 if(denied)return;
 assert(code&&code.length<8000,400,"OAUTH_CODE_MISSING","Merchant authorization was not completed.");
 try {
  const token=await provider.exchange(code);validateToken(token,flow.mode);
  assert(token.razorpay_account_id!==cfg.PGONE_SUBSCRIPTION_MERCHANT_ACCOUNT_ID,409,"PLATFORM_MERCHANT_FORBIDDEN","The PGOne software-fee merchant cannot receive resident rent. Connect the PG owner's own merchant account.");
  const account=await provider.account(token.access_token,token.razorpay_account_id);
  assert(account.id===token.razorpay_account_id,409,"OWNER_MERCHANT_MISMATCH","The connected merchant identity did not match.");
  const connectionId=crypto.randomUUID();
  await atomic(async tx=>{
   assert(await tx.pgSession.findFirst({where:{id:flow.sessionId,accountId:flow.accountId,revokedAt:null,expiresAt:{gt:new Date()}}}),401,"SESSION_INVALID","Sign in again before connecting payments.");
   assert(await tx.pgOrganisation.findFirst({where:{id:flow.merchant.organisationId,ownerAccountId:flow.accountId,owner:{status:"ACTIVE"},legacyOwner:{status:"ACTIVE"}}}),403,"FORBIDDEN","The owner organisation changed during connection.");
   const conflict=await tx.pgOwnerAuthorization.findUnique({where:{mode_providerAccountId:{mode:flow.mode,providerAccountId:token.razorpay_account_id}}});
   assert(!conflict||conflict.merchantId===flow.merchantId,409,"OWNER_MERCHANT_ALREADY_CONNECTED","This merchant account is already connected to a different owner organisation.");
   const prior=await tx.pgOwnerAuthorization.findFirst({where:{merchantId:flow.merchantId,mode:flow.mode,current:true}});
   if(prior&&prior.providerAccountId!==token.razorpay_account_id){
    assert(await tx.pgOwnerRentOrder.count({where:{authorizationId:prior.id,open:true}})===0,409,"OWNER_PAYMENTS_UNRESOLVED","Reconcile outstanding rent attempts before changing your connected merchant account.");
    await tx.pgOwnerAuthorization.update({where:{id:prior.id},data:{current:false,status:"DISABLED",revision:{increment:1}}});
   }
   const id=conflict?.id||connectionId;
   const mapped=mapAccount(account,conflict);
   const data={...mapped,current:true,authorizedAt:new Date(),accessCipher:seal(token.access_token,id+":access"),refreshCipher:seal(token.refresh_token,id+":refresh"),publicToken:token.public_token,expiresAt:new Date(Date.now()+token.expires_in*1000),refreshLeaseUntil:null};
   await tx.pgOwnerAuthorization.upsert({where:{mode_providerAccountId:{mode:flow.mode,providerAccountId:token.razorpay_account_id}},create:{id,merchantId:flow.merchantId,mode:flow.mode,providerAccountId:token.razorpay_account_id,...data},update:{...data,revision:{increment:1}}});
   await tx.pgOwnerOAuthState.update({where:{id:flow.id},data:{status:"CONNECTED"}});
   await audit(tx,flow.accountId,flow.merchant.organisationId,"OWNER_MERCHANT_AUTHORIZED",id,{mode:flow.mode,providerAccountId:token.razorpay_account_id});
  });
 }catch(error){await prisma.pgOwnerOAuthState.update({where:{id:flow.id},data:{status:"ACTION_REQUIRED"}});throw error;}
}
export async function accessToken(id:string,provider:OwnerProvider=razorpayOwnerProvider) {
 let auth=await prisma.pgOwnerAuthorization.findUniqueOrThrow({where:{id}});
 assert(auth.mode===ownerPaymentConfig().RAZORPAY_OWNER_MODE,503,"OWNER_MODE_MISMATCH","This connection belongs to another payment environment.");
 assert(auth.accessCipher&&auth.expiresAt,503,"OWNER_RECONNECT_REQUIRED","The owner must reconnect their payment account.");
 if(auth.expiresAt.getTime()>Date.now()+90_000)return unseal(auth.accessCipher,id+":access");
 const now=new Date(),lease=new Date(Date.now()+30_000);
 const claimed=await prisma.pgOwnerAuthorization.updateMany({where:{id,revision:auth.revision,OR:[{refreshLeaseUntil:null},{refreshLeaseUntil:{lt:now}}]},data:{refreshLeaseUntil:lease}});
 assert(claimed.count===1,503,"OWNER_REFRESH_PENDING","Merchant authorization is being refreshed. Check again shortly.");
 try {
  assert(auth.refreshCipher,503,"OWNER_RECONNECT_REQUIRED","The owner must reconnect payments.");
  const result=await provider.refresh(unseal(auth.refreshCipher,id+":refresh"));validateToken(result,auth.mode,auth.providerAccountId);
  const saved=await prisma.pgOwnerAuthorization.updateMany({where:{id,revision:auth.revision,refreshLeaseUntil:lease},data:{accessCipher:seal(result.access_token,id+":access"),refreshCipher:seal(result.refresh_token,id+":refresh"),publicToken:result.public_token,expiresAt:new Date(Date.now()+result.expires_in*1000),revision:{increment:1},refreshLeaseUntil:null}});
  assert(saved.count===1,409,"OWNER_AUTHORIZATION_CHANGED","The merchant connection changed. Check its status.");return result.access_token;
 }catch(error){await prisma.pgOwnerAuthorization.updateMany({where:{id,revision:auth.revision,refreshLeaseUntil:lease},data:{status:"ACTION_REQUIRED",paymentEnabled:false,settlementReady:false,refreshLeaseUntil:null}});throw error;}
}
export async function refreshConnection(id:string,provider:OwnerProvider=razorpayOwnerProvider,attempt=0):Promise<PgOwnerAuthorization> {
 let prior=await prisma.pgOwnerAuthorization.findUniqueOrThrow({where:{id},include:{merchant:true}});
 const token=await accessToken(id,provider),account=await provider.account(token,prior.providerAccountId);
 prior=await prisma.pgOwnerAuthorization.findUniqueOrThrow({where:{id},include:{merchant:true}});
 assert(account.id===prior.providerAccountId,409,"OWNER_MERCHANT_MISMATCH","Razorpay returned a different merchant account.");
 let data:any=mapAccount(account,prior);
 if(prior.productId){
  const product=await provider.product(token,prior.providerAccountId,prior.productId);
  assert(product.id===prior.productId&&product.account_id===prior.providerAccountId,409,"OWNER_PRODUCT_MISMATCH","The payment capability did not match this owner.");
  const conf=product.active_configuration,bank=conf?.settlements;
  data.productActivated=product.activation_status==="activated"&&conf?.payment_capture?.mode==="automatic"&&conf?.payment_methods?.upi?.enabled===true;
  if(bank?.account_number&&bank.ifsc_code){
   data.bankLast4=String(bank.account_number).slice(-4);data.bankFingerprint=bankFingerprint(String(bank.account_number),String(bank.ifsc_code));
  }
 }
 if(data.accountActivated&&data.paymentEnabled&&data.settlementReady&&(data.productActivated??prior.productActivated))data.status="ACTIVATED";
 data.verifiedAt=new Date();
 return atomic(async tx=>{
  const current=await tx.pgOwnerAuthorization.findUniqueOrThrow({where:{id}});
  assert(current.current&&current.revision===prior.revision,409,"OWNER_AUTHORIZATION_CHANGED","The merchant connection changed. Refresh it again.");
  if(data.bankFingerprint&&prior.bankFingerprint&&data.bankFingerprint!==prior.bankFingerprint){
   await audit(tx,null,prior.merchant.organisationId,"OWNER_SETTLEMENT_DESTINATION_CHANGED",id,{previous:prior.bankFingerprint,current:data.bankFingerprint});
  }
  await audit(tx,null,prior.merchant.organisationId,"OWNER_MERCHANT_STATUS_VERIFIED",id,{status:data.status,paymentEnabled:data.paymentEnabled,settlementReady:data.settlementReady});
  return tx.pgOwnerAuthorization.update({where:{id},data:{...data,revision:{increment:1}}});
 }).catch(error=>{if(error?.code==="OWNER_AUTHORIZATION_CHANGED"&&attempt<2)return refreshConnection(id,provider,attempt+1);throw error;});
}
export async function disconnect(accountId:string,organisationId:string,password:string,provider:OwnerProvider=razorpayOwnerProvider) {
 await ownerOrganisation(accountId,organisationId);const account=await prisma.pgAccount.findUniqueOrThrow({where:{id:accountId}});
 assert(account.passwordHash&&await passwordMatches(password,account.passwordHash),403,"PASSWORD_CONFIRMATION_FAILED","Your password did not match.");
 const current=await prisma.pgOwnerAuthorization.findFirst({where:{merchant:{organisationId},current:true,mode:ownerPaymentConfig().RAZORPAY_OWNER_MODE}});if(!current)return;
 // Local stop precedes the provider request, including when revoke is uncertain.
 await atomic(async tx=>{await tx.pgOwnerAuthorization.update({where:{id:current.id},data:{current:false,status:"DISABLED",paymentEnabled:false,settlementReady:false,revision:{increment:1}}});await audit(tx,accountId,organisationId,"OWNER_MERCHANT_DISCONNECTED",current.id);});
 try{if(current.accessCipher)await provider.revoke(unseal(current.accessCipher,current.id+":access"));
  await prisma.pgOwnerAuthorization.update({where:{id:current.id},data:{accessCipher:null,refreshCipher:null,publicToken:null}});
 }catch{throw new AppError(503,"OWNER_REVOKE_PENDING","Collection is disabled in PGOne. Revoke access in Razorpay as well, then reconnect when ready.");}
}
