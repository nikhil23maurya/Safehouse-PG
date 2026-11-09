import crypto from "node:crypto";
import { prisma } from "../db.js";
import { AppError, assert } from "../errors.js";
import { PLAN, platformConfig, taxBreakdown } from "./config.js";
import { atomic, audit, ownerOrganisation } from "./service.js";
import { hash, randomCode } from "./tokens.js";

export function billingConfigured() {
  return Boolean(
    platformConfig.PGONE_SUBSCRIPTION_KEY_ID &&
      platformConfig.PGONE_SUBSCRIPTION_KEY_SECRET &&
      platformConfig.PGONE_SUBSCRIPTION_WEBHOOK_SECRET &&
      platformConfig.PGONE_SUBSCRIPTION_PLAN_ID &&
      platformConfig.PGONE_SUBSCRIPTION_CYCLES &&
      platformConfig.PGONE_TAX_BPS !== undefined &&
      platformConfig.PGONE_BILLING_WEB_ORIGIN &&
      platformConfig.PGONE_TERMS_URL &&
      platformConfig.PGONE_PRIVACY_URL,
  );
}
export function paidPeriod(
  payment: {
    status: string;
    amountPaise: number;
    refundedPaise: number;
    periodStart: Date;
    periodEnd: Date;
  },
  now = new Date(),
) {
  return (
    payment.status === "CAPTURED" &&
    payment.amountPaise === PLAN.amountPaise &&
    payment.refundedPaise === 0 &&
    payment.periodStart <= now &&
    payment.periodEnd > now
  );
}
export async function entitlement(organisationId: string) {
  const org = await prisma.pgOrganisation.findUniqueOrThrow({
    where: { id: organisationId },
    include: {
      subscription: {
        include: {
          payments: {
            where: {
              periodStart: { lte: new Date() },
              periodEnd: { gt: new Date() },
              status: "CAPTURED",
              amountPaise: PLAN.amountPaise,
              refundedPaise: 0,
            },
          },
        },
      },
    },
  });
  return (
    org.legacyAccess ||
    Boolean(
      org.subscription?.verifiedAt &&
        org.subscription.payments.some((p) => paidPeriod(p)),
    )
  );
}
export function verifiedInvoice(
  invoice: any,
  payment: any,
  subscriptionId: string,
) {
  return (
    /^inv_[a-zA-Z0-9]+$/.test(invoice?.id || "") &&
    invoice.subscription_id === subscriptionId &&
    invoice.status === "paid" &&
    invoice.currency === "INR" &&
    invoice.amount === PLAN.amountPaise &&
    invoice.amount_paid === PLAN.amountPaise &&
    invoice.amount_due === 0 &&
    invoice.payment_id === payment?.id &&
    payment?.status === "captured" &&
    payment.captured === true &&
    payment.amount === PLAN.amountPaise &&
    payment.currency === "INR" &&
    Number.isSafeInteger(payment.amount_refunded ?? 0) &&
    (payment.amount_refunded ?? 0) >= 0 &&
    (payment.amount_refunded ?? 0) <= payment.amount &&
    Number.isSafeInteger(invoice.billing_start) &&
    Number.isSafeInteger(invoice.billing_end) &&
    invoice.billing_end > invoice.billing_start &&
    invoice.billing_end - invoice.billing_start <= 35 * 86400 &&
    Number.isSafeInteger(payment.created_at)
  );
}
export function webhookSignature(
  raw: Buffer,
  signature: string,
  secret: string,
) {
  if (!/^[a-fA-F0-9]{64}$/.test(signature)) return false;
  const expected = crypto.createHmac("sha256", secret).update(raw).digest();
  return crypto.timingSafeEqual(expected, Buffer.from(signature, "hex"));
}
export class RazorpaySubscriptions {
  constructor(private readonly fetcher: typeof fetch = fetch) {}
  async request(path: string, body?: object) {
    assert(
      billingConfigured(),
      503,
      "BILLING_NOT_CONFIGURED",
      "Subscription activation is awaiting merchant configuration.",
    );
    assert(
      /^\/(plans|subscriptions|invoices|payments)(\/|\?|$)/.test(path),
      400,
      "INVALID_PROVIDER_PATH",
      "Invalid subscription request.",
    );
    let response;
    try {
      response = await this.fetcher(`https://api.razorpay.com/v1${path}`, {
        method: body ? "POST" : "GET",
        headers: {
          authorization: `Basic ${Buffer.from(`${platformConfig.PGONE_SUBSCRIPTION_KEY_ID}:${platformConfig.PGONE_SUBSCRIPTION_KEY_SECRET}`).toString("base64")}`,
          "content-type": "application/json",
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(15000),
      });
    } catch {
      throw new AppError(
        503,
        "PROVIDER_STATUS_UNCERTAIN",
        "The provider could not confirm this request. Refresh status before trying again.",
      );
    }
    if (!response.ok)
      throw new AppError(
        502,
        "SUBSCRIPTION_PROVIDER_ERROR",
        "The subscription provider could not complete this request. Check status before retrying.",
      );
    return (await response.json()) as any;
  }
  async plan() {
    const plan = await this.request(
      `/plans/${encodeURIComponent(platformConfig.PGONE_SUBSCRIPTION_PLAN_ID!)}`,
    );
    assert(
      plan.id === platformConfig.PGONE_SUBSCRIPTION_PLAN_ID &&
        plan.period === "monthly" &&
        plan.interval === 1 &&
        plan.item?.amount === PLAN.amountPaise &&
        plan.item.currency === "INR",
      503,
      "PLAN_MISMATCH",
      "The provider plan must be exactly PGOne, INR 249 per month.",
    );
    return plan;
  }
  create(organisationId: string, reference: string) {
    return this.request("/subscriptions", {
      plan_id: platformConfig.PGONE_SUBSCRIPTION_PLAN_ID,
      total_count: platformConfig.PGONE_SUBSCRIPTION_CYCLES,
      quantity: 1,
      customer_notify: true,
      notes: {
        pgone_organisation_id: organisationId,
        pgone_creation_reference: reference,
      },
    });
  }
  get(id: string) {
    return this.request(`/subscriptions/${encodeURIComponent(id)}`);
  }
  invoices(id: string) {
    return this.request(
      `/invoices?subscription_id=${encodeURIComponent(id)}&count=100`,
    );
  }
  payment(id: string) {
    return this.request(`/payments/${encodeURIComponent(id)}`);
  }
  cancel(id: string) {
    return this.request(`/subscriptions/${encodeURIComponent(id)}/cancel`, {
      cancel_at_cycle_end: true,
    });
  }
}
export const subscriptionProvider = new RazorpaySubscriptions();

export async function subscriptionStatus(
  accountId: string,
  organisationId: string,
) {
  const org = await ownerOrganisation(accountId, organisationId);
  const subscription = await prisma.pgSubscription.findUnique({
    where: { organisationId },
    include: { payments: { orderBy: { paidAt: "desc" }, take: 24 } },
  });
  return {
    plan: PLAN,
    tax: taxBreakdown(platformConfig.PGONE_TAX_BPS),
    configured: billingConfigured(),
    legacyAccess: org.legacyAccess,
    entitled: await entitlement(organisationId),
    subscription: subscription
      ? {
          id: subscription.id,
          provider: subscription.provider,
          status: subscription.status,
          periodStart: subscription.periodStart,
          periodEnd: subscription.periodEnd,
          cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
          verifiedAt: subscription.verifiedAt,
          payments: subscription.payments.map((p) => ({
            id: p.id,
            amountPaise: p.amountPaise,
            taxPaise: p.taxPaise,
            refundedPaise: p.refundedPaise,
            status: p.status,
            paidAt: p.paidAt,
            receiptNumber: p.receiptNumber,
            periodStart: p.periodStart,
            periodEnd: p.periodEnd,
          })),
        }
      : null,
    renewalCycles: platformConfig.PGONE_SUBSCRIPTION_CYCLES ?? null,
  };
}
export async function createSubscription(
  accountId: string,
  organisationId: string,
  provider = subscriptionProvider,
) {
  await ownerOrganisation(accountId, organisationId);
  await provider.plan();
  const reference = randomCode();
  const sub = await atomic(async (tx) => {
    const existing = await tx.pgSubscription.findUnique({
      where: { organisationId },
    });
    if (existing) return existing;
    const created = await tx.pgSubscription.create({
      data: {
        organisationId,
        creationReference: reference,
        status: "CREATING",
      },
    });
    await audit(
      tx,
      accountId,
      organisationId,
      "SUBSCRIPTION_REQUESTED",
      created.id,
    );
    return created;
  });
  if (sub.providerSubscriptionId)
    return {
      keyId: platformConfig.PGONE_SUBSCRIPTION_KEY_ID,
      subscriptionId: sub.providerSubscriptionId,
      amountPaise: PLAN.amountPaise,
    };
  assert(
    sub.creationReference === reference,
    409,
    "SUBSCRIPTION_CREATION_UNCERTAIN",
    "A subscription request already exists. Refresh its status; do not create a second mandate.",
  );
  try {
    const remote = await provider.create(organisationId, reference);
    assert(
      /^sub_[a-zA-Z0-9]+$/.test(remote.id || "") &&
        remote.plan_id === platformConfig.PGONE_SUBSCRIPTION_PLAN_ID &&
        remote.notes?.pgone_creation_reference === reference &&
        remote.notes?.pgone_organisation_id === organisationId,
      502,
      "INVALID_SUBSCRIPTION",
      "The provider returned an unconfirmed subscription.",
    );
    await atomic(async (tx) => {
      await tx.pgSubscription.update({
        where: { id: sub.id },
        data: {
          providerSubscriptionId: remote.id,
          status: "PENDING_CONFIRMATION",
        },
      });
      await audit(
        tx,
        accountId,
        organisationId,
        "SUBSCRIPTION_CREATED",
        sub.id,
        { providerSubscriptionId: remote.id },
      );
    });
    return {
      keyId: platformConfig.PGONE_SUBSCRIPTION_KEY_ID,
      subscriptionId: remote.id,
      amountPaise: PLAN.amountPaise,
    };
  } catch (error) {
    await prisma.pgSubscription.updateMany({
      where: { id: sub.id, providerSubscriptionId: null },
      data: { status: "CREATION_UNCERTAIN" },
    });
    throw error;
  }
}
export async function reconcileSubscription(
  subscriptionId: string,
  provider = subscriptionProvider,
) {
  const local = await prisma.pgSubscription.findUnique({
    where: { id: subscriptionId },
  });
  assert(
    local?.providerSubscriptionId,
    409,
    "SUBSCRIPTION_UNCONFIRMED",
    "No provider-confirmed subscription exists yet.",
  );
  const observedAt = new Date();
  const remote = await provider.get(local.providerSubscriptionId);
  assert(
    remote.id === local.providerSubscriptionId &&
      remote.plan_id === platformConfig.PGONE_SUBSCRIPTION_PLAN_ID &&
      remote.notes?.pgone_organisation_id === local.organisationId,
    502,
    "SUBSCRIPTION_MISMATCH",
    "The provider subscription does not match this organisation.",
  );
  const invoices = await provider.invoices(remote.id);
  assert(
    Array.isArray(invoices.items),
    502,
    "INVALID_INVOICES",
    "Provider invoice status is unavailable.",
  );
  const verified: { invoice: any; payment: any }[] = [];
  for (const invoice of invoices.items) {
    if (
      invoice.status !== "paid" ||
      !/^pay_[a-zA-Z0-9]+$/.test(invoice.payment_id || "")
    )
      continue;
    const payment = await provider.payment(invoice.payment_id);
    assert(
      verifiedInvoice(invoice, payment, remote.id),
      502,
      "UNVERIFIED_SUBSCRIPTION_PAYMENT",
      "The provider payment and subscription invoice could not be reconciled.",
    );
    verified.push({ invoice, payment });
  }
  await atomic(async (tx) => {
    const fresh = await tx.pgSubscription.findUniqueOrThrow({
      where: { id: local.id },
    });
    for (const { invoice, payment } of verified) {
      const old = await tx.pgBillingPayment.findUnique({
        where: { providerPaymentId: payment.id },
      });
      assert(
        !old || old.subscriptionId === local.id,
        409,
        "PAYMENT_ALREADY_ASSIGNED",
        "This payment is already assigned to another subscription.",
      );
      const tax = taxBreakdown(platformConfig.PGONE_TAX_BPS);
      assert(
        tax &&
          Number.isSafeInteger(invoice.tax_amount) &&
          invoice.tax_amount === tax.taxPaise,
        502,
        "TAX_MISMATCH",
        "The provider invoice tax must match the configured inclusive price.",
      );
      const data = {
        amountPaise: PLAN.amountPaise,
        taxPaise: invoice.tax_amount,
        refundedPaise: Math.max(
          old?.refundedPaise || 0,
          payment.amount_refunded || 0,
        ),
        status: "CAPTURED",
        receiptNumber: invoice.id,
        paidAt: new Date(payment.created_at * 1000),
        periodStart: new Date(invoice.billing_start * 1000),
        periodEnd: new Date(invoice.billing_end * 1000),
      };
      assert(
        !old ||
          (old.providerInvoiceId === invoice.id &&
            old.amountPaise === data.amountPaise &&
            old.taxPaise === data.taxPaise &&
            +old.periodStart === +data.periodStart &&
            +old.periodEnd === +data.periodEnd &&
            +old.paidAt === +data.paidAt),
        409,
        "FINAL_INVOICE_CHANGED",
        "A previously reconciled invoice changed and needs operator review.",
      );
      await tx.pgBillingPayment.upsert({
        where: { providerPaymentId: payment.id },
        create: {
          subscriptionId: local.id,
          providerInvoiceId: invoice.id,
          providerPaymentId: payment.id,
          ...data,
        },
        update: data,
      });
    }
    if (!fresh.verifiedAt || fresh.verifiedAt <= observedAt) {
      const latest = await tx.pgBillingPayment.findFirst({
        where: { subscriptionId: local.id },
        orderBy: { periodEnd: "desc" },
      });
      const allowed = [
        "created",
        "authenticated",
        "active",
        "pending",
        "halted",
        "cancelled",
        "completed",
        "expired",
        "paused",
      ];
      assert(
        allowed.includes(remote.status),
        502,
        "UNKNOWN_PROVIDER_STATE",
        "Provider subscription state needs review.",
      );
      await tx.pgSubscription.update({
        where: { id: local.id },
        data: {
          status: remote.status.toUpperCase(),
          periodStart: latest?.periodStart ?? null,
          periodEnd: latest?.periodEnd ?? null,
          verifiedAt: observedAt,
        },
      });
      await audit(
        tx,
        null,
        local.organisationId,
        "SUBSCRIPTION_RECONCILED",
        local.id,
        {
          providerStatus: remote.status,
          verifiedInvoiceCount: verified.length,
        },
      );
    }
  });
}
export async function cancelSubscription(
  accountId: string,
  organisationId: string,
  provider = subscriptionProvider,
) {
  await ownerOrganisation(accountId, organisationId);
  const sub = await prisma.pgSubscription.findUnique({
    where: { organisationId },
  });
  assert(
    sub?.providerSubscriptionId,
    409,
    "SUBSCRIPTION_UNAVAILABLE",
    "There is no confirmed subscription to cancel.",
  );
  await provider.cancel(sub.providerSubscriptionId);
  await atomic(async (tx) => {
    await tx.pgSubscription.update({
      where: { id: sub.id },
      data: { cancelAtPeriodEnd: true },
    });
    await audit(
      tx,
      accountId,
      organisationId,
      "SUBSCRIPTION_CANCELLATION_CONFIRMED",
      sub.id,
    );
  });
  await reconcileSubscription(sub.id, provider);
}
export async function processSubscriptionWebhook(
  raw: Buffer,
  signature: string,
  eventId: string | undefined,
) {
  const secret = platformConfig.PGONE_SUBSCRIPTION_WEBHOOK_SECRET;
  assert(
    secret && webhookSignature(raw, signature, secret),
    401,
    "INVALID_WEBHOOK_SIGNATURE",
    "Invalid webhook signature.",
  );
  const digest = hash(raw),
    key = eventId || digest;
  assert(key.length <= 200, 400, "INVALID_EVENT", "Invalid provider event.");
  const existing = await prisma.pgProviderEvent.findUnique({
    where: {
      provider_eventKey: { provider: "RAZORPAY_SUBSCRIPTION", eventKey: key },
    },
  });
  if (existing) {
    assert(
      existing.payloadHash === digest,
      409,
      "EVENT_CONFLICT",
      "Provider event content changed.",
    );
    return;
  }
  const event = JSON.parse(raw.toString("utf8"));
  let subId =
    event.payload?.subscription?.entity?.id ||
    event.payload?.invoice?.entity?.subscription_id;
  if (!subId && event.payload?.refund?.entity?.payment_id) {
    const billed = await prisma.pgBillingPayment.findUnique({
      where: { providerPaymentId: event.payload.refund.entity.payment_id },
      include: { subscription: true },
    });
    subId = billed?.subscription.providerSubscriptionId;
  }
  if (!subId && event.payload?.payment?.entity?.id) {
    const billed = await prisma.pgBillingPayment.findUnique({
      where: { providerPaymentId: event.payload.payment.entity.id },
      include: { subscription: true },
    });
    subId = billed?.subscription.providerSubscriptionId;
  }
  if (subId) {
    assert(
      typeof subId === "string" && /^sub_[a-zA-Z0-9]+$/.test(subId),
      400,
      "INVALID_SUBSCRIPTION",
      "Invalid provider subscription reference.",
    );
    let sub = await prisma.pgSubscription.findUnique({
      where: { providerSubscriptionId: subId },
    });
    if (!sub) {
      // Recover a successful provider creation whose HTTP response was lost.
      // Never issue a second mandate while creation is uncertain.
      const remote = await subscriptionProvider.get(subId);
      const reference = remote.notes?.pgone_creation_reference;
      if (typeof reference === "string") {
        const pending = await prisma.pgSubscription.findUnique({
          where: { creationReference: reference },
        });
        if (
          pending &&
          remote.id === subId &&
          remote.plan_id === platformConfig.PGONE_SUBSCRIPTION_PLAN_ID &&
          pending.organisationId === remote.notes?.pgone_organisation_id
        ) {
          await atomic(async (tx) => {
            const fresh = await tx.pgSubscription.findUniqueOrThrow({
              where: { id: pending.id },
            });
            assert(
              !fresh.providerSubscriptionId ||
                fresh.providerSubscriptionId === subId,
              409,
              "SUBSCRIPTION_CONFLICT",
              "A different provider mandate is already attached.",
            );
            await tx.pgSubscription.update({
              where: { id: pending.id },
              data: {
                providerSubscriptionId: subId,
                status: "PENDING_CONFIRMATION",
              },
            });
            await audit(
              tx,
              null,
              pending.organisationId,
              "SUBSCRIPTION_CREATION_RECOVERED",
              pending.id,
            );
          });
          sub = await prisma.pgSubscription.findUnique({
            where: { id: pending.id },
          });
        }
      }
    }
    if (sub) await reconcileSubscription(sub.id);
  }
  await atomic(async (tx) => {
    const saved = await tx.pgProviderEvent.upsert({
      where: {
        provider_eventKey: { provider: "RAZORPAY_SUBSCRIPTION", eventKey: key },
      },
      create: {
        provider: "RAZORPAY_SUBSCRIPTION",
        eventKey: key,
        payloadHash: digest,
        eventType: String(event.event || "unknown").slice(0, 100),
      },
      update: {},
    });
    assert(
      saved.payloadHash === digest,
      409,
      "EVENT_CONFLICT",
      "Provider event content changed.",
    );
  });
}
