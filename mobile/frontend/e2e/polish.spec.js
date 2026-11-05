import { test, expect } from "@playwright/test";
import { setup, login, noOverflow } from "./helpers.js";

async function nativePayment(page) {
  await page.addInitScript(() => {
    window.__upiCalls = [];
    window.__savedQr = [];
    window.SafeHouseNative = {
      openQrInUpiApp: (...args) => window.__upiCalls.push(args),
      savePaymentQr: (...args) => window.__savedQr.push(args),
    };
  });
  const fixture = await setup(page);
  await login(page, "STUDENT");
  await page.getByRole("button", { name: "Pay rent", exact: true }).click();
  await expect(page.getByAltText("Verified provider-issued rent payment QR")).toBeVisible();
  return fixture;
}

test("login uses bundled Inter with readable compact hierarchy and a reachable keyboard action", async ({ page }) => {
  await setup(page);
  await page.evaluate(() => document.fonts.ready);
  await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
  expect(await page.evaluate(() => document.fonts.check('500 16px "Inter"'))).toBe(true);
  const title = await page.locator(".login-heading h1").evaluate(el => ({
    font: getComputedStyle(el).fontFamily,
    size: parseFloat(getComputedStyle(el).fontSize),
    height: el.getBoundingClientRect().height,
  }));
  expect(title.font).toContain("Inter");
  expect(title.size).toBeLessThanOrEqual(30);
  expect(title.height).toBeLessThan(45);
  await page.setViewportSize({ width: 393, height: 530 });
  await page.getByLabel("Password", { exact: true }).focus();
  await page.evaluate(() => window.SafeHouseKeyboard(true));
  await expect.poll(() => page.getByRole("button", { name: "Sign in", exact: true }).evaluate(el => el.getBoundingClientRect().bottom <= innerHeight)).toBe(true);
  await noOverflow(page);
});

test("UPI handoff is single flight, keeps exact provider context and never credits app return", async ({ page }) => {
  await nativePayment(page);
  await page.getByRole("button", { name: "Pay with a UPI app" }).click();
  await expect(page.getByRole("button", { name: "Opening UPI app…" })).toBeDisabled();
  await page.evaluate(() => document.querySelector('[data-action="upi"]').click());
  await expect.poll(() => page.evaluate(() => window.__upiCalls.length)).toBe(1);
  const [source, amount, expiry] = await page.evaluate(() => window.__upiCalls[0]);
  expect(source).toBe("https://rzp.io/i/fixture");
  expect(amount).toBe(850099);
  expect(expiry * 1000).toBeGreaterThan(Date.now());
  await page.evaluate(() => window.SafeHouseUpiOpened());
  await expect(page.getByRole("button", { name: "Pay with a UPI app" })).toBeEnabled();
  await expect(page.getByRole("heading", { name: "Payment Successful" })).toHaveCount(0);
  await page.evaluate(() => window.SafeHouseResume());
  await expect(page.getByRole("heading", { name: "Payment Successful" })).toHaveCount(0);
});

test("missing UPI app shows a useful fallback and saves the same invoice-linked QR", async ({ page }) => {
  await nativePayment(page);
  await page.getByRole("button", { name: "Pay with a UPI app" }).click();
  await expect.poll(() => page.evaluate(() => window.__upiCalls.length)).toBe(1);
  await page.evaluate(() => window.SafeHouseUpiError("No compatible UPI app is installed. Save this QR and scan it from your UPI app gallery, or use another phone."));
  await expect(page.locator(".upi-help")).toContainText("No compatible UPI app");
  await page.getByRole("button", { name: "Save QR", exact: true }).click();
  expect(await page.evaluate(() => window.__savedQr)).toEqual([["https://rzp.io/i/fixture", 850099]]);
  await expect(page.getByRole("heading", { name: "Payment Successful" })).toHaveCount(0);
});

test("pending reconciliation keeps the QR node and focused status action stable", async ({ page }) => {
  await nativePayment(page);
  await page.evaluate(() => {
    window.__qrNode = document.querySelector("[data-payment-qr]");
    window.__statusNode = document.querySelector('[data-action="checkPayment"]');
  });
  const button = page.getByRole("button", { name: "Check payment status" });
  await button.focus();
  await button.click();
  await expect(button).toHaveAttribute("aria-disabled", "false");
  expect(await page.evaluate(() => window.__qrNode === document.querySelector("[data-payment-qr]"))).toBe(true);
  expect(await page.evaluate(() => window.__statusNode === document.querySelector('[data-action="checkPayment"]'))).toBe(true);
  await expect(button).toBeFocused();
  await expect(page.getByRole("heading", { name: "Payment Successful" })).toHaveCount(0);
});
