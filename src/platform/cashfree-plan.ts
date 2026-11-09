import crypto from "node:crypto";
import { prisma } from "../db.js";
import { AppError, assert } from "../errors.js";
import { platformConfig, taxBreakdown, PLAN } from "./config.js";
import { atomic, audit, ownerOrganisation } from "./service.js";
import { paidAccessChain, indiaDay, nextCalendarMonth } from "./plan-period.js";
import { manualPlanStatus } from "./plan-payments.js";

const API_VERSION = "2026-01-01";
const client = () => ({
  id: platformConfig.PGONE_CASHFREE_PG_CLIENT_ID,
  secret: platformConfig.PGONE_CASHFREE_PG_CLIENT_SECRET,
  environment: platformConfig.PGONE_CASHFREE_PG_ENV,
});
export const cashfreeBillingEnabled = () =>
  platformConfig.PGONE_CASHFREE_BILLING_ENABLED === "true" &&
  Boolean(client().id && client().secret && platformConfig.PGONE_TAX_BPS !== undefined &&
    platformConfig.PGONE_BILLING_WEB_ORIGIN && platformConfig.PGONE_CASHFREE_PG_ENV === "LIVE");
export const cashfreeBillingConfigured = () =>
  platformConfig.PGONE_CASHFREE_BILLING_ENABLED === "true" &&
  Boolean(client().id && client().secret && platformConfig.PGONE_TAX_BPS !== undefined && platformConfig.PGONE_BILLING_WEB_ORIGIN);
export const isCashfreeOrder = (key: string) => key.startsWith("cashfree:");
const providerKey = () => `cashfree:${client().environment}:${client().id || ""}`;
const orderId = (reference: string) => `pgone_${reference}`;
const moneyPaise = (amount: unknown) =>
  typeof amount === "number" && Number.isFinite(amount) ? Math.round(amount * 100) : NaN;

type Local = {
  id: string; organisationId: string; receiptReference: string; providerOrderId: string | null;
  providerKeyId: string; amountPaise: number; taxPaise: number; createdAt: Date;
  status: string; open: boolean;
};
export function matchCashfreeOrder(remote: any, local: Local) {
  return remote?.order_id === orderId(local.receiptReference) &&
    remote.order_currency === "INR" &&
    moneyPaise(remote.order_amount) === local.amountPaise &&
    (!local.providerOrderId || local.providerOrderId === remote.order_id) &&
    remote.order_tags?.pgone_organisation === local.organisationId &&
    remote.order_tags?.pgone_local_order === local.id &&
    remote.order_tags?.pgone_product === "PGONE_MONTHLY";
}
export function successfulCashfreePayment(payment: any, remote: any, local: Local) {
  return remote?.order_status === "PAID" &&
    payment?.order_id === remote.order_id &&
    payment?.payment_status === "SUCCESS" &&
    payment?.is_captured === true &&
    payment?.payment_currency === "INR" &&
    moneyPaise(payment?.payment_amount) === local.amountPaise &&
    typeof payment?.cf_payment_id !== "undefined" &&
    /^\\d{1,40}$/.test(String(payment.cf_payment_id)) &&
    Number.isFinite(Date.parse(payment.payment_time || payment.payment_completion_time || ""));
}
export function verifyCashfreeWebhook(raw: Buffer, timestamp: string, signature: string, secret: string) {
  if (!/^\\d{10,13}$/.test(timestamp) || !/^[A-Za-z0-9+/]+={0,2}$/.test(signature)) return false;
  const now = Date.now(), epoch = Number(timestamp);
  if (Math.abs(now - (epoch < 1e12 ? epoch * 1000 : epoch)) > 10 * 60_000) return false;
  const expected = crypto.createHmac("sha256", secret).update(timestamp).update(raw).digest();
  const actual = Buffer.from(signature, "base64");
  return actual.length === expected.length && crypto.timingSafeEqual(expected, actual);
}
export class CashfreePG {
  constructor(private readonly fetcher: typeof fetch = fetch) {}
  async request(path: string, method = "GET", body?: object, idempotency?: string) {
    assert(cashfreeBillingConfigured(), 503, "CASHFREE_BILLING_NOT_CONFIGURED", "Cashfree PGOne billing is awaiting configuration.");
    assert(/^\\/pg\\/orders(?:\\/[a-zA-Z0-9_-]+(?:\\/payments)?)?$/.test(path), 400, "CASHFREE_INVALID_PATH", "Invalid provider order path.");
    const base = client().environment === "TEST" ? "https://sandbox.cashfree.com" : "https://api.cashfree.com";
    let response: Response;
    try {
      response = await this.fetcher(base + path, {
        method,
        headers: {
          "x-api-version": API_VERSION,
          "x-client-id": client().id!,
          "x-client-secret": client().secret!,
          "content-type": "application/json",
          ...(idempotency ? { "x-idempotency-key": idempotency } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(15000),
      });
    } catch {
      throw new AppError(503, "CASHFREE_PROVIDER_UNCERTAIN", "Cashfree has not confirmed this request. Check status before retrying.");
    }
    if (!response.ok) {
      if (response.status === 404) throw new AppError(404, "CASHFREE_ORDER_NOT_FOUND", "Cashfree has not confirmed the order.");
      throw new AppError(503, "CASHFREE_PROVIDER_UNAVAILABLE", "Cashfree could not confirm the order. Check status before retrying.");
    }
    try { return await response.json(); }
    catch { throw new AppError(502, "CASHFREE_PROVIDER_INVALID", "Cashfree returned an invalid response."); }
  }
  get(id: string) { return this.request(`/pg/orders/${encodeURIComponent(id)}`); }
  payments(id: string) { return this.request(`/pg/orders/${encodeURIComponent(id)}/payments`); }
  create(local: Local, phone: string, customerName: string) {
    return this.request("/pg/orders", "POST", {
      order_id: orderId(local.receiptReference),
      order_amount: local.amountPaise / 100,
      order_currency: "INR",
      customer_details: {
        customer_id: `pgo_${crypto.createHash("sha256").update(local.organisationId).digest("hex").slice(0,22)}`,
        customer_phone: phone.replace(/^\\+91/, ""),
        customer_name: customerName.slice(0, 100),
      },
      order_meta: {
        return_url: `${platformConfig.PGONE_BILLING_WEB_ORIGIN}/?order_id={order_id}`,
      },
      order_tags: {
        pgone_product: "PGONE_MONTHLY",
        pgone_local_order: local.id,
        pgone_organisation: local.organisationId,
      },
      order_note: "PGOne monthly owner workspace access",
    }, crypto.createHash("sha256").update(local.id).digest("hex").slice(0,8) + "-0000-4000-8000-" +
         crypto.createHash("sha256").update(local.id).digest("hex").slice(8,20));
  }
}
async function currentLocal(id: string, org: string) {
  const local = await prisma.pgPlanOrder.findFirst({ where: { id, organisationId: org } });
  assert(local && isCashfreeOrder(local.providerKeyId), 404, "CASHFREE_PLAN_NOT_FOUND", "Cashfree order does not belong to this owner.");
  assert(local.providerKeyId === providerKey(), 409, "CASHFREE_ACCOUNT_CHANGED", "This payment belongs to another provider environment or account.");
  return local;
}
export async function reconcileCashfreeOrder(id: string, organisationId: string, provider = new CashfreePG()) {
  let local = await currentLocal(id, organisationId);
  const remote = await provider.get(orderId(local.receiptReference));
  assert(matchCashfreeOrder(remote, local), 409, "CASHFREE_ORDER_MISMATCH", "Provider order does not match this PGOne workspace.");
  const payments = await provider.payments(remote.order_id);
  assert(Array.isArray(payments), 502, "CASHFREE_PAYMENT_RESPONSE", "Payment confirmation is not available.");
  const succeeded = payments.filter((p: any) => p.payment_status === "SUCCESS");
  assert(succeeded.length <= 1, 409, "CASHFREE_MULTIPLE_SUCCESSES", "Multiple successful payments need operator reconciliation.");
  if (!succeeded.length) {
    if (remote.order_status === "EXPIRED" || remote.order_status === "TERMINATED") {
      await prisma.pgPlanOrder.updateMany({ where: { id: local.id, open: true }, data: { open: false, status: "EXPIRED" } });
    }
    return local;
  }
  const payment = succeeded[0];
  assert(successfulCashfreePayment(payment, remote, local), 409, "CASHFREE_PAYMENT_MISMATCH", "Only an exact captured INR 249 payment can activate an account.");
  assert(client().environment === "LIVE", 409, "CASHFREE_TEST_NO_ACCESS", "Sandbox transactions cannot activate live PGOne subscriptions.");
  const paymentId = String(payment.cf_payment_id);
  const paidAt = new Date(payment.payment_completion_time || payment.payment_time);
  await atomic(async tx => {
    const existing = await tx.pgPlanReceipt.findUnique({ where: { orderId: local.id } });
    if (existing) {
      assert(existing.providerPaymentId === paymentId && existing.amountPaise === PLAN.amountPaise &&
        existing.organisationId === local.organisationId, 409, "CASHFREE_RECEIPT_CONFLICT", "Existing receipt belongs to a different payment.");
      return;
    }
    const now = new Date();
    const prior = await tx.pgPlanReceipt.findMany({ where: { organisationId: local.organisationId, status: "CAPTURED", refundedPaise: 0, periodEnd: { gt: now } } });
    const priorRecurring = await tx.pgBillingPayment.findMany({ where: { subscription: { organisationId: local.organisationId },
      status: "CAPTURED", refundedPaise: 0, periodEnd: { gt: now } } });
    const chain = paidAccessChain(now, [...prior, ...priorRecurring.map(p => ({ ...p, anchorDay: indiaDay(p.periodEnd) }))]);
    assert(!chain.gap, 409, "CASHFREE_PERIOD_REVIEW", "Subscription history requires review before granting another month.");
    const start = chain.end;
    const end = nextCalendarMonth(start, chain.anchorDay);
    const receipt = await tx.pgPlanReceipt.create({ data: {
      organisationId: local.organisationId, orderId: local.id, providerPaymentId: `cf_${paymentId}`,
      receiptNumber: `PGONE-${local.receiptReference}`, amountPaise: PLAN.amountPaise, taxPaise: local.taxPaise,
      refundedPaise: 0, status: "CAPTURED", paidAt, periodStart: start, periodEnd: end, anchorDay: chain.anchorDay,
    } });
    await tx.pgPlanOrder.update({ where: { id: local.id }, data: { status: "CAPTURED", open: false } });
    await audit(tx, null, local.organisationId, "CASHFREE_SAAS_PAYMENT_VERIFIED", receipt.id, {
      providerPaymentId: paymentId, orderId: remote.order_id, amountPaise: local.amountPaise, periodEnd: end.toISOString(),
    });
  });
  return prisma.pgPlanOrder.findUniqueOrThrow({ where: { id: local.id } });
}
export async function createCashfreePlanOrder(accountId: string, organisationId: string, requestKey: string, provider = new CashfreePG()) {
  await ownerOrganisation(accountId, organisationId);
  assert(cashfreeBillingEnabled(), 503, "CASHFREE_BILLING_INACTIVE", "Live Cashfree subscription checkout has not been activated.");
  assert(/^[a-zA-Z0-9_-]{16,100}$/.test(requestKey), 400, "CASHFREE_INVALID_REQUEST", "Use a new secure payment request.");
  const account = await prisma.pgAccount.findUniqueOrThrow({ where: { id: accountId } });
  assert(account.phoneE164, 409, "CASHFREE_PHONE_REQUIRED", "Verify a phone number before making a payment.");
  const tax = taxBreakdown(platformConfig.PGONE_TAX_BPS)!;
  const receiptReference = `cfo${crypto.createHash("sha256").update(`${organisationId}:${requestKey}`).digest("hex").slice(0,32)}`;
  let selected = await atomic(async tx => {
    const prior = await tx.pgPlanOrder.findUnique({ where: { organisationId_requestKey: { organisationId, requestKey } } });
    if (prior) return prior;
    const open = await tx.pgPlanOrder.findFirst({ where: { organisationId, open: true } });
    assert(!open || isCashfreeOrder(open.providerKeyId), 409, "RAZORPAY_ORDER_STILL_OPEN", "Finish or resolve the previous Razorpay payment before switching.");
    if (open) return open;
    const old = await tx.pgSubscription.findFirst({ where: { organisationId, current: true, providerSubscriptionId: { not: null } } });
    assert(!old || ["CANCELLED", "EXPIRED", "COMPLETED"].includes(old.status), 409, "PREVIOUS_MANDATE_ACTIVE", "Your previous auto-renewing subscription needs cancellation confirmation.");
    const created = await tx.pgPlanOrder.create({ data: { organisationId, requestKey, receiptReference,
      providerKeyId: providerKey(), amountPaise: PLAN.amountPaise, taxPaise: tax.taxPaise } });
    await audit(tx, accountId, organisationId, "CASHFREE_SAAS_ORDER_REQUESTED", created.id, { amountPaise: PLAN.amountPaise, recurring: false });
    return created;
  });
  assert(selected.providerKeyId === providerKey(), 409, "CASHFREE_ACCOUNT_CHANGED", "Order belongs to a different payment account.");
  // Deterministic remote order ID: unknown create responses are recovered with a GET.
  let remote: any;
  try {
    remote = await provider.get(orderId(selected.receiptReference));
  } catch (error) {
    if (!(error instanceof AppError) || error.code !== "CASHFREE_ORDER_NOT_FOUND") throw error;
    remote = await provider.create(selected, account.phoneE164, account.fullName || "PGOne Owner");
  }
  assert(matchCashfreeOrder(remote, selected), 409, "CASHFREE_ORDER_MISMATCH", "Cashfree returned an order for another workspace.");
  assert(typeof remote.payment_session_id === "string" && remote.payment_session_id.length >= 20, 502,
    "CASHFREE_SESSION_MISSING", "Cashfree did not provide a valid checkout session.");
  await prisma.pgPlanOrder.updateMany({ where: { id: selected.id, providerOrderId: null },
    data: { providerOrderId: remote.order_id, status: "PENDING" } });
  selected = await reconcileCashfreeOrder(selected.id, organisationId, provider);
  return { id: selected.id, orderId: remote.order_id, paymentSessionId: remote.payment_session_id,
    environment: client().environment === "LIVE" ? "production" : "sandbox",
    amountPaise: PLAN.amountPaise, recurring: false, payable: selected.open && selected.status === "PENDING" };
}
export async function refreshCashfreePlanPayments(accountId: string, organisationId: string, provider = new CashfreePG()) {
  await ownerOrganisation(accountId, organisationId);
  const orders = await prisma.pgPlanOrder.findMany({ where: { organisationId, providerKeyId: { startsWith: "cashfree:" },
    OR: [ { open: true }, { receipt: { status: "CAPTURED", refundedPaise: 0 } } ] },
    orderBy: { createdAt: "asc" }, take: 100 });
  for (const o of orders) await reconcileCashfreeOrder(o.id, organisationId, provider);
  return manualPlanStatus(accountId, organisationId);
}
export async function processCashfreePlanWebhook(raw: Buffer, timestamp: string, signature: string, provider = new CashfreePG()) {
  assert(cashfreeBillingConfigured() && client().secret &&
    verifyCashfreeWebhook(raw, timestamp, signature, client().secret), 400,
    "CASHFREE_WEBHOOK_INVALID", "Cashfree webhook authentication failed.");
  const event = JSON.parse(raw.toString("utf8"));
  const remoteId = event?.data?.order?.order_id;
  if (typeof remoteId !== "string" || !/^pgone_cfo[a-f0-9]{32}$/.test(remoteId)) return;
  const local = await prisma.pgPlanOrder.findFirst({ where: { providerOrderId: remoteId, providerKeyId: providerKey() } });
  if (!local) return;
  // Signed notifications only trigger provider reads; their payload never awards access.
  await reconcileCashfreeOrder(local.id, local.organisationId, provider);
  const hash = crypto.createHash("sha256").update(raw).digest("hex");
  await atomic(async tx => {
    const previous = await tx.pgProviderEvent.findUnique({ where: { provider_eventKey: { provider: "CASHFREE_PLAN", eventKey: hash } } });
    if (!previous) await tx.pgProviderEvent.create({ data: { provider: "CASHFREE_PLAN", eventKey: hash,
      payloadHash: hash, eventType: String(event.type || "UNKNOWN").slice(0,80) } });
  });
}
