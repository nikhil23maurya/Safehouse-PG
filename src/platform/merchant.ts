import { prisma } from "../db.js";
import { ownerOrganisation } from "./service.js";

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
  return {
    provider: "CASHFREE_EMBEDDED",
    onboardingAvailable: false,
    status: record?.status || "NOT_CONNECTED",
    legacyCollection: org.legacyAccess,
    collectionEnabled: false,
    bank: record?.bankLast4
      ? { last4: record.bankLast4, status: record.bankVerificationStatus }
      : null,
    verifiedAt: record?.verifiedAt || null,
    message:
      "Online payment setup is awaiting payment-provider activation. No bank or KYC documents are required in PGOne yet.",
  };
}
