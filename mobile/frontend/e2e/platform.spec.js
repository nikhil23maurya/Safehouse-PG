import { test, expect } from "@playwright/test";
import { setup, go, noOverflow } from "./helpers.js";
import fs from "node:fs/promises";

async function platform(page) {
  await page.addInitScript(() => {
    window.__platformVault = null;
    window.SafeHouseNative = {
      getPackageId: () => "com.safehouse.pg.testing",
      ready: () => {},
      getSession: () =>
        window.__platformVault ? JSON.stringify(window.__platformVault) : null,
      saveSession: (raw) => {
        window.__platformVault = raw ? JSON.parse(raw) : null;
        return true;
      },
      startPhoneSignIn: (_config, _phone, attempt) =>
        setTimeout(() => window.PGOnePhoneEvent(attempt, "sent", ""), 100),
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
        entitled: false,
        legacyAccess: false,
        configured: false,
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
  };
}
async function phoneLogin(page) {
  await page
    .getByRole("button", { name: "Continue with mobile number" })
    .click();
  await page.getByLabel("Mobile number").fill("9123456789");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
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
  await page.getByRole("button", { name: "I already have an account" }).click();
  await capture("login");
  await page
    .getByRole("button", { name: "Continue with mobile number" })
    .click();
  await capture("phone");
  await page.getByLabel("Mobile number").fill("9123456789");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
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
  await expect(
    page.getByRole("heading", { name: "Maple House is ready." }),
  ).toBeVisible();
  await capture("ready");
  expect(fixture.propertiesCreated).toBe(1);
  await go(page, "subscription");
  await capture("plan");
  await expect(
    page.getByRole("button", { name: /buy|subscribe|pay now|upgrade/i }),
  ).toHaveCount(0);
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
      /Phone sign-in is awaiting activation|Account services could not be reached/,
    ),
  ).toBeVisible();
  await page.getByLabel("Mobile number").fill("9123456789");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.locator(".form-error")).toContainText("not activated");
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
