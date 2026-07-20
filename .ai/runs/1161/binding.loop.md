---
id: "1161"
issue: 1161
kind: bug
risk: high
title: "Separate sales tax from revenue in GL posting, and fix receipt/invoice FX inconsistency on supplier shipping"
acceptance:
  - "post-sales-invoice credits pre-tax line cost to accountDefault.salesAccount — tax is NOT included"
  - "post-sales-invoice credits the tax amount to accountDefault.salesTaxPayableAccount as a separate journal line"
  - "The sales invoice TOTAL and the AR (receivables) debit are unchanged — only the credit split changes"
  - "Every posted sales invoice journal still balances: sum(debits) == sum(credits)"
  - "post-receipt and post-purchase-invoice apply exchangeRate to supplierShippingCost in the SAME direction"
  - "Purchase tax stays capitalized into inventory cost but is isolated as a named term (no behavior change)"
  - "Unit test proof: a taxed sales invoice line posts revenue at pre-tax and tax to salesTaxPayableAccount"
  - "Unit test proof: journal balances for a taxed line with header shipping and nonTaxableAddOnCost"
  - "No database migration — posting-function change only"
  - "TypeScript clean on affected packages"
  - "Biome lint clean on affected packages"
---

## Context

Carbon books sales tax collected from customers as **revenue** instead of a liability. On a $1,000 sale + $75 shipping @ 7% tax, the entire $1,150.25 is credited to `salesAccount` — revenue overstated ~14%, tax liability never recognized. The `salesTaxPayableAccount` (2210) is seeded, `NOT NULL` in schema, and form-validated as required — but **no posting function reads it**. This binding wires it.

Research: `.ai/research/shipping-tax-accounting.md` §1023-1031 (Phase 1) and §8.1 (Phase 0 / FX).

### IMPORTANT — the issue text has wrong paths. Use these REAL ones:

- `apps/erp/app/routes/api.post-sales-invoice/index.ts` **does not exist**. All GL posting lives in Deno edge functions. Real file: **`packages/database/supabase/functions/post-sales-invoice/index.ts`**.
- `packages/database/seed-data/accountDefaults.ts` and `accounts.ts` **do not exist**. Chart of accounts + defaults map both live in **`packages/database/supabase/functions/lib/seed.data.ts`** (accounts ~`:658-693`, defaults ~`:722-761`), mirrored by `migrations/20260315000000_reset-chart-of-accounts.sql`.
- `accountDefault` columns FK to **`account.number`** (composite `("column","companyId") -> ("number","companyId")`), NOT `account.id`. See `migrations/20230820020844_posting-groups.sql:102-104`. The research doc §1.2 is wrong on this.

## Scope — Phase 0 + Phase 1 ONLY

This issue was labeled `agent:needs-decomposition` because its six acceptance criteria span four research phases. This binding is the decomposition: the two slices the research calls independently shippable with no schema change.

### AC1 — Tax out of revenue (Phase 1)

File: `packages/database/supabase/functions/post-sales-invoice/index.ts`

Current, `:329-331`:
```ts
const totalLineCost =
  preTaxLineCost * (1 + (invoiceLine.taxPercent ?? 0)) +
  (invoiceLine.nonTaxableAddOnCost ?? 0);
```
`totalLineCostWithWeightedShipping` (`:347-349`) is then credited **whole** to `salesAccount` at `:423-429`.

Required: compute `taxAmount = preTaxLineCost * (invoiceLine.taxPercent ?? 0)` as a named term. Credit `salesAccount` with the **pre-tax** amount (plus weighted header shipping + nonTaxableAddOnCost, both untaxed — preserve their existing treatment). Credit `salesTaxPayableAccount` with `taxAmount` as a **separate journal line**.

Constraints:
- **The invoice total must not change.** The AR/receivables debit at `:447` stays exactly as-is. This is a pure re-split of the credit side. If the total moves, the change is wrong.
- Header shipping is untaxed and weighted by pre-tax basis (`:341-346`) — keep that.
- `nonTaxableAddOnCost` is excluded from the tax basis — keep that.
- Apply `invoiceExchangeRate` to the tax line the same way it is applied to the revenue line (`:349`).
- Skip the tax line entirely when `taxAmount` is 0 — do not emit zero-amount journal lines.
- `invoiceLineType === "Comment"` lines are non-postable — keep excluded.

### AC2 — FX direction consistency (Phase 0)

`post-receipt/index.ts:567-569` **multiplies**:
```ts
const shippingCost =
  (purchaseOrderDelivery.data?.supplierShippingCost ?? 0) *
  (purchaseOrder.data?.exchangeRate ?? 1);
```
`post-purchase-invoice/index.ts:560-562` **divides**:
```ts
const shippingCost =
  (purchaseInvoiceDelivery.data?.supplierShippingCost ?? 0) /
  (purchaseInvoice.data?.exchangeRate || 1);
```
At any rate != 1.0 these value the same freight in opposite directions; the gap lands silently in `purchaseVarianceAccount`.

Pick the direction that matches how `exchangeRate` is used **elsewhere in the same two files** for line costs (read the surrounding code — do not guess from the comment at `post-purchase-invoice:555-559`, which the research flags as wrong). Make both sides consistent with that established convention. State the chosen direction and the evidence in the PR body. If the two files disagree on convention even for line costs, say so in the PR body and mark this AC `unverified` rather than guessing.

### AC3 — Purchase tax isolated (Phase 1, no behavior change)

`post-purchase-invoice/index.ts` ~`:805` folds tax into inventory cost inline. US non-recoverable tax **correctly** capitalizes into inventory — **do not change this behavior**. Only extract it into a named term (e.g. `nonRecoverablePurchaseTax`) so Phase 4 has a seam. Behavior must be byte-identical.

## Explicitly OUT OF SCOPE — do not attempt

- **Outbound shipping → freight account** (issue AC3). Deferred to research Phase 2. The issue conflates two things: shipping *billed to a customer* is revenue, while `6040 "Freight & Shipping Out"` is an expense account for what we pay carriers. Needs a new shipping-revenue account number and a design call first.
  - ⚠️ Research §6.1/Phase 2 says to "adopt orphan account `4020`" for shipping revenue. **`4020` is not orphaned — it is `"Sales Discounts"`, already wired to `accountDefault.salesDiscountAccount`.** Only `6040` is genuinely unused. This is a live defect in the Phase 2 plan; do not act on it here.
- **Inbound freight explicit reporting** (issue AC4) — Phase 3, needs `itemCharge` + freight clearing.
- **`taxPostingSetup` matrix, `recoverability`, reverse charge, `reverseChargeSalesTaxPayableAccount`** — Phase 4.
- **Any database migration.** Phase 1 needs none: the invoice total is unchanged, so the `salesInvoices` view still reconciles. If you believe a migration is required, STOP and report rather than writing one — schema changes to accounting tables need a human decision.
- **Backfill / restatement of existing invoices.** Forward-fix only (issue AC6). Research explicitly calls this an accounting decision, not an engineering one.

## Behavior Gate

Unit tests. There is no DB/stack in this worktree — do NOT attempt browser or DB proof.

Prove:
1. A taxed sales invoice line ($1,000 @ 7%) → `salesAccount` credited $1,000, `salesTaxPayableAccount` credited $70.
2. Journal balances (`sum(debits) == sum(credits)`) for a line with header shipping + `nonTaxableAddOnCost` + tax.
3. A zero-tax line emits no tax journal line and posts exactly as before.

Follow the test precedent in `packages/database/supabase/functions/` — if edge functions have no existing unit-test harness, extract the pure computation into a testable helper and test that, rather than inventing a Deno test runner setup.

## Precedent

`packages/database/supabase/functions/shared/post-adjustment.ts` — GL posting helper template. PR #1157 (fixed-asset journal entries, merged) is the closest recent precedent for a posting-correctness change.

## Notes

- `pnpm install` is required in this worktree before gates will run.
- `pnpm --filter @carbon/config build` may be needed before the conformance gate passes.

## Budget
$12 (high risk, accounting correctness, 3 edge functions)
