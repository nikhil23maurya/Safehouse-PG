// Synthetic UI fixtures. Built only into the separate instrumentation test APK.
export function createPlatformFixtures() {
  const account = {
    id: "pg-account-1",
    fullName: "",
    phoneE164: "+919123456789",
    email: null,
    emailVerified: false,
    setupIntent: null,
  };
  const memberships = [];
  let selected = null;
  let propertiesCreated = 0;
  const merchant = { enabled: false, started: false, bank: null };
  const tokens = () => ({
    kind: "PLATFORM",
    accessToken: `pg1.test.${selected || "account"}`,
    refreshToken: "pg1.test.refresh",
  });
  const snapshot = () => ({
    account,
    memberships,
    membershipId: selected,
    property: selected ? memberships[0].property : null,
    student: null,
    user: {
      id: "owner1",
      fullName: account.fullName,
      email: account.email,
      role: selected ? "OWNER" : "ACCOUNT",
      mustChangePassword: false,
    },
  });
  return {
    merchant,
    get propertiesCreated() {
      return propertiesCreated;
    },
    handler(url, body) {
      const path = new URL(url).pathname;
      if (path.includes("/merchant/")) {
        if (!merchant.enabled) throw new Error("Synthetic merchant feature is disabled");
        if (path.endsWith("/profile")) merchant.started = true;
        if (path.endsWith("/bank")) merchant.bank = { last4: body.accountNumber.slice(-4), status: "SUBMITTED" };
        return { status: "KYC_REQUIRED" };
      }
      if (path.endsWith("/config"))
        return {
          enabled: true,
          phone: { projectId: "synthetic-test-project" },
          legal: {
            terms: "https://example.test/terms",
            privacy: "https://example.test/privacy",
          },
        };
      if (path.endsWith("/phone")) return { tokens: tokens() };
      if (path.endsWith("/session")) return snapshot();
      if (path.endsWith("/profile")) {
        Object.assign(account, {
          fullName: body.fullName,
          email: body.email,
          setupIntent: body.intent,
        });
        return snapshot();
      }
      if (path.endsWith("/properties")) {
        if (!memberships.length) {
          propertiesCreated++;
          memberships.push({
            id: "membership1",
            role: "OWNER",
            organisation: { id: "org1", name: body.name, legacyAccess: false },
            property: {
              id: "property1",
              name: body.name,
              timezone: "Asia/Kolkata",
              currency: "INR",
            },
          });
        }
        return { ...snapshot(), property: memberships[0].property };
      }
      if (path.endsWith("/workspace")) {
        selected = body.membershipId;
        return { tokens: tokens() };
      }
      if (path.endsWith("/subscription"))
        return {
          entitled: false,
          legacyAccess: false,
          configured: false,
          mode: "MANUAL_MONTHLY",
          recurring: false,
          tax: null,
          subscription: null,
        };
      if (path.endsWith("/merchant"))
        return {
          status: merchant.started ? "KYC_REQUIRED" : "NOT_CONNECTED",
          bank: null,
          bankSubmission: merchant.bank,
          setupStarted: merchant.started,
          environment: "LIVE",
          message:
            "Online payment setup is awaiting payment-provider activation.",
          onboardingAvailable: merchant.enabled,
        };
      if (path.endsWith("/invitations")) return { invitations: [] };
      if (path.endsWith("/members")) return { members: [] };
      if (path.endsWith("/logout")) return { ok: true };
      throw new Error(`Unimplemented synthetic platform request: ${path}`);
    },
  };
}
