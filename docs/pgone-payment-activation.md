# PGOne monthly payment activation without Render Shell

Render Free does not include Shell access. Do not upgrade just to run the payment diagnostic, and do not change the existing build/start command.

1. In the existing `safehouse-api` service, preserve all Firebase and Razorpay credentials. Set `PGONE_TAX_BPS=0`, `PGONE_BILLING_WEB_ORIGIN=https://safehouse-api.onrender.com`, and keep `PGONE_CUSTOM_WEB_BILLING_ENABLED=false` during activation.
2. Deploy the latest verified `main` commit. After the server starts, open **Logs** and search for **PGONE_PAYMENT_PREFLIGHT**. The one-line JSON is safe to share. It contains no keys, account IDs, order/customer data or provider error bodies. It only makes a bounded GET request to Razorpay Orders and never creates a payment.
3. `providerOrderReadStatus: 200`, `missingSettings: []` and `webhookSecretAvailable: true` confirm these configuration checks. They do not prove Custom Checkout acceptance, webhook delivery, or owner rent collection. A 401/403 needs credential/account review; `UNAVAILABLE` needs connectivity/provider review. The diagnostic never prevents startup.
4. Razorpay Live → Accounts & Settings → Webhooks: add `https://safehouse-api.onrender.com/api/platform-webhooks/plan-payments`. Match the secret to `PGONE_SUBSCRIPTION_WEBHOOK_SECRET` if set, otherwise the existing `RAZORPAY_WEBHOOK_SECRET`. Preserve the existing rent webhook. Enable `payment.captured`, `order.paid`, `payment.failed`, `refund.created`, and `refund.processed` where available.
5. Confirm this merchant is approved for the supported Custom Checkout/UPI integration and has the intended capture settings. Then enable `PGONE_CUSTOM_WEB_BILLING_ENABLED=true` and redeploy. An authorised owner can make their actual ₹249 purchase at `/billing/`. Only a matching captured payment activates a calendar month. No recurring mandate is created. Real payment and webhook acceptance remain unverified until that purchase is confirmed.

Separate owner bank/KYC onboarding and owner-specific rent settlement require the provider's approved merchant onboarding product. A successful platform fee diagnostic does not activate these capabilities.

Optional CLI for environments that do have Shell: `node --import tsx scripts/pgone-payment-preflight.mjs`. It prints the same report.

References: [Render Shell availability](https://render.com/docs/ssh), [manual deploys](https://render.com/docs/deploys#manual-deploys), [Razorpay webhook setup](https://razorpay.com/docs/webhooks/setup-edit-payments/).
