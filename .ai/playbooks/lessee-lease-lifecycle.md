# Lessee Lease Lifecycle (create → activate → invoice → post → void)

Last tested: 2026-10-11
Route: /x/purchasing/leases → /x/lease/new → /x/lease/<id>/details

## Prerequisites
- A supplier exists (seeded "CelestialElex" used).
- The company has an accounting cutover BEFORE the commencement date, or activation takes the opening-balance path instead of a commencement journal (dev company cutover: 2025-11-01).
- Lessee account defaults mapped (seeded by migration).

## Steps
### 1. Navigate — /x/purchasing/leases; empty state shows "Add Lease" (link, shortcut N) → /x/lease/new
### 2. Fill
- Lessor section, first combobox = Supplier: click, pick an option.
- Leased Asset first textbox = Name: "Forklift FL-12". Owner and Location prefill.
- Term: four react-aria date groups in order Commencement, End, Notice, Invoice From. `agent-browser type @<month spinbutton> "05012026"` fills the whole date (segments auto-advance). Used 2026-05-01 / 2029-04-30 / (blank) / 2026-05-01.
- Payments: Payment Amount textbox `fill "2000"` then click another field to blur; Timing combobox → "Arrears (end of each period)". Discount Rate prefilled 6.
- Verify with `new FormData(form)` before submitting.
### 3. Submit — requestSubmit the form whose submit button text starts with "Save" → redirects to /x/lease/<id>/details, Draft, Payments 36.
### 4. Activate — header "Activate" opens a dialog with the classification badge and the Dr ROU / Cr Lease Liability preview (PV 65,742.03 for 36×2,000 @6% arrears). requestSubmit the dialog form ("Activate"). → Active + Operating, Schedule 36, a journal under JOURNALS dated the commencement date.
### 5. Invoice Now — header button; dialog "Invoice" (requestSubmit). One Draft purchase invoice per due payment appears under PURCHASE INVOICES; the button then disables.
### 6. Post — open the invoice (/x/purchase-invoice/<id>), "Post" → dialog "Post Invoice". Status becomes Open; journal Dr Lease Liabilities / Cr Accounts Payable.
### 7. Void — "More options" (⋯ next to the invoice id) → menuitem "Void" → dialog "Void Invoice". Status Voided; the leasePayment row returns to Pending with voidedPurchaseInvoiceId set; the lease's Invoice Now re-enables.
### 8. Pages — /x/accounting/lease-runs (empty state "New Run"), /x/reports/lease-liabilities (as-of table, Maturity Analysis, Lease Cost), /x/settings/accounting (Lessor Discount Rate, Incremental Borrowing Rate, Lease Reminder Days, Short-Term Lease Expedient).

## Selector Notes
- Dialog confirm buttons: find in `[role=dialog] button` by text and `requestSubmit` its form.
- The login page shows a Cloudflare widget; filling the email and clicking Continue still works, but the redirect to /x takes ~10 s.

## Common Failures
- None hit on this run.
