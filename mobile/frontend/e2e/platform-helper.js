import { test, expect } from "@playwright/test";
import { setup, go, noOverflow } from "./helpers.js";
import fs from "node:fs/promises";

export async function platform(page, { billing = false } = {}) {
  await page.addInitScript((enableBilling) => {
    window.__platformVault = null;
    window.__phoneSends = 0;
    window.SafeHouseNative = {
      getPackageId: () => "com.safehouse.pg.testing",
      ready: () => {},
      getSession: () =>
        window.__platformVault ? JSON.stringify(window.__platformVault) : null,
      saveSession: (raw) => {
        window.__platformVault = raw ? JSON.parse(raw) : null;
        return true;
      },
      ...(enableBilling ? { openPlanRazorpayUpi: (raw) => {
        window.__lastPlanOptions = JSON.parse(raw);
      } } : {}),
    };
  }, billing);
  const fixtures = await setup(page);
  const account = {
    id: "pg-account-1",
    fullName: "",
    phoneE164: "+919123456789",
    email: null,
    credentialReady:true,
    emailVerified: false,
    setupIntent: null,
  };
  const memberships = [];
  let selected = null;
  let propertiesCreated = 0;
  let paid = false;
  const tokens = () => ({
    kind: "PLATFORM",
    accessToken: `pg1.test.${selected || "account"}`,
    refreshToken: "pg1.test.refresh",
  });
  const snapshot = () => ({
    account,
    memberships: memberships.map(m => ({ ...m, organisation: { ...m.organisation, entitled: paid } })),
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
  await page.route("**/api/platform/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const body = route.request().postDataJSON() || {};
    let data;
    if (path.endsWith("/config"))
      data = {
        enabled: true,
        androidBilling: billing ? "CUSTOM_UPI_INTENT" : "NOT_CONFIGURED",
        authentication:"EMAIL_PASSWORD",phone:null,recoveryAvailable:true,
        legal: {
          terms: "https://example.test/terms",
          privacy: "https://example.test/privacy",
        },
      };
    else if (path.endsWith("/register") || path.endsWith("/login")) { account.email=body.email; data={tokens:tokens()}; }
    else if (path.endsWith("/forgot-password")) data={ok:true,message:"If this email has an eligible account, a recovery link will arrive shortly."};
    else if (path.endsWith("/logout")) data={ok:true};
    else if (path.endsWith("/session")) data = snapshot();
    else if (path.endsWith("/profile")) {
      Object.assign(account, {
        fullName: body.fullName,
        contactPhone: body.contactPhone,
        setupIntent: body.intent,
      });
      data = snapshot();
    } else if (path.endsWith("/properties")) {
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
      data = { ...snapshot(), property: memberships[0].property };
    } else if (path.endsWith("/workspace")) {
      selected = body.membershipId;
      data = { tokens: tokens() };
    } else if (path.endsWith("/subscription"))
      data = {
        entitled: paid,
        legacyAccess: false,
        configured: billing,
        mode: "MANUAL_MONTHLY",
        recurring: false,
        tax: null,
        subscription: null,
      };
    else if (path.endsWith("/plan/android/orders")) {
       expect(billing).toBe(true);
       expect(body).toMatchObject({ accepted:true, amountPaise:24900, recurring:false });
       expect(body.requestKey.length).toBeGreaterThanOrEqual(16);
       data = { id:"pg-plan-order-one", orderId:"order_SYNTHETIC001", keyId:"rzp_test_SYNTHETIC001",
         amountPaise:24900, currency:"INR", recurring:false, payable:true };
     } else if (path.endsWith("/subscription/recheck")) {
       data = { entitled: paid };
     } else if (path.endsWith("/merchant"))
      data = {
        status: "NOT_CONNECTED",
        bank: null,
        message:
          "Online payment setup is awaiting payment-provider activation.",
        onboardingAvailable: false,
      };
    else if (path.endsWith("/members")) data = { members: [] };
    else if (path.endsWith("/invitations")) data = { invitations: [] };
    else
      return route.fulfill({
        status: 404,
        json: {
          error: { code: "NOT_FOUND", message: "Fixture route unavailable" },
        },
      });
    await route.fulfill({
      json: data,
      headers: { "Access-Control-Allow-Origin": "*" },
    });
  });
  await page.route("**/api/owner/students?**", (route) =>
    route.fulfill({
      json: {
        students: [
          {
            id: "resident1",
            name: "Ananya Rao",
            mobile: "9123456780",
            status: "ACTIVE",
          },
        ],
      },
    }),
  );
  return {
    ...fixtures,
    get propertiesCreated() {
      return propertiesCreated;
    },
    activatePaid() { paid = true; },
    get entitled() { return paid; },
  };
}
