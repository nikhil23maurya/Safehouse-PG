# PGOne email journey release

Base: `ac61834` from main. This branch implements the 10 November 2026 product brief.

## Architecture and boundaries

`PgAccount` is the canonical identity. New accounts receive email/password credentials; names, contact numbers and role intent belong to onboarding. Memberships grant roles. Legacy `User` records remain financial actors. A legacy password or an existing authenticated legacy session is required to map that actor; matching email text never merges identities. Ambiguous historical email claims require operator review. Phone-only accounts without a valid session need assisted ownership recovery, not a mailbox-based claim of historical memberships.

Add nullable unique normalized credential email, password hash, revocable rotating sessions and hashed single-use email action tokens. Existing email/contact columns and financial identifiers stay intact. No production reset or destructive data cleanup.

Change platform auth, invitations, mobile navigation, email auth screens, native phone bridge and billing lifecycle. Preserve rent calculations, payment posting, receipt history and original signing identity. Retire Cashfree entry points and customer screens; preserve historical provider records.

## Release gates

- Isolated PostgreSQL migration and legacy-preservation tests, auth/recovery/session replay tests, invitation/tenant tests and payment regression tests.
- Browser and actual Android emulator journeys, visual inspection and explicit provider integration evidence.
- Email delivery requires an operator-owned verified sender and mail credential; never simulate delivery in production.
- Razorpay capture is the only plan-payment proof. Unapproved per-owner automated settlement stays unavailable. Manual rent records remain usable.
- Play purchase distribution requires separate Play Billing integration/enrollment; internal/sideloaded checkout is not advertised as Play compliant.
- Original production signing credentials and old APK certificate/version remain required before an upgrade-compatible production release can be published.
