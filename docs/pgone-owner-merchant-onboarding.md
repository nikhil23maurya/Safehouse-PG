# Per-owner merchant onboarding

This feature is separate from PGOne's ₹249 software fee. Each owner organisation receives a deterministic, unique Cashfree merchant reference. Another owner's ID or email cannot be used to claim that merchant. Existing rent settlement remains unchanged.

## Activation

An approved **Cashfree Embedded** partner account is required. An ordinary payment-gateway, reseller or affiliate account does not establish this access. Keep `PGONE_CASHFREE_EMBEDDED_ENABLED=false` until the provider approves the product and the production contract, rent category and settlement model. Credentials belong only in the backend secret environment:

- `PGONE_CASHFREE_PARTNER_API_KEY`: provider-issued Embedded partner API key.
- `PGONE_CASHFREE_ENV=LIVE`: sandbox and live merchant records are isolated; a sandbox approval never activates a live account.
- `PGONE_CASHFREE_EMBEDDED_ENABLED=true`: only after the approved configuration is available.

Register the provider's merchant-onboarding webhook as `https://safehouse-api.onrender.com/api/platform-webhooks/merchant`. Cashfree signs the exact timestamp and raw body with the partner API key. PGOne validates that signature, bounds replay age, deduplicates the notification and fetches current merchant status. The notification's claimed status and the return page never approve an account.

## Owner flow and data handling

The owner submits business/contact details, an actual business website, business type and explicit consent. The backend creates the merchant with the official Partner API. An uncertain creation is reconciled using the same deterministic ID, never a fresh merchant ID.

The settlement bank form confirms the number and IFSC with explicit consent. The full number exists only in request memory and the encrypted transport to Cashfree; PGOne stores a keyed fingerprint and last four digits. A successful PATCH means submitted, not bank-name verification. An uncertain PATCH blocks blind repeats and directs the owner to provider KYC. An approved merchant must use the provider's approved bank-change process.

KYC documents are submitted in an isolated, non-exported provider WebView with no PGOne JavaScript/native bridge. The expiring provider link is issued only to the owner and is not stored in audit logs. PGOne does not receive or store PAN/document images. The activity blocks insecure/file navigation and screenshots; required document selection passes the user's selected file to the provider. Real provider document-upload and third-party authorisation acceptance still require verification with approved credentials.

Only the exact merchant's current `PG` product `MIN_KYC_APPROVED` status and a recognised verified onboarding state can show merchant approval. The status API does not return the verified settlement bank account, so the UI labels the bank as the last submission and never invents a verified beneficiary name.

## Rent settlement remains unavailable for new owner merchants

`collectionEnabled` remains false even after KYC approval. The existing rent posting function accepts Razorpay QR/payment references and records `Payment.source=RAZORPAY`. Cashfree captures cannot truthfully be inserted through that function or relabelled as Razorpay/manual payments. A provider-specific, tenant-scoped settlement extension with correct provider identity, exact amount matching, audit, immutable receipts and idempotent invoice credit is required before new-owner online rent collection can be enabled. Existing legacy rent collection is preserved.

No merchant account, bank submission, document upload, rent order or live charge is created by automated tests; test providers use synthetic responses in isolated PostgreSQL/browser/emulator environments.

## Primary provider contracts

- [Embedded onboarding](https://www.cashfree.com/docs/partners/embedded/embedded-merchant-onboarding)
- [Merchant onboarding API](https://www.cashfree.com/docs/api-reference/platforms/latest/merchant-onboarding/getting-started)
- [Update merchant](https://www.cashfree.com/docs/api-reference/platforms/latest/merchant-onboarding/update-merchant)
- [Onboarding webhooks](https://www.cashfree.com/docs/api-reference/platforms/latest/merchant-onboarding/webhooks)
