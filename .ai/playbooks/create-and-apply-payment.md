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
- Submit "Save". On submit the action seeds one `paymentApplication` per invoice; each
  is `appliedAmount = balance − earlyPaymentDiscount`, `discountAmount = discount`, so
  `applied + discount = balance` (settles the invoice without over-settling).
  Redirects to the payment detail.

### 2a. Early-payment discount (auto-seeded from payment terms)
- If the invoice's payment term has `discountPercentage > 0` AND the payment date is
  within the discount window (`daysDiscount` from the issue date, per `calculationMethod`),
  the seeded **Total Amount** is NET of the discount (e.g. a 1000 invoice on "1% 10 Net 30"
  paid within 10 days pre-fills **990**), and the seeded application carries
  `discountAmount` (10) with `appliedAmount` (990).
- Past the window, or a 0% term → discount 0, full balance (unchanged behavior).
- Verified 2026-09-09: `si_EvjaoySwgfqMtHn6JamGBy` ("1% 10 Net 30", issued today) → payment
  total 990, application applied 990 / discount 10; posts to a GL journal:
  `DR Bank 990 / DR Customer Payment Discount (4040 contra-revenue) −10 / CR AR −1000`;
  invoice → Paid. The discount line signs by the account's `class` (post-payment resolves it).
- Logic: `computeEarlyPaymentDiscounts` (`invoicing.service.ts`), called from
  `payments/new.tsx` loader (total) and action (applications).
- The apply table (`PaymentApplyTable`) disables **Save applications** when any row's
  `applied + discount + write-off > balance` ("A line settles more than its invoice's open
  balance") — mirrors the authoritative cap in `post-payment`, so a manual over-settling
  discount is caught before Post instead of erroring server-side.

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
