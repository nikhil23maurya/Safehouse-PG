import { prisma } from "../db.js";
import { assert } from "../errors.js";
import { atomic, audit, ownerOrganisation } from "./service.js";
import { hash, randomCode } from "./tokens.js";
import { entitlement } from "./billing.js";
import { STAFF_PERMISSIONS } from "./config.js";

export async function createInvitation(
  accountId: string,
  input: {
    organisationId: string;
    propertyId: string;
    role: "RESIDENT" | "STAFF";
    email: string;
    studentId?: string;
    permissions: string[];
  },
) {
  const org = await ownerOrganisation(accountId, input.organisationId);
  assert(await entitlement(org.id),402,"SUBSCRIPTION_REQUIRED","Activate PGOne before inviting members.");
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
    const actor = await prisma.user.findUniqueOrThrow({where:{id:student.userId}});
    assert(actor.email?.trim().toLowerCase() === input.email.trim().toLowerCase(),400,"EMAIL_MISMATCH","Use the resident email recorded on this property.");
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
        email: input.email.trim().toLowerCase(),
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
    account.credentialEmail &&
      invitation &&
      invitation.email === account.credentialEmail &&
      ["PENDING","REQUESTED"].includes(invitation.status) &&
      invitation.expiresAt.getTime() > Date.now(),
    404,
    "INVITATION_UNAVAILABLE",
    "This invitation is unavailable for your confirmed email address. Ask your owner for a fresh invitation.",
  );
  return {
    id: invitation.id,
    property: { name: invitation.property.name, id: invitation.property.id },
    role: invitation.role,
    permissions: invitation.permissions,
    expiresAt: invitation.expiresAt,
  };
}
export async function acceptInvitation(accountId: string, code: string, approval?: {ownerAccountId:string;invitationId:string}) {
  return atomic(async (tx) => {
    const account = await tx.pgAccount.findUniqueOrThrow({
      where: { id: accountId },
    });
    const invitation = await tx.pgInvitation.findUnique({
      where: approval ? {id:approval.invitationId} : { tokenHash: hash(code) },
      include: { organisation: true },
    });
    assert(
      account.credentialEmail &&
        invitation &&
        invitation.email === account.credentialEmail &&
        invitation.expiresAt.getTime() > Date.now(),
      404,
      "INVITATION_UNAVAILABLE",
      "This invitation is unavailable for your confirmed email address.",
    );
    if (approval) {
      assert(invitation.organisation.ownerAccountId===approval.ownerAccountId && ["REQUESTED","ACCEPTED"].includes(invitation.status) && invitation.acceptedByAccountId===accountId,
        403,"APPROVAL_NOT_ALLOWED","This invitation request cannot be approved by this owner.");
    } else if (!account.emailVerified && invitation.status !== "ACCEPTED") {
      assert(["PENDING","REQUESTED"].includes(invitation.status) && (!invitation.acceptedByAccountId || invitation.acceptedByAccountId===accountId),
        409,"INVITATION_USED","Ask your owner for a new invitation.");
      await tx.pgInvitation.update({where:{id:invitation.id},data:{status:"REQUESTED",acceptedByAccountId:accountId}});
      await audit(tx,accountId,invitation.organisationId,"INVITATION_OWNER_APPROVAL_REQUESTED",invitation.id);
      return {pendingOwnerApproval:true,invitationId:invitation.id};
    }
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
      invitation.status === "PENDING" || Boolean(approval && invitation.status === "REQUESTED"),
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
      const actor = student ? await tx.user.findUnique({where:{id:student.userId}}) : null;
      assert(student && actor?.email?.trim().toLowerCase() === account.credentialEmail,
        409,"RESIDENCY_CHANGED","Your residency changed. Ask the owner for a new invitation.");
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
      where: { id: invitation.id, status: approval ? "REQUESTED" : "PENDING" },
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
