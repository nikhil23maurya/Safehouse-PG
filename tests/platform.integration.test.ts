import test, { after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
process.env.PGONE_PLATFORM_ENABLED = "true";
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
const { entitlement } = await import("../src/platform/billing.js");
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
  const revoked = await request(
    `/api/platform/memberships/${staff.id}/revoke`,
    ownerTokens.accessToken,
    {},
  );
  assert.equal(revoked.status, 200);
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
