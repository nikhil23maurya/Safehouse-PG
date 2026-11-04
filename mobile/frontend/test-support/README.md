# Test-only payment image

`qr-fixture.png` encodes a controlled UPI-shaped fixture with the deliberately invalid recipient `safehouse.fixture@invalid`. It is not a real payment request. It is served only by browser interception and the separate instrumentation APK; it is never an input to the app asset build.

The installed app always obtains its QR image and amount from the real backend. Actual merchant QR availability, bank settlement, UPI app handoff and FCM delivery require a configured test merchant/device and are not established by these fixtures.
