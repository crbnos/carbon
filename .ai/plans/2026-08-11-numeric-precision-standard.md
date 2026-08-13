# Numeric Precision & Formatting Standard — Implementation Plan

**Spec:** `.ai/specs/2026-08-11-numeric-precision-standard.md` (all decisions resolved — do not re-litigate). The spec file is not in the repo; this plan is self-contained and is the source of truth.
**Branch:** `feat/numeric-precision-standard` off `main`
**Manual QA:** `.ai/plans/2026-08-11-numeric-precision-manual-testing.md`

## Ground rules

- Do not run `pnpm db:migrate` on shared environments without coordination; regenerate types (`pnpm run generate:types`) only after migrations are applied.
- Scoped typechecks only: `pnpm exec turbo run typecheck --filter=<pkg>` (whole-repo OOMs). ERP's filter name is `erp`.
- **PR #1370 is merged with its supplier-price precision work REVERTED in-PR** (revert commit `8d2a155b`): the `SUPPLIER_PART_PRICE_PRECISION` constant and the `supplier-part-unit-price-precision` migration do NOT exist on `main`. This PR re-does that work through the precision system: change 15 widens `supplierPart.unitPrice` (+ `supplierPartPrice`), change 12 redoes the four UI files via the price kind.
- **Migration order is load-bearing:** the ledger-widening migration (15a) must be applied before the 5dp posting flip (change 9) ships — otherwise the JS balance check passes on 5dp values and Postgres re-rounds each line to 4dp after the check (stored-imbalance window). The taxPercent flip (change 4) is catalog-only and independent. Never backdate migration timestamps (`.ai/lessons.md`).
- `deno check` on edge functions is not clean at baseline — gate on the DELTA of errors attributed to touched files, not exit code (`.ai/lessons.md`).
- Migration comments must not quote constrained types like `NUMERIC(10, 2)` literally — the `no-numeric-precision` conformance scan is a plain text match (this exact mistake was made and fixed inside PR #1370).
- Suggested commit grouping: (1) precision module + scrap fixes, (2) migrations + types + validators + write-path propagation, (3) TaxFields + forms, (4) formatting layer + sweeps, (5) posting functions + Xero boundary, (6) conformance checks + docs.

## Overview

| # | Change | Nucleus |
|---|--------|---------|
| 1 | Precision module | `functions/shared/precision.ts` (new) |
| 2 | Utils façade + tests | `packages/utils/src/math.ts`, `precision.test.ts` (new) |
| 3 | Scrap-ceil fixes (operation-quantity ceils + consolidation sites) | `recalculate`, `get-method`, production/sales app sites |
| 4 | taxPercent flip migration | new migration, 3 tables |
| 5 | Types regen + validators + tax value-pair propagation | models, services, convert fn, 6 write paths |
| 6 | Formatting layer (money / price / percent / quantity) | `packages/utils/src/format.ts` (new) |
| 7 | TaxFields component + adoption in 4 forms | `components/Form/TaxFields.tsx` (new), 4 forms |
| 8 | Formatter hooks + input-format sweep | 3 hooks + new `usePriceFormatter` |
| 9 | 5dp GL posting + settlement decimals (all 12 posting functions) | post-* functions, 2 tables, 2 services |
| 10 | Epsilon comparisons → equals | receiving, quality-disposition, quality AssociatedItemsList, traceability |
| 11 | toFixed-as-arithmetic fixes (incl. exchange-rate bug) | `lib/methods.ts`, `update-exchange-rates.ts` |
| 12 | Formatter sweep: raw Intl.NumberFormat + inline fraction digits | 17 files + supplier-part price UI redo |
| 13 | PDF percent + MES quantity displays | documents pdf blocks, MES views |
| 14 | NUMERIC type parser on pg pools | `lib/postgres/index.ts` (both branches) |
| 15 | Storage-scale widening (3 migrations: ledger first, purchasing cascade, tail) | migrations + RPC redeclarations |
| 16 | Conformance checks (3) + baseline | `packages/checks` |
| 17 | Rule doc + AGENTS.md | `.claude/rules/numeric-precision.md` |
| 18 | Xero boundary rounding | `packages/ee/src/accounting` payload builders |

## Execution status — verified 2026-08-12 at `f25c4f088`

Every ✅ below was confirmed by running the change's own verify command against
the branch, not from the commit log. `pnpm --filter @carbon/checks test` reports
**0 new violations**; scoped typecheck (`erp`, `@carbon/utils`) is clean; 160
utils tests pass.

| # | Status | Evidence / gap |
|---|---|---|
| 1 | ✅ | `functions/shared/precision.ts` present |
| 2 | ✅ | re-export in place, `roundAmount` 0 refs |
| 3 | ⚠️ | `Math.ceil` gone from `recalculate`/`get-method` and the target is never rounded — but written inline as `round(scrap, 0, Up)` + addition. **`withScrap()` has zero real call sites** despite being specified here and pinned in `precision.test.ts` |
| 4 | ✅ | `20260811123612_flip-purchasing-tax-percent-writable.sql` |
| 5 | 🟡 | validators carry `taxPercent`; duplicate PO copies it; `convert/index.ts` carries it. Two paths in the original six don't apply as written: `planning.update.tsx` writes no tax at all, and there is no `digital-quote.$id.tsx` route (the portal path is `share+/quote.$id.tsx`) |
| 6 | ✅ | `format.ts` + `format.test.ts` |
| 7 | ⚠️ | **3 of 4 forms.** `SupplierQuoteLinePricing` keeps a hand-rolled percent/amount pair instead of the component |
| 8 | ✅ | price/percent/quantity hooks present |
| 9 | ✅ | 0 refs of `round4` or `*10000/10000`; `post-receipt`/`post-shipment`/`post-sales-invoice`/`post-purchase-invoice` carry 38/20/33/58 explicit `round()` calls |
| 10 | ✅ | only geometry `1e-6` remains (inspection-overlay clamps — correctly excluded, same reasoning as `packages/viewer`) |
| 11 | ✅ | 0 `toFixed` in `lib/methods.ts` and `update-exchange-rates.ts` |
| 12 | ✅ | 0 hardcoded `new Intl.NumberFormat("en-US"` outside a test that pins a locale deliberately |
| 13 | 🟡 | PDF done (0 `taxPercent * 100`, 8 `formatPercent` uses). **10 `Math.round` sites in `apps/mes` were never classified display-vs-count** |
| 14 | ✅ | both drivers registered in `functions/lib/postgres/index.ts` |
| 15 | ✅ | 3 widening migrations applied; `journalLine.amount` is now bare NUMERIC (confirmed against the DB catalog), so change 9's 5dp is real and not re-rounded |
| 16 | ✅ | 3 checks + `sources/typescript.ts`; `newViolations()` returns 0 |
| 17 | ✅ | rule doc + Task Router row |
| 18 | 🟡 | `xero/serialize.ts` with `xeroMoney`/`xeroUnitAmount`, consumed by 6 files. The answer's first half — *post-payment writes balance/amountDue at the currency's decimals* — could not be confirmed: `balance` is read from a **view** in `post-payment/index.ts`, not written by it |

### Open items

1. **Currency decimals are not reachable client-side.** `decimalPlaces` lives only
   on the per-company `currency` table; `getCurrenciesList` selects `code, name`
   only, and there is no currencies store. Consequence today: tax amount fields
   honour the currency's decimals (via `TaxFields`), but **unit price, shipping
   and add-on entry fields do not** — a 0-decimal CAD still renders 2 decimals
   there. Read-only per-unit displays (document summaries, tables) and ~24
   base-currency cost/rate inputs likewise cap at 2.
   Three commits attempting this (`3901f4498`, `850b1e211`, `f508e843d`) were
   **reverted** on 2026-08-12 for diverging from this plan: they hardcoded `?? 2`
   (forbidden by change 7's rule) and loosened `priceFormatOptions` to make
   `decimalPlaces` optional, which removed the type-level pressure forcing call
   sites to supply real currency data. Recovery hash `f508e843d` (reflog).
   **Decision needed before re-attempting:** expose decimals client-side (add
   `decimalPlaces` to the currencies read + resolve in `usePriceFormatter`), or
   flag the sites and leave them.
2. `withScrap()` unused (change 3) — either route the sites through it or drop
   the helper; a specified-and-tested-but-uncalled helper is worse than neither.
3. `SupplierQuoteLinePricing` not on `TaxFields` (change 7).
4. 10 unclassified `Math.round` sites in `apps/mes` (change 13).
5. `PaymentForm.tsx` has an editable **Exchange Rate** input with inline
   `minimumFractionDigits: 2, maximumFractionDigits: 4`. Exchange rates are
   internal scale-5 values in this standard, so that input truncates a 5-decimal
   rate on blur — the same class change 11 fixed server-side. Verify whether it
   is baselined deliberately or was missed by change 12. Its **Total Amount**
   input formats with the *base* currency while the form has its own Currency
   field — worth confirming that is intended.
6. **Final validation not run repo-wide** — scoped typecheck plus utils/checks
   tests only; `pnpm run test` and `pnpm run build` still outstanding.

## Digit standard (reference)

Display digits equal input digits for every kind. Editable fields MUST use `INPUT_FORMAT` (react-aria's blur commit runs `parse(format(x))` — the input formatter is part of arithmetic).

| Kind | Digits | Notes |
|---|---|---|
| Percent / rate | min 0, max 3 | "5%", "6.25%", "6.255%" — trailing zeros never render |
| Quantity | min 0, max 5 | "3", "4.33333", "0.00125" — no "<0.01" placeholder |
| Currency (money AND price) | max = `currency.decimalPlaces`; min = the same by default | "$300.00", "$3.50", "$0.00", "¥63", "BHD 0.563" — ONE kind. A price is an amount in the same currency, so both render at that currency's decimals. PADDED by default: the width states the amount in full, which is the accounting convention. The decimals are also a ceiling, so a stored 300.33323 displays "$300.33"; storage keeps the rest. `usePriceFormatter` is an alias of `useCurrencyFormatter`, not a second implementation |
| ↳ trailing-zero preference | min 0 when set | `companySettings.hideCurrencyTrailingZeros` (default false) drops the non-significant zeros — "$300", "$3.5". DISPLAY and IN-APP only, and it covers EDITABLE fields too: `useCurrencyFormatter` and `MotionMoney` read it once via `useCurrencyMinDecimals`, and `~/components/Form`'s `Number`/`NumberControlled` wrappers (`CurrencyNumber.tsx`) apply it to any `style: "currency"` `formatOptions` — never a call site, which is why the ~80 `INPUT_FORMAT.money/price(...)` calls still pass two arguments. Overriding the MINIMUM is safe on an input even though `formatOptions` is part of the storage round-trip: react-aria commits `parse(format(x))` and only the MAXIMUM can change that. Documents render through the pure `formatMoney` and stay padded — a customer-facing invoice is where fixed-width money matters most — and an unauthenticated context (the public quote share page) has no settings to read, so it pads too |
| Editable currency (`INPUT_FORMAT.money` / `.price`) | same as above | an input formats with the SAME digits it displays with, padding included — an empty cost reads "$0.00". react-aria's blur commit is literally `setNumberValue(parse(format(x)))`, so this is not decoration — it is what a typed amount is STORED at: 300.22121 commits as 300.22 in USD, 63.4 commits as 63 in JPY. A per-unit price is entered and kept at the currency's decimals |

`currency.decimalPlaces` (DB column) is authoritative over Intl/CLDR defaults. Call sites never pass `minimumFractionDigits`/`maximumFractionDigits` — they pick a named kind; module-local `*_PRECISION` constants are the same violation.

**Two storage scales.** Internal values (per-unit prices, rates, quantities, GL journal lines) carry `SCALE = 5`. Settlement values (invoice balance/amountDue, applied payment amounts, payment totals, document totals) are written at `currency.decimalPlaces` — they never carry 5dp. This is a decided rule, not a preference.

---

## 1. Precision module

**Create** `packages/database/supabase/functions/shared/precision.ts`. Source lives Deno-side because the edge runtime only mounts `supabase/functions/` (same constraint as `sampling-engine.ts`). Dependency-free pure TS (imports nothing — this keeps the node re-export in change 2 safe per the `lib/database.ts` lesson). Exact content:

```ts
/** Internal precision: prices, rates, quantities, ledger amounts. */
export const SCALE = 5;

/** One comparison tolerance. 5dp values are multiples of 1e-5; float noise is ~1e-12. */
export const EPSILON = 1e-6;

export const RoundingMode = {
  /** Ties away from zero — matches Postgres round(). (Math.round(-2.5) = -2; Postgres = -3.) */
  HalfUp: "halfUp",
  /** Away from zero to the next step — scrap allowances. */
  Up: "up"
} as const;
export type RoundingMode = (typeof RoundingMode)[keyof typeof RoundingMode];

/** Exponent-shift: decimal-string round-trip, immune to 1.005-style float artifacts. */
const shift = (value: number, exp: number): number => {
  const [m, e = "0"] = value.toExponential().split("e");
  return Number(`${m}e${Number(e) + exp}`);
};

export function round(
  value: number,
  scale: number = SCALE,
  mode: RoundingMode = RoundingMode.HalfUp
): number {
  if (!Number.isFinite(value)) return value;
  const fn =
    mode === RoundingMode.Up
      ? (n: number) => Math.sign(n) * Math.ceil(Math.abs(n))
      : (n: number) => Math.sign(n) * Math.round(Math.abs(n));
  return shift(fn(shift(value, scale)), -scale);
}

/** Accumulates at full precision, rounds once at the end. */
export function sum(values: number[], scale: number = SCALE): number {
  let total = 0;
  for (const v of values) total += v;
  return round(total, scale);
}

export function equals(a: number, b: number): boolean {
  return Math.abs(a - b) < EPSILON;
}

/** Scrap allowance rounds up to whole units; the target itself is NEVER rounded.
 *  withScrap(4.5, 0)   === 4.5
 *  withScrap(31, 0.31) === 32 */
export function withScrap(target: number, scrap: number): number {
  return target + round(scrap, 0, RoundingMode.Up);
}

/** Tax/discount → settlement amount. `decimals` comes from currency.decimalPlaces — data, never a literal. */
export function applyRate(base: number, rate: number, decimals: number): number {
  return round(base * rate, decimals);
}

/** Ledger invariant. Throws with the drift so posting refuses rather than mis-posts.
 *  `tolerance` is a BUSINESS refusal threshold, distinct from EPSILON (float-noise guard):
 *  multi-currency journals legitimately carry small cross-rate residuals, so posting
 *  paths pass their domain tolerance explicitly (payment/memo: 0.01; manual/close: 0.001).
 *  The default EPSILON is for contexts that must balance exactly. */
export function assertBalanced(
  debits: number,
  credits: number,
  tolerance: number = EPSILON
): void {
  const drift = debits - credits;
  if (Math.abs(drift) > tolerance) {
    throw new Error(`Journal does not balance (off by ${round(drift)})`);
  }
}
```

No additional exports. No namespaces — flat API is a locked decision. Rule: a numeric literal as the `scale` argument outside this file is a violation — internal values use the default, settlement passes `currency.decimalPlaces`.

**Verify:** `deno check packages/database/supabase/functions/shared/precision.ts` (delta-gated; the file itself has no imports, so it should be clean)

## 2. Utils façade + tests

**Modify** `packages/utils/src/math.ts`:
- Delete `roundAmount` (zero consumers — verified).
- Append `export * from "../../database/supabase/functions/shared/precision.ts";` (same pattern as `packages/database/src/sampling.ts`; safe because precision.ts imports nothing — never let it grow an import of `lib/database.ts`). Keep `clamp`, `twoDecimals` (one consumer: `ConversionFactor.tsx`, sig-fig semantics — leave), `lerp`, `inverseLerp`.

**Create** `packages/utils/src/precision.test.ts` (import from `./math`; vitest config already exists in the package). Required pins:

| Assertion | Guards |
|---|---|
| `round(1.005, 2) === 1.01` | exponent-shift vs float artifact |
| `round(-2.5, 0) === -3` | Postgres tie parity |
| `round(4.33333333) === 4.33333` | default scale 5 |
| `withScrap(4.5, 0) === 4.5` | **the consumed-quantity regression** — target never rounded |
| `withScrap(31, 0.31) === 32` | scrap allowance still ceils |
| `applyRate(9, 0.0625, 2) === 0.56` | settlement rounding |
| `applyRate(1000, 0.0625, 0) === 63` | 0-decimal currency |
| `applyRate(9, 0.0625, 3) === 0.563` | 3-decimal currency |
| `sum([0.1, 0.2, 0.3], 2) === 0.6` | round once, not per term |
| `equals(0.1 + 0.2, 0.3)` true; `equals(1.00002, 1.00003)` false | tolerance |
| `assertBalanced(100, 100.001)` throws; equal args don't | ledger invariant (default EPSILON) |
| `assertBalanced(100, 100.005, 0.01)` does NOT throw; `assertBalanced(100, 100.02, 0.01)` throws | explicit business tolerance honored |

**Verify:** `pnpm --filter @carbon/utils test && pnpm exec turbo run typecheck --filter=@carbon/utils`
`grep -rn "roundAmount" apps packages --include="*.ts" --include="*.tsx" | grep -v node_modules` → no output.

## 3. Scrap-ceil fixes

PR #1312 already rewrote part of this area: `totalWithScrap = targetQuantity + scrapQuantity` is now computed WITHOUT a ceil (e.g. `recalculate/index.ts:226`), and the child-quantity ceils are gone. The surviving bug is downstream — **operation and tracked-entity quantities still ceil the whole total**:

- `packages/database/supabase/functions/recalculate/index.ts:260` — `operationQuantity: Math.ceil(totalWithScrap)`
- `packages/database/supabase/functions/recalculate/index.ts:273` — tracked-entity quantity
- `packages/database/supabase/functions/get-method/index.ts:627, 1534` — `const operationQuantity = Math.ceil(totalWithScrap)`
- `packages/database/supabase/functions/get-method/index.ts:5119` — `operationQuantity: Math.ceil(opQuantities.totalWithScrap)`

Fix: where `totalWithScrap` is built from a raw fractional scrap allowance, build it with `withScrap(target, scrap)` (import from `../shared/precision.ts`); the downstream `Math.ceil(totalWithScrap)` then drops so a fractional target (4.5) flows through to operations. Classify `:273` at implementation: if the tracked-entity quantity is a serial/entity COUNT it stays integer (keep the ceil and say so in a comment); if it is a batch quantity it follows the same fix. Sites have drifted once already — re-verify each against current `main` while implementing.

**Consolidation sites — `Math.ceil(qty * scrapPct)` (already correct direction); replace with `round(qty * scrapPct, 0, RoundingMode.Up)`** (import from `@carbon/utils`). Behavior-identical for positive inputs:

- `apps/erp/app/routes/x+/job+/update.tsx:90`
- `apps/erp/app/routes/x+/production+/planning.update.tsx:229`
- `apps/erp/app/modules/production/production.service.ts:~239, ~2871`
- `apps/erp/app/modules/production/ui/Jobs/JobForm.tsx:~183, ~320`
- `apps/erp/app/modules/sales/ui/SalesOrder/SalesOrderLineJobs.tsx:~112, ~230`

Do NOT touch (integer-by-nature): `production.service.ts:184` (job count), `bulk.new.tsx:52` (job counts), `ItemReorderPolicy.tsx` (order multiples), `PurchasingPlanningOrderDrawer.tsx:215` (whole-unit purchase UoM), AQL sampling (`shared/sampling-engine.ts`, `quality/samplingStandards.ts`), lead-time/week buckets (`lib/mrp-engine.ts`, `duration-calculator.ts`, `PurchasingPlanningTable.tsx`), pagination/scroll/geometry. (`JobHeader.tsx:1037` is a `Math.floor` half-split — not a ceil site; leave.)

Note: jobs created before this fix keep their inflated integer `estimatedQuantity` until `recalculate` next runs for them (any job quantity edit triggers it). No data migration.

**Verify:** `grep -rn "Math.ceil" packages/database/supabase/functions/recalculate packages/database/supabase/functions/get-method` → no output, except any site proven to be a serial/entity count (comment required); `deno check` both files (delta-gated); `pnpm exec turbo run typecheck --filter=erp`.

## 4. taxPercent flip migration

`pnpm db:migrate:new flip-purchasing-tax-percent-writable` — content:

```sql
-- Purchasing stored tax AMOUNTS and derived the RATE via a GENERATED column
-- (rate = amount / subtotal), making the rate a lossy echo of a cents-rounded
-- amount. DROP EXPRESSION converts each column to plain writable IN PLACE:
-- values are already materialized -> catalog-only, no backfill, no view drops.
ALTER TABLE "purchaseOrderLine" ALTER COLUMN "taxPercent" DROP EXPRESSION;
ALTER TABLE "purchaseOrderLine" ALTER COLUMN "taxPercent" SET DEFAULT 0;

ALTER TABLE "purchaseInvoiceLine" ALTER COLUMN "taxPercent" DROP EXPRESSION;
ALTER TABLE "purchaseInvoiceLine" ALTER COLUMN "taxPercent" SET DEFAULT 0;

ALTER TABLE "supplierQuoteLinePrice" ALTER COLUMN "taxPercent" DROP EXPRESSION;
ALTER TABLE "supplierQuoteLinePrice" ALTER COLUMN "taxPercent" SET DEFAULT 0;
```

Deliberately NOT included (locked decisions): no backfill/UPDATE, no retype to bare NUMERIC (already bare), no CHECK constraint (historical rows may exceed 1; range enforced in validators), no `SET NOT NULL` (columns stay nullable; every reader already does `?? 0`). Current generated definitions being replaced: `20250204164256_numeric-increase-2.sql:1861,1895,1925`. The generated denominator — the canonical subtotal per table — is uniform: `supplierUnitPrice * qty + supplierShippingCost` (qty column is `purchaseQuantity` on PO lines, `quantity` on the other two; shipping added once, not per unit). Forms and derivations must match it.

Known pre-existing hazard (out of scope, chip filed): the Xero EE pull path (`bill.ts:707`, `purchase-order.ts:548`) inserts `taxPercent: null` plus four still-generated columns — it errors today and keeps erroring after the flip.

**Verify (after apply):** the migration runs clean; change 5 confirms the types.

## 5. Types regen + validators + tax value-pair propagation

**The decided rule: `taxPercent` and the tax amount are ONE VALUE PAIR — one relative, one absolute. Any write that sets one must set both.** Forms set both via TaxFields (change 7); every programmatic write path below must too: copy the percent when the source row has one; derive it once (`amount / subtotal`, the old generated formula) when only an amount exists.

1. After the change-4 migration is applied: `pnpm run generate:types`. Never hand-edit generated types. Confirm `taxPercent` is writable for all three tables in `packages/database/src/types.ts` (note: the generator includes generated columns in Insert/Update types, so typecheck proves nothing here — the migration is the gate).
2. Add to each validator, adjacent to `supplierTaxAmount`:

```ts
taxPercent: zfd.numeric(z.number().min(0).max(1).optional().default(0)),
```

- `apps/erp/app/modules/invoicing/invoicing.models.ts` — `purchaseInvoiceLineValidator` (~:104, `supplierTaxAmount` at :130). The form already submits `taxPercent`; zod strips it today for lack of a key.
- `apps/erp/app/modules/purchasing/purchasing.models.ts` — `purchaseOrderLineValidator` (:205; `supplierTaxAmount` at :235), `selectedLineSchema` (:317) AND `selectedLinesValidator` (:327). The `.default(0)` matters: `sanitize()` turns present-but-`undefined` into NULL on the update path (`.ai/lessons.md`).
- **There is NO fetcher route or validator for the internal supplier-quote pricing grid** — `SupplierQuoteLinePricing.tsx` `onUpdatePrice` (:85-150) writes straight through the browser Supabase client (update :120-131, insert :137-141). Percent handling there is client-side (change 7). The portal path DOES validate: `api+/purchasing.digital-quote.$id.tsx` (:129-134) via `selectedLineSchema`/`nestedSelectedLinesValidator`, and its server mirror lives in `packages/database/supabase/functions/convert/index.ts:102-113` — amend both together.

3. Services — `upsertPurchaseInvoiceLine` (`invoicing.service.ts:796`), `upsertPurchaseOrderLine` (`purchasing.service.ts:1761`): confirm validated `taxPercent` flows into insert/update. Watch for form-only fields leaking into inserts (PGRST204 class) — only `taxPercent` becomes newly writable.

4. **Amount-carrying write paths that must now also set the percent** (today they'd write percent = 0 next to a real amount, and the form's base-change re-derivation would zero the amount on the next edit):

| Path | Site | Percent source |
|---|---|---|
| Duplicate PO | `purchasing.service.ts:143` (select list) → insert :191 | copy `taxPercent` (add to the copied column list) |
| Supplier quote → PO | `convert/index.ts:1656-1704` (`supplierTaxAmount` at :1689) | copy the break's `taxPercent` (exists after flip) |
| PO → purchase invoice | `convert/index.ts:404-437` (prorated amount at :421) | copy `line.taxPercent` — proration leaves the rate invariant |
| MRP planning order | `routes/x+/purchasing+/planning.update.tsx:378-394` | fix the ÷100 scale bug (`supplier.taxPercent` is a 0..1 FRACTION — `(unitPrice * taxPercent) / 100` at :390 is 100× off and ignores qty/shipping); write `taxPercent: supplier.taxPercent ?? 0` and derive the amount from the canonical denominator. Latent today (supplier.taxPercent has no edit UI), so fixing it changes nothing in practice |
| AI-extracted supplier invoice | `routes/x+/purchase-invoice+/new.tsx:132-165` (whole extracted tax on first line) | derive once: `subtotal > 0 ? lineTax / subtotal : 0` |
| Supplier portal quote submit | `api+/purchasing.digital-quote.$id.tsx:191-226` (:198, :215) | derive once from the break's amount/subtotal at write |

Benign (verified — no tax amount carried, percent 0/absent is correct): kanban PO lines, fixed-asset purchase, `create` purchaseOrderFromJob, receipt/shipment/invoice posting updates, reorder/short-close/bulk-date routes, seeds.

5. **PO line form reads the stored percent.** `PurchaseOrderLineForm.tsx` currently ignores the DB value and re-derives percent from the amount at mount (`getLineTaxPercent`, :165-170 and :221-226) — reopening a 6.25% line would show 6.22% forever, making the flip a no-op on that screen. Switch both tabs to seed from `initialValues.taxPercent ?? 0` (the route already passes it — `$orderId.$lineId.details.tsx:173`), mirroring `SalesInvoiceLineForm` (:132).

6. Regenerate the MCP tool metadata (`apps/erp/app/routes/api+/mcp+/lib/tool-metadata.json`) after the validator changes so `taxPercent` appears on the upsert tools — find and run its generation script; do not hand-edit.

**Verify:** `pnpm exec turbo run typecheck --filter=erp`; `grep -n "getLineTaxPercent" apps/erp/app/modules/purchasing/ui/PurchaseOrder/PurchaseOrderLineForm.tsx` → no mount-time derivation remains.

## 6. Formatting layer

**Create** `packages/utils/src/format.ts` + `format.test.ts`; **modify** `packages/utils/src/index.ts` to export it.

```ts
import { SCALE } from "./math";

/** Settlement money: padded to the currency's decimals — settlement zeros aren't empty. */
export function moneyFormatOptions(currency: string, decimalPlaces: number): Intl.NumberFormatOptions {
  return {
    style: "currency",
    currency,
    minimumFractionDigits: decimalPlaces,
    maximumFractionDigits: decimalPlaces
  };
}

/** Per-unit prices (scale 5): distributors quote in thousandths (0.164/ea, 0.00125/g).
 *  min = settlement padding, max = SCALE so the full stored price always renders. */
export function priceFormatOptions(currency: string, decimalPlaces: number): Intl.NumberFormatOptions {
  return {
    style: "currency",
    currency,
    minimumFractionDigits: decimalPlaces,
    maximumFractionDigits: SCALE
  };
}

/** Rates (0-1 fractions): 3 percent-digits — a scale-5 fraction round-trips exactly. */
export function percentFormatOptions(): Intl.NumberFormatOptions {
  return { style: "percent", minimumFractionDigits: 0, maximumFractionDigits: 3 };
}

/** Quantities: full storage precision (trailing zeros never render — 3 stays "3"). */
export function quantityFormatOptions(): Intl.NumberFormatOptions {
  return { minimumFractionDigits: 0, maximumFractionDigits: SCALE };
}

/** Editable inputs MUST use these: react-aria's blur commit runs parse(format(x)),
 *  making the input formatter part of the storage round-trip. */
export const INPUT_FORMAT = {
  rate: percentFormatOptions(),
  quantity: quantityFormatOptions(),
  money: (currency: string, decimalPlaces: number) => moneyFormatOptions(currency, decimalPlaces),
  price: (currency: string, decimalPlaces: number) => priceFormatOptions(currency, decimalPlaces)
};

export function formatMoney(value: number, locale: string, currency: string, decimalPlaces: number): string {
  return new Intl.NumberFormat(locale, moneyFormatOptions(currency, decimalPlaces)).format(value);
}
export function formatPrice(value: number, locale: string, currency: string, decimalPlaces: number): string {
  return new Intl.NumberFormat(locale, priceFormatOptions(currency, decimalPlaces)).format(value);
}
export function formatPercent(value: number, locale: string): string {
  return new Intl.NumberFormat(locale, percentFormatOptions()).format(value);
}
export function formatQuantity(value: number, locale: string): string {
  return new Intl.NumberFormat(locale, quantityFormatOptions()).format(value);
}
```

The inline-literal returns are safe for react-aria inputs: `packages/react/src/Number.tsx` stabilizes `formatOptions` by value (`useStableFormatOptions`) — do not add memoization at call sites.

Test pins: `formatPercent(0.0625, "en-US") === "6.25%"`; `formatPercent(0.06255, "en-US") === "6.255%"`; `formatMoney(4.5, "en-US", "USD", 2) === "$4.50"`; `formatPrice(0.164, "en-US", "USD", 2) === "$0.164"`; `formatPrice(4.5, "en-US", "USD", 2) === "$4.50"`; `formatQuantity(4.33333, "en-US") === "4.33333"`; `formatQuantity(3, "en-US") === "3"`; JPY has no fraction; BHD has 3; de-DE uses locale separators.

**Verify:** `pnpm --filter @carbon/utils test`

## 7. TaxFields component + adoption

**Create** `apps/erp/app/components/Form/TaxFields.tsx`; export from `apps/erp/app/components/Form/index.ts`. Markup precedent: the two `NumberControlled` grid cells at `PurchaseInvoiceLineForm.tsx:733-775`.

```ts
type TaxFieldsProps = {
  percentName: string;       // form field name, e.g. "taxPercent"
  amountName: string;        // e.g. "supplierTaxAmount"
  subtotal: number;          // caller computes: unitPrice * qty + shippingCost (the SQL denominator)
  currency: string;
  currencyDecimals: number;  // currency.decimalPlaces
  percent: number;
  amount: number;
  onChange: (next: { percent: number; amount: number }) => void;
};
```

Dataflow (the entire point of the component — the pair is coupled BOTH ways, so
whatever is stored is internally consistent):
- **Percent edited** → `onChange({ percent: v, amount: applyRate(subtotal, v, currencyDecimals) })`
- **Amount edited** → `onChange({ percent: subtotal > 0 ? round(v / subtotal) : percent, amount: v })`. The derived rate is rounded to internal scale so the stored value is exactly what the percent input renders.
- Precision only flows cleanly one way: a rate carries more decimals than a settlement amount, so a rate derived back from an amount is limited by that amount's scale (0.56 on a 9.00 subtotal is 6.222%, not the 6.25% that produced it). That is inherent, and is NOT the old 6.25% → 6.22% corruption — that came from deriving the amount UNROUNDED, so the money input re-committed a changed value on blur and fed it back through the coupling. Deriving the amount through `applyRate` makes blur commit an identical value, which triggers nothing.
- Percent input: `formatOptions={INPUT_FORMAT.rate}`, `minValue={0} maxValue={1}`, `step` from `INPUT_STEP.rate` (a step coarser than the field's scale SNAPS the committed value — `0.0001` truncated a typed 6.255% to 6.25%). Amount input: `formatOptions={INPUT_FORMAT.money(currency, currencyDecimals)}`, `minValue={0}`.
- Base-change re-derivation (qty/price/shipping edits recompute amount from percent) remains the caller's `useEffect` — component is controlled/stateless. Labels via `useLingui` macro.

**Adopt** (replace each hand-rolled percent/amount pair; keep each form's field names via props):

| Form | Sites |
|---|---|
| `invoicing/ui/PurchaseInvoice/PurchaseInvoiceLineForm.tsx` | item pair :733-775 AND indirect (G/L + Fixed-Asset) pair :968-1011 |
| `purchasing/ui/PurchaseOrder/PurchaseOrderLineForm.tsx` | item pair :850-894 AND indirect pair :1100-1145 (plus the change-5 seed fix) |
| `invoicing/ui/SalesInvoice/SalesInvoiceLineForm.tsx` | item pair :691-733; base-change `useEffect` (:135-149) uses `applyRate`; asset-tab percent-only field (:876-893) just gets `INPUT_FORMAT.rate` |
| `purchasing/ui/SupplierQuote/SupplierQuoteLinePricing.tsx` | **new percent ROW in the pricing grid** (per quantity break, beside the Tax Amount row :299-317). No validator exists — the grid writes client-side (`onUpdatePrice`); wire percent edits to write BOTH cells (value-pair rule): percent edit → `{ taxPercent, supplierTaxAmount: applyRate(breakSubtotal, v, decimals) }`; amount edit → keep stored percent |

**`currencyDecimals` needs a new read in all four routes** — no line-form loader loads a currency row today (only code strings; `decimalPlaces` is consumed in exactly one place app-wide, the exchange-rates admin). Add it via `getCurrencyByCode` (`accounting.service.ts:1693`) in each route loader, or extend the parent document loaders that already load `currencyCode`. Do not hardcode 2.

**Verify:** `pnpm exec turbo run typecheck --filter=erp`; `grep -rn "value / subtotal" apps/erp/app/modules --include="*.tsx"` → no output.

## 8. Formatter hooks + input-format sweep

- **Create** `apps/erp/app/hooks/usePriceFormatter.tsx` — thin wrapper over `priceFormatOptions`, same locale/currency resolution as `useCurrencyFormatter` (none exists today anywhere). Unit-price displays use this, never `useCurrencyFormatter({ maximumFractionDigits: ... })`.
- `usePercentFormatter.tsx` → options from `percentFormatOptions()` (2 → 3 digits, intended).
- `useQuantityFormatter.tsx` → options from `quantityFormatOptions()` (2 → 5 digits, intended). Delete the `"<0.01"` branch in `formatQuantityForDisplay` — unreachable at 5 digits (a scale-5 quantity below 0.01 renders itself, "0.00125"). Update `useQuantityFormatter.test.ts` (it tests the pure function — keep that pattern).
- `useCurrencyFormatter.tsx` → build from `moneyFormatOptions(...)` where decimals are reachable; keep the JSON-stringify memo keying (load-bearing — see comment in the file). Where `decimalPlaces` isn't reachable, Intl's currency default remains the fallback.
- MES has NO formatter hooks and imports nothing from ERP — its money/percent sites are handled per-site in changes 12/13.
- Sweep editable percent inputs still at `maximumFractionDigits: 2` → `INPUT_FORMAT.rate`; editable quantity inputs with digit caps → `INPUT_FORMAT.quantity`:
  `grep -rn 'style: "percent"' apps/erp/app apps/mes/app --include="*.tsx"` and check each for a digit cap + editability.

**Verify:** `pnpm exec turbo run typecheck --filter=erp --filter=mes`

## 9. 5dp GL posting + settlement decimals

**Two decided scales, applied per write target:**
- **GL journal lines (internal): `round(x)` at default scale 5.** Requires migration 15a applied first.
- **Settlement values (invoice balance/amountDue updates, applied amounts, payment totals): `round(x, currency.decimalPlaces)`.** These NEVER carry 5dp. Invoice paid-status dust forgiveness (`INVOICE_DUST_THRESHOLD = 0.01`, `invoicing.models.ts:456`) and the post-payment `0.0001` unapplied-dust band (tested: "sub-dust unapplied emits no on-account line") are deliberate business behavior — preserve both exactly.

Work:

- `post-payment/build-payment-journal.ts` — delete `round4` (:59), import `{ round, assertBalanced }` from `../shared/precision.ts`, replace uses (:172, :196, :213, :234, :262, :278, :304): journal-line amounts → `round(x)`; settlement-facing values → currency decimals. The refusal check (:302-306) becomes `assertBalanced(debits, credits, 0.01)` — **the existing `BALANCE_TOLERANCE = 0.01` (:106) is kept, NOT tightened to EPSILON.** Refusal tolerances are business thresholds (multi-currency journals legitimately accumulate sub-cent cross-rate residuals); tightening would make payments that post today start failing.
- `post-memo/build-memo-journal.ts` — same (`round4` def :29, uses :115, tolerance :92, predicate :166-169).
- `post-payment/index.ts` — import (:14), uses (:286, :709). `:709`'s `+ 0.0001` is the unapplied-dust band — keep the value and semantics (it may reference a named constant, but do not change behavior).
- The manual-journal and period-close checks (`accounting.service.ts:4599, :2515-2518`) keep their `0.001` if touched. **Do not silently unify 0.01 and 0.001 — they differ deliberately** (FX-accumulating vs user-entered journals).
- **The other ten posting functions write RAW unrounded float amounts today** — the `NUMERIC(19,4)` column has been their only rounding. Once 15a widens the columns, every journal/ledger amount write in `post-receipt`, `post-shipment`, `post-purchase-invoice`, `post-sales-invoice`, `post-inventory-adjustment`, `post-inventory-count`, `post-stock-transfer`, `post-picking`, `post-production-event`, `close-job`, and `shared/post-adjustment.ts` gets wrapped in `round(x)` (5dp). Mechanical; preserve each function's arithmetic otherwise.
- `post-payment/post-payment.test.ts` (local `round4` :79; literals at :745, :803): update helper + recompute expected values, don't hand-tweak.
- App: `PaymentApplyTable.tsx:78` and `AvailableCreditsTable.tsx:67` (local `round4` defs + call sites) — applied amounts are settlement values → currency decimals (flag if decimals aren't reachable in the route; add the read, don't hardcode). `invoicing.service.ts:1654` (base-currency credit) → settlement at base-currency decimals. `accounting.service.ts:464` and `:3934` (inline `*10000/10000`, consolidation/translation — GL values) → `round(x)` from `@carbon/utils`.

**Verify:** `grep -rn "round4\|10000) / 10000" apps packages --include="*.ts" --include="*.tsx" | grep -v node_modules` → no output.

## 10. Epsilons → equals

Replace hand-rolled `1e-6` comparisons with `equals`/`!equals`/`EPSILON` from `@carbon/utils`, preserving each site's boundary semantics exactly (`<` vs `<=`, signed vs abs):

- `packages/utils/src/receiving.ts:52` (`total > ordered + 1e-6`)
- `apps/erp/app/modules/quality/quality-disposition.server.ts:483, 485, 494, 526, 681, 905`
- `apps/erp/app/modules/quality/ui/Issue/AssociatedItemsList.tsx:209` (quality module, not items)
- `apps/erp/app/modules/inventory/ui/Traceability/utils.ts:160` — named `QTY_EPSILON = 1e-6` with SIGNED comparisons (:191, :198, :227, :243): import `EPSILON` and keep the signed forms verbatim.

Leave untouched: `packages/viewer` (geometry), inspection-document geometry guards, `VARIANCE_EPSILON = 0.005` (valuation/AR-AP workbenches) and `TIE_OUT_EPSILON = 0.01` (dashboard) — those are business variance thresholds, not float guards.

**Verify:** `grep -rn "1e-6" apps/erp/app apps/mes/app packages/utils packages/jobs --include="*.ts" --include="*.tsx" | grep -v node_modules | grep -v test | grep -v precision` → no output.

## 11. toFixed-as-arithmetic

- `packages/database/supabase/functions/lib/methods.ts:802`: `Number(unitPrice.toFixed(precision))` → `round(unitPrice, precision)` (import from `../shared/precision.ts`; `precision` is the per-quote-line `unitPricePrecision ?? 2` column — data, so no literal-scale violation).
- `packages/jobs/src/inngest/functions/scheduled/update-exchange-rates.ts:199-202` — **live bug, twice over**: the rate is rounded to `currency.decimalPlaces` (a 0-decimal currency's rate loses its whole fraction; any rate < 0.005 rounds to 0), and the truthiness `.filter((c) => c.exchangeRate)` (:206) then silently DROPS the zeroed rate, freezing that currency forever. Replace with `round(rate)` at default scale 5 (`@carbon/utils`); keep the falsy filter for genuinely missing rates. Target column `currency.exchangeRate` is `NUMERIC(20,8)` — no migration needed. First post-deploy nightly run will update previously-frozen currencies (expected).

**Verify:** `pnpm exec turbo run typecheck --filter=@carbon/jobs`; `deno check packages/database/supabase/functions/lib/methods.ts` (delta-gated)

## 12. Formatter sweep: raw Intl.NumberFormat + inline fraction digits

`grep -rln "new Intl.NumberFormat" apps/erp/app apps/mes/app --include="*.ts" --include="*.tsx"` — 17 files / 23 real constructions on current main.

- **Locale bugs (fix first)** — hardcoded `"en-US"`: `IntercompanyTransactionTable.tsx:60`, `IntercompanyBalanceMatrix.tsx:46`, `QuoteLinePricingHistory.tsx:168,263`, **`items/ui/Item/SupplierPartForm.tsx:322`** (PurchaseHistory). Also `apps/mes/app/routes/display+/$workCenterId.maintenance.tsx:174` passes `undefined` locale (browser default) — use the app locale (MES wraps `I18nProvider` at `root.tsx:263`). Replace with the hooks / `useLocale()`-driven formatters (pattern: `PivotTree.tsx:127`).
- Components → hooks; non-component code → pure `formatMoney/formatPrice/formatPercent/formatQuantity`.
- String-built money like `` `$${x.toFixed(2)}` `` (`maintenance/$dispatchId.items.tsx:108,114`) → formatter (also removes the hardcoded `$`).
- **Supplier-part price UI (the re-do of #1370's reverted hunks, via the price kind — no constant):** `SupplierPartForm.tsx` main unitPrice input → `INPUT_FORMAT.price(...)`; PurchaseHistory display → `usePriceFormatter`; PriceBreaks `EditableNumber` formatOptions → price kind; `SupplierParts/SupplierParts.tsx` grid formatter → `usePriceFormatter`; `PurchasingPlanningOrderDrawer.tsx:105` formatter → `usePriceFormatter`. (`SUPPLIER_PART_PRICE_PRECISION` never landed — there is nothing to delete.)
- **Inline fraction-digit options**: `grep -rn "maximumFractionDigits\|minimumFractionDigits" apps/erp/app apps/mes/app --include="*.tsx" --include="*.ts"` — every hit outside the formatter hooks migrates to a named kind. Unit-price columns elsewhere (supplier quote pricing, PO line price displays) use the price kind too.
- Every file is migrated or explicitly baselined in change 16 — none skipped silently.

**Verify:** `grep -rn 'new Intl.NumberFormat("en-US"' apps --include="*.tsx" --include="*.ts"` → no output; `pnpm exec turbo run typecheck --filter=erp --filter=mes && pnpm run lint`.

## 13. PDF percent + MES quantity displays

- PDF: `(taxPercent * 100).toFixed(2) + "%"` → `formatPercent(taxPercent, locale)`:
  `packages/documents/src/pdf/blocks/LineItemsBlock.tsx:125`, `blocks/salesOrder/LineItemsBlock.tsx:125`, `blocks/quote/LineItemsBlock.tsx:198`, `packages/documents/src/utils/shared.ts:81` (`formatTaxPercent`, consumed by the purchaseOrder block). Locale threading differs per block: the quote block already receives `locale`; the invoice and salesOrder blocks receive only a pre-built `numberFormatter` — thread `locale` from the same construction site that builds it; `formatTaxPercent` gains a locale parameter.
- MES `Math.round(<quantity>)` cluster — classify per site:
  - `apps/mes/app/utils/units.ts:35` — tracked-entity/serial COUNT, integer by nature: keep (baseline in change 16).
  - `AssemblyView.tsx:826`, `assembly.$operationId.tsx:160` — operation-quantity → unit COUNT (`Math.max(1, ...)`): keep integer for the unit axis.
  - `AssemblyView.tsx:840`, `InspectionView.tsx:583`, `assembly.$operationId.tsx:178` — `quantityComplete` rounded to INDEX the unit array / progress: the index math stays integer (material-issue attribution keys off it — see the comment at `assembly.$operationId.tsx:171-176`), but any DISPLAYED quantity uses `formatQuantity`. Split expressions that mix both.

**Verify:** `pnpm exec turbo run typecheck --filter=@carbon/documents --filter=mes`

## 14. NUMERIC type parser

Reality of `lib/postgres/index.ts`: `import { Pool } from "pg"` resolves to **deno-postgres under Deno** (the `deno.json` import map pins `"pg": "jsr:@db/postgres@0.19.5"`) and **npm `pg` 8.x under Node** — one file, two drivers. `setTypeParser` is an npm-pg API and does not exist on deno-postgres.

- **Node branch**: register once beside the pool construction — `import { types } from "pg"; types.setTypeParser(1700, (v: string) => Number(v));` guarded to the node path. This single registration covers every node Kysely consumer (jobs, ERP server) — they all reach pools through this file via `packages/database/src/client.ts`.
- **Deno branch**: deno-postgres 0.19.x exposes `controls.decoders` instead, keyed by OID — register `1700: (value: string) => Number(value)` there so NUMERIC decodes to a JS number and Deno matches Node. The decoder only fits the ClientOptions **object** form of the connection config, not the URI-string form, so the connection URL is parsed by hand at that site (sslmode mapping mirrors the driver's own). Both branches decoding means edge functions no longer receive NUMERIC as strings.
- Existing ad-hoc `Number(...)` coercions in edge functions stay — they are harmless no-ops once both decoders are registered. `float8` columns still arrive as strings; only OID 1700 is covered.
- Script `pg.Client` sites (`packages/checks/src/scripts/*`, `packages/dev/src/services/migrations.ts`) are read-only tooling — leave.

PostgREST/supabase-js reads are unaffected (already deserialize NUMERIC as JSON numbers).

**Verify:** `pnpm exec turbo run typecheck --filter=@carbon/database`; `grep -rn "setTypeParser" packages --include="*.ts" | grep -v node_modules` → the node-branch hit; `grep -n "decoders" packages/database/supabase/functions/lib/postgres/index.ts` → the Deno-branch OID 1700 decoder.

## 15. Storage-scale widening (audit executed — three migrations)

The format layer cannot save a value the column already rounded (Postgres casts on write) — entry → display → **storage** must all carry the scale. The audit is done; these are the surviving clamps (newest-definition-wins across all 916 migrations). Mechanics that apply throughout: a NUMERIC scale change is a **full table rewrite** under ACCESS EXCLUSIVE — batch all of a table's columns into ONE `ALTER TABLE`; `GENERATED ... STORED` columns can't be `ALTER TYPE`d — drop and re-add them (forking the NEWEST definitions, and rebuild dependent views); array columns use `TYPE NUMERIC[] USING "col"::NUMERIC[]`; never quote old constrained types in comments (conformance text-scan).

### 15a — Ledger + RPC signatures (MUST land before change 9 ships)

`pnpm db:migrate:new widen-ledger-amounts` →

- `journalLine.amount` NUMERIC(19,4) → NUMERIC; `journalLine.quantity` (12,4) → NUMERIC
- `costLedger.cost`, `costLedger.nominalCost` (19,4); `costLedger.quantity`, `costLedger.remainingQuantity` (12,4) → NUMERIC
- `itemLedger.quantity` (12,4) → NUMERIC — gotchas: it backs the `itemLedgerSnapshot` matview and sits in the `supabase_realtime` publication; handle both around the rewrite
- `supplierLedger.amount` (19,4) → NUMERIC
- `intercompanyTransaction.amount` (19,4) → NUMERIC
- RPC redeclarations, forking each function's NEWEST definition (grep all migrations, take the last — lesson: forking an older body silently reverts fixes): `trialBalance`, `translateTrialBalance` (NUMERIC(19,4) returns), `getIntercompanyBalance`, `matchIntercompanyTransactions` (19,4), `get_job_operations_by_work_center` (10,2 — never revised unlike its siblings), `get_sales_order_lines_by_customer_id` (NUMERIC(9,2) returns; newest def `20250828115039_portal-steps-use-process-name.sql` — the portal truncates today) → bare NUMERIC.

### 15b — Purchasing cascade

- `purchaseOrderLine`: `conversionFactor` (10,2), `exchangeRate` (10,4), `setupPrice` (9,2). Widening `conversionFactor` requires dropping/re-adding the generated price chain that references it (`unitPrice`, `extendedPrice`, `shippingCost`, `taxAmount`, `supplierExtendedPrice` — fork from `20250807094441`, the newest) and rebuilding the dependent views. `taxPercent` is plain after change 4 — untouched by the cascade.
- `purchaseInvoiceLine`: `conversionFactor` (10,2), `exchangeRate` (10,4) + the same generated-chain mechanics (incl. `totalAmount`).
- `purchaseInvoice` header: `subtotal`/`totalDiscount`/`totalAmount`/`totalTax`/`balance` (10,2 — also a magnitude cap), `exchangeRate` (10,4).
- `purchaseInvoicePriceChange`: previous/new price + quantity (10,2).
- `receiptLine`: `conversionFactor` (10,2); `unitPrice`, `orderQuantity`, `outstandingQuantity`, `receivedQuantity` (18,4).
- `supplierPart.unitPrice` (10,2 — the #1370 re-do; the `20260129150000` `ADD COLUMN IF NOT EXISTS` was a no-op on existing databases); `supplierPartPrice.quantity` (20,2 — PK member, index rebuild) and `unitPrice` (15,5 → bare for consistency).
- `supplierQuote.exchangeRate`, `supplierQuoteLinePrice.exchangeRate` (10,4); `supplierQuoteLine.quantity` NUMERIC(20,2)[] (array); `purchasingRfqLine.quantity` (20,2)[].
- `supplierProcess.unitCost`, `minimumCost` (10,4); `purchaseOrder.exchangeRate` (10,4).

### 15c — Sales, production, master-data tail

- Document FX snapshots (10,4) → NUMERIC: `salesOrder`, `salesOrderLine`, `quote`, `quoteLinePrice` `exchangeRate` (note `20260410031804_exchange-rate-interceptors.sql` writes header rates into line columns — after widening, header and line agree at full precision); `quoteShipment.shippingCost`, `salesOrderShipment.shippingCost` (10,4).
- `quoteLine.quantity` (20,2)[] (elements key `quoteLinePrice`'s PK), `salesRfqLine.quantity` (20,2)[]; `quoteLinePrice` `discountPercent`/`markupPercent`/`unitCost`/`leadTime`/`extendedPrice` (10,5 — `extendedPrice` also a magnitude cap); `pricingRule.minQuantity`/`maxQuantity` (20,2); `customerItemPriceOverrideBreak.quantity` (20,2 — in a DEFERRABLE unique constraint; drop/re-add with the same deferrability).
- Production: `job` quantity columns (10,4, incl. generated `productionQuantity`), `jobMaterial.productionQuantity` (GEN), `jobMakeMethod.quantityPerParent`, `quoteMakeMethod.quantityPerParent` (10,4), `jobOperation` quantities + rates (10,4 / `quantityReworked` 10,2), `quoteOperation` rates (10,4), `workCenter.machineRate`/`overheadRate` (10,4), `rework.quantity` (10,4), `pickingListLine` (12,4, generated `outstandingQuantity`), `pickingListLineTrackedEntity` (12,4), `nonConformanceItemTrackedEntity.quantity` (12,4).
- Rate-shaped multipliers: `itemReplenishment.scrapPercentage`, `jobMaterial.itemScrapPercentage`, `jobMakeMethod.itemScrapPercentage` (5,2), `methodOperation.productionStandard`, `quoteOperation.productionStandard` (10,4), `fixedAsset`/`fixedAssetClass` `taxResidualValuePercent`/`bonusDepreciationPercent` + `companySettings.assetTaxRate` (5,2 — the sibling money columns are already bare).

**Deliberately skipped** (not value-bearing at ledger scale): operation duration columns (`setupTime`/`laborTime`/`machineTime` 10,2 — product granularity decision), lead-time day columns, `version` columns (10,2), forecast `confidence` (3,2), AQL (5,3 — ISO ladder), counts/status numerics.

Deploy note: `journalLine`, `itemLedger`, `costLedger`, `jobOperation`, `purchaseOrderLine`, `purchaseInvoiceLine`, `salesOrderLine`, `receiptLine`, `pickingListLine` are large transactional tables — each rewrite holds an exclusive lock; coordinate timing (that is why this is three migrations, riskiest first and reviewable alone).

**Verify:** after apply + `pnpm run generate:types`: portal sales-order lines return full-precision prices; `pnpm exec turbo run typecheck --filter=erp`; `pnpm --filter @carbon/checks test` (no-numeric-precision baseline shrinks, no new hits).

## 16. Conformance checks

In `packages/checks` (precedents: `sources/migrations.ts` loader, `conformance/no-numeric-precision.ts` check shape — `ConformanceCheck` with pure `scan`). Registration reality: `CONFORMANCE_CHECKS` runs over SQL migrations, `SERVER_CHECKS` over server TS via `loadServerFiles` — the two new TS checks apply to client AND server code, so they get their OWN source + array, not a ride on `SERVER_CHECKS` (whose globs/masking exist for server-only rules).

- **Create** `src/sources/typescript.ts`: recursive `.ts`/`.tsx` loader over `apps/erp/app/components`, `apps/erp/app/hooks`, `apps/erp/app/modules`, `apps/erp/app/routes`, `apps/mes/app`, `packages/database/supabase/functions` (exclude `image-resizer`, `logo-resizer`), `packages/ee/src`, `packages/jobs/src`, `packages/documents/src/pdf`, `packages/documents/src/utils`; exclude tests. The `components`/`hooks`/`ee` roots are not optional: `TaxFields.tsx`, the four formatter hooks, and the Xero serializer are the standard's own surface — `no-inline-fraction-digits` even carries per-file exclusions for the hooks, which are dead weight unless that root is scanned. Prove coverage: grep one known-bad file into the scan (lesson: a check is only as good as its source glob).
- **Create** `src/conformance/no-derived-percent-column.ts` (SQL migrations source, register in `CONFORMANCE_CHECKS`): flag `"...Percent"`/`"...Rate"` columns `GENERATED ALWAYS AS` with `/` in the expression. Baseline the 5 historical migrations (`20241210214820`, `20250109000722`, `20250109034107`, `20250128195311`, `20250204164256`).
- **Create** `src/conformance/no-raw-rounding.ts` (TS source): flag `Math.round(` / `Math.ceil(` / `Math.floor(` / `.toFixed(` per line. Message points to `@carbon/utils` + the rule doc.
- **Create** `src/conformance/no-inline-fraction-digits.ts` (TS source): flag `minimumFractionDigits` / `maximumFractionDigits` — exclude `packages/utils/src/format.ts` and the formatter hooks. Message: "Pick a named kind from @carbon/utils format.ts (money/price/percent/quantity, INPUT_FORMAT.*) instead of passing digits."
- **Snippet discipline:** `keyOf` is `checkId::file::snippet` (line-independent by design). For the TS checks use the TRIMMED FULL LINE as the snippet, not the bare match — a `Math.ceil(` snippet would collapse all of a file's hits into one baseline key and hide new violations in already-baselined files.
- Register: both TS checks in a new `TS_CHECKS` array + a `scanAll(loadTypescriptFiles(root), TS_CHECKS)` line in `collectFindings`; export from `src/index.ts`. Unit tests for each (inline-literal `scan` calls, per house pattern); the real-scan test needs a raised timeout (see the `run.test.ts` precedent comment).
- **Regenerate `baseline.json` last** (after changes 3, 9–13 land) via `pnpm --filter @carbon/checks baseline`. Surviving NOT-IN-CLASS sites (order multiples, lot sizes, lead-time/day buckets, sampling tables, time/HH:MM math, MES counts, pagination, label geometry) go in the baseline. Migrated classes must contribute zero entries — a nonzero count is a missed site; fix it, don't baseline it.

**Verify:** `pnpm --filter @carbon/checks test`; fresh-baseline `newViolations()` count is 0.

## 17. Rule doc + AGENTS.md

- **Create** `.claude/rules/numeric-precision.md`: the two-scale table (internal `SCALE = 5`; settlement `currency.decimalPlaces`, DB column authoritative over CLDR), the digit-standard table from this plan, three-boundary rule (round only at persist/display/compare; Postgres computes derived values; intermediates full precision), no-scale-literals rule, no-inline-fraction-digits rule, `INPUT_FORMAT` editable-input rule, the tax value-pair rule ("percentages are stored facts; taxPercent+amount are one pair — any write that sets one sets both; amounts derive via `applyRate`"), external-boundary rule (serialize at the consumer's contract — Xero constants live in the adapter), the Deno/node driver asymmetry from change 14, pointers to the three conformance checks. `paths:` frontmatter covering precision.ts, math.ts, format.ts, the conformance checks, the Xero entity builders.
- **Modify** root `AGENTS.md`: Task Router row for the rule; one line noting `packages/utils/src/math.ts` re-exports `functions/shared/precision.ts` by design (edge-runtime constraint) — not an import to "fix".
- Add an `.ai/lessons.md` entry for the react-aria blur-commit formatter trap (`Context → Problem → Rule → Applies to`).

**Verify:** `ls .claude/rules/numeric-precision.md && grep -n "numeric-precision" AGENTS.md` → file exists, router row present.

## 18. Xero boundary rounding

`packages/ee/src/accounting/providers/xero/entities/*` applies NO rounding at serialization — the DB typmods are the only clamp today, and 15a/15b remove several of them. Decided rule: **every amount rounds at serialization** — `currency.decimalPlaces` for totals/payments/balance (`SubTotal`, `TotalTax`, `Total`, `AmountDue`, `AmountPaid`, `LineAmount`, `TaxAmount`), 4dp for `UnitAmount` (Xero's max). Use named constants in the adapter (e.g. `XERO_UNIT_AMOUNT_DECIMALS = 4`) — this is an external contract, so the constants are data of the boundary, not scale literals.

- Sites: `invoice.ts` (:337-345, :391-395), `bill.ts` (:366-377, :407-411), `purchase-order.ts` (:344-352, :373-375), `sales-order.ts` (:189-200, :275-278), `inventory-adjustment.ts` (:200, :214, :221 — the ManualJournal is raw `Math.abs(quantity) * unitCost` today).
- This also fixes a pre-existing bug: `LineAmount` is sent as raw `quantity * unitPrice`, so float garbage (0.45000000000000007) can go out **today**, before any of our changes.
- `CurrencyRate` behavior note (not a code change): rates now carry 5dp, so near-1 rates that used to snapshot to exactly 1 (and be omitted) will start being sent explicitly — expected.
- Out of scope, chips filed: the sales-invoice `TaxAmount` ÷100 scale bug and the pull-path generated-column inserts.

**Verify:** `pnpm exec turbo run typecheck --filter=@carbon/ee` (or the package's actual filter name); unit test the builders' rounding if the package has test infra, else code-review evidence in the PR.

## Final validation

```bash
pnpm run lint
pnpm exec turbo run typecheck --filter=erp --filter=mes --filter=@carbon/utils --filter=@carbon/checks --filter=@carbon/documents --filter=@carbon/jobs --filter=@carbon/database
pnpm run test
```

Then run the manual checklist: `.ai/plans/2026-08-11-numeric-precision-manual-testing.md`.

Local note: migrations must be applied locally before `pnpm run generate:types`; if `supabase migration up` trips on the known phantom-migration divergence, repair with `supabase migration repair --status applied` (see memory note) — coordinate before touching any shared database.
