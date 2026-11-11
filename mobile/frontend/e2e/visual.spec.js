import { test, expect } from "@playwright/test";
import { setup, login, go, noOverflow } from "./helpers.js";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";

for (const [width, height] of [
  [360, 800],
  [393, 852],
  [412, 915],
  [480, 960],
]) {
  test(`screen inventory at ${width}x${height}`, async ({ page }) => {
    test.setTimeout(150000);
    await page.setViewportSize({ width, height });
    const fixture = await setup(page);
    const directory = fileURLToPath(
      new URL(`../visual-evidence/${width}x${height}`, import.meta.url),
    );
    await fs.mkdir(directory, { recursive: true });
    const capture = async (name) => {
      await expect.poll(() => page.evaluate(() => [...document.images].every(image => image.complete && image.naturalWidth > 0)), {message:"Every visible artwork asset must load"}).toBe(true);
      await noOverflow(page);
      await page.screenshot({
        path: `${directory}/${name}.png`,
        fullPage: true,
        animations: "disabled",
      });
      await page.screenshot({
        path: `${directory}/${name}-viewport.png`,
        animations: "disabled",
      });
    };
    await capture("01-login");
    await login(page);
    await capture("02-owner-home");
    const ownerScreens = [
      ["residents", {}, "03-residents"],
      ["resident", { id: "resident1" }, "04-resident"],
      ["residentRequests", {}, "05-resident-requests"],
      ["residentEdit", { id: "resident1" }, "06-edit-resident"],
      ["rooms", {}, "08-rooms"],
      ["room", { id: "room1" }, "09-room"],
      ["roomForm", {}, "10-add-room"],
      ["roomForm", { id: "room1" }, "11-edit-room"],
      ["dues", {}, "12-dues"],
      ["invoice", { id: "invoice1", residentId: "resident1" }, "13-invoice"],
      [
        "invoiceCharges",
        { id: "invoice1", residentId: "resident1" },
        "14-charges",
      ],
      [
        "manualPayment",
        { id: "invoice1", residentId: "resident1" },
        "15-record-payment",
      ],
      ["ownerPayments", {}, "16-owner-payments"],
      ["notifications", {}, "17-notifications"],
      ["notificationForm", {}, "18-compose"],
      ["notificationForm", { mode: "schedule" }, "19-schedule"],
      ["profile", {}, "20-owner-profile"],
      ["properties", {}, "21-properties"],
      ["propertyForm", {}, "22-add-property"],
      ["propertyForm", { edit: true }, "23-property-settings"],
      ["password", {}, "24-password"],
    ];
    for (const [route, params, name] of ownerScreens) {
      await go(page, route, params);
      await capture(name);
    }
    await go(page, "profile");
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await page.locator('[data-action="dialog-confirm"]').click();
    await expect(page).toHaveTitle(/^Sign in/);
    await login(page, "STUDENT");
    await capture("25-resident-home");
    for (const [route, params, name] of [
      ["invoices", {}, "26-invoices"],
      ["invoice", { id: "invoice1" }, "27-resident-invoice"],
      ["history", {}, "28-resident-payments"],
      ["notifications", {}, "29-resident-notifications"],
      ["profile", {}, "30-resident-profile"],
    ]) {
      await go(page, route, params);
      await capture(name);
    }
    await go(page, "payment", { invoiceId: "invoice1" });
    await expect(
      page.getByAltText("Provider-issued rent payment QR"),
    ).toBeVisible();
    await capture("31-payment-qr");
    fixture.control.paymentState = "CAPTURED";
    await page.getByRole("button", { name: "Check payment status" }).click();
    await expect(
      page.getByRole("heading", { name: "Payment Successful" }),
    ).toBeVisible();
    await capture("32-payment-success");
    expect(fixture.errors).toEqual([]);
  });
}
