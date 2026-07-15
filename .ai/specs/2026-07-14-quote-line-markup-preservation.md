# Quote Line Markup Preservation — stop the default markup from overwriting a set price

> Status: draft
> Author: Brad Barbin
> Date: 2026-07-14

## TLDR

When a BOM cost changes on a quote line, `recalculateQuoteLinePrices` reprices
every quantity break. Today, any price row whose stored `categoryMarkups` is
empty falls back to the **company default markups** and recomputes `unitPrice`
from cost — silently overwriting a price the user had already set. With a 0%
default, a line the user marked up 10% collapses to cost. This spec makes an
already-set price authoritative: the default markup only ever prices rows that
have **no price yet**, an all-zero default is treated as "feature off," and a
direct price/markup edit clears any stored category markups so the user's value
always wins. Markup is virtual (`(price − cost)/cost`), so "a price is set" is
the signal we key on — no new schema column.

## Problem Statement

Markup on a quote line price is not stored as a scalar — it is derived in the UI
as `(price − cost) / cost` (`apps/erp/app/modules/sales/ui/Quotes/QuoteLinePricing.tsx:812`).
The persisted fields are `quoteLinePrice.unitPrice` and a per-cost-category
`categoryMarkups` JSONB (whole-percent values, e.g. `25` = 25%). Company defaults
live in `companySettings.quoteLineCategoryMarkups` (stored as fractions, ×100 on
use); the default company value is `{}`.

`recalculateQuoteLinePrices` (`apps/erp/app/modules/sales/sales.service.ts:4423-4551`)
runs on every BOM material/operation change (add / edit / delete of a
`quoteMaterial` or `quoteOperation`, and on quote-line creation). Its per-row
logic:

```ts
// sales.service.ts:4485-4487
const rowMarkups = (row.categoryMarkups as Record<string, number>) ?? {};
const markups =
  Object.keys(rowMarkups).length > 0 ? rowMarkups : defaultMarkups; // ← bug
// unitPrice := Σ categoryCost × (1 + markups[cat]/100), then resolvePrice(...)
```

**How a row ends up with empty `categoryMarkups`:** the two most common editing
paths save only `unitPrice` and never touch `categoryMarkups`:

- Editing the price cell directly → `onUpdatePrice("unitPrice", …)` (`QuoteLinePricing.tsx:481`).
- Editing the virtual **Markup Percent** cell → `onUpdatePrice("unitPrice", quantity, cost * (1 + value))` (`QuoteLinePricing.tsx:825-830`).

Pull-from-inventory (`resolveQuoteLinePrices`) and purchase-to-order
(`resolvePurchaseToOrderPrices`) rows also start with empty `categoryMarkups`.

So a user-set price row has empty `categoryMarkups` → on the next cost change the
fallback recomputes it from the **default** markup. With the default at 0% the
price drops to cost. This is silent and, on a customer-facing quote,
potentially devastating.

**Second path to the same symptom (non-zero default):** `calculatePricesForQuantities`
(Make-to-Order initial pricing, `sales.service.ts:4271`) *seeds*
`categoryMarkups: defaultMarkups`. When the default is 0% it seeds
`{ …: 0 }` — a non-empty object of zeros. The user then sets a price/markup
(saving only `unitPrice`, leaving the stale zeros in place). On recalc, the
non-empty branch reprices from those stale zeros → back to cost. From the user's
seat this reads as "the 0% default overwrote my markup."

### Concrete example (the reported case)

1. Company default markups are all 0%.
2. A quote line is priced; the user sets the **Markup Percent** cell to 10%
   (cost $100 → price $110). Only `unitPrice = 110` is saved.
3. The user changes a material's unit cost on the BOM.
4. `recalculateQuoteLinePrices` runs, sees empty (or stale-zero) `categoryMarkups`,
   applies the 0% default, and rewrites `unitPrice = 100`.
5. The quoted price silently dropped to cost; margin is gone.

## Proposed Solution

Treat a quote line price as one of three states, distinguished by the **price**
(the user's stated signal — no new column):

| State | Signal | Behavior on BOM cost change |
|-------|--------|------------------------------|
| **Cost-plus** | `categoryMarkups` non-empty | Reprice = Σ cost × (1 + markup). Keeps the markup, updates the price. *(unchanged — the intended feature)* |
| **Fixed price** | `categoryMarkups` empty **and** `unitPrice > 0` | **Preserve `unitPrice` exactly. Never apply the default.** *(the fix — Q1: preserve price)* |
| **Unpriced** | `unitPrice` is null or `0` | Apply the default markup **if enabled**; otherwise price at cost (empty `categoryMarkups`). |

Plus two supporting rules:

1. **Default markups are "disabled" when every category value is `0` (or the
   object is empty).** When disabled, defaults are never applied and never
   seeded — anywhere. *(Q2)*
2. **A direct price or virtual-markup edit clears the row's stored
   `categoryMarkups`.** This turns the row into a *fixed price* so the user's
   explicit value always wins on the next recalc — closing the non-zero-default
   stale-markup hole. *(Q3: option A)* The per-category markup editor
   (`onUpdateCategoryMarkup`) still writes `categoryMarkups` and keeps the row
   *cost-plus*.

Net effect: **an explicitly set price is authoritative** — the only thing that
reprices a row on a cost change is an explicit per-category markup the user chose.

### "Disabled" helper

A single predicate governs both service functions:

```ts
// true when at least one category default is a positive markup
const defaultsEnabled = Object.values(defaultMarkups).some((v) => v > 0);
const effectiveDefaults = defaultsEnabled ? defaultMarkups : {};
```

`defaultMarkups` is the ×100 (whole-percent) form already built in both
functions from `companySettings.quoteLineCategoryMarkups`.

### Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Preserve **price** or **markup %** for a fixed-price row on cost change | Preserve the **price** | Q1. Matches "if a price is set we shouldn't set a new price." A silent customer-facing price change is the harm we're removing; the displayed markup % is virtual and may drift as cost moves — acceptable. |
| Detect "a price is set" | `unitPrice > 0` (no new column) | Q4 (folded in). User's steer: "since markup is virtual, we can probably look at the price." A genuine $0 line is not treated as set — acceptable edge (a $0 line is already a "please price me" state). |
| Detect "cost-plus" vs "fixed" | `categoryMarkups` non-empty ⇒ cost-plus | Reuses the existing signal; per-category markups are the only explicit cost-plus intent in the model. |
| When is the default "disabled" | Every category default `0` (or empty `{}`) | Q2. Company default is `{}` today, so the feature is off until configured; all-zeros is the user turning it off. |
| Effect of a direct price / virtual-markup edit | Clear `categoryMarkups` on that row | Q3-A. Makes "explicit price wins" universal, including non-zero-default MtO lines where stale seeded markups otherwise revert the override. |
| Schema change | None | Q4. Heuristic on `unitPrice` + `categoryMarkups` is sufficient; no migration, no Ask-First schema touch. |
| Backward compatibility (heuristic 7) | No FROZEN/STABLE surface touched | Behavior-only change inside two service functions and two UI edit handlers; `quoteLinePrice` shape unchanged, `upsertQuoteLinePrices` preservation semantics unchanged. |

## Data Model Changes

**None.** No tables, columns, or migrations. The fix relies entirely on the
existing `quoteLinePrice.unitPrice` and `quoteLinePrice.categoryMarkups`
columns and `companySettings.quoteLineCategoryMarkups`.

Cost categories in scope (keys of `categoryMarkups` / the settings validator,
`settings.models.ts:334-343`): `materialCost`, `partCost`, `toolCost`,
`consumableCost`, `laborCost`, `machineCost`, `overheadCost`, `outsideCost`.

## API / Service Changes

All changes are in `apps/erp/app/modules/sales/sales.service.ts`.

### 1. `recalculateQuoteLinePrices` (`:4423-4551`) — the core fix

Replace the per-row markup resolution + unconditional reprice. New per-row logic:

- Compute `effectiveDefaults` (empty when disabled).
- `const rowMarkups = row.categoryMarkups ?? {}`.
- **If `rowMarkups` is non-empty (cost-plus):** reprice exactly as today —
  `rollupPrice = Σ cost × (1 + rowMarkups[cat]/100)`, then `resolvePrice(...)`,
  write `unitPrice` and keep `categoryMarkups: rowMarkups`.
- **Else if `row.unitPrice > 0` (fixed price):** preserve the row unchanged —
  re-insert with the same `unitPrice` and empty `categoryMarkups`. Do **not**
  call `resolvePrice`, do **not** apply defaults.
- **Else (unpriced):** if `effectiveDefaults` is non-empty, reprice using it and
  seed `categoryMarkups: effectiveDefaults`; otherwise price at cost rollup
  (markup 0) with empty `categoryMarkups`.

`discountPercent`, `leadTime`, `exchangeRate`, and the delete-then-reinsert
mechanics stay as-is (the function still preserves those fields).

### 2. `calculatePricesForQuantities` (`:4182-4288`) — don't seed a disabled default

- Build `defaultMarkups` as today, then apply the `defaultsEnabled` gate.
- `rollupPrice` uses `effectiveDefaults` (so a disabled default prices at cost).
- Seed `categoryMarkups: effectiveDefaults` — i.e. `{}` when disabled, so the row
  is created as *fixed/unpriced* rather than a stale-zeros *cost-plus* row.

### 3. No change to siblings

`resolveQuoteLinePrices` (Pull) and `resolvePurchaseToOrderPrices` (P2O) already
insert empty `categoryMarkups`; under the new recalc rules their prices are
preserved (fixed price) rather than clobbered — no edit needed.
`upsertQuoteLinePrices` (`:3830-3911`) already preserves existing
`categoryMarkups` and is unchanged.

## UI Changes

All in `apps/erp/app/modules/sales/ui/Quotes/QuoteLinePricing.tsx`.

### 1. Direct price + virtual-markup edits clear `categoryMarkups` (Q3-A)

`onUpdatePrice` (`:481`) is used by both the price cell and the virtual **Markup
Percent** cell (`:825-830`). When it updates `unitPrice`, it must also clear the
row's `categoryMarkups` (set to `{}`) in both the optimistic `editableFields`
state and the `quoteLinePrice` update, so the row becomes *fixed price* and the
next recalc preserves it. (Non-`unitPrice` keys — `leadTime`, `discountPercent`,
`shippingCost` — must **not** clear markups.)

`onUpdateCategoryMarkup` (`:430`) is unchanged: it writes `categoryMarkups` +
`unitPrice`, keeping the row *cost-plus*.

### 2. No display change required

Investigated and rejected: the per-category markup cells already render
`categoryMarkupsByQuantity[quantity]?.[category] ?? 0` (`:877`), so an all-zero
(disabled) default shows `0%` regardless — the fallback is already visually inert
for the disabled case. The virtual **Markup Percent** row (`:793-838`) reads the
real price and is always accurate. The one pre-existing quirk (an *enabled*
non-zero default shows in the per-category cells of a fixed-price row) is
unchanged by this fix and out of scope. No settings-UI change either:
`CategoryMarkupsCard` (`routes/x+/settings+/sales.tsx`) already lets the user set
all categories to 0, which now means "disabled."

## Acceptance Criteria

- [ ] With default markups all 0%: on a Draft quote, a user sets a line's Markup
      Percent to 10% (cost $100 → $110), then edits a BOM material's unit cost.
      The quantity break still shows **$110** (not $100); the markup reads ~10%
      minus any drift from the cost change, never 0%.
- [ ] With a **non-zero** default (e.g. 30%): a Make-to-Order line is created
      (seeded at 30%), the user overrides the price to $150, then changes a BOM
      cost. The line stays at **$150** — the stale 30% does not revert it.
- [ ] A line with an explicit **per-category** markup (set via the category
      markup editor) still reprices when a BOM cost changes — markup held, price
      updated. *(cost-plus behavior preserved)*
- [ ] With defaults all 0%: a new Make-to-Order line is created priced **at cost**
      with empty `categoryMarkups` (no `{…:0}` seed).
- [ ] With a non-zero default: a **new, never-priced** line still auto-prices from
      the default on creation/recalc (feature intact when enabled).
- [ ] Pull-from-inventory and purchase-to-order lines keep their resolved prices
      across a BOM cost change (not recomputed to cost-plus).
- [ ] `discountPercent`, `leadTime`, and `exchangeRate` survive every recalc for
      all three row states.
- [ ] `pnpm --filter @carbon/erp typecheck` passes.

## Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| A never-touched, disabled-default line priced at cost is preserved on later cost changes and goes stale (price < new cost) | Low | Accepted per Q1 — with defaults off the user prices manually anyway; cost vs price is visible in the pricing grid. A $0-margin line is already a "set a price" prompt. |
| `unitPrice > 0` misclassifies a legitimately free ($0) line as unpriced and reprices it | Low | Edge case; current code already reprices $0 lines. Documented in Design Decisions. |
| Clearing `categoryMarkups` on a price edit discards a user's earlier per-category markup breakdown | Low | Intentional (Q3-A): a direct price edit is an explicit override of the whole line; the per-category editor remains the way to stay cost-plus. |
| Other callers apply/seed defaults and are missed | Med | Implementation greps `quoteLineCategoryMarkups`, `defaultMarkups`, and `categoryMarkups` across `sales.service.ts` and routes to confirm only the three sites above consume defaults. |
| Existing rows already carrying stale `{…:0}` markups (from before this fix) still revert on recalc | Low | These are cost-plus-at-0 = price-at-cost; a single price/virtual-markup edit now clears them permanently. No data migration required; note in PR. |

## Open Questions

> Resolved with the user before this spec was written (spec-writing Step 5).

- [x] **For a fixed-price row (empty `categoryMarkups`), preserve the price or the
      markup % when BOM cost changes?** — **Answer:** Preserve the **price** (Q1).
      "If a price is set we shouldn't set a new price"; the virtual markup may
      drift and that is acceptable.
- [x] **What counts as "the default markup feature is disabled"?** — **Answer:**
      Every category default is `0` (or the setting is empty `{}`) (Q2). When
      disabled, defaults are never applied or seeded.
- [x] **Also fix the non-zero-default variant, where a Make-to-Order line's
      seeded `categoryMarkups` reverts a later direct price/markup override?** —
      **Answer:** Yes — a direct price/markup edit clears the row's
      `categoryMarkups` so the explicit value wins (Q3, option A).
- [x] **Detect "a price is set" via `unitPrice > 0`, or add an override flag
      column?** — **Answer:** Use the `unitPrice > 0` heuristic, no new schema —
      per the user's "look at the price" steer (folded into Q1).

## Changelog

- 2026-07-14: Created. Open questions Q1/Q2/Q3 resolved with the user before
  writing (Q1 = preserve price, Q2 = confirmed all-zero/empty ⇒ disabled,
  Q3 = A = clear `categoryMarkups` on direct price/markup edits).
