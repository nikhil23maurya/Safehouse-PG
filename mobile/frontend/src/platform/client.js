export const onboarding = {
  config: null,
  phone: "",
  attempt: "",
  sentAt: 0,
  error: "",
  intent: "OWNER",
  authMode: "SIGN_UP",
  propertyKey: null,
};
export async function platformConfig(ctx) {
  if (onboarding.config) return onboarding.config;
  try {
    return (onboarding.config = await ctx.api(
      `/api/platform/config?package=${encodeURIComponent(ctx.native.call("getPackageId") || "web")}`,
      { public: true, timeout: 10000 },
    ));
  } catch {
    return { enabled: false, phone: null, legal: {}, unavailable: true };
  }
}
export function platformStart(snapshot) {
  if (!snapshot.platform?.account?.fullName?.trim()) return "chooseRole";
  if (snapshot.platform?.memberships?.length) return "workspaces";
  return snapshot.platform?.account?.setupIntent === "OWNER"
    ? "setupProperty"
    : "joinWorkspace";
}
export function organisation(snapshot) {
  return (
    snapshot.platform?.memberships?.find(
      (m) => m.id === snapshot.platform.membershipId,
    )?.organisation || null
  );
}
export function requestId() {
  return Array.from(crypto.getRandomValues(new Uint8Array(20)), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}
