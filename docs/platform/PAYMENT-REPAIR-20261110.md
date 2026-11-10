# PGOne payment repair

Mobile is UPI-first per the latest user instruction. QR is optional, behind Pay from another phone, for direct-owner transfers. The existing authorized provider-issued QR path remains intact.

Native plan checkout is now a durable operation outside a screen lifecycle. Official Razorpay method availability and installed-app discovery precede the app chooser; the provider WebView remains hidden until submission. The native adapter returns a bounded, redacted failure/status and persists it through screen replacement or process recreation. No native return grants access. The backend still requires the exact captured INR 249 payment.

Direct rent status is now a read-only GET. Preparing a transfer is explicit. Every launch revalidates current invoice balance and the owner's payee revision. Existing uncertain requests are not silently rewritten or replaced. Changed amounts/destinations block the stale transfer. Confirmed claims can be read after the invoice is paid. A failed native launch returns an acknowledgement so it can be retried; an uncertain launched attempt requires checking the bank first.

The user explicitly requested wiping all old PGOne data, no backup, because there are no real users. `docs/operations/RESET-PGONE-DEMO-DATA.sql` is a one-time operator action against the specific SafeHouse project. It is never run by app startup, migrations or deployment. It preserves schema/migration history/RLS and has no CASCADE. CI tests it only on the separate restored synthetic database. Production execution must be independently verified and recorded; preparing the SQL is not proof it ran.

Fresh platform startup does not auto-create the old fixed bootstrap owner. New owners register through canonical email/password signup. Old `/api/auth/login` clients receive an explicit APP_UPDATE_REQUIRED before any credential migration instead of a success payload their APK cannot consume. Current app sign-in uses `/api/platform/auth/login`. This is an intentional fresh-install boundary requested with the data reset; no backward-compatible old APK is claimed.

Recovery UI checks live availability and does not promise email delivery when it is disabled. Capability retries bypass the bounded configuration cache. Signout clears the account-bound checkout UI state.

Validation includes frontend failures/navigation, real backend HTTP guards, partial-receipt/payee-change/settled-claim tests, actual Android SDK discovery, native chooser/submission/error adapter contracts and exact decoding of the optional owner QR. Adapter fixtures do not establish a genuine bank payment. Real merchant capture and a physical-device handoff remain separate acceptance evidence.

External limits: automatic Razorpay Route owner-bank settlement still needs approved provider access and its dedicated account/transfer/reversal integration. No ordinary gateway flag is a substitute. Original production signing remains unavailable; no replacement production key was generated. CI debug APKs are ephemeral test artifacts, not compatible production upgrades. Do not publish one as a final production release.
