import { expect } from "@playwright/test";
import { createFixtures } from "./fixtures.mjs";
import fs from "node:fs/promises";

export async function setup(page) {
  const fixtures = createFixtures();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route(
    "https://safehouse-api.onrender.com/api/**",
    async (route) => {
      const req = route.request();
      let body = {};
      try {
        body = req.postDataJSON() || {};
      } catch {
        /* GET/PDF requests */
      }
      const result = fixtures.handler({
        url: req.url(),
        method: req.method(),
        headers: req.headers(),
        body,
      });
      await route.fulfill({
        status: result.status,
        contentType: result.contentType || "application/json",
        body: result.contentType ? result.data : JSON.stringify(result.data),
        headers: { "Access-Control-Allow-Origin": "*" },
      });
    },
  );
  await page.route("https://rzp.io/i/fixture", async (route) =>
    route.fulfill({
      status: 200,
      contentType: "image/png",
      body: await fs.readFile(
        new URL("../test-support/qr-fixture.png", import.meta.url),
      ),
    }),
  );
  await page.goto("/");
  return { ...fixtures, errors };
}
export async function login(page, role = "OWNER") {
  await page
    .getByLabel("Email address")
    .fill(role === "OWNER" ? "owner@example.test" : "resident@example.test");
  await page.getByLabel("Password", { exact: true }).fill("FixturePass123!");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveTitle(
    new RegExp(role === "OWNER" ? "^Home" : "^Home"),
  );
  await expect(page.locator(".financial-summary")).toBeVisible();
}
export async function go(page, name, params = {}) {
  await page.evaluate(
    ({ name, params }) => {
      const record = { safehouse: true, name, params, depth: 1 };
      history.pushState(record, "", `#${name}`);
      window.dispatchEvent(new PopStateEvent("popstate", { state: record }));
    },
    { name, params },
  );
  await expect(page.locator(".page-progress")).toHaveCount(0);
  await expect(page).toHaveURL(new RegExp(`#${name}$`));
  await expect(page.locator("#app")).toHaveAttribute("data-screen", name);
  await page.waitForFunction(
    () =>
      !document.querySelector(".page-progress") &&
      !!document.querySelector("h1"),
  );
}
export async function noOverflow(page) {
  const overflow = await page.evaluate(() => ({
    width: innerWidth,
    body: document.documentElement.scrollWidth,
    escaped: [
      ...document.querySelectorAll(
        "button,input,select,textarea,.card,.list,.app-header",
      ),
    ]
      .filter((el) => {
        const r = el.getBoundingClientRect();
        return (
          r.width &&
          (r.left < -1 || r.right > innerWidth + 1) &&
          !el.closest(".filter-row")
        );
      })
      .map((el) => `${el.tagName}.${el.className}`)
      .slice(0, 10),
  }));
  expect(overflow.body, JSON.stringify(overflow)).toBeLessThanOrEqual(
    overflow.width + 1,
  );
  expect(overflow.escaped).toEqual([]);
}
