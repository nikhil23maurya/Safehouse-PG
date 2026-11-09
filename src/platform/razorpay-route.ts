import crypto from "node:crypto";
import { z } from "zod";
import { prisma } from "../db.js";
import { config } from "../config.js";
import { AppError, assert } from "../errors.js";
import { platformConfig, platformEnabled } from "./config.js";
import { entitlement } from "./billing.js";
import { atomic, audit, ownerOrganisation } from "./service.js";
import { paymentKeyMode, requiresLivePaymentKey } from "./credentials.js";

const accountPattern = /^acc_[a-zA-Z0-9]{8,25}$/;
const vpaPattern = /^[a-zA-Z0-9._-]{2,80}@[a-zA-Z0-9.-]{2,50}$/;
export const routeEnabled = () => platformEnabled() &&
  platformConfig.PGONE_RAZORPAY_ROUTE_ENABLED === "true" &&
  Boolean(config.RAZORPAY_KEY_ID && config.RAZORPAY_KEY_SECRET) &&
  (!requiresLivePaymentKey({ nodeEnv: config.NODE_ENV, render: process.env.RENDER }) ||
    paymentKeyMode(config.RAZORPAY_KEY_ID) === "LIVE");
const environment = () => paymentKeyMode(config.RAZORPAY_KEY_ID) === "LIVE" ? "LIVE" : "TEST";
const secret = () => {
  assert(routeEnabled(), 503, "RAZORPAY_ROUTE_NOT_ACTIVE", "Razorpay Route requires explicit parent-account approval and activation.");
  return config.RAZORPAY_KEY_SECRET!;
};
export const routeReference = (organisationId: string) =>
  "pgo_" + crypto.createHash("sha256").update("pgone:route:" + organisationId).digest("hex").slice(0,32);
const deterministicIdempotency = (organisationId: string) => {
  const h = crypto.createHash("sha256").update("pgone:route:onboard:" + organisationId).digest("hex");
  return `${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-8${h.slice(17,20)}-${h.slice(20,32)}`;
};
const comparableName = (name: string) => name.normalize("NFKC").toUpperCase().replace(/[^A-Z0-9]/g, "");
export const routeOnboardingInput = z.object({
  legalName: z.string().trim().min(4).max(200),
  email: z.string().email().max(254),
  businessType: z.enum(["individual", "proprietorship", "partnership", "private_limited"]),
  pan: z.string().trim().toUpperCase().regex(/^[A-Z]{5}[0-9]{4}[A-Z]$/),
  vpa: z.string().trim().toLowerCase().regex(vpaPattern),
  consent: z.literal(true),
});
type Onboarding = z.infer<typeof routeOnboardingInput>;
export function routeAccountStage(remote: any, reference: string, expectedAccount?: string | null) {
  assert(remote && accountPattern.test(remote.id) && remote.type === "route" &&
    remote.reference_id === reference && (!expectedAccount || expectedAccount === remote.id),
    502, "ROUTE_ACCOUNT_MISMATCH", "Razorpay returned an account unrelated to this PGOne owner.");
  const product = remote.product_config;
  const methods = product?.active_configuration?.settlement_accounts;
  const dest = Array.isArray(methods) && methods.length === 1 ? methods[0] : null;
  const active = remote.status === "created" && product?.product_name === "route" &&
    product?.activation_status === "activated" && dest?.active === true &&
    dest?.verification_status === "verified" && dest?.method === "upi" &&
    remote.tnc?.accepted === true;
  return { accountId: remote.id as string,
    status: active ? "APPROVED" : "UNDER_REVIEW",
    verifiedAt: active ? new Date() : null,
    verification: dest?.verification_status || "pending",
    settlementMethod: dest?.method || null,
    collectionEnabled: Boolean(active && routeEnabled() && platformConfig.PGONE_RAZORPAY_ROUTE_RENT_LIVE_ENABLED === "true" && environment() === "LIVE"),
  };
}
export class RazorpayRoute {
  constructor(private readonly fetcher: typeof fetch = fetch) {}
  private async call(path: string, method = "GET", body?: object, idempotency?: string) {
    const allowed = /^\/v2\/accounts(?:\/acc_[a-zA-Z0-9]{8,25})?$/.test(path) ||
      path === "/v1/payments/validate/vpa";
    assert(allowed, 400, "ROUTE_INVALID_PATH", "Unsupported Route API path.");
    const token = Buffer.from(`${config.RAZORPAY_KEY_ID}:${secret()}`).toString("base64");
    let response: Response;
    try {
      response = await this.fetcher("https://api.razorpay.com" + path, {
        method,
        headers: {
          authorization: `Basic ${token}`,
          "content-type": "application/json",
          ...(idempotency ? { "Idempotency-Key": idempotency } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        redirect: "error",
        signal: AbortSignal.timeout(15000),
      });
    } catch {
      throw new AppError(503, "ROUTE_STATUS_UNCERTAIN", "Razorpay has not confirmed this action. Check status before retrying.");
    }
    if (!response.ok) throw new AppError(response.status === 401 || response.status === 403 ? 503 : 502,
      "ROUTE_PROVIDER_UNAVAILABLE", "Razorpay Route cannot confirm the account. Verify approval and credentials.");
    try { return await response.json() as any; } catch {
      throw new AppError(502, "ROUTE_PROVIDER_INVALID", "Razorpay returned an invalid account confirmation.");
    }
  }
  validateVpa(vpa: string) { return this.call("/v1/payments/validate/vpa", "POST", { vpa }); }
  create(body: object, key: string) { return this.call("/v2/accounts", "POST", body, key); }
  get(id: string) { return this.call("/v2/accounts/" + id); }
}
function fingerprint(input: Onboarding, phone: string) {
  return crypto.createHmac("sha256", secret()).update(JSON.stringify({
    legalName: input.legalName, email: input.email.toLowerCase(),
    businessType: input.businessType, pan: input.pan, vpa: input.vpa, phone,
  })).digest("hex");
}
export async function syncRazorpayRoute(organisationId: string, provider = new RazorpayRoute()) {
  const local = await prisma.pgMerchantAccount.findUnique({ where: { organisationId } });
  assert(local?.provider === "RAZORPAY_ROUTE" && local.providerEnvironment === environment() &&
    local.providerAccountRef && accountPattern.test(local.providerAccountRef),
    409, "ROUTE_ACCOUNT_UNCONFIRMED", "Razorpay has not returned a verified linked-account ID.");
  const remote = await provider.get(local.providerAccountRef);
  const verified = routeAccountStage(remote, routeReference(organisationId), local.providerAccountRef);
  await atomic(async tx => {
    const current = await tx.pgMerchantAccount.findUniqueOrThrow({ where: { organisationId } });
    assert(current.providerAccountRef === verified.accountId, 409, "ROUTE_BINDING_CHANGED", "Owner's linked account changed during verification.");
    await tx.pgMerchantAccount.update({ where: { organisationId }, data: {
      status: verified.status, verifiedAt: verified.verifiedAt,
      bankVerificationStatus: verified.verification.toUpperCase(),
      requirements: { settlementMethod: verified.settlementMethod, product: "route" },
      creationState: "CONFIRMED",
    } });
    await audit(tx, null, organisationId, "RAZORPAY_ROUTE_STATUS_VERIFIED", current.id, { status: verified.status });
  });
  return verified;
}
export async function onboardRazorpayRoute(accountId: string, organisationId: string, raw: unknown,
  provider = new RazorpayRoute()) {
  const data = routeOnboardingInput.parse(raw);
  await ownerOrganisation(accountId, organisationId);
  assert(await entitlement(organisationId), 402, "SUBSCRIPTION_REQUIRED", "Activate PGOne before owner settlement setup.");
  assert(routeEnabled(), 503, "ROUTE_NOT_APPROVED", "Razorpay Route onboarding is awaiting platform approval.");
  const owner = await prisma.pgAccount.findUniqueOrThrow({ where: { id: accountId } });
  assert(owner.phoneE164, 409, "VERIFIED_PHONE_REQUIRED", "Verify your phone number before onboarding.");
  const digest = fingerprint(data, owner.phoneE164);
  const current = await prisma.pgMerchantAccount.findUnique({ where: { organisationId } });
  if (current) {
    assert(current.provider === "RAZORPAY_ROUTE" && current.providerEnvironment === environment(),
      409, "ROUTE_PROVIDER_MISMATCH", "This merchant account needs operator migration review.");
    assert(current.profileFingerprint === digest, 409, "ROUTE_PROFILE_CHANGED",
      "The submitted identity differs from the pending Razorpay application. Contact support.");
    if (current.providerAccountRef) return syncRazorpayRoute(organisationId, provider);
  }
  // Validate the beneficiary via Razorpay rather than trusting a manually typed UPI ID/name.
  const validation = await provider.validateVpa(data.vpa);
  assert(validation?.success === true && typeof validation.customer_name === "string" &&
    comparableName(validation.customer_name) === comparableName(data.legalName),
    409, "ROUTE_VPA_NAME_MISMATCH",
    "Razorpay could not verify that this UPI ID belongs to the submitted legal name.");
  await atomic(async tx => {
    const existing = await tx.pgMerchantAccount.findUnique({ where: { organisationId } });
    if (!existing) {
      const created = await tx.pgMerchantAccount.create({ data: {
        organisationId, provider: "RAZORPAY_ROUTE", providerEnvironment: environment(),
        creationState: "CREATING", status: "UNDER_REVIEW", profileFingerprint: digest,
        bankVerificationStatus: "NOT_STARTED",
      } });
      await audit(tx, accountId, organisationId, "RAZORPAY_ROUTE_CONSENT_RECORDED", created.id,
        { provider: "RAZORPAY_ROUTE", settlementMethod: "upi" });
    } else assert(existing.profileFingerprint === digest, 409, "ROUTE_PROFILE_CHANGED", "Merchant details changed during onboarding.");
  });
  // The exact same external reference + Idempotency-Key are reused if the API response is lost.
  // Never invent a second account, and do not keep PAN/VPA in our DB or audit logs.
  const remote = await provider.create({
    type: "route", tnc_accepted: true, reference_id: routeReference(organisationId),
    legal_business_name: data.legalName, business_type: data.businessType,
    email: data.email, phone: owner.phoneE164,
    legal_info: { pan: data.pan },
    settlement_accounts: [{
      method: "upi", upi: {
        vpa: data.vpa, beneficiary_name: validation.customer_name, currency: "INR", is_default: true,
      },
    }],
  }, deterministicIdempotency(organisationId));
  const verified = routeAccountStage(remote, routeReference(organisationId));
  await atomic(async tx => {
    const record = await tx.pgMerchantAccount.findUniqueOrThrow({ where: { organisationId } });
    assert(record.provider === "RAZORPAY_ROUTE" && record.profileFingerprint === digest,
      409, "ROUTE_ACCOUNT_MISMATCH", "Linked account changed during creation.");
    await tx.pgMerchantAccount.update({ where: { organisationId }, data: {
      providerAccountRef: verified.accountId, creationState: "CONFIRMED",
      status: verified.status, bankVerificationStatus: verified.verification.toUpperCase(),
      verifiedAt: verified.verifiedAt,
      requirements: { settlementMethod: verified.settlementMethod, product: "route" },
    } });
    await audit(tx, accountId, organisationId, "RAZORPAY_ROUTE_LINKED", record.id,
      { linkedAccountId: verified.accountId, verification: verified.verification });
  });
  return verified;
}
export async function verifiedRentDestination(organisationId: string, provider = new RazorpayRoute()) {
  assert(routeEnabled() && platformConfig.PGONE_RAZORPAY_ROUTE_RENT_LIVE_ENABLED === "true" && environment() === "LIVE", 409, "ROUTE_NOT_ACTIVE",
    "Owner-specific Razorpay Route is not activated for live rent collection.");
  const state = await syncRazorpayRoute(organisationId, provider);
  assert(state.collectionEnabled, 409, "ROUTE_SETTLEMENT_NOT_VERIFIED",
    "The owner's linked UPI settlement account has not been verified.");
  return state.accountId;
}
export function routeTransfer(accountId: string, amountPaise: number) {
  assert(accountPattern.test(accountId) && Number.isSafeInteger(amountPaise) && amountPaise >= 100 && amountPaise <= 10000000,
    400, "ROUTE_TRANSFER_INVALID", "Invalid linked account or rent amount.");
  return { account: accountId, amount: amountPaise, currency: "INR", on_hold: false };
}
