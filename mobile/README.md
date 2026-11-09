# PGOne Android app

> PGOne is a mobile-first PG and hostel management product for property owners and residents. The premium onboarding expansion adds isolated platform APIs and verified phone-identity support behind disabled-by-default feature flags. Existing rent settlement and legacy account access are preserved. See [activation and remaining provider gates](../docs/platform/ACTIVATION.md).

## App identity

- Product name: **PGOne**
- UI/launcher/splash identity: **PGOne**, using the same icon geometry and royal-blue + navy colors as the marketing website.
- Debug/testing label: **PGOne Testing**.
- Existing Android application IDs (including `com.safehouse.pg.testing`) and Java package namespace are **retained for compatibility**. These are technical identifiers, not the customer-facing brand.
- The legacy `SafeHouseNative` JavaScript bridge names, Firebase registration identifiers, server URL, and payment callback names are stable integration contracts. Do not rename them as part of a cosmetic rebrand.

## Structure

- `mobile/frontend/src/` — maintained, readable HTML/CSS/JavaScript application and components.
- `mobile/frontend/src/components/icons.js` — canonical PGOne web-component logo, identical geometry to `docs/branding/pgone-mark.svg`.
- `mobile/app/src/main/res/drawable/ic_launcher.xml` — Android vector launcher icon.
- `mobile/app/src/main/java/com/safehouse/pg/BrandSplash.java` — custom PGOne startup animation.
- `mobile/frontend/build.mjs` — compiles the maintained frontend into Android WebView assets.
- `mobile/app/src/main/java/` — native session, notifications, QR/UPI integrations.
- `docs/mobile-rebuild/` — implementation/validation details and constraints.

## Local frontend checks

Requires Node and npm:

```bash
cd mobile/frontend
npm ci
npm test
npm run build
npm run test:e2e
```

Browser tests require Playwright's Chromium browser (`npx playwright install chromium`). For Android testing, use Java 17, compatible Gradle and Android SDK 35; the GitHub Actions workflow provisions these dependencies.

## Building an APK

GitHub Actions: **Build PGOne Android APK** (`.github/workflows/build-mobile-apk.yml`). A push to `main` that changes the mobile source triggers frontend and Android validation. Successful runs upload a commit-specific `PGOne-testing-APK-<sha>` artifact.

The artifact contains `PGOne-5.1.0-testing-<sha>.apk`, checksum, Android package metadata and signing diagnostics. **This is a debug/testing build**, not a release-signed production APK. It installs separately from a release package. GitHub artifact download may require repository access.

## User journeys

Owners can sign in, select properties, manage rooms and residents, review monthly dues, reconcile payments and access property reports; residents can view invoices, payment history and receipts, and initiate configured payment flows. Existing notification integrations are retained.

## Financial correctness

- Existing `SAFEHOUSE_QR_SETTLEMENT_V2` backend verification and settlement logic remain unchanged.
- Only backend-confirmed, captured payments become paid.
- Do not rely on Android UPI app return, a screenshot, or a button click to establish payment success.
- The payment provider and bank acceptance must be verified separately on real configured accounts before any public release.

## Production release gates

A production release requires a managed release keystore, release signing, Google Play or trusted distribution compliance, verified UPI merchant settlement, FCM delivery, physical-device/OEM testing, support and privacy policy. The production package ID should be decided as a **separate migration decision**; never silently change it or lose push notification/session compatibility.
