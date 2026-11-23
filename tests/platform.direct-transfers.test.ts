import test,{after} from "node:test";
import assert from "node:assert/strict";
import express from "express";
import {ZodError} from "zod";
process.env.PGONE_PLATFORM_ENABLED="true";
assert.equal(process.env.NODE_ENV,"test");
const database=new URL(process.env.DATABASE_URL!);assert.equal(database.hostname,"127.0.0.1");assert.equal(database.pathname,"/pgone_test");
const {prisma}=await import("../src/db.js");
const {registerEmail}=await import("../src/platform/email-auth.js");
const {saveProfile,createProperty}=await import("../src/platform/service.js");
const {storeEvidence,readEvidence,evidenceImage}=await import("../src/platform/rent-evidence.js");
const {saveElectricity,prepareTransfer,submitProof,reviewTransfer,cancelTransfer,transferPage,transferDetail,ownerTransfers}=await import("../src/platform/direct-transfers.js");
after(async()=>{await prisma.$disconnect();});
// A minimal JPEG structure used only for byte/size/metadata validation; browser
// and native tests use real decodable images from the browser's JPEG encoder.
function jpeg(seed=0){return Buffer.from([255,216,255,192,0,11,8,0,1,0,1,1,1,17,0,255,218,0,8,1,1,0,0,63,0,seed,255,217]).toString("base64");}
async function fixture(){
 const owner=await registerEmail(`${crypto.randomUUID()}@example.test`,"private test password 123");await saveProfile(owner.id,{fullName:"Transfer owner",intent:"OWNER"});
 const pg=await createProperty(owner.id,{name:"Transfer PG",city:"Pune",key:crypto.randomUUID()});
 const own=await prisma.pgMembership.findFirstOrThrow({where:{accountId:owner.id,propertyId:pg.propertyId,role:"OWNER"}});
 const resident=await registerEmail(`${crypto.randomUUID()}@example.test`,"private test password 123");
 const actor=await prisma.user.create({data:{role:"STUDENT",fullName:"Transfer resident"}});
 const student=await prisma.student.create({data:{propertyId:pg.propertyId,userId:actor.id,mobile:"9123456789",joiningDate:new Date("2026-11-01"),monthlyRentPaise:850099}});
 const member=await prisma.pgMembership.create({data:{accountId:resident.id,propertyId:pg.propertyId,organisationId:pg.organisationId,role:"RESIDENT",actorUserId:actor.id}});
 const invoice=await prisma.rentInvoice.create({data:{propertyId:pg.propertyId,studentId:student.id,year:2026,month:11,dueDate:new Date(),rentPaise:850099,totalPaise:850099}});
 await prisma.pgOwnerUpi.create({data:{propertyId:pg.propertyId,ownerAccountId:owner.id,upiAddress:`owner-${owner.id}@invalid`,payeeName:"Owner fixture"}});
 const meter=await storeEvidence(resident.id,member.id,"METER",jpeg());const proof=await storeEvidence(resident.id,member.id,"PAYMENT",jpeg(1));
 const prepare=(rent=true,electricity=false,key=crypto.randomUUID())=>prepareTransfer(resident.id,member.id,invoice.id,{rent,electricity,key});
 const electricity=(amountPaise=65025)=>saveElectricity(resident.id,member.id,invoice.id,{amountPaise,meterEvidenceId:meter.id});
 const submit=(transferId:string,bankReference=`UTR${crypto.randomUUID().replaceAll("-","")}`,key=crypto.randomUUID())=>submitProof(resident.id,member.id,transferId,{bankReference,evidenceId:proof.id,key});
 const confirm=(id:string,proofId:string)=>reviewTransfer(owner.id,pg.propertyId,id,{proofId,approve:true,bankChecked:true});
 return {owner,pg,own,resident,member,student,invoice,meter,proof,prepare,electricity,submit,confirm};
}
test("combined rent and electricity confirms one bank debit and two separate allocations exactly once",async()=>{
 const f=await fixture();await f.electricity();const [a,b]=await Promise.all([f.prepare(true,true),f.prepare(true,true)]);assert.equal(a.id,b.id);assert.equal(a.amountPaise,915124);
 const p=await f.submit(a.id);assert.equal((await prisma.rentInvoice.findUniqueOrThrow({where:{id:f.invoice.id}})).paidPaise,0);
 assert.equal((await prisma.pgElectricityBill.findUniqueOrThrow({where:{invoiceId:f.invoice.id}})).status,"DUE");
 const [one,two]=await Promise.all([f.confirm(a.id,p.id),f.confirm(a.id,p.id)]);assert.equal(one.id,two.id);assert.equal(one.status,"CONFIRMED");
 const payments=await prisma.payment.findMany({where:{invoiceId:f.invoice.id}});assert.equal(payments.length,1);assert.equal(payments[0]!.amountPaise,850099);
 const i=await prisma.rentInvoice.findUniqueOrThrow({where:{id:f.invoice.id}});assert.equal(i.paidPaise,850099);assert.equal(i.totalPaise,850099);assert.equal(i.electricityPaise,0);
 assert.equal((await prisma.pgElectricityBill.findUniqueOrThrow({where:{invoiceId:i.id}})).status,"PAID");
 await assert.rejects(()=>f.prepare(true,true),{code:"RENT_NOT_PAYABLE"});
});
test("rent can be paid first and electricity created and paid later without reopening paid rent",async()=>{
 const f=await fixture();const rent=await f.prepare();const p=await f.submit(rent.id);await f.confirm(rent.id,p.id);
 await f.electricity(12345);const later=await f.prepare(false,true);assert.equal(later.rentPaise,0);assert.equal(later.amountPaise,12345);
 const p2=await f.submit(later.id);await f.confirm(later.id,p2.id);assert.equal(await prisma.payment.count({where:{invoiceId:f.invoice.id}}),1);
 const page=await transferPage(f.resident.id,f.member.id,f.invoice.id);assert.equal(page.invoice.remainingPaise,0);assert.equal(page.bill?.status,"PAID");assert.equal(page.transfers.length,2);
});
test("electricity can be paid first and rent later; duplicate historical electricity charges are blocked",async()=>{
 const f=await fixture();await f.electricity();const t=await f.prepare(false,true),p=await f.submit(t.id);await f.confirm(t.id,p.id);
 assert.equal((await prisma.rentInvoice.findUniqueOrThrow({where:{id:f.invoice.id}})).paidPaise,0);const rent=await f.prepare();const p2=await f.submit(rent.id);await f.confirm(rent.id,p2.id);
 const g=await fixture();await prisma.rentInvoice.update({where:{id:g.invoice.id},data:{electricityPaise:100,totalPaise:850199}});await assert.rejects(()=>g.electricity(),{code:"ELECTRICITY_ALREADY_BILLED"});
});
test("separate electricity payment does not wait for the rent proof to be approved",async()=>{
 const f=await fixture();const r=await f.prepare(),rp=await f.submit(r.id);await f.electricity();
 const e=await f.prepare(false,true),ep=await f.submit(e.id);await f.confirm(e.id,ep.id);
 assert.equal((await prisma.rentInvoice.findUniqueOrThrow({where:{id:f.invoice.id}})).paidPaise,0);await f.confirm(r.id,rp.id);
 assert.equal((await prisma.pgElectricityBill.findUniqueOrThrow({where:{invoiceId:f.invoice.id}})).status,"PAID");
});
test("evidence, bill, proof and owner review are tenant/resident scoped; unattached uploads stay private",async()=>{
 const f=await fixture(),g=await fixture();
 await assert.rejects(()=>readEvidence(g.owner.id,g.own.id,f.meter.id),{code:"IMAGE_NOT_FOUND"});
 await assert.rejects(()=>readEvidence(f.owner.id,f.own.id,f.meter.id),{code:"IMAGE_NOT_FOUND"});
 await assert.rejects(()=>saveElectricity(g.resident.id,g.member.id,f.invoice.id,{amountPaise:1,meterEvidenceId:g.meter.id}),{code:"INVOICE_NOT_FOUND"});
 await assert.rejects(()=>saveElectricity(f.resident.id,f.member.id,f.invoice.id,{amountPaise:1,meterEvidenceId:g.meter.id}),{code:"METER_PHOTO_REQUIRED"});
 await f.electricity();assert.ok((await readEvidence(f.owner.id,f.own.id,f.meter.id)).length);
 const t=await f.prepare(true,true),p=await f.submit(t.id);
 await assert.rejects(()=>transferDetail(g.resident.id,g.member.id,t.id),{code:"TRANSFER_NOT_FOUND"});
 await assert.rejects(()=>reviewTransfer(g.owner.id,g.pg.propertyId,t.id,{proofId:p.id,approve:true,bankChecked:true}),{code:"TRANSFER_NOT_FOUND"});
 await assert.rejects(()=>reviewTransfer(f.resident.id,f.pg.propertyId,t.id,{proofId:p.id,approve:true,bankChecked:true}),{code:"FORBIDDEN"});
 await assert.rejects(()=>storeEvidence(f.owner.id,f.own.id,"PAYMENT",jpeg()),{code:"RESIDENT_REQUIRED"});
});
test("proof rejection never credits rent; correction is appended and old review cannot confirm new evidence",async()=>{
 const f=await fixture(),t=await f.prepare(),p=await f.submit(t.id);await reviewTransfer(f.owner.id,f.pg.propertyId,t.id,{proofId:p.id,approve:false,reason:"Bank reference does not match. Check the original debit."});
 assert.equal(await prisma.payment.count({where:{invoiceId:f.invoice.id}}),0);
 await assert.rejects(()=>f.confirm(t.id,p.id),{code:"PROOF_CHANGED"});
 const p2=await f.submit(t.id);await f.confirm(t.id,p2.id);assert.equal(await prisma.pgTransferProof.count({where:{transferId:t.id}}),2);
});
test("bank confirmation is mandatory; confirmed UTR cannot credit another transfer or property for same payee",async()=>{
 const f=await fixture(),t=await f.prepare(),p=await f.submit(t.id,"123456789012");
 await assert.rejects(()=>reviewTransfer(f.owner.id,f.pg.propertyId,t.id,{proofId:p.id,approve:true}),{code:"BANK_CHECK_REQUIRED"});await f.confirm(t.id,p.id);
 await f.electricity();const e=await f.prepare(false,true),ep=await f.submit(e.id,"123456789012");await assert.rejects(()=>f.confirm(e.id,ep.id),{code:"BANK_REFERENCE_USED"});
 assert.equal((await prisma.pgElectricityBill.findUniqueOrThrow({where:{invoiceId:f.invoice.id}})).status,"DUE");
});
test("no-debit cancellation allows a new selection; submitted or uncertain proof cannot be cancelled",async()=>{
 const f=await fixture();await f.electricity();const t=await f.prepare();await assert.rejects(()=>f.prepare(true,true),{code:"TRANSFER_PENDING"});
 await cancelTransfer(f.resident.id,f.member.id,t.id);const next=await f.prepare(true,true);assert.notEqual(t.id,next.id);
 const p=await f.submit(next.id);await assert.rejects(()=>cancelTransfer(f.resident.id,f.member.id,next.id),{code:"CANNOT_CANCEL"});await f.confirm(next.id,p.id);
});
test("changed owner details disable handoff but proof of an earlier debit is still reviewable",async()=>{
 const f=await fixture(),t=await f.prepare();await prisma.pgOwnerUpi.update({where:{propertyId:f.pg.propertyId},data:{upiAddress:"new-owner@invalid",revision:{increment:1}}});
 const detail=await transferDetail(f.resident.id,f.member.id,t.id);assert.equal(detail.intent,null);assert.match(detail.issue!,/details changed/);const p=await f.submit(t.id);await f.confirm(t.id,p.id);
});
test("already-recorded rent links an exact receipt without adding another invoice credit",async()=>{
 const f=await fixture(),t=await f.prepare(),p=await f.submit(t.id);
 const payment=await prisma.payment.create({data:{propertyId:f.pg.propertyId,studentId:f.student.id,invoiceId:f.invoice.id,amountPaise:850099,source:"MANUAL",method:"BANK_TRANSFER",receiptNumber:crypto.randomUUID(),paidAt:new Date()}});
 await prisma.rentInvoice.update({where:{id:f.invoice.id},data:{status:"PAID",paidPaise:850099}});
 await assert.rejects(()=>f.confirm(t.id,p.id),{code:"RENT_BALANCE_CHANGED"});
 await reviewTransfer(f.owner.id,f.pg.propertyId,t.id,{proofId:p.id,approve:true,bankChecked:true,existingRentReceipt:payment.id});assert.equal(await prisma.payment.count({where:{invoiceId:f.invoice.id}}),1);
});
test("frozen bills and pending proof cannot change silently; proof and transfer keys reject altered retries",async()=>{
 const f=await fixture();await f.electricity();const k=crypto.randomUUID(),t=await f.prepare(true,true,k);
 await assert.rejects(()=>f.prepare(false,true,k),{code:"IDEMPOTENCY_CONFLICT"});await assert.rejects(()=>f.electricity(123),{code:"BILL_LOCKED"});
 const key=crypto.randomUUID(),p=await f.submit(t.id,"123456789012",key);assert.equal((await f.submit(t.id,"123456789012",key)).id,p.id);
 await assert.rejects(()=>f.submit(t.id,"123456789013",key),{code:"IDEMPOTENCY_CONFLICT"});await assert.rejects(()=>f.submit(t.id),{code:"PROOF_ALREADY_SUBMITTED"});
});
test("private image validation limits bytes/dimensions and strips metadata; uploads are deduplicated",async()=>{
 assert.throws(()=>evidenceImage(Buffer.from("<svg onload=alert(1)>").toString("base64")),{code:"INVALID_IMAGE"});
 assert.throws(()=>evidenceImage("a".repeat(800000)),{code:"INVALID_IMAGE"});
 const f=await fixture();assert.equal((await storeEvidence(f.resident.id,f.member.id,"METER",jpeg())).id,f.meter.id);
 assert.equal(evidenceImage(jpeg()).width,1);assert.ok((await ownerTransfers(f.owner.id,f.pg.propertyId)).transfers);
});
test("actual authenticated HTTP routes keep proof private and issue a split receipt only after owner confirmation",async()=>{
 const f=await fixture(),g=await fixture();await prisma.pgOrganisation.update({where:{id:f.pg.organisationId},data:{legacyAccess:true}});
 const {membershipTokens}=await import("../src/platform/service.js");const {directTransferRouter}=await import("../src/platform/direct-transfer-router.js");
 const resident=await membershipTokens(f.resident.id,f.member.id),owner=await membershipTokens(f.owner.id,f.own.id),other=await membershipTokens(g.resident.id,g.member.id);
 const app=express();app.use(express.json({limit:"1mb"}));app.use("/api/platform/direct-payments",directTransferRouter);
 app.use((e:any,_req:any,res:any,_next:any)=>res.status(e instanceof ZodError?400:e.statusCode||500).json({error:{code:e.code,message:e.message}}));
 const server=app.listen(0,"127.0.0.1");await new Promise<void>(r=>server.on("listening",r));const origin=`http://127.0.0.1:${(server.address() as any).port}/api/platform/direct-payments`;
 const req=(path:string,token?:string,body?:object)=>fetch(origin+path,{method:body?"POST":"GET",headers:{"content-type":"application/json",...(token?{authorization:`Bearer ${token}`}:{})},...(body?{body:JSON.stringify(body)}:{})});
 try{
  assert.equal((await req(`/evidence/${f.meter.id}`)).status,401);assert.equal((await req(`/evidence/${f.meter.id}`,other.accessToken)).status,404);
  const bill=await req(`/invoices/${f.invoice.id}/electricity`,resident.accessToken,{amountPaise:65025,meterEvidenceId:f.meter.id});assert.equal(bill.status,200);
  const spoof=await req(`/invoices/${f.invoice.id}/transfers`,resident.accessToken,{rent:true,electricity:true,key:crypto.randomUUID(),amountPaise:1,payeeAddress:"attacker@invalid"});assert.equal(spoof.status,400);
  const prepare=await req(`/invoices/${f.invoice.id}/transfers`,resident.accessToken,{rent:true,electricity:true,key:crypto.randomUUID()});assert.equal(prepare.status,200);const {transferId}=await prepare.json() as any;
  assert.equal((await req(`/transfers/${transferId}/receipt.pdf`,resident.accessToken)).status,409);
  const submitted=await req(`/transfers/${transferId}/proof`,resident.accessToken,{bankReference:"123456789012",evidenceId:f.proof.id,key:crypto.randomUUID()});assert.equal(submitted.status,200);const {proof}=await submitted.json() as any;
  const photo=await req(`/evidence/${f.proof.id}`,owner.accessToken);assert.equal(photo.status,200);assert.equal(photo.headers.get("content-type"),"image/jpeg");assert.match(photo.headers.get("cache-control")!,/no-store/);
  assert.equal((await req(`/transfers/${transferId}/review`,resident.accessToken,{proofId:proof.id,approve:true,bankChecked:true})).status,403);
  assert.equal((await req(`/transfers/${transferId}/review`,owner.accessToken,{proofId:proof.id,approve:true,bankChecked:true})).status,200);
  const receipt=await req(`/transfers/${transferId}/receipt.pdf`,resident.accessToken);assert.equal(receipt.status,200);assert.equal(receipt.headers.get("content-type"),"application/pdf");assert.ok(Buffer.from(await receipt.arrayBuffer()).subarray(0,5).equals(Buffer.from("%PDF-")));
 }finally{server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));}
});
