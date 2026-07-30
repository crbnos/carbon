# Fix #1203 — Purchase order unit prices rounded to 2 decimal places

## Root cause (differs from the issue's assumption)

The truncation is **not** in the database or the zod validators:

- `purchaseOrderLine.supplierUnitPrice` is already a **bare `NUMERIC`** (unlimited
  precision) — `20250204164256_numeric-increase-2.sql`. The generated `unitPrice`
  (`= supplierUnitPrice / exchangeRate`) is also bare `NUMERIC`. No CHECK/trigger
  rounds it, and the edge functions don't round it either.
- The zod validator is `supplierUnitPrice: zfd.numeric(z.number().optional())` — no
  precision/`.min()`/rounding constraint.

The rounding is purely a **UI formatting** artifact: the unit-price
`NumberControlled` input uses `formatOptions={{ style: "currency", currency }}`
with no `maximumFractionDigits`, so react-aria clamps committed values to the
currency's default fraction digits (2 for USD). The read-only display formatters
(`useCurrencyFormatter`, PDF `numberFormatter`, email `getCurrencyFormatter`)
likewise default to 2 dp.

## Decision: no DB migration; fixed 6-dp precision (not per-line `unitPricePrecision`)

- A migration would be a **no-op** for precision (`supplierUnitPrice` is already
  bare `NUMERIC`). This environment also has **no Postgres running**, so
  `generate:types` cannot run and a new typed column could not be consumed.
- Quotes solve this with a per-line `unitPricePrecision` column + picker, but its
  CHECK is `IN (2,3,4)` (max 4 dp) — **less** than the issue's `$0.00123` (5 dp) /
  "≥6" requirement, and it would need the blocked migration + type regen. So we do
  not mirror it here; instead we lift the UI cap to **6 dp** at the PO unit-price
  surfaces (satisfies "at least 6"; DB already stores full precision).

## Edits

1. `apps/erp/app/modules/purchasing/ui/PurchaseOrder/PurchaseOrderLineForm.tsx`
   - Item-line + indirect-line `supplierUnitPrice` inputs: add
     `maximumFractionDigits: 6` to `formatOptions` (the actual fix — lets users
     enter >2 dp).
   - Add a `unitPriceFormatter` (6 dp) and use it for the collapsed price badge.
2. `apps/erp/app/modules/purchasing/ui/PurchaseOrder/PurchaseOrderSummary.tsx`
   - Add 6-dp `unitPriceFormatter` / `presentationUnitPriceFormatter`; use them for
     the unit-price rows only (extended price / totals / tax stay at 2 dp).
3. `packages/documents/src/pdf/blocks/purchaseOrder/LineItemsBlock.tsx`
   - Local 6-dp `unitPriceFormatter` for the unit-price cell (net/totals stay 2 dp).
4. `packages/documents/src/email/PurchaseOrderEmail.tsx`
   - 6-dp `unitPriceFormatter` via `getCurrencyFormatter(..., 6)` for the unit-price
     cell (TOTAL stays 2 dp).

## Verification

- `pnpm --filter @carbon/erp typecheck`
- `pnpm --filter @carbon/documents typecheck`
- `pnpm run lint`
- Draft PR (do not merge).
