# Validation and delivery evidence

Implementation branch: `codex/safehouse-royal-rebuild`. Pull request: [SafeHouse-PG #9](https://github.com/nikhil23maurya/Safehouse-PG/pull/9).

## Executed checks

- 33 Node unit tests: exact paise display/input, property/month response guards, cache behavior, token refresh sequencing, session expiry, uncertain transport/server errors, property-local financial dates, notification routes and provider-verified payment state transitions.
- 27 Playwright tests: owner/resident sign in, invalid credentials, required password change, logout, expired sessions, network retry, cold-refresh context retention, keyboard focus reveal, property/month selection, resident creation/editing/validation/capacity/duplicates, unsaved drafts, rooms, partial manual payment, interrupted-payment protection, QR preparation/error/expiry/provider-disabled/pending/captured/receipt states, scheduling, campaign actions and notification deep links.
- Four responsive inventories: 32 states × four sizes × full-page/viewport captures = 256 browser screenshots, with horizontal overflow checks. Reduced motion, larger text and landscape checks are included.
- Frontend source/asset checks: one bundled entrypoint, no legacy global CSS overrides, no test fixture payloads or credentials in shipped assets, native property header on receipts, preserved settlement marker and valid JavaScript build output.
- Backend source, schema, migrations, deployment config and package manifest remain byte-equivalent to baseline `52e08b3a578bcca7e1df8701dfb7fa14473d497d`. The existing contract workflow also builds the backend and checks its financial/runtime/notification contracts in CI.
- Read-only live API check on 2026-11-04: `/health` returned 200 and accepted `Origin: https://appassets.androidplatform.net`. This establishes reachability/CORS compatibility, not authenticated or financial end-to-end readiness.

The final commit-specific Android build, signed-debug APK verification, emulator instrumentation results and native screenshots are linked in the PR delivery evidence. The workflow packages test fixtures only in a separate instrumentation APK, not the app APK. APK provenance records the actual checked-out implementation commit; debug signing is explicitly identified as testing.

## Limits and unsupported behavior

- No real financial transaction was initiated. Actual Razorpay QR enablement, signed live/test webhooks, provider settlement/reconciliation, bank debit behavior and receipt download with a real account require an authorized configured test merchant/account. Mocked capture tests prove UI gating and state handling, not live settlement.
- A native UPI app/payment handoff needs an installed supported UPI app and a genuine provider-issued test QR. The bridge is retained with exact-amount checking, bounded decoding and HTTPS provider redirect restrictions; an actual bank handoff is not claimed from fixtures.
- Android notification permission can be tested in the emulator. Actual FCM installation registration, campaign dispatch, scheduled delivery and device receipt need valid backend Firebase configuration and an enrolled device; fixture counts are never described as delivered.
- Android 35 emulator coverage does not establish behavior on every Android version, OEM, physical device, font setting or navigation mode. The manifest retains minSdk 23. Browser sizes and emulator checks supplement, rather than replace, physical-device acceptance.
- A debug/testing APK is not a production release. No release signing key was used, no production app was overwritten, main was not merged, and no backend or infrastructure deployment was performed.
- The current backend has no resident in-app notification archive. The resident page explains Android notification availability without inventing history.
- The owner resident-detail endpoint returns a limited invoice history (12 invoices). The app reports an unavailable older invoice rather than fabricating a historical snapshot or introducing a new backend endpoint.
- Historical file-origin plaintext sessions are not migrated to the new encrypted storage. Users sign in again; subsequent session restoration uses the vault. The testing package is separate from production.

External account/device acceptance remains a release gate. The implementation and available automated checks do not authorize a production merge or rollout.
