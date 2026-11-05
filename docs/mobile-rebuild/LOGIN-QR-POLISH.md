# Login, motion and QR/UPI polish — 2026-11-05

The follow-up is limited to the Android app and its frontend/test tooling. Backend authentication, permissions, payment creation/capture/reconciliation, database and production configuration remain unchanged. Cyntrova's checkout is untouched.

## Changes

- Compact sign-in layout: one-line heading, quieter labels, comfortable inputs and a keyboard-safe action. A locally bundled Inter variable font (with its SIL OFL license) and more restrained heading weights refine the existing royal-blue/white theme throughout the app.
- Short, coordinated entry transitions; Android startup hands off only after the WebView has presented its frame. Reduced-motion settings still disable transitions.
- Payment polling updates status text without replacing the QR or focused action. Busy actions restore focus when appropriate.
- Android detects the QR matrix inside the provider poster instead of displaying a whole branded sheet or relying on guessed crop coordinates. It adds a four-module quiet zone and integer scaling, then decodes the square again and requires an exact match with the original provider payload. Amount, currency and unambiguous payee/amount fields are checked. No destination or transaction data is constructed by the client.
- The same verified square is saved to Pictures / SafeHouse for gallery scanning. The provider poster is not downloaded as the payment QR.
- UPI handoff checks the backend state first, passes the unchanged decoded provider URI, checks Android-compatible handlers and rejects expired QR launches. Repeated taps are blocked. Missing-app errors remain visible with a useful save/scan fallback. App launch/return never establishes payment success.

The Android resource endpoint for the square is app-local, provider-host restricted, bounded and backed by a single-image cache keyed by provider URL and exact amount. Its loader is replaced only by the separate instrumentation APK for controlled tests. The production app contains no test recipient or fake UPI activity.

## Verification cases

Browser coverage adds bundled-font/compact-keyboard checks, single-flight UPI launch with unchanged invoice context, missing-app fallback/save arguments and stable QR/action/focus through pending reconciliation. The full browser suite includes 31 journeys and the existing four-size screenshot inventory. Existing 33 unit tests retain the financial-state gates.

Android coverage adds tall-poster extraction and square re-decoding, exact provider reference/signature preservation, amount/currency/duplicate-field rejection, provider/cache isolation, unreadable-image rejection and byte-equivalent gallery saving. The installed-app journey exercises no-app handling plus a test-only compatible UPI receiver through the real Android chooser, then returns to an unpaid/pending invoice.

The test receiver and poster have a deliberately invalid payment recipient. They make no financial calls. These tests cannot prove acceptance by Google Pay, PhonePe or a bank; authorized merchant/device acceptance remains necessary. Screenshots shared from these journeys are fixture data and are labelled accordingly.

Font source and hash: [fonts/README.md](../../mobile/frontend/src/assets/fonts/README.md). Current build, screenshots, checks and testing-APK links: [PR #9](https://github.com/nikhil23maurya/Safehouse-PG/pull/9).
