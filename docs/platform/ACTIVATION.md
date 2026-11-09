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

## Per-owner online rent collection — Razorpay Route (not Cashfree)

Razorpay remains the sole payment provider. The one-time ₹249 owner subscription is collected into PGOne's authorised Razorpay merchant account. A resident's rent must be linked to **that property's individually verified Razorpay Route Linked Account**. These are different transactions and independent entitlement/settlement records.

1. Apply to Razorpay for **Route linked-account onboarding, UPI VPA settlement and transfer-via-orders** for PGOne's exact platform/rent use case. Razorpay may have additional RBI eligibility requirements, turnover thresholds, due diligence, bank approvals and settlement limitations. Existing Razorpay Checkout credentials alone DO NOT grant Route access.
2. Enable Route only after Razorpay has approved the parent account, and configure `PGONE_RAZORPAY_ROUTE_ENABLED=true` using the same parent merchant `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` used for rent collection. Keys must be live to process production rent; the flag is **false by default**. Never put secrets in source, issue threads or chat.
3. For a paid owner, open `Rent settlement account`, enter real legal name, PAN, business type and owner UPI ID and explicitly consent. Razorpay validates the VPA holder name, then creates a Composite Linked Account with a deterministic reference and idempotency key. PGOne retains a fingerprint and verification status, **not** the PAN, full VPA or payment PIN.
4. The backend reads the linked account directly from Razorpay, checks owner reference, Route product activation, an **active/verified** settlement destination, accepted provider terms, environment and linked-account status. Only then can an account be used as the recipient in a new PG's rent order.
5. Rent orders for new properties are created with an exact, provider-confirmed **Route transfer** to that account for the full rent amount. A Razorpay order without an exact transfer is rejected and must never be shown to the resident. The existing fixed QR to the **shared PGOne merchant** stays blocked for new owners, even if the owner is subscribed. Legacy-property QR behaviour remains preserved.
6. A captured resident payment is different from transfer processing and bank/UPI **settlement**. Do not claim bank credit from a Checkout callback or even from a payment capture. Link transfer and settlement reporting to the owner dashboard before promising settlement SLAs. VPA settlement can be faster subject to activation, individual limits and provider/bank operation; do not promise an unconditional 10-second transfer.
7. Cashfree bank, KYC and webhook submission endpoints are retired (410). Historical records must remain audit-safe and never be silently activated as Razorpay recipients.

**Release blocker:** Razorpay has not yet confirmed Route/UPI settlements access for this account and no live owner settlement has been verified. Until then, keep the feature disabled and avoid accepting new-owner online rent into PGOne's own account. End-to-end live tests must include the exact owner recipient, transfer reversal/refund, wrong-account, lost-response/idempotency, linked-account suspension, and settlement reconciliation.

Relevant docs: [Razorpay Route](https://razorpay.com/route/), [Composite onboarding](https://tfs.np.razorpay.in/docs/api/payments/route/create-linked-account-composite), [Transfer via order](https://tfs.np.razorpay.in/docs/api/payments/route/create-transfers-orders).

## Migration and release order

- Review `prisma/migrations/20261109090000_pgone_platform/migration.sql` against a staging clone and take the normal database backup. It adds platform tables/indexes/check constraints and relaxes `User.email/passwordHash` to nullable for real phone-only actors. Existing values, financial tables and enum values are retained.
- Review `prisma/migrations/20261109210000_razorpay_route_rent_binding/migration.sql` on the same staging clone. It adds a nullable immutable Route recipient binding for resident payment attempts; legacy records remain unchanged.\n- The existing Render start command runs `prisma migrate deploy` on its configured database. Main promotion includes this additive production migration under the user's release authorisation. Review the managed database recovery/backup policy before deployment. Do not roll back to old application code after creating phone-only actors without checking nullable-field compatibility.
- Verify old password login, property permissions, resident management, invoices, manual payments, QR reconciliation, receipts and notifications alongside the new flows. The CI PostgreSQL instance is disposable and contains synthetic records only.
- Publish neither a release nor real-payment activation from the testing APK alone. Managed signing, provider sandbox results, physical-device OTP/UPI/FCM and the release review remain required.

## Primary integration references

- [Firebase Android phone authentication](https://firebase.google.com/docs/auth/android/phone-auth)
- [Firebase server ID-token verification](https://firebase.google.com/docs/auth/admin/verify-id-tokens)
- [Razorpay official Custom Checkout subscription documentation](https://github.com/razorpay/markdown-docs/blob/master/api/payments/subscriptions-custom.md)
- [Razorpay Subscriptions API](https://razorpay.com/docs/api/payments/subscriptions/)
- [Razorpay Route linked accounts](https://razorpay.com/route/)
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

This reports the credential source, missing monthly-payment settings, webhook-secret availability and HTTP status of a read-only Razorpay Orders request. It never prints credentials or customer/order/payment records. No plan, mandate, payment, merchant or transfer is created. A successful read is not proof of Custom Checkout approval or payment acceptance. No provider subscription plan or mandate is required. `ownerMerchantOnboardingImplemented=false` is a legacy preflight field; it does not assert that Razorpay Route is approved or that new-owner settlement is active. Check the separate Route eligibility and integration status before enabling collection.

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
