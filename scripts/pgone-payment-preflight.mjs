import "dotenv/config";

// Read-only operator check: no mandates, payments, transfers or accounts are created.
// Print only availability, provider status and public plan references; never credentials.
try {
  const { platformConfig: settings, subscriptionCredentials } = await import("../src/platform/config.ts");
  const credentials = subscriptionCredentials();
  const { planWebhookSecret } = await import("../src/platform/plan-payments.ts");
  const required = ["PGONE_TAX_BPS", "PGONE_BILLING_WEB_ORIGIN", "PGONE_TERMS_URL", "PGONE_PRIVACY_URL"];
  const report = {
    configurationAvailable: true,
    credentialSource: credentials?.source || "UNAVAILABLE_OR_PARTIAL",
    billingMode: "MANUAL_MONTHLY",
    recurring: false,
    webhookSecretAvailable: Boolean(planWebhookSecret()),
    customBillingFlagEnabled: settings.PGONE_CUSTOM_WEB_BILLING_ENABLED === "true",
    missingSettings: required.filter(name => settings[name] === undefined),
    providerOrderReadStatus: null,
    customCheckoutAcceptanceVerified: false,
    ownerMerchantOnboardingImplemented: false,
    note: "No Subscriptions product, plan ID or mandate cycles are required. Successful reads do not prove Custom Checkout acceptance or merchant onboarding approval.",
  };
  if (credentials) {
    try {
      const response = await fetch("https://api.razorpay.com/v1/orders?count=1", {
        headers: { authorization: `Basic ${Buffer.from(`${credentials.keyId}:${credentials.keySecret}`).toString("base64")}` },
        signal: AbortSignal.timeout(15000),
      });
      report.providerOrderReadStatus = response.status;
      await response.body?.cancel(); // Never print customer/order data.
    } catch { report.providerOrderReadStatus = "UNAVAILABLE"; }
  }
  console.log(JSON.stringify(report, null, 2));
} catch {
  console.log(JSON.stringify({ configurationAvailable: false, note: "Run this command in the configured backend environment. No credentials were printed." }, null, 2));
  process.exitCode = 1;
}
