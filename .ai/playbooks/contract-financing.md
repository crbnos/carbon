# Contract financing (progress payments SF 1443, PBP)

Last tested: 2026-10-12
Routes: /x/contract/:id/financing, /x/contract/:id/financing/:requestId,
/file/contract/financing/:requestId.pdf, /x/payments/new, /x/payments/:id,
/x/sales-invoice/:id/details

## Prerequisites
- Company entitled to GOVERNMENT_CONTRACTING (local dev: yes).
- A customer contract in the base currency (USD). Create your own — do NOT use
  the ORBSEC demo contract. Fast path: POST FormData to /x/contract/new (see
  contracts.md) -> /x/contract/<id>/setup/products. The Financing page works on
  a Draft contract too; the Financing tab is in the contract header next to
  Details / Service Orders.
- To get a posted delivery invoice: Products step "Add Services" -> service ->
  rate cell (4th td) -> fill -> Tab; Next -> Next -> Review -> "Confirm" ->
  "Confirm MOD+ENTER"; header "Invoice" -> "Invoice MOD+ENTER". The draft invoice
  did NOT auto-post (2026-10-12); post it by hand (below).

## Steps
### 1. Terms
Financing tab -> "Financing Terms" card: Method combobox (Progress Payments /
Performance-Based Payments), Contract price textbox (fill + blur), Initial award
date, Maximum share (PBP, default 90%), "Small business" switch. requestSubmit
the form containing `input[name=contractPrice]` (hidden `intent=terms`).

### 2. Rate
"Add Rate" -> dialog (effective date, progress payment rate 80%, liquidation rate
80%, modification number; PBP shows only the liquidation rate) -> requestSubmit
the dialog form. "New Request" stays disabled until a rate exists.

### 3. Progress payment request
"New Request" -> dialog "New Progress Payment Request" (request date, costs
through, estimated cost to complete, estimated on) -> requestSubmit -> drawer
/financing/<cfr_…> with the SF 1443 lines. Override: buttons "Override line
12b|14a|14b|14d|26" (20a/21a/21d/23 only once Section III applies) -> dialog
"Line N: …" (Value textbox, Reason textarea — required when a value is set) ->
requestSubmit. Drawer buttons: Print, Delete, Submit (Draft); Withdraw, Approve
(Submitted); Record Payment (Approved).
Submit -> "Request N". Approve -> dialog "Approve Request" with the approved
amount prefilled -> requestSubmit.

### 4. Record Payment -> post
"Record Payment" -> /x/payments/new?customerId&customerContractId&
financingRequestId&amount — prefilled Deposit for = the contract, Total Amount =
approved amount, Bank 1010. requestSubmit "Save" -> /x/payments/<id> (Draft,
linked to the request). Click "Post" -> payment Posted, journal DR 1010 Bank /
CR 2110 Customer Prepayments, request -> Paid. Financing page "Unliquidated:"
shows the deposit.

### 5. Request PDF
GET /file/contract/financing/<requestId>.pdf -> 200 application/pdf (SF 1443
sections, override note on the line). PBP requests print too.

### 6. Liquidation on a delivery invoice
Post the contract's invoice: "Post" -> "Post Invoice". Invoice page Total block
then shows "Progress payment liquidation expected $X" (rate x subtotal, capped by
the unliquidated balance). Header "Payment" link -> New Payment seeded with the
invoice; set Total Amount to the cash part (click, select all, type, Tab), Save.
The payment page shows "Deposit for CON… (its invoices only) $X" and "Drawing $Y
from on-account credit"; Post settles the invoice (cash + deposit credit) and the
unliquidated balance drops by Y.

### 7. PBP
Method = Performance-Based Payments -> Save; Add Rate; "Add Event" dialog
(sequence auto, textboxes in order: Event code, Description, Completion
criteria, then Amount after the Type/CLIN comboboxes) -> requestSubmit. Row
button "Complete" -> dialog (completed date, evidence) -> requestSubmit.
"New Request" -> "New PBP Request" -> drawer with events and 1a/1b/1c/2.

## Selector Notes
- Many dialogs stack; always requestSubmit the LAST `[role=dialog]`'s form.
- Watch toasts with a MutationObserver on `section[aria-label*=Notifications]`
  — they vanish within seconds.
- Refs go stale after any navigation; re-snapshot.

## Common Failures
- Posting a contract invoice opens "Rule Violation — ITAR spacecraft — US
  ship-to only / Customer country is required" (demo rule, item target with no
  filters = every item). Fix: set the invoice's Shipping -> Ship To to the
  customer's US location and click the Shipping card's Save. Invoice Customer
  Location (bill-to) does not satisfy it.
- PBP: a request created while an earlier request is still Draft shows 1a = $0
  and skips the max-share cap (2026-10-12 bug; see report).
- Page not hydrated (no `__react*` keys on buttons): dev proxy 502s; reload.
