// Historical phone records for migration/regression tests only; no auth route uses this.
import {prisma} from "../src/db.js";
import {assert} from "../src/errors.js";
export async function phoneAccount(identity:{uid:string;phoneE164:string},create=true) {
  const found=await prisma.pgAccount.findFirst({where:{OR:[{firebaseUid:identity.uid},{phoneE164:identity.phoneE164}]}});
  if(found){assert(found.firebaseUid===identity.uid&&found.phoneE164===identity.phoneE164,409,"IDENTITY_CONFLICT","Conflicting historical identity");return found;}
  assert(create,404,"PHONE_ACCOUNT_NOT_FOUND","No historical record");
  return prisma.pgAccount.create({data:{firebaseUid:identity.uid,phoneE164:identity.phoneE164}});
}
