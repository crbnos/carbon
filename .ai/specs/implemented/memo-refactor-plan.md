# Refactor: Credit/Debit Memos → payment-shaped "Credits & Debits"

## Goal
Stop modeling a memo as "a salesInvoice/purchaseInvoice row (`invoiceType`) with line
items." Model it like a **payment**: a party-level, non-cash settlement document =
`party + amount + reason GL account + applications to invoices`. No line builder, no
items/assets. One nav concept (a customer or supplier can have credits or debits),
sitting beside Payments — not buried in the AR/AP groups.

## Working principle (per branch state)
The branch's payment/memo migrations (`20260622*`, `20260623*`) are **unmerged and not in
production**, so we **edit them in place** and re-run a DB reset — no new add-then-remove
migrations. All schema changes below are edits to those existing files.

---

## DECISIONS (locked)
1. **Parallel `memo` table** (Option B) — a credit/debit memo isn't literally a "payment".
2. **Separate numbering** — own sequences (`CR-…` for credits, `DR-…` for debits), not `PAY-`.
3. **Expose all four** party×direction combos.

---

## Target model (Option B: `memo` table)
- New `memo` table mirroring `payment` but with `reasonAccount` (FK→account, the
  returns/allowance/adjustment GL) **instead of** `bankAccount`. Columns: `id`, `memoId`
  (seq), `companyId`, `customerId` XOR `supplierId` (party → AR vs AP control), `direction
  memoDirection` (`Credit`|`Debit`), `amount`, `reasonAccount`, `currencyCode`,
  `exchangeRate`, `status memoStatus` (`Draft|Posted|Voided`), `memoDate`, `postingDate`,
  `journalId`, posted/voided audit, `reference`, `notes`, audit, `customFields`.
- **The four combos by control-account sign:**
  | Combo | Party | Direction | Effect | Journal |
  |---|---|---|---|---|
  | AR Credit Memo | Customer | Credit | AR ↓ (owe us less) | DR reason / CR AR |
  | AR Debit Memo | Customer | Debit | AR ↑ (owe us more) | DR AR / CR reason |
  | AP Debit Memo | Supplier | Debit | AP ↓ (we owe less) | DR AP / CR reason |
  | AP Credit Memo | Supplier | Credit | AP ↑ (we owe more) | DR reason / CR AP |
- **Numbering:** two sequences (`creditMemo` → `CR-%{yyyy}-%{mm}-`, `debitMemo` →
  `DR-%{yyyy}-%{mm}-`), seeded in `seed.data.ts` + migration backfill (replacing the
  retired `salesCreditMemo`/`purchaseDebitMemo`).

## ⚠️ The one place "all four" diverges from copy-payments: reducers vs increasers
Two combos **reduce** the party balance (AR Credit, AP Debit) — these behave like payments:
they have an **apply table** and settle open invoices, or sit as an on-account credit.
The other two **increase** the balance (AR Debit, AP Credit) — these are **new open items**
the counterparty must settle (like a mini-invoice). Consequences:
- The **apply table only renders for the reducer direction** at creation.
- An increaser memo is itself a settleable open item, so **`invoiceSettlement.target` must
  generalize** to point at an invoice **or a memo** (add `targetMemoId`), so a payment or a
  reducer-memo can settle a debit/credit memo. (The reducer's apply list = open invoices +
  opposite-direction open memos.)
- The subledger/tie-out signs each open memo: reducers −, increasers +.

This is the real added scope of exposing all four. It's the right general model (it's how
Oracle AR/AP net any two open items), just more than a literal payments copy.

## Settlement primitive
- `invoiceSettlement` **source**: `paymentId` XOR **`memoId`** (replaces the retired
  `sourceSalesInvoiceId`/`sourcePurchaseInvoiceId`).
- `invoiceSettlement` **target**: `targetSalesInvoiceId` XOR `targetPurchaseInvoiceId` XOR
  **`targetMemoId`** (new — lets credits/payments settle an increaser memo).

## Subledger / GL consequences (important)
- Memos are **no longer invoice rows**, so they leave the `salesInvoices`/`purchaseInvoices`
  views. The "memo signed negative as an open invoice" logic in the tie-out RPCs is
  **removed**; instead memos are subtracted as **unapplied credits** — the same way the
  tie-out already subtracts unapplied payment cash. (Cleaner and symmetric.)
- Posting (`post-payment`): for `kind!='Cash'`, book **DR reasonAccount / CR AR** (Credit)
  or **DR AP / CR reasonAccount** (Debit) instead of the bank line. The per-application
  control/FX logic is unchanged. (Discount/write-off: memos don't carry them — keep the
  existing `invoiceSettlement` check that gates discount/write-off to cash payments.)

---

## Work plan

### 1. Schema (edit existing migrations, then reset)
- `20260622143012_ar-ap-payments.sql`:
  - **Remove** `invoiceType` columns + `salesInvoiceType`/`purchaseInvoiceType` enums.
  - **Remove** `invoiceSettlement.sourceSalesInvoiceId`/`sourcePurchaseInvoiceId` + their
    checks; the source is just `paymentId` (+ keep target sales/purchase XOR).
  - **Add** `payment.kind`, `payment.reasonAccount`, make `bankAccount` nullable + a check
    (`kind='Cash'` ⇒ bankAccount NOT NULL; else reasonAccount NOT NULL).
  - Repurpose the `salesCreditMemo`/`purchaseDebitMemo` sequences → a single memo sequence
    (or reuse the `payment` sequence; decide numbering, e.g. `CR-`/`DR-` by kind).
  - Keep the `'Credit Memo'`/`'Debit Memo'` `journalEntrySourceType` values for posting.
- `20260623151204_invoice-balance-from-line-total.sql`: drop the memo-settlement branch
  that read `sourceSalesInvoiceId` memos; balance = total − settled(payments only).
- `20260623154712_tie-out-aging-from-view-total.sql`: remove memo-as-negative-invoice
  signing; subtract unapplied memo credits alongside unapplied payment cash.
- `seed.data.ts`: drop the CM/DM sequences (or replace with the memo sequence).

### 2. Edge function `post-payment`
- Branch on `kind`: cash → existing DR bank/CR control; credit/debit → DR/CR `reasonAccount`
  vs control. Reuse the signed-debit balance check + FX plug unchanged.

### 3. Service + validators (`invoicing.service.ts` / `invoicing.models.ts`)
- Extend `paymentValidator`: `kind`, `reasonAccount`, make `bankAccount` conditionally
  required (refine on `kind`). Retire `creditMemoValidator`/`debitMemoValidator`,
  `creditMemoStatusType`/`debitMemoStatusType`, `isCreditMemoLocked`/`isDebitMemoLocked`.
- `getPayments`: add `kind` filter. Add `getMemos` = `getPayments` filtered to Credit/Debit
  (or just a `kind` filter param). Retire `getCreditMemos`/`getDebitMemos`.
- `insertSalesInvoice`/`insertPurchaseInvoice`: remove the `invoiceType` memo branch.

### 4. UI (reuse, don't copy)
- **Reuse `PaymentApplyTable` verbatim** (apply mechanics identical).
- `PaymentForm`: add `kind`; when memo, swap the **Bank Account** field for a **Reason
  (GL account)** field, hide cash-only bits. One component, conditional fields.
- A `CreditsTable` (or reuse `PaymentsTable` with a `kind` filter) for the list.
- Detail route reuses `PaymentHeader`/`PaymentSummary`/`PaymentApplications`/apply table.

### 5. Routes
- New `x+/credits+/` (or reuse `payments+` with a `kind` query) + `invoicing+/credits.tsx`
  list. Mirror the payment routes (new/$id/post/void/delete/applications.set).
- Path helpers: add `credit*`/`memo*` (or generalize the payment helpers with a kind).

### 6. Navigation
- One **"Credits & Debits"** entry beside **Payments** (its own group), filterable by party
  type + direction — mirroring the Payments list filters.
- **Remove** "Credit Memos" (AR group) and "Debit Memos" (AP group) entries.

### 7. RETIRE (delete)
- `x+/credit-memo+/` (14 files), `x+/debit-memo+/` (14 files),
  `invoicing+/credit-memos.tsx`, `invoicing+/debit-memos.tsx`.
- `ui/CreditMemo/` (12 files), `ui/DebitMemo/` (12 files).
- `creditMemo*` + `debitMemo*` path helpers.
- The retired validators/enums/service fns above.

### 8. Verify (reset + the SQL harness from the stress test)
- `crbn` reset (picks up edited migrations + seed).
- Re-run the controlled rolled-back SQL scenarios: derived balance/status, FX generated
  column, **tie-out variance 0 with an unapplied memo credit** (the new subledger path),
  AR + AP. Then a UI pass: create a credit (customer + amount + reason), apply, post.

## Risks / open questions
- **Numbering**: keep separate memo numbers (CR-/DR-) or fold into PAY-? (Decision 1-adjacent.)
- **Itemized returns** are explicitly **out of scope** here (separate return/RMA concern).
- **AR debit / AP credit** memos (the other two combos) come free once `kind`+party is the
  model — confirm we want all four exposed now or just the two we have today.
- Editing the merged-in `20260623*` migrations: they were authored by other work this
  branch absorbed — make sure reshaping them doesn't break their non-memo intent.
