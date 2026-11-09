import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import {
  chromium,
  expect,
} from "../../mobile/frontend/node_modules/@playwright/test/index.mjs";
let browser, server, base;
before(async () => {
  browser = await chromium.launch({ headless: true });
  server = http.createServer(async (req, res) => {
    const name = req.url === "/" ? "index.html" : req.url.slice(1);
    if (
      !/^(index\.html|billing\.(js|css)|InterVariable\.woff2|ManropeVariable\.ttf|onboarding-payments\.webp)$/.test(
        name,
      )
    )
      return res.writeHead(404).end();
    try {
      const type = name.endsWith(".html")
        ? "text/html"
        : name.endsWith(".js")
          ? "application/javascript"
          : name.endsWith(".css")
            ? "text/css"
            : name.endsWith(".webp")
              ? "image/webp"
              : name.endsWith(".ttf")
                ? "font/ttf"
                : "font/woff2";
      res
        .writeHead(200, { "content-type": type })
        .end(await readFile(new URL(`dist/${name}`, import.meta.url)));
    } catch {
      res.writeHead(404).end();
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  await browser?.close();
  server?.close();
});
async function fixture(enabled) {
  const page = await browser.newPage({ viewport: { width: 393, height: 852 } });
  let activated = false,
    starts = 0,
    scripts = 0;
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route(
    "https://safehouse-api.onrender.com/api/**",
    async (route) => {
      const path = new URL(route.request().url()).pathname;
      let data;
      if (path.endsWith("/config"))
        data = {
          enabled: true,
          phone: null,
          customWebBilling: { enabled, keyId: "synthetic-test-key" },
          legal: {
            terms: "https://example.test/terms",
            privacy: "https://example.test/privacy",
          },
        };
      else if (path.endsWith("/login"))
        data = { tokens: { accessToken: "legacy-test" } };
      else if (path.endsWith("/link-legacy"))
        data = {
          tokens: {
            kind: "PLATFORM",
            accessToken: "pg1.test",
            refreshToken: "pg1.test.refresh",
          },
        };
      else if (path.endsWith("/session"))
        data = {
          account: {
            id: "account1",
            fullName: "Owner Test",
            email: "owner@example.test",
            phoneE164: "+919123456789",
          },
          user: { id: "account1", role: "ACCOUNT" },
          memberships: [
            {
              role: "OWNER",
              organisation: { id: "org1", name: "Maple House" },
            },
          ],
        };
      else if (path.endsWith("/authorise")) {
        starts++;
        data = {
          subscriptionId: "sub_Test01",
          keyId: "synthetic-test-key",
          amountPaise: 24900,
        };
      } else if (
        path.endsWith("/subscription") ||
        path.endsWith("/recheck") ||
        path.endsWith("/authorisation")
      ) {
        if (path.endsWith("/recheck")) activated = true;
        data = {
          entitled: activated,
          legacyAccess: false,
          renewalCycles: 12,
          subscription: activated
            ? {
                status: "ACTIVE",
                periodEnd: "2027-01-01",
                cancelAtPeriodEnd: true,
                payments: [],
              }
            : null,
        };
      } else if (path.endsWith("/logout")) data = { ok: true };
      else
        return route.fulfill({
          status: 404,
          json: { error: { message: "Test route missing" } },
        });
      await route.fulfill({
        json: data,
        headers: { "Access-Control-Allow-Origin": "*" },
      });
    },
  );
  await page.route("https://checkout.razorpay.com/v1/razorpay.js", (route) => {
    scripts++;
    return route.fulfill({
      contentType: "application/javascript",
      body: `window.Razorpay=class {constructor(){this.events={};window.__sdk=this}on(name,fn){this.events[name]=fn}checkPaymentAdapter(name){return name==='phonepe'?Promise.resolve():Promise.reject(new Error('Not available'))}createPayment(data,options){window.__payment={data,options};} }`,
    });
  });
  await page.goto(base);
  await page
    .getByText("Use an existing email account", { exact: true })
    .click();
  await page
    .getByLabel("Email address", { exact: true })
    .fill("owner@example.test");
  await page.getByLabel("Password", { exact: true }).fill("synthetic-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("button", { name: "Maple House", exact: true }).click();
  return {
    page,
    errors,
    get starts() {
      return starts;
    },
    get scripts() {
      return scripts;
    },
  };
}
test("separate web surface stays unavailable without custom merchant enablement", async () => {
  const f = await fixture(false);
  await expect(
    f.page.getByText(
      "Subscription purchases are awaiting merchant activation.",
      { exact: false },
    ),
  ).toBeVisible();
  assert.equal(f.scripts, 0);
  assert.equal(f.starts, 0);
  await expect(
    f.page.getByRole("button", { name: "Prepare UPI authorisation" }),
  ).toHaveCount(0);
  assert.deepEqual(f.errors, []);
  await f.page.close();
});
test("custom SDK authorisation remains pending until a server-confirmed paid period", async () => {
  const f = await fixture(true),
    page = f.page;
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Prepare UPI authorisation" }).click();
  await page.getByRole("button", { name: "PhonePe", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "PhonePe", exact: true }),
  ).toBeDisabled();
  const payload = await page.evaluate(() => window.__payment);
  assert.equal(payload.data.subscription_id, "sub_Test01");
  assert.equal(payload.data.amount, 24900);
  assert.equal(payload.data.method, "upi");
  assert.equal(f.starts, 1);
  await page.evaluate(() =>
    window.__sdk.events["payment.success"]({
      razorpay_payment_id: "pay_Test01",
      razorpay_signature: "synthetic-signature",
    }),
  );
  await expect(page.locator("#billing-message")).toContainText(
    "still being verified",
  );
  await expect(
    page.getByText("Your access is active for the confirmed paid period.", {
      exact: true,
    }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Refresh payment status" }).click();
  await expect(
    page.getByText("Your access is active for the confirmed paid period.", {
      exact: true,
    }),
  ).toBeVisible();
  await mkdir(new URL("screenshots/", import.meta.url), { recursive: true });
  await page.screenshot({
    path: new URL("screenshots/web-plan.png", import.meta.url).pathname.replace(
      /^\/(\w:)/,
      "$1",
    ),
    fullPage: true,
  });
  assert.deepEqual(f.errors, []);
  await page.close();
});
