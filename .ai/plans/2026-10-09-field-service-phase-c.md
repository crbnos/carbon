# Field Service Phase C — refurbishment of a serial in stock — implementation plan

**Spec:** .ai/specs/2026-10-08-field-service.md (*Accounting → Refurbishment completion*, decisions 1, 5, 15–18, Phase C acceptance criteria, Risks)
**Research:** .ai/research/serial-service-cost-treatment.md
**Branch:** projects-wbs-research-spec
**Prerequisite:** `.ai/plans/2026-10-09-field-service-phase-a.md` and `.ai/plans/2026-10-09-field-service-phase-b.md` are done and committed. This plan uses `insertServiceOrder` (Phase B), `resolveCoverage` (Capitalized for a Refurbishment) and the By Coverage posting. If one of them is missing, STOP and report.

## Scope of this plan

The company refurbishes a serial it owns, in stock. Labor and parts collect in WIP. At completion, the cost moves into that one serial's cost, capped at what the unit will sell for.
1. **Refurbishment orders** on a stock serial, which go On Hold while the work runs.
2. **Charges** post to WIP (coverage Capitalized) and record the parts in the serial's build history.
3. **Completion** gives the serial its own cost layer, adds the WIP by costing method, caps the cost at the sale price, and releases the serial.
4. **Two fixes from the costing research.** The inventory valuation report counts adjustment rows as layers. Nothing on the server stops shipping or picking a serial under refurbishment.

## Rules for the executor

- Read `.ai/lessons.md`, `.claude/rules/field-service.md`, `.claude/rules/inventory-system.md`, `.claude/rules/numeric-precision.md` and `.ai/research/serial-service-cost-treatment.md` before Task 1.
- Round money with `round()` from `@carbon/utils`. Never use JavaScript `Date`.
- Never query in a loop. Never construct a database client in a `*.service.ts`.
- If a quoted code line or line number does not match the file, search for the quoted code. If you cannot find it, STOP and report.

## Decisions this plan makes

These correct or add to the spec. Task 10 records them there.

| # | Decision | Why |
|---|---|---|
| C1 | The split takes the unit from the layer that `calculateCOGS` would take next for this item: the oldest unstamped layer under FIFO, the newest under LIFO. Use `orderLayersForConsumption` (`cost-layer-order.ts:20-35`) to pick it. | The spec says "the oldest layer". That holds for FIFO only; LIFO takes the newest first (`calculate-cogs.ts:68`, `:86-87`). The right layer keeps the relief cost unchanged. |
| C2 | The split also moves one unit of each open adjustment child of the source layer onto the new stamped layer. | `calculateCOGS` applies a child only up to the quantity taken from its parent (`calculate-cogs.ts:142-159`). Without the move, the parent's last unit of child cost would never be consumed, and the serial would leave without it. |
| C3 | The completion writes a `'Revaluation'` child row for every costing method, and re-averages `itemCost.unitCost` for Average in the same transaction. | No TypeScript re-average helper exists. `update-purchased-prices` later recomputes `unitCost` from `costLedger` cost, so the child row keeps its value in that average. |
| C4 | The sale price cap uses `itemUnitSalePrice.unitSalePrice` only when its `salesUnitOfMeasureCode` is null or the item's inventory unit. Otherwise the cap is skipped with a warning. | Carbon has no sales-unit conversion factor. A price per box must not cap a cost per each. |
| C5 | `get_inventory_valuation` excludes child rows from the layer count and adds their cost to their parent. | Today it counts an open child as a layer of its own (`20260925121735_rpc-function-guards.sql:1571-1587`). The bug already affects purchase price variance children; refurbishment children would make it larger. |
| C6 | `post-shipment` and `post-picking` refuse a serial that has an open Refurbishment order. | Only the selection RPCs and routes skip On Hold serials. A narrow guard keyed on the open order changes no other On Hold flow (returns, inspections). |

## Progress

- [x] Task 1: Add the completion columns
- [x] Task 2: Fix the layer count in `get_inventory_valuation`
- [x] Task 3: Add the pure completion planner
- [x] Task 4: Add `complete-service-order`
- [x] Task 5: Record refurbishment parts in the serial's build history
- [x] Task 6: Guard shipping and picking
- [x] Task 7: Add refurbishment orders and the completion preview to the UI
- [x] Task 8: Add the database tests
- [x] Task 9: Extend the demo datasets
- [x] Task 10: Update the rules, docs and spec
- [ ] Task 11: Verify in the browser

## Dependencies

- Task 1 runs first. Task 2 is independent.
- Task 3 needs Task 1. Task 4 needs Task 3. Task 5 is independent of Tasks 3 and 4.
- Task 6 is independent. Task 7 needs Task 4.
- Task 8 needs Tasks 2–6. Task 9 needs Task 7. Task 10 needs Tasks 1–9. Task 11 runs last.

---

## Task 1: Add the completion columns

**Depends on:** none
**Files:**
- Create: `packages/database/supabase/migrations/<timestamp>_refurbishment-completion.sql`

**Steps:**
1. Run `pnpm db:migrate:new refurbishment-completion`. Write:

```sql
ALTER TABLE "serviceOrder"
  ADD COLUMN IF NOT EXISTS "capitalizedAmount" NUMERIC,
  ADD COLUMN IF NOT EXISTS "writeDownAmount" NUMERIC,
  ADD COLUMN IF NOT EXISTS "completionJournalId" TEXT REFERENCES "journal"("id") ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "completionCostingMethod" "itemCostingMethod";
ALTER TABLE "serviceOrder" ADD CONSTRAINT "serviceOrder_refurbishment_check"
  CHECK ("type" = 'Refurbishment' OR ("capitalizedAmount" IS NULL AND "writeDownAmount" IS NULL));
```

2. `expectedSellingPrice` and `abnormalRework` exist from Phase A.
3. Run `pnpm db:migrate`, then `pnpm run generate:types`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/database
# Expected: exit code 0
```

**Out of scope:** a separate completion table. The order holds one completion.

---

## Task 2: Fix the layer count in `get_inventory_valuation`

**Depends on:** none
**Files:**
- Create: `packages/database/supabase/migrations/<timestamp>_valuation-child-rows.sql`

**Steps:**
1. Copy the newest `get_inventory_valuation` (`20260925121735_rpc-function-guards.sql:1488-1612`, or a later redefinition, such as the projects Phase 2a one if it shipped; search first).
2. In the open-layer CTE (`:1571-1587`), count only rows with `adjustment = false AND "appliesToCostLedgerId" IS NULL` as layers. Add each open child's remaining cost to its parent: `child.cost × child.remainingQuantity / child.quantity`, grouped by `appliesToCostLedgerId`.
3. Keep the signature, the `SECURITY` setting and `assert_company_access`.
4. Run `pnpm db:migrate`, then `pnpm run generate:types`.

**Verify:**
```bash
psql "$SUPABASE_DB_URL" -c "SELECT count(*) FROM get_inventory_valuation('<a company id with a purchase price variance child>');"
# Expected: the function runs; an item with one layer of 10 units and one open child shows 10 units, not 11
```

**Out of scope:** other reports.

---

## Task 3: Add the pure completion planner

**Depends on:** 1
**Files:**
- Create: `packages/server-functions/src/complete-service-order/plan.ts`
- Create: `packages/server-functions/src/complete-service-order/plan.test.ts`

**Steps:**
1. Export `planRefurbishmentCompletion(input)`:

```ts
type Layer = { id: string; quantity: number; remainingQuantity: number; cost: number; trackedEntityId: string | null; postingDate: string; createdAt: string };
type Child = { id: string; appliesToCostLedgerId: string; quantity: number; remainingQuantity: number; cost: number };
type Input = {
  costingMethod: "FIFO" | "LIFO" | "Average" | "Standard";
  wipTotal: number;
  serialId: string;
  openLayers: Layer[];            // the item's open layers, as calculateCOGS selects them
  openChildren: Child[];          // open children of those layers
  onHandQuantity: number;         // Average only
  currentUnitCost: number;        // Average only
  cap: number | null;             // C4; null = skip the cap with a warning
  abnormalRework: boolean;
};
```

2. It returns `{ split, childMoves, revaluation, writeDown, averageUnitCost, journal, warnings }`:
   1. **Abnormal rework:** no split and no child. The journal is Dr `materialVarianceAccount` / Cr WIP for `wipTotal`.
   2. **Standard:** no split and no child. The journal is Dr `materialVarianceAccount` / Cr WIP. The unit stays at standard.
   3. **Serial layer (FIFO, LIFO):** if an open layer is stamped with `serialId`, use it. Otherwise pick the source with `orderLayersForConsumption(openLayers, [serialId])` (C1): its first unstamped layer. `split` = decrease the source's `remainingQuantity` by 1, and insert a stamped layer of quantity 1 at the source's unit cost.
   4. **Child moves (C2):** move one unit of each open child of the source layer.
      - Decrease the child's `quantity`, `remainingQuantity` and `cost` by one unit's share (`cost / quantity`).
      - Insert a child of quantity 1 with that cost on the new stamped layer.
   5. **Revaluation:** a child row on the serial's layer: `costLedgerType 'Revaluation'`, `adjustment: true`, quantity 1, cost = `wipTotal`. The journal is Dr inventory / Cr WIP. Average also gets the child row (C3), on the serial's current layer when one exists, else unattached.
   6. **Average:** `averageUnitCost` = `(onHandQuantity × currentUnitCost + wipTotal) / onHandQuantity`.
   7. **Cap (FIFO, LIFO only):** the serial's new unit cost = layer unit cost + its children's per-unit cost. If it exceeds `cap`, `writeDown` = the excess: a negative child row, and Dr `inventoryAdjustmentVarianceAccount` / Cr inventory. If `cap` is null, add the warning "No sale price; the cost was not capped".
3. Round every amount with `round()`.
4. Write `plan.test.ts` with these 8 cases:
   1. The spec's FIFO case: one unstamped layer of 10 at 100.00, and WIP 200.00. Expect a split of 1 at 100.00, a 200.00 child, and Dr inventory / Cr WIP 200.00.
   2. LIFO with layers at 90.00 (older) and 110.00 (newer) splits from the 110.00 layer.
   3. A source layer with an open child of 5 units and 10.00 moves 2.00 onto the stamped layer and leaves 4 units and 8.00.
   4. A cap of 250.00 on a new cost of 300.00 writes down 50.00.
   5. No cap gives the warning and no write-down.
   6. Abnormal rework posts 200.00 to material variance and no child.
   7. Average with 10 on hand at 100.00 and WIP 200.00 gives 120.00.
   8. Standard posts 200.00 to material variance.

**Verify:**
```bash
pnpm --filter @carbon/server-functions test -- complete-service-order
# Expected: 8 passed
```

**Out of scope:** selling costs in the cap (spec decision 5).

---

## Task 4: Add `complete-service-order`

**Depends on:** 3
**Files:**
- Create: `packages/server-functions/src/complete-service-order/index.ts`
- Modify: `packages/server-functions/src/invoke.ts` — register it
- Modify: `apps/erp/app/modules/service/service.server.ts` — call it from the Complete action

**Steps:**
1. Input: `{ serviceOrderId }`. Permissions: `{ update: "service" }`.
2. For a Field Visit or a Depot Repair, it only stamps `completedAt` and `completedBy` and sets Completed, as Phase A does.
3. For a Refurbishment, in one Kysely transaction:
   1. Lock the order `FOR UPDATE`. Refuse unless its status is In Progress or Scheduled.
   2. `wipTotal` = Σ `projectLedger.amount` of the order's project with coverage Capitalized.
   3. Load `itemCost` (`costingMethod`, `unitCost`), the open layers of the item as `calculateCOGS` selects them (`calculate-cogs.ts:66-92`, `FOR UPDATE`), and their open children, with one query each.
   4. Compute the cap (C4): the order's `expectedSellingPrice`, else `itemUnitSalePrice.unitSalePrice` when its unit is null or the inventory unit.
   5. Call `planRefurbishmentCompletion`.
   6. Write the layer split, the child moves, the revaluation child and the write-down child.
   7. If accounting is on, post one journal with `createAdjustmentJournal` (`sourceType 'Service Order'`) and the planned lines. The inventory account comes from `resolveInventoryAccount` (`get-posting-group.ts:30-49`). WIP is `accountDefault.workInProgressAccount`. Add the Project and Project Element dimensions.
   8. For Average, update `itemCost.unitCost`.
   9. Set the serial's status to `Available`. Write a `trackedActivity` of type `Service` with the order id.
   10. Save `capitalizedAmount`, `writeDownAmount`, `completionJournalId` and `completionCostingMethod`. Set the order to Completed, and its project to Technically Complete.
4. Update the permissions snapshot (`-u`) and review it.

**Verify:**
```bash
pnpm --filter @carbon/server-functions test -- permissions-manifest && pnpm exec turbo run typecheck --filter=@carbon/server-functions
# Expected: all tests pass; typecheck exits 0
```

**Out of scope:** reopening a completed refurbishment (later work).

---

## Task 5: Record refurbishment parts in the serial's build history

**Depends on:** none
**Files:**
- Modify: `packages/server-functions/src/post-project-issue/index.ts` (the Service branch from Phase A Task 9)

**Steps:**
1. An issue to a node of a Refurbishment order has coverage Capitalized (`resolveCoverage`). So it posts Dr WIP / Cr inventory and writes no billable item. Confirm this with the Phase A code. Change nothing if it already holds.
2. Write no `customerAssetComponent` row: the unit has no customer asset.
3. For each issued serial, insert a `trackedActivity` of type `Service`, as Phase A does for a customer unit. Its input is the issued serial; its output is the order's subject serial. A later *Build from part* on the serial then shows the new parts.
4. A return removes that activity's input row.

**Verify:**
```bash
pnpm --filter @carbon/server-functions test -- post-project-issue
# Expected: all tests pass
```

**Out of scope:** removed parts.

---

## Task 6: Guard shipping and picking

**Depends on:** none
**Files:**
- Modify: `packages/server-functions/src/post-shipment/index.ts` (the `Sales Order` branch, near the serial loop `:464-494`)
- Modify: `packages/server-functions/src/post-picking/index.ts`

**Steps:**
1. Before the transaction, read the open Refurbishment orders of the serials being shipped or picked, with one query. An open order has a status other than Completed, Closed or Cancelled.
2. If one exists, refuse with "Serial <readable id> is under refurbishment on <order id>. Complete the order first." (C6).
3. Change no other status rule. Returns and inspections keep their On Hold behavior.

**Verify:**
```bash
pnpm --filter @carbon/server-functions test -- post-shipment post-picking
# Expected: all tests pass
```

**Out of scope:** a general server-side On Hold guard.

---

## Task 7: Add refurbishment orders and the completion preview to the UI

**Depends on:** 4
**Files:**
- Modify: `apps/erp/app/modules/service/service.models.ts` (`serviceOrderValidator`: allow `Refurbishment`)
- Modify: `apps/erp/app/modules/service/service.server.ts` (`createServiceOrder`)
- Modify: `apps/erp/app/modules/service/ui/ServiceOrders/ServiceOrderForm.tsx`, `ServiceOrderHeader.tsx`, `ServiceOrderProperties.tsx`
- Create: `apps/erp/app/routes/x+/service-order+/$id.complete.tsx`
- Create: `apps/erp/app/modules/service/ui/ServiceOrders/CompleteRefurbishmentModal.tsx`

**Steps:**
1. The new form gets a **Type** select: Field Visit or Refurbishment. A Refurbishment picks a stock serial (`Available` or `On Hold`) with `SerialSelect`, and has no customer, site or coverage contract.
2. For a Refurbishment, `createServiceOrder` refuses a serial that is not in stock or that has an open order. It sets the serial to `On Hold` in the same transaction.
3. The properties panel shows **Expected selling price** and **Abnormal rework** for a Refurbishment.
4. The complete route's loader runs the same reads as Task 4 and calls `planRefurbishmentCompletion` without writing. `CompleteRefurbishmentModal` shows:
   - the WIP total and the current unit cost;
   - the new unit cost, the cap and the write-down;
   - the method's effect: "Average spreads this cost over every unit of the item" or "Standard posts this cost to material variance";
   - the warning when there is no cap.
5. **Confirm** posts to the action, which invokes `complete-service-order`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exit code 0
```

**Out of scope:** a refurbishment that changes the serial's item (spec *Out of scope*).

---

## Task 8: Add the database tests

**Depends on:** 2, 3, 4, 5, 6
**Files:**
- Create: `packages/server-functions/src/complete-service-order/complete-service-order.test.ts`
- Modify: `packages/server-functions/src/lib/calculate-cogs.test.ts`
- Copy from (precedent): `calculate-cogs.test.ts` (`databaseTest`, `chargeFixture`); `post-customer-contract/contract-lifecycle.test.ts:185`

**Steps:**
1. `complete-service-order.test.ts`, the spec's Phase C criteria:
   1. **Capitalize (FIFO):** serial `SN-0050` in an unstamped layer of 10 at 100.00; labor 150.00 and parts 50.00 posted to WIP. Completion splits a stamped layer of 1 at 100.00, adds a 200.00 child and posts Dr inventory / Cr WIP 200.00. The serial is Available.
   2. **Relief:** `calculateCOGS` for `SN-0050` returns 300.00. For one other unit it returns 100.00.
   3. **Cap:** with a sale price of 250.00 the completion writes down 50.00; with an order price of 280.00 it writes down 20.00.
   4. **Abnormal rework:** 200.00 posts to material variance; `SN-0050` still relieves at 100.00.
   5. **Average:** `itemCost.unitCost` becomes 120.00.
2. In `calculate-cogs.test.ts`, add a case: split a layer that has an open child (C2). The split unit and the rest each relieve the right total.
3. Add a valuation case: after the completion, `get_inventory_valuation` shows 10 units for the item, not 11.
4. Add a guard case: shipping `SN-0050` while the order is open is refused.

**Verify:**
```bash
pnpm --filter @carbon/server-functions test -- complete-service-order calculate-cogs
# Expected: all tests pass
```

**Out of scope:** UI tests.

---

## Task 9: Extend the demo datasets

**Depends on:** 7
**Files:**
- Modify: `packages/database/src/datasets/types.ts`, the service orders spec from Phase A Task 29, `packages/database/src/datasets/tiers/04-sales.ts`, `packages/database/src/datasets/data/satellite/sales.ts`

**Steps:**
1. Add one Draft Refurbishment order to the satellite dataset, on a seeded stock serial (`RW-010` or `SAT-1000`), with its Service project. Set the serial to `On Hold`.
2. Seed no charges and no completion.
3. Run `pnpm db:check:datasets`.

**Verify:**
```bash
pnpm db:check:datasets
# Expected: all four datasets pass
```

**Out of scope:** a completed refurbishment in the datasets.

---

## Task 10: Update the rules, docs and spec

**Depends on:** 1–9
**Files:**
- Modify: `.claude/rules/field-service.md`, `.claude/rules/inventory-system.md` (the split, the child moves, the valuation fix)
- Modify: `docs/content/docs/reference/service-orders.mdx`
- Modify: `.ai/specs/2026-10-08-field-service.md`

**Steps:**
1. In the spec, record decisions C1–C6. Correct *Refurbishment completion* step 2 and decision 16. The source layer is the one `calculateCOGS` takes next: the oldest under FIFO, the newest under LIFO. Its open children move with the unit. Mark Phase C done.
2. Run the STE-80 review pass on every `.ai/` file you changed.

**Verify:**
```bash
cd docs && pnpm typecheck
# Expected: exit code 0
```

**Out of scope:** the changelog entry.

---

## Task 11: Verify in the browser

**Depends on:** 1–10
**Files:**
- Create: `.ai/playbooks/field-service-phase-c.md` (written by `/test`)

**Steps:**
1. Run `/test` on a satellite dataset company with accounting on.
2. Cover the spec's Phase C criteria:
   1. **Capitalize (FIFO):** a Refurbishment order on a stock serial puts it On Hold. Time and a part post to WIP. **Complete** shows the preview, then capitalizes. The serial is Available with its new cost.
   2. **Sale price cap:** the preview and the completion write down the excess over the sale price, and over an order override.
   3. **Abnormal rework:** the cost goes to material variance and the serial keeps its cost.
   4. **Average and Standard:** the preview states the method's effect before completion.
   5. **Guard:** shipping or picking the serial while the order is open is refused.
3. Save the playbook to `.ai/playbooks/field-service-phase-c.md`.

**Verify:**
```bash
ls .ai/playbooks/field-service-phase-c.md
# Expected: the file exists, and the /test run reports every step passed
```

**Out of scope:** Phase D.

## Execution notes

- Prerequisite check: the Phase A and B artifacts this plan names exist (`insertServiceOrder` in `lib/service-orders.ts`, `resolveCoverage` with Capitalized for a Refurbishment, the By Coverage posting).
- Task 1: the migration also indexes `completionJournalId` (partial, `IS NOT NULL`); every FK column has an index. `journal` has a single-column primary key, so the FK is single-column. `pnpm db:migrate` applied it and regenerated the types and swagger; the workflow catalog did not change. `pnpm db:check:backups` fails only on `supplierPartPrice.unitPrice` (GitHub `main` changed that column after this branch was cut), so the commit skips that check with `CARBON_SKIP_BACKUP_CHECK=1`. The new columns are nullable, so they block no restore.
- Task 2: the plan's line numbers had drifted; the open-layer CTE is the `layers` lateral of `carrying`. No later redefinition exists (Projects Phase 2a has not run). The new function adds `SET search_path = public, extensions`: `20261003224019` set it on every function with `ALTER FUNCTION`, and a `CREATE OR REPLACE` without it would drop it. The only writer of `adjustment = true` rows is `post-purchase-invoice`, and each of its rows names a parent, so the filter is the one `calculateCOGS` uses. The Projects Phase 2a plan now points its `get_inventory_valuation` step at this migration, so its fork keeps the fix.
- Task 2 Verify ran in a rolled-back transaction against the local database. The FIFO item has one layer of 10 at 1,000.00 and one open child of 10 units at 20.00. The new function gives a unit cost of 102.00. The old formula over the same rows gives 52.00 (it averaged over 20 units). With the parent and the child half consumed, the unit cost stays 102.00. With no child it is 100.00, as before. `rpc-privileges.test.sql` passes.
- Task 3: the planner sorts `openLayers` itself (FIFO ascending, LIFO descending, by `postingDate` then `createdAt`), then applies `orderLayersForConsumption`. So the LIFO test proves the order. `createdAt` arrives as fixed-width UTC text, which sorts as a string.
- Task 3 (deviation): the split moves one unit's quantity **and** cost off the source layer, not only one unit of `remainingQuantity`. The source keeps its unit cost, and the cost ledger's totals do not change. With only `remainingQuantity` moved, 3 readers would see one unit too many:
  1. `update-purchased-prices` averages Σ cost over Σ quantity.
  2. The sales return receipt void refuses a layer whose remaining quantity is below its quantity ("already consumed").
  3. The purchase price variance allocation reads the receipt's layers.
- Task 3 (C2 made exact): the unit takes the child cost that `calculateCOGS` would apply to it. That is the source's open children in `createdAt` order, one unit in total. With one child, this is the plan's rule. `calculateCOGS` treats several children of one layer as covering different units, so moving one unit of each child would change the relief cost.
- Task 3: a FIFO / LIFO serial with no layer of its own and no unstamped layer with a whole unit is refused (`NO_SOURCE_LAYER_MESSAGE`). Taking another serial's stamped layer would move that serial's value.
- Task 3: the plan also returns `treatment`, `serialLayerId`, `currentSerialUnitCost`, `newSerialUnitCost` and `capitalizedAmount`. The preview (Task 7) and the order columns (Task 4) use them. `serialLayerId` is the serial's own open layer, when it has one. `capitalizedAmount` is the WIP total when it is capitalized (FIFO, LIFO, Average), and 0 when it goes to material variance. A zero WIP gives no child and no journal line.
- Task 4: neither `journalEntrySourceType` nor `journalLineDocumentType` had a `Service Order` value. Migration `20261010004037_service-order-journal-source.sql` adds both, alone, as the Phase A enum migration did. The enum mirrors follow:
  - `POSTING_POLICY` gains `Service Order` (journal, `defaultEnabled: false`). Its comment states the rule for a new journal type: it must not push to a customer's external ledger unasked, as for `Revenue Recognition`. Phase A chose `true` for the project types; that choice is the open follow-up.
  - `journalEntrySourceTypes` lists it, and `JournalEntrySourceTypeIcon` shows it as `LuHardHat`.
  - `journalReference.to.serviceOrder` is the line reference.
- Task 4: the reads are `loadRefurbishmentCompletion` (`complete-service-order/load.ts`), exported from the function's module with the planner. Its `lock` flag takes the row locks, so Task 7's preview runs the same reads without them.
- Task 4 (deviation): a Refurbishment completes from Draft as well as Scheduled and In Progress, the open statuses of `canMoveServiceOrder`. Visits move an order out of Draft, and a refurbishment in the shop has none. So the plan's rule would make it impossible to complete (the Depot Repair reason, Phase B Task 9). The function also refuses a serial that is not On Hold or Available.
- Task 4: C4 takes the item's oldest `itemUnitSalePrice` row (the table has no key on `itemId`, the Phase A Task 11 note). It also skips a price in a currency other than the base currency, with its own warning, for the reason C4 gives for the unit.
- Task 4: the journal's inventory debit carries the Project dimension. The WIP credit is split by node, each line with the Project and Project Element dimensions, so each node's WIP nets to zero. The new layer copies the source's document fields and posting date. The child rows carry the order id as `documentId` with no `documentType` (`itemLedgerDocumentType` has no service value). They are stamped with the serial; the revaluation is `Positive Adjmt.` and the write-down `Negative Adjmt.`, both `Revaluation`. An unattached Average child has `remainingQuantity` 0, because nothing relieves it.
- Task 4 (deviation, 🛑 behavior): `calculateCOGS` now applies every child of a **stamped** layer in full to its unit. It applied the children of a layer in turn, as if each covered different units, so a one-unit layer gave only its first child. The serial would have left at 300.00 after a write-down to 250.00, and a second refurbishment's child would never be relieved. Unstamped layers are unchanged. No stamped layer has a child today: only `post-purchase-invoice` writes children, onto Purchase Receipt layers, which are never stamped. The new case in `calculate-cogs.test.ts` fails without the change (300 ≠ 250), and its unstamped half pins the old order (204.00, then 208.00).
- Task 4: the ERP's `completeServiceOrder` (`service.server.ts`) invokes the function, and the status route sends **Complete** through it; its warnings join the success message. `syncServiceOrderStatus` now guards a Refurbishment in 3 ways, so its cost cannot bypass the completion:
  1. It refuses `status: Completed`, because only the function completes a refurbishment.
  2. It ignores a visit's **Work complete?**.
  3. It refuses to reopen a completed refurbishment: its cost is already in the serial, and a second completion would capitalize the WIP again.
- Task 4: Task 8's completion test came early (`complete-service-order.test.ts`, 4 database cases). They cover the spec's criteria 1–5:
  1. the FIFO capitalization with its journal, tags, order columns and a refused second completion;
  2. relief at 300.00 and 100.00;
  3. the caps of 50.00 and 20.00, with relief at 250.00;
  4. abnormal rework;
  5. Average at 120.00.
  The FIFO case also reads `get_inventory_valuation`: 10 units, unit cost 120.00, value 1,200.00. The permissions snapshot gains `complete-service-order` (`update: service`), reviewed. The full server-functions suite passes (477). The posting policy tests (30) and the ERP service tests (22) pass. `@carbon/database`, `@carbon/server-functions`, `@carbon/ee`, `erp`, `@carbon/jobs` and `mes` typecheck green.
- Gap: the SQL backflush (`backflush_job_materials`) still applies a layer's children in turn and has no serial order (the research's table). A refurbished serial consumed by a backflush would take only its first child. Closed later by migration `20261010012609` (`fix(inventory)`): the backflush now orders and applies children as `calculateCOGS` does.
- Task 5 step 1 holds without change: `serviceChargeCoverage` passes the order type to `resolveCoverage`, so a Refurbishment issue is Capitalized. `resolveProjectPostingAccount` gives Work in Progress, so the issue posts Dr WIP / Cr inventory. `buildBillableItem` returns null for Capitalized, so the issue writes no billable item.
- Task 5: `installServicePart` returned before the activity when the order had no asset, so a Refurbishment issue wrote no `Service` activity. A Refurbishment now writes only the activity. Its input is the issued serial or batch (any tracked issue, as Phase A Task 9 does), and its output is the order's subject serial. The service context gains `subjectTrackedEntityId` (`serviceOrder.trackedEntityId`, same query), and the insert moved into `insertServiceActivity`, shared with the customer-unit path. A return deletes the whole activity, as Phase A does: the activity's attribute names the issue, and it holds only that input.
- Task 5: the new database case issues TR-200 to a Refurbishment node. It posts Dr WIP 40.00 / Cr inventory 40.00 at Capitalized, with no billable item and no component row. TR-100's row is untouched, and the activity runs TR-200 → the subject serial. The return credits WIP back and deletes the activity. With the Refurbishment branch disabled, the case fails. The post-project-issue tests pass (4), as do the project and service suites around them (50).
- Task 6: the guard is `assertNoOpenRefurbishment` (`lib/service-orders.ts`), one query for any number of serials. It looks for an order of type Refurbishment on the serial that is not Completed, Closed or Cancelled. It refuses with status 422 and the plan's text ("Serial SN-0050 is under refurbishment on SVC-R2. Complete the order first."). `post-shipment` calls it in the Sales Order post branch, before the transaction, with the shipment's tracked entities (`shipmentLineTracking`). A batch has no Refurbishment order, so passing every entity costs nothing. `post-picking` calls it in the `serial` case only, so unpicking and returns are unchanged. Other shipment types (Purchase Order returns, outbound transfers) are not guarded, as the plan's file list scopes it.
- Task 6: a refused shipment goes back to Draft through the function's existing catch, with no ledger row. 2 new database cases:
  1. A Sales Order shipment of SN-0001 is refused while its Refurbishment order is Draft. It writes nothing, and it posts once the order is Completed (`customer-assets.test.ts`).
  2. A serial pick of SN-0050 is refused while its order is In Progress, and picks once the order is Cancelled (`post-picking/refurbishment-guard.test.ts`).

  With the guard disabled, both fail. The post-shipment and service-orders tests pass (10). The full server-functions suite passes (479 of 480); the 1 failure is the known `post-charge-concurrency` race, which passes alone.
- Task 7: the New form gets a **Type** select. A Refurbishment picks an item (`Item`), then one of its serials (`SerialSelect`, posted as a hidden `trackedEntityId`). The validator makes `customerAssetId` required for a Field Visit and `trackedEntityId` for a Refurbishment. A refusal shows under the item field, because the serial picker sits under it.
- Task 7: `createServiceOrder` refuses a serial that is not serial-tracked, not Available or On Hold, or that has an open order. It inserts the order with no customer, asset, site or contract, and sets the serial On Hold in the same transaction. The tree build moved into `buildServiceOrderTree`, shared by both types.
- Task 7: `insertServiceOrder` now takes a null `customerAssetId`, `customerId` and `customerName`. A Refurbishment's project is named "<order id> — <serial>". A new case in `lib/service-orders.test.ts` pins it.
- Task 7 (open item closed): `cancelServiceOrder` sets a cancelled Refurbishment's serial from On Hold back to Available, in the same transaction.
- Task 7 (deviation): `$id.complete.tsx` has a loader only. It calls `previewRefurbishmentCompletion` (`service.server.ts`), which runs `loadRefurbishmentCompletion` without locks and `planRefurbishmentCompletion`, and writes nothing. **Complete** in `CompleteRefurbishmentModal` posts `status=Completed` to the existing status route. That route already checks the move and invokes `complete-service-order`, so the completion keeps one path.
- Task 7: for a Refurbishment, the Properties panel shows the serial, **Expected Selling Price** (rate format, base currency) and **Abnormal Rework**. It hides customer, site, contact, contract and invoice detail. `updateServiceOrder` refuses both fields on another order type and on a completed refurbishment. The Details page shows the capitalized amount, the write-down and the costing method once a refurbishment completes. The header makes Complete the primary step and disables Reopen.
- Task 7: the list's type filter now offers Refurbishment (`listedServiceOrderTypes`). The UI is not browser-verified (Task 11).
- Task 8: Task 4 had written the completion cases early (capitalize, relief, cap, abnormal rework, Average). The FIFO case already reads `get_inventory_valuation` (10 units, not 11). Task 6 had written the guard cases: a Sales Order shipment refused while a Refurbishment order is open (`post-shipment/customer-assets.test.ts`) and a serial pick refused (`post-picking/refurbishment-guard.test.ts`).
- Task 8 (deviation): the C2 split case is in `complete-service-order.test.ts`, not `calculate-cogs.test.ts`, because the completion writes the split. The source layer has an open child of 10 units at 20.00. After the completion the child keeps 9 units at 18.00, and the serial's layer has a moved child of 1 unit at 2.00. The serial relieves 302.00 (100.00 + 2.00 + 200.00) and the other 9 units relieve 918.00, as before the split. `calculate-cogs.test.ts` keeps the stamped-layer case Task 4 added. The completion and `calculate-cogs` tests pass (15).
- Task 9: the service orders are seeded in tier 09 (`seedServiceWork`), not tier 04, so the change is there. `ServiceOrderSpec` is now a union: a Field Visit names an `asset`, and a Refurbishment names a `serial` from `inventory.onHandTracked` and an optional `expectedSellingPrice`. The other 3 datasets need no change.
- Task 9: satellite seeds one Draft Refurbishment on RW010-SN-0054 (opening stock, referenced nowhere else), with an expected selling price of 15,500.00. Its project has no customer, and the seed sets the serial On Hold. The validator refuses a serial that is not in `onHandTracked`, not Available, not serial-tracked, or already has an open order. `pnpm db:check:datasets` passes for all 4 datasets.
- Task 10: the spec records C1–C6 as decisions 48–53. It corrects step 2 of *Refurbishment completion*, step 5's cap rule, decision 16 and the layer split risk. It gains *Implementation notes (Phase C)*, and its status and delivery phases mark Phase C implemented. The spec stays in `.ai/specs/`, because Phase D is still planned.
- Task 10: `field-service.md` gains a *Refurbishment of a serial in stock* section. `inventory-system.md` describes how children of a layer are relieved, the split and the valuation fix. The service module's `AGENTS.md` drops the Ask First line about Refurbishment in the UI and adds one about its completion path. `service-orders.mdx` gains a *Refurbishment* section and 5 troubleshooting entries. `docs` typecheck passes.
- Task 11: browser verification deferred (overnight run). The box stays unticked.

