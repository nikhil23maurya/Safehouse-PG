import test,{after} from "node:test";
import assert from "node:assert/strict";
process.env.PGONE_PLATFORM_ENABLED="true";
const {prisma}=await import("../src/db.js");
const {registerEmail}=await import("../src/platform/email-auth.js");
const {saveProfile,createProperty}=await import("../src/platform/service.js");
const {createDirectClaim,confirmDirectClaim,directIntent}=await import("../src/platform/direct-rent.js");
after(async()=>{await prisma.$disconnect();});
test("direct owner transfer references never credit rent; one existing manual bank receipt confirms once",async()=>{
  const owner=await registerEmail(`${crypto.randomUUID()}@example.test`,"private test password 123");
  await saveProfile(owner.id,{fullName:"Direct owner",intent:"OWNER"});
  const setup=await createProperty(owner.id,{name:"Direct PG",city:"Pune",key:crypto.randomUUID()});
  const resident=await registerEmail(`${crypto.randomUUID()}@example.test`,"private test password 123");
  const actor=await prisma.user.create({data:{role:"STUDENT",fullName:"Resident"}});
  const student=await prisma.student.create({data:{propertyId:setup.propertyId,userId:actor.id,mobile:"9123456789",joiningDate:new Date(),monthlyRentPaise:850099}});
  const member=await prisma.pgMembership.create({data:{accountId:resident.id,propertyId:setup.propertyId,organisationId:setup.organisationId,role:"RESIDENT",actorUserId:actor.id}});
  const invoice=await prisma.rentInvoice.create({data:{propertyId:setup.propertyId,studentId:student.id,year:2026,month:11,dueDate:new Date(),rentPaise:850099,totalPaise:850099}});
  await assert.rejects(()=>createDirectClaim(resident.id,member.id,invoice.id,crypto.randomUUID()),{code:"OWNER_UPI_UNAVAILABLE"});
  await prisma.pgOwnerUpi.create({data:{propertyId:setup.propertyId,ownerAccountId:owner.id,upiAddress:"owner-fixture@invalid",payeeName:"Owner fixture"}});
  const [a,b]=await Promise.all([createDirectClaim(resident.id,member.id,invoice.id,crypto.randomUUID()),createDirectClaim(resident.id,member.id,invoice.id,crypto.randomUUID())]);
  assert.equal(a.id,b.id);assert.equal(a.amountPaise,850099);
  const uri=new URL(directIntent(a));assert.equal(uri.searchParams.get("pa"),"owner-fixture@invalid");assert.equal(uri.searchParams.get("am"),"8500.99");
  assert.equal((await prisma.rentInvoice.findUniqueOrThrow({where:{id:invoice.id}})).paidPaise,0);
  await assert.rejects(()=>createDirectClaim(owner.id,member.id,invoice.id,crypto.randomUUID()),{code:"RESIDENT_REQUIRED"});
  await assert.rejects(()=>confirmDirectClaim(owner.id,setup.propertyId,a.id,"not-a-payment"),{code:"BANK_REFERENCE_REQUIRED"});
  await prisma.pgDirectRentClaim.update({where:{id:a.id},data:{bankReference:"123456789012"}});
  await assert.rejects(()=>confirmDirectClaim(owner.id,setup.propertyId,a.id,"not-a-payment"),{code:"MANUAL_RECEIPT_MISMATCH"});
  // Existing manual-payment service result, isolated fixture only. Linking must not post again.
  const payment=await prisma.payment.create({data:{propertyId:setup.propertyId,studentId:student.id,invoiceId:invoice.id,amountPaise:850099,
    source:"MANUAL",method:"BANK_TRANSFER",paidAt:new Date(),receiptNumber:`DIRECT-${crypto.randomUUID()}`}});
  await prisma.rentInvoice.update({where:{id:invoice.id},data:{paidPaise:850099,status:"PAID"}});
  const before=await prisma.payment.count({where:{invoiceId:invoice.id}});
  await confirmDirectClaim(owner.id,setup.propertyId,a.id,payment.receiptNumber);
  const repeat=await confirmDirectClaim(owner.id,setup.propertyId,a.id,payment.id);
  assert.equal(repeat.status,"OWNER_CONFIRMED");
  assert.equal(await prisma.payment.count({where:{invoiceId:invoice.id}}),before);
  assert.equal((await prisma.rentInvoice.findUniqueOrThrow({where:{id:invoice.id}})).paidPaise,850099);
});
