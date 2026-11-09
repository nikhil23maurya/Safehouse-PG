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

## Subscription: exactly PGOne ₹249/month

The Android build is **consumption-only**: it displays status and records but has no external purchase button/link or web payment funnel. There is no trial, annual plan, hidden fee or alternate tier.

The separate `web/billing` surface uses the official Razorpay Web Custom SDK with recurring UPI intent. It has no card/PIN fields and no Standard Checkout fallback. It remains disabled until merchant support and sandbox results are confirmed. SDK callbacks are signature-checked and reconciled against captured invoices before access is granted.

1. In Razorpay Dashboard, confirm **Subscriptions** and the intended recurring payment methods are activated for this merchant. Ask support specifically whether the intended **Custom Checkout subscription authorisation** flow is supported and enabled. Existing one-time rent QR credentials do not establish that permission.
2. Use test-mode credentials first. Create one monthly plan, interval `1`, quantity `1`, exact final amount `24900` paise, currency `INR`, named **PGOne**. Have the provider confirm the inclusive-tax invoice setup and supported authorisation method. An unexpected invoice total/tax or unverified authorisation remains held.
3. Put dedicated secrets in the server secret manager: `PGONE_SUBSCRIPTION_KEY_ID`, `PGONE_SUBSCRIPTION_KEY_SECRET`, `PGONE_SUBSCRIPTION_WEBHOOK_SECRET`. Set `PGONE_SUBSCRIPTION_PLAN_ID`. Do not reuse/replace the existing rent variables.
4. Set `PGONE_SUBSCRIPTION_CYCLES` to the actual mandate's finite number of monthly cycles. Disclose the mandate duration in the future web authorisation surface. There is no silent unlimited/annual conversion.
5. Confirm the seller's tax treatment with the responsible accountant. Set `PGONE_TAX_BPS` explicitly, including `0` where appropriate. This is **inclusive** in ₹249, not added on top. Provider invoices must agree exactly. Do not assume a GST rate from this guide.
6. Configure the dedicated HTTPS `PGONE_BILLING_WEB_ORIGIN` and published legal URLs. This does not automatically enable purchases or change existing CORS settings. Approve the exact web origin through the normal deployment process when a verified custom surface is ready.
7. Register the **separate** subscription webhook `/api/platform-webhooks/subscriptions`, with its dedicated secret. Enable relevant subscription state, invoice-paid/payment-captured and payment-refund events. Preserve the existing `/api/webhooks/razorpay` rent webhook. The subscription handler verifies exact raw-body HMAC, deduplicates events and re-fetches provider state before entitlement.
8. Before activation, verify sandbox authorisation, first ₹249 capture, delayed/duplicate/reordered events, mismatched amount/currency/tax, renewal, cancellation, refund and expired access. Current server policy grants a paid current period only; any refund holds that period's entitlement. A different partial-refund policy needs an explicit decision.
9. New organisations stay read-only without a verified subscription period. Existing organisations keep their prior access; moving them to paid access requires a separate rollout decision. A replacement mandate is allowed only after provider-confirmed cancellation/expiry/completion and the last paid period ending. Prior contracts and payment records remain in history.

If you want digital subscription purchases inside a Play-distributed app, integrate Google Play Billing or establish eligibility/enrolment for the applicable alternative-billing programme first. The current build intentionally provides no such purchase flow.

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

Run `npm ci --prefix mobile/frontend`, then `node web/billing/build.mjs`. The standalone output is `web/billing/dist`; preview with `node web/billing/serve.mjs` on port 4174. It is never included in Android assets, and Android contains no link to this purchase surface. The root build also builds this website; the API service serves it at `/billing/` after deployment.

Register a Firebase Web app in the same project. Set `PGONE_FIREBASE_WEB_APP_ID` and `PGONE_FIREBASE_WEB_API_KEY`; add the approved billing domain to Firebase Authentication authorised domains and allow it in the web API key's restrictions. Firebase Auth uses in-memory persistence; PGOne session tokens are held in memory and cleared on reload/sign-out. Existing owners can alternatively authenticate with their existing email/password and verified account linking.

After merchant confirmation and sandbox acceptance, set `PGONE_CUSTOM_WEB_BILLING_ENABLED=true` in approved staging. Authorisation endpoints require the exact configured HTTPS billing Origin, authenticated owner, current price/cycle consent and the server-selected subscription. Keep the flag false in production until provider acceptance passes. Approve hosting headers/CSP and the exact CORS origin during deployment; this branch does not modify production CORS.

Only SDK-confirmed supported recurring UPI apps are offered. If none is available, payment stays unavailable. Mandatory provider/UPI authorisation disclosures may appear; PGOne does not conceal the processor or imitate the bank. No card, VPA-collect or UPI-PIN fallback is added.

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

After deployment, check `/health`, `/ready`, `/api/platform/config?package=com.safehouse.pg`, its exact `deploymentCommit`, the two policy URLs and `/billing/`. A null `phone` requires checking both PGOne feature flags and the Firebase server settings above. Existing one-time rent credentials do not prove recurring Custom Checkout approval.
