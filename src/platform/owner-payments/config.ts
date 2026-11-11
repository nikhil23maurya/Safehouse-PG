import {z} from "zod";
import {assert} from "../../errors.js";

// Deliberately independent of the PGOne software-fee merchant credentials.
export function ownerPaymentConfig() {
  const schema=z.object({
    RAZORPAY_OWNER_MERCHANT_ONBOARDING_ENABLED:z.enum(["true","false"]).default("false"),
    RAZORPAY_OWNER_MODE:z.enum(["test","live"]).default("test"),
    RAZORPAY_OWNER_CLIENT_ID:z.string().min(8).optional(),
    RAZORPAY_OWNER_CLIENT_SECRET:z.string().min(16).optional(),
    RAZORPAY_OWNER_TOKEN_KEY:z.string().regex(/^[a-fA-F0-9]{64}$/).optional(),
    RAZORPAY_OWNER_WEBHOOK_SECRET:z.string().min(24).optional(),
    RAZORPAY_OWNER_REDIRECT_URI:z.string().url().startsWith("https://").optional(),
    PGONE_SUBSCRIPTION_MERCHANT_ACCOUNT_ID:z.string().regex(/^acc_[A-Za-z0-9]+$/).optional(),
  });
  const parsed=schema.safeParse(process.env);
  // A mistake in this optional integration must not break the existing login,
  // software-fee checkout or manual rent flows. Disable only the new feature.
  const env=parsed.success?parsed.data:schema.parse({RAZORPAY_OWNER_MERCHANT_ONBOARDING_ENABLED:"false",RAZORPAY_OWNER_MODE:process.env.RAZORPAY_OWNER_MODE==="live"?"live":"test"});
  const configured=Boolean(env.RAZORPAY_OWNER_CLIENT_ID&&env.RAZORPAY_OWNER_CLIENT_SECRET&&env.RAZORPAY_OWNER_TOKEN_KEY&&env.RAZORPAY_OWNER_WEBHOOK_SECRET&&env.RAZORPAY_OWNER_REDIRECT_URI&&env.PGONE_SUBSCRIPTION_MERCHANT_ACCOUNT_ID);
  return {...env,configurationValid:parsed.success,configured,enabled:configured&&env.RAZORPAY_OWNER_MERCHANT_ONBOARDING_ENABLED==="true",ledgerAllowed:env.RAZORPAY_OWNER_MODE==="live"||process.env.NODE_ENV==="test"};
}
export function requireOwnerPayments() {
  const c=ownerPaymentConfig();
  assert(c.enabled,503,"OWNER_PAYMENTS_APPROVAL_PENDING","Razorpay merchant connection is awaiting activation. Direct UPI payments still require your owner's bank confirmation.");
  return c;
}
