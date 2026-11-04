# Implementation and acceptance checklist

- [x] Reconstruct the complete effective legacy frontend and native source.
- [x] Inspect workflow, frontend patches, native integrations, backend routes, schema and financial settlement.
- [x] Inventory screens and document architecture decision.
- [x] Maintain readable frontend and Android sources; remove patches from build inputs.
- [x] Shared theme, primitives, icons, skeletons, errors, dialogs and form states.
- [x] Startup, sign in, restoration, expiry, role guards and password changes.
- [x] Owner dashboard and property/month context.
- [x] Resident dashboard, residency and invoice history.
- [x] Resident directory, detail, create/edit/status/reset-password.
- [x] Rooms, occupancy, detail, create/edit and capacity rejection.
- [x] Dues, invoice breakdown/charges, manual payments, histories and receipts.
- [x] QR preparation/image loading, pending/verifying/expired/failed/unavailable/delayed states.
- [x] Captured-payment-only success and receipt refresh.
- [x] Notification setup, creation, audiences, schedules and campaign actions.
- [x] Android insets, keyboard, back, resume, protected assets and secure storage.
- [x] Unit/API/payment regression tests and browser journey tests.
- [x] Screenshots at 360x800, 393x852, 412x915 and 480x960.
- [x] Reduced motion, larger text, landscape, keyboard and network failures.
- [x] Gradle build, APK ZIP/signature verification and downloadable artifact.
- [x] Android install/launch/instrumentation where available.
- [x] Confirm backend/schema/deployment and Cyntrova are unchanged.
- [x] Commit implementation branch, open PR and report exact validation limitations.

## Final evidence review

- [x] Current implementation: 33 unit tests and 27 browser journeys pass.
- [x] Current implementation: Android build, APK checks and native instrumentation pass.
- [x] Download and visually review the final native screenshots, including the keyboard fix.
- [x] Verify the downloaded APK hash, ZIP and packaged assets against the maintained build.
- [x] Record exact commit, run and artifact links in the validation report.

## External release acceptance

These steps require configured test accounts/devices and are not claimed by fixture tests:

- [ ] Genuine provider-issued QR and installed UPI app handoff.
- [ ] Authorized test-merchant capture, webhook settlement and real-account receipt download.
- [ ] Configured Firebase registration, scheduled dispatch and device delivery.
- [ ] Physical-device/OEM acceptance and production release signing.

See [validation evidence and limits](VALIDATION.md). No main merge or production rollout is included.
