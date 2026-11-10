# PGOne 5.2.2 checkout and layout correction

On 10 November 2026 the reported checkout error was reproduced against the live
Razorpay payment-create endpoint with an isolated unpaid audit workspace and its
real server-created INR 24900 order. The previous Android payload omitted contact
when an email/password account had no optional profile phone. Razorpay returned:

```
BAD_REQUEST_ERROR
Could not validate payment create request due to: contact: cannot be blank.
reason: input_validation_failed
```

Submitting that same audit order with a provider fixture contact in E.164 format
returned HTTP 200 with a payment ID, UPI intent URL and native-intent handoff.
This validates request acceptance. No UPI app was launched or authorised, no PIN
was entered, and no debit/capture or completed subscription is claimed.
The audit creates one isolated unpaid account/property/order; it does not clear
or modify other users' data. No audit password or token is retained in this report.

The payment screen now collects a real payer contact before creating an order.
Blank or malformed contacts never reach the order endpoint or the native SDK.
The native adapter independently checks and normalizes the contact, submits only
documented payment fields, and extracts a readable provider description from an
error envelope before redaction. Email/password registration remains unchanged.
No placeholder phone number is inserted for a real customer.

Checkout still uses the official Custom SDK. It does not use UPI Collect or
Standard Checkout. Returning from UPI never activates a plan: the existing
authenticated backend reconciliation/capture rules remain authoritative.

The UI correction removes repeated marketing copy and explanations, replaces
oversized onboarding spacing, removes the duplicate resident invoice summary,
limits dashboard lists to three entries with links to their full lists, and keeps
secondary payment details in accessible expandable sections. Necessary debit and
bank-confirmation information remains visible. Direct-owner rent uses UPI first;
its optional QR and bank-reference submission remain available.

Layout checks cover 360x640, 393x786 and 412x840. Initial sign-in, signup, role,
profile, property and activation screens fit without forced scrolling at default
text size. Large text remains scrollable and controls remain reachable. Dashboard
quick actions are checked against the fixed bottom navigation, not just viewport
bounds. Long lists and multi-field operational forms naturally remain scrollable.

Regressions cover contact normalization/rejection, absence of order creation for
invalid contact, keyboard submission, disabled duplicate submission, native
blank-contact rejection, official SDK field validation and provider error
redaction, in addition to the existing auth, tenant and financial tests.

Build identity is 5.2.2, versionCode 55. An installable testing artifact uses
`com.safehouse.pg.testing` and testing/debug signing. The original production
private signing key remains unavailable. No replacement production key is
created and no testing APK is represented as an upgrade-compatible production APK.
