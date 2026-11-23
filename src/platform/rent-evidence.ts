import {createHash} from "node:crypto";
import {prisma} from "../db.js";
import {assert} from "../errors.js";
import {atomic,audit} from "./service.js";

export const MAX_EVIDENCE_BYTES=512*1024;
// The client re-encodes screenshots/photos as JPEG to discard EXIF. Never accept
// SVG, executable formats, client filenames, external URLs or arbitrary blobs.
export function evidenceImage(encoded:string){
  assert(typeof encoded==="string"&&encoded.length<=Math.ceil(MAX_EVIDENCE_BYTES/3)*4&&/^[A-Za-z0-9+/]+={0,2}$/.test(encoded),400,"INVALID_IMAGE","Choose a JPEG image under 512 KB.");
  const bytes=Buffer.from(encoded,"base64");
  assert(bytes.toString("base64")===encoded&&bytes.length<=MAX_EVIDENCE_BYTES&&bytes.length>20&&bytes.readUInt16BE(0)===0xffd8&&bytes.readUInt16BE(bytes.length-2)===0xffd9,400,"INVALID_IMAGE","This image is not a supported JPEG.");
  let offset=2,width=0,height=0,sawScan=false;const parts=[bytes.subarray(0,2)];
  while(offset<bytes.length-2){
    const start=offset;assert(bytes[offset++]===255,400,"INVALID_IMAGE","Invalid JPEG image.");
    while(bytes[offset]===255)offset++;
    const marker=bytes[offset++]!;
    assert(marker!==0&&marker!==0xd8&&marker!==0xd9&&offset+2<=bytes.length,400,"INVALID_IMAGE","Invalid JPEG image.");
    const length=bytes.readUInt16BE(offset);assert(length>=2&&offset+length<=bytes.length,400,"INVALID_IMAGE","Invalid JPEG image.");
    if([0xc0,0xc1,0xc2].includes(marker)){assert(length>=8,400,"INVALID_IMAGE","Invalid JPEG dimensions.");height=bytes.readUInt16BE(offset+3);width=bytes.readUInt16BE(offset+5);}
    if(marker===0xda){parts.push(bytes.subarray(start));sawScan=true;break;}
    // Discard GPS/device metadata and comments even from a modified client.
    if(![0xe1,0xed,0xfe].includes(marker))parts.push(bytes.subarray(start,offset+length));
    offset+=length;
  }
  assert(sawScan&&width>0&&height>0&&width<=2048&&height<=2048,400,"INVALID_IMAGE","Choose an image up to 2048 pixels per side.");
  const data=Buffer.concat(parts);return {data,sha256:createHash("sha256").update(data).digest("hex"),width,height};
}
export async function residentContext(tx:any,accountId:string,membershipId:string){
  const member=await tx.pgMembership.findFirst({where:{id:membershipId,accountId,role:"RESIDENT",status:"ACTIVE"}});
  assert(member?.actorUserId,403,"RESIDENT_REQUIRED","Select your active resident workspace.");
  const student=await tx.student.findFirst({where:{userId:member.actorUserId,propertyId:member.propertyId,status:"ACTIVE"}});
  assert(student,403,"RESIDENT_INACTIVE","Your residency is not active.");return {member,student};
}
export async function ownerContext(tx:any,accountId:string,propertyId:string){
  const member=await tx.pgMembership.findFirst({where:{accountId,propertyId,role:"OWNER",status:"ACTIVE"},include:{organisation:true,property:true}});
  assert(member&&member.organisation.ownerAccountId===accountId&&member.property.ownerId===member.organisation.legacyOwnerId,403,"FORBIDDEN","Select your own property.");return member;
}
export async function storeEvidence(accountId:string,membershipId:string,purpose:"METER"|"PAYMENT",encoded:string){
  const image=evidenceImage(encoded);
  return atomic(async tx=>{
    const {member}=await residentContext(tx,accountId,membershipId);
    const existing=await tx.pgRentEvidence.findUnique({where:{accountId_propertyId_purpose_sha256:{accountId,propertyId:member.propertyId,purpose,sha256:image.sha256}}});
    if(existing)return {id:existing.id};
    assert(await tx.pgRentEvidence.count({where:{accountId,createdAt:{gte:new Date(Date.now()-86400000)}}})<30,429,"UPLOAD_LIMIT","Today's image limit was reached. Reuse a saved image or try tomorrow.");
    const saved=await tx.pgRentEvidence.create({data:{accountId,propertyId:member.propertyId,purpose,...image}});
    await audit(tx,accountId,member.organisationId,"RENT_EVIDENCE_STORED",saved.id,{purpose,bytes:image.data.length});return {id:saved.id};
  });
}
export async function readEvidence(accountId:string,membershipId:string,id:string){
  const member=await prisma.pgMembership.findFirst({where:{id:membershipId,accountId,status:"ACTIVE"}});
  assert(member,403,"WORKSPACE_REQUIRED","Select your workspace.");
  const evidence=await prisma.pgRentEvidence.findFirst({where:{id,propertyId:member.propertyId}});
  assert(evidence,404,"IMAGE_NOT_FOUND","Image not found.");
  if(member.role==="OWNER"){
    await ownerContext(prisma,accountId,member.propertyId);
    // An owner may view only images actually attached to this property's bill/proof.
    const attached=await prisma.pgElectricityBill.findFirst({where:{propertyId:member.propertyId,meterEvidenceId:id}})||await prisma.pgTransferProof.findFirst({where:{evidenceId:id,transfer:{propertyId:member.propertyId}}});
    assert(attached,404,"IMAGE_NOT_FOUND","Image not found.");
  }else{
    await residentContext(prisma,accountId,membershipId);assert(evidence.accountId===accountId,404,"IMAGE_NOT_FOUND","Image not found.");
  }
  return Buffer.from(evidence.data);
}
