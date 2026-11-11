import { prisma } from "../db.js";
import { entitlement } from "./billing.js";

/** Read-only, server-authoritative routing state. Roles come only from memberships. */
export async function journey(account:{id:string;fullName:string;setupIntent:string|null;passwordChangeRequired:boolean},
  membership:{role:string;organisationId:string}|null) {
  if(account.passwordChangeRequired)return {state:"PASSWORD_CHANGE_REQUIRED",screen:"password"};
  if(membership?.role==="RESIDENT")return {state:"MEMBERSHIP_ACTIVE",screen:"studentHome"};
  if(!membership&&await prisma.pgResidentRequest.findFirst({where:{accountId:account.id,status:{in:["PENDING","ACCEPTED","REJECTED"]}}}))return {state:"RESIDENT_REQUEST_REVIEW",screen:"joinStatus"};
  if(!account.fullName.trim())return {state:account.setupIntent?"PROFILE_REQUIRED":"ACCOUNT_CREATED",
    screen:account.setupIntent==="OWNER"?"setupProfile":account.setupIntent==="RESIDENT"?"joinWorkspace":"chooseRole"};
  if(!membership){const count=await prisma.pgMembership.count({where:{accountId:account.id,status:"ACTIVE"}});
    return count?{state:"WORKSPACE_REQUIRED",screen:"workspaces"}:{state:"PROPERTY_REQUIRED",screen:account.setupIntent==="OWNER"?"setupProperty":"joinWorkspace"};}
  if(membership.role!=="OWNER")return {state:"MEMBERSHIP_ACTIVE",screen:membership.role==="RESIDENT"?"studentHome":"staffHome"};
  if(await entitlement(membership.organisationId))return {state:"SUBSCRIPTION_ACTIVE",screen:"ownerHome"};
  const [pending,last]=await Promise.all([
    prisma.pgPlanOrder.findFirst({where:{organisationId:membership.organisationId,open:true},orderBy:{createdAt:"desc"}}),
    prisma.pgPlanReceipt.findFirst({where:{organisationId:membership.organisationId},orderBy:{createdAt:"desc"}}),
  ]);
  const state=pending?.status==="CREATION_UNCERTAIN"?"PAYMENT_VERIFICATION_REQUIRED":pending?.status==="VERIFYING"?"PAYMENT_PENDING":
    pending?.status==="FAILED"?"PAYMENT_FAILED":pending?"PAYMENT_REQUIRED":last?.refundedPaise?"SUBSCRIPTION_REFUNDED":last?"SUBSCRIPTION_EXPIRED":"PAYMENT_REQUIRED";
  return {state,screen:"subscription"};
}
