import test, { after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import express from "express";
import { ZodError } from "zod";
Object.assign(process.env, {
  PGONE_PLATFORM_ENABLED:"true",PGONE_CASHFREE_EMBEDDED_ENABLED:"true",
  PGONE_CASHFREE_PARTNER_API_KEY:"isolated-merchant-partner-key",PGONE_CASHFREE_ENV:"LIVE",
});
const { prisma }=await import("../src/db.js");
const { phoneAccount,saveProfile,createProperty }=await import("../src/platform/service.js");
const { platformPair }=await import("../src/platform/tokens.js");
const { platformRouter }=await import("../src/platform/router.js");
const { merchantStatus }=await import("../src/platform/merchant.js");
const { CashfreeMerchantProvider,merchantProfileInput,merchantBankInput,merchantReference,
  beginMerchantSetup,submitMerchantBank,syncMerchantRecord,merchantOnboardingLink,processMerchantWebhook }=await import("../src/platform/cashfree-merchant.js");
const app=express();app.use(express.json());app.use("/api/platform",platformRouter);
app.use((error:any,_req:any,res:any,_next:any)=>res.status(error instanceof ZodError?400:error.statusCode||500).json({error:{code:error.code,message:error.message}}));
const server=app.listen(0,"127.0.0.1");await new Promise<void>(resolve=>server.on("listening",resolve));
const base=`http://127.0.0.1:${(server.address() as any).port}`;
after(async()=>{server.close();await prisma.$disconnect();});

const profile=merchantProfileInput.parse({name:"Merchant House",email:"owner@example.test",website:"https://merchant.example.test",
  legalName:"Owner Legal Name",businessType:"Individual",businessModel:"B2C",consent:true});
const bank=merchantBankInput.parse({accountNumber:"123456789012",confirmAccountNumber:"123456789012",ifsc:"ABCD0123456",consent:true});
async function owner(){
  const suffix=crypto.randomUUID();
  const account=await phoneAccount({uid:`merchant-${suffix}`,phoneE164:`+917${String(Math.floor(Math.random()*1e9)).padStart(9,"0")}`});
  await saveProfile(account.id,{fullName:"Merchant Owner",intent:"OWNER"});
  const property=await createProperty(account.id,{name:"Merchant House",city:"Pune",key:suffix});
  return {account,organisationId:property.organisationId};
}
function providerMock(){
  const merchants=new Map<string,any>();let creates=0,bankWrites=0,loseCreate=false,loseBank=false;
  const provider=new CashfreeMerchantProvider(async(url,options)=>{
    const parsed=new URL(String(url)),parts=parsed.pathname.split("/"),id=parts[3];
    let result:any;
    if(options?.method==="POST"&&parsed.pathname==="/partners/merchants"){
      const input=JSON.parse(String(options.body));
      if(merchants.has(input.merchant_id))return new Response("{}",{status:409});
      creates++;result={merchant_id:input.merchant_id,onboarding_status:"Email Verified",product_status:[{product_name:"PG",product_min_kyc_status:"MIN_KYC_PENDING"}]};
      merchants.set(input.merchant_id,result);
      if(loseCreate){loseCreate=false;throw new Error("Provider accepted create but response was lost");}
    }else{
      result=merchants.get(id!);
      if(!result)return new Response("{}",{status:404});
      if(options?.method==="PATCH"){
        bankWrites++;
        assert.deepEqual(JSON.parse(String(options.body)),{bank_account_details:{bank_account_number:bank.accountNumber,bank_ifsc:bank.ifsc}});
        if(loseBank){loseBank=false;throw new Error("Bank response lost");}
      }else if(options?.method==="POST"&&parts[4]==="onboarding_link"){
        assert.equal(JSON.parse(String(options.body)).return_url,"https://safehouse-api.onrender.com/merchant-return");
        result={onboarding_link:"https://merchant.cashfree.com/merchantwebapp/validate/synthetic-private-token?goto=onboarding",expires_at:new Date(Date.now()+3600000).toISOString()};
      }
    }
    return new Response(JSON.stringify(result),{status:200});
  });
  return {provider,merchants,get creates(){return creates;},get bankWrites(){return bankWrites;},loseCreate(){loseCreate=true;},loseBank(){loseBank=true;},
    stage(id:string,kyc:string){merchants.get(id).product_status[0].product_min_kyc_status=kyc;}};
}

test("separate owners get separate merchant bindings; bank submission retains no full account or false verification",async()=>{
  const a=await owner(),b=await owner(),mock=providerMock();
  const record=await beginMerchantSetup(a.account.id,a.organisationId,profile,mock.provider);
  await beginMerchantSetup(b.account.id,b.organisationId,{...profile,email:"another@example.test"},mock.provider);
  assert.equal(mock.creates,2);assert.equal(record.status,"KYC_REQUIRED");
  assert.notEqual(merchantReference(a.organisationId),merchantReference(b.organisationId));
  await assert.rejects(()=>beginMerchantSetup(b.account.id,a.organisationId,profile,mock.provider),{code:"FORBIDDEN"});
  await assert.rejects(()=>beginMerchantSetup(a.account.id,a.organisationId,{...profile,name:"Changed"},mock.provider),{code:"MERCHANT_PROFILE_CHANGED"});
  await submitMerchantBank(a.account.id,a.organisationId,bank,mock.provider);
  await submitMerchantBank(a.account.id,a.organisationId,bank,mock.provider);
  assert.equal(mock.bankWrites,1,"a confirmed identical submission is idempotent");
  const stored=await prisma.pgMerchantAccount.findUniqueOrThrow({where:{organisationId:a.organisationId}});
  const audits=await prisma.pgAudit.findMany({where:{organisationId:a.organisationId}});
  assert.equal(JSON.stringify([stored,audits]).includes(bank.accountNumber),false);
  assert.equal(stored.bankLast4,"9012");assert.equal(stored.bankVerificationStatus,"SUBMITTED");
  const view=await merchantStatus(a.account.id,a.organisationId);
  assert.equal(view.bank,null);assert.deepEqual(view.bankSubmission,{last4:"9012",status:"SUBMITTED"});
  assert.equal((view as any).bankSubmissionFingerprint,undefined);assert.equal((view as any).profileFingerprint,undefined);
  mock.stage(record.providerAccountRef!,"MIN_KYC_APPROVED");await syncMerchantRecord(a.organisationId,mock.provider);
  const approved=await merchantStatus(a.account.id,a.organisationId);
  assert.equal(approved.status,"APPROVED");assert.ok(approved.verifiedAt);assert.equal(approved.collectionEnabled,false);
  await assert.rejects(()=>submitMerchantBank(a.account.id,a.organisationId,bank,mock.provider),{code:"APPROVED_BANK_CHANGE_REVIEW"});
  mock.stage(record.providerAccountRef!,"MIN_KYC_REJECTED");await syncMerchantRecord(a.organisationId,mock.provider);
  assert.equal((await merchantStatus(a.account.id,a.organisationId)).verifiedAt,null);
});

test("lost merchant creation recovers the same ID; a lost bank response never triggers a blind resubmission",async()=>{
  const a=await owner(),mock=providerMock();mock.loseCreate();
  await assert.rejects(()=>beginMerchantSetup(a.account.id,a.organisationId,profile,mock.provider),{code:"MERCHANT_STATUS_UNCERTAIN"});
  const recovered=await beginMerchantSetup(a.account.id,a.organisationId,profile,mock.provider);
  assert.equal(mock.creates,1);assert.equal(recovered.creationState,"CONFIRMED");
  mock.loseBank();
  await assert.rejects(()=>submitMerchantBank(a.account.id,a.organisationId,bank,mock.provider),{code:"MERCHANT_STATUS_UNCERTAIN"});
  await assert.rejects(()=>submitMerchantBank(a.account.id,a.organisationId,bank,mock.provider),{code:"BANK_SUBMISSION_UNCERTAIN"});
  assert.equal(mock.bankWrites,1);
  const link=await merchantOnboardingLink(a.account.id,a.organisationId,mock.provider);
  assert.match(link.url,/^https:\/\/merchant.cashfree.com\//);
  assert.equal((await merchantStatus(a.account.id,a.organisationId)).status,"KYC_REQUIRED","a link or return never grants approval");
  const audits=await prisma.pgAudit.findMany({where:{organisationId:a.organisationId}});
  assert.equal(JSON.stringify(audits).includes("synthetic-private-token"),false);
});

test("signed notifications refetch status, deduplicate and cannot turn test approval into live approval",async()=>{
  const a=await owner(),mock=providerMock();const record=await beginMerchantSetup(a.account.id,a.organisationId,profile,mock.provider);
  const timestamp=String(Date.now());
  const payload=(serial:number)=>Buffer.from(JSON.stringify({type:"MERCHANT_ONBOARDING_STATUS",serial,data:{merchant_id:record.providerAccountRef,status:"APPROVED"}}));
  const sign=(raw:Buffer)=>crypto.createHmac("sha256","isolated-merchant-partner-key").update(timestamp).update(raw).digest("base64");
  const first=payload(1);
  await processMerchantWebhook(first,timestamp,sign(first),mock.provider);
  await processMerchantWebhook(first,timestamp,sign(first),mock.provider);
  assert.equal((await merchantStatus(a.account.id,a.organisationId)).status,"KYC_REQUIRED","payload status is never the source of approval");
  const hash=crypto.createHash("sha256").update(first).digest("hex");
  assert.equal(await prisma.pgProviderEvent.count({where:{provider:"CASHFREE_MERCHANT",eventKey:hash}}),1);
  mock.stage(record.providerAccountRef!,"MIN_KYC_APPROVED");const second=payload(2);
  await processMerchantWebhook(second,timestamp,sign(second),mock.provider);
  assert.equal((await merchantStatus(a.account.id,a.organisationId)).status,"APPROVED");
  await assert.rejects(()=>processMerchantWebhook(payload(3),timestamp,"0".repeat(44),mock.provider),{code:"INVALID_MERCHANT_SIGNATURE"});
  await prisma.pgMerchantAccount.update({where:{organisationId:a.organisationId},data:{providerEnvironment:"TEST"}});
  await assert.rejects(()=>syncMerchantRecord(a.organisationId,mock.provider),{code:"MERCHANT_ENVIRONMENT_CHANGED"});
  const view=await merchantStatus(a.account.id,a.organisationId);
  assert.equal(view.status,"REVIEW_REQUIRED");assert.equal(view.verifiedAt,null);assert.equal(view.collectionEnabled,false);
});

test("merchant endpoints reject unauthenticated requests, another owner and unconsented data before provider calls",async()=>{
  const a=await owner(),b=await owner();
  const url=`${base}/api/platform/organisations/${a.organisationId}/merchant`;
  assert.equal((await fetch(url)).status,401);
  const foreign={authorization:`Bearer ${platformPair(b.account).accessToken}`,"content-type":"application/json"};
  assert.equal((await fetch(url,{headers:foreign})).status,403);
  for(const [path,body] of [["profile",profile],["bank",bank],["onboarding-link",{}],["recheck",{}]] as const)
    assert.equal((await fetch(`${url}/${path}`,{method:"POST",headers:foreign,body:JSON.stringify(body)})).status,403);
  const own={...foreign,authorization:`Bearer ${platformPair(a.account).accessToken}`};
  assert.equal((await fetch(`${url}/bank`,{method:"POST",headers:own,body:JSON.stringify({...bank,consent:false})})).status,400);
});
