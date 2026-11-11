import {requestPropertyAccess} from "./resident-requests.js";
import {prisma} from "../db.js";
import {config} from "../config.js";
import {assert,AppError} from "../errors.js";
import {atomic,audit,ownerOrganisation} from "./service.js";
import {entitlement} from "./billing.js";
import {passwordMatches} from "./passwords.js";
import {normalizeJoinCode,newJoinCode,formatJoinCode,joinCodeHash,encryptJoinCode,decryptJoinCode} from "./join-code-crypto.js";

function unavailable():never {throw new AppError(404,"PG_CODE_UNAVAILABLE","This PG code is invalid or unavailable. Check it with your owner.");}
async function ownedProperty(accountId:string,propertyId:string) {
  const setup=await prisma.pgPropertySetup.findUnique({where:{propertyId},include:{property:true}});
  assert(setup,404,"PROPERTY_NOT_FOUND","Property not found.");
  await ownerOrganisation(accountId,setup.organisationId);
  return setup;
}
function presentCode(row:{codeCipher:string;codeHash:string;revision:number;enabled:boolean}|null) {
  if(!row)return {code:null,revision:0,enabled:false};
  const code=decryptJoinCode(row.codeCipher,config.JWT_REFRESH_SECRET);
  assert(joinCodeHash(code)===row.codeHash,503,"PG_CODE_REVIEW_REQUIRED","Your PG code needs to be regenerated.");
  return {code:formatJoinCode(code),revision:row.revision,enabled:row.enabled};
}
export async function propertyJoinCode(accountId:string,propertyId:string) {
  const setup=await ownedProperty(accountId,propertyId);
  const row=await prisma.pgJoinCode.findUnique({where:{propertyId}});
  return {...presentCode(row),property:{id:propertyId,name:setup.property.name,city:setup.city}};
}
export async function manageJoinCode(accountId:string,propertyId:string,action:"ENSURE"|"ROTATE"|"DISABLE") {
  const setup=await ownedProperty(accountId,propertyId);
  if(action!=="DISABLE")assert(await entitlement(setup.organisationId),402,"SUBSCRIPTION_REQUIRED","Activate PGOne before sharing a joining code.");
  await atomic(async tx=>{
    const prior=await tx.pgJoinCode.findUnique({where:{propertyId}});
    if(action==="ENSURE"&&prior)return;
    if(action==="DISABLE") {
      if(prior?.enabled){await tx.pgJoinCode.update({where:{propertyId},data:{enabled:false}});
        await audit(tx,accountId,setup.organisationId,"PROPERTY_JOIN_CODE_DISABLED",propertyId,{revision:prior.revision});}
      return;
    }
    const code=newJoinCode(),data={codeHash:joinCodeHash(code),codeCipher:encryptJoinCode(code,config.JWT_REFRESH_SECRET),enabled:true};
    const row=prior?await tx.pgJoinCode.update({where:{propertyId},data:{...data,revision:{increment:1}}}):
      await tx.pgJoinCode.create({data:{...data,propertyId,organisationId:setup.organisationId,createdByAccountId:accountId}});
    await audit(tx,accountId,setup.organisationId,prior?"PROPERTY_JOIN_CODE_ROTATED":"PROPERTY_JOIN_CODE_CREATED",propertyId,{revision:row.revision});
  });
  return propertyJoinCode(accountId,propertyId);
}
async function consumeJoinAttempt(accountId:string) {
  const allowed=await atomic(async tx=>{
    const now=new Date(),prior=await tx.pgJoinCodeAttempt.findUnique({where:{accountId}});
    const row=await tx.pgJoinCodeAttempt.upsert({where:{accountId},
      create:{accountId,attempts:1,resetAt:new Date(now.getTime()+15*60000)},
      update:!prior||prior.resetAt<=now?{attempts:1,resetAt:new Date(now.getTime()+15*60000)}:{attempts:{increment:1}}});
    return row.attempts<=20;
  });
  assert(allowed,429,"PG_JOIN_RATE_LIMIT","Too many joining attempts. Try again in 15 minutes.");
}
export async function joinProperty(accountId:string,input:string,profile:{fullName?:string;mobile?:string}={}) {
  await consumeJoinAttempt(accountId);
  const code=normalizeJoinCode(input);if(!code)return unavailable();
  const digest=joinCodeHash(code),found=await prisma.pgJoinCode.findUnique({where:{codeHash:digest},include:{property:{include:{owner:true}},organisation:{include:{owner:true}}}});
  if(!found?.enabled||!await entitlement(found.organisationId)||found.property.owner.status!=="ACTIVE"||found.organisation.owner.status!=="ACTIVE")return unavailable();
  return requestPropertyAccess(accountId,found.propertyId,found.organisationId,profile,{hash:digest,revision:found.revision});
}
export async function joinedResidents(accountId:string,propertyId:string) {
  const setup=await ownedProperty(accountId,propertyId);
  const [members,students]=await Promise.all([
    prisma.pgMembership.findMany({where:{propertyId,organisationId:setup.organisationId,role:"RESIDENT",status:"ACTIVE"},
      include:{account:{select:{fullName:true,email:true}}},orderBy:{createdAt:"desc"}}),
    prisma.student.findMany({where:{propertyId,status:"ACTIVE"},select:{id:true,user:{select:{fullName:true}},userId:true,room:{select:{number:true}}}}),
  ]);
  return {members:members.map(m=>({id:m.id,name:m.account.fullName,email:m.account.email,assigned:Boolean(m.actorUserId),joinedAt:m.createdAt})),
    records:students.map(s=>({id:s.id,name:s.user.fullName,room:s.room?.number||null,linked:members.some(m=>m.actorUserId===s.userId)}))};
}
export async function linkResidentRecord(accountId:string,propertyId:string,input:{membershipId:string;studentId:string;password:string;identityChecked:true}) {
  const setup=await ownedProperty(accountId,propertyId);
  assert(await entitlement(setup.organisationId),402,"SUBSCRIPTION_REQUIRED","Activate PGOne before assigning resident records.");
  const account=await prisma.pgAccount.findUniqueOrThrow({where:{id:accountId}});
  assert(input.identityChecked&&await passwordMatches(input.password,account.passwordHash),403,"IDENTITY_CONFIRMATION_REQUIRED","Confirm your password and verify the resident's identity.");
  return atomic(async tx=>{
    const member=await tx.pgMembership.findFirst({where:{id:input.membershipId,propertyId,organisationId:setup.organisationId,role:"RESIDENT",status:"ACTIVE"}});
    const student=await tx.student.findFirst({where:{id:input.studentId,propertyId,status:"ACTIVE"}});
    assert(member&&student,404,"RESIDENT_NOT_FOUND","Choose a resident and record from this PG.");
    assert(!member.actorUserId||member.actorUserId===student.userId,409,"RESIDENCY_ALREADY_ASSIGNED","An existing assignment cannot be silently replaced.");
    const other=await tx.pgMembership.findFirst({where:{actorUserId:student.userId,accountId:{not:member.accountId},status:"ACTIVE"}});
    const legacy=await tx.pgAccount.findUnique({where:{legacyUserId:student.userId}});
    assert(!other&&(!legacy||legacy.id===member.accountId),409,"RESIDENCY_ALREADY_LINKED","This record belongs to another account. Use account recovery.");
    if(member.actorUserId===student.userId)return {ok:true};
    await tx.pgMembership.update({where:{id:member.id},data:{actorUserId:student.userId}});
    await audit(tx,accountId,setup.organisationId,"RESIDENT_RECORD_ASSIGNED",member.id,{studentId:student.id,identityChecked:true});
    return {ok:true};
  });
}
