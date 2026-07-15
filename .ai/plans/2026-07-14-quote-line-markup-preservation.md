# Quote Line Markup Preservation — implementation plan

**Spec:** .ai/specs/2026-07-14-quote-line-markup-preservation.md
**Research:** N/A (focused bug-fix; no competitor research — see spec)
**Branch:** fixquote-markup-aggressiveness

## Progress
- [x] Task 1: Add pure pricing-decision helpers + unit tests (`sales.utils.ts`)
- [x] Task 2: Wire helpers into `recalculateQuoteLinePrices` + `calculatePricesForQuantities`
- [x] Task 3: Clear `categoryMarkups` on direct price / virtual-markup edits (UI)
- [ ] Task 4: Browser-verify the acceptance criteria via `/test`

## Dependencies
- Task 2 needs Task 1 (imports the helpers).
- Task 3 is independent of Tasks 1–2 (different file); may run in parallel.
- Task 4 needs Tasks 2 and 3 (verifies end-to-end behavior).

## Context the executor must know (no session memory assumed)

- **Markup is virtual.** The only stored fields are `quoteLinePrice.unitPrice` and
  `quoteLinePrice.categoryMarkups` (a JSONB map of cost-category → whole-percent
  markup, e.g. `{ laborCost: 25 }` = 25%). The UI shows markup as
  `(price − cost) / cost`.
- **Company defaults** live in `companySettings.quoteLineCategoryMarkups`, stored
  as **fractions** (0.30 = 30%); both service functions already multiply each
  value by 100 to build a whole-percent `defaultMarkups` map.
- **The bug:** `recalculateQuoteLinePrices` (runs on any BOM cost change) falls
  back to `defaultMarkups` whenever a row's `categoryMarkups` is empty `{}`, and
  recomputes `unitPrice` from cost — silently overwriting a price the user set.
- **The fix (three row states):**
  - *cost-plus* (`categoryMarkups` non-empty) → reprice from those markups (keep).
  - *fixed price* (`categoryMarkups` empty **and** `unitPrice > 0`) → **preserve
    `unitPrice`; never apply the default**.
  - *unpriced* (`unitPrice` 0/null) → apply the default **if enabled**, else price
    at cost.
- **Disabled default:** when every category default is `0` (or empty), the whole
  default-markup feature is off — never applied or seeded.
- **No schema change.** All decisions key on `unitPrice` + `categoryMarkups`.

---

## Task 1: Add pure pricing-decision helpers + unit tests

**Depends on:** none
**Files:**
- Create: `apps/erp/app/modules/sales/sales.utils.ts`
- Create: `apps/erp/app/modules/sales/sales.utils.test.ts`
- Copy from (precedent): `apps/erp/app/modules/accounting/accounting.utils.ts` and its test `apps/erp/app/modules/accounting/accounting.utils.test.ts` (pure functions + colocated vitest, zero DB/env imports)

**Why a separate `sales.utils.ts`:** the pricing logic must be unit-testable
without a database. `sales.service.ts` transitively imports `@carbon/env`,
Supabase clients, and edge-function code — importing it into a test is heavy and
side-effectful. `accounting.utils.ts` is the established home for DB-free logic;
mirror it. Keep `sales.utils.ts` dependency-free (no imports).

**Steps:**

1. Create `apps/erp/app/modules/sales/sales.utils.ts` with exactly these exports:

   ```ts
   export type CategoryMarkups = Record<string, number>;

   /**
    * Company default markups are "enabled" only when at least one cost category
    * has a positive markup. An all-zero or empty default means the feature is
    * off, so it is treated as "no defaults" everywhere it is consumed.
    * (Markups are whole-percent, non-negative — e.g. `{ laborCost: 25 }`.)
    */
   export function getEffectiveDefaultMarkups(
     defaultMarkups: CategoryMarkups
   ): CategoryMarkups {
     const enabled = Object.values(defaultMarkups).some((v) => v > 0);
     return enabled ? defaultMarkups : {};
   }

   export type RecalcPricingDecision =
     | { mode: "reprice"; markups: CategoryMarkups }
     | { mode: "preserve" };

   /**
    * Decide how `recalculateQuoteLinePrices` should treat one existing price row
    * when a BOM cost changes:
    *   - cost-plus  (explicit `categoryMarkups`) → reprice from those markups
    *   - fixed price (no markups but a set `unitPrice`) → preserve; never apply
    *     the default markup (the core fix)
    *   - unpriced   (no markups, no price) → reprice from the effective defaults
    *     (which is `{}` — i.e. price at cost — when defaults are disabled)
    */
   export function decideRecalcPricing(
     row: { categoryMarkups: CategoryMarkups | null; unitPrice: number | null },
     effectiveDefaults: CategoryMarkups
   ): RecalcPricingDecision {
     const rowMarkups = row.categoryMarkups ?? {};
     if (Object.keys(rowMarkups).length > 0) {
       return { mode: "reprice", markups: rowMarkups };
     }
     if ((row.unitPrice ?? 0) > 0) {
       return { mode: "preserve" };
     }
     return { mode: "reprice", markups: effectiveDefaults };
   }
   ```

2. Create `apps/erp/app/modules/sales/sales.utils.test.ts` importing from
   `./sales.utils` (relative import, like the accounting precedent). Cover every
   spec acceptance criterion at the logic level:

   ```ts
   import { describe, expect, it } from "vitest";
   import { decideRecalcPricing, getEffectiveDefaultMarkups } from "./sales.utils";

   describe("getEffectiveDefaultMarkups", () => {
     it("returns {} when all category defaults are 0 (feature disabled)", () => {
       expect(getEffectiveDefaultMarkups({ laborCost: 0, materialCost: 0 })).toEqual({});
     });
     it("returns {} when the defaults object is empty", () => {
       expect(getEffectiveDefaultMarkups({})).toEqual({});
     });
     it("returns the defaults unchanged when at least one is positive", () => {
       const d = { laborCost: 30, materialCost: 0 };
       expect(getEffectiveDefaultMarkups(d)).toEqual(d);
     });
   });

   describe("decideRecalcPricing", () => {
     it("reprices a cost-plus row from its explicit categoryMarkups", () => {
       expect(
         decideRecalcPricing({ categoryMarkups: { laborCost: 20 }, unitPrice: 120 }, { laborCost: 30 })
       ).toEqual({ mode: "reprice", markups: { laborCost: 20 } });
     });
     it("PRESERVES a fixed-price row (empty markups, price set) — default never overrides", () => {
       expect(
         decideRecalcPricing({ categoryMarkups: {}, unitPrice: 110 }, { laborCost: 30 })
       ).toEqual({ mode: "preserve" });
     });
     it("preserves a fixed-price row even when the default is 0% (the reported case)", () => {
       expect(
         decideRecalcPricing({ categoryMarkups: {}, unitPrice: 110 }, {})
       ).toEqual({ mode: "preserve" });
     });
     it("treats null categoryMarkups as empty", () => {
       expect(
         decideRecalcPricing({ categoryMarkups: null, unitPrice: 110 }, {})
       ).toEqual({ mode: "preserve" });
     });
     it("prices an unpriced row from the effective defaults", () => {
       expect(
         decideRecalcPricing({ categoryMarkups: {}, unitPrice: 0 }, { laborCost: 30 })
       ).toEqual({ mode: "reprice", markups: { laborCost: 30 } });
     });
     it("prices an unpriced row at cost (empty markups) when defaults are disabled", () => {
       expect(
         decideRecalcPricing({ categoryMarkups: {}, unitPrice: 0 }, {})
       ).toEqual({ mode: "reprice", markups: {} });
     });
   });
   ```

**Verify:**
```bash
pnpm --filter erp exec vitest run app/modules/sales/sales.utils.test.ts
# Expected: "Test Files  1 passed (1)" and all tests passing (9 tests)
```

**Out of scope:** Do NOT put these helpers in `sales.service.ts`, and do NOT add
DB/env/Supabase imports to `sales.utils.ts` (keeps the test fast and pure). Do
not add them to the `index.ts` barrel — `sales.service.ts` and the test import
them directly via `./sales.utils`.

---

## Task 2: Wire helpers into the two service functions

**Depends on:** Task 1
**Files:**
- Modify: `apps/erp/app/modules/sales/sales.service.ts` — add import; rewrite the per-row loop in `recalculateQuoteLinePrices`; use effective defaults in `calculatePricesForQuantities`

**Steps:**

1. Add the import near the existing `import { costCategoryKeys } from "./sales.models";`
   (line ~58):
   ```ts
   import { decideRecalcPricing, getEffectiveDefaultMarkups } from "./sales.utils";
   ```

2. **`recalculateQuoteLinePrices`** (currently `:4423-4551`). The defaults are
   built into `defaultMarkups` at `:4457-4474` — leave that block as is. Replace
   the per-row loop that currently starts at `const updatedRows = [];` (`:4482`)
   and runs through the end of the `for` loop (`:4526`) with:

   ```ts
   const effectiveDefaults = getEffectiveDefaultMarkups(defaultMarkups);

   const updatedRows = [];
   for (const row of existingPrices.data) {
     const qty = row.quantity;

     const decision = decideRecalcPricing(
       {
         categoryMarkups: row.categoryMarkups as Record<string, number> | null,
         unitPrice: row.unitPrice
       },
       effectiveDefaults
     );

     // Fixed price: the user set an explicit price and the row has no
     // per-category markups. Preserve it exactly — never re-derive from the
     // default markup (the core fix).
     if (decision.mode === "preserve") {
       updatedRows.push({
         quoteId: row.quoteId,
         quoteLineId: row.quoteLineId,
         companyId: row.companyId,
         quantity: row.quantity,
         unitPrice: row.unitPrice,
         categoryMarkups: row.categoryMarkups ?? {},
         exchangeRate: row.exchangeRate,
         createdBy: row.createdBy,
         updatedBy: userId,
         leadTime: row.leadTime,
         discountPercent: row.discountPercent
       });
       continue;
     }

     const markups = decision.markups;

     const categoryCosts: Record<string, number> = {};
     for (const key of costCategoryKeys) {
       const total = effects[key].reduce((acc, fn) => acc + fn(qty), 0);
       categoryCosts[key] = qty > 0 ? total / qty : 0;
     }

     const rollupPrice = costCategoryKeys.reduce((sum, key) => {
       const cost = categoryCosts[key] ?? 0;
       const markup = markups[key] ?? 0;
       return sum + cost * (1 + markup / 100);
     }, 0);

     const finalPrice =
       itemId && companyId
         ? (
             await resolvePrice(client, companyId, {
               itemId,
               quantity: qty,
               customerId,
               existingBasePrice: rollupPrice
             })
           ).finalPrice
         : rollupPrice;

     updatedRows.push({
       quoteId: row.quoteId,
       quoteLineId: row.quoteLineId,
       companyId: row.companyId,
       quantity: row.quantity,
       unitPrice: Number(finalPrice.toFixed(precision)),
       categoryMarkups: markups,
       exchangeRate: row.exchangeRate,
       createdBy: row.createdBy,
       updatedBy: userId,
       leadTime: row.leadTime,
       discountPercent: row.discountPercent
     });
   }
   ```

   The delete-then-reinsert block after the loop (`:4528-4550`) is unchanged.

3. **`calculatePricesForQuantities`** (currently `:4182-4288`). The defaults are
   built into `defaultMarkups` at `:4223-4230` — leave that block as is. Then:

   a. Immediately after that block, add:
   ```ts
   const effectiveDefaults = getEffectiveDefaultMarkups(defaultMarkups);
   ```

   b. In the `rollupPrice` reducer (`:4248-4252`), change the markup lookup from
   `defaultMarkups[key]` to `effectiveDefaults[key]`:
   ```ts
   const rollupPrice = costCategoryKeys.reduce((sum, key) => {
     const cost = categoryCosts[key] ?? 0;
     const markup = effectiveDefaults[key] ?? 0;
     return sum + cost * (1 + markup / 100);
   }, 0);
   ```

   c. In the `priceRows.push({...})` object (`:4271`), change
   `categoryMarkups: defaultMarkups` to `categoryMarkups: effectiveDefaults` so a
   disabled default seeds `{}` (fixed/unpriced) instead of a stale `{ …: 0 }`
   cost-plus row.

4. Do not touch `resolveQuoteLinePrices`, `resolvePurchaseToOrderPrices`, or
   `upsertQuoteLinePrices` — they already insert/preserve empty `categoryMarkups`
   and behave correctly under the new recalc rules.

   If a grep shows any **other** function in `sales.service.ts` reads
   `quoteLineCategoryMarkups` or seeds `categoryMarkups` from defaults, STOP and
   report — the spec accounted for exactly these two sites.

**Verify:**
```bash
grep -n "quoteLineCategoryMarkups\|effectiveDefaults\|getEffectiveDefaultMarkups\|decideRecalcPricing" apps/erp/app/modules/sales/sales.service.ts
# Expected: the two default-building sites (calculatePricesForQuantities, recalculateQuoteLinePrices),
#           two `getEffectiveDefaultMarkups(...)` calls, one `decideRecalcPricing(...)` call,
#           and effectiveDefaults used in both functions. No third consumer of quoteLineCategoryMarkups.

pnpm exec turbo run typecheck --filter=erp
# Expected: tasks succeed, no TypeScript errors. (tsgo --noEmit for the erp app)
```

**Out of scope:** No behavior change to `resolvePrice`/`applyPriceRules`; no
schema/migration; do not alter the delete-then-reinsert mechanics or the
preserved `discountPercent`/`leadTime`/`exchangeRate` handling.

---

## Task 3: Clear `categoryMarkups` on direct price / virtual-markup edits (UI)

**Depends on:** none (independent of Tasks 1–2; may run in parallel)
**Files:**
- Modify: `apps/erp/app/modules/sales/ui/Quotes/QuoteLinePricing.tsx` — `onUpdatePrice` (`:481-558`)
- Reference (do NOT change): `onUpdateCategoryMarkup` (`:430-479`) already writes `categoryMarkups` + `unitPrice`; it is the *cost-plus* path and stays as-is.

**Why:** `onUpdatePrice` handles both the direct price cell and the virtual
**Markup Percent** cell (`:825-830`, which calls `onUpdatePrice("unitPrice", …)`).
Today it saves only `unitPrice`, leaving any stale `categoryMarkups` in place — so
a later recalc reverts a Make-to-Order line to its seeded markup (the non-zero
default variant, spec Q3-A). Clearing `categoryMarkups` on a `unitPrice` edit
makes the row a *fixed price* so the explicit value wins. Non-`unitPrice` keys
(`leadTime`, `discountPercent`, `shippingCost`) must NOT clear markups.

**Steps:**

1. In `onUpdatePrice`, the optimistic-state line (`:510`):
   ```ts
   newPrices[quantity] = { ...newPrices[quantity], [key]: roundedValue };
   ```
   Replace with (adds an empty-markups clear only for `unitPrice`):
   ```ts
   newPrices[quantity] = {
     ...newPrices[quantity],
     [key]: roundedValue,
     ...(key === "unitPrice" ? { categoryMarkups: {} } : {})
   };
   ```

2. In the `hasPrice` DB update branch (`:518-526`), change:
   ```ts
   .update({
     [key]: roundedValue,
     quoteLineId: lineId,
     quantity
   })
   ```
   to:
   ```ts
   .update({
     [key]: roundedValue,
     ...(key === "unitPrice" ? { categoryMarkups: {} } : {}),
     quoteLineId: lineId,
     quantity
   })
   ```

3. The `else` insert branch (`:534-538`) inserts `...newPrices[quantity]`, which
   now already carries `categoryMarkups: {}` for a `unitPrice` edit (from step 1)
   — no change needed there.

4. `onUpdateCategoryMarkup` (`:430`) is unchanged — do not edit it.

   If TypeScript rejects `categoryMarkups: {}` on either the `QuotationPrice`
   spread or the Supabase `.update(...)`, cast the empty object with
   `{} as Record<string, number>` (this matches how `onUpdateCategoryMarkup`
   passes `Record<string, number>` to the same `.update`). If it still fails,
   STOP and report — do not silence it with `@ts-expect-error`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: tasks succeed, no TypeScript errors.
```

**Out of scope:** No display-fallback change — the per-category cells already
render `?? 0` (spec UI §2); the virtual **Markup Percent** row reads the real
price and is accurate. Do not touch the settings UI (`CategoryMarkupsCard`).

---

## Task 4: Browser-verify the acceptance criteria via `/test`

**Depends on:** Tasks 2 and 3
**Files:** none (verification only)

**Preconditions:**
- Boot the local stack with `crbn up` (portless `*.dev`). If it will not boot,
  STOP and report — the fix is unverified, not done.
- Use the `/auth` skill to log into the ERP dev server, then `/test`.

**Steps (drive the running app; each maps to a spec acceptance criterion):**

1. **Configure defaults = 0%.** Go to `/x/settings/sales`, ensure every category
   in the "Category Markups" card is `0`, save. (This is the "disabled" state.)
2. **Reported case — 0% default must not clobber a set markup.** Open (or create)
   a Draft quote with a line that has a costed make method (BOM with at least one
   material). In the line's Pricing card, set the **Markup Percent** cell to 10%
   for a quantity break; note the resulting unit price (e.g. cost $100 → $110).
   Then edit a BOM material's unit cost (via the line's Materials). Reload the
   Pricing card:
   - **Expect:** the unit price is still the value you set (≈ $110), NOT collapsed
     to cost. The markup reads ~10% adjusted only by the cost change — never 0%.
3. **Cost-plus still reprices.** On another quantity break, use the per-category
   **markup** editor to set e.g. labor 20%. Change a BOM cost. Reload:
   - **Expect:** the price updated to reflect the new cost at 20% (markup held,
     price moved) — the cost-plus feature still works.
4. **Non-zero default variant.** Set the "Category Markups" default to a non-zero
   value (e.g. 30%). Create a new Make-to-Order quote line (seeded at 30%), then
   override its price directly in the price cell (e.g. to $150). Change a BOM cost.
   Reload:
   - **Expect:** the price stays $150 — the stale 30% does not revert it.
5. **Discount/leadtime survive.** On any line above, set a discount %, then change
   a BOM cost. **Expect:** the discount (and lead time) are unchanged after recalc.

**Verify:** All five expectations hold in the browser. Capture a screenshot of the
Pricing card in step 2 before/after the cost change (per the surface-designs/PR
convention) and attach to the PR. If any expectation fails, STOP and report — do
not adjust the assertions to pass.

**Out of scope:** Do not re-test unrelated quote flows; this task verifies only
the markup-preservation behavior.

---

## Coverage check (spec acceptance criteria → tasks)

| Spec AC | Covered by |
|---|---|
| 0% default: 10% line stays at price, not cost | Task 1 (logic) + Task 4 step 2 |
| Non-zero default: direct override survives cost change | Task 3 + Task 4 step 4 |
| Per-category markup still reprices | Task 1 (logic) + Task 4 step 3 |
| Disabled default: new MtO line priced at cost, empty markups | Task 1 (logic) + Task 2 step 3 |
| Enabled default: new line still auto-prices | Task 1 (logic) + Task 2 |
| Pull / P2O prices survive cost change | Task 1 (logic — fixed-price preserve) + Task 4 |
| discount/leadTime/exchangeRate survive recalc | Task 2 (preserved in both branches) + Task 4 step 5 |
| `typecheck` passes | Tasks 2 & 3 Verify |
