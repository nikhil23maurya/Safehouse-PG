type Settings = {
  PGONE_TAX_BPS?: number;
  PGONE_BILLING_WEB_ORIGIN?: string;
  PGONE_TERMS_URL?: string;
  PGONE_PRIVACY_URL?: string;
  PGONE_CUSTOM_WEB_BILLING_ENABLED?: string;
};
type Credentials = {
  keyId: string;
  keySecret: string;
  source: "EXISTING_RAZORPAY_ACCOUNT" | "SUBSCRIPTION_OVERRIDE";
} | null;

// Read-only, bounded operator diagnostic. Never fetch or print customer/order
// bodies, credential values, headers or provider errors.
export async function paymentPreflight(
  settings: Settings,
  credentials: Credentials,
  webhookSecretAvailable: boolean,
  fetcher: typeof fetch = fetch,
) {
  const required = ["PGONE_TAX_BPS", "PGONE_BILLING_WEB_ORIGIN", "PGONE_TERMS_URL", "PGONE_PRIVACY_URL"] as const;
  const report = {
    configurationAvailable: true,
    credentialSource: credentials?.source || "UNAVAILABLE_OR_PARTIAL",
    billingMode: "MANUAL_MONTHLY",
    recurring: false,
    webhookSecretAvailable,
    customBillingFlagEnabled: settings.PGONE_CUSTOM_WEB_BILLING_ENABLED === "true",
    missingSettings: required.filter(name => settings[name] === undefined || settings[name] === ""),
    providerOrderReadStatus: null as number | "UNAVAILABLE" | null,
    customCheckoutAcceptanceVerified: false,
    note: "A successful read does not prove Custom Checkout acceptance, webhook delivery or owner rent collection approval. No payment was created.",
  };
  if (credentials) {
    try {
      const response = await fetcher("https://api.razorpay.com/v1/orders?count=1", {
        method: "GET",
        redirect: "error",
        headers: { authorization: `Basic ${Buffer.from(`${credentials.keyId}:${credentials.keySecret}`).toString("base64")}` },
        signal: AbortSignal.timeout(5000),
      });
      report.providerOrderReadStatus = response.status;
      await response.body?.cancel().catch(() => {});
    } catch { report.providerOrderReadStatus = "UNAVAILABLE"; }
  }
  return report;
}

export async function configuredPaymentPreflight() {
  const [{ platformConfig, subscriptionCredentials }, { config }] = await Promise.all([
    import("./config.js"), import("../config.js"),
  ]);
  return paymentPreflight(platformConfig, subscriptionCredentials(),
    Boolean(platformConfig.PGONE_SUBSCRIPTION_WEBHOOK_SECRET || config.RAZORPAY_WEBHOOK_SECRET));
}

// Invoked after the HTTP server is listening; provider outages never gate startup.
export async function logPaymentPreflight(write: (line: string) => void = console.info) {
  try {
    const { platformEnabled } = await import("./config.js");
    if (!platformEnabled()) return;
    write(`PGONE_PAYMENT_PREFLIGHT ${JSON.stringify(await configuredPaymentPreflight())}`);
  } catch {
    write('PGONE_PAYMENT_PREFLIGHT {"configurationAvailable":false,"note":"Diagnostic unavailable. No payment was created."}');
  }
}
