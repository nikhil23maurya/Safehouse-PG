# SafeHouse Android rebuild

Baseline: `52e08b3a578bcca7e1df8701dfb7fa14473d497d` (2026-11-04).

## Decision

Retain the Android Java/WebView application. Its Razorpay QR decoding, UPI handoff, authenticated receipt downloads and Firebase installation registration are existing integrations. A framework migration would add bridge risk without improving these workflows. The maintained source is now `mobile/frontend/src/` and `mobile/app/src/main/`; esbuild bundles local JavaScript modules for the WebView. The Android build never reconstructs Base64 archives or runs frontend string patches.

Use one theme, shared rendering primitives and separate screen, request, navigation and payment modules. API responses remain authoritative. Money is displayed from integer paise, including fractional rupees. Owner requests capture property and period context. Stale navigation responses cannot render into another screen or property. A single refresh request serves concurrent expired-access requests. Transport failures and server errors from state-changing requests are never automatically replayed. Authentication retries occur only after a rejected access token is refreshed. Cold refresh preserves the encrypted property, period and pending-QR metadata until the account is verified. Financial timestamps follow the selected property timezone; joining dates retain their stored calendar date.

Android serves bundled assets from a restricted HTTPS asset origin, with file/content access disabled. Tokens persist only through an AES-GCM Android Keystore vault; browser previews keep tokens in memory. Native navigation never loads external pages into the bridge-bearing WebView. Financial backend code, authentication contracts, role checks, database schema, migrations, deployment configuration and settlement are unchanged.

## Audit findings

The former build reconstructed `mobile-v2-build/part-*.b64`, inserted startup code, then ran performance, financial context, stability, notification, native and Atelier patches. The Atelier patch appended four stylesheets and two runtime overrides to an already styled application. The native source was overwritten from `scripts/notification-android/`. Baseline UI scripts are retained for historical inspection, but are not inputs to the new build. Backend prebuild patches remain untouched and separate.

Backend documentation predates several shipped features. The effective contract includes the financial-hardening and notification patches in the backend prebuild: multiple properties, `X-Property-Id`, selected invoice period, rent revisions, notification campaigns and provider-issued QR checkout. The frontend uses those existing contracts. Student notification history has no backend endpoint; the resident notification page reports device permission/configuration and does not fabricate an inbox.

`SAFEHOUSE_QR_SETTLEMENT_V2` reconciles captured provider payments with transactional compare-and-swap settlement. QR creation reconciles prior attempts before reuse/replacement. The status endpoint can defer a provider outage, so an inconclusive poll is never displayed as failure or success. QR expiry is distinct from payment failure. Only matching CAPTURED + PAID backend state and a matching payment record produce the payment-success receipt screen. Native UPI return is not settlement evidence.

## Screen and contract inventory

| Screen | Existing contracts / behavior retained |
| --- | --- |
| Startup / sign in | login, refresh, me, role routing, required password change, logout |
| Owner home | dashboard, selected property/month, collection/occupancy, dues, recent payments |
| Property switch/create/settings | properties, property GET/PATCH, property-scoped requests |
| Resident directory/detail | students search/status, selected period, detail invoices, rent revisions |
| Add/edit resident | students POST/PATCH, capacity constraints, temporary password, status, notes |
| Reset resident password | existing reset-password endpoint; revokes resident credentials server-side |
| Rooms / room detail / add/edit | rooms GET/POST/PATCH, occupants from scoped resident directory |
| Dues | dues by period, search/overdue filter, backend-issued WhatsApp reminder links |
| Invoice detail / charges | snapshot amounts, immutable rent, existing due-only charge editing |
| Manual payment | existing invoice/manual-payment, explicit confirmation, no automatic network retry |
| Owner payment history | period-scoped payments, authenticated PDF receipts |
| Resident home | dashboard/currentInvoice, residency information, outstanding invoices |
| Invoices / history | student/invoices, invoice snapshots and captured/manual payment records |
| QR payment | payments/upi-qr, provider image load/error, expiry, orders/:id/status reconciliation |
| Payment success | exact captured attempt + PAID invoice + matching payment record, receipt |
| Notifications | notifications/config, devices register/unregister, permission/native callbacks |
| Owner campaigns | campaigns, send-now, schedule, selected audience, pause/resume/cancel |
| Profile / password | existing identity/property details, change-password and logout |

## Verification boundaries

Fixtures exist only in tests. No demo data, test login, provider simulation or financial-success shortcut ships in the app. Browser tests intercept the actual API boundary. Android instrumentation injects fixtures into a testing process; production source has no fixture entry point. Real merchant transactions and production data mutations require separate authorization and are not part of this rebuild.

Android 12+ uses a native animated-vector roof/house reveal in the system splash. The native/web handoff has no fixed hold timer. A restored session shows an honest account-loading state while the API is checked. Native keyboard insets notify the web layer, which uses a compact login layout and explicitly reveals the focused field. Rotation and text-size changes retain the WebView/form draft. Both browser reduced-motion preferences and Android animator settings disable UI motion.
