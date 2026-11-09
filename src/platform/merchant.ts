import { prisma } from "../db.js";
import { ownerOrganisation } from "./service.js";
import { embeddedEnabled } from "./cashfree-merchant.js";
import { platformConfig } from "./config.js";

// Only a contracted, provider-confirmed adapter may change these records.
// No bank/KYC data is collected while Embedded partner access is unavailable.
export async function merchantStatus(
  accountId: string,
  organisationId: string,
) {
  const org = await ownerOrganisation(accountId, organisationId);
  const record = await prisma.pgMerchantAccount.findUnique({
    where: { organisationId },
  });
  const environmentMatches = !record || record.providerEnvironment === platformConfig.PGONE_CASHFREE_ENV;
  const status = environmentMatches ? record?.status || "NOT_CONNECTED" : "REVIEW_REQUIRED";
  return {
    provider: "CASHFREE_EMBEDDED",
    onboardingAvailable: embeddedEnabled(),
    environment: platformConfig.PGONE_CASHFREE_ENV,
    setupStarted: Boolean(record?.providerAccountRef),
    kycStatus: (record?.requirements as any)?.productKycStatus || null,
    status,
    legacyCollection: org.legacyAccess,
    collectionEnabled: false,
    bank: null, // The status API does not echo a verified settlement account.
    bankSubmission: record?.bankLast4 ? { last4: record.bankLast4, status: record.bankVerificationStatus } : null,
    verifiedAt: environmentMatches ? record?.verifiedAt || null : null,
    message: !embeddedEnabled() ? (org.legacyAccess ? "Your existing rent payment flow remains available. Per-owner setup needs approved Cashfree Embedded access." : "Online payment setup needs approved Cashfree Embedded partner access.") :
      !environmentMatches ? "This account belongs to a different provider environment. Test approval does not enable live onboarding or collection. Operator review is required." :
      status === "APPROVED" ? "Cashfree confirmed merchant KYC approval. Rent collection is awaiting its separate settlement integration; no rent is routed to a shared account." :
      "Complete your merchant profile, settlement bank submission and Cashfree KYC. Bank details are submitted to Cashfree and never stored in full by PGOne.",
  };
}
