import crypto from "node:crypto";
import { prisma } from "../db.js";
import { config } from "../config.js";
import { AppError, assert } from "../errors.js";
import { PLAN, platformConfig, platformEnabled, subscriptionCredentials, taxBreakdown } from "./config.js";
import { atomic, audit, ownerOrganisation } from "./service.js";
import { subscriptionStatus, webhookSignature } from "./billing.js";
import { indiaDay, nextCalendarMonth, paidAccessChain } from "./plan-period.js";
import { planPaymentKeyAllowed } from "./credentials.js";

export const planWebhookSecret = () => platformConfig.PGONE_SUBSCRIPTION_WEBHOOK_SECRET || config.RAZORPAY_WEBHOOK_SECRET;
const paymentKeyAllowed = () => planPaymentKeyAllowed(subscriptionCredentials()?.keyId, { nodeEnv: config.NODE_ENV, render: process.env.RENDER });
export const manualBillingConfigured = () => Boolean(subscriptionCredentials() && paymentKeyAllowed() && planWebhookSecret() &&
  platformConfig.PGONE_TAX_BPS !== undefined && platformConfig.PGONE_BILLING_WEB_ORIGIN &&
  platformConfig.PGONE_TERMS_URL && platformConfig.PGONE_PRIVACY_URL);
export const manualCheckoutEnabled = () => platformEnabled() &&
  platformConfig.PGONE_CUSTOM_WEB_BILLING_ENABLED === "true" && manualBillingConfigured();

type LocalOrder = { id: string; organisationId: string; receiptReference: string; providerOrderId: string | null; providerKeyId: string; amountPaise: number; taxPaise: number; currency: string; createdAt: Date };

export function orderSignature(orderId: string, paymentId: string, signature: string, secret: string) {
  if (!/^order_[a-zA-Z0-9]+$/.test(orderId) || !/^pay_[a-zA-Z0-9]+$/.test(paymentId) || !/^[a-fA-F0-9]{64}$/.test(signature)) return false;
  const expected = crypto.createHmac("sha256", secret).update(`${orderId}|${paymentId}`).digest();
  return crypto.timingSafeEqual(expected, Buffer.from(signature, "hex"));
}

export function matchingOrder(remote: any, local: LocalOrder) {
  return /^order_[a-zA-Z0-9]+$/.test(remote?.id || "") &&
    (!local.providerOrderId || remote.id === local.providerOrderId) &&
    remote.amount === local.amountPaise && remote.currency === "INR" &&
    remote.receipt === local.receiptReference && remote.partial_payment !== true &&
    remote.notes?.pgone_plan_order === local.id && remote.notes?.pgone_organisation_id === local.organisationId;
}

export function exactCapturedPayment(payment: any, order: LocalOrder) {
  return /^pay_[a-zA-Z0-9]+$/.test(payment?.id || "") && payment.order_id === order.providerOrderId &&
    (payment.status === "captured" || (payment.status === "refunded" && payment.amount_refunded === 24900)) &&
    payment.captured === true && payment.amount === 24900 &&
    payment.currency === "INR" && Number.isSafeInteger(payment.created_at) && payment.created_at > 0 &&
    payment.created_at * 1000 >= order.createdAt.getTime() - 300000 &&
    payment.created_at * 1000 <= Date.now() + 30000 &&
    Number.isSafeInteger(payment.amount_refunded ?? 0) && (payment.amount_refunded ?? 0) >= 0 &&
    (payment.amount_refunded ?? 0) <= 24900;
}

export class RazorpayPlanOrders {
  constructor(private readonly fetcher: typeof fetch = fetch) {}
  async request(path: string, body?: object) {
    const credentials = subscriptionCredentials();
    assert(credentials, 503, "PLAN_PAYMENT_UNAVAILABLE", "The payment account needs configuration.");
    assert(/^\/(orders|payments)(\/|\?|$)/.test(path), 400, "INVALID_PROVIDER_PATH", "Invalid plan payment request.");
    let response;
    try {
      response = await this.fetcher(`https://api.razorpay.com/v1${path}`, {
        method: body ? "POST" : "GET",
        headers: { authorization: `Basic ${Buffer.from(`${credentials.keyId}:${credentials.keySecret}`).toString("base64")}`, "content-type": "application/json" },
        ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(15000),
      });
    } catch { throw new AppError(503, "PLAN_PROVIDER_UNCERTAIN", "The provider has not confirmed this request. Refresh status before paying again."); }
    assert(response.ok, 502, "PLAN_PROVIDER_ERROR", "The payment provider could not confirm this request. Refresh status before retrying.");
    return await response.json() as any;
  }
  create(order: LocalOrder) {
    return this.request("/orders", { amount: 24900, currency: "INR", receipt: order.receiptReference, partial_payment: false,
      notes: { pgone_plan_order: order.id, pgone_organisation_id: order.organisationId, pgone_product: "PGONE_MANUAL_MONTH" } });
  }
  order(id: string) { return this.request(`/orders/${encodeURIComponent(id)}`); }
  payments(id: string) { return this.request(`/orders/${encodeURIComponent(id)}/payments?count=100`); }
  payment(id: string) { return this.request(`/payments/${encodeURIComponent(id)}`); }
  findReceipt(receipt: string) { return this.request(`/orders?receipt=${encodeURIComponent(receipt)}&count=100`); }
}

function assertMerchant(order: LocalOrder) {
  assert(subscriptionCredentials()?.keyId === order.providerKeyId, 409, "PLAN_MERCHANT_CHANGED", "This order belongs to a different payment account. Contact support before retrying.");
  assert(paymentKeyAllowed(), 503, "PLAN_KEY_MODE_NOT_LIVE", "Production plan payments require live Razorpay credentials. No paid access has been granted.");
}

export async function recoverPlanOrder(id: string, provider = new RazorpayPlanOrders()) {
  let local = await prisma.pgPlanOrder.findUniqueOrThrow({ where: { id } });
  if (local.providerOrderId) return local;
  assertMerchant(local);
  const list = await provider.findReceipt(local.receiptReference);
  assert(Array.isArray(list.items), 502, "PLAN_PROVIDER_ERROR", "The provider order search is unavailable.");
  const matches = list.items.filter((remote: any) => matchingOrder(remote, local));
  assert(matches.length === 1, 409, "PLAN_CREATION_UNCERTAIN", "The original order is still being checked. Do not start a second payment; refresh later or contact support.");
  local = await atomic(async tx => {
    const current = await tx.pgPlanOrder.findUniqueOrThrow({ where: { id } });
    assert(!current.providerOrderId || current.providerOrderId === matches[0].id, 409, "PLAN_ORDER_CONFLICT", "Order recovery requires review.");
    if (current.providerOrderId) return current;
    const updated = await tx.pgPlanOrder.update({ where: { id }, data: { providerOrderId: matches[0].id, status: "PENDING" } });
    await audit(tx, null, local.organisationId, "PLAN_ORDER_RECOVERED", id);
    return updated;
  });
  return local;
}

/** Idempotent, serializable allocation: one receipt extends access exactly once. */
export async function reconcilePlanOrder(id: string, provider = new RazorpayPlanOrders(), now = new Date()) {
  const local = await recoverPlanOrder(id, provider);
  assertMerchant(local);
  const remote = await provider.order(local.providerOrderId!);
  assert(matchingOrder(remote, local), 502, "PLAN_ORDER_MISMATCH", "The provider order does not match this workspace or price.");
  const list = await provider.payments(local.providerOrderId!);
  assert(Array.isArray(list.items), 502, "PLAN_PROVIDER_ERROR", "Payment confirmation is unavailable.");
  const candidates = list.items.filter((p: any) => p.status === "captured" || p.captured === true || p.status === "refunded");
  assert(candidates.length <= 1, 409, "MULTIPLE_PLAN_CAPTURES", "Multiple captures need support review; no extra access was granted.");
  let receipt = await prisma.pgPlanReceipt.findUnique({ where: { orderId: id } });
  if (!candidates.length && !receipt) return local;
  const paymentId = receipt?.providerPaymentId || candidates[0]?.id;
  assert(/^pay_[a-zA-Z0-9]+$/.test(paymentId || ""), 502, "PLAN_PAYMENT_MISMATCH", "Invalid payment confirmation.");
  const payment = await provider.payment(paymentId);
  const previouslyCapturedRefund = Boolean(receipt && payment.status === "refunded" && payment.order_id === local.providerOrderId &&
    payment.amount === 24900 && payment.currency === "INR" && payment.amount_refunded === 24900 &&
    payment.created_at === Math.floor(receipt.paidAt.getTime() / 1000));
  assert(exactCapturedPayment(payment, local) || previouslyCapturedRefund, 502, "PLAN_PAYMENT_MISMATCH", "Only the exact captured INR 249 payment can activate access.");
  assert(remote.status === "paid" && remote.amount_paid === 24900 && remote.amount_due === 0,
    502, "PLAN_ORDER_UNPAID", "The provider has not confirmed the complete order payment.");
  await atomic(async tx => {
    const existing = await tx.pgPlanReceipt.findUnique({ where: { orderId: id } });
    if (existing) {
      assert(existing.providerPaymentId === payment.id && existing.amountPaise === payment.amount && existing.currency === payment.currency &&
        existing.taxPaise === local.taxPaise && existing.organisationId === local.organisationId &&
        existing.paidAt.getTime() === payment.created_at * 1000, 409, "PLAN_RECEIPT_CONFLICT", "A paid receipt cannot be rewritten.");
      const refunded = Math.max(existing.refundedPaise, payment.amount_refunded ?? 0);
      if (refunded > existing.refundedPaise) {
        await tx.pgPlanReceipt.update({ where: { id: existing.id }, data: { refundedPaise: refunded, status: "REFUNDED" } });
        await tx.pgPlanOrder.update({ where: { id }, data: { status: "REFUNDED", open: false } });
        await audit(tx, null, local.organisationId, "PLAN_REFUND_RECONCILED", existing.id, { refundedPaise: refunded });
      }
      return;
    }
    const previous = await tx.pgPlanReceipt.findMany({
      where: { organisationId: local.organisationId, status: "CAPTURED", refundedPaise: 0, periodEnd: { gt: now } },
    });
    // Preserve an actual previously paid recurring period during the transition.
    const recurring = await tx.pgBillingPayment.findMany({ where: { subscription: { organisationId: local.organisationId },
      status: "CAPTURED", refundedPaise: 0, periodEnd: { gt: now } } });
    const chain = paidAccessChain(now, [...previous, ...recurring.map(p => ({ ...p, anchorDay: indiaDay(p.periodEnd) }))]);
    assert(!chain.gap || payment.amount_refunded > 0, 409, "PLAN_PERIOD_REVIEW_REQUIRED", "A refunded period has left a gap before a future paid month. Contact support before adding another month; existing receipts are preserved.");
    const start = chain.end;
    const anchorDay = chain.anchorDay;
    const end = nextCalendarMonth(start, anchorDay);
    const refunded = payment.amount_refunded ?? 0;
    receipt = await tx.pgPlanReceipt.create({ data: {
      organisationId: local.organisationId, orderId: id, providerPaymentId: payment.id,
      receiptNumber: `PGONE-${local.receiptReference}`, amountPaise: 24900, taxPaise: local.taxPaise,
      refundedPaise: refunded, status: refunded ? "REFUNDED" : "CAPTURED", paidAt: new Date(payment.created_at * 1000),
      periodStart: start, periodEnd: end, anchorDay,
    } });
    await tx.pgPlanOrder.update({ where: { id }, data: { status: refunded ? "REFUNDED" : "CAPTURED", open: false } });
    await audit(tx, null, local.organisationId, "PLAN_MONTH_PAYMENT_CAPTURED", receipt.id,
      { amountPaise: 24900, providerPaymentId: payment.id, periodStart: start.toISOString(), periodEnd: end.toISOString(), refundedPaise: refunded });
  });
  return prisma.pgPlanOrder.findUniqueOrThrow({ where: { id } });
}

export async function createPlanOrder(accountId: string, organisationId: string, requestKey: string, provider = new RazorpayPlanOrders()) {
  await ownerOrganisation(accountId, organisationId);
  assert(manualBillingConfigured(), 503, "PLAN_PAYMENT_UNAVAILABLE", "Monthly payments need provider and tax configuration.");
  assert(/^[a-zA-Z0-9_-]{16,100}$/.test(requestKey), 400, "INVALID_REQUEST_KEY", "Refresh this payment request.");
  const credentials = subscriptionCredentials()!;
  const tax = taxBreakdown(platformConfig.PGONE_TAX_BPS)!;
  const reference = `pgo${crypto.createHash("sha256").update(`${organisationId}:${requestKey}`).digest("hex").slice(0,32)}`;
  const selection = await atomic(async tx => {
    const old = await tx.pgSubscription.findFirst({ where: { organisationId, current: true, providerSubscriptionId: { not: null } } });
    assert(!old || ["CANCELLED", "EXPIRED", "COMPLETED"].includes(old.status), 409, "EXISTING_MANDATE_REVIEW", "A previous recurring contract still needs cancellation confirmation before switching to manual payments.");
    const prior = await tx.pgPlanOrder.findUnique({ where: { organisationId_requestKey: { organisationId, requestKey } } });
    if (prior) return { local: prior, created: false };
    const open = await tx.pgPlanOrder.findFirst({ where: { organisationId, open: true } });
    if (open) return { local: open, created: false };
    const future = await tx.pgPlanReceipt.findMany({ where: { organisationId, status: "CAPTURED", refundedPaise: 0, periodEnd: { gt: new Date() } } });
    const oldPaid = await tx.pgBillingPayment.findMany({ where: { subscription: { organisationId }, status: "CAPTURED", refundedPaise: 0, periodEnd: { gt: new Date() } } });
    assert(!paidAccessChain(new Date(), [...future, ...oldPaid.map(p => ({ ...p, anchorDay: indiaDay(p.periodEnd) }))]).gap,
      409, "PLAN_PERIOD_REVIEW_REQUIRED", "A refund left a gap before a future paid month. Contact support before making another payment.");
    const local = await tx.pgPlanOrder.create({ data: { organisationId, requestKey, receiptReference: reference,
      providerKeyId: credentials.keyId, amountPaise: 24900, taxPaise: tax.taxPaise } });
    await audit(tx, accountId, organisationId, "PLAN_ONE_TIME_PAYMENT_REQUESTED", local.id, {
      amountPaise: 24900, interval: "CALENDAR_MONTH", recurring: false, terms: platformConfig.PGONE_TERMS_URL, privacy: platformConfig.PGONE_PRIVACY_URL,
    });
    return { local, created: true };
  });
  let local = selection.local;
  assertMerchant(local);
  if (selection.created) {
    try {
      const remote = await provider.create(local);
      assert(matchingOrder(remote, local), 502, "PLAN_ORDER_MISMATCH", "The provider did not return the expected monthly payment order.");
      local = await atomic(async tx => {
        const updated = await tx.pgPlanOrder.update({ where: { id: local.id }, data: { providerOrderId: remote.id, status: "PENDING" } });
        await audit(tx, accountId, organisationId, "PLAN_ORDER_CREATED", local.id, { providerOrderId: remote.id });
        return updated;
      });
    } catch (error) {
      await atomic(async tx => {
        const changed = await tx.pgPlanOrder.updateMany({ where: { id: local.id, providerOrderId: null }, data: { status: "CREATION_UNCERTAIN" } });
        if (changed.count) await audit(tx, accountId, organisationId, "PLAN_ORDER_CREATION_UNCERTAIN", local.id);
      });
      throw error;
    }
  } else {
    local = await recoverPlanOrder(local.id, provider);
    local = await reconcilePlanOrder(local.id, provider);
  }
  return { id: local.id, orderId: local.providerOrderId, keyId: local.providerKeyId,
    amountPaise: 24900, currency: "INR", status: local.status, payable: local.open && local.status === "PENDING", recurring: false };
}

export async function verifyPlanPayment(accountId: string, organisationId: string, id: string,
  input: { paymentId: string; signature: string }, provider = new RazorpayPlanOrders()) {
  await ownerOrganisation(accountId, organisationId);
  const local = await prisma.pgPlanOrder.findFirst({ where: { id, organisationId } });
  assert(local?.providerOrderId, 404, "PLAN_ORDER_NOT_FOUND", "This payment does not belong to your workspace.");
  assertMerchant(local);
  assert(orderSignature(local.providerOrderId, input.paymentId, input.signature, subscriptionCredentials()!.keySecret),
    400, "INVALID_PLAN_SIGNATURE", "Payment authorisation could not be verified.");
  const payment = await provider.payment(input.paymentId);
  assert(payment.order_id === local.providerOrderId && payment.amount === 24900 && payment.currency === "INR",
    400, "PLAN_PAYMENT_MISMATCH", "Payment does not match this order.");
  await atomic(async tx => {
    await tx.pgPlanOrder.update({ where: { id }, data: { signatureVerifiedAt: new Date() } });
    await audit(tx, accountId, organisationId, "PLAN_PAYMENT_SIGNATURE_VERIFIED", id);
  });
  await reconcilePlanOrder(id, provider);
  return manualPlanStatus(accountId, organisationId);
}

export async function recheckPlanPayments(accountId: string, organisationId: string, provider = new RazorpayPlanOrders()) {
  await ownerOrganisation(accountId, organisationId);
  const now = new Date();
  const orders = await prisma.pgPlanOrder.findMany({ where: { organisationId, providerKeyId: { not: { startsWith: "cashfree:" } }, OR: [
    { open: true }, { receipt: { status: "CAPTURED", refundedPaise: 0, periodEnd: { gt: now } } },
  ] }, orderBy: { createdAt: "asc" }, take: 100 });
  for (const order of orders) await reconcilePlanOrder(order.id, provider);
  return manualPlanStatus(accountId, organisationId);
}

export async function manualPlanStatus(accountId: string, organisationId: string) {
  const base = await subscriptionStatus(accountId, organisationId);
  const now = new Date();
  const [active, payments, open] = await Promise.all([
    prisma.pgPlanReceipt.findFirst({ where: { organisationId, status: "CAPTURED", refundedPaise: 0, periodStart: { lte: now }, periodEnd: { gt: now } }, orderBy: { periodEnd: "desc" } }),
    prisma.pgPlanReceipt.findMany({ where: { organisationId }, orderBy: { createdAt: "desc" }, take: 100 }),
    prisma.pgPlanOrder.findFirst({ where: { organisationId, open: true } }),
  ]);
  let accessEnd = active?.periodEnd || (base.entitled ? base.subscription?.periodEnd : null);
  for (const payment of payments.filter(p => p.status === "CAPTURED" && p.refundedPaise === 0).sort((a,b) => a.periodStart.getTime()-b.periodStart.getTime())) {
    if (accessEnd && payment.periodStart <= new Date(accessEnd) && payment.periodEnd > new Date(accessEnd)) accessEnd = payment.periodEnd;
  }
  return { ...base, entitled: base.entitled || Boolean(active), mode: "MANUAL_MONTHLY", recurring: false,
    configured: manualBillingConfigured() || (platformConfig.PGONE_CASHFREE_BILLING_ENABLED === "true" &&
      Boolean(platformConfig.PGONE_CASHFREE_PG_CLIENT_ID && platformConfig.PGONE_CASHFREE_PG_CLIENT_SECRET)),
    checkoutEnabled: platformConfig.PGONE_CASHFREE_BILLING_ENABLED === "true"
      ? (platformConfig.PGONE_CASHFREE_PG_ENV === "LIVE" &&
         Boolean(platformConfig.PGONE_CASHFREE_PG_CLIENT_ID && platformConfig.PGONE_CASHFREE_PG_CLIENT_SECRET))
      : manualCheckoutEnabled(), renewalCycles: null,
    accessEnd, pendingOrder: open ? { id: open.id, status: open.status } : null,
    // Keep old contracts/history in the response; never reinterpret them as new mandates.
    legacySubscription: base.subscription,
    subscription: { status: base.legacyAccess ? "LEGACY_ACCESS" : active || base.entitled ? "ACTIVE" : "NOT_ACTIVE",
      periodEnd: accessEnd, cancelAtPeriodEnd: true, payments: [...payments, ...(base.subscription?.payments || [])] },
  };
}

export async function processPlanWebhook(raw: Buffer, signature: string, eventId?: string, provider = new RazorpayPlanOrders()) {
  const secret = planWebhookSecret();
  assert(secret && webhookSignature(raw, signature, secret), 400, "INVALID_WEBHOOK_SIGNATURE", "Invalid payment webhook signature.");
  const event = JSON.parse(raw.toString("utf8"));
  if (!["payment.captured", "order.paid", "refund.processed", "refund.created", "payment.failed"].includes(event.event)) return;
  const hash = crypto.createHash("sha256").update(raw).digest("hex");
  const eventKey = String(eventId || hash);
  assert(eventKey.length <= 200, 400, "INVALID_EVENT_ID", "Invalid event identifier.");
  const previous = await prisma.pgProviderEvent.findUnique({ where: { provider_eventKey: { provider: "RAZORPAY_PLAN", eventKey } } });
  if (previous) {
    assert(previous.payloadHash === hash, 409, "EVENT_CONFLICT", "An event identifier cannot change its payload.");
    return;
  }
  let providerOrderId = event.payload?.payment?.entity?.order_id || event.payload?.order?.entity?.id;
  if (!providerOrderId && event.payload?.refund?.entity?.payment_id) {
    const paymentId = event.payload.refund.entity.payment_id;
    assert(/^pay_[a-zA-Z0-9]+$/.test(paymentId), 400, "INVALID_PAYMENT_ID", "Invalid refund payment.");
    providerOrderId = (await provider.payment(paymentId)).order_id;
  }
  if (!/^order_[a-zA-Z0-9]+$/.test(providerOrderId || "")) return;
  const order = await prisma.pgPlanOrder.findUnique({ where: { providerOrderId } });
  if (!order) return; // Other products, including legacy rent, are never settled here.
  await reconcilePlanOrder(order.id, provider);
  await atomic(async tx => {
    const exists = await tx.pgProviderEvent.findUnique({ where: { provider_eventKey: { provider: "RAZORPAY_PLAN", eventKey } } });
    assert(!exists || exists.payloadHash === hash, 409, "EVENT_CONFLICT", "Event payload changed.");
    if (!exists) await tx.pgProviderEvent.create({ data: { provider: "RAZORPAY_PLAN", eventKey, payloadHash: hash, eventType: event.event } });
  });
}
