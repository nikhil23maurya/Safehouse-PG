import { prisma } from "../db.js";
import { assert } from "../errors.js";
import { atomic, audit, ownerOrganisation } from "./service.js";
import { hash, randomCode } from "./tokens.js";
import { STAFF_PERMISSIONS } from "./config.js";

export async function createInvitation(
  accountId: string,
  input: {
    organisationId: string;
    propertyId: string;
    role: "RESIDENT" | "STAFF";
    phoneE164: string;
    studentId?: string;
    permissions: string[];
  },
) {
  const org = await ownerOrganisation(accountId, input.organisationId);
  const property = await prisma.property.findFirst({
    where: { id: input.propertyId, ownerId: org.legacyOwnerId },
  });
  assert(property, 403, "FORBIDDEN", "Select a property you manage.");
  if (input.role === "RESIDENT") {
    const student = input.studentId
      ? await prisma.student.findFirst({
          where: {
            id: input.studentId,
            propertyId: property.id,
            status: "ACTIVE",
          },
        })
      : null;
    assert(
      student,
      400,
      "RESIDENT_REQUIRED",
      "Add the resident through Resident Management before inviting them.",
    );
    assert(
      `+91${student.mobile.replace(/\D/g, "").slice(-10)}` === input.phoneE164,
      400,
      "PHONE_MISMATCH",
      "Use the resident's recorded mobile number.",
    );
  }
  assert(
    input.permissions.every((p) => STAFF_PERMISSIONS.includes(p as any)),
    400,
    "INVALID_PERMISSION",
    "Select supported staff permissions.",
  );
  const code = randomCode();
  const invitation = await atomic(async (tx) => {
    const invitation = await tx.pgInvitation.create({
      data: {
        organisationId: org.id,
        propertyId: property.id,
        role: input.role,
        phoneE164: input.phoneE164,
        studentId: input.role === "RESIDENT" ? input.studentId : null,
        permissions: input.role === "STAFF" ? input.permissions : [],
        tokenHash: hash(code),
        createdByAccountId: accountId,
        expiresAt: new Date(Date.now() + 7 * 86400000),
      },
    });
    await audit(tx, accountId, org.id, "INVITATION_CREATED", invitation.id, {
      role: input.role,
      propertyId: property.id,
    });
    return invitation;
  });
  // Return once for explicit user sharing; never log the invitation secret.
  return {
    code,
    id: invitation.id,
    expiresAt: invitation.expiresAt,
    propertyName: property.name,
    role: input.role,
  };
}
export async function previewInvitation(accountId: string, code: string) {
  const account = await prisma.pgAccount.findUniqueOrThrow({
    where: { id: accountId },
  });
  const invitation = await prisma.pgInvitation.findUnique({
    where: { tokenHash: hash(code) },
    include: { property: true },
  });
  assert(
    account.phoneE164 &&
      invitation &&
      invitation.phoneE164 === account.phoneE164 &&
      invitation.status === "PENDING" &&
      invitation.expiresAt.getTime() > Date.now(),
    404,
    "INVITATION_UNAVAILABLE",
    "This invitation is unavailable for your verified phone number. Ask your owner for a fresh invitation.",
  );
  return {
    id: invitation.id,
    property: { name: invitation.property.name, id: invitation.property.id },
    role: invitation.role,
    permissions: invitation.permissions,
    expiresAt: invitation.expiresAt,
  };
}
export async function acceptInvitation(accountId: string, code: string) {
  return atomic(async (tx) => {
    const account = await tx.pgAccount.findUniqueOrThrow({
      where: { id: accountId },
    });
    const invitation = await tx.pgInvitation.findUnique({
      where: { tokenHash: hash(code) },
      include: { organisation: true },
    });
    assert(
      account.phoneE164 &&
        invitation &&
        invitation.phoneE164 === account.phoneE164 &&
        invitation.expiresAt.getTime() > Date.now(),
      404,
      "INVITATION_UNAVAILABLE",
      "This invitation is unavailable for your verified phone number.",
    );
    if (invitation.status === "ACCEPTED") {
      assert(
        invitation.acceptedByAccountId === accountId,
        409,
        "INVITATION_USED",
        "This invitation has already been accepted.",
      );
      return tx.pgMembership.findUniqueOrThrow({
        where: {
          accountId_propertyId_role: {
            accountId,
            propertyId: invitation.propertyId,
            role: invitation.role,
          },
        },
      });
    }
    assert(
      invitation.status === "PENDING",
      409,
      "INVITATION_USED",
      "Ask your owner for a new invitation.",
    );
    let actorUserId: string | null = null;
    if (invitation.role === "RESIDENT") {
      const student = await tx.student.findFirst({
        where: {
          id: invitation.studentId || "",
          propertyId: invitation.propertyId,
          status: "ACTIVE",
        },
      });
      assert(
        student &&
          `+91${student.mobile.replace(/\D/g, "").slice(-10)}` ===
            account.phoneE164,
        409,
        "RESIDENCY_CHANGED",
        "Your residency has changed. Contact your owner.",
      );
      const claim = await tx.pgMembership.findFirst({
        where: {
          actorUserId: student.userId,
          status: "ACTIVE",
          accountId: { not: accountId },
        },
      });
      const linked = await tx.pgAccount.findUnique({
        where: { legacyUserId: student.userId },
      });
      assert(
        !claim && (!linked || linked.id === accountId),
        409,
        "RESIDENCY_ALREADY_LINKED",
        "This resident account is already linked. Use account recovery.",
      );
      actorUserId = student.userId;
    }
    assert(
      invitation.role === "RESIDENT" || invitation.role === "STAFF",
      403,
      "INVALID_ROLE",
      "This invitation cannot grant owner access.",
    );
    const updated = await tx.pgInvitation.updateMany({
      where: { id: invitation.id, status: "PENDING" },
      data: {
        status: "ACCEPTED",
        acceptedByAccountId: accountId,
        acceptedAt: new Date(),
      },
    });
    assert(
      updated.count === 1,
      409,
      "INVITATION_USED",
      "This invitation has already been accepted.",
    );
    const membership = await tx.pgMembership.upsert({
      where: {
        accountId_propertyId_role: {
          accountId,
          propertyId: invitation.propertyId,
          role: invitation.role,
        },
      },
      create: {
        accountId,
        organisationId: invitation.organisationId,
        propertyId: invitation.propertyId,
        role: invitation.role,
        actorUserId,
        permissions: invitation.permissions,
      },
      update: {
        status: "ACTIVE",
        actorUserId,
        permissions: invitation.permissions,
      },
    });
    await audit(
      tx,
      accountId,
      invitation.organisationId,
      "INVITATION_ACCEPTED",
      invitation.id,
      { membershipId: membership.id },
    );
    return membership;
  });
}
