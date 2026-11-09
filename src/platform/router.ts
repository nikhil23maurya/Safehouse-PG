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
import { phoneConfig, verifyPhoneIdentity } from "./identity.js";
import {
  accountSession,
  accountSnapshot,
  atomic,
  audit,
  createProperty,
  linkLegacy,
  membershipTokens,
  ownerOrganisation,
  phoneAccount,
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
} from "./billing.js";
import { merchantStatus } from "./merchant.js";
import {
  customWebBillingEnabled,
  requireBillingOrigin,
  verifyAuthorisation,
} from "./web-billing.js";
import { createPlanOrder, manualPlanStatus, recheckPlanPayments, verifyPlanPayment } from "./plan-payments.js";
import { beginMerchantSetup, merchantProfileInput, merchantBankInput, submitMerchantBank, merchantOnboardingLink, syncMerchantRecord } from "./cashfree-merchant.js";

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
    phone: phoneConfig(packageId),
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
    androidBilling: "CONSUMPTION_ONLY",
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
platformRouter.post("/phone", limited, async (req, res) => {
  const { idToken, mode } = z
    .object({
      idToken: z.string().min(100).max(10000),
      mode: z.enum(["SIGN_UP", "SIGN_IN"]).default("SIGN_UP"),
    })
    .parse(req.body);
  const account = await phoneAccount(
    await verifyPhoneIdentity(idToken),
    mode === "SIGN_UP",
  );
  res.json({
    tokens: platformPair(account),
    ...(await accountSnapshot(account.id)),
  });
});
platformRouter.post("/refresh", limited, async (req, res) => {
  const { refreshToken } = z
    .object({ refreshToken: z.string().max(8192) })
    .parse(req.body);
  const { account, membership } = await accountSession(
    refreshToken,
    "refresh",
    true,
  );
  res.json({ tokens: platformPair(account, membership?.id || null) });
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
  res.json({
    ...(await accountSnapshot(account.id)),
    membershipId: membership?.id || null,
    user: membership
      ? {
          id: membership.actorUserId || account.id,
          fullName: account.fullName,
          email: account.email,
          role: membership.role === "RESIDENT" ? "STUDENT" : membership.role,
          mustChangePassword: false,
        }
      : {
          id: account.id,
          fullName: account.fullName,
          email: account.email,
          role: "ACCOUNT",
          mustChangePassword: false,
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
    tokens: platformPair(account),
    ...(await accountSnapshot(account.id)),
  });
});
platformRouter.post("/profile", async (req, res) => {
  const { account } = await session(req);
  const input = z
    .object({
      fullName: z.string().trim().min(2).max(100),
      email: z.union([z.email(), z.literal("")]).optional(),
      intent: z.enum(["OWNER", "RESIDENT", "STAFF"]),
    })
    .parse(req.body);
  await saveProfile(account.id, input);
  res.json(await accountSnapshot(account.id));
});
platformRouter.post("/properties", async (req, res) => {
  const { account } = await session(req);
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
      phoneE164: z.string().regex(/^\+91[6-9]\d{9}$/),
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
      phoneLast4: i.phoneE164.slice(-4),
      expiresAt: i.expiresAt,
    })),
  });
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
      where: { id: invitation.id, status: "PENDING" },
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
    if (member.account.phoneE164)
      await tx.pgInvitation.updateMany({
        where: {
          organisationId: member.organisationId,
          propertyId: member.propertyId,
          role: member.role,
          phoneE164: member.account.phoneE164,
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
platformRouter.use("/organisations/:id/merchant", (_req,res,next) => {
  res.setHeader("Cache-Control","no-store");
  next();
});
platformRouter.get("/organisations/:id/merchant", async (req, res) => {
  const { account } = await session(req);
  res.json(await merchantStatus(account.id, id.parse(req.params.id)));
});
platformRouter.post("/organisations/:id/merchant/profile", limited, async (req,res) => {
  const { account } = await session(req);
  const organisationId = id.parse(req.params.id);
  await beginMerchantSetup(account.id, organisationId, merchantProfileInput.parse(req.body));
  res.json(await merchantStatus(account.id,organisationId));
});
platformRouter.post("/organisations/:id/merchant/bank", limited, async (req,res) => {
  const { account } = await session(req);
  const organisationId = id.parse(req.params.id);
  await submitMerchantBank(account.id,organisationId,merchantBankInput.parse(req.body));
  res.json(await merchantStatus(account.id,organisationId));
});
platformRouter.post("/organisations/:id/merchant/onboarding-link", limited, async (req,res) => {
  const { account } = await session(req);
  res.setHeader("Cache-Control","no-store");
  res.setHeader("Referrer-Policy","no-referrer");
  res.json(await merchantOnboardingLink(account.id,id.parse(req.params.id)));
});
platformRouter.post("/organisations/:id/merchant/recheck", limited, async (req,res) => {
  const { account } = await session(req);
  const organisationId = id.parse(req.params.id);
  await ownerOrganisation(account.id,organisationId);
  await syncMerchantRecord(organisationId);
  res.json(await merchantStatus(account.id,organisationId));
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
