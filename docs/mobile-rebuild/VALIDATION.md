# Validation and delivery evidence

Implementation branch: `codex/safehouse-royal-rebuild`. Pull request: [SafeHouse-PG #9](https://github.com/nikhil23maurya/Safehouse-PG/pull/9).

The 2026-11-05 login, motion and QR/UPI follow-up is described in [LOGIN-QR-POLISH.md](LOGIN-QR-POLISH.md). Its commit-specific CI, native screenshots and fresh APK are recorded in the PR. The results below retain the original rebuild baseline.

## Executed checks

- 33 Node unit tests: exact paise display/input, property/month response guards, cache behavior, token refresh sequencing, session expiry, uncertain transport/server errors, property-local financial dates, notification routes and provider-verified payment state transitions.
- 27 Playwright tests: owner/resident sign in, invalid credentials, required password change, logout, expired sessions, network retry, cold-refresh context retention, keyboard focus reveal, property/month selection, resident creation/editing/validation/capacity/duplicates, unsaved drafts, rooms, partial manual payment, interrupted-payment protection, QR preparation/error/expiry/provider-disabled/pending/captured/receipt states, scheduling, campaign actions and notification deep links.
- Four responsive inventories: 32 states × four sizes × full-page/viewport captures = 256 browser screenshots, with horizontal overflow checks. Reduced motion, larger text and landscape checks are included.
- Frontend source/asset checks: one bundled entrypoint, no legacy global CSS overrides, no test fixture payloads or credentials in shipped assets, native property header on receipts, preserved settlement marker and valid JavaScript build output.
- Backend source, schema, migrations, deployment config and package manifest remain byte-equivalent to baseline `52e08b3a578bcca7e1df8701dfb7fa14473d497d`. The existing contract workflow also builds the backend and checks its financial/runtime/notification contracts in CI.
- Read-only live API check on 2026-11-04: `/health` returned 200 and accepted `Origin: https://appassets.androidplatform.net`. This establishes reachability/CORS compatibility, not authenticated or financial end-to-end readiness.

## Verified build and artifacts

The original rebuild baseline was tested at [`a3e91dd3dece32ef8baf5d344b3008abf6f8a0f6`](https://github.com/nikhil23maurya/Safehouse-PG/commit/a3e91dd3dece32ef8baf5d344b3008abf6f8a0f6). These baseline artifact links do not include the subsequent 2026-11-05 polish; use the current PR delivery links for that APK.

| Evidence | Verified result |
| --- | --- |
| [Android/frontend run 41864070320](https://github.com/nikhil23maurya/Safehouse-PG/actions/runs/41864070320) | Both jobs passed on 2026-11-04; 33 unit tests and 27 browser tests |
| [Backend contract run 41864070148](https://github.com/nikhil23maurya/Safehouse-PG/actions/runs/41864070148) | Existing backend build and contracts passed |
| [Download testing APK](https://github.com/nikhil23maurya/Safehouse-PG/actions/runs/41864070320/artifacts/13340962607) | Debug signed, version 5.0.0/code 50, package `com.safehouse.pg.testing` |
| [Android diagnostics](https://github.com/nikhil23maurya/Safehouse-PG/actions/runs/41864070320/artifacts/13340723630) | Build/signature/ZIP/identity reports, cold-start video, instrumentation log and 30 screenshots |
| [Browser visual evidence](https://github.com/nikhil23maurya/Safehouse-PG/actions/runs/41864070320/artifacts/13341996013) | 256 screenshots, browser test report and build metadata |

APK filename: `SafeHouse-5.0.0-testing-a3e91dd3dece.apk` (4,675,761 bytes).

```text
SHA-256: 091dc6ef5fd9aca5b9c9a36138d9d028edc56b2fb995d9c52b5b750e64532400
```

The downloaded APK hash matches its sidecar; ZIP integrity passed locally, and `app.js`, `app.css` and `index.html` are byte-identical to the maintained frontend build. CI verified v1/v2 debug signatures and the separate testing package identity. Test fixtures and the deliberately invalid QR recipient are packaged only in the instrumentation APK, not the application APK. GitHub artifact access requires repository access; retention is 30 days.

## Native visual and interaction review

Android 35 instrumentation passed (`OK (1 test)`, 52.067 seconds). This single native journey covers encrypted session persistence and restoration, keyboard focus, owner/resident navigation, unsaved-draft retention through rotation, notification permission, 130% text zoom, QR image loading and captured-payment fixtures, hardware back and background/resume. Core success/failure/financial assertions additionally run in the unit and browser suites.

All 30 native screenshots were reviewed. The focused password field remains above the keyboard; longer forms and the sign-in action remain scrollable with the keyboard open. Rotation retains the entered draft. The notification permission prompt and subsequent allowed state are captured. Dashboard amounts, QR, verified-success fixture, receipt history and resumed paid dashboard render consistently. Browser evidence covers all 32 documented states at four sizes, including screens that require scrolling on the native device.

The 11.16-second cold-start recording was decoded and inspected from the system house mark through the native wordmark reveal to sign-in. The emulator's `am start -W` reported `LaunchState: COLD`, `TotalTime: 5272` ms; this measures activity launch, not web-content readiness. It does not establish the requested 700–1200 ms perceived startup target on physical hardware. No fixed readiness delay is added by the app. Physical-device startup profiling remains part of release acceptance.

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
