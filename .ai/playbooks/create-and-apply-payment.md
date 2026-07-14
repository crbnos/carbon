# Create & Apply Payment (AR Receipt / AP Disbursement)

Last tested: 2026-06-16
Routes: `/x/payment`, `/x/payment/new`, `/x/payment/$paymentId`

## Prerequisites
- A `payment` sequence row must exist for the company. New companies get it from the
  `sequences` array in `seed.data.ts`; existing companies from migration
  `20260519120000` Phase 8. If missing, payment creation fails with
  "Failed to allocate payment id".
- At least one open invoice:
  - AR: a `salesInvoice` with status `Submitted` (or `Partially Paid`/`Overdue`) and balance > 0.
  - AP: a `purchaseInvoice` with status `Open` (or `Partially Paid`/`Overdue`) and balance > 0.
- At least one `Asset`-class GL account to use as the bank/cash account.

## Steps (invoice-driven, the primary flow)

### 1. Open the invoice and start a payment
- Sales: `/x/sales/invoices` → open the invoice → header button **"Receive Payment"**
  (only shown when status ∉ {Voided, Draft, Pending, Paid} and balance > 0).
- Purchase: equivalent "pay" entry on the purchase invoice header.
- This navigates to `/x/payment/new` pre-filled:
  `?customerId=…&invoiceId=…&amount=<balance>` (AR, paymentType=Receipt) or
  `?supplierId=…&invoiceId=…&amount=<balance>` (AP, paymentType=Disbursement).

### 2. Fill the New Payment form
- Type / Customer-or-Supplier / Currency / Exchange Rate / Total Amount are pre-filled.
- **Bank / Cash Account** (required) — select an Asset account (e.g. "1010 Bank - Cash").
- Submit "Save". On submit the action auto-creates a starter `paymentApplication`
  against the seed invoice for the full amount, then redirects to the payment detail.

### 3. Post the payment
- On `/x/payment/$paymentId`, click **Post** (Draft only). Calls the `post-payment`
  edge function: sets status `Posted`, and creates GL journals only if
  `accountingEnabled` for the company (otherwise journalId stays null — expected).

### 4. Verify (derived status + balance)
- Balance/status are DERIVED in the `salesInvoices` / `purchaseInvoices` views from
  Posted payment applications (migration `20260519130000`). Draft payments are ignored.
- Partial pay → invoice `Partially Paid`, balance = total − applied.
- Full pay → invoice `Paid`, balance 0.

## Selector Notes
- Bank/Cash Account combobox is the one whose value reads "Select" before selection;
  the submitted value is the account `id` (`acct_…`), rendered as "<number> <name>".
- The Number (Total Amount) field is finicky in agent-browser: `fill` appends to the
  pre-filled value, and the hidden input resets when sibling fields re-render. Easiest:
  leave the pre-filled amount untouched (full balance), or set amount LAST.
- After Save the browser may show a lingering spinner even though the server succeeded —
  verify by checking the DB / navigating to `/x/payment/$id` directly.

## Common Failures (all fixed on feat/ar-ap-payments)
- "Failed to allocate payment id" — no `payment` sequence row for the company.
- "Failed to create payment" — `new.tsx` spread a hidden `id:""` (→ null) into the
  insert, violating the NOT NULL `id` (which has an `xid()` default). Fix: omit `id` on create.
- `ERR_TOO_MANY_REDIRECTS` on the detail page — `$paymentId._index.tsx` redirected to
  `path.to.payment(id)` (itself). Fix: removed the vestigial index; `$paymentId.tsx`
  renders the detail directly.
- `payment_party_check` — a Receipt must have customerId set & supplierId null
  (Disbursement the reverse). The form omits the inactive party, so it's null — fine.
