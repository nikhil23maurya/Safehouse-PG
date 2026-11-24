# PGOne loader, collection status and evidence review

This change starts from main eaa16b4. It preserves the current software price,
email/password accounts, owner/resident access, provider configuration and rent
calculation. No Cyntrova code is involved.

The shared web indicator uses the supplied three spans: 25px dots, 12px gap,
#4169E1, 1.65s breathing with -440/-220/0ms delays, scale .2 to1.08 and opacity
.55 to1. The native loader matches in device-independent pixels. Reduced-motion
mode disables the animation as requested. Buttons preserve geometry; small
controls use a separate status pill instead of squeezing three dots inside an
icon. Existing verification pages retain their shared loader visibility hooks.

Rent submitted for review appears in amber, separately from confirmed received
amounts in green. Pending proof never contributes to collected rent or its
confirmed progress. Outstanding remains unchanged until actual confirmation.
Electricity appears immediately below rent. The dashboard has one compact proof
inbox rather than repeating proof cards. Full evidence remains behind explicit
expand controls and authenticated image reads. Older backend fallback retains
its established received-only summary when proof totals are unavailable.

Owners confirm a screenshot-only payment without typing a UTR. An explicit bank
credit check remains mandatory. Bulk selection sends an exact integer total;
the server validates property, billing month, current proof, balances and total
inside the same transaction. A failed member rolls back the entire group.
Historical references retain their original duplicate guard. New reference-free
confirmations use a payee-bound screenshot fingerprint as the unique bankKey;
they do not create invented bank references. An identical screenshot cannot
confirm two new reference-free payments to the same payee. A different/cropped
image cannot be automatically matched to a bank credit: the owner must still
check the bank. This is manual confirmation, not automatic bank reconciliation.
The migration only removes the approved-proof UTR requirement; it keeps existing
reviewer/time, state, receipt, allocation and unique-key constraints and does not
rewrite historical financial records.

The original waist-up cutout was rejected in preview. The replacement is a
complete seated manager-and-phone scene, with feet/base visible and the current
PGOne logo. The source was generated with the built-in image tool, then converted
to a bounded WebP retaining alpha. It uses containment rather than a cropped
portrait. The header offers the existing Sign in route; role actions remain
direct and grouped. Other screen artwork is unchanged. Project asset:
mobile/frontend/src/assets/illustrations/pgone-guide.webp.
Generation direction: one welcoming Indian PG manager in a navy shirt and ivory
trousers, whole body and feet visible, seated beside a front-facing phone; current
blue house/bed, golden windows and swoosh, PGOne wordmark on white; compact scene
on transparency, no fake financial figures.

The welcome composition follows the guidance to show value before actions, avoid
unnecessary onboarding steps, group related controls, preserve a direct sign-in
path and account for different screen sizes. The illustration style is a product
design choice, not a claim that these sources prescribe particular artwork:
https://developer.android.com/design/ui/mobile/guides/patterns/onboarding
https://developer.android.com/design/ui/mobile/guides/layout-and-content/layout-basics
https://www.nngroup.com/articles/mobile-app-onboarding/

The launcher display name is PGOne. Package identity, debug/release identity and
signing compatibility remain explicit in build metadata. Changing the display
name does not restore the unavailable original production private signing key.
No replacement production key or claim of a compatible signed upgrade is made.
