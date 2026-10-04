# Contracts (customer contracts, Phase A)

Last tested: 2026-10-04
Routes: /x/contract/new, /x/contract/:id/details, /x/contract/:id/lines/new,
/x/contract/:id/:lineId/details, /x/sales-invoice/:id, /x/credits/:memoId,
/x/settings/invoicing, /x/sales-order/:id (Create Contract)

## Prerequisites
- Accounting enabled with a Deferred Revenue default (`accountDefault.deferredRevenueAccount`).
- Service items (the demo dataset has Consulting, Website Hosting, Support, IT Consulting).
- **Email safety:** with no `SMTP_*` in `.env.local`, mail goes out through
  `RESEND_API_KEY`. Only use *Post and Email* on contracts with NO invoice contact
  (the run then reports "The invoice contact has no email" and sends nothing).
- DB checks: `docker exec -i <stack>-postgres-1 psql -U postgres -d postgres -c "<sql>"`
  (no local psql). Inngest dev API: `curl localhost:$PORT_INNGEST/v1/events?limit=100`,
  then `/v1/events/<id>/runs` for an `invoice-automate` run's output.
- Invoice Now drafts as of TODAY (company timezone) — put contract dates in the
  current month or earlier.

## Steps
### 1. New contract (/x/contract/new)
Name = first textbox; Customer = first combobox (option by name); the date groups
are Close Date, Start Date, then First Invoice / Billed Through / Recognize Revenue
From — click the month spinbutton and `type` MM, DD, YYYY into the three
spinbuttons. Billing Alignment / Invoicing are comboboxes (open, click option).
Renewal Uplift is a textbox: `fill` then click another field to blur.
requestSubmit the form whose submit button text contains "Save" → redirect to
`/x/contract/<id>/details`.

Faster for extra contracts: from the logged-in page, POST a FormData to
`/x/contract/new` with the same fields the form posts (name, customerId,
invoiceCustomerId, closeDate, startDate, duration "12"/"custom"+endDate, renewal,
renewalUplift, billingFrequency, billingAlignment, billingTiming, firstInvoiceDate,
paymentTermId, currencyCode, invoiceAutomation) — `fetch(...).url` is the new
contract's details URL.

### 2. Lines (/x/contract/:id/lines/new)
Service combobox (first) → option; Kind combobox ("One-time" hides Per); Quantity,
Rate, Discount (%) textboxes (fill + blur); Per combobox (Month/Year/Day). The
Revenue fields are collapsed — click the "Revenue" button to show Revenue Method.
requestSubmit the form containing `input[name=customerContractId]`. Same fields
POST to `/x/contract/:id/lines/new` (plus `id:""`, `itemType:"Service"`).

### 3. Draft checks
Invoices card: "Show lines" per invoice, "Line actions" → Split / Move To….
Split modal: Amount N textboxes, "Add Installment"; an unbalanced split shows
"$X left to place" and disables Split. "Reset Schedule" button on the card header.
Revenue card: per-line "Show monthly revenue", then the month position table.
Contract project: PROPERTIES → Project "Add" → option. Line project: open the
line (`/x/contract/:id/:lineId/details`), Project combobox, Save.

### 4. Confirm → Invoice
Header "Confirm" → modal "Confirm MOD+ENTER". Active header buttons: Cancel, Amend,
Invoice. "Invoice" → dialog "Invoice MOD+ENTER". Flash "Drafted N invoice(s);
posting M automatically" (posting runs in Inngest, ~5 s) or "Nothing is due on
this contract yet".

### 5. Amend / Cancel
Amend modal: Change Date group (day spinbutton), Takes Effect combobox ("From the
change date" / "From the next billing period"), per-line Quantity / Rate /
Discount textboxes, Reason = last plain textbox. The preview (Adjustments + per
invoice rows) renders after the inputs blur. "Amend MOD+ENTER".
Cancel modal: End Date group, Reason textbox, switch "Credit unused time ($X)"
appears only when the date falls in a billed period. "Cancel Contract MOD+ENTER"
→ Draft credit memo at `/x/credits/<id>` → "Post". Header then shows
"Revert Cancellation".

### 6. Void / holds
Sales invoice ⋯ More options → Void → "Void Invoice"; Invoice again → Draft held
"Re-billing AR…, which was voided". An invoice carrying a negative adjustment
(amend dated on/before today in a billed period) is held "Includes a credit for a
contract change".

### 7. From a sales order
Order with Service lines, Confirm (acknowledge any Rule Violation). ⋯ More options
→ "Create Contract" → untick lines (first checkbox = select all) → "Create
Contract MOD+ENTER" → Draft contract. Order "Invoice" bills only the unticked lines.

## Selector Notes
- Refs change after every navigation — re-snapshot and grep by role/label.
- Contract header Invoice button is `button "Invoice"`; its dialog button is
  `button "Invoice MOD+ENTER"`.
- Invoice Post dialog may read "Post and Ship Invoice" for a Service item whose
  method is Purchase to Order.

## Common Failures
- Amend dated in the future → its adjustment invoice is dated that day, so Invoice
  Now says nothing is due.
- Sales order line save / confirm opens a "Rule Violation" dialog in the demo
  data — click "Acknowledge & continue".
- Stripe mode: Confirm stays disabled until the billing customer is linked to a
  Stripe customer (no link step on the contract — Task 27 escape hatch).
