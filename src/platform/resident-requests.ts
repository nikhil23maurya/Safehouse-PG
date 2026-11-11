import crypto from "node:crypto";
import {prisma} from "../db.js";
import {assert} from "../errors.js";
import {atomic,audit,ownerOrganisation} from "./service.js";
import {entitlement} from "./billing.js";
import {passwordMatches} from "./passwords.js";
import {ensureInvoices} from "../rent.js";
import {datePartsInTimeZone,parseDateOnly} from "../utils.js";

export async function requestPropertyAccess(accountId:string,propertyId:string,organisationId:string,profile:{fullName?:string;mobile?:string},codeContext:{hash:string;revision:number}){
 return atomic(async tx=>{
  const code=await tx.pgJoinCode.findUnique({where:{propertyId}});
  assert(code?.enabled&&code.codeHash===codeContext.hash&&code.revision===codeContext.revision&&code.organisationId===organisationId,404,"PG_CODE_UNAVAILABLE","This PG code is no longer available.");
  const account=await tx.pgAccount.findUniqueOrThrow({where:{id:accountId}});
  assert(account.status==="ACTIVE"&&!account.passwordChangeRequired,403,"ACCOUNT_UNAVAILABLE","Update your account before requesting a PG.");
  const owner=await tx.pgMembership.findFirst({where:{accountId,role:"OWNER",status:"ACTIVE"}});
  assert(!owner,409,"OWNER_ACCOUNT","Use your owner workspace to add or manage properties.");
  const member=await tx.pgMembership.findUnique({where:{accountId_propertyId_role:{accountId,propertyId,role:"RESIDENT"}}});
  if(member){assert(member.status==="ACTIVE",403,"MEMBERSHIP_DISABLED","Contact your owner about this membership.");if(member.actorUserId)return {membership:member};}
  const prior=await tx.pgResidentRequest.findUnique({where:{accountId_propertyId:{accountId,propertyId}}});
  if(prior)return {request:prior};
  const fullName=(profile.fullName||account.fullName).trim(),mobile=profile.mobile||account.contactPhone;
  assert(fullName.length>=2&&fullName.length<=100&&/^\+91[6-9]\d{9}$/.test(mobile||""),400,"RESIDENT_DETAILS_REQUIRED","Enter your full name and valid Indian mobile number.");
  const request=await tx.pgResidentRequest.create({data:{accountId,propertyId,organisationId,fullName,mobile:mobile!,status:member?"ACCEPTED":"PENDING",membershipId:member?.id}});
  if(!account.fullName.trim())await tx.pgAccount.update({where:{id:accountId},data:{fullName,contactPhone:mobile,setupIntent:account.setupIntent||"RESIDENT"}});
  await audit(tx,accountId,organisationId,"RESIDENT_REQUEST_SUBMITTED",request.id,{propertyId});
  return {request};
 });
}
async function owned(accountId:string,propertyId:string){
 const setup=await prisma.pgPropertySetup.findUnique({where:{propertyId},include:{property:true}});
 assert(setup,404,"PROPERTY_NOT_FOUND","Property not found.");const org=await ownerOrganisation(accountId,setup.organisationId);
 assert(setup.property.ownerId===org.legacyOwnerId,403,"PROPERTY_SCOPE_INVALID","This property relationship needs review.");return setup;
}
const summary=(r:any)=>({id:r.id,propertyId:r.propertyId,propertyName:r.property?.name,fullName:r.fullName,email:r.account?.email,mobile:r.mobile,status:r.status,createdAt:r.createdAt,decidedAt:r.decidedAt,studentId:r.studentId,membershipId:r.membershipId});
export async function myResidentRequests(accountId:string){
 const rows=await prisma.pgResidentRequest.findMany({where:{accountId},include:{property:{select:{name:true}}},orderBy:{createdAt:"desc"},take:100});
 return {requests:rows.map(summary)};
}
export async function propertyResidentRequests(accountId:string,propertyId:string,id?:string){
 const setup=await owned(accountId,propertyId);
 const rows=await prisma.pgResidentRequest.findMany({where:{propertyId,organisationId:setup.organisationId,...(id?{id}:{})},include:{account:{select:{email:true}}},orderBy:{createdAt:"desc"},take:200});
 if(id)assert(rows.length,404,"REQUEST_NOT_FOUND","This request does not belong to this property.");
 return {requests:rows.map(summary)};
}
async function verifyOwner(accountId:string,propertyId:string,password:string){
 const setup=await owned(accountId,propertyId);
 assert(await entitlement(setup.organisationId),402,"SUBSCRIPTION_REQUIRED","Activate your PGOne plan before approving residents.");
 const account=await prisma.pgAccount.findUniqueOrThrow({where:{id:accountId}});
 assert(await passwordMatches(password,account.passwordHash),403,"PASSWORD_CONFIRMATION_FAILED","Your password did not match.");return setup;
}
export async function decideResidentRequest(accountId:string,propertyId:string,id:string,decision:"ACCEPTED"|"REJECTED",password:string){
 const setup=await verifyOwner(accountId,propertyId,password);
 return atomic(async tx=>{
  const request=await tx.pgResidentRequest.findFirst({where:{id,propertyId,organisationId:setup.organisationId}});
  assert(request,404,"REQUEST_NOT_FOUND","This request does not belong to this property.");
  if(request.status===decision)return {request:summary(request)};
  assert(request.status==="PENDING",409,"REQUEST_ALREADY_DECIDED","This request was already reviewed. Refresh its status.");
  const updated=await tx.pgResidentRequest.update({where:{id},data:{status:decision,decidedAt:new Date()}});
  await audit(tx,accountId,setup.organisationId,`RESIDENT_REQUEST_${decision}`,id,{propertyId});return {request:summary(updated)};
 });
}
export type ResidentRentSetup={roomId:string;bedLabel?:string;joiningDate:string;monthlyRentPaise:number;securityDepositPaise:number;rentDueDay:number;mobile:string;password:string;identityChecked:true;existingStudentId?:string};
export async function setupRequestedResident(accountId:string,propertyId:string,id:string,input:ResidentRentSetup){
 const setup=await verifyOwner(accountId,propertyId,input.password);
 const {identityChecked}=input;
 assert(identityChecked,400,"IDENTITY_CONFIRMATION_REQUIRED","Verify the resident's identity first.");
 const joining=parseDateOnly(input.joiningDate);
 assert(joining.toISOString().slice(0,10)===input.joiningDate,400,"INVALID_DATE","Enter a valid joining date.");
 const period=datePartsInTimeZone(setup.property.timezone,joining);
 const financial={roomId:input.roomId,bedLabel:input.bedLabel||"",joiningDate:input.joiningDate,monthlyRentPaise:input.monthlyRentPaise,securityDepositPaise:input.securityDepositPaise,rentDueDay:input.rentDueDay,mobile:input.mobile,existingStudentId:input.existingStudentId||null};
 const fingerprint=crypto.createHash("sha256").update(JSON.stringify(financial)).digest("hex");
 const result=await atomic(async tx=>{
  const request=await tx.pgResidentRequest.findFirst({where:{id,propertyId,organisationId:setup.organisationId},include:{account:true}});
  assert(request,404,"REQUEST_NOT_FOUND","This request does not belong to this property.");
  if(request.status==="ACTIVE"){
   assert(request.setupHash===fingerprint,409,"SETUP_ALREADY_COMPLETED","This resident already has room and rent details. Edit their existing record to change them.");
   return {studentId:request.studentId!,membershipId:request.membershipId!};
  }
  assert(request.status==="ACCEPTED",409,"REQUEST_NOT_ACCEPTED","Accept this request before setting up rent.");
  assert(request.account.status==="ACTIVE",403,"RESIDENT_UNAVAILABLE","This resident account is unavailable.");
  const owner=await tx.pgMembership.findFirst({where:{accountId:request.accountId,role:"OWNER",status:"ACTIVE"}});
  assert(!owner,409,"OWNER_ACCOUNT","An owner account cannot be activated through a resident request.");
  const room=await tx.room.findFirst({where:{id:input.roomId,propertyId}});
  assert(room,404,"ROOM_NOT_FOUND","Choose a room from this property.");
  // Serializable retries protect capacity and duplicate activation together.
  await tx.$queryRaw`SELECT id FROM "Room" WHERE id=${room.id} FOR UPDATE`;
  let student;
  if(input.existingStudentId){
   student=await tx.student.findFirst({where:{id:input.existingStudentId,propertyId,status:"ACTIVE"}});
   assert(student,404,"RESIDENT_NOT_FOUND","Choose an existing record from this property.");
   const linked=await tx.pgMembership.findFirst({where:{actorUserId:student.userId,status:"ACTIVE",accountId:{not:request.accountId}}});
   const legacy=await tx.pgAccount.findUnique({where:{legacyUserId:student.userId}});
   assert(!linked&&(!legacy||legacy.id===request.accountId),409,"RESIDENCY_ALREADY_LINKED","This record belongs to another account.");
   assert(student.roomId===room.id&&student.monthlyRentPaise===input.monthlyRentPaise&&student.securityDepositPaise===input.securityDepositPaise&&student.rentDueDay===input.rentDueDay&&student.joiningDate.toISOString().slice(0,10)===input.joiningDate&&(student.bedLabel||"")===(input.bedLabel||"")&&student.mobile.replace(/\D/g,"").slice(-10)===input.mobile.slice(-10),409,"EXISTING_RECORD_MISMATCH","Existing rent records cannot be rewritten during linking. Review their saved room and rent.");
  }else{
   const occupied=await tx.student.count({where:{roomId:room.id,status:"ACTIVE"}});
   assert(occupied<room.capacity,409,"ROOM_FULL","This room is full. Choose another room.");
   if(input.bedLabel)assert(!await tx.student.findFirst({where:{roomId:room.id,status:"ACTIVE",bedLabel:input.bedLabel}}),409,"BED_OCCUPIED","This bed is already assigned.");
   assert(!await tx.student.findFirst({where:{propertyId,mobile:{in:[input.mobile,input.mobile.slice(-10),input.mobile.slice(1)]}}}),409,"EXISTING_RESIDENT_RECORD","A resident record already has this mobile number. Review and link that record instead of creating a duplicate.");
   const user=await tx.user.create({data:{fullName:request.fullName,email:null,passwordHash:null,role:"STUDENT",mustChangePassword:false}});
   student=await tx.student.create({data:{propertyId,userId:user.id,roomId:room.id,mobile:input.mobile,bedLabel:input.bedLabel||null,joiningDate:joining,monthlyRentPaise:input.monthlyRentPaise,securityDepositPaise:input.securityDepositPaise,rentDueDay:input.rentDueDay}});
   await tx.rentRevision.create({data:{propertyId,studentId:student.id,amountPaise:input.monthlyRentPaise,effectiveYear:period.year,effectiveMonth:period.month,reason:"INITIAL_RENT",createdByUserId:setup.property.ownerId}});
   await tx.auditLog.create({data:{propertyId,actorUserId:setup.property.ownerId,action:"RESIDENT_REQUEST_RENT_SETUP",entityType:"Student",entityId:student.id}});
  }
  const prior=await tx.pgMembership.findUnique({where:{accountId_propertyId_role:{accountId:request.accountId,propertyId,role:"RESIDENT"}}});
  assert(!prior||prior.status==="ACTIVE"&&(!prior.actorUserId||prior.actorUserId===student.userId),409,"MEMBERSHIP_CONFLICT","An existing membership needs review.");
  const member=prior?await tx.pgMembership.update({where:{id:prior.id},data:{actorUserId:student.userId}}):await tx.pgMembership.create({data:{accountId:request.accountId,propertyId,organisationId:setup.organisationId,role:"RESIDENT",actorUserId:student.userId,status:"ACTIVE",permissions:[]}});
  await tx.pgResidentRequest.update({where:{id},data:{status:"ACTIVE",membershipId:member.id,studentId:student.id,setupHash:fingerprint,activatedAt:new Date()}});
  await audit(tx,accountId,setup.organisationId,"RESIDENT_REQUEST_ACTIVATED",id,{propertyId,studentId:student.id,monthlyRentPaise:student.monthlyRentPaise,existingRecord:Boolean(input.existingStudentId)});
  return {studentId:student.id,membershipId:member.id};
 });
 // Public billing service retains existing due-date, rent revision and snapshot rules.
 for(let attempt=0;;attempt++)try{await ensureInvoices(propertyId);break;}catch(error:any){if(error.code!=="P2002"||attempt>=2)throw error;}
 return {...result,ok:true};
}
