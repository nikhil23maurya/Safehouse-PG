// A server-authoritative owner entitlement snapshot, not a local "paid" toggle.
// The property and membership must both belong to the selected workspace.
export function ownerActivationRoute(snapshot, requested) {
  if (snapshot.tokens?.kind !== "PLATFORM" || snapshot.user?.role !== "OWNER") return requested;
  if (["subscription","workspaces","password","legal","enrolEmail","setupProfile","setupProperty","chooseRole"].includes(requested)) return requested;
  const membership = snapshot.platform?.memberships?.find((m) =>
    m.id === snapshot.platform?.membershipId &&
    m.role === "OWNER" &&
    m.property?.id === snapshot.property?.id
  );
  // Never grant operational access on a missing, stale, or incomplete entitlement snapshot.
  if (!membership || membership.organisation?.entitled !== true) return "subscription";
  return requested;
}

export function ownerHasPaidAccess(snapshot) {
  return ownerActivationRoute(snapshot, "ownerHome") === "ownerHome";
}
