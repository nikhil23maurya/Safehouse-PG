# Direct owner UPI and independent electricity bills

PGOne's software fee is INR159 per calendar month, paid manually. Historical
INR1/INR249 orders and receipts retain their original amounts. The software fee
remains separate from rent. Owners save their own receiving UPI ID;
no new owner gateway account, KYC screen, pooled rent or split settlement is
introduced. The backend advertises `directRentProof:true` after its compatible
migration. New Android builds use that flow; older backends retain their earlier
behaviour until upgraded. Existing provider reconciliation and old records remain.
New Android builds also advertise supported native plan amounts. Older SDKs
that cannot submit INR159 receive UPGRADE_REQUIRED instead of being offered an
incompatible checkout. Existing access, receipt history and web billing remain.

## Resident flow

The server supplies the existing fixed monthly rent balance. A resident submits
their final electricity amount in rupees plus a clear meter image; there is no
invented per-unit rate, shared-meter calculation or automatic meter OCR. A new
electricity bill cannot duplicate electricity already included in an old invoice.

Rent, electricity or both can be selected. Independent pending transfers reserve
only their own charge. Rent can be paid first, electricity added after rent is
fully paid, or electricity paid first. Combined transfers snapshot two separate
allocations. Electricity is a separate subledger; paid historical rent invoices
are not reopened, retotalled or repurposed for later electricity.

UPI receives the server's payee and amount; an external payment app can still
reject a personal VPA, edit amounts, fail or omit an automatic return. Copy-UPI
and copy-amount remain available. The application never treats an app callback
or screenshot as a bank-credit signal.

The account/workspace-scoped transfer reference is persisted on Android before
handoff. Activity result, resume or cold launch restores the same proof screen,
without initiating a new transfer. It says Attach payment proof, then Owner
confirmation pending. The resident submits a payment screenshot and UTR. A
cancelled UPI result is not failure or success: it offers evidence if already
debited and a clearly confirmed no-debit path to change the selection.

## Owner review and records

Owners see their property's resident, billing month, amount split, receiving VPA,
meter photo and immutable proof history. Approval explicitly requires checking
the full bank credit and electricity evidence. Rejection appends a reason and
does not credit either bill. Corrected evidence is a new version; an old rejected
proof cannot approve a later submission.

Confirmation is serializable and idempotent. The rent allocation creates one
existing MANUAL/BANK_TRANSFER Payment and updates its original rent invoice;
the electricity allocation marks its independent bill paid. Both allocations,
proof decision, receipt and audit commit atomically. A combined receipt states
the split and must not be added again to the original rent receipt. If an owner
already manually recorded the rent, an exact unlinked receipt can be attached
without a second credit. A changed balance otherwise stops confirmation.

Only one unresolved transfer per rent allocation/electricity bill is allowed.
Confirmed recipient-VPA + UTR fingerprints cannot be reused across transfers.
Changed payee/balance disables old handoff; proof of an already sent transfer
still remains reviewable against its original payee. No submitted proof can be
cancelled to silently clear an uncertain debit.

## Evidence and storage

Four new private RLS tables contain bills, transfers, proof versions and images.
Existing schema fields/enums and historical data are preserved. Image input is
re-encoded by a local canvas into JPEG (up to 1600 pixels) without EXIF. The
server verifies JPEG structure, dimensions, canonical base64 and 512-KiB limit;
it strips metadata/comments, hashes and deduplicates images. SVG/HTML/URLs and
unbounded files are not accepted. Uploads are rate/quantity limited.

Evidence bytes are stored in the new private table, avoiding public buckets or
another production credential requirement. Reads require the exact resident or
property owner; owners can access only attached evidence. No public URLs or
image payloads are included in list/audit responses. Images use no-store and
nosniff. At larger volume, move the same evidence-service interface to a private
object store with an agreed retention policy; monitor database bytes meanwhile.
No automatic deletion or retention duration is invented in this change.

Android's image picker requests a single user-selected content URI, without
broad storage permission. File URLs stay disabled. Test providers, gateway
responses and image fixtures are instrumentation-only, never application assets.

## Scope and release checks

Authentication/session, tenant guard implementations, existing gateway/capture
and subscription logic, rent calculation and Cyntrova are unchanged. Ordinary
historical manual/provider paths remain. New code and all synthetic financial
tests run only against isolated PostgreSQL; no live charge or data reset is part
of this work. Actual UPI-app acceptance/bank credit require a separately
authorised physical-device transaction. Original production signing credentials
remain required for a compatible production APK; testing builds are labelled.
