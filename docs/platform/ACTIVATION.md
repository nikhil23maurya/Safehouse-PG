# PGOne activation guide

This branch is a review build. Nothing here activates a production provider, runs a production migration or changes existing rent settlement. Keep `PGONE_PLATFORM_ENABLED=false` until staging migration and identity checks pass. Existing email/password accounts and legacy rent payments remain available.

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

The server contains a Razorpay Subscriptions reconciliation adapter. This is **not a completed or enabled Custom Checkout integration**. No Standard Checkout fallback is added. The separate custom web authorisation surface and merchant-approved SDK contract still need implementation/verification after access is confirmed. Do not turn an unverified generic SDK into a payment button.

1. In Razorpay Dashboard, confirm **Subscriptions** and the intended recurring payment methods are activated for this merchant. Ask support specifically whether the intended **Custom Checkout subscription authorisation** flow is supported and enabled. Existing one-time rent QR credentials do not establish that permission.
2. Use test-mode credentials first. Create one monthly plan, interval `1`, quantity `1`, exact final amount `24900` paise, currency `INR`, named **PGOne**. Have the provider confirm the inclusive-tax invoice setup and supported authorisation method. An unexpected invoice total/tax or unverified authorisation remains held.
3. Put dedicated secrets in the server secret manager: `PGONE_SUBSCRIPTION_KEY_ID`, `PGONE_SUBSCRIPTION_KEY_SECRET`, `PGONE_SUBSCRIPTION_WEBHOOK_SECRET`. Set `PGONE_SUBSCRIPTION_PLAN_ID`. Do not reuse/replace the existing rent variables.
4. Set `PGONE_SUBSCRIPTION_CYCLES` to the actual mandate's finite number of monthly cycles. Disclose the mandate duration in the future web authorisation surface. There is no silent unlimited/annual conversion.
5. Confirm the seller's tax treatment with the responsible accountant. Set `PGONE_TAX_BPS` explicitly, including `0` where appropriate. This is **inclusive** in ₹249, not added on top. Provider invoices must agree exactly. Do not assume a GST rate from this guide.
6. Configure the dedicated HTTPS `PGONE_BILLING_WEB_ORIGIN` and published legal URLs. This does not automatically enable purchases or change existing CORS settings. Approve the exact web origin through the normal deployment process when a verified custom surface is ready.
7. Register the **separate** subscription webhook `/api/platform-webhooks/subscriptions`, with its dedicated secret. Enable relevant subscription state, invoice-paid/payment-captured and payment-refund events. Preserve the existing `/api/webhooks/razorpay` rent webhook. The subscription handler verifies exact raw-body HMAC, deduplicates events and re-fetches provider state before entitlement.
8. Before activation, verify sandbox authorisation, first ₹249 capture, delayed/duplicate/reordered events, mismatched amount/currency/tax, renewal, cancellation, refund and expired access. Current server policy grants a paid current period only; any refund holds that period's entitlement. A different partial-refund policy needs an explicit decision.
9. New organisations stay read-only without a verified subscription period. Existing organisations keep their prior access; moving them to paid access requires a separate rollout decision. Re-purchase after a fully ended mandate/history migration is not implemented yet and must be completed before purchase activation.

If you want digital subscription purchases inside a Play-distributed app, integrate Google Play Billing or establish eligibility/enrolment for the applicable alternative-billing programme first. The current build intentionally provides no such purchase flow.

## Per-owner online rent collection

1. Apply for **Cashfree Embedded Payments** partner access. Explain that PG owners are separate merchants, each with a provider-approved settlement bank relationship. Obtain the supported sandbox onboarding API/SDK contract, authentication, webhook signing and settlement/routing permissions.
2. Confirm the exact current provider-required business, bank and KYC fields, any hosted-document flow, required disclosures and all activation/rejection/suspension states. Do not paste bank account numbers/PAN/documents into this chat.
3. Until access is approved the app shows **Not connected / awaiting activation**, collects no bank/KYC documents and cannot claim to verify a bank account. Its `collectionEnabled` stays false. Database status text alone cannot turn on collection.
4. The existing legacy rent engine settles Razorpay QR payments. It has no approved per-owner Cashfree payment adapter. A new adapter must reconcile captured payments through the existing transactional settlement interface; changing that frozen engine requires an explicit integration decision. New organisations are blocked from starting legacy shared-account online rent payments.
5. After the approved adapter exists, verify distinct-owner routing, bank confirmation, pending/additional-information/rejected/approved/suspended KYC, signed event replay and refunds/settlement in the provider sandbox. Existing legacy rent collection remains unchanged.

## Migration and release order

- Review `prisma/migrations/20261109090000_pgone_platform/migration.sql` against a staging clone and take the normal database backup. It adds platform tables/indexes/check constraints and relaxes `User.email/passwordHash` to nullable for real phone-only actors. Existing values, financial tables and enum values are retained.
- Run the repository's normal effective build, then `prisma migrate deploy` **only in the approved staging environment**. This work does not run it in production. Do not roll back to old application code after creating phone-only actors without checking nullable-field compatibility.
- Verify old password login, property permissions, resident management, invoices, manual payments, QR reconciliation, receipts and notifications alongside the new flows. The CI PostgreSQL instance is disposable and contains synthetic records only.
- Publish neither a release nor real-payment activation from the testing APK alone. Managed signing, provider sandbox results, physical-device OTP/UPI/FCM and the release review remain required.

## Primary integration references

- [Firebase Android phone authentication](https://firebase.google.com/docs/auth/android/phone-auth)
- [Firebase server ID-token verification](https://firebase.google.com/docs/auth/admin/verify-id-tokens)
- [Razorpay official Custom Checkout subscription documentation](https://github.com/razorpay/markdown-docs/blob/master/api/payments/subscriptions-custom.md)
- [Razorpay Subscriptions API](https://razorpay.com/docs/api/payments/subscriptions/)
- [Cashfree Embedded Payments](https://www.cashfree.com/embedded-payments/)
- [Google Play payments policy](https://support.google.com/googleplay/android-developer/answer/10281818)
