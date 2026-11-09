# PGOne platform expansion

Baseline: `c729dac` on `origin/main`. Branch: `codex/pgone-premium-onboarding`. The prior rebuild PR is merged; this branch preserves its PGOne rebrand and subsequent QR/UPI fixes.

## Plan and boundaries

- [x] Audit maintained app, auth, property/role guards, effective backend build, financial settlement and native bridges.
- [x] Generate separate original hero, property-creation, workspace-ready and payment-setup artwork; optimise bundled WebP assets.
- [x] Add premium welcome and resumable onboarding, retaining existing email/password access.
- [x] Add verified phone identity, account/profile persistence and explicit memberships/invitations.
- [x] Add a compatibility boundary to reuse existing owner/resident APIs with server-verified workspace membership. Staff has a separate permission-limited workspace.
- [ ] Add exactly one INR 24900-paise monthly subscription; server-verified receipts/periods, cancellation, renewal/refund reconciliation and idempotent webhooks.
- [ ] Add default Play consumption-only UI and a separate web subscription surface.
- [x] Add merchant setup/status with no unapproved KYC collection or fabricated provider APIs.
- [ ] Add migration/tenant/security/financial tests, browser and Android journeys, screenshot review and fresh testing APK.

New modules: `src/platform/{config,identity,tokens,service,router,billing,merchant}.ts`, platform models/migration/tests, frontend platform screens/client/styles, Android phone bridge, asset manifest, activation guide. Existing integration files: `src/server.ts`, schema, required nullable contact/password types, frontend routing/session/build entrypoints, native asset loading/build and CI.

Existing rent calculations, `SAFEHOUSE_QR_SETTLEMENT_V2`, reconciliation, manual credit, invoice snapshots, queues, notifications and production configuration are preserved. Cyntrova's unrelated checkout is untouched. No production data migration, provider payment or deployment is authorised by local implementation work.

## Identity compatibility decision

An account represents a verified person and may have several memberships. Existing User/Student records remain operational actors used by the stable rent APIs. A membership links an account to a property/organisation and, for an owner or resident, the existing operational actor. Staff never inherits owner permissions. Invitations are owner-created, phone-bound, expiring and single-use.

Phone-only owners need an operational User without a fabricated email/password. The only existing-column relaxation is allowing nullable email/passwordHash; existing values and uniqueness remain intact. Password authentication continues to require a real password hash. No client role choice grants access to an existing property.

Existing password users retain access. Linking a legacy account requires successful existing authentication; phone matching alone never claims historical accounts. New organisations receive server-controlled subscription entitlements. Existing organisations retain their prior access until a separately approved billing transition; no silent paywall is applied to existing users.

## External gates

Firebase Phone Authentication, signing fingerprints, billing/SMS quota, subscription merchant activation/keys, inclusive-tax configuration, approved web origin and legal links require operator setup. Cashfree Embedded Payments needs genuine partner approval and its approved integration contract. Until that contract is available the application must state the limitation and must not collect bank numbers/PAN/documents or pretend an account has been approved.

Reference images guide visual design, not permission to fabricate mobile OTP/Google/bank/payment capability. The user explicitly confirmed full scope while preserving existing data/flows.

## Current verification checkpoint

- Baseline browser suite: 31 passed; maintained frontend unit suite: 36 passed.
- New platform pure unit suite: 6 passed; onboarding browser journeys: 3 passed.
- Effective backend build and existing financial/runtime contracts passed locally. Production patches are build inputs, not unrelated source edits in this branch.
- Actual browser captures include welcome, legacy login, phone, OTP, role choice, profile, PG creation, completion, workspaces, plan, merchant status and invitations. These use clearly synthetic test data, not live OTP/payment confirmation.
- PostgreSQL migration/integration and Android APK/instrumentation verification are pending CI at this checkpoint.

## Work requiring provider access, or not complete

The native Firebase bridge and server exchange are implemented, but actual SMS, signing/App Verification and real Firebase test-number exchanges have not been verified without project configuration.

Subscription reconciliation, cancellation, inclusive-price checks and signed webhook handling are implemented as a disabled integration adapter. A separate custom web authorisation surface, official Custom SDK UPI intent, origin-bound consent/signature APIs, and replacement after a provider-confirmed ended mandate are now implemented. Full merchant sandbox verification is still **not complete**. No Standard Checkout fallback or Android external purchase funnel has been added.

Cashfree merchant onboarding, dynamic bank/KYC submission, signed provider activation and per-owner rent routing are **not complete** without approved Embedded partner access and its contract. The screen is a truthful setup/status gate and does not collect sensitive documents. No code path enables collection from a local status string.

The requested Google sign-in is not implemented; its button is omitted. No simulated identity/merchant/payment success ships with the app.


The second implementation stage adds durable PG-creation drafts/idempotency keys, owner-facing membership revocation (including unused invitations), and a separate web billing build. Android release input checks reject web subscription-authorisation code. Web SDK tests use synthetic provider responses and do not establish live payment readiness. The Android emulator twice disconnected before instrumentation; a bounded-memory AVD and host/runtime diagnostics are being verified in the next run.
