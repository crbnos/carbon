# Rental Invoice Automation (+ rental / fixed-asset server functions)

Last tested: 2026-10-03
Routes: /x/settings/invoicing, /x/rental-agreement/:id, /x/sales-invoice/:id,
/x/invoicing/sales?filter=needsReview:eq:true, /x/accounting/fleet,
/x/fixed-asset/:id/return-to-inventory, /x/fixed-asset/capitalize,
/x/accounting/revenue-recognition-runs

## Prerequisites
- A company with accounting enabled and an Available fleet unit (Accounting →
  Fleet; an "In Maintenance" unit → Action Menu → Return to Service).
- **Email safety:** check `SMTP_*` in `.env.local`. With none set, mail falls back
  to `RESEND_API_KEY` and is REALLY sent. Keep Settings → Invoicing on **Post**
  unless SMTP points at a local catcher, and only switch to Post and email for an
  agreement with NO contact (the "Not sent" path never sends).
- Use an isolated browser session (`AGENT_BROWSER_SESSION=<workspace>`): the
  default agent-browser session is shared with other Conductor workspaces.
- `.context/q.sh "<sql>"` style DB checks: `docker exec -i <stack>-postgres-1 psql -U postgres -d postgres -At -c "<sql>"`.

## Steps
### 1. Settings → Invoicing
Five cards: Recurring Invoices, Receivables Email, Notifications (Also notify),
Emails, Centralized Billing Address. Recurring Invoices is the first combobox —
click it, click option "Post", then requestSubmit the form containing
`input[name=intent][value=invoiceAutomation]`. Receivables Email: fill the first
plain textbox, requestSubmit the form with intent `receivablesEmail`. Reload to
verify. Settings → Sales must no longer show Emails / Centralized Billing Address.

### 2. Agreement setup (Draft)
On a Draft agreement: Billing Timing combobox → "Advance" (period due at its
start); Customer Contact "Add" → pick the contact; "Add Unit" → first combobox
(fleet unit) → option "FA…", rate textbox "3100", Tab to blur, requestSubmit the
form containing `input[name=rate]`. Header "Activate" → dialog button
"Activate MOD+ENTER".

### 3. Verify agreement UI
Secondary "Invoice Now" button; summary line "Next invoice <date> is created
automatically, then posted." (Draft: "…once the agreement is active.";
Closed: nothing). Invoicing property: click the text "Company default (…)" to
reveal its combobox; "Post and email" is offered only when the contact has an
email; with no contact the note "Invoices will be posted but not emailed — the
contact has no email" shows when the effective mode is Post and email.

### 4. Invoice Now → automation
"Invoice Now" → dialog button "Invoice Now MOD+ENTER". Flash: "Generated N
invoice(s); posting M automatically". Wait ~10 s for the Inngest
`invoice-automate` run; the rent invoice becomes Submitted (Dr AR / Cr Deferred
Revenue for Rental lines).

### 5. Holds
- "Add Charge" (description, amount, blur, requestSubmit the form containing
  `input[name=amount]`) → Invoice Now → a separate Draft with "Charges are
  reviewed before posting"; Charges card shows HELD; invoice header DRAFT + HELD.
- Void the posted rent invoice (⋯ → Void → "Void Invoice") → period back to
  Pending with `voidedSalesInvoiceId` → Invoice Now → Draft held "Re-billing
  AR…, which was voided"; delete that draft (⋯ → Delete) and generate again →
  still held.
- Return a delivered unit early (Unit actions → Deliver, then → Return → "Return
  Unit MOD+ENTER") → a negative adjustment period → Invoice Now → held
  "Includes an early-return credit".

### 6. Manual post
Invoice "Post" → dialog "Post Invoice" (requestSubmit). The PDF is stored under
`{companyId}/opportunity/{opportunityId}/`. `/file/sales-invoice/<id>.pdf`
returns application/pdf.

### 7. Not sent
Agreement with NO contact, effective mode Post and email → Invoice Now →
Submitted + NOT SENT + "Send" button; listed under Receivables → Needs Review.
Set the company default back to Post afterwards.

### 8. Merge smoke (server functions)
- Close: header "Close" → "Close Agreement MOD+ENTER" (all periods invoiced).
- Fleet → Action Menu → "Return to Inventory" → pick a storage unit → submit →
  asset Disposed, transfer Posted, serial cost layer at NBV.
- `/x/fixed-asset/capitalize?itemId=…&trackedEntityId=…&locationId=…&storageUnitId=…`
  → requestSubmit "Capitalize" → new Active asset at the serial layer's cost.
- Accounting → Revenue Recognition → "New Run" → "Create Run" → Draft run with
  the due Deferral rows.

## Selector Notes
- Dialog confirm buttons carry a "MOD+ENTER" suffix in their accessible name.
- Property-panel selects render inline text; click the text to get the combobox.

## Common Failures
- Another workspace navigating the shared default agent-browser session
  (`file:///…/wellington/…`) — use a named session.
- `fixedAsset` has no `readableId` column (it's `assetId`/`name`); `costLedger`
  stores `cost` + `quantity`, not `unitCost`.
