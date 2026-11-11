import { z } from "zod";
import { config as existingConfig } from "../config.js";
import { resolveSubscriptionCredentials } from "./credentials.js";

const optional = z.string().trim().min(1).optional();
export const platformConfig = z
  .object({
    PGONE_PLATFORM_ENABLED: z.enum(["true", "false"]).default("false"),
    PGONE_CUSTOM_WEB_BILLING_ENABLED: z
      .enum(["true", "false"])
      .default("false"),
    PGONE_SUBSCRIPTION_KEY_ID: optional,
    PGONE_SUBSCRIPTION_KEY_SECRET: optional,
    PGONE_SUBSCRIPTION_WEBHOOK_SECRET: optional,
    PGONE_SUBSCRIPTION_PLAN_ID: optional,
    PGONE_SUBSCRIPTION_CYCLES: z.coerce
      .number()
      .int()
      .min(1)
      .max(1200)
      .optional(),
    PGONE_TAX_BPS: z.coerce.number().int().min(0).max(2800).optional(),
    PGONE_BILLING_WEB_ORIGIN: z
      .string()
      .url()
      .startsWith("https://")
      .optional(),
    PGONE_TERMS_URL: z.string().url().startsWith("https://").default("https://safehouse-api.onrender.com/legal/terms"),
    PGONE_PRIVACY_URL: z.string().url().startsWith("https://").default("https://safehouse-api.onrender.com/legal/privacy"),
  })
  .parse(process.env);

export const platformEnabled = () =>
  platformConfig.PGONE_PLATFORM_ENABLED === "true";
export const subscriptionCredentials = () =>
  resolveSubscriptionCredentials(platformConfig, existingConfig);
export const PLAN = Object.freeze({
  code: "PGONE_MONTHLY",
  name: "PGOne",
  amountPaise: 100,
  currency: "INR",
  interval: "month",
});
// Only new manual-month purchases use the current price. Original orders,
// receipts and retired recurring contracts keep their original amount.
export const LEGACY_RECURRING_AMOUNT_PAISE = 24900;
export const PLAN_PAID_AMOUNTS = Object.freeze([100, LEGACY_RECURRING_AMOUNT_PAISE]);
export const STAFF_PERMISSIONS = ["OCCUPANCY_READ"] as const;

export function taxBreakdown(bps: number | undefined, amountPaise: number = PLAN.amountPaise) {
  if (bps === undefined) return null;
  const taxablePaise = Math.round((amountPaise * 10000) / (10000 + bps));
  return {
    taxablePaise,
    taxPaise: amountPaise - taxablePaise,
    rateBps: bps,
    totalPaise: amountPaise,
    inclusive: true,
  };
}
