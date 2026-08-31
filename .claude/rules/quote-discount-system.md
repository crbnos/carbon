---
paths:
  - "packages/database/supabase/migrations/*pricing-rules*.sql"
  - "apps/erp/app/modules/sales/sales.service.ts"
  - "apps/erp/app/modules/sales/ui/Quotes/QuoteLinePricing.tsx"
  - "apps/erp/app/modules/sales/ui/Pricing/*.tsx"
---

# Quote Discount & Pricing System

Discounts live on **quote line prices** (per quantity break), and there is also a
standalone, company-scoped **pricing rule** engine (Discount/Markup) that drives the
*base unit price* during cost rollup. The two are distinct — see "Two layers" below.

## Schema: `quoteLinePrice`

PK is **`(quoteLineId, quantity)`** — there is no `id` column (the original `id` PK
was dropped in `20240802114117_quote-line-quantities.sql`, which also dropped the
original `unitCost`/`markupPercent`/`extendedPrice` columns and added `unitPrice`).
Current columns (after later migrations):

- `quoteId`, `quoteLineId`, `quantity` NUMERIC, `unitPrice` NUMERIC
- `discountPercent` NUMERIC(10,5) DEFAULT 0 — stored as a **fraction 0..1** (e.g. 0.10 = 10%), NOT a whole number
- `leadTime` NUMERIC, `shippingCost` NUMERIC (`20241105002325_quote-taxes-and-shipping.sql`)
- `exchangeRate` NUMERIC DEFAULT 1 (`20241010193506_quote-order-presentation-currency.sql`)
- `categoryMarkups` JSONB DEFAULT `'{}'` (`20260307000000_quote-line-category-markups.sql`) — per-cost-category markup % keyed by `costCategoryKeys`, stored as whole percent (e.g. 25 = 25%)
- **Generated (STORED) columns** from `20241010193506`:
  - `netUnitPrice` = `unitPrice * (1 - discountPercent)`
  - `convertedUnitPrice` = `unitPrice * exchangeRate`
  - `convertedNetUnitPrice` = `unitPrice * exchangeRate * (1 - discountPercent)`
  - `netExtendedPrice` = `unitPrice * (1 - discountPercent) * quantity`
  - `convertedNetExtendedPrice` = `unitPrice * exchangeRate * (1 - discountPercent) * quantity`
  - `convertedShippingCost` = `shippingCost * exchangeRate`

A trigger on `quote.exchangeRate` cascades the new rate into every `quoteLinePrice` row.

`quoteLine` itself has **no** `discountPercent`; it has `taxPercent`, `additionalCharges`
(JSONB), `quantity` (array of breaks), plus `pricingRuleId` and `priceTrace` JSONB
(`20260413120001_pricing-rules.sql`). `quote` has no discount field.

## Schema: `pricingRule` (`20260413120001_pricing-rules.sql`)

Standalone rules, `id` default `id('pr')`, scoped to a company. Columns: `name`,
`ruleType` (`pricingRuleType` enum = `'Discount' | 'Markup'`), `amountType`
(`pricingRuleAmountType` enum = `'Percentage' | 'Fixed'`, default `Percentage`),
`amount` NUMERIC, `priority` INT, `minQuantity`/`maxQuantity`, `customerIds[]`,
`customerTypeIds[]`, `itemIds[]`, `itemPostingGroupId`, `validFrom`/`validTo`,
`active` BOOLEAN. Same migration adds `salesOrderLine.pricingRuleId` + `priceTrace`.
<!-- UNVERIFIED: schema also declares `formulaBase` and `minMarginPercent` columns, but neither the validator (`pricingRuleValidator`) nor `applyPriceRules` reads them — appear unused -->

## Two layers, and how discount is applied

1. **Quote-line discount** (`quoteLinePrice.discountPercent`): a per-quantity-break
   percentage editors enter in `QuoteLinePricing.tsx`. Net price = `unitPrice * (1 - discount)`
   (also materialized in the generated `netUnitPrice` column). The UI computes the same
   net for display; persistence is the generated columns.

2. **Pricing-rule engine** (`resolvePrice` → `applyPriceRules` in `sales.service.ts`):
   resolves a *base unit price* during quote-line price recalculation (cost rollup with
   `categoryMarkups`, then `resolvePrice`). Precedence: customer override > customer-type
   override > all-customers override > base (`itemUnitSalePrice`). Overrides may set
   `applyRulesOnTop=false` to skip rules. Then `applyPriceRules`:
   - **Discount rules: non-stacking** — highest `priority` wins; ties broken by best
     effective amount. Percentage = `price * amount`; Fixed = `amount`.
   - **Markup rules: stack** in priority order, compounding on the running price.
   - Final price clamped to ≥ 0.
   Each step is recorded as a `PriceTraceStep` (`{ step, source, amount, adjustment?, ruleId? }`)
   into `priceTrace`. The winning rule's id lands on `quoteLine.pricingRuleId`.

`upsertQuoteLinePrices(db, companyId, quoteId, lineId, prices)` deletes and
re-inserts rows **inside one Kysely transaction** (so a failed insert rolls the
delete back instead of leaving the line with no pricing). Per-quantity carry-over
of the user-entered fields (`discountPercent`, `leadTime`, `shippingCost`,
`categoryMarkups`, `priceSource`) is **explicit-wins, omit-preserves**
(`resolvePreservedQuoteLinePriceFields` in `sales.utils.ts`): a value the caller
provides is written, a field the caller omits keeps the stored value for that
quantity, and a brand-new row with neither falls back to the column default —
`priceSource` defaulting to `"manual"` (a hand-set price with no declared source
is a manual override, not a system cost-plus price). This is why the recalc route
(`$quoteId.$lineId.recalculate-price.tsx`) passes ONLY the recomputed `unitPrice`
(+ explicit `priceSource: "system"`) and omits lead time / discount / shipping —
so the user's entries survive. When an explicit `prices` array is passed, the
rewrite also **syncs `quoteLine.quantity`** to the sorted distinct quantities of
the rows (the precision rebuild, which omits `prices`, leaves the breaks alone).
It takes a `Kysely<KyselyDatabase>`, not a supabase client, so it bypasses RLS —
every statement is scoped by `companyId` explicitly and the route must authorize
with `requirePermissions` first. Any user-entered column added to `quoteLinePrice`
has to be added to `resolvePreservedQuoteLinePriceFields` or the delete+reinsert
silently resets it to its default.
The rewrite throws if the quote or line is missing for that company, because the
insert's `companyId` is overwritten by a trigger from the parent quote — without
the check it would write into whichever company owns the quote. An **empty**
`prices` array is a no-op, not a wipe: dropping a quantity break is
`reconcileQuantityBreaks`' job, so an empty rewrite leaves the rows alone.

`updateQuoteLinePrecision(db, companyId, quoteId, lineId, precision)` shares that
transaction: it sets `quoteLine.unitPricePrecision` and re-rounds the existing
price rows together, so the line can never advertise a precision its prices were
never rounded to. `precision` is not validated in app code — `quoteLine` carries
`CHECK ("unitPricePrecision" IN (2,3,4))`, and the update runs before any
rounding, so an out-of-range value aborts the transaction before `toFixed` sees
it.

## Types & UI

- `QuotationPrice` type = a row of `getQuoteLinePrices(...)` (`sales.service.ts`),
  derived in `apps/erp/app/modules/sales/types.ts` (not a hand-written list).
- `PricingRule` type and `PriceTraceStep` also in `types.ts`.
- `pricingRuleValidator` in `sales.models.ts`; Percentage `amount` must be ≤ 1.
- UI: `ui/Quotes/QuoteLinePricing.tsx` (per-quantity discount/markup editing) and
  the `ui/Pricing/` folder (`PricingRuleForm`, `PricingRulesTable`, `PriceOverrideForm`,
  `PriceTracePopover`).

## Gotchas

- `discountPercent` is a **fraction (0..1)**, not 0..100. `categoryMarkups` values are
  whole percent; `companySettings.quoteLineCategoryMarkups` defaults are stored as
  fractions and multiplied by 100 when used as fallback.
- The doc's old claim that `markupPercent`/`extendedPrice` exist on `quoteLinePrice` is
  **wrong** — they were dropped in 2024. Markup now lives in `categoryMarkups` (rollup)
  and `pricingRule` (engine).
- `quoteLinePrice` has **no `id`** — PK is `(quoteLineId, quantity)`.
- Sales orders/invoices: `salesOrderLine` now carries `pricingRuleId` + `priceTrace`
  (so rule provenance *does* propagate to orders), but invoice lines do not. Quote→order
  conversion goes through the `convert` edge function (`convertQuoteToOrder`).
