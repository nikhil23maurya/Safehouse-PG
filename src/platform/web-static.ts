import express from "express";
import path from "node:path";
import { access, readFile } from "node:fs/promises";
import { AppError } from "../errors.js";

/** Scope the payment-provider CSP to this new website; API security stays intact. */
export const billingWebRouter = express.Router();
const directory = path.resolve("web/billing/dist");
const files = new Set([
  "index.html",
  "billing.js",
  "billing.css",
  "InterVariable.woff2",
  "ManropeVariable.ttf",
  "Inter-OFL.txt",
  "Manrope-OFL.txt",
  "onboarding-payments.webp",
]);
billingWebRouter.get(["/", "/:filename"], async (req, res) => {
  const file = String(req.params.filename || "index.html");
  if (!files.has(file))
    throw new AppError(404, "NOT_FOUND", "Billing asset not found.");
  try {
    await access(path.join(directory, file));
  } catch {
    throw new AppError(
      503,
      "BILLING_BUILD_UNAVAILABLE",
      "The billing website is awaiting deployment.",
    );
  }
  const html = await readFile(path.join(directory, "index.html"), "utf8");
  const policy = html.match(
    /http-equiv="Content-Security-Policy" content="([^"]+)"/,
  )?.[1];
  if (!policy)
    throw new AppError(
      503,
      "BILLING_POLICY_UNAVAILABLE",
      "The billing website policy could not be verified.",
    );
  res.setHeader("Content-Security-Policy", `${policy}; frame-ancestors 'none'`);
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin-allow-popups");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.sendFile(file, { root: directory });
});
