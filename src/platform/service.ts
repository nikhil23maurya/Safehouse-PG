import type { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../db.js";
import { AppError, assert } from "../errors.js";
import { verifyToken } from "../security.js";
import { platformClaims, platformPair } from "./tokens.js";

export async function atomic<T>(
  action: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await prisma.$transaction(action, {
        isolationLevel: "Serializable",
      });
    } catch (error: any) {
      if (attempt >= 3 || !["P2034", "P2002"].includes(error.code)) throw error;
    }
  }
}
export async function audit(
  tx: Prisma.TransactionClient,
  actorAccountId: string | null,
  organisationId: string | null,
  action: string,
  entityId: string,
  metadata?: Prisma.InputJsonValue,
) {
  await tx.pgAudit.create({
    data: {
      actorAccountId,
      organisationId,
      action,
      entityId,
      ...(metadata ? { metadata } : {}),
    },
  });
}
export async function accountSession(
  token: string,
  type: "access" | "refresh" = "access",
  accountOnlyFallback = false,
) {
  const claims = platformClaims(token, type);
  const account = await prisma.pgAccount.findUnique({
    where: { id: claims.sub },
  });
  assert(
    account &&
      account.status === "ACTIVE" &&
      account.tokenVersion === claims.ver,
    401,
    "SESSION_INVALID",
    "Sign in again to continue.",
  );
  const membership = claims.membershipId
    ? await prisma.pgMembership.findFirst({
        where: {
          id: claims.membershipId,
          accountId: account.id,
          status: "ACTIVE",
        },
        include: { organisation: true, property: true, actor: true },
      })
    : null;
  assert(
    accountOnlyFallback || !claims.membershipId || membership,
    403,
    "MEMBERSHIP_REVOKED",
    "Your access to this workspace has changed.",
  );
  if (membership)
    assert(
      membership.property.ownerId === membership.organisation.legacyOwnerId &&
        (membership.role !== "OWNER" ||
          membership.organisation.ownerAccountId === account.id),
      403,
      "MEMBERSHIP_INVALID",
      "The workspace relationship needs owner confirmation.",
    );
  return { account, membership, claims };
}
export async function accountSnapshot(accountId: string) {
  const account = await prisma.pgAccount.findUniqueOrThrow({
    where: { id: accountId },
  });
  const memberships = await prisma.pgMembership.findMany({
    where: { accountId, status: "ACTIVE" },
    include: { property: true, organisation: true },
    orderBy: { createdAt: "asc" },
  });
  return {
    account: {
      id: account.id,
      fullName: account.fullName,
      phoneE164: account.phoneE164,
      email: account.email,
      emailVerified: account.emailVerified,
      setupIntent: account.setupIntent,
    },
    memberships: memberships.map((m) => ({
      id: m.id,
      role: m.role,
      permissions: m.permissions,
      property: {
        id: m.property.id,
        name: m.property.name,
        timezone: m.property.timezone,
        currency: m.property.currency,
      },
      organisation: {
        id: m.organisation.id,
        name: m.organisation.name,
        legacyAccess: m.organisation.legacyAccess,
      },
    })),
  };
}
export async function phoneAccount(
  identity: {
    uid: string;
    phoneE164: string;
  },
  create = true,
) {
  return atomic(async (tx) => {
    const existing = await tx.pgAccount.findFirst({
      where: {
        OR: [{ firebaseUid: identity.uid }, { phoneE164: identity.phoneE164 }],
      },
    });
    if (existing) {
      assert(
        existing.status === "ACTIVE" &&
          existing.firebaseUid === identity.uid &&
          existing.phoneE164 === identity.phoneE164,
        409,
        "IDENTITY_CONFLICT",
        "This number requires account recovery. It cannot claim another account automatically.",
      );
      return existing;
    }
    assert(
      create,
      404,
      "PHONE_ACCOUNT_NOT_FOUND",
      "This number has no PGOne phone account yet. Create an account, or use email sign-in for an existing password account.",
    );
    const account = await tx.pgAccount.create({
      data: { firebaseUid: identity.uid, phoneE164: identity.phoneE164 },
    });
    await audit(tx, account.id, null, "PHONE_ACCOUNT_CREATED", account.id);
    return account;
  });
}
async function legacyOrganisation(
  tx: Prisma.TransactionClient,
  ownerId: string,
) {
  const found = await tx.pgOrganisation.findUnique({
    where: { legacyOwnerId: ownerId },
  });
  if (found) return found;
  const user = await tx.user.findUniqueOrThrow({ where: { id: ownerId } });
  assert(
    user.role === "OWNER" && user.status === "ACTIVE",
    403,
    "OWNER_UNAVAILABLE",
    "The property owner is unavailable.",
  );
  const account = await tx.pgAccount.upsert({
    where: { legacyUserId: user.id },
    create: {
      legacyUserId: user.id,
      fullName: user.fullName,
      email: user.email,
    },
    update: {},
  });
  return tx.pgOrganisation.create({
    data: {
      ownerAccountId: account.id,
      legacyOwnerId: user.id,
      name: user.fullName,
      legacyAccess: true,
    },
  });
}
export async function linkLegacy(
  accessToken: string,
  existingAccountId?: string,
  expectedVersion?: number,
) {
  const claims = verifyToken(accessToken, "access");
  return atomic(async (tx) => {
    const user = await tx.user.findUnique({ where: { id: claims.sub } });
    assert(
      user &&
        user.status === "ACTIVE" &&
        user.tokenVersion === claims.ver &&
        user.role === claims.role,
      401,
      "SESSION_INVALID",
      "Sign in again to link your existing account.",
    );
    assert(
      !user.mustChangePassword,
      409,
      "PASSWORD_CHANGE_REQUIRED",
      "Change your temporary password through existing account sign-in before linking.",
    );
    let account = await tx.pgAccount.findUnique({
      where: { legacyUserId: user.id },
    });
    assert(
      !existingAccountId || !account || account.id === existingAccountId,
      409,
      "ACCOUNT_ALREADY_LINKED",
      "This existing account is linked to a different identity. Use account recovery.",
    );
    if (existingAccountId) {
      const target = await tx.pgAccount.findUniqueOrThrow({
        where: { id: existingAccountId },
      });
      assert(
        target.status === "ACTIVE" && target.tokenVersion === expectedVersion,
        401,
        "SESSION_INVALID",
        "Sign in again before linking accounts.",
      );
      assert(
        !target.legacyUserId || target.legacyUserId === user.id,
        409,
        "ACCOUNT_ALREADY_LINKED",
        "This phone account already has a different legacy account.",
      );
    }
    if (!account)
      account = existingAccountId
        ? await tx.pgAccount.update({
            where: { id: existingAccountId },
            data: { legacyUserId: user.id },
          })
        : await tx.pgAccount.create({
            data: {
              legacyUserId: user.id,
              fullName: user.fullName,
              email: user.email,
            },
          });
    assert(
      !existingAccountId ||
        !account.legacyUserId ||
        account.legacyUserId === user.id,
      409,
      "ACCOUNT_ALREADY_LINKED",
      "This phone account already has a different legacy account.",
    );
    if (user.role === "OWNER") await legacyOrganisation(tx, user.id);
    const properties =
      user.role === "OWNER"
        ? await tx.property.findMany({ where: { ownerId: user.id } })
        : [];
    const resident =
      user.role === "STUDENT"
        ? await tx.student.findUnique({
            where: { userId: user.id },
            include: { property: true },
          })
        : null;
    if (resident)
      assert(
        resident.status === "ACTIVE",
        403,
        "RESIDENT_INACTIVE",
        "This residency is not active.",
      );
    for (const p of resident ? [resident.property] : properties) {
      const org = await legacyOrganisation(tx, p.ownerId);
      await tx.pgPropertySetup.upsert({
        where: { propertyId: p.id },
        create: {
          propertyId: p.id,
          organisationId: org.id,
          creationKey: `legacy:${p.id}`,
        },
        update: {},
      });
      await tx.pgMembership.upsert({
        where: {
          accountId_propertyId_role: {
            accountId: account.id,
            propertyId: p.id,
            role: user.role === "OWNER" ? "OWNER" : "RESIDENT",
          },
        },
        create: {
          accountId: account.id,
          propertyId: p.id,
          organisationId: org.id,
          role: user.role === "OWNER" ? "OWNER" : "RESIDENT",
          actorUserId: user.id,
        },
        update: {},
      });
    }
    await audit(tx, account.id, null, "LEGACY_ACCOUNT_LINKED", user.id);
    return account;
  });
}
export async function saveProfile(
  accountId: string,
  input: {
    fullName: string;
    email?: string;
    intent: "OWNER" | "RESIDENT" | "STAFF";
  },
) {
  return atomic(async (tx) => {
    // An unverified email is contact information, never an identity-linking proof.
    const account = await tx.pgAccount.findUniqueOrThrow({
      where: { id: accountId },
    });
    const nextEmail = input.email?.trim().toLowerCase() || null;
    const updated = await tx.pgAccount.update({
      where: { id: accountId },
      data: {
        fullName: input.fullName.trim(),
        email: nextEmail,
        emailVerified: nextEmail === account.email && account.emailVerified,
        setupIntent: input.intent,
      },
    });
    await audit(tx, accountId, null, "PROFILE_SAVED", accountId);
    return updated;
  });
}
export async function createProperty(
  accountId: string,
  input: {
    name: string;
    city: string;
    approximateRooms?: number;
    key: string;
    organisationId?: string;
  },
) {
  return atomic(async (tx) => {
    const account = await tx.pgAccount.findUniqueOrThrow({
      where: { id: accountId },
    });
    assert(
      account.status === "ACTIVE" && account.fullName.trim().length >= 2,
      409,
      "PROFILE_REQUIRED",
      "Complete your owner profile first.",
    );
    const creationKey = `${accountId}:${input.key}`;
    const prior = await tx.pgPropertySetup.findUnique({
      where: { creationKey },
      include: { property: true },
    });
    if (prior) {
      assert(
        (!input.organisationId ||
          prior.organisationId === input.organisationId) &&
          prior.property.name === input.name &&
          prior.city === input.city &&
          (prior.approximateRooms ?? null) === (input.approximateRooms ?? null),
        409,
        "IDEMPOTENCY_CONFLICT",
        "That request already created a different property.",
      );
      return prior;
    }
    let organisation = input.organisationId
      ? await tx.pgOrganisation.findFirst({
          where: { id: input.organisationId, ownerAccountId: accountId },
        })
      : await tx.pgOrganisation.findFirst({
          where: { ownerAccountId: accountId },
          orderBy: { createdAt: "asc" },
        });
    assert(
      !input.organisationId || organisation,
      403,
      "FORBIDDEN",
      "You cannot create a property in this organisation.",
    );
    if (!organisation) {
      const linked = account.legacyUserId
        ? await tx.user.findFirst({
            where: {
              id: account.legacyUserId,
              role: "OWNER",
              status: "ACTIVE",
            },
          })
        : null;
      const actor =
        linked ||
        (await tx.user.create({
          data: {
            fullName: account.fullName,
            email: null,
            passwordHash: null,
            role: "OWNER",
            mustChangePassword: false,
          },
        }));
      organisation = await tx.pgOrganisation.create({
        data: {
          ownerAccountId: accountId,
          legacyOwnerId: actor.id,
          name: input.name,
        },
      });
    }
    const property = await tx.property.create({
      data: {
        name: input.name,
        ownerId: organisation.legacyOwnerId,
        timezone: "Asia/Kolkata",
        currency: "INR",
      },
    });
    const setup = await tx.pgPropertySetup.create({
      data: {
        propertyId: property.id,
        organisationId: organisation.id,
        city: input.city,
        approximateRooms: input.approximateRooms,
        creationKey,
      },
      include: { property: true },
    });
    await tx.pgMembership.create({
      data: {
        accountId,
        organisationId: organisation.id,
        propertyId: property.id,
        role: "OWNER",
        actorUserId: organisation.legacyOwnerId,
      },
    });
    await audit(
      tx,
      accountId,
      organisation.id,
      "PROPERTY_CREATED",
      property.id,
      { approximateRooms: input.approximateRooms ?? null },
    );
    return setup;
  });
}
export async function ownerOrganisation(
  accountId: string,
  organisationId: string,
) {
  const org = await prisma.pgOrganisation.findFirst({
    where: { id: organisationId, ownerAccountId: accountId },
    include: { legacyOwner: { select: { status: true } } },
  });
  assert(
    org && org.legacyOwner.status === "ACTIVE",
    403,
    "FORBIDDEN",
    "You do not have access to this organisation.",
  );
  return org;
}
export async function membershipTokens(
  accountId: string,
  membershipId: string,
  expectedVersion?: number,
) {
  const membership = await prisma.pgMembership.findFirst({
    where: { id: membershipId, accountId, status: "ACTIVE" },
  });
  assert(
    membership,
    403,
    "FORBIDDEN",
    "You do not have access to this workspace.",
  );
  const account = await prisma.pgAccount.findUniqueOrThrow({
    where: { id: accountId },
  });
  assert(
    account.status === "ACTIVE" &&
      (expectedVersion === undefined ||
        account.tokenVersion === expectedVersion),
    401,
    "SESSION_INVALID",
    "Sign in again to choose a workspace.",
  );
  return platformPair(account, membership.id);
}
