# Screen-by-screen changes

The source uses reusable headers, navigation, fields, buttons, status badges, rows, invoice breakdowns, dialogs, light skeletons and receipt actions. Browser evidence includes a full-page and viewport screenshot of every state below at 360×800, 393×852, 412×915 and 480×960. Fixtures are controlled test data, not production transactions.

| Screenshot prefix | Screen | Rebuilt behavior |
| --- | --- | --- |
| 01 | Sign in | Minimal identity, persistent labels, secure password visibility, autofill, inline validation and button loading |
| 02 | Owner home | Property/month selector, collection summary, occupancy, quick actions, dues and recorded payments |
| 03 | Residents | Scoped search, active/paid/pending/overdue filters, compact room/rent/status rows |
| 04 | Resident detail | Personal/residency/rent sections, period invoice, rent revisions, history and account actions |
| 05 | Add resident | Four linked sections, searchable room options, capacity checks, precise money input, account setup and sticky save |
| 06 | Edit resident | Retained values, status/access changes, backend-confirmed rent effective period and unsaved-draft guard |
| 07 | Reset password | Temporary password validation and account-access consequences |
| 08 | Rooms | Available/full filters, capacity segments and room search |
| 09 | Room detail | Exact occupancy, resident assignment list and management actions |
| 10 | Add room | Unique room identifier, bounded capacity input and submission errors |
| 11 | Edit room | Existing values and capacity floor based on occupancy |
| 12 | Dues | Period total, overdue filtering, resident search, invoice actions and existing WhatsApp links |
| 13 | Owner invoice | Historical rent/charges/discount/paid/remaining breakdown, due/status and payment actions |
| 14 | Invoice charges | Existing due-only charge editing; base rent stays immutable in this flow |
| 15 | Record payment | Exact invoice context, received amount/method, explicit confirmation and uncertain-outcome lock |
| 16 | Owner payments | Selected billing-month payments, amounts, dates, methods and authenticated receipts |
| 17 | Owner notifications | Device configuration/permission state, campaigns, provider-accepted counts and pause/resume/cancel |
| 18 | Compose notification | Audience, selected residents, title/body, variable preview and review confirmation |
| 19 | Schedule | Dates, up to three daily times, timezone and existing scheduling limits |
| 20 | Owner profile | Account identity, property management, financial history, notifications and password actions |
| 21 | Properties | Verified property choices and isolated switching |
| 22 | Add property | Existing property-creation contract and verified response |
| 23 | Property settings | Existing name/timezone settings |
| 24 | Change password | Current/new/confirmation fields; forced temporary-password replacement when required |
| 25 | Resident home | Current rent amount/status/due date, pay action, invoice, residency and payment history |
| 26 | Resident invoices | All/outstanding/paid filters and historical snapshots |
| 27 | Resident invoice | Same shared monetary breakdown and server-authoritative balance |
| 28 | Resident payments | Only returned payment records, invoice reference and available receipts |
| 29 | Resident notifications | Actual device setup/permission state; no fabricated inbox |
| 30 | Resident profile | Room, joining date, configured rent, deposit, due day and account actions |
| 31 | QR payment | White QR-first screen, real image load gate, same-phone native handoff, save and confirmation check |
| 32 | Payment success | Drawn checkmark, exact confirmed transaction/amount/time/invoice/receipt, receipt download and home |

Payment tests additionally cover preparation, image error, provider-disabled, pending, verifying, delayed, failed, expired, settled-by-another-payment and unavailable states. No success screen accepts an Android return value, screenshot, client button or signature verification alone as settlement proof.

The visual direction was researched through [Jio's official MyJio page](https://www.jio.com/apps/myjio/) and its [official Android listing](https://play.google.com/store/apps/details?id=com.jio.myjio&hl=en_IN). SafeHouse uses an original house mark and original layouts; no Jio assets are included. Android inset handling follows the [Android Views guidance](https://developer.android.com/develop/ui/views/layout/edge-to-edge).
