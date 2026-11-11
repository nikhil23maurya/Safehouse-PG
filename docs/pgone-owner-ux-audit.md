# PGOne owner and payment UX refinement

Source: PR34, following the November 11 owner/navigation brief. Price remains INR1 per calendar month; historical INR249 orders remain immutable.

## Discovered architecture and defects

The maintained vanilla JavaScript frontend is bundled with esbuild into a Java Android WebView. Its hash/history router, signed-in context keys, resource cache and native bridges remain the integration points. Express/Prisma supplies account sessions, property membership and financial services on PostgreSQL. Build scripts generate additional backend source before TypeScript compilation.

Reduced-motion CSS and Android's disabled animator scale froze loading bubbles. Route skeletons, boot and QR decoding used other indicators. Payment verification was dark and the monthly plan used an oversized blue card. Several bare screens linked to a fixed role/workspace route rather than going back. A payment callback replaced its prior history entry, so ordinary history Back could skip its originating payment page.

Owners saw repeated create-resident, invite-resident and join-as-resident actions. A shared PG code immediately created an unassigned active membership, while the owner could only attach an already manually created resident record. This could not implement approval followed by room/rent setup. The property service already supports multiple properties within the same owner organisation and plan; no new billing rule was needed.

## Resulting route journeys

| Context | Routes and purpose |
|---|---|
| Guest | welcome → signup/login; forgotPassword and legal preserve back navigation |
| First owner | setupProfile → setupProperty → subscription; unpaid workspaces permit property/account navigation |
| Returning owner | workspaces → ownerHome; properties → setupProperty adds another property in the existing organisation |
| Owner requests | ownerHome/residents → residentRequests → residentRequest → accept or reject; accepted → residentRentSetup → resident |
| Existing records | resident → residentEdit modifies the existing record through the established PATCH API |
| Room management | rooms → room/roomForm; review requests replaces manual resident creation |
| Joining resident | joinWorkspace submits own name/mobile/PG code → joinStatus; owner activation exposes Open my PG → studentHome |
| Resident records | studentHome → invoices/history → invoice; profile and notices retain their role guards |
| Payments | subscription/payment → dedicated light verification → provider-confirmed success; Back returns to subscription/invoices without initiating a payment |
| Owner operations | dues, invoice charges, manual receipt recording, ownerPayments, merchantCollections and ownerDirectRent retain their existing financial APIs |
| Account/admin | profile, properties/propertyForm, password, notifications/notificationForm; invitations creates staff invitations only, retaining prior invitation review/revoke support |

Old `residentForm` hashes redirect to edit (with an existing ID) or request review. Old `joinedResidents` hashes redirect to request review. New manual creation UI and POST submission code are removed; historical backend APIs remain for compatibility. Owner workspaces do not offer resident onboarding. Existing explicitly granted resident/staff memberships remain selectable; no memberships are erased or reclassified.

## Loading, payment and navigation

`components/loading.js` provides the three-bubble markup. Route, boot, form, button, QR and verification states share it. The regular animation moves/scales/fades sequentially; reduced motion uses opacity only. Native boot and SDK discovery match these timings, including when Android disables normal animators. Native callbacks stop on detach/window hiding. Browser motion is tested by sampling different frames, not just checking a CSS class.

`product-ux.css` gives payment verification a light background and dark text. The software plan uses a neutral bordered section with INR1 pricing. Web billing bundles these styles and uses the same pending-button indicator. Provider capture, refund and exact-order receipt checks remain authoritative; neither a spinner nor UPI return activates access.

Logical Back parents handle cold/deep routes. Payment result pages return to their payment context because native callbacks replace history entries. Ordinary nested pages keep actual history; unsaved forms and modals are still guarded. Android hardware Back exercises that same handler, including modal cancellation.

## Backward-compatible request data

Migration `20261111150000_resident_requests` adds only `PgResidentRequest`, its indexes, constraints and foreign keys. It enables RLS and revokes direct public/anon/authenticated privileges, matching backend-only access. Existing unassigned memberships receive ACCEPTED setup requests without changing their membership or financial rows. Assigned residents and their history are unchanged.

New requests remain PENDING without financial membership. Owner acceptance changes only request status; rent setup validates owner/password, identity consent, request state, property, room capacity, bed, date, mobile and integer paise. A serializable transaction creates the resident actor, initial rent revision, membership and audit entries once. A canonical setup fingerprint permits identical retries and rejects changed duplicate submissions. The public existing invoice service applies established due-date and historical snapshot rules.

Explicit linking can attach a verified historical resident record, including a fully occupied room, without rewriting its room, rent, deposit, joining date, bed or mobile. Duplicate mobile variants are detected; another account's record cannot be reassigned. Property request lists use scoped cursor pagination; pending requests are not hidden behind active history.

Authentication/session primitives, tenant guard implementations, existing accounting calculations, payment/provider configuration, historical financial rows and subscription pricing are preserved. No production reset, live debit, new provider or signing-key replacement forms part of this work.

## Verification and limits

Acceptance covers PostgreSQL request/approval/activation and HTTP routes; concurrent duplicate processing; cross-owner/property isolation; capacity and invalid inputs; legacy history preservation; multiple properties; reduced-motion and normal animated frames; light payment states; back/modal/unsaved forms; original payment/refund and authentication regressions. CI runs actual installed Android instrumentation, the four-size browser inventory, backend/HTTP and production assembly. Final run IDs and counts belong in the delivery report after the exact merged commit passes.

Provider-approved automatic owner collection remains disabled pending Razorpay Technology Partner/Embedded approval and actual device/provider acceptance. CI is not bank-credit proof. Original production private signing credentials remain unavailable, so a compatible `com.safehouse.pg` upgrade remains blocked; testing APKs are explicitly labelled `com.safehouse.pg.testing`.
