import test from "node:test";
import assert from "node:assert/strict";
import { ownerActivationRoute, ownerHasPaidAccess } from "../src/platform/activation.js";

const owner = (entitled, extras = {}) => ({
  tokens: { kind: "PLATFORM" },
  user: { role: "OWNER" },
  property: { id: "p1" },
  platform: {
    membershipId: "m1",
    memberships: [{ id: "m1", role: "OWNER", property: { id: "p1" },
      organisation: { id: "o1", entitled } }],
  },
  ...extras,
});
test("unpaid owners cannot navigate to operational screens", () => {
  for (const route of ["ownerHome", "residents", "rooms", "ownerPayments", "profile"]) {
    assert.equal(ownerActivationRoute(owner(false), route), "subscription");
  }
  assert.equal(ownerHasPaidAccess(owner(false)), false);
});
test("verified paid owners and grandfathered entitlements can navigate", () => {
  assert.equal(ownerActivationRoute(owner(true), "ownerHome"), "ownerHome");
  assert.equal(ownerActivationRoute(owner(true), "rooms"), "rooms");
  assert.equal(ownerHasPaidAccess(owner(true)), true);
});
test("missing or stale workspace state never unlocks owner dashboard", () => {
  assert.equal(ownerActivationRoute(owner(undefined), "ownerHome"), "subscription");
  assert.equal(ownerActivationRoute(owner(true, { property: { id: "other" } }), "ownerHome"), "subscription");
  assert.equal(ownerActivationRoute(owner(true, { platform: { membershipId: "missing", memberships: [] } }), "ownerHome"), "subscription");
});
test("resident, staff and historical password sessions are not put behind owner checkout", () => {
  assert.equal(ownerActivationRoute(owner(false, { user: { role: "STUDENT" } }), "studentHome"), "studentHome");
  assert.equal(ownerActivationRoute(owner(false, { user: { role: "STAFF" } }), "staffHome"), "staffHome");
  assert.equal(ownerActivationRoute(owner(false, { tokens: { kind: "LEGACY" } }), "ownerHome"), "ownerHome");
});
