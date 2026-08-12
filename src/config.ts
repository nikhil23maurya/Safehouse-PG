import { z } from "zod";

const optionalNonEmpty = z.string().trim().min(1).optional();

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().min(1),
  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  REFRESH_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(2_592_000),
  RAZORPAY_KEY_ID: optionalNonEmpty,
  RAZORPAY_KEY_SECRET: optionalNonEmpty,
  RAZORPAY_WEBHOOK_SECRET: optionalNonEmpty,
  FIREBASE_PROJECT_ID: optionalNonEmpty,
  FIREBASE_ANDROID_APP_ID: optionalNonEmpty,
  FIREBASE_ANDROID_API_KEY: optionalNonEmpty,
  FIREBASE_SENDER_ID: optionalNonEmpty,
  FIREBASE_SERVICE_ACCOUNT_JSON: optionalNonEmpty,
  APP_NAME: z.string().trim().min(1).default("SafeHouse"),
  CORS_ORIGINS: z.string().default("*"),
  BOOTSTRAP_OWNER_EMAIL: optionalNonEmpty,
  BOOTSTRAP_OWNER_PASSWORD: optionalNonEmpty,
  BOOTSTRAP_OWNER_NAME: optionalNonEmpty,
  BOOTSTRAP_PROPERTY_NAME: optionalNonEmpty
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  console.error("Invalid environment variables", parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const config = {
  ...parsed.data,
  corsOrigins: parsed.data.CORS_ORIGINS.split(",").map((v) => v.trim()).filter(Boolean)
};
