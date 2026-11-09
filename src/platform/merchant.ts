import { prisma } from "../db.js";
import { ownerOrganisation } from "./service.js";
import { routeEnabled } from "./razorpay-route.js";
import { config } from "../config.js";
import { paymentKeyMode } from "./credentials.js";
import { platformConfig } from "./config.js";

// Read-only public-to-owner status. Never expose PAN, UPI IDs or full bank details.
// Old Cashfree attempts are archived, not activated or silently migrated to Razorpay.
export async function merchantStatus(accountId: string, organisationId: string) {
  const org = await ownerOrganisation(accountId, organisationId);
  const record = await prisma.pgMerchantAccount.findUnique({ where: { organisationId } });
  const environment = paymentKeyMode(config.RAZORPAY_KEY_ID) === "LIVE" ? "LIVE" : "TEST";
  const compatible = !record || (record.provider === "RAZORPAY_ROUTE" && record.providerEnvironment === environment);
  const active = Boolean(routeEnabled() && platformConfig.PGONE_RAZORPAY_ROUTE_RENT_LIVE_ENABLED === "true" && environment === "LIVE" && compatible &&
    record?.provider === "RAZORPAY_ROUTE" && record.status === "APPROVED" &&
    record.bankVerificationStatus === "VERIFIED" && record.verifiedAt);
  const status = !compatible ? "REVIEW_REQUIRED" : (record?.status || "NOT_CONNECTED");
  return {
    provider: "RAZORPAY_ROUTE",
    environment,
    onboardingAvailable: routeEnabled() && compatible,
    setupStarted: Boolean(record?.provider === "RAZORPAY_ROUTE" && record.providerAccountRef),
    status,
    kycStatus: record?.provider === "RAZORPAY_ROUTE" ? status : null,
    legacyCollection: org.legacyAccess,
    collectionEnabled: active,
    bank: null,
    bankSubmission: null,
    verifiedAt: active ? record?.verifiedAt : null,
    settlementMethod: record?.provider === "RAZORPAY_ROUTE" ? "UPI" : null,
    message: !compatible
      ? "A previous payment-provider application needs operator review. Cashfree onboarding has been retired."
      : !routeEnabled()
        ? "PGOne uses Razorpay. Owner-specific rent settlement requires Razorpay Route approval; existing account setup alone does not enable it."
        : status === "APPROVED"
          ? "Razorpay verified this linked UPI account. Payment capture and bank settlement are separate states; instant credit is not guaranteed."
          : "Create your own Razorpay linked account and complete provider-verified UPI settlement onboarding. Do not enter a UPI PIN.",
  };
}
