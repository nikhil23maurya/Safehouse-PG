# PGOne activation guide

The user authorised main/production promotion. A merge does not activate Firebase or payment-provider accounts. Existing email/password accounts and legacy rent payments remain available. New provider flags default to disabled until configuration is supplied. Fresh CI migration/isolation verification is required before promotion; it does not establish live OTP or payment acceptance.

## Firebase phone authentication

1. Open the existing Firebase project → **Authentication → Sign-in method → Phone**. Enable it. Your configured testing numbers can be used after the client/server configuration below is installed; enabling testing numbers alone does not configure the app.
2. In **Project settings → General**, register both Android apps, preserving these package IDs: production `com.safehouse.pg` and testing `com.safehouse.pg.testing`. Copy each app's public Firebase app ID. Do not substitute a registration token, FCM token or API access token.
3. Add the actual signing certificate's **SHA-1 and SHA-256** under each Android app. For testing, use the certificate reported with the specific CI APK. A new CI debug certificate can require new fingerprints. Before release use the managed release certificate and Play App Signing certificate where applicable.
4. In Authentication settings, allow the intended SMS regions, review SMS quota/billing, and add your own **test phone number + test code**. This code stays in Firebase; it is never hardcoded in the app. Real SMS needs the project's applicable billing/quota and app-verification setup.
5. Configure the server's existing `FIREBASE_PROJECT_ID`, `FIREBASE_ANDROID_APP_ID` (production app), `FIREBASE_ANDROID_API_KEY`, `FIREBASE_SENDER_ID`, and `FIREBASE_SERVICE_ACCOUNT_JSON`. Supply the service-account credential through the deployment secret manager, never chat or Git. The service account must belong to this project and be authorised for Firebase Authentication verification/revocation checks.
6. Add new server settings `PGONE_FIREBASE_TESTING_APP_ID` (testing app), `PGONE_PHONE_AUTH_ENABLED=true`, and HTTPS `PGONE_TERMS_URL` / `PGONE_PRIVACY_URL` pointing to your published policies. The phone registration screen requires both policies. Google sign-in is deliberately omitted until its real client/server integration is supplied.
7. On an isolated staging database, apply the migration below, then set `PGONE_PLATFORM_ENABLED=true`. Verify `/api/platform/config?package=com.safehouse.pg.testing` returns a non-null `phone` configuration. This is public Firebase client configuration, never a service-account key.
8. Install the testing APK. Test your Firebase test number, wrong code, resend cooldown, change number, process restart, expired verification, logout and restore. Then test actual SMS on a registered physical Android device. Firebase may open its official app-verification/reCAPTCHA screen; do not disable verification to hide it.

The app uses official native Firebase Auth, then exchanges a freshly verified Firebase ID token with the server. The server checks project signature/audience, token revocation, phone provider, phone number and recent authentication. Selecting a role never authorises access to an existing property. Legacy linking requires successful existing authentication. Resident/staff invitations are owner-created, phone-bound and expire after seven days.

## Monthly access: ₹249, owner pays afresh each month

The owner confirmed **manual monthly payments**, not an automatically renewing subscription. Each ₹249 capture purchases one calendar month. An early renewal starts at the existing paid expiry; otherwise the period starts when capture is verified. Renewal dates use Asia/Kolkata and retain the original day (31 January → 28/29 February → 31 March). No free trial or automatic debit is created.

The Android Play build remains consumption-only. The separate `/billing/` website uses official Razorpay Custom Checkout `razorpay.js` and one-time UPI intent. It passes a server-created `order_id`, never `subscription_id`. The old recurring-create route returns 410; old records, cancellation/reconciliation and signed legacy webhooks remain for existing contracts. An existing recurring contract must be confirmed ended before a new manual payment can be started.

### Required production settings

1. Reuse existing `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET`. For a deliberately separate billing merchant, set **both** `PGONE_SUBSCRIPTION_KEY_ID` / `PGONE_SUBSCRIPTION_KEY_SECRET`; partial overrides stay unavailable and never mix accounts. Do not switch merchants after orders exist without a reconciliation plan.
2. `PGONE_BILLING_WEB_ORIGIN=https://safehouse-api.onrender.com`. Preserve the existing CORS settings. The custom payment API requires this exact Origin, authenticated owner, fixed-price consent, `recurring=false` and an idempotency key.
3. Configure `PGONE_TAX_BPS` for the actual seller tax treatment, explicitly `0` if appropriate. The total remains exactly ₹249. The receipt records the tax snapshot and access period; it is not represented as a statutory GST invoice. Confirm the business tax treatment before activation rather than guessing.
4. Register **`https://safehouse-api.onrender.com/api/platform-webhooks/plan-payments`** in the same Razorpay merchant account. Use a dedicated `PGONE_SUBSCRIPTION_WEBHOOK_SECRET` if configured; otherwise the existing `RAZORPAY_WEBHOOK_SECRET` is used for this separate endpoint. Enable `payment.captured`, `order.paid`, `payment.failed` and applicable refund events. Preserve the old rent webhook unchanged.
5. Confirm the merchant's one-time Custom Checkout/UPI method and payment-capture configuration. Access requires provider-confirmed **captured** payment and a fully paid matching order. An authorised-only payment is pending and grants no access. A Subscriptions product, provider plan ID or mandate cycles are **not needed**.
6. After the configured checkout is verified, set `PGONE_CUSTOM_WEB_BILLING_ENABLED=true`. The flag never bypasses amount/currency/order/ownership/capture verification. No paid acceptance or merchant activation may be claimed from unit tests alone.

Uncertain order creation is held and recovered by its provider receipt reference. It is not blindly retried. Repeated callbacks, webhook delivery or parallel reconciliation cannot extend access twice. The webhook validates raw-body HMAC, deduplicates events and refetches provider state. A refund monotonically revokes that receipt's period; other paid periods are retained at their original dates. Existing legacy workspace access is unchanged.

## Per-owner online rent collection

1. Apply for **Cashfree Embedded Payments** partner access. Explain that PG owners are separate merchants, each with a provider-approved settlement bank relationship. Obtain the supported sandbox onboarding API/SDK contract, authentication, webhook signing and settlement/routing permissions.
2. Confirm the exact current provider-required business, bank and KYC fields, any hosted-document flow, required disclosures and all activation/rejection/suspension states. Do not paste bank account numbers/PAN/documents into this chat.
3. Until access is approved the app shows **Not connected / awaiting activation**, collects no bank/KYC documents and cannot claim to verify a bank account. Its `collectionEnabled` stays false. Database status text alone cannot turn on collection.
4. The existing legacy rent engine settles Razorpay QR payments. It has no approved per-owner Cashfree payment adapter. A new adapter must reconcile captured payments through the existing transactional settlement interface; changing that frozen engine requires an explicit integration decision. New organisations are blocked from starting legacy shared-account online rent payments.
5. After the approved adapter exists, verify distinct-owner routing, bank confirmation, pending/additional-information/rejected/approved/suspended KYC, signed event replay and refunds/settlement in the provider sandbox. Existing legacy rent collection remains unchanged.

## Migration and release order

- Review `prisma/migrations/20261109090000_pgone_platform/migration.sql` against a staging clone and take the normal database backup. It adds platform tables/indexes/check constraints and relaxes `User.email/passwordHash` to nullable for real phone-only actors. Existing values, financial tables and enum values are retained.
- The existing Render start command runs `prisma migrate deploy` on its configured database. Main promotion includes this additive production migration under the user's release authorisation. Review the managed database recovery/backup policy before deployment. Do not roll back to old application code after creating phone-only actors without checking nullable-field compatibility.
- Verify old password login, property permissions, resident management, invoices, manual payments, QR reconciliation, receipts and notifications alongside the new flows. The CI PostgreSQL instance is disposable and contains synthetic records only.
- Publish neither a release nor real-payment activation from the testing APK alone. Managed signing, provider sandbox results, physical-device OTP/UPI/FCM and the release review remain required.

## Primary integration references

- [Firebase Android phone authentication](https://firebase.google.com/docs/auth/android/phone-auth)
- [Firebase server ID-token verification](https://firebase.google.com/docs/auth/admin/verify-id-tokens)
- [Razorpay official Custom Checkout subscription documentation](https://github.com/razorpay/markdown-docs/blob/master/api/payments/subscriptions-custom.md)
- [Razorpay Subscriptions API](https://razorpay.com/docs/api/payments/subscriptions/)
- [Cashfree Embedded Payments](https://www.cashfree.com/embedded-payments/)
- [Google Play payments policy](https://support.google.com/googleplay/android-developer/answer/10281818)

## Separate web billing build

The root build compiles `web/billing/dist` and serves it at `/billing/`, with a scoped provider CSP and exact file allowlist. Android contains no link or code for the web purchase funnel.

Use the registered PGOne Billing Firebase Web app in the same project, with `PGONE_FIREBASE_WEB_APP_ID` and `PGONE_FIREBASE_WEB_API_KEY`. Authorise `safehouse-api.onrender.com`. Web session tokens use in-memory persistence. Owners may alternatively prove an existing email/password account and link it. Resident/staff memberships cannot purchase owner access.

Only SDK-confirmed UPI apps are offered. PGOne retains its own payment screens; mandatory payment-provider/UPI authorisation can appear. No Standard Checkout fallback, card input, UPI PIN input or fake payment success is added.

## Read-only payment preflight

In the configured backend environment run:

```text
node --import tsx scripts/pgone-payment-preflight.mjs
```

This reports the credential source, missing monthly-payment settings, webhook-secret availability and HTTP status of a read-only Razorpay Orders request. It never prints credentials or customer/order/payment records. No plan, mandate, payment, merchant or transfer is created. A successful read is not proof of Custom Checkout approval or payment acceptance. No provider subscription plan or mandate is required. `ownerMerchantOnboardingImplemented=false` explicitly identifies the remaining bank/KYC and owner-wise rent integration gap; configuration cannot enable code that is not implemented.

## Exact production policy values and signing status

```text
PGONE_TERMS_URL=https://safehouse-api.onrender.com/legal/terms
PGONE_PRIVACY_URL=https://safehouse-api.onrender.com/legal/privacy
PGONE_BILLING_WEB_ORIGIN=https://safehouse-api.onrender.com
```

The existing production Downloads APKs 5.0.0 and 5.0.1 use package `com.safehouse.pg` and the same public release certificate:

```text
SHA-1: 05:74:A5:E1:42:19:8D:49:DC:64:31:77:2E:DD:6B:35:2A:9E:C6:4C
SHA-256: D2:07:3D:76:B1:4D:FA:AB:99:92:2B:AD:4B:DE:54:E3:D1:F9:04:FD:29:4B:F3:E7:76:BC:D3:35:4F:4A:95:E0
```

The user added both fingerprints to Firebase's production app. The original private release keystore has not been located; the user reports no keystore file. An APK contains the public certificate, not the private key. Do not silently replace this signing identity or require uninstalling an existing installation to conceal the missing update signer. CI provides an unsigned production assembly and a separate testing package. Use that testing APK's exact certificate under its separate Firebase app registration.

Firebase test numbers use their configured codes and send no SMS. Keep these entries out of app source and logs. They authenticate real Firebase identities, so use them only for internal verification and remove the entry before customer use of that account. A console test entry has been configured, but a real provider exchange remains pending deployment configuration. Real SMS requires Firebase Blaze billing and the applicable region, quota and app-verification setup.

After deployment, check `/health`, `/ready`, `/api/platform/config?package=com.safehouse.pg`, its exact `deploymentCommit`, the two policy URLs and `/billing/`. A null `phone` requires checking both PGOne feature flags and the Firebase server settings above. Existing one-time rent credentials do not prove one-time Custom Checkout acceptance.
