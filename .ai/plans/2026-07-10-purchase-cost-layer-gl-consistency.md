# Purchase cost-layer / GL consistency (PPV double-count fix) — implementation plan

**Spec:** none (combined diagnose+plan; design decisions resolved below — veto before /execute)
**Research:** `.ai/research/purchase-price-variance-actual-costing.md` (SAP/BC/NetSuite/Odoo/Epicor
survey — validates D1–D3, D7; Odoo 16's correction-SVL redesign is structurally identical to this
plan) + production root-cause session 2026-07-10 (journal JE-2026-07-000001…000009, Acme Inc.
company `8Qft6S8aTR467wJdYNZCtt`)
**Branch:** `fix/purchase-cost-layer-gl-consistency`

## The bug (verified in prod + code)

Buying 2 parts at PO price $60, invoicing at $80, consuming, and selling at $100 (cost $80.25)
produces **net income $0** and **GL Inventory −$20**. The $20 price variance is booked twice:

1. `post-purchase-invoice` posts `Dr PPV $20` to expense (GL), **and simultaneously**
2. creates the item's only cost layer at **full invoice cost** ($80, `remainingQuantity = 2`), so
   every downstream consumption (`calculateCOGS` FIFO) re-expenses the same $20 through
   WIP → FG → COGS while crediting a GL inventory account that only ever received $60.

Root facts (all verified against local `main`):

- `post-receipt/index.ts` **never inserts costLedger rows** (zero hits) — between receipt and
  invoice there are no layers, so FIFO consumption falls back to stale `itemCost.unitCost`
  (`shared/calculate-cogs.ts:105-108`).
- `post-purchase-invoice/index.ts:857-874` inserts the layer **unconditionally** for every
  PO-matched line (even invoice-before-receipt: consumable layer for goods not on hand).
- `post-purchase-invoice/index.ts:994-1010` posts the variance to `purchaseVarianceAccount`
  for the receipt-matched quantity.
- `post-receipt/index.ts:1005-1067` (invoice-first): receipt debits Inventory at **PO cost** and
  expenses `invoiceCost − poCost` to PPV — while the invoice-created layer already carries
  invoice cost. Same double-count, opposite ordering.
- `update-purchased-prices/index.ts:122-152` (source `purchaseOrder`, PO finalize) creates
  **consumable pseudo-layers at PO cost for unreceived goods** (`remainingQuantity` = full qty,
  documentType `'Purchase Order'`). These pollute FIFO whenever the finalize route runs.
- `update-purchased-prices/index.ts:385-390` then overwrites `itemCost.unitCost` with the
  ledger-derived actual cost — the same double-count via the `Average` branch / FIFO fallback.

## Target model (design decisions — pre-resolved, veto here)

**Invariant: the cost subledger (costLedger layers) and the GL inventory account always move
together.** Industry precedent: SAP moving-average stock-coverage split; Business Central
receipt-time value entries. Aligned with `.ai/specs/2026-07-04-inventory-valuation-completeness.md`
decision #11 (layer adjustments are child rows via `appliesToCostLedgerId`, never in-place cost
mutation; `remainingQuantity` stays the only mutable column).

| # | Decision |
|---|----------|
| D1 | **Receipt is the sole creator of purchase cost layers.** `post-receipt` inserts a layer per Inventory-tracked, non-outside-processing line: documentType `'Purchase Receipt'`, cost = the same receipt cost that hits the GL (PO price + weighted shipping), `remainingQuantity` = received qty. Receipt GL entries are unchanged for the receipt-first flow. |
| D2 | **Invoice posting adjusts layers instead of creating them.** For the receipt-matched quantity, split the variance by stock coverage: portion still on hand → `Dr Inventory` (GL) + **adjustment child rows** on the covered layers (subledger); portion already consumed → `Dr PPV`. `Cr AP` at invoice cost, `Dr GR/IR` at receipt cost (unchanged). |
| D3 | **Invoice-before-receipt: no layer at invoice time.** Accrual GL entries only (unchanged). When the receipt later posts, the invoice-first portion books `Dr Inventory` at the **accrual (invoice) unit cost**, credits GR/IR at the same, creates the layer at that cost, and posts **no PPV** (actual cost is known before goods arrive). |
| D4 | **`calculateCOGS` consumes adjustment children alongside their parent layer.** Per unit taken from a layer, take the per-unit bump `child.cost / child.quantity` while `child.remainingQuantity > 0` (children decremented with parents). Base-layer query excludes children and `'Purchase Order'` rows. |
| D5 | **PO-finalize pseudo-layers are neutralized**: inserted with `remainingQuantity: 0` (kept for cost-history UI); existing rows backfilled to 0. |
| D6 | **Negative receipts** consume layers via `calculateCOGS` and post GL at the consumed cost (typical undo case: identical to today's PO-cost behavior). |
| D7 | **Standard-costing items**: variance always → PPV, no layer adjustment (layer keeps its basis; matches valuation-spec decisions #10/#13). Standard costing itself remains unimplemented (separate worktree). |
| D8 | **Legacy self-heal**: if the invoice finds no receipt layers for matched qty (goods received before this fix deployed), it creates the layer itself at `receiptCost + inventoryShare` with coverage measured from itemLedger on-hand, so in-flight documents converge instead of double-counting. |
| D9 | **Existing bad books are NOT auto-corrected.** Follow-up per affected company: single JE `Dr Inventory / Cr PPV` for the double-counted amount (user's prod: $20). |

### Worked scenarios (these are the acceptance numbers)

- **S1 (the user's bug):** receive 2@$30 → layer L1(qty 2, cost 60, rem 2). Invoice 2@$40 →
  coverage 2/2 → `Dr GRNI 60, Dr Inventory 20, Cr AP 80`, child A1(appliesTo L1, qty 2, cost 20,
  rem 2), **no PPV**. Consume 2 → 2×30 + 2×(20/2) = **$80**; GL Inventory nets **0**. Sell $100,
  job labor $0.25 → **net income $20** (was $0), PPV $0.
- **S2 (consumption between receipt and invoice):** receive 2@30; issue 1 (consumes $30);
  invoice 2@40 → coverage 1/2 → `Dr Inventory 10, Dr PPV 10`; child A1(qty 1, cost 10, rem 1).
  Second issue consumes 30 + 10 = $40. GL Inventory ends 0; total expense $80 = actual.
- **S3 (partial invoice):** receive 2@30; invoice 1@40 → matched 1, coverage 1 → `Dr Inventory 10`,
  child(qty 1, cost 10, rem 1), GRNI keeps $30 open. Consume 2 → 40 + 30 = $70 (adjusted unit
  first — FIFO-within-layer convention). Later invoice 1@40 → coverage 0 → `Dr PPV 10`. Total $80 ✓.
- **S4 (invoice-first):** invoice 2@40 → accrual only, **no layer**. Receipt 2 → `Dr Inventory 80 /
  Cr GRNI 80` (clears accrual exactly), layer 2@$40, **no PPV**. Consume 2 → $80 ✓.

### Out of scope (do NOT touch)

- Standard-costing implementation (worktree `standard-costing`), revaluation/LCNRV documents,
  landed-cost documents (all in the inventory-valuation spec).
- BC-style retroactive COGS adjustment for goods already shipped before the invoice arrives
  (consumed-portion variance goes to PPV, not back into posted COGS).
- `Average` costing's intrinsic drift (consumption at `itemCost.unitCost`); D2's GL split still
  applies to Average items using itemLedger on-hand coverage.
- Multi-currency variance separation: when the exchange rate moves between receipt and invoice,
  the FX component currently folds into the price variance (SAP separates these: KDM vs PRD).
  Named follow-up — Task 11 flags it if FX scenarios surface during testing.
- The no-PO direct-invoice branch (`post-purchase-invoice/index.ts:741-854`) — already consistent
  (layer + GL both at invoice cost).
- Production data correction (D9 — manual follow-up JE).
- Xero sync (`.ai/rules/accounting-sync-handlers.md` — unrelated).
- The **Fixed Asset** invoice-line branch (`post-purchase-invoice/index.ts` ~1148–1247) has the
  same variance double-count in the FA subledger (PPV expensed AND `acquisitionCost` inflated
  with no GL asset debit) — tracked as a separate spawned task; do NOT touch the
  `case "Fixed Asset"` branch in this plan.

### Caveat for the executor

Production journal descriptions ("Material Issue — Job", "Job Completion") don't appear in local
`main` ("Material Issue to Job"; no FG-completion poster found) — the hosted instance may run
slightly ahead. **Before starting, `git pull` and re-verify the anchor code excerpts in each task
exist; if a task's anchor is missing or moved beyond trivial drift, STOP and report.** All bug
mechanics above were verified against local `main` (`95e658465`); anchors re-verified after
pulling to `60b1ee3e8` (2026-07-10 — pull brought only MES picking-list changes, all anchors
intact at the same line numbers).

## Progress

- [x] Task 1: Migration — `appliesToCostLedgerId` column + neutralize PO pseudo-layers
- [x] Task 2: Regenerate DB types (surgical: only the 3 costLedger lines kept per file; unrelated cloud-types drift reverted)
- [x] Task 3: Pure variance-allocation helper + Deno golden tests (8/8 passing)
- [x] Task 4: `calculate-cogs.ts` — consume adjustment children, filter base layers (deno check: no new errors in touched file; 7 pre-existing lib/* errors affect ALL functions on HEAD — Task 10 escape hatch applies repo-wide)
- [x] Task 5: `post-receipt` — create layers (normal + negative receipts)
- [x] Task 6: `post-receipt` — invoice-first rework (layer at accrual cost, no PPV) — implemented with Task 5 in one commit (same loop, interlocking split logic); deno check baseline 72 → 71 errors, no new
- [x] Task 7: `post-purchase-invoice` — adjust instead of create; coverage split
- [x] Task 8: `post-purchase-invoice` — void path reverses adjustments (plan's counter-child mechanics corrected first: original child stays live so +bump/−bump net out)
- [x] Task 9: `update-purchased-prices` — PO rows non-consumable; history math
- [x] Task 10: Type-check all touched Deno functions (per-file HEAD-baseline error-signature diffs: all identical or fewer; no errors in new/modified shared files from any consumer)
- [ ] Task 11: End-to-end scenario verification (S1–S4) on local stack
- [ ] Task 12: Docs sync — new costing rule + lessons entry

## Dependencies

- Task 2 needs Task 1. Tasks 4–9 need Tasks 1–3.
- Task 6 needs Task 5. Task 7 needs Task 4 (consumption semantics) and Task 3.
- Tasks 5 and 9 are independent of each other (parallelizable). Task 8 needs Task 7.
- Task 11 needs everything before it. Task 12 last.

---

## Task 1: Migration — `appliesToCostLedgerId` column + neutralize PO pseudo-layers

**Depends on:** none
**Files:**
- Create: migration via `pnpm db:migrate:new cost-ledger-adjustment-links` (never hand-pick the
  timestamp; HHMMSS must not be `000000`)

**Steps:**
1. From repo root run `pnpm db:migrate:new cost-ledger-adjustment-links`.
2. Fill the generated file in `packages/database/supabase/migrations/` with exactly:

```sql
-- Layer cost adjustments are child rows pointing at the layer they adjust
-- (inventory-valuation spec decision #11: never mutate a posted layer's cost).
ALTER TABLE "costLedger"
  ADD COLUMN IF NOT EXISTS "appliesToCostLedgerId" TEXT;

CREATE INDEX IF NOT EXISTS "costLedger_appliesToCostLedgerId_idx"
  ON "costLedger" ("appliesToCostLedgerId")
  WHERE "appliesToCostLedgerId" IS NOT NULL;

-- 'Purchase Order' costLedger rows are planning/cost-history artifacts written at PO
-- finalization (update-purchased-prices), not real inventory layers. Make them
-- non-consumable so FIFO/LIFO never eats stock that hasn't been received.
UPDATE "costLedger"
SET "remainingQuantity" = 0
WHERE "documentType" = 'Purchase Order'
  AND "remainingQuantity" IS DISTINCT FROM 0;
```

   Do NOT add a foreign key: `costLedger` predates the composite-PK convention and this follows
   the valuation spec's column design (plain TEXT + partial index). No decimal precision, no new
   RLS needed (existing costLedger policies cover the column).
3. Apply locally with `pnpm db:migrate`.

**Verify:**
```bash
pnpm db:migrate
# Expected: migration applies without error
psql "$DATABASE_URL" -c "SELECT column_name FROM information_schema.columns WHERE table_name='costLedger' AND column_name='appliesToCostLedgerId';"
# Expected: one row: appliesToCostLedgerId
psql "$DATABASE_URL" -c "SELECT COUNT(*) FROM \"costLedger\" WHERE \"documentType\"='Purchase Order' AND \"remainingQuantity\" <> 0;"
# Expected: 0
```

**Out of scope:** any other costLedger schema change; do not touch NUMERIC precisions of
existing columns.

---

## Task 2: Regenerate DB types

**Depends on:** Task 1
**Files:**
- Modify (generated): `packages/database/src/types.ts` and function lib types

**Steps:**
1. Run `pnpm run generate:types` from the repo root.
2. CAUTION (memory: types are cloud-generated): if the diff is enormous (tens of thousands of
   lines touching per-company tables), the local DB snapshot diverges from the committed
   cloud-generated types. In that case do NOT commit the full regeneration — keep only the
   `costLedger.appliesToCostLedgerId` additions (in both `packages/database/src/types.ts` and
   `packages/database/supabase/functions/lib/types.ts`) and revert the rest. If that surgical
   split is not possible, STOP and report.

**Verify:**
```bash
grep -n "appliesToCostLedgerId" packages/database/src/types.ts | head -3
# Expected: at least one hit in the costLedger Row/Insert/Update types
git diff --stat packages/database/src/types.ts
# Expected: small, costLedger-scoped diff (see caution above)
```

**Out of scope:** hand-editing any other generated type.

---

## Task 3: Pure variance-allocation helper + Deno golden tests

**Depends on:** none (pure TS)
**Files:**
- Create: `packages/database/supabase/functions/shared/purchase-cost-adjustment.ts`
- Create: `packages/database/supabase/functions/shared/purchase-cost-adjustment.test.ts`
- Copy from (precedent): `packages/database/supabase/functions/post-payment/build-payment-journal.ts`
  + `post-payment/post-payment.test.ts` (pure journal-builder + golden-master Deno tests)

**Steps:**
1. Create `purchase-cost-adjustment.ts` exporting exactly:

```typescript
export interface ReceiptLayerLike {
  id: string;
  quantity: number;          // original layer quantity
  remainingQuantity: number; // unconsumed units
}

export interface VarianceAllocation {
  inventoryShare: number; // GL: Dr Inventory (write-up of on-hand goods)
  ppvShare: number;       // GL: Dr PPV (variance on already-consumed goods)
  perLayer: {
    costLedgerId: string;
    appliedQuantity: number;  // units of this layer the adjustment applies to
    adjustmentCost: number;   // total cost bump for those units
  }[];
}

/**
 * Split an invoice-vs-receipt price variance for `matchedQuantity` units across
 * the receipt layers that hold them. Units still on hand absorb their share of
 * the variance into inventory (per-layer adjustment child rows); units already
 * consumed send their share to PPV. Layers must be passed in FIFO order.
 */
export function allocateVarianceAcrossLayers(
  layers: ReceiptLayerLike[],
  matchedQuantity: number,
  variance: number
): VarianceAllocation {
  if (matchedQuantity <= 0 || Math.abs(variance) <= 0.005) {
    return { inventoryShare: 0, ppvShare: Math.abs(variance) > 0.005 ? variance : 0, perLayer: [] };
  }
  const perUnit = variance / matchedQuantity;
  let uncovered = matchedQuantity;
  let inventoryShare = 0;
  const perLayer: VarianceAllocation["perLayer"] = [];
  for (const layer of layers) {
    if (uncovered <= 0) break;
    const applied = Math.min(Math.max(layer.remainingQuantity, 0), uncovered);
    if (applied <= 0) continue;
    const adjustmentCost = perUnit * applied;
    perLayer.push({ costLedgerId: layer.id, appliedQuantity: applied, adjustmentCost });
    inventoryShare += adjustmentCost;
    uncovered -= applied;
  }
  return { inventoryShare, ppvShare: variance - inventoryShare, perLayer };
}
```

   (Rounding: leave raw floats; the GL layer applies the existing `> 0.005` materiality gate.)
2. Write golden-master Deno tests mirroring the S1–S3 numbers from the plan header, using the
   same assert imports as `post-payment.test.ts`
   (`https://deno.land/std@0.175.0/testing/asserts.ts`):
   - S1: one layer `(qty 2, rem 2)`, matched 2, variance 20 → `inventoryShare 20, ppvShare 0`,
     one perLayer entry `(appliedQuantity 2, adjustmentCost 20)`.
   - S2: one layer `(qty 2, rem 1)`, matched 2, variance 20 → `inventoryShare 10, ppvShare 10`.
   - S3 second invoice: one layer `(qty 2, rem 0)`, matched 1, variance 10 → `inventoryShare 0,
     ppvShare 10`, empty perLayer.
   - Negative variance: layer `(qty 2, rem 2)`, matched 2, variance −20 → `inventoryShare −20`.
   - Multi-layer: layers `(qty 3, rem 1)` + `(qty 2, rem 2)`, matched 5, variance 10 →
     perUnit 2 → perLayer `[1×2, 2×2]`, `inventoryShare 6, ppvShare 4`.
   - Immaterial variance: `variance 0.004` → all zeros, empty perLayer.

**Verify:**
```bash
cd packages/database/supabase/functions && deno test shared/purchase-cost-adjustment.test.ts
# Expected: "ok" with all test steps passed, 0 failed
```
If `deno` is not on PATH, STOP and report (do not convert the tests to vitest — edge functions
are Deno; see post-payment precedent).

**Out of scope:** touching build-payment-journal or calculate-cogs in this task.

---

## Task 4: `calculate-cogs.ts` — consume adjustment children, filter base layers

**Depends on:** Tasks 1–2 (column exists in types)
**Files:**
- Modify: `packages/database/supabase/functions/shared/calculate-cogs.ts` — FIFO/LIFO branch only

**Steps:**
1. In the `FIFO`/`LIFO` case, change the base-layer query (currently `remainingQuantity > 0`
   ordered by postingDate/createdAt) to also require:
   - `.where("adjustment", "=", false)`
   - `.where("appliesToCostLedgerId", "is", null)`
   - `.where((eb) => eb.or([eb("documentType", "is", null), eb("documentType", "!=", "Purchase Order")]))`
     (belt-and-braces alongside Task 1's backfill).
2. After the base-layer loop picks `quantityFromLayer` from a layer, consume that layer's
   adjustment children in the same pass:

```typescript
const children = await trx
  .selectFrom("costLedger")
  .selectAll()
  .where("appliesToCostLedgerId", "=", layer.id)
  .where("remainingQuantity", ">", 0)
  .orderBy("createdAt", "asc")
  .execute();

let unappliedQuantity = quantityFromLayer;
for (const child of children) {
  if (unappliedQuantity <= 0) break;
  const childQty = Number(child.remainingQuantity);
  const perUnitBump =
    Number(child.quantity) > 0 ? Number(child.cost) / Number(child.quantity) : 0;
  const applyQty = Math.min(childQty, unappliedQuantity);
  totalCost += applyQty * perUnitBump;
  unappliedQuantity -= applyQty;
  await trx
    .updateTable("costLedger")
    .set({ remainingQuantity: childQty - applyQty })
    .where("id", "=", child.id)
    .execute();
}
```

   Place this AFTER the existing `totalCost += costFromLayer` accumulation and the parent
   `remainingQuantity` update, INSIDE the `for (const layer of layers)` loop. The
   `layersConsumed` entry's `unitCost` should stay the parent's base unit cost (callers use
   `totalCost` for GL amounts; per-layer unitCost is informational).
3. `Standard` and `Average` branches: unchanged.

**Verify:**
```bash
cd packages/database/supabase/functions && deno check shared/calculate-cogs.ts
# Expected: no type errors
```
(Behavioral proof lands in Task 11 — S1 consumption must total exactly 80.00.)

**Out of scope:** the `Average` fallback semantics; the `remainingToConsume > 0` fallback block
(leave it — it is the safety net for legacy data).

---

## Task 5: `post-receipt` — create layers (normal + negative receipts)

**Depends on:** Tasks 1–2, 4
**Files:**
- Modify: `packages/database/supabase/functions/post-receipt/index.ts` — the per-line posting
  loop (lines ~894–1069; anchor: `const lineCost = absReceivedQuantity * receiptLine.unitPrice`)
- Copy from (precedent): the costLedger insert shape at
  `packages/database/supabase/functions/post-purchase-invoice/index.ts:858-874`

**Steps:**
1. In the receipt-line loop, for lines where `itemTrackingType` is Inventory/Batch/Serial (i.e.
   the same condition that currently gates itemLedger inserts: NOT Non-Inventory, NOT
   `isOutsideProcessing`) and `receivedQuantity > 0`, collect a costLedger insert:

```typescript
costLedgerInserts.push({
  itemLedgerType: "Purchase",
  costLedgerType: "Direct Cost",
  adjustment: false,
  documentType: "Purchase Receipt",
  documentId: receiptId,
  externalDocumentId: receipt.data?.externalDocumentId ?? undefined,
  itemId: receiptLine.itemId,
  quantity: absReceivedQuantity,
  nominalCost: absReceivedQuantity * (receiptLine.unitPrice ?? 0),
  cost,            // the SAME lineCost + lineWeightedShippingCost that hits the GL debit
  remainingQuantity: absReceivedQuantity,
  supplierId: purchaseOrder.data?.supplierId ?? undefined,
  companyId,
});
```

   Add a `costLedgerInserts` array following the function's existing insert-array pattern and
   flush it inside the same Kysely transaction that writes journal + itemLedger rows. IMPORTANT
   (Task 6 depends on this): for the invoice-first portion of a line, Task 6 overrides the cost —
   structure this insert so the invoice-first qty portion can carry a different unit cost
   (split into two rows when `invoiceFirstQty > 0`: one row for the invoice-first qty, one for
   the remainder).
2. **Negative receipt lines** (`receivedQuantity < 0`): instead of a layer, consume via
   `calculateCOGS(trx, { itemId, quantity: absReceivedQuantity, companyId })` (import from
   `../shared/calculate-cogs.ts`) and:
   - use `cogsResult.totalCost` as the GL amount for BOTH the inventory credit and the GR/IR
     debit of that line (replacing the PO-cost amount currently used for negative lines), and
   - insert a consumption row: same shape as above but `quantity: -absReceivedQuantity`,
     `cost: -cogsResult.totalCost`, `remainingQuantity: 0`.
   If the negative-receipt GL block's structure differs materially from the positive block
   (anchor: `debit("liability", ...)` for negative receipts around lines 941–971), STOP and
   report rather than improvising.
3. Serial/Batch lines: one layer per receipt line (not per serial) — quantity is the line's
   received quantity; do not attempt per-tracked-entity layers.

**Verify:**
```bash
cd packages/database/supabase/functions && deno check post-receipt/index.ts
# Expected: no type errors
```
(Behavioral proof in Task 11: after posting a receipt of 2 @ $30, a
`documentType='Purchase Receipt'` costLedger row exists with quantity 2, cost 60,
remainingQuantity 2.)

**Out of scope:** outside-processing (WIP) receipts and Non-Inventory lines get NO layers;
do not change their GL. Do not touch the invoice-first GL block yet (Task 6).

---

## Task 6: `post-receipt` — invoice-first rework (layer at accrual cost, no PPV)

**Depends on:** Task 5
**Files:**
- Modify: `packages/database/supabase/functions/post-receipt/index.ts` — the invoice-first
  variance block (lines ~1005–1067; anchor: `accrualUnitCostByPoLine`)

**Steps:**
1. Keep the existing detection machinery (`invoiceFirstQtyByPoLine`, `accrualUnitCostByPoLine`,
   lines ~825–892) exactly as is.
2. Replace the variance block (currently: `Cr GR/IR variance` + `Dr PPV variance`) with a cost
   substitution: for the `invoiceFirstQty` portion of the line, the receipt's OWN debit/credit
   pair must be posted at `accrualUnitCost` instead of PO unit cost. Concretely, split the
   line's GL amounts:
   - `invoiceFirstPortionCost = invoiceFirstQty * accrualUnitCost`
   - `normalPortionCost = (absReceivedQuantity - invoiceFirstQty) * poUnitCost` (+ that
     portion's weighted shipping)
   - Dr Inventory = `invoiceFirstPortionCost + normalPortionCost`; Cr GR/IR = same total.
   This clears the invoice's GR/IR debit accrual exactly, with **no PPV line at all** in the
   invoice-first flow.
3. The Task 5 layer insert for this line must mirror the same split: the invoice-first qty's
   layer row carries `cost = invoiceFirstPortionCost`; the remainder row carries the PO-cost
   portion.
4. **Transition guard:** before creating the invoice-first layer row, check for a pre-fix
   invoice-created layer covering these goods:

```typescript
const legacyInvoiceLayer = await trx
  .selectFrom("costLedger")
  .select(["id", "remainingQuantity"])
  .where("documentType", "=", "Purchase Invoice")
  .where("itemId", "=", receiptLine.itemId)
  .where("companyId", "=", companyId)
  .where("remainingQuantity", ">", 0)
  .executeTakeFirst();
```

   If found, skip layer creation for the overlapping quantity (the legacy layer already carries
   invoice cost) but keep the new GL treatment. Log via the function logger.
5. If the current invoice-first block's shape makes the per-portion split impossible without
   restructuring the whole line loop, STOP and report with the actual code shape — do not
   improvise a different accounting treatment.

**Verify:**
```bash
cd packages/database/supabase/functions && deno check post-receipt/index.ts
# Expected: no type errors
```
(Behavioral proof in Task 11 scenario S4: invoice 2@$40 then receive 2 → GL Inventory +80,
GR/IR nets to 0, layer(qty 2, cost 80), zero PPV lines in the receipt journal.)

**Out of scope:** receipts with no prior invoice (Task 5 covers them).

---

## Task 7: `post-purchase-invoice` — adjust instead of create; coverage split

**Depends on:** Tasks 3, 4
**Files:**
- Modify: `packages/database/supabase/functions/post-purchase-invoice/index.ts` — PO-matched
  branch (lines ~856–1115)

**Steps:**
1. **Delete the unconditional costLedger insert** at the top of the PO-matched branch
   (lines ~857–874, anchor comment `// create the cost entry`).
2. In the matched-quantity block (`if (quantityToReverse > 0 && accountingEnabled ...)`,
   anchor `receiptCostForReversedQty`), after `variance` is computed (anchor:
   `const variance = invoiceCostForReversedQty - receiptCostForReversedQty`):
   a. Fetch the item's costing method (the function already loads `itemCosts` for posting
      groups — extend that select with `costingMethod` if absent).
   b. Fetch this PO line's receipt layers in FIFO order:

```typescript
const receiptIdsForLine = await trx
  .selectFrom("receiptLine")
  .select(["receiptId"])
  .where("lineId", "=", invoiceLine.purchaseOrderLineId!)
  .where("companyId", "=", companyId)
  .execute();

const receiptLayers = receiptIdsForLine.length > 0
  ? await trx
      .selectFrom("costLedger")
      .selectAll()
      .where("documentType", "=", "Purchase Receipt")
      .where("documentId", "in", receiptIdsForLine.map((r) => r.receiptId))
      .where("itemId", "=", invoiceLine.itemId!)
      .where("adjustment", "=", false)
      .where("companyId", "=", companyId)
      .orderBy("postingDate", "asc")
      .orderBy("createdAt", "asc")
      .execute()
  : [];
```

   c. Compute the split with the Task 3 helper:
      - `costingMethod === "Standard"` → force `{ inventoryShare: 0, ppvShare: variance, perLayer: [] }` (D7).
      - `receiptLayers.length > 0` → `allocateVarianceAcrossLayers(receiptLayers, quantityToReverse, variance)`.
      - `receiptLayers.length === 0` (**legacy self-heal, D8**) → compute on-hand coverage from
        itemLedger (`SUM(quantity)` for the item/company via one Kysely query, clamped to
        `[0, quantityToReverse]`), split `variance` proportionally, and create ONE new layer:
        `documentType 'Purchase Receipt'`, `documentId = purchaseInvoice id`, quantity =
        `quantityToReverse`, `cost = receiptCostForReversedQty + inventoryShare`,
        `remainingQuantity = quantityToReverse`, `adjustment = false`. (No adjustment children
        in this branch — the write-up is baked into the layer.)
   d. Replace the single PPV journal line (lines ~994–1010) with:
      - if `Math.abs(allocation.inventoryShare) > 0.005`: a journal line identical in shape to
        the PPV line but `accountId: accountDefaults.data.inventoryAccount`, description
        `"Inventory Account"`, `amount: debit("asset", allocation.inventoryShare)`.
      - if `Math.abs(allocation.ppvShare) > 0.005`: the existing PPV line with
        `amount: debit("expense", allocation.ppvShare)`.
      - Keep the GR/IR debit (receipt cost) and AP credit (invoice cost) lines unchanged.
      - Update the `journalLineDimensionsMeta` push count to match the actual number of lines
        emitted (anchor: `reverseJlCount` — it derives from array length, verify it still does
        after the edit; if it hardcodes a count, fix it to derive).
   e. For each `allocation.perLayer` entry, insert an adjustment child row in the same
      transaction:

```typescript
costLedgerInserts.push({
  itemLedgerType: "Purchase",
  costLedgerType: "Direct Cost",
  adjustment: true,
  appliesToCostLedgerId: entry.costLedgerId,
  documentType: "Purchase Invoice",
  documentId: purchaseInvoice.data?.id ?? undefined,
  itemId: invoiceLine.itemId,
  quantity: entry.appliedQuantity,
  cost: entry.adjustmentCost,
  nominalCost: entry.adjustmentCost,
  remainingQuantity: entry.appliedQuantity,
  supplierId: purchaseInvoice.data?.supplierId,
  companyId,
});
```

3. **Accrual portion** (lines ~1051–1115): journal lines unchanged; confirm no costLedger row is
   created there after step 1 (it wasn't before — the deleted insert was branch-wide, which is
   exactly why it must go).
4. Import `allocateVarianceAcrossLayers` from `../shared/purchase-cost-adjustment.ts`.

**Verify:**
```bash
cd packages/database/supabase/functions && deno check post-purchase-invoice/index.ts
# Expected: no type errors
cd packages/database/supabase/functions && deno test shared/purchase-cost-adjustment.test.ts
# Expected: still all passing
```

**Out of scope:** the no-PO direct-invoice branch (lines ~741–854) — its layer creation at
invoice cost is correct and stays; `skipReceiptPost` handling stays as-is.

---

## Task 8: `post-purchase-invoice` — void path reverses adjustments

**Depends on:** Task 7
**Files:**
- Modify: `packages/database/supabase/functions/post-purchase-invoice/index.ts` — void/reversal
  section (lines ~283–372; anchor: the block that fetches original costLedger entries by
  `documentId` to reverse them)

**Steps:**
1. Read the void section first. It currently reverses invoice-created costLedger entries. After
   Task 7, a posted invoice may have created: (a) adjustment child rows (`adjustment = true`,
   `appliesToCostLedgerId` set), (b) a legacy self-heal layer, (c) direct-invoice layers (no-PO
   branch, unchanged).
2. Extend the reversal so that for each adjustment child created by this invoice
   (`documentId = invoice id AND adjustment = true AND appliesToCostLedgerId set`):
   - if `remainingQuantity === quantity` (untouched): delete the row;
   - else (partially/fully consumed): insert a counter-child on the same
     `appliesToCostLedgerId` with `cost: -original.cost`, `quantity: original.quantity`,
     `remainingQuantity: original.remainingQuantity`, and **leave the original's
     `remainingQuantity` untouched** — future consumption then applies +bump and −bump
     together, netting the remaining units back to base cost. (Zeroing the original would
     leave only the negative bump — traced wrong against scenario S2.)
3. The legacy self-heal layer is created with `documentType 'Purchase Receipt'` and
   `documentId = invoice id`, so the void fetch must include it explicitly: widen the
   costLedger fetch to both documentTypes for this documentId. Reverse it as: delete if
   unconsumed (restores the pre-invoice no-layer state); if partially consumed, insert the
   negative mirror row and zero its `remainingQuantity` so a voided layer can't keep feeding
   consumption. Plain (c) rows (no-PO direct-invoice layers) keep the existing
   negative-mirror behavior.
4. If the existing void code's structure contradicts this description (e.g., it doesn't fetch by
   `documentId`, or reverses via negative inserts only), STOP and report the actual structure
   with line numbers before writing code.

**Verify:**
```bash
cd packages/database/supabase/functions && deno check post-purchase-invoice/index.ts
# Expected: no type errors
```

**Out of scope:** receipt un-posting (no such flow exists in `post-receipt` today — do not
invent one).

---

## Task 9: `update-purchased-prices` — PO rows non-consumable; history math

**Depends on:** Tasks 1–2
**Files:**
- Modify: `packages/database/supabase/functions/update-purchased-prices/index.ts`

**Steps:**
1. In the `purchaseOrder` source branch (lines ~122–152), change the insert to
   `remainingQuantity: 0` (anchor: `remainingQuantity: line.quantity`). Keep the DELETE+INSERT
   re-finalization behavior.
2. In the cost-history accumulation (lines ~263–275, anchor
   `historicalPartCosts[ledger.itemId].quantity += ledger.quantity`): adjustment rows must
   contribute cost but not quantity:

```typescript
if (!ledger.adjustment) {
  historicalPartCosts[ledger.itemId].quantity += ledger.quantity;
}
historicalPartCosts[ledger.itemId].cost += ledger.cost;
```

3. Guard the division at the `itemCostUpdates.push` site (lines ~385–390): only push when
   `costHistory.quantity > 0` (prevents the existing NaN risk when history nets to zero).

**Verify:**
```bash
cd packages/database/supabase/functions && deno check update-purchased-prices/index.ts
# Expected: no type errors
```

**Out of scope:** lead-time logic; supplierPart upserts; the decision of WHETHER
`itemCost.unitCost` should track invoice actuals (it should — Average items and the FIFO
fallback rely on it, and with the GL fix it is no longer double-counted).

---

## Task 10: Type-check all touched Deno functions

**Depends on:** Tasks 4–9
**Files:** none (verification only)

**Steps:**
1. Run `deno check` over every touched entrypoint.

**Verify:**
```bash
cd packages/database/supabase/functions && deno check \
  shared/calculate-cogs.ts shared/purchase-cost-adjustment.ts \
  post-receipt/index.ts post-purchase-invoice/index.ts \
  update-purchased-prices/index.ts issue/index.ts
# Expected: no errors (issue/index.ts is untouched but consumes calculateCOGS — must still check)
```
If `deno check` fails on PRE-EXISTING errors unrelated to this change, note them and verify
only that no NEW errors appear in the touched files.

**Out of scope:** whole-repo typecheck (OOMs); `pnpm exec turbo run typecheck --filter=erp` is
NOT needed — no app-side files change.

---

## Task 11: End-to-end scenario verification (S1–S4) on local stack

**Depends on:** Tasks 1–10
**Files:** none (verification; scratch SQL allowed in the session scratchpad, never committed)

**Steps:**
1. Boot the stack with plain `crbn up` (portless). Do NOT rebuild/reset the database if one is
   already seeded — ask the user if a reset seems needed.
2. Ensure accounting is enabled: visit `/x/settings/accounting` (memory: fresh seeds default
   `accountingEnabled = false`; posts create no journals until enabled).
3. Log in via the `/auth` skill; drive the flows with `agent-browser` (memory: submit
   ValidatedForms via `requestSubmit(button)`; blur react-aria number fields to commit values).
4. **S1 (the regression):** create a purchased item (FIFO), PO for 2 @ $30 → receive → invoice
   at 2 @ $40 → sell both units for $100 total (sales order 2 @ $50) → ship → invoice.
   (Amended from the job-consumption variant: material issue and shipment consume through the
   IDENTICAL calculateCOGS path; the direct sale asserts the same numbers — revenue 100,
   COGS 80, NI 20 — without requiring MES/production setup. The `issue` function itself is
   untouched by this fix.) Then assert via psql (`psql "$DATABASE_URL"`):

```sql
-- GL inventory account nets to zero
SELECT COALESCE(SUM(jl."amount"), 0) AS inventory_net
FROM "journalLine" jl JOIN "account" a ON a."id" = jl."accountId"
WHERE a."number" = '1210' AND jl."companyId" = :company;
-- Expected: 0.00

-- No PPV posted for S1 (full stock coverage at invoice time)
SELECT COALESCE(SUM(jl."amount"), 0) FROM "journalLine" jl
JOIN "account" a ON a."id" = jl."accountId"
WHERE a."number" = '5210' AND jl."companyId" = :company;
-- Expected: 0.00

-- Adjustment child exists and was fully consumed
SELECT "quantity", "cost", "remainingQuantity" FROM "costLedger"
WHERE "adjustment" = true AND "appliesToCostLedgerId" IS NOT NULL AND "companyId" = :company;
-- Expected: quantity 2, cost 20, remainingQuantity 0
```

   Income-statement check in the UI (or via trial-balance query): revenue 100, COGS 80.25
   (assuming the same $0.25 labor), net income **20.00** — not 0.
5. **S2:** new item; receive 2 @ $30; issue 1 to a job; invoice 2 @ $40. Assert the invoice
   journal contains `Inventory +10` and `PPV +10` lines; issue the second unit and assert the
   consumption journal credits inventory exactly 40 and GL inventory for the item's flow nets 0.
6. **S3:** new item; receive 2 @ $30; invoice qty 1 @ $40 (partial). Assert: invoice journal has
   `Dr GR/IR 30, Dr Inventory 10, Cr AP 40`, no PPV; GR/IR still carries 30 for the line.
7. **S4:** new item; post the invoice BEFORE any receipt (qty 2 @ $40) — assert accrual journal
   only and **zero costLedger rows** for the item; then receive 2 — assert `Dr Inventory 80 /
   Cr GR/IR 80`, no PPV, layer `(qty 2, cost 80, remainingQuantity 2)`.
8. If any step's numbers deviate, STOP: capture the journal + costLedger rows for the failing
   scenario and report — do not patch numbers to pass.

**Verify:** the psql outputs above, matching expectations exactly (±0.005 only where a
materiality gate applies).

**Out of scope:** performance testing; multi-currency scenarios (exchangeRate ≠ 1) — flag for a
follow-up if line-level FX shows up during testing.

---

## Task 12: Docs sync — new costing rule + lessons entry

**Depends on:** Task 11 (document what shipped, not what was planned)
**Files:**
- Create: `.ai/rules/inventory-cost-layers.md` with `paths:` frontmatter covering
  `packages/database/supabase/functions/post-receipt/**`,
  `packages/database/supabase/functions/post-purchase-invoice/**`,
  `packages/database/supabase/functions/shared/calculate-cogs.ts`,
  `packages/database/supabase/functions/update-purchased-prices/**`
- Modify: `.ai/lessons.md` — one entry
- Modify: `.ai/specs/2026-07-04-inventory-valuation-completeness.md` — premise note

**Steps:**
1. Write the rule: layer lifecycle (receipt creates → invoice adjusts via `appliesToCostLedgerId`
   children → consumption decrements parent + children), the GL/subledger invariant, the
   coverage split, the invoice-first treatment, PO pseudo-layers being non-consumable, and the
   Standard-costing carve-out. Ground every claim in the shipped code (cite files).
2. Add a lessons entry in `Context → Problem → Rule → Applies to` format: posting functions must
   never book the same economic amount to the GL and the subledger through different accounts
   (the PPV double-count).
3. In the valuation spec, update the receipt-time-layer premise (its §"Variance at receipt"
   assumed layers did not yet exist at receipt) with a one-line note that receipt-time layer
   creation shipped in this fix; do not rewrite the spec.
4. Add a router row for the new rule in the root `AGENTS.md` Task Router (Domain Modules →
   "Inventory costing / cost layers").

**Verify:**
```bash
ls .ai/rules/inventory-cost-layers.md && grep -n "inventory-cost-layers" AGENTS.md
# Expected: file exists; one Task Router row references it
```

**Out of scope:** the public docs site (`docs/`) — the Guide has no purchase-posting internals
page today; do not create one in this plan.
