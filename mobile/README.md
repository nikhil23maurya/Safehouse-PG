# SafeHouse Android

The maintained app consists of `frontend/src/` and `app/src/main/`. The old Base64 archives and UI patch scripts are historical material; neither Android workflow consumes them. Backend prebuild scripts remain separate and unchanged.

## Local frontend checks

```sh
cd mobile/frontend
npm ci
npm test
npm run build
npx playwright install chromium
npm run test:e2e
```

`npm run serve` opens a local preview at `http://127.0.0.1:4173`. The normal preview uses the real public API; use the browser tests for controlled fixtures. Never use a live account to create financial test data without approval. Browser previews keep credentials in memory and intentionally do not persist sessions.

## Android testing build

Use Java 17, Gradle 8.9, Android platform 35 and build-tools 35.0.0. Native dependencies retain the previous supported versions. After `npm ci` in `frontend`, run:

```sh
cd mobile
gradle :app:assembleDebug
```

Gradle invokes the maintained frontend build before packaging. The output is `app/build/outputs/apk/debug/app-debug.apk`. This is a **debug/testing APK**, with application ID `com.safehouse.pg.testing` and app label **SafeHouse Testing**. It installs alongside the current production app. It is not a signed production release, and its debug signing identity can differ between build environments.

The GitHub workflow verifies ZIP integrity, APK identity and signature, generates SHA-256/provenance records, and uploads a commit-specific artifact. It never commits build outputs or pushes to main. Pull-request and branch builds check out the actual implementation SHA.

## Instrumentation

```sh
cd mobile/frontend
node prepare-android-tests.mjs
cd ..
gradle :app:assembleDebug :app:assembleDebugAndroidTest
```

`scripts/android-smoke.sh` installs both APKs in an Android 35 emulator and executes the separate test APK. Network fixtures, a deliberately invalid test QR recipient and test sign-in credentials exist only in test tooling/the instrumentation APK. The app APK never bundles them. Native screenshots, cold-start recording, launch timing and instrumentation diagnostics are uploaded separately.

## Sessions and navigation

Android credentials are encrypted using AES-GCM with an Android Keystore key. The app uses a restricted HTTPS asset origin and disables arbitrary file/content access. Old file-origin Web storage is not migrated into the new encrypted vault; users moving from the historical app must sign in again. The separate testing package has its own independent session.

Property/month context is captured per request. The backend owns roles, capacity, invoice snapshots, rent revision periods, payment settlement and notification scheduling rules. UI route guards supplement backend permissions. Orientation changes retain the WebView and in-memory form draft. Payment app-return callbacks only trigger a server status check.

See [architecture and screen inventory](../docs/mobile-rebuild/ARCHITECTURE.md), [screen changes](../docs/mobile-rebuild/SCREEN_CHANGES.md) and [validation](../docs/mobile-rebuild/VALIDATION.md).
