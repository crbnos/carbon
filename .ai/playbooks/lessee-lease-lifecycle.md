# Lessee Lease Lifecycle (create → activate → invoice → post → void)

Last tested: 2026-10-11 (setup wizard)
Route: /x/purchasing/leases → /x/lease/new → /x/lease/<id>/details

## Prerequisites
- A supplier exists (seeded "CelestialElex" used).
- The company has an accounting cutover BEFORE the commencement date, or activation takes the opening-balance path instead of a commencement journal (dev company cutover: 2025-11-01).
- Lessee account defaults mapped (seeded by migration).

## Steps
### 1. Navigate — /x/purchasing/leases; "Add Lease" (shortcut N) → /x/lease/new: the setup wizard (SetupFrame, steps Details · Payments · Accounting · Review)
### 2. Details (step 1) — first combobox = Supplier (click, pick); first textbox = Name; four date groups Commencement / End / Notice / Invoice From — `agent-browser type @<month spinbutton> "05012026"` fills a whole date. requestSubmit the form whose submit button reads "Next" → /x/lease/<id>/setup/payments.
### 3. Payments (step 2) — first textbox = Payment Amount: `fill "2000"` then `press Tab` (saves on blur, cuts 36 rows); Arrears via `agent-browser find text "Arrears" click` (saves, re-cuts). A grid cell: click the amount cell, fill its textbox, Enter (posts to `$id.payments.$paymentId.update`). Footer shows the payment count and total; Next is disabled with no rows.
### 4. Accounting (step 3) — live classification; textboxes in order Discount Rate, Fair Value, Economic Life, Purchase Option (fill + Tab saves). Fair value 68,000 on 36 × 2,000 @6% arrears flips it to Finance (93.753%).
### 5. Review (step 4) — footer Back / Save as Draft / Activate; Activate opens a dialog with the classification and the journal; requestSubmit its form. → /x/lease/<id>/details, Active. A Draft opened by /x/lease/<id> or /details redirects to setup/payments.
### 6. Invoice Now — header button; dialog "Invoice" (requestSubmit). One Draft purchase invoice per due payment appears under PURCHASE INVOICES; the button then disables.
### 7. Post — open the invoice (/x/purchase-invoice/<id>), "Post" → dialog "Post Invoice". Status becomes Open; journal Dr Lease Liabilities / Cr Accounts Payable.
### 8. Void — "More options" (⋯ next to the invoice id) → menuitem "Void" → dialog "Void Invoice". Status Voided; the leasePayment row returns to Pending with voidedPurchaseInvoiceId set; the lease's Invoice Now re-enables.
### 9. Pages — /x/accounting/lease-runs (empty state "New Run"), /x/reports/lease-liabilities (as-of table, Maturity Analysis, Lease Cost), /x/settings/accounting (Lessor Discount Rate, Incremental Borrowing Rate, Lease Reminder Days, Short-Term Lease Expedient).

## Selector Notes
- Dialog confirm buttons: find in `[role=dialog] button` by text and `requestSubmit` its form.
- The login page shows a Cloudflare widget; filling the email and clicking Continue still works, but the redirect to /x takes ~10 s.

## Common Failures
- None hit on this run.
