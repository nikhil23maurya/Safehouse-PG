import { test, expect } from "@playwright/test";
import { setup, go, noOverflow } from "./helpers.js";
import fs from "node:fs/promises";

async function platform(page) {
  await page.addInitScript(() => {
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
      startPhoneSignIn: (_config, _phone, attempt) => {
        window.__phoneSends++;
        setTimeout(() => window.PGOnePhoneEvent(attempt, "sent", ""), 100);
      },
      verifyPhoneCode: (_code, attempt) =>
        setTimeout(
          () =>
            window.PGOnePhoneEvent(
              attempt,
              "verified",
              "synthetic-test-provider-token",
            ),
          100,
        ),
      cancelPhoneSignIn: () => {},
    };
  });
  const fixtures = await setup(page);
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
        phone: { projectId: "synthetic-test-project" },
        legal: {
          terms: "https://example.test/terms",
          privacy: "https://example.test/privacy",
        },
      };
    else if (path.endsWith("/phone")) data = { tokens: tokens() };
    else if (path.endsWith("/session")) data = snapshot();
    else if (path.endsWith("/profile")) {
      Object.assign(account, {
        fullName: body.fullName,
        email: body.email,
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
        configured: false,
        mode: "MANUAL_MONTHLY",
        recurring: false,
        tax: null,
        subscription: null,
      };
    else if (path.endsWith("/merchant"))
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
  };
}
async function expectActivationRedirect(page, name) {
  await page.evaluate((route) => {
    const record = { safehouse: true, name: route, params: {}, depth: 1 };
    history.pushState(record, "", `#${route}`);
    window.dispatchEvent(new PopStateEvent("popstate", { state: record }));
  }, name);
  await expect(page).toHaveURL(/#subscription$/);
  await expect(page.locator("#app")).toHaveAttribute("data-screen", "subscription");
}

async function phoneLogin(page) {
  await go(page, "welcome");
  await page.getByRole("button", { name: "Create account", exact: true }).click();
  await page.getByLabel("Mobile number").fill("9123456789");
  await page
    .getByRole("button", { name: "Send verification code", exact: true })
    .click();
  await expect(
    page.getByText("Verification code sent.", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Resend code", exact: true }),
  ).toBeDisabled();
  await page.getByLabel("Verification code").fill("123456");
  await page.getByRole("button", { name: "Verify & continue" }).click();
  await expect(
    page.getByRole("heading", { name: "A place for everyone." }),
  ).toBeVisible();
}

test("Razorpay Route owner UPI setup requires verified SaaS access and provider approval", async ({page}) => {
  const fixture = await platform(page);
  const merchant = {
    provider:"RAZORPAY_ROUTE", onboardingAvailable:true, setupStarted:false,
    status:"NOT_CONNECTED", environment:"LIVE", bank:null,
    collectionEnabled:false, message:"Razorpay Route account verification required.",
  };
  let onboardingCalls = 0;
  await page.route("**/api/platform/organisations/*/merchant**", async route => {
    const path = new URL(route.request().url()).pathname;
    const body = route.request().postDataJSON() || {};
    if (path.endsWith("/route/onboard")) {
      onboardingCalls++;
      expect(body.consent).toBe(true);
      expect(body.pan).toBe("ABCDE1234F");
      expect(body.vpa).toBe("rahul@okhdfcbank");
      merchant.setupStarted = true;
      merchant.status = "UNDER_REVIEW";
    }
    return route.fulfill({json:merchant});
  });
  await phoneLogin(page);
  await page.getByRole("button",{name:"I manage a PG",exact:false}).click();
  await page.getByLabel("Full name").fill("Rahul Sharma");
  await page.getByLabel("Email address").fill("rahul@example.test");
  await page.getByRole("button",{name:"Continue",exact:true}).click();
  await page.getByLabel("PG name").fill("Maple House");
  await page.getByLabel("City",{exact:true}).fill("Bengaluru");
  await page.getByRole("button",{name:"Create my PG"}).click();
  await expect(page).toHaveURL(/#subscription$/);
  await expectActivationRedirect(page,"merchant"); // unpaid owner blocked
  fixture.activatePaid();
  await go(page,"workspaces");
  await page.getByRole("button",{name:/Maple House/}).click();
  await expect(page).toHaveURL(/#ownerHome$/);
  await go(page,"merchant");
  await expect(page.getByText(/Razorpay/).first()).toBeVisible();
  await page.getByRole("button",{name:"Set up Razorpay owner account"}).click();
  await expect(page).toHaveURL(/#merchantProfile$/);
  await expect(page.getByLabel("Legal PAN and UPI account-holder name")).toHaveValue("Rahul Sharma");
  await page.getByLabel("PAN number").fill("ABCDE1234F");
  await page.getByLabel("Owner settlement UPI ID").fill("rahul@okhdfcbank");
  await page.getByLabel("Business type").selectOption("individual");
  await page.getByRole("button",{name:"Verify with Razorpay"}).click();
  expect(onboardingCalls).toBe(0, "missing explicit consent must block provider submission");
  await page.getByRole("checkbox").check();
  await page.getByRole("button",{name:"Verify with Razorpay"}).click();
  await expect(page).toHaveURL(/#merchant$/);
  expect(onboardingCalls).toBe(1);
  expect(merchant.collectionEnabled).toBe(false, "a form or return must not enable rent");
  const vault = JSON.stringify(await page.evaluate(()=>window.__platformVault));
  expect(vault).not.toContain("ABCDE1234F");
  expect(vault).not.toContain("rahul@okhdfcbank");
  merchant.status = "APPROVED";
  merchant.collectionEnabled = true;
  await go(page,"workspaces");
  await go(page,"merchant");
  await expect(page.getByText("ROUTED PAYMENTS ENABLED")).toBeVisible();
});

test("sign-in never creates an unknown account without explicit confirmation or sends a second OTP", async ({ page }) => {
  await platform(page);
  const modes = [];
  await page.route("**/api/platform/phone", async (route) => {
    const mode = route.request().postDataJSON().mode;
    modes.push(mode);
    if (mode === "SIGN_IN")
      return route.fulfill({ status: 404, json: { error: { code: "PHONE_ACCOUNT_NOT_FOUND", message: "No phone account yet." } } });
    return route.fulfill({ json: { tokens: { kind: "PLATFORM", accessToken: "pg1.test.account", refreshToken: "pg1.test.refresh" } } });
  });
  await go(page, "welcome");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByLabel("Mobile number").fill("9123456789");
  await page.getByRole("button", { name: "Send verification code", exact: true }).click();
  await page.getByText("Verification code sent.", { exact: true }).waitFor();
  await page.getByLabel("Verification code").fill("123456");
  await page.getByRole("button", { name: "Verify & continue" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: "Create a PGOne account?" })).toBeVisible();
  expect(modes).toEqual(["SIGN_IN"]);
  await dialog.getByRole("button", { name: "Back to sign in", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Sign in to PGOne." })).toBeVisible();
  expect(modes).toEqual(["SIGN_IN"]);

  await page.getByRole("button", { name: "Send verification code", exact: true }).click();
  await page.getByText("Verification code sent.", { exact: true }).waitFor();
  await page.getByLabel("Verification code").fill("123456");
  await page.getByRole("button", { name: "Verify & continue" }).click();
  await dialog.getByRole("button", { name: "Create account", exact: true }).click();
  await expect(page.getByRole("heading", { name: "A place for everyone." })).toBeVisible();
  expect(modes).toEqual(["SIGN_IN", "SIGN_IN", "SIGN_UP"]);
  expect(await page.evaluate(() => window.__phoneSends)).toBe(2);
});
test("phone onboarding, real controls, saved property and restored workspace", async ({
  page,
}) => {
  const fixture = await platform(page);
  const directory = "visual-evidence/platform";
  await fs.mkdir(directory, { recursive: true });
  const capture = async (name) => {
    await page.evaluate(() => document.fonts.ready);
    await noOverflow(page);
    await page.screenshot({ path: `${directory}/${name}.png`, fullPage: true });
  };
  await go(page, "welcome");
  await capture("welcome");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page
    .getByRole("button", { name: "Use email & password", exact: true })
    .click();
  await capture("login");
  await page
    .getByRole("button", { name: "Continue with mobile number" })
    .click();
  await expect(page.getByRole("heading", { name: "Sign in to PGOne." })).toBeVisible();
  await page.getByRole("button", { name: "New here? Create account", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Create your PGOne account." })).toBeVisible();
  await capture("phone");
  await page.getByLabel("Mobile number").fill("9123456789");
  await page
    .getByRole("button", { name: "Send verification code", exact: true })
    .click();
  await expect(
    page.getByText("Verification code sent.", { exact: true }),
  ).toBeVisible();
  await capture("otp");
  await page.getByLabel("Verification code").fill("123456");
  await page.getByRole("button", { name: "Verify & continue" }).click();
  await expect(page).toHaveURL(/#chooseRole$/);
  await capture("roles");
  await page
    .getByRole("button", { name: "I manage a PG", exact: false })
    .click();
  await capture("owner-profile");
  await expect(page.getByLabel("Verified mobile number")).toHaveValue(
    "+919123456789",
  );
  await expect(page.getByLabel("Verified mobile number")).toHaveAttribute(
    "readonly",
    "",
  );
  await page.getByLabel("Full name").fill("Rahul Sharma");
  await page.getByLabel("Email address").fill("rahul@example.test");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page).toHaveURL(/#setupProperty$/);
  await capture("create-pg");
  await page.getByLabel("PG name").fill("Maple House");
  await page.getByLabel("City", { exact: true }).fill("Bengaluru");
  await page.getByLabel("Approximate number of rooms").fill("12");
  await page.getByRole("button", { name: "Create my PG" }).click();
  await expect(page).toHaveURL(/#subscription$/);
  await expect(page.getByRole("heading", { name: "Your PG is ready. One last step." })).toBeVisible();
  await capture("unpaid-activation");
  await expectActivationRedirect(page, "ownerHome"); // Dashboard must stay locked.
  expect(fixture.propertiesCreated).toBe(1);
  await expect(page.getByText("One payment covers one calendar month", { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: "Cancel renewal", exact: true })).toHaveCount(0);
  await capture("plan");
  await expect(
    page.getByRole("button", { name: /buy|subscribe|pay now|upgrade/i }),
  ).toHaveCount(0);
  await expectActivationRedirect(page, "merchant");
  fixture.activatePaid();
  await go(page, "workspaces");
  await page.getByRole("button",{name:/Maple House/}).click();
  await expect(page).toHaveURL(/#ownerHome$/);
  await go(page, "setupReady");
  await expect(page.getByRole("heading", { name: "Maple House is ready." })).toBeVisible();
  await capture("ready");
  await go(page, "merchant");
  await capture("merchant");
  await expect(
    page.locator('input[name*="bank"],input[name*="pan"]'),
  ).toHaveCount(0);
  await go(page, "invitations");
  await capture("invitations");
  await go(page, "workspaces");
  await capture("workspaces");
  const saved = await page.evaluate(() => window.__platformVault);
  await page.addInitScript((value) => {
    window.__platformVault = value;
  }, saved);
  await page.reload();
  await expect(page).toHaveURL(/#ownerHome$/);
  expect(fixture.errors).toEqual([]);
});
test("phone capability unavailable is honest and existing login stays accessible", async ({
  page,
}) => {
  const fixture = await setup(page);
  await page
    .getByRole("button", { name: "Continue with mobile number" })
    .click();
  await expect(
    page.getByText(
      /Phone sign-in is awaiting activation|The updated account service is not available yet/,
    ),
  ).toBeVisible();
  await page.getByLabel("Mobile number").fill("9123456789");
  await expect(
    page.getByRole("button", { name: "Send verification code", exact: true }),
  ).toBeDisabled();
  await expect(page).toHaveURL(/#phone$/);
  await page.getByRole("button", { name: "Use email & password" }).click();
  await expect(page.getByLabel("Email address")).toBeVisible();
  expect(fixture.errors).toEqual([]);
});
test("resident and staff role choices use short invitation flows without owner access", async ({
  page,
}) => {
  const fixture = await platform(page);
  await phoneLogin(page);
  await page
    .getByRole("button", { name: "I live in a PG", exact: false })
    .click();
  await page.getByLabel("Full name").fill("Resident Test");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page).toHaveURL(/#joinWorkspace$/);
  await expect(
    page.getByRole("button", { name: "Review invitation" }),
  ).toBeVisible();
  await page.evaluate(() => {
    history.pushState({ name: "ownerHome", depth: 1 }, "", "#ownerHome");
    dispatchEvent(new PopStateEvent("popstate", { state: history.state }));
  });
  await expect(page).toHaveURL(/#joinWorkspace$/);
  expect(fixture.propertiesCreated).toBe(0);
});
