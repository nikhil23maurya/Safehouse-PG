# PGOne activation guide

## Email accounts

PGOne uses email and password only. Phone authentication is retired on Android, browser billing and server APIs. Firebase Messaging is independent and may remain configured.

New accounts collect only email, password and confirmation (confirmation stays on the device). Owner/resident/staff intent and profile details are collected afterward. `PgAccount` is canonical; legacy `User` records remain financial actors. An existing password or valid existing session proves legacy ownership. Email text alone never merges accounts. Ambiguous historical records need assisted recovery.

The user deferred Resend activation on 10 November 2026. No email confirmation is required to register or sign in. Unconfirmed-email invitations require owner approval after independent identity verification; account/role/property binding is enforced by the backend. Recovery and optional confirmation links are implemented but unavailable until delivery is configured. Do not claim that an email was sent when this integration is unavailable.

Optional delivery settings, supplied only through Render Environment:

- `PGONE_MAIL_API_KEY`: an operator-owned Resend sending key.
- `PGONE_MAIL_FROM`: an address on the operator's verified Resend domain.
- `PGONE_ACCOUNT_WEB_ORIGIN=https://safehouse-api.onrender.com`.

A Netlify website URL is not an email sender. Do not fabricate a sender address. No delivery setting is needed for basic email/password registration or login.

## Backend release

Keep `PGONE_PLATFORM_ENABLED=true`. Preserve existing secrets, CORS, database connection and rent webhook. Apply the additive Prisma migrations through `npm run start:render`; do not reset the production database. CI initializes an isolated PostgreSQL database, seeds explicitly synthetic legacy money records, migrates, verifies them and restores a backup into a separate database. These are not copies of production customer data.

A release requires green exact-commit platform/contract/Android checks. Then deploy reviewed `main` on Render and verify `/ready`, `/api/platform/config?package=web` and its `deploymentCommit`. Public config must report `authentication=EMAIL_PASSWORD` and `phone=null`. Check real signup/login after deployment without creating dummy production tenants.

## Manual monthly Razorpay billing

PGOne costs INR 249 for one calendar month, renewed by a fresh owner-initiated payment. No mandate or auto-debit. Early renewal extends the contiguous paid period at its original India calendar renewal day.

Use existing Razorpay credentials or a complete `PGONE_SUBSCRIPTION_KEY_ID`/`PGONE_SUBSCRIPTION_KEY_SECRET` pair. Partial overrides fail closed. Production requires live keys. The known business is not GST registered: `PGONE_TAX_BPS=0`; do not silently change its tax treatment. Total is always 24900 paise, INR, fixed by the server.

Keep the existing plan-payment webhook at `https://safehouse-api.onrender.com/api/platform-webhooks/plan-payments`, using its configured secret. Events include `payment.captured`, `order.paid`, `payment.failed` and relevant refund events. Preserve the rent webhook. `PGONE_CUSTOM_WEB_BILLING_ENABLED=true` enables the separately branded web surface when configured. No Subscriptions product is needed.

The native Razorpay Custom SDK is available in the explicit `SIDELOAD` build distribution. The production package remains `com.safehouse.pg`; debug testing remains `com.safehouse.pg.testing`. Distribution is a build-time setting, independent of package identity. `assembleRelease -PpgoneDistribution=SIDELOAD` prepares the sideload release. The default release build is consumption-only. Do not upload a sideload purchase build to Google Play as compliant billing. Play sales require a separately implemented Play Billing/enrolled alternative program and its acceptance checks.

Native/UPI return never activates a plan. Authenticated backend reconciliation verifies merchant, order, organisation, INR amount, capture, refunds and immutable receipt. A lost or uncertain request reuses/reconciles the one open order. Authorized-only or unknown payments remain pending. Exact physical UPI app handoff and real provider acceptance need an approved merchant/device and separately authorized transaction; mock tests cannot establish them.

## Owner rent

No active Cashfree implementation remains. Historical merchant records are retained. Ordinary Razorpay account keys do not prove Route/connected-merchant approval. Automated independent-owner settlement remains disabled until the provider arrangement is approved and integrated.

An owner may instead publish their actual direct UPI address after confirming their PGOne password. The resident sees the exact owner payee and amount, chooses an installed UPI app through Android and submits a bank reference. The state remains `PENDING_OWNER_CONFIRMATION`. The owner verifies their bank, records the actual bank transfer through the existing manual-payment flow and links that existing receipt. Linking is audited, idempotent and cannot add another invoice credit. No screenshot or app-return event settles rent. Payment history and provider source remain unchanged.

## Signing and artifacts

Version 5.2.0, versionCode 53. Testing and production artifacts must be labelled accurately. The guarded production-signing workflow requires the original keystore and passwords/alias in the `production-signing` GitHub environment, plus an independently checked existing certificate and version. Missing original credentials block an upgrade-compatible production APK. Never create a replacement key or publish an unsigned/debug APK as production. Testing APK publication is permitted by the current brief and is labelled with its package, commit and debug signing status.
