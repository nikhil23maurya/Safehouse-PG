# PGOne owner-specific Razorpay payments

PGOne earns its separate INR249 calendar-month software fee. Resident rent belongs to the owner's independently approved merchant account. The owner-rent adapter never uses the software-fee merchant's key/secret, never sends a Route transfer/application fee and never falls back to the PGOne collection account. This implementation requires Technology Partner / Embedded Payments approval; the founder's current Reseller account does not establish access. Live activation remains pending.

## Provider-approved onboarding

Use Razorpay's hosted co-branded OAuth experience, launched from Connect payment account inside PGOne. It supports an existing merchant login or new merchant signup. Razorpay handles required business information, KYC, bank details and terms. PGOne stores no PAN, document images or full bank number. Custom pre-fill onboarding APIs are separately enabled on demand and are not assumed or called by this integration. No alternative settlement architecture or Route is introduced.

Owner flow: select an owner workspace, activate the PGOne plan, Connect payment account, confirm authority to connect the legal payee, finish Razorpay's verification/consent, return to PGOne, refresh account status. A submitted form or OAuth code alone cannot activate rent collection. Bank maintenance remains in Razorpay's secure merchant interface; PGOne provides Manage bank with Razorpay and re-verifies/audits destination changes.

## Authoritative mapping and financial boundaries

PgMerchantAccount remains the organisation's parent record. Historical Cashfree fields/rows remain unchanged. New PgOwnerAuthorization rows hold independent Razorpay connection generations and environment, with unique merchant ID per mode and a unique current connection per organisation/mode. Different owner organisations cannot claim one merchant account. Multiple properties of one legal owner organisation resolve to the same approved connection. The configured software-fee merchant ID is explicitly excluded.

OAuth state is random, hashed, expiring and single-use, bound to the initiating owner, organisation and active PGOne session. The callback rechecks the active session/owner before persisting credentials. Access and refresh tokens use AES256-GCM with connection/purpose-bound authenticated data. Refresh uses a lease and version comparison; disconnect stops PGOne collection before provider revocation. No token or secret reaches Android. The public OAuth checkout token is returned only for that resident's authorised invoice order.

Known provider statuses map to NOT_CONNECTED, ONBOARDING_STARTED, DETAILS_SUBMITTED, KYC_PENDING, ACTION_REQUIRED, UNDER_REVIEW, VERIFIED, ACTIVATED, REJECTED, SUSPENDED and DISABLED as applicable. DRAFT is reserved for provider-supported draft collection; no fictitious draft or linear approval progression is shown. GET account status and its documented live/hold_funds flags govern acceptance/settlement; an explicit pending bank verification blocks readiness. Product activation must be verified for this account with UPI enabled and automatic capture. Unknown/missing required capabilities fail closed. Masked bank last-four and a keyed fingerprint are the only retained settlement-destination data. Provider-confirmed settlement readiness is not a separately claimed bank-name/penny-test result.

Resident flow: assigned active resident, owned invoice, server-resolved organisation/merchant, authoritative capability check, serializable invoice reservation, owner-context order, official Custom SDK UPI Intent, immediate branded verification, provider fetch, exact captured receipt. No UPI Collect or manually entered recipient. Native result, screenshot, UTR and app return never credit rent. Unassigned residents have no financial access.

An uncertain create retains one receipt/reference and recovers the same provider order. It never blindly retries POST or creates another order. Explicit rejected requests that did not create an order can release their reservation. Pending/authorised attempts cannot submit again; a reconciled failed submission can reuse the same provider order. Database guards prevent concurrent legacy QR/direct/manual channels while an embedded order reserves the invoice. Changed invoice terms, mismatched capture, inconsistent refunds or extra captures remain REVIEW_REQUIRED and require provider/owner reconciliation, never silent invoice credit or another payment request.

Captured rent posts one immutable existing Payment receipt with source RAZORPAY and a separately bound owner application. Financial amounts are integer paise. Processed full/partial refunds append independent records and unwind net invoice credit exactly once, preserving the original receipt. Pending/failed refunds do not reduce collected rent. The PGOne entitlement/fee receipt tables are not modified by rent reconciliation.

## Webhooks and recovery

Application webhook: https://safehouse-api.onrender.com/api/owner-payments/webhook . It receives the exact raw body before JSON/workspace middleware, verifies HMAC-SHA256 with the independent application webhook secret, rejects the fee merchant and conflicting event IDs, and quickly returns202 after durable inbox storage. Only minimal references and recognised flags are retained; account payload PAN/bank/KYC fields are discarded. Provider current state is fetched using the bound owner's Bearer token. Events may arrive before the owner callback and remain queued for retry.

Configure the available approved application events: account.activated, account.under_review, account.needs_clarification, account.suspended, account.rejected, account.app.authorization_revoked, product.payment_gateway.activated, payment.authorized, payment.captured, payment.failed, order.paid, refund.created, refund.processed, refund.failed and settlement.processed. If an event is not exposed on the approved application, obtain the provider's supported alternative before activation; no invented event is required.

Persistent inbox leases, retry/backoff and review states support repeated delivery and multiple API instances. The worker rechecks open orders and round-robins historical captures for missed/late refunds, with a bounded recent settlement-recon lookback. The owner can request a specific day's settlement reconciliation. An old settlement outside that lookback requires an explicit date recheck or replayed provider event; no bank-credit status is inferred from missing reports. Monitor pending/review backlog and age before scaling workers; leases and idempotent transactions make repeated processing safe.

Bank settlement batches are independent from resident payment success. A payment is linked to a batch only by an exact merchant-scoped reconciliation row. Razorpay settlement processed means sent to bank and may precede bank credit. The UI says Sent to bank and shows UTR; it does not claim actual bank credit. The API's creation time is not used as bank-credit time. Merchant batches may include receipts outside PGOne; per-payment allocations identify PGOne rent. Failed/held settlement does not reverse an otherwise captured resident payment.

## Activation settings — leave disabled until approved

No production setting is changed by this branch. Use the existing backend secret manager (Render encrypted environment settings in this deployment). Never put these in Android, Git or chat:

```dotenv
RAZORPAY_OWNER_MERCHANT_ONBOARDING_ENABLED=false
RAZORPAY_OWNER_MODE=live
RAZORPAY_OWNER_CLIENT_ID=<production OAuth application client ID>
RAZORPAY_OWNER_CLIENT_SECRET=<production OAuth application client secret>
RAZORPAY_OWNER_TOKEN_KEY=<persistent independent 64-hex-character AES key>
RAZORPAY_OWNER_WEBHOOK_SECRET=<independent application webhook secret, at least 24 characters>
RAZORPAY_OWNER_REDIRECT_URI=https://safehouse-api.onrender.com/api/owner-payments/callback
PGONE_SUBSCRIPTION_MERCHANT_ACCOUNT_ID=<actual acc_ ID of the existing INR249 merchant>
```

The requested OAuth scope is read_write, which is needed for owner orders and reads. No RazorpayX, payout, Route or fee-splitting scope is requested. Confirmation of API/product access is still required; a configured flag is not evidence of approval. Invalid optional configuration disables only this feature and leaves existing login/fee/manual flows available. Test/live connections are separate. Test-mode captures cannot post production rent; isolated tests use NODE_ENV=test and a synthetic database.

Protect the AES key through backup/rotation procedures in the secret manager. Changing it without re-encrypting credentials or reconnecting merchants makes existing tokens unreadable. The key is purpose-specific and independent of login/session signing keys.

Read-only diagnostic: node --import tsx scripts/pgone-owner-payments-preflight.mjs . It prints only booleans/mode and creates no provider account, token or payment. Startup emits the redacted PGONE_OWNER_PAYMENTS_PREFLIGHT line for deployments without shell access. No ordinary Razorpay key is used to probe partner approval.

## Exact founder actions still required

1. Continue the existing support ticket: request Technology Partner conversion, Embedded/co-branded onboarding, approval of the PG/accommodation-rent use case, and independently settling owner merchants. Explicitly state fixed INR249 SaaS revenue, no rent commission and no central rent pool.
2. Obtain application registration and production OAuth credentials. Whitelist the exact callback URL above. Confirm read_write payment access, account/product status reads and product activation notifications for the connected owners. Request Custom Onboarding API access only if later choosing provider-approved KYC pre-fill; hosted onboarding is used now.
3. Ask Razorpay to confirm Android Custom SDK UPI Intent acceptance using owner OAuth public tokens for this approved arrangement, automatic capture, direct owner settlement, merchant charges, refund access and settlement-reconciliation APIs. Local SDK tests do not prove merchant acceptance.
4. Configure the independent application webhook and its secret in the partner application, preserving the existing INR249 and legacy rent webhooks. Confirm the account/product activation, payment, refund, revocation and settlement events exposed on this application.
5. Supply the new settings through the backend secret manager; keep the feature flag false. Verify two independently approved owner accounts, correct bank destinations and authoritative status payloads. Complete provider test-mode acceptance in an isolated environment with authorised credentials.
6. Only after those approvals, explicitly authorise a controlled live-money test. Verify resident A pays owner A, resident B pays owner B, exact captures and duplicate-event safety, actual bank recipients/UTRs, refunds and return/cold-restart behaviour. Then enable the feature. No live-money authorisation has been given or exercised during this engineering task.

The direct-owner UPI fallback remains available where it was already supported and explicitly requires owner bank confirmation. It is never labelled provider-verified automatic collection.

## Implementation and release checks

New implementation is isolated under src/platform/owner-payments. Additive migration20261111103000_owner_merchant_rent creates nine private RLS tables with restricted grants, foreign keys, immutable invoice-order identity and per-invoice/channel guards. No production rows are wiped or rewritten. Synthetic financial history, public-role isolation and separate staging restore remain part of CI.

Owner/resident UI and native state use existing PGOne branding, three-dot motion, SDK engine and genuine payer contact validation. The existing INR249 profile keeps its exact amount and merchant rules; owner rent has a separate OAuth profile and preferences. Browser/provider/native fixtures are separate test assets and must never be shipped in the application APK or represented as live payment proof.

Fresh package: com.safehouse.pg.testing, version5.4.0-testing, versionCode57. Production signing compatibility remains blocked by the unavailable original private key; no replacement production key is generated. A testing APK cannot upgrade com.safehouse.pg, and CI testing certificates may differ between releases. Final delivery evidence must include exact commit, APK signature/hash, actual installation/launch/screenshots and the explicit external gates.

## Primary references

- https://razorpay.com/docs/partners/technology-partners/onboard-businesses
- https://razorpay.com/docs/partners/technology-partners/onboard-businesses/integrate-oauth/integration-steps
- https://razorpay.com/docs/partners/technology-partners/process-payments
- https://razorpay.com/docs/api/partners/account-onboarding/fetch
- https://razorpay.com/docs/api/partners/product-configuration/fetch
- https://razorpay.com/docs/webhooks/partners/activated
- https://razorpay.com/docs/api/orders/fetch-payments
- https://razorpay.com/docs/api/refunds/fetch-multiple-refund-payment
- https://razorpay.com/docs/api/settlements/fetch-recon
- https://razorpay.com/docs/webhooks/settlements
