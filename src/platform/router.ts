import express, { type Request } from "express";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import { prisma } from "../db.js";
import { assert } from "../errors.js";
import {
  platformConfig,
  platformEnabled,
  PLAN,
  STAFF_PERMISSIONS,
  subscriptionCredentials,
} from "./config.js";
import { emailAuthRouter, mailReady } from "./email-auth.js";
import { issueSession, rotateSession } from "./sessions.js";
import { journey } from "./journey.js";
import { directRentRouter } from "./direct-rent.js";
import { planReceipt } from "./plan-receipts.js";
import {
  accountSession,
  accountSnapshot,
  atomic,
  audit,
  createProperty,
  linkLegacy,
  membershipTokens,
  ownerOrganisation,
  saveProfile,
} from "./service.js";
import { platformPair } from "./tokens.js";
import {
  acceptInvitation,
  createInvitation,
  previewInvitation,
} from "./invitations.js";
import {
  cancelSubscription,
  reconcileSubscription,
  recoverSubscriptionCreation,
  subscriptionStatus,
  entitlement,
} from "./billing.js";
import { merchantStatus } from "./merchant.js";
import {
  customWebBillingEnabled,
  requireBillingOrigin,
  verifyAuthorisation,
} from "./web-billing.js";
import { createPlanOrder, planProviderConfigured, manualPlanStatus, recheckPlanPayments, verifyPlanPayment } from "./plan-payments.js";


export const platformRouter = express.Router();
const limited = rateLimit({
  windowMs: 15 * 60_000,
  limit: 25,
  standardHeaders: "draft-8",
  legacyHeaders: false,
});
const id = z.string().min(1).max(100);
const code = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
async function session(req: Request) {
  return accountSession(
    (req.header("authorization") || "").replace(/^Bearer /, ""),
    "access",
    true,
  );
}

platformRouter.get("/config", (req, res) => {
  const packageId = String(req.query.package || "web");
  res.json({
    enabled: platformEnabled(),
    phone: null,
    authentication: "EMAIL_PASSWORD",
    recoveryAvailable: mailReady(),
    googleEnabled: false,
    customWebBilling: {
      enabled: customWebBillingEnabled(),
      keyId: customWebBillingEnabled()
        ? subscriptionCredentials()!.keyId
        : null,
    },
    plan: PLAN,
    billingMode: "MANUAL_MONTHLY",
    deploymentCommit: process.env.RENDER_GIT_COMMIT || null,
    // Sideloaded internal test APK only. Google Play builds must not bypass Play Billing.
    androidBilling: packageId === "com.safehouse.pg.testing"
      ? (platformEnabled() && planProviderConfigured() ? "CUSTOM_UPI_INTENT" : "NOT_CONFIGURED")
      : "CONSUMPTION_ONLY",
    legal: {
      terms: platformConfig.PGONE_TERMS_URL || null,
      privacy: platformConfig.PGONE_PRIVACY_URL || null,
    },
  });
});
platformRouter.post(
  "/organisations/:id/subscription/authorise",
  limited,
  async (req, res) => {
    requireBillingOrigin(req);
    const { account } = await session(req);
    const organisationId = id.parse(req.params.id);
    await ownerOrganisation(account.id, organisationId);
    assert(false, 410, "RECURRING_PURCHASE_REMOVED", "PGOne uses a fresh one-time payment each month. Refresh the billing website.");
  },
);
// The Android testing package can initiate its one-time PGOne fee using
// the native Razorpay Custom UPI Intent SDK. Production Play distribution
// remains consumption-only unless approved alternative billing is enrolled.
// This origin check is defence-in-depth; paid access always depends on Razorpay
// HMAC/captured-payment verification plus owner membership binding.
function requireAndroidTestingCheckout(req: Request) {
  assert(platformEnabled() && planProviderConfigured(), 503, "ANDROID_BILLING_NOT_CONFIGURED",
    "PGOne's Razorpay payment setup is not activated on this server.");
  assert(req.header("origin") === "https://appassets.androidplatform.net",
    403, "ANDROID_BILLING_ORIGIN", "This payment must start within the PGOne testing app.");
}
platformRouter.post("/organisations/:id/plan/android/orders", limited, async (req, res) => {
  requireAndroidTestingCheckout(req);
  const { account } = await session(req);
  const input = z.object({ accepted: z.literal(true), amountPaise: z.literal(24900),
    recurring: z.literal(false), requestKey: z.string().min(16).max(100) }).parse(req.body);
  res.json(await createPlanOrder(account.id, id.parse(req.params.id), input.requestKey));
});
platformRouter.post("/organisations/:id/plan/orders", limited, async (req, res) => {
  requireBillingOrigin(req);
  const { account } = await session(req);
  const input = z.object({ accepted: z.literal(true), amountPaise: z.literal(24900),
    recurring: z.literal(false), requestKey: z.string().min(16).max(100) }).parse(req.body);
  res.json(await createPlanOrder(account.id, id.parse(req.params.id), input.requestKey));
});
platformRouter.post("/organisations/:id/plan/orders/:orderId/verify", limited, async (req, res) => {
  requireBillingOrigin(req);
  const { account } = await session(req);
  const input = z.object({ paymentId: z.string().regex(/^pay_[a-zA-Z0-9]+$/), signature: z.string().regex(/^[a-fA-F0-9]{64}$/) }).parse(req.body);
  res.json(await verifyPlanPayment(account.id, id.parse(req.params.id), id.parse(req.params.orderId), input));
});
platformRouter.post(
  "/organisations/:id/subscription/authorisation",
  limited,
  async (req, res) => {
    requireBillingOrigin(req);
    const { account } = await session(req);
    const input = z
      .object({
        paymentId: z.string().regex(/^pay_[a-zA-Z0-9]+$/),
        signature: z.string().regex(/^[a-fA-F0-9]{64}$/),
      })
      .parse(req.body);
    res.json(
      await verifyAuthorisation(account.id, id.parse(req.params.id), input),
    );
  },
);
platformRouter.use((_req, _res, next) => {
  assert(
    platformEnabled(),
    503,
    "PLATFORM_NOT_ENABLED",
    "New account services are awaiting activation. Existing email sign-in remains available.",
  );
  next();
});
platformRouter.post("/phone", (_req,_res) => {
  assert(false,410,"PHONE_AUTH_RETIRED","Use your email and password. Historical phone-only accounts require ownership recovery.");
});
platformRouter.use("/auth",emailAuthRouter);
platformRouter.use("/rent",directRentRouter);
platformRouter.post("/refresh",limited,async(req,res)=>{
  const {refreshToken} = z.object({refreshToken:z.string().max(8192)}).parse(req.body);
  res.json({tokens:await rotateSession(refreshToken)});
});
platformRouter.get("/session", async (req, res) => {
  const { account, membership } = await session(req);
  let student = null;
  if (membership?.role === "RESIDENT") {
    student = await prisma.student.findFirst({
      where: {
        userId: membership.actorUserId || "",
        propertyId: membership.propertyId,
        status: "ACTIVE",
      },
      include: { room: true },
    });
    assert(
      student,
      403,
      "RESIDENT_INACTIVE",
      "Your residency is no longer active.",
    );
  }
  // Phone authentication is an independent verified factor. Temporary-password
  // requirements remain unchanged for the legacy password login.
  // One authoritative entitlement snapshot drives onboarding and navigation.
  // New owners must not enter the operational workspace before provider-verified payment.
  // Preserve explicitly grandfathered organisations through the same entitlement function.
  const snapshot = await accountSnapshot(account.id);
  const ownerOrganisationIds = [...new Set(snapshot.memberships
    .filter((m) => m.role === "OWNER")
    .map((m) => m.organisation.id))];
  const ownerEntitlements = new Map(await Promise.all(ownerOrganisationIds.map(async (organisationId) =>
    [organisationId, await entitlement(organisationId)] as const,
  )));
  const memberships = snapshot.memberships.map((m) => ({
    ...m,
    organisation: {
      ...m.organisation,
      entitled: m.role === "OWNER" ? ownerEntitlements.get(m.organisation.id) === true : null,
    },
  }));
  res.json({
    ...snapshot,
    memberships,
    membershipId: membership?.id || null,
    journey: await journey(account,membership),
    user: membership
      ? {
          id: membership.actorUserId || account.id,
          fullName: account.fullName,
          email: account.email,
          role: membership.role === "RESIDENT" ? "STUDENT" : membership.role,
          mustChangePassword: account.passwordChangeRequired,
        }
      : {
          id: account.id,
          fullName: account.fullName,
          email: account.email,
          role: "ACCOUNT",
          mustChangePassword: account.passwordChangeRequired,
        },
    property: membership
      ? {
          id: membership.property.id,
          name: membership.property.name,
          timezone: membership.property.timezone,
          currency: membership.property.currency,
        }
      : null,
    student,
  });
});
platformRouter.post("/logout", async (req, res) => {
  const { account } = await session(req);
  await atomic(async (tx) => {
    await tx.pgAccount.update({
      where: { id: account.id },
      data: { tokenVersion: { increment: 1 } },
    });
    await audit(tx, account.id, null, "ACCOUNT_LOGOUT", account.id);
  });
  res.json({ ok: true });
});
platformRouter.post("/link-legacy", limited, async (req, res) => {
  const { legacyAccessToken } = z
    .object({ legacyAccessToken: z.string().min(20).max(8192) })
    .parse(req.body);
  const current = req.header("authorization")?.startsWith("Bearer pg1.")
    ? await session(req)
    : null;
  const account = await linkLegacy(
    legacyAccessToken,
    current?.account.id,
    current?.account.tokenVersion,
  );
  res.json({
    tokens: await issueSession(account),
    ...(await accountSnapshot(account.id)),
  });
});
platformRouter.post("/profile", async (req, res) => {
  const { account } = await session(req);
  const input = z
    .object({
      fullName: z.string().trim().min(2).max(100),
      contactPhone: z.string().trim().regex(/^[+0-9 ()-]{0,25}$/).optional(),
      intent: z.enum(["OWNER", "RESIDENT", "STAFF"]),
    })
    .parse(req.body);
  await saveProfile(account.id, input);
  res.json(await accountSnapshot(account.id));
});
platformRouter.post("/properties", async (req, res) => {
  const { account } = await session(req);
  assert(!account.passwordChangeRequired,403,"PASSWORD_CHANGE_REQUIRED","Change your temporary password first.");
  const input = z
    .object({
      name: z.string().trim().min(2).max(120),
      city: z.string().trim().min(2).max(100),
      approximateRooms: z.number().int().min(1).max(100000).optional(),
      key: z.string().regex(/^[a-zA-Z0-9_-]{16,100}$/),
      organisationId: id.optional(),
    })
    .parse(req.body);
  const setup = await createProperty(account.id, input);
  res.json({
    property: setup.property,
    ...(await accountSnapshot(account.id)),
  });
});
platformRouter.post("/workspace", async (req, res) => {
  const { account } = await session(req);
  const { membershipId } = z.object({ membershipId: id }).parse(req.body);
  res.json({
    tokens: await membershipTokens(
      account.id,
      membershipId,
      account.tokenVersion,
    ),
  });
});
platformRouter.post("/invitations", limited, async (req, res) => {
  const { account } = await session(req);
  const input = z
    .object({
      organisationId: id,
      propertyId: id,
      role: z.enum(["RESIDENT", "STAFF"]),
      email: z.string().trim().toLowerCase().max(254).pipe(z.email()),
      studentId: id.optional(),
      permissions: z.array(z.enum(STAFF_PERMISSIONS)).max(2).default([]),
    })
    .parse(req.body);
  res.json(await createInvitation(account.id, input));
});
platformRouter.post("/invitations/preview", limited, async (req, res) => {
  const { account } = await session(req);
  res.json(await previewInvitation(account.id, code.parse(req.body.code)));
});
platformRouter.post("/invitations/accept", limited, async (req, res) => {
  const { account } = await session(req);
  const member = await acceptInvitation(account.id, code.parse(req.body.code));
  if ("pendingOwnerApproval" in member) return res.json(member);
  res.json({
    tokens: await membershipTokens(account.id, member.id, account.tokenVersion),
  });
});
platformRouter.get("/organisations/:id/invitations", async (req, res) => {
  const { account } = await session(req);
  const org = await ownerOrganisation(account.id, id.parse(req.params.id));
  const records = await prisma.pgInvitation.findMany({
    where: { organisationId: org.id },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  res.json({
    invitations: records.map((i) => ({
      id: i.id,
      role: i.role,
      propertyId: i.propertyId,
      status:
        i.status === "PENDING" && i.expiresAt < new Date()
          ? "EXPIRED"
          : i.status,
      email: i.email,
      requestedAccountId: i.status === "REQUESTED" ? i.acceptedByAccountId : null,
      expiresAt: i.expiresAt,
    })),
  });
});
platformRouter.post("/invitations/:id/approve",limited,async(req,res)=>{
  const {account}=await session(req);
  const input=z.object({accountId:id,identityChecked:z.literal(true)}).strict().parse(req.body);
  const invitation=await prisma.pgInvitation.findUnique({where:{id:id.parse(req.params.id)}});
  assert(invitation,404,"NOT_FOUND","Invitation not found.");
  await ownerOrganisation(account.id,invitation.organisationId);
  assert(await entitlement(invitation.organisationId),402,"SUBSCRIPTION_REQUIRED","Activate PGOne before approving access.");
  res.json(await acceptInvitation(input.accountId,"",{ownerAccountId:account.id,invitationId:invitation.id}));
});
platformRouter.post("/invitations/:id/revoke", async (req, res) => {
  const { account } = await session(req);
  const invitation = await prisma.pgInvitation.findUnique({
    where: { id: id.parse(req.params.id) },
  });
  assert(invitation, 404, "NOT_FOUND", "Invitation not found.");
  await ownerOrganisation(account.id, invitation.organisationId);
  await atomic(async (tx) => {
    await tx.pgInvitation.updateMany({
      where: { id: invitation.id, status: {in:["PENDING","REQUESTED"]} },
      data: { status: "REVOKED" },
    });
    await audit(
      tx,
      account.id,
      invitation.organisationId,
      "INVITATION_REVOKED",
      invitation.id,
    );
  });
  res.json({ ok: true });
});
platformRouter.post("/memberships/:id/revoke", async (req, res) => {
  const { account } = await session(req);
  const member = await prisma.pgMembership.findUnique({
    where: { id: id.parse(req.params.id) },
    include: { account: true },
  });
  assert(
    member && member.role !== "OWNER",
    404,
    "NOT_FOUND",
    "Member not found.",
  );
  await ownerOrganisation(account.id, member.organisationId);
  await atomic(async (tx) => {
    await tx.pgMembership.update({
      where: { id: member.id },
      data: { status: "REVOKED" },
    });
    if (member.account.credentialEmail)
      await tx.pgInvitation.updateMany({
        where: {
          organisationId: member.organisationId,
          propertyId: member.propertyId,
          role: member.role,
          email: member.account.credentialEmail,
          status: "PENDING",
        },
        data: { status: "REVOKED" },
      });
    await audit(
      tx,
      account.id,
      member.organisationId,
      "MEMBERSHIP_REVOKED",
      member.id,
    );
  });
  res.json({ ok: true });
});
platformRouter.get("/organisations/:id/members", async (req, res) => {
  const { account } = await session(req);
  const org = await ownerOrganisation(account.id, id.parse(req.params.id));
  const members = await prisma.pgMembership.findMany({
    where: {
      organisationId: org.id,
      role: { in: ["RESIDENT", "STAFF"] },
      status: "ACTIVE",
    },
    include: { account: true, property: true },
    take: 100,
    orderBy: { createdAt: "desc" },
  });
  res.json({
    members: members.map((m) => ({
      id: m.id,
      role: m.role,
      fullName: m.account.fullName,
      phoneLast4: m.account.phoneE164?.slice(-4) || null,
      propertyName: m.property.name,
      permissions: m.permissions,
    })),
  });
});
platformRouter.get("/organisations/:id/subscription", async (req, res) => {
  const { account } = await session(req);
  res.json(await manualPlanStatus(account.id, id.parse(req.params.id)));
});
platformRouter.get("/organisations/:id/plan/receipts/:receiptId.pdf",async(req,res)=>{
  const {account}=await session(req);await planReceipt(account.id,id.parse(req.params.id),id.parse(req.params.receiptId),res);
});
platformRouter.get("/organisations/:id/records",async(req,res)=>{
  const {account}=await session(req);const org=await ownerOrganisation(account.id,id.parse(req.params.id));
  const cursor=typeof req.query.cursor === "string" ? id.parse(req.query.cursor) : undefined;
  const payments=await prisma.payment.findMany({where:{property:{ownerId:org.legacyOwnerId}},orderBy:{id:"asc"},take:200,
    ...(cursor?{cursor:{id:cursor},skip:1}:{}),include:{invoice:true}});
  await atomic(tx=>audit(tx,account.id,org.id,"FINANCIAL_RECORD_EXPORT",org.id,{count:payments.length}));
  res.setHeader("Cache-Control","no-store");
  res.json({organisationId:org.id,currency:"INR",amountUnit:"PAISE",payments,nextCursor:payments.length===200?payments[199]!.id:null});
});
platformRouter.post(
  "/organisations/:id/subscription/recheck",
  async (req, res) => {
    const { account } = await session(req);
    const org = await ownerOrganisation(account.id, id.parse(req.params.id));
    let sub = await prisma.pgSubscription.findFirst({
      where: { organisationId: org.id, current: true },
    });
    if (sub && !sub.providerSubscriptionId)
      sub = await recoverSubscriptionCreation(sub.id);
    if (sub?.providerSubscriptionId) await reconcileSubscription(sub.id);
    res.json(await recheckPlanPayments(account.id, org.id));
  },
);
platformRouter.post(
  "/organisations/:id/subscription/cancel",
  async (req, res) => {
    const { account } = await session(req);
    await cancelSubscription(account.id, id.parse(req.params.id));
    res.json(await subscriptionStatus(account.id, String(req.params.id)));
  },
);
platformRouter.use("/organisations/:id/merchant", async (req,res,next) => {
  try {
    res.setHeader("Cache-Control","no-store");
    // Payment account activation is a post-subscription action for new owners.
    // A direct API POST cannot bypass the same rule applied in mobile navigation.
    if (req.method !== "GET") {
      const { account } = await session(req);
      const org = await ownerOrganisation(account.id, id.parse(req.params.id));
      assert(await entitlement(org.id), 402, "SUBSCRIPTION_REQUIRED",
        "Activate your ₹249 PGOne plan before submitting merchant or bank verification.");
    }
    next();
  } catch (error) { next(error); }
});
platformRouter.get("/organisations/:id/merchant", async (req, res) => {
  const { account } = await session(req);
  res.json(await merchantStatus(account.id, id.parse(req.params.id)));
});
platformRouter.post("/organisations/:id/merchant/:action", (_req,_res)=>{
  assert(false,410,"MERCHANT_SETUP_UNAVAILABLE","Automated owner settlement requires an approved Razorpay connected-merchant arrangement. Use manual rent recording.");
});
platformRouter.get("/staff", async (req, res) => {
  const { membership } = await session(req);
  assert(
    membership?.role === "STAFF",
    403,
    "FORBIDDEN",
    "Select your staff workspace.",
  );
  const occupancy = membership.permissions.includes("OCCUPANCY_READ")
    ? {
        activeResidents: await prisma.student.count({
          where: { propertyId: membership.propertyId, status: "ACTIVE" },
        }),
        activeRooms: await prisma.room.count({
          where: { propertyId: membership.propertyId, active: true },
        }),
      }
    : null;
  res.json({
    property: { id: membership.property.id, name: membership.property.name },
    permissions: membership.permissions,
    occupancy,
  });
});
