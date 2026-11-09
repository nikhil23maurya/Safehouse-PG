import crypto from "node:crypto";
import { z } from "zod";
import { prisma } from "../db.js";
import { AppError, assert } from "../errors.js";
import { platformConfig, platformEnabled } from "./config.js";
import { atomic, audit, ownerOrganisation } from "./service.js";

export const embeddedEnabled = () => platformEnabled() && platformConfig.PGONE_CASHFREE_EMBEDDED_ENABLED === "true" && Boolean(platformConfig.PGONE_CASHFREE_PARTNER_API_KEY);
export const merchantProfileInput = z.object({
  email: z.email().max(254), name: z.string().trim().min(2).max(120),
  website: z.url().startsWith("https://").max(500),
  legalName: z.string().trim().min(2).max(150),
  businessType: z.enum(["Individual", "Proprietorship", "LLP", "Partnership", "Private Limited", "Public Limited", "Trust", "Society", "NGO", "Hindu Undivided Family (HUF)", "Association of Persons (AOP)", "Body of Individuals (BOI)", "Local Authority", "Artificial Juridical Person", "Government"]),
  businessModel: z.enum(["B2C", "B2B", "Both"]), consent: z.literal(true),
});
export const merchantBankInput = z.object({
  accountNumber: z.string().regex(/^\d{6,34}$/), confirmAccountNumber: z.string().regex(/^\d{6,34}$/),
  ifsc: z.string().trim().toUpperCase().regex(/^[A-Z]{4}0[A-Z0-9]{6}$/), consent: z.literal(true),
}).refine(value => value.accountNumber === value.confirmAccountNumber, { path: ["confirmAccountNumber"], message: "Account numbers must match." });

export function merchantReference(organisationId: string) {
  return `pgo_${crypto.createHash("sha256").update(organisationId).digest("hex").slice(0,32)}`;
}
function fingerprint(value: unknown) {
  return crypto.createHmac("sha256", platformConfig.PGONE_CASHFREE_PARTNER_API_KEY!).update(JSON.stringify(value)).digest("hex");
}
export function merchantStage(remote: any, expected: string) {
  assert(remote?.merchant_id === expected, 502, "MERCHANT_RESPONSE_MISMATCH", "The provider returned a different merchant account.");
  const products = Array.isArray(remote.product_status) ? remote.product_status.filter((p: any) => p?.product_name === "PG") : [];
  assert(products.length <= 1, 502, "MERCHANT_RESPONSE_MISMATCH", "The provider returned conflicting product status.");
  const pg = products[0];
  const kyc = String(pg?.product_min_kyc_status || "");
  const recognised = ["Created", "Email Verified", "ACTIVE"].includes(remote.onboarding_status);
  const status = !recognised ? "CHECKING" : kyc === "MIN_KYC_APPROVED" && remote.onboarding_status !== "Created" ? "APPROVED" :
    kyc === "MIN_KYC_REJECTED" ? "ACTION_REQUIRED" : kyc === "MIN_KYC_SUBMITTED" ? "UNDER_REVIEW" :
    remote.onboarding_status === "Created" ? "VERIFY_EMAIL" : "KYC_REQUIRED";
  return { status, onboardingStatus: String(remote.onboarding_status || "UNKNOWN"), productKycStatus: kyc || "UNKNOWN" };
}
export function safeOnboardingLink(value: unknown) {
  try {
    const url = new URL(String(value));
    const allowed = platformConfig.PGONE_CASHFREE_ENV === "TEST" ? ["test.cashfree.com", "merchant.cashfree.com"] : ["merchant.cashfree.com"];
    assert(url.protocol === "https:" && !url.username && !url.password && !url.port && allowed.includes(url.hostname), 502, "UNSAFE_ONBOARDING_LINK", "The provider onboarding link could not be verified.");
    return url.href;
  } catch { throw new AppError(502, "UNSAFE_ONBOARDING_LINK", "The provider onboarding link could not be verified."); }
}

export class CashfreeMerchantProvider {
  constructor(private readonly fetcher: typeof fetch = fetch) {}
  async request(path: string, method = "GET", body?: object) {
    assert(embeddedEnabled(), 503, "EMBEDDED_NOT_CONFIGURED", "Owner payment onboarding needs an approved Cashfree Embedded partner account.");
    assert(/^\/merchants(?:\/[a-zA-Z0-9_-]+(?:\/onboarding_link)?)?$/.test(path), 400, "INVALID_PROVIDER_PATH", "Invalid merchant request.");
    const host = platformConfig.PGONE_CASHFREE_ENV === "TEST" ? "https://api-sandbox.cashfree.com/partners" : "https://api.cashfree.com/partners";
    let response;
    try {
      response = await this.fetcher(host + path, { method, redirect: "error", headers: {
        "x-partner-apikey": platformConfig.PGONE_CASHFREE_PARTNER_API_KEY!, "x-api-version": "2023-01-01", "content-type": "application/json",
      }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(15000) });
    } catch { throw new AppError(503, "MERCHANT_STATUS_UNCERTAIN", "The provider has not confirmed this request. Refresh setup status before retrying."); }
    if (response.status === 404) throw new AppError(404, "PROVIDER_MERCHANT_NOT_FOUND", "The provider has not confirmed the merchant yet.");
    assert(response.ok, response.status === 401 || response.status === 403 ? 503 : 502, "MERCHANT_PROVIDER_UNAVAILABLE", "The provider could not confirm the merchant request. No approval has been assumed.");
    try { return await response.json() as any; }
    catch { throw new AppError(502, "MERCHANT_PROVIDER_UNAVAILABLE", "The provider returned an unreadable confirmation. No approval has been assumed."); }
  }
  get(id: string) { return this.request(`/merchants/${id}`); }
  create(body: object) { return this.request("/merchants", "POST", body); }
  bank(id: string, number: string, ifsc: string) {
    return this.request(`/merchants/${id}`, "PATCH", { bank_account_details: { bank_account_number: number, bank_ifsc: ifsc } });
  }
  link(id: string) { return this.request(`/merchants/${id}/onboarding_link`, "POST", { type: "account_onboarding", return_url: "https://safehouse-api.onrender.com/merchant-return" }); }
}

export async function syncMerchantRecord(organisationId: string, provider = new CashfreeMerchantProvider()) {
  const record = await prisma.pgMerchantAccount.findUniqueOrThrow({ where: { organisationId } });
  assert(record.providerEnvironment === platformConfig.PGONE_CASHFREE_ENV, 409, "MERCHANT_ENVIRONMENT_CHANGED", "Test and live merchant accounts must be reviewed separately. No test approval enables live collection.");
  assert(record.provider === "CASHFREE_EMBEDDED" && record.providerAccountRef === merchantReference(organisationId), 409, "MERCHANT_BINDING_INVALID", "Merchant access needs operator review.");
  const remote = await provider.get(record.providerAccountRef);
  const stage = merchantStage(remote, record.providerAccountRef);
  return atomic(async tx => {
    const current = await tx.pgMerchantAccount.findUniqueOrThrow({ where: { organisationId } });
    if (current.status !== stage.status || current.creationState !== "CONFIRMED") {
      const updated = await tx.pgMerchantAccount.update({ where: { organisationId }, data: {
        creationState: "CONFIRMED", status: stage.status, requirements: stage,
        verifiedAt: stage.status === "APPROVED" ? new Date() : null,
      } });
      await audit(tx, null, organisationId, "MERCHANT_PROVIDER_STATUS_VERIFIED", current.id, { status: stage.status });
      return updated;
    }
    return current;
  });
}

export async function beginMerchantSetup(accountId: string, organisationId: string, input: z.infer<typeof merchantProfileInput>, provider = new CashfreeMerchantProvider()) {
  const org = await ownerOrganisation(accountId, organisationId);
  assert(embeddedEnabled(), 503, "EMBEDDED_NOT_CONFIGURED", "Cashfree Embedded onboarding is not activated yet.");
  const account = await prisma.pgAccount.findUniqueOrThrow({ where: { id: accountId } });
  assert(account.phoneE164, 409, "VERIFIED_PHONE_REQUIRED", "Verify and link your mobile number before merchant setup.");
  const merchantId = merchantReference(org.id), digest = fingerprint({ ...input, phone: account.phoneE164 });
  const result = await atomic(async tx => {
    const existing = await tx.pgMerchantAccount.findUnique({ where: { organisationId } });
    if (existing) {
      assert(existing.provider === "CASHFREE_EMBEDDED" && existing.providerAccountRef === merchantId && existing.providerEnvironment === platformConfig.PGONE_CASHFREE_ENV, 409, "MERCHANT_BINDING_INVALID", "Merchant setup needs review.");
      assert(existing.profileFingerprint === digest, 409, "MERCHANT_PROFILE_CHANGED", "Refresh the existing setup. Contact support to change a merchant profile already submitted to Cashfree.");
      return { record: existing, created: false };
    }
    const record = await tx.pgMerchantAccount.create({ data: { organisationId, provider: "CASHFREE_EMBEDDED", providerAccountRef: merchantId,
      profileFingerprint: digest, creationState: "CREATING", status: "CREATING", providerEnvironment: platformConfig.PGONE_CASHFREE_ENV } });
    await audit(tx, accountId, organisationId, "MERCHANT_SETUP_CONSENT_RECORDED", record.id, { provider: "CASHFREE_EMBEDDED", terms: platformConfig.PGONE_TERMS_URL, privacy: platformConfig.PGONE_PRIVACY_URL });
    return { record, created: true };
  });
  let createOriginal = result.created;
  if (!createOriginal) {
    try { return await syncMerchantRecord(organisationId,provider); }
    catch (error) {
      if (!(error instanceof AppError) || error.code !== "PROVIDER_MERCHANT_NOT_FOUND" || result.record.creationState === "CONFIRMED") throw error;
      // Cashfree's client-supplied merchant ID is unique. Retry only the same
      // verified profile and ID after an authenticated not-found response.
      createOriginal = true;
    }
  }
  if (createOriginal) {
    try {
      const remote = await provider.create({ merchant_id: merchantId, merchant_email: input.email, merchant_name: input.name,
        poc_phone: account.phoneE164.replace(/^\+91/, ""), merchant_site_url: input.website,
        business_details: { business_legal_name: input.legalName, business_type: input.businessType, business_model: input.businessModel } });
      merchantStage(remote, merchantId);
    } catch (error) {
      await atomic(async tx => {
        await tx.pgMerchantAccount.update({ where: { organisationId }, data: { creationState: "UNCERTAIN", status: "CHECKING" } });
        await audit(tx, accountId, organisationId, "MERCHANT_CREATION_UNCERTAIN", result.record.id);
      });
      throw error;
    }
  }
  // Recovery uses the same deterministic ID; never create a second merchant after a lost response.
  return syncMerchantRecord(organisationId, provider);
}

export async function submitMerchantBank(accountId: string, organisationId: string, input: z.infer<typeof merchantBankInput>, provider = new CashfreeMerchantProvider()) {
  await ownerOrganisation(accountId, organisationId);
  const record = await syncMerchantRecord(organisationId, provider);
  assert(record.status !== "APPROVED", 409, "APPROVED_BANK_CHANGE_REVIEW", "Use the provider's approved bank-change process for an active merchant.");
  const digest = fingerprint({ accountNumber: input.accountNumber, ifsc: input.ifsc });
  if (record.bankSubmissionFingerprint === digest && record.bankVerificationStatus === "SUBMITTED") return record;
  await atomic(async tx => {
    const current = await tx.pgMerchantAccount.findUniqueOrThrow({ where: { organisationId } });
    assert(!["SUBMITTING", "CHECKING"].includes(current.bankVerificationStatus), 409, "BANK_SUBMISSION_UNCERTAIN", "Your earlier bank submission needs confirmation in Cashfree. Complete secure KYC instead of submitting it again.");
    await tx.pgMerchantAccount.update({ where: { organisationId }, data: { bankLast4: input.accountNumber.slice(-4), bankSubmissionFingerprint: digest, bankVerificationStatus: "SUBMITTING" } });
    await audit(tx, accountId, organisationId, "MERCHANT_BANK_CONSENT_RECORDED", record.id, { last4: input.accountNumber.slice(-4) });
  });
  try {
    const remote = await provider.bank(record.providerAccountRef!, input.accountNumber, input.ifsc);
    merchantStage(remote, record.providerAccountRef!);
  } catch (error) {
    await atomic(async tx => {
      await tx.pgMerchantAccount.update({ where: { organisationId }, data: { bankVerificationStatus: "CHECKING" } });
      await audit(tx, accountId, organisationId, "MERCHANT_BANK_CONFIRMATION_REQUIRED", record.id);
    });
    throw error;
  }
  await atomic(async tx => {
    await tx.pgMerchantAccount.update({ where: { organisationId }, data: { bankLast4: input.accountNumber.slice(-4), bankSubmissionFingerprint: digest, bankVerificationStatus: "SUBMITTED" } });
    await audit(tx, accountId, organisationId, "MERCHANT_BANK_SUBMITTED", record.id, { last4: input.accountNumber.slice(-4) });
  });
  return syncMerchantRecord(organisationId, provider);
}

export async function merchantOnboardingLink(accountId: string, organisationId: string, provider = new CashfreeMerchantProvider()) {
  await ownerOrganisation(accountId, organisationId);
  const record = await syncMerchantRecord(organisationId, provider);
  assert(record.status !== "APPROVED", 409, "MERCHANT_ALREADY_APPROVED", "The provider already approved this account. Refresh status.");
  const result = await provider.link(record.providerAccountRef!);
  const expiresAt = new Date(result.expires_at);
  assert(Number.isFinite(expiresAt.getTime()) && expiresAt > new Date() && expiresAt.getTime() <= Date.now() + 65*60000, 502, "ONBOARDING_LINK_EXPIRED", "Request a fresh onboarding link.");
  const url = safeOnboardingLink(result.onboarding_link);
  await atomic(tx => audit(tx, accountId, organisationId, "MERCHANT_KYC_LINK_ISSUED", record.id));
  return { url, expiresAt, provider: "CASHFREE_EMBEDDED" };
}

export function cashfreeSignature(raw: Buffer, timestamp: string, signature: string, secret: string, now = Date.now()) {
  const time = /^\d{13}$/.test(timestamp) ? Number(timestamp) : Date.parse(timestamp);
  if (!Number.isFinite(time) || now-time > 300000 || time-now > 30000 || !/^[A-Za-z0-9+/]{43}=$/.test(signature)) return false;
  const expected = crypto.createHmac("sha256", secret).update(timestamp).update(raw).digest();
  return crypto.timingSafeEqual(expected, Buffer.from(signature, "base64"));
}
export async function processMerchantWebhook(raw: Buffer, timestamp: string, signature: string, provider = new CashfreeMerchantProvider()) {
  const secret = platformConfig.PGONE_CASHFREE_PARTNER_API_KEY;
  assert(embeddedEnabled() && secret && cashfreeSignature(raw,timestamp,signature,secret), 400, "INVALID_MERCHANT_SIGNATURE", "Invalid merchant webhook signature.");
  const event = JSON.parse(raw.toString("utf8"));
  if (event.type !== "MERCHANT_ONBOARDING_STATUS") return;
  const reference = event.data?.merchant_id;
  assert(typeof reference === "string" && /^[a-zA-Z0-9_-]{1,40}$/.test(reference), 400, "INVALID_MERCHANT_REFERENCE", "Invalid merchant reference.");
  const record = await prisma.pgMerchantAccount.findUnique({ where: { providerAccountRef: reference } });
  if (!record) return;
  const hash = crypto.createHash("sha256").update(raw).digest("hex");
  const prior = await prisma.pgProviderEvent.findUnique({ where: { provider_eventKey: { provider: "CASHFREE_MERCHANT", eventKey: hash } } });
  if (prior) return;
  await syncMerchantRecord(record.organisationId,provider); // A signed notification alone never approves KYC.
  await atomic(async tx => {
    const exists = await tx.pgProviderEvent.findUnique({ where: { provider_eventKey: { provider: "CASHFREE_MERCHANT", eventKey: hash } } });
    if (!exists) await tx.pgProviderEvent.create({ data: { provider:"CASHFREE_MERCHANT",eventKey:hash,payloadHash:hash,eventType:event.type } });
  });
}
