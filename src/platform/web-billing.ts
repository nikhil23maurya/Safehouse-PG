import type { Request } from "express";
import crypto from "node:crypto";
import { assert } from "../errors.js";
import { prisma } from "../db.js";
import { platformConfig, platformEnabled } from "./config.js";
import {
  billingConfigured,
  reconcileSubscription,
  subscriptionStatus,
} from "./billing.js";
import { atomic, audit, ownerOrganisation } from "./service.js";

export function customWebBillingEnabled() {
  return (
    platformEnabled() &&
    platformConfig.PGONE_CUSTOM_WEB_BILLING_ENABLED === "true" &&
    billingConfigured()
  );
}
export function requireBillingOrigin(req: Request) {
  assert(
    customWebBillingEnabled(),
    503,
    "CUSTOM_BILLING_UNAVAILABLE",
    "Custom subscription authorisation is awaiting provider activation.",
  );
  assert(
    req.header("origin") ===
      new URL(platformConfig.PGONE_BILLING_WEB_ORIGIN!).origin,
    403,
    "BILLING_ORIGIN_REQUIRED",
    "Use the approved PGOne billing website.",
  );
}
export function authorisationSignature(
  paymentId: string,
  subscriptionId: string,
  signature: string,
  secret: string,
) {
  if (
    !/^pay_[a-zA-Z0-9]+$/.test(paymentId) ||
    !/^sub_[a-zA-Z0-9]+$/.test(subscriptionId) ||
    !/^[a-fA-F0-9]{64}$/.test(signature)
  )
    return false;
  const expected = crypto
    .createHmac("sha256", secret)
    .update(`${paymentId}|${subscriptionId}`)
    .digest();
  return crypto.timingSafeEqual(expected, Buffer.from(signature, "hex"));
}
export async function verifyAuthorisation(
  accountId: string,
  organisationId: string,
  input: { paymentId: string; signature: string },
) {
  await ownerOrganisation(accountId, organisationId);
  const sub = await prisma.pgSubscription.findFirst({
    where: { organisationId, current: true },
  });
  assert(
    sub?.providerSubscriptionId &&
      platformConfig.PGONE_SUBSCRIPTION_KEY_SECRET &&
      authorisationSignature(
        input.paymentId,
        sub.providerSubscriptionId,
        input.signature,
        platformConfig.PGONE_SUBSCRIPTION_KEY_SECRET,
      ),
    400,
    "INVALID_AUTHORISATION",
    "The payment provider authorisation could not be verified.",
  );
  // A signed SDK callback authenticates its source, not settlement or entitlement.
  await reconcileSubscription(sub.id);
  await atomic((tx) =>
    audit(
      tx,
      accountId,
      organisationId,
      "SUBSCRIPTION_AUTHORISATION_VERIFIED",
      sub.id,
      { providerPaymentId: input.paymentId },
    ),
  );
  return subscriptionStatus(accountId, organisationId);
}
