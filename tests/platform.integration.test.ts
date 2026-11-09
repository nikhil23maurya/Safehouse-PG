import test, { after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
process.env.PGONE_PLATFORM_ENABLED = "true";
process.env.PGONE_CUSTOM_WEB_BILLING_ENABLED = "true";
process.env.PGONE_SUBSCRIPTION_PLAN_ID = "plan_Test01";
process.env.PGONE_SUBSCRIPTION_KEY_ID = "test-unit-key";
process.env.PGONE_SUBSCRIPTION_KEY_SECRET = "test-unit-secret";
process.env.PGONE_SUBSCRIPTION_WEBHOOK_SECRET = "test-unit-webhook";
process.env.PGONE_SUBSCRIPTION_CYCLES = "12";
process.env.PGONE_TAX_BPS = "0";
process.env.PGONE_BILLING_WEB_ORIGIN = "https://billing.example.test";
process.env.PGONE_TERMS_URL = "https://example.test/terms";
process.env.PGONE_PRIVACY_URL = "https://example.test/privacy";
const { prisma } = await import("../src/db.js");
const {
  phoneAccount,
  saveProfile,
  createProperty,
  accountSnapshot,
  accountSession,
  membershipTokens,
  ownerOrganisation,
} = await import("../src/platform/service.js");
const { createInvitation, acceptInvitation } = await import(
  "../src/platform/invitations.js"
);
const {
  entitlement,
  RazorpaySubscriptions,
  createSubscription,
  reconcileSubscription,
  cancelSubscription,
  processSubscriptionWebhook,
} = await import("../src/platform/billing.js");
const { createHmac } = await import("node:crypto");
const { platformPair } = await import("../src/platform/tokens.js");
const { platformRouter } = await import("../src/platform/router.js");
const { platformWorkspaceBridge } = await import("../src/platform/bridge.js");
const app = express();
app.use(express.json());
app.use("/api/platform", platformRouter);
app.use(platformWorkspaceBridge);
app.all("/api/owner/probe", (_req, res) => res.json({ ok: true }));
app.all("/api/student/payments/order", (_req, res) => res.json({ ok: true }));
app.use((e: any, _req: any, res: any, _next: any) =>
  res
    .status(e.statusCode || 500)
    .json({ error: { code: e.code, message: e.message } }),
);
const server = app.listen(0, "127.0.0.1");
await new Promise<void>((resolve) => server.on("listening", resolve));
const port = (server.address() as any).port;
after(async () => {
  server.close();
  await prisma.$disconnect();
});
test("isolated subscription adapter: duplicate capture, immutable invoice, refund, expiry and signed events", async () => {
  const account = await phoneAccount({
    uid: crypto.randomUUID(),
    phoneE164: `+917${String(Math.floor(Math.random() * 1e9)).padStart(9, "0")}`,
  });
  await saveProfile(account.id, {
    fullName: "Billing fixture",
    intent: "OWNER",
  });
  const property = await createProperty(account.id, {
    name: "Billing House",
    city: "Pune",
    key: crypto.randomUUID(),
  });
  const organisationId = property.organisationId;
  const remotes = new Map<string, any>();
  let creations = 0;
  let refunded = 0;
  let invoiceChange = false;
  const paidAt = Math.floor(Date.now() / 1000),
    start = paidAt - 86400,
    end = start + 30 * 86400;
  const invoice = (id: string) => ({
    id: "inv_Billing01",
    subscription_id: id,
    status: "paid",
    currency: "INR",
    amount: invoiceChange ? 100 : 24900,
    amount_paid: 24900,
    amount_due: 0,
    payment_id: "pay_Billing01",
    billing_start: start,
    billing_end: end,
    tax_amount: 0,
  });
  let paid = false;
  const provider = new RazorpaySubscriptions(async (url, options) => {
    const path = new URL(String(url));
    let value: any;
    if (path.pathname === "/v1/plans/plan_Test01")
      value = {
        id: "plan_Test01",
        period: "monthly",
        interval: 1,
        item: { amount: 24900, currency: "INR" },
      };
    else if (
      path.pathname === "/v1/subscriptions" &&
      options?.method === "POST"
    ) {
      const input = JSON.parse(String(options.body));
      const id = `sub_Billing${++creations}`;
      value = { ...input, id, status: "created" };
      remotes.set(id, value);
    } else if (path.pathname === "/v1/invoices")
      value = {
        items: paid ? [invoice(path.searchParams.get("subscription_id")!)] : [],
      };
    else if (path.pathname === "/v1/payments/pay_Billing01")
      value = {
        id: "pay_Billing01",
        amount: 24900,
        currency: "INR",
        status: "captured",
        captured: true,
        amount_refunded: refunded,
        created_at: paidAt,
      };
    else {
      const id = path.pathname.split("/")[3]!;
      value = remotes.get(id);
      if (path.pathname.endsWith("/cancel")) value.status = "cancelled";
    }
    assert.ok(value, `Unexpected test provider route ${path.pathname}`);
    return new Response(JSON.stringify(value), { status: 200 });
  });
  const created = await createSubscription(
    account.id,
    organisationId,
    provider,
  );
  assert.equal(
    (await createSubscription(account.id, organisationId, provider))
      .subscriptionId,
    created.subscriptionId,
  );
  assert.equal(creations, 1);
  const local = await prisma.pgSubscription.findFirstOrThrow({
    where: { organisationId, current: true },
  });
  assert.equal(
    await entitlement(organisationId),
    false,
    "mandate creation must not grant access",
  );
  paid = true;
  remotes.get(created.subscriptionId).status = "active";
  await Promise.all([
    reconcileSubscription(local.id, provider),
    reconcileSubscription(local.id, provider),
  ]);
  assert.equal(
    await prisma.pgBillingPayment.count({
      where: { subscriptionId: local.id },
    }),
    1,
  );
  assert.equal(await entitlement(organisationId), true);
  invoiceChange = true;
  await assert.rejects(() => reconcileSubscription(local.id, provider), {
    code: "UNVERIFIED_SUBSCRIPTION_PAYMENT",
  });
  invoiceChange = false;
  refunded = 1;
  await reconcileSubscription(local.id, provider);
  assert.equal(await entitlement(organisationId), false);
  refunded = 0;
  await reconcileSubscription(local.id, provider);
  assert.equal(
    (
      await prisma.pgBillingPayment.findUniqueOrThrow({
        where: { providerPaymentId: "pay_Billing01" },
      })
    ).refundedPaise,
    1,
    "late observations cannot undo a refund",
  );
  await cancelSubscription(account.id, organisationId, provider);
  await assert.rejects(
    () => createSubscription(account.id, organisationId, provider),
    { code: "MANDATE_ALREADY_SUBMITTED" },
  );
  assert.equal(creations, 1);
  const raw = Buffer.from(
    JSON.stringify({
      event: "subscription.cancelled",
      payload: { subscription: { entity: { id: created.subscriptionId } } },
    }),
  );
  const signature = createHmac("sha256", "test-unit-webhook")
    .update(raw)
    .digest("hex");
  const eventId = `event-${crypto.randomUUID()}`;
  await processSubscriptionWebhook(raw, signature, eventId, provider);
  await processSubscriptionWebhook(raw, signature, eventId, provider);
  assert.equal(
    await prisma.pgProviderEvent.count({ where: { eventKey: eventId } }),
    1,
  );
  const changed = Buffer.from(`${raw} `);
  const changedSig = createHmac("sha256", "test-unit-webhook")
    .update(changed)
    .digest("hex");
  await assert.rejects(
    () => processSubscriptionWebhook(changed, changedSig, eventId, provider),
    { code: "EVENT_CONFLICT" },
  );
  await assert.rejects(
    () => processSubscriptionWebhook(raw, "0".repeat(64), "forged", provider),
    { code: "INVALID_WEBHOOK_SIGNATURE" },
  );
  assert.ok(
    await prisma.pgAudit.count({
      where: { organisationId, action: "BILLING_REFUND_RECONCILED" },
    }),
  );
});
async function request(
  path: string,
  token: string,
  body?: object,
  property?: string,
) {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, {
    method: body ? "POST" : "GET",
    headers: {
      authorization: `Bearer ${token}`,
      origin: "https://billing.example.test",
      "content-type": "application/json",
      ...(property ? { "x-property-id": property } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, body: (await response.json()) as any };
}
test("isolated database: creation retries, invitations, access revocation and tenant boundaries", async () => {
  const suffix = crypto.randomUUID();
  const phoneA = `+919${String(Math.floor(Math.random() * 1e9)).padStart(9, "0")}`;
  const phoneB = `+918${String(Math.floor(Math.random() * 1e9)).padStart(9, "0")}`;
  const a = await phoneAccount({ uid: `uid-a-${suffix}`, phoneE164: phoneA });
  const b = await phoneAccount({ uid: `uid-b-${suffix}`, phoneE164: phoneB });
  await assert.rejects(
    () => phoneAccount({ uid: "different-uid", phoneE164: a.phoneE164! }),
    { code: "IDENTITY_CONFLICT" },
  );
  await saveProfile(a.id, { fullName: "Owner A", intent: "OWNER" });
  await saveProfile(b.id, { fullName: "Owner B", intent: "OWNER" });
  const input = {
    name: "Maple House",
    city: "Bengaluru",
    approximateRooms: 12,
    key: `property-${suffix}`,
  };
  const [p, again] = await Promise.all([
    createProperty(a.id, input),
    createProperty(a.id, input),
  ]);
  assert.equal(p.propertyId, again.propertyId);
  assert.equal(await prisma.property.count({ where: { id: p.propertyId } }), 1);
  assert.equal(
    await prisma.room.count({ where: { propertyId: p.propertyId } }),
    0,
    "approximate room count must not create fictional rooms",
  );
  await assert.rejects(
    () => createProperty(a.id, { ...input, name: "Different name" }),
    { code: "IDEMPOTENCY_CONFLICT" },
  );
  await assert.rejects(
    () =>
      createProperty(b.id, {
        ...input,
        key: `other-${suffix}`,
        organisationId: p.organisationId,
      }),
    { code: "FORBIDDEN" },
  );
  await assert.rejects(() => ownerOrganisation(b.id, p.organisationId), {
    code: "FORBIDDEN",
  });
  assert.equal(await entitlement(p.organisationId), false);
  const snapshot = await accountSnapshot(a.id);
  const member = snapshot.memberships[0];
  const ownerTokens = await membershipTokens(a.id, member.id);
  assert.equal(
    (await request("/api/owner/probe", ownerTokens.accessToken, {})).status,
    402,
    "unpaid new workspace writes must be denied",
  );
  assert.equal(
    (
      await request(
        "/api/owner/probe",
        ownerTokens.accessToken,
        undefined,
        "other-property",
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await request(
        "/api/platform/organisations/other/subscription",
        ownerTokens.accessToken,
      )
    ).status,
    403,
  );
  await assert.rejects(() => membershipTokens(b.id, member.id), {
    code: "FORBIDDEN",
  });
  const invite = await createInvitation(a.id, {
    organisationId: p.organisationId,
    propertyId: p.propertyId,
    role: "STAFF",
    phoneE164: b.phoneE164!,
    permissions: ["OCCUPANCY_READ"],
  });
  await assert.rejects(() => acceptInvitation(a.id, invite.code), {
    code: "INVITATION_UNAVAILABLE",
  });
  const staff = await acceptInvitation(b.id, invite.code);
  assert.equal(staff.role, "STAFF");
  assert.equal(staff.actorUserId, null);
  assert.equal((await acceptInvitation(b.id, invite.code)).id, staff.id);
  const staffTokens = await membershipTokens(b.id, staff.id);
  assert.equal(
    (await request("/api/owner/probe", staffTokens.accessToken)).status,
    403,
  );
  const view = await request("/api/platform/staff", staffTokens.accessToken);
  assert.equal(view.status, 200);
  assert.equal(view.body.property.id, p.propertyId);
  assert.equal(view.body.occupancy.activeResidents, 0);
  assert.equal((await request("/api/platform/organisations/foreign/subscription/authorise", ownerTokens.accessToken, { accepted: true, amountPaise: 24900, cycles: 12 })).status, 403);
  const badOrigin = await fetch(`http://127.0.0.1:${port}/api/platform/organisations/${p.organisationId}/subscription/authorise`, { method: "POST", headers: { authorization: `Bearer ${ownerTokens.accessToken}`, origin: "https://unapproved.example.test", "content-type": "application/json" }, body: JSON.stringify({ accepted: true, amountPaise: 24900, cycles: 12 }) });
  assert.equal(badOrigin.status, 403);
  const unused = await createInvitation(a.id, {
    organisationId: p.organisationId,
    propertyId: p.propertyId,
    role: "STAFF",
    phoneE164: b.phoneE164!,
    permissions: ["OCCUPANCY_READ"],
  });
  const revoked = await request(
    `/api/platform/memberships/${staff.id}/revoke`,
    ownerTokens.accessToken,
    {},
  );
  assert.equal(revoked.status, 200);
  await assert.rejects(() => acceptInvitation(b.id, unused.code), {
    code: "INVITATION_USED",
  });
  await assert.rejects(() => accountSession(staffTokens.accessToken), {
    code: "MEMBERSHIP_REVOKED",
  });
  await request("/api/platform/logout", platformPair(a).accessToken, {});
  await assert.rejects(
    () => accountSession(ownerTokens.refreshToken, "refresh"),
    { code: "SESSION_INVALID" },
  );
  assert.ok(
    (await prisma.pgAudit.count({
      where: { organisationId: p.organisationId },
    })) >= 3,
  );
});
