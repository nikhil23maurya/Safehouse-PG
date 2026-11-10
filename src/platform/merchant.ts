import { ownerOrganisation } from "./service.js";
export async function merchantStatus(accountId:string,organisationId:string) {
  const org = await ownerOrganisation(accountId,organisationId);
  return {provider:"RAZORPAY",onboardingAvailable:false,collectionEnabled:false,
    legacyCollection:org.legacyAccess,status:"APPROVAL_REQUIRED",bank:null,
    message:"Automated rent settlement to independent owners needs approved Razorpay Route or connected-merchant onboarding. Record rent received in your own bank through manual payments. The PGOne fee is separate."};
}
