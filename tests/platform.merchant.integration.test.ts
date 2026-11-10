import test,{after} from "node:test";
import assert from "node:assert/strict";
process.env.PGONE_PLATFORM_ENABLED="true";
const {prisma}=await import("../src/db.js");
const {registerEmail}=await import("../src/platform/email-auth.js");
const {saveProfile,createProperty}=await import("../src/platform/service.js");
const {merchantStatus}=await import("../src/platform/merchant.js");
after(async()=>{await prisma.$disconnect();});
test("ordinary keys never enable per-owner settlement and historical merchant records remain untouched",async()=>{
 const owner=await registerEmail(`${crypto.randomUUID()}@example.test`,"isolated private password");
 await saveProfile(owner.id,{fullName:"Merchant owner",intent:"OWNER"});
 const setup=await createProperty(owner.id,{name:"Merchant PG",city:"Pune",key:crypto.randomUUID()});
 const record=await prisma.pgMerchantAccount.create({data:{organisationId:setup.organisationId,provider:"CASHFREE_EMBEDDED",status:"APPROVED",providerAccountRef:`historical-${crypto.randomUUID()}`}});
 const view=await merchantStatus(owner.id,setup.organisationId);
 assert.equal(view.provider,"RAZORPAY");assert.equal(view.collectionEnabled,false);assert.equal(view.onboardingAvailable,false);
 assert.deepEqual(await prisma.pgMerchantAccount.findUnique({where:{id:record.id}}),record);
 const other=await registerEmail(`${crypto.randomUUID()}@example.test`,"isolated private password");
 await assert.rejects(()=>merchantStatus(other.id,setup.organisationId),{code:"FORBIDDEN"});
});
