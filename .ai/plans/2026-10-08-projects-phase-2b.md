# Projects Phase 2b — project-aware MRP — implementation plan

**Spec:** .ai/specs/2026-10-03-projects.md (*MRP: a project-aware netting segment*; decisions 18 and 24; Risks: *MRP primary key change*)
**Research:** .ai/research/projects-wbs-pmmo.md (pattern 6, Oracle and IFS netting)
**Branch:** projects-wbs-research-spec
**Prerequisite:** the Phase 2a plan is done and committed. If a named Phase 2a artifact does not exist, STOP and report.

## Scope of this plan

MRP nets each project with project stock in its own **netting segment**. The segment is a fourth key, `planningSegmentId`:
- `''` is common;
- a project id is a project with project stock (Phase 3 adds planning group ids).

The plan covers:
1. **The engine keys:** a pure golden test first, then the segment threaded through the engine, the runner and the writes.
2. **Segmented inputs:** demand, supply and on-hand carry a segment. The new demand source **Project Material** reads plan-line materials. Open borrows are firm demand on the borrower and firm supply on the lender.
3. **The netting sequence:** own segment first, then common surplus with a **Transfer** planning action, then new supply in the segment.
4. **The outputs:** the 4 MRP tables, `planningAction` and the planning RPCs gain the segment.
5. **Apply:** an Order or Make in a segment creates a PO line or job charged to the project. A Transfer creates a Draft project stock transfer.
6. **The worklist UI:** a Segment column and filter.

**The invariant:** a company with no project stock gets output that is identical to today's, row for row. The golden test from Task 1 pins it.

## Rules for the executor

- Read `.ai/lessons.md`, `.claude/rules/mrp-system.md`, `.claude/rules/database-migration-patterns.md` and `packages/planning/AGENTS.md` before Task 1.
- 🛑 Never edit the Task 1 golden snapshot to make a test pass. If it changes, the change broke the invariant. STOP and report.
- The segment sentinel is `''`, never NULL. Every new `planningSegmentId` column is `TEXT NOT NULL DEFAULT ''`.
- Project segments are lot-for-lot with no reorder point and no safety stock. Forecasts, demand projections and supersession apply to segment `''` only.
- Use one `KEY_SEP`. Task 3 removes the two copies.
- If a quoted code line or line number does not match the file, search for the quoted code. If you cannot find it, STOP and report.

## Progress

- [x] Task 1: Extract the planning core and pin a golden test
- [x] Task 2: Create the Phase 2b enum and segment migration
- [x] Task 3: Add the segment to the engine keys
- [x] Task 4: Add the netting sequence as a pure module
- [x] Task 5: Segment the demand and supply views
- [x] Task 6: Segment the inputs of `runMrp`
- [x] Task 7: Net segments and draw common surplus in `explodeBom`
- [x] Task 8: Segment the actuals and the Phase 7 writes
- [x] Task 9: Segment the planning RPCs and grids
- [x] Task 10: Generate segmented and Transfer planning actions
- [x] Task 11: Apply segmented Order, Make and Transfer actions
- [x] Task 12: Add the project-manager rung and the company sweep
- [x] Task 13: Add the Segment column to the planning worklists
- [x] Task 14: Show borrow exceptions
- [x] Task 15: Update the rules, AGENTS.md, docs and spec
- [ ] Task 16: Verify in the browser

## Dependencies

- Task 1 runs first and is committed before any other task.
- Task 2 needs Task 1. Tasks 3 and 4 need Task 1.
- Task 5 needs Task 2. Task 6 needs Tasks 3 and 5. Task 7 needs Tasks 4 and 6. Task 8 needs Task 7.
- Task 9 needs Task 2. Task 10 needs Tasks 8 and 9. Task 11 needs Task 10.
- Tasks 12, 13 and 14 need Task 10. Task 15 needs Tasks 1–14. Task 16 runs last.

---

## Task 1: Extract the planning core and pin a golden test

**Depends on:** none
**Files:**
- Create: `packages/planning/src/mrp/plan-company.ts`
- Create: `packages/planning/src/mrp/plan-company.test.ts`
- Create: `packages/planning/src/mrp/__fixtures__/plan-company.basic.json`
- Modify: `packages/planning/src/mrp/mrp.ts`

**Steps:**
1. `runMrp` has no test harness today. Move the pure part of Phases 3–6 (lines 395–1137) into `planCompany(inputs: PlanCompanyInputs): PlanCompanyOutputs` in `plan-company.ts`.
   - `PlanCompanyInputs` holds every value that Phases 1 and 2 load. These are periods, locations, items (with replenishment and lead time), BOMs, on-hand, open supply, open demand, projections, supersessions and `today`.
   - `PlanCompanyOutputs` holds every array Phase 7 writes: `demandForecastUpserts`, `demandForecastSourceInserts`, `supplyForecast` rows (if any), `demandActualUpserts`, `supplyActualUpserts`, `consumptionUpdates` and the cycle log.
2. `runMrp` keeps the loads and the writes. It calls `planCompany` between them. Make no other change.
3. Build `plan-company.basic.json` from a satellite dataset company. Export the inputs once with a temporary log line, then remove the log line. The fixture must hold at least these 6 cases:
   1. one Make item with a 2-level BOM;
   2. one Buy item;
   3. one open PO line and one open job;
   4. one sales order line;
   5. one demand projection;
   6. one Consume First supersession.
4. In `plan-company.test.ts`, load the fixture, run `planCompany`, sort each output array by its key, and compare with `toMatchSnapshot()`.
5. Run the test once to write the snapshot. Commit the fixture, the snapshot and the extraction.

**Verify:**
```bash
pnpm --filter @carbon/planning test -- plan-company
# Expected: 1 passed, 1 snapshot written
pnpm --filter @carbon/planning test
# Expected: all tests pass
```

**Out of scope:** any behavior change. Phase 7 stays in `mrp.ts`.

---

## Task 2: Create the Phase 2b enum and segment migration

**Depends on:** 1
**Files:**
- Create: `packages/database/supabase/migrations/<timestamp>_projects-2b-enums.sql`
- Create: `packages/database/supabase/migrations/<timestamp>_mrp-planning-segment.sql`

**Steps:**
1. Run `pnpm db:migrate:new projects-2b-enums`. Write only:

```sql
ALTER TYPE "demandSourceType" ADD VALUE IF NOT EXISTS 'Project Material';
ALTER TYPE "demandSourceType" ADD VALUE IF NOT EXISTS 'Project Borrow';
ALTER TYPE "supplySourceType" ADD VALUE IF NOT EXISTS 'Project Borrow';
ALTER TYPE "demandForecastSourceType" ADD VALUE IF NOT EXISTS 'Project Material';
ALTER TYPE "planningActionType" ADD VALUE IF NOT EXISTS 'Transfer';
ALTER TYPE "planningActionType" ADD VALUE IF NOT EXISTS 'Borrow';
```

2. Run `pnpm db:migrate:new mrp-planning-segment`. Write:

```sql
-- One segment rule for every view and RPC. Phase 3 redefines it to prefer planningGroupId.
CREATE OR REPLACE FUNCTION project_planning_segment(p_project_id TEXT)
RETURNS TEXT LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  SELECT COALESCE((SELECT CASE WHEN p."projectStock" THEN p."id" ELSE '' END
                   FROM "project" p WHERE p."id" = p_project_id), '');
$$;

ALTER TABLE "demandForecast"       ADD COLUMN IF NOT EXISTS "planningSegmentId" TEXT NOT NULL DEFAULT '';
ALTER TABLE "supplyForecast"       ADD COLUMN IF NOT EXISTS "planningSegmentId" TEXT NOT NULL DEFAULT '';
ALTER TABLE "demandActual"         ADD COLUMN IF NOT EXISTS "planningSegmentId" TEXT NOT NULL DEFAULT '';
ALTER TABLE "supplyActual"         ADD COLUMN IF NOT EXISTS "planningSegmentId" TEXT NOT NULL DEFAULT '';
ALTER TABLE "demandForecastSource" ADD COLUMN IF NOT EXISTS "planningSegmentId" TEXT NOT NULL DEFAULT '';

ALTER TABLE "demandForecast" DROP CONSTRAINT "demandForecast_pkey";
ALTER TABLE "demandForecast" ADD CONSTRAINT "demandForecast_pkey" PRIMARY KEY ("itemId", "locationId", "periodId", "planningSegmentId");
ALTER TABLE "demandForecast" DROP CONSTRAINT "demandForecast_itemId_locationId_periodId_companyId_key";
ALTER TABLE "demandForecast" ADD CONSTRAINT "demandForecast_itemId_locationId_periodId_companyId_key"
  UNIQUE ("itemId", "locationId", "periodId", "companyId", "planningSegmentId");
ALTER TABLE "supplyForecast" DROP CONSTRAINT "supplyForecast_pkey";
ALTER TABLE "supplyForecast" ADD CONSTRAINT "supplyForecast_pkey" PRIMARY KEY ("itemId", "locationId", "periodId", "planningSegmentId");
ALTER TABLE "demandActual" DROP CONSTRAINT "demandActual_pkey";
ALTER TABLE "demandActual" ADD CONSTRAINT "demandActual_pkey" PRIMARY KEY ("itemId", "locationId", "periodId", "sourceType", "planningSegmentId");
ALTER TABLE "supplyActual" DROP CONSTRAINT "supplyActual_pkey";
ALTER TABLE "supplyActual" ADD CONSTRAINT "supplyActual_pkey" PRIMARY KEY ("itemId", "locationId", "periodId", "sourceType", "planningSegmentId");

ALTER TABLE "planningAction"
  ADD COLUMN IF NOT EXISTS "planningSegmentId" TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS "fromProjectId" TEXT,           -- Transfer/Borrow source owner; null = common
  ADD COLUMN IF NOT EXISTS "toProjectId" TEXT,             -- Transfer/Borrow target owner; null = common
  ADD COLUMN IF NOT EXISTS "projectStockTransferId" TEXT,
  ADD COLUMN IF NOT EXISTS "projectBorrowId" TEXT;
ALTER TABLE "planningAction" DROP CONSTRAINT "planningAction_change_target_chk";
ALTER TABLE "planningAction" ADD CONSTRAINT "planningAction_change_target_chk" CHECK (
  ("type" IN ('Order','Make','Transfer','Borrow') AND "purchaseOrderLineId" IS NULL AND "jobId" IS NULL)
  OR ("type" NOT IN ('Order','Make','Transfer','Borrow') AND (("purchaseOrderLineId" IS NOT NULL)::int + ("jobId" IS NOT NULL)::int) = 1)
);
ALTER TABLE "planningAction" ADD CONSTRAINT "planningAction_transfer_owner_chk" CHECK (
  ("type" IN ('Transfer','Borrow') AND "fromProjectId" IS DISTINCT FROM "toProjectId")
  OR ("type" NOT IN ('Transfer','Borrow') AND "fromProjectId" IS NULL AND "toProjectId" IS NULL)
);
DROP INDEX IF EXISTS "planningAction_natural_key_idx";
CREATE UNIQUE INDEX "planningAction_natural_key_idx" ON "planningAction"
  ("companyId", "itemId", "locationId", "planningSegmentId", "type",
   (COALESCE("purchaseOrderLineId", "jobId", "periodId")),
   (COALESCE("fromProjectId", '')), (COALESCE("toProjectId", '')))
  WHERE "status" <> 'Actioned';
CREATE INDEX IF NOT EXISTS "planningAction_segment_idx" ON "planningAction" ("companyId", "planningSegmentId") WHERE "planningSegmentId" <> '';
```

3. Postgres refuses a new enum value in the transaction that adds it. The CHECK above names `'Transfer'` and `'Borrow'`, so the enum migration must have the earlier timestamp.
4. Read the real constraint names in the migrations before you write the DROP lines (`grep -n "CONSTRAINT" 20250610000433_demand-planning.sql 20250907225239*.sql 20261006130000_mrp-planning-actions.sql`). If a name differs, use the real name.
5. Run `pnpm db:migrate`, then `pnpm run generate:types`.
6. Add `"planningSegmentId"` to the `id-refs.ts` entries of these tables if `packages/jobs/src/backups/id-refs.ts` lists their key columns.

**Verify:**
```bash
psql "$SUPABASE_DB_URL" -c "SELECT count(*) FROM \"planningAction\" WHERE \"planningSegmentId\" <> '';"
# Expected: 0
pnpm exec turbo run typecheck --filter=@carbon/database
# Expected: exit code 0
```

**Out of scope:** the views (Task 5) and the RPCs (Task 9).

---

## Task 3: Add the segment to the engine keys

**Depends on:** 1
**Files:**
- Modify: `packages/database/src/mrp-engine.ts` (lines 76–112, 182–383)
- Modify: `packages/database/src/mrp-engine.test.ts`
- Modify: `packages/planning/src/mrp/planning-actions.ts` (line 55)
- Modify: `packages/planning/src/mrp/responsible-employee.ts` (line 18)

**Steps:**
1. Change the key helpers so the segment is the last part and defaults to `''`:

```ts
export const COMMON_SEGMENT = "";

export function makeKey(locationId: string, periodId: string, itemId: string, segmentId: string = COMMON_SEGMENT): string {
  return locationId + KEY_SEP + periodId + KEY_SEP + itemId + KEY_SEP + segmentId;
}
export function splitKey(key: string): [string, string, string, string] {
  const parts = key.split(KEY_SEP);
  return [parts[0]!, parts[1]!, parts[2]!, parts[3] ?? COMMON_SEGMENT];
}
export function makeLocationItemKey(locationId: string, itemId: string, segmentId: string = COMMON_SEGMENT): string {
  return locationId + KEY_SEP + itemId + KEY_SEP + segmentId;
}
export function splitLocationItemKey(key: string): [string, string, string] {
  const parts = key.split(KEY_SEP);
  return [parts[0]!, parts[1]!, parts[2] ?? COMMON_SEGMENT];
}
```

2. Change `makeActualKey` and `splitActualKey` the same way, with the segment as the fifth part.
3. Replace the hand parse in `explodeBom` (lines 248–259, `locItem.indexOf(KEY_SEP)`) with `splitLocationItemKey`.
4. In `explodeBom`, carry the parent's segment into every child key. Children of a parent in segment S get demand in segment S.
5. Add `segmentId` to `DemandContributorBase`, optional with default `''`.
6. Delete the `KEY_SEP` copies in `planning-actions.ts:55` and `responsible-employee.ts:18`. Import `KEY_SEP` from `@carbon/database/mrp-engine` (or the export path the package already uses for it).
7. Add tests to `mrp-engine.test.ts`:
   1. `splitKey(makeKey("l", "p", "i"))` returns `["l", "p", "i", ""]`.
   2. A parent with demand in segment `prj_1` explodes its child's demand into `prj_1` only.

**Verify:**
```bash
pnpm --filter @carbon/database test -- mrp-engine && pnpm --filter @carbon/planning test
# Expected: all tests pass; the plan-company snapshot is unchanged
```

**Out of scope:** the common surplus draw (Task 7).

---

## Task 4: Add the netting sequence as a pure module

**Depends on:** 1
**Files:**
- Create: `packages/database/src/mrp-netting-sequence.ts`
- Create: `packages/database/src/mrp-netting-sequence.test.ts`
- Modify: `packages/database/package.json` — export `./mrp-netting-sequence` next to `./mrp-engine`

**Steps:**
1. Export `trueSurplusByPeriod(onHand, demandByPeriod)`.
   - Input: the common segment's on-hand and its gross demand per period index, in period order.
   - Output: for each period index t, the stock the common segment does not need in t or later. That is `min over k ≥ t of (onHand − Σ demand[0..k])`, floored at 0.
   - Planned and open supply do not count. A Transfer moves only stock that exists.
2. Export `allocateCommonSurplus({ surplusByPeriod, needs })`.
   - `needs` is a list of `{ segmentId, periodIndex, quantity }` for project segments, after each segment's own on-hand and supply.
   - Sort the needs by period index, then segment id.
   - For each need, take `min(need, surplus available at its period)`. Then reduce the surplus at that period and at every earlier period by the amount taken, so later needs see less.
   - Return `{ draws: { segmentId, periodIndex, quantity }[], remaining: same shape }`.
3. Write tests for 5 cases:
   1. On-hand 10 and common demand 2 in week 3 give a surplus of 8 in every week up to 3, and 8 after.
   2. On-hand 10 and common demand 6 in week 5 give a project need of 7 in week 2 a draw of 4. The remainder is 3.
   3. Two segments needing 5 each in weeks 2 and 1, with surplus 6, draw 5 for the week-1 segment and 1 for the week-2 segment.
   4. A surplus of 0 draws nothing.
   5. The output is the same for any input order of `needs`.

**Verify:**
```bash
pnpm --filter @carbon/database test -- mrp-netting-sequence
# Expected: 5 passed
```

**Out of scope:** `itemPlanning.allowCommonSupplyForProjects`. The caller filters items by it.

---

## Task 5: Segment the demand and supply views

**Depends on:** 2
**Files:**
- Create: `packages/database/supabase/migrations/<timestamp>_mrp-segment-views.sql`

**Steps:**
1. Recreate each view from its latest definition with a `planningSegmentId` column. Keep every existing column and filter.
   - `openSalesOrderLines` (`20261006130001_demand-forecast-consumption.sql:32–73`): `''::text AS "planningSegmentId"`. Phase 4 links sales orders to projects.
   - `openJobMaterialLines` (`20260926093417…sql:21–56`): `project_planning_segment(j."projectId")`.
   - `openProductionOrders` (`20260811123619…sql:474–500`):
     - `CASE WHEN j."receiveToProjectStock" THEN project_planning_segment(j."projectId") ELSE '' END`;
     - add `AND NOT j."consumeToProject"`, because a job that consumes its output to the project puts nothing in stock.
   - `openPurchaseOrderLines` (`20260811123616…sql:164–192`): `project_planning_segment(pol."projectId")`. Exclude a line that the receipt consumes to the project. Use the exact condition of the Phase 1a consume-at-receipt branch in `post-receipt` (search `post-receipt/index.ts` for the branch Task 9 of Phase 2a kept).
2. Create `openProjectMaterialLines`. Fill `planningSegmentId` with `project_planning_segment(m."projectId")`:

```sql
CREATE OR REPLACE VIEW "openProjectMaterialLines" WITH (security_invoker = true) AS
SELECT
  m."id", m."companyId", m."projectId", m."projectElementId", m."itemId",
  p."locationId",
  m."quantity" - m."quantityIssued" AS "quantity",
  COALESCE(m."requiredDate", e."startDate", p."startDate") AS "requiredDate",
  project_planning_segment(m."projectId") AS "planningSegmentId"
FROM "projectElementMaterial" m
JOIN "projectElement" e ON e."id" = m."projectElementId" AND e."companyId" = m."companyId"
JOIN "projectState" s ON s."id" = e."stateId"
JOIN "project" p ON p."id" = m."projectId" AND p."companyId" = m."companyId"
WHERE m."methodType" = 'Pull from Inventory'
  AND m."quantity" > m."quantityIssued"
  AND s."group" IN ('Unstarted', 'Started')
  AND p."status" = 'Released'
  AND p."locationId" IS NOT NULL;
```

3. Create `openProjectBorrows`: one row per `projectBorrow` with status `Open`. Fill these columns:
   - `quantity` = `quantity − quantityPaidBack`;
   - `paybackDueDate`;
   - `borrowerSegmentId` = `project_planning_segment("borrowerProjectId")`;
   - `lenderSegmentId` = `project_planning_segment("lenderProjectId")`;
   - plus `itemId`, `locationId` and `companyId`.
4. Read the real column names of `projectElement` (`startDate`), `projectState` (`group`) and `project` (`locationId`, `startDate`) in the Phase 1a migration. If one differs, use the real name.
5. Run `pnpm db:migrate`, then `pnpm run generate:types`.

**Verify:**
```bash
psql "$SUPABASE_DB_URL" -c "SELECT count(*) FROM \"openJobMaterialLines\" WHERE \"planningSegmentId\" <> '';"
# Expected: 0 on a database with no project stock
```

**Out of scope:** the RPCs (Task 9).

---

## Task 6: Segment the inputs of `runMrp`

**Depends on:** 3, 5
**Files:**
- Modify: `packages/planning/src/mrp/mrp.ts` (Phase 1 loads, lines 132–393; on-hand 306–321)
- Modify: `packages/planning/src/mrp/plan-company.ts`

**Steps:**
1. Select `planningSegmentId` from the 4 open views and pass it into `PlanCompanyInputs`.
2. Load `openProjectMaterialLines` and `openProjectBorrows` with `fetchAll` (or the paging helper `runMrp` uses). Order each by `id`.
3. Replace the Phase 2a common-only on-hand read with a read grouped by segment:
   - select `itemId`, `locationId`, `projectId` and the quantity;
   - map `projectId` to a segment with the same rule as `project_planning_segment` (load `project.id, projectStock` once);
   - sum into `onHand` keyed by `makeLocationItemKey(locationId, itemId, segmentId)`.
4. In `planCompany`:
   1. Add demand rows into `grossDemand` with `makeKey(location, period, item, segment)`. Project Material rows use contributor source type `"Project Material"` with `projectElementMaterialId`. Add that variant to `DemandContributor`.
   2. Add each open borrow twice: as `"Project Borrow"` demand in `borrowerSegmentId`, and as `"Project Borrow"` supply in `lenderSegmentId`. Both use the payback due date's period.
   3. Apply supersession (Phase 4.5) and forecast consumption to segment `''` only.
   4. Use lot-for-lot for any key with a segment other than `''`. Skip the reorder point and safety stock.

**Verify:**
```bash
pnpm --filter @carbon/planning test
# Expected: all tests pass; the plan-company snapshot is unchanged
```

**Out of scope:** the common surplus draw (Task 7).

---

## Task 7: Net segments and draw common surplus in `explodeBom`

**Depends on:** 4, 6
**Files:**
- Modify: `packages/database/src/mrp-engine.ts`
- Modify: `packages/database/src/mrp-engine.test.ts`
- Modify: `packages/planning/src/mrp/plan-company.ts`
- Modify: `packages/planning/src/mrp/plan-company.test.ts`

**Steps:**
1. Add 2 inputs to `BomExplosionInput`:
   - `commonSurplusItems: Set<string>`, the item ids with `allowCommonSupplyForProjects`;
   - `horizonPeriods: number`, the count of periods a surplus looks ahead.
2. Add `commonSurplusDraws: Map<string, number>` to `BomExplosionOutput`, keyed by `makeKey(location, period, item, segment)`.
3. In the level loop, process the location-item keys of one level in this order: segment `''` first, then the other segments sorted by id.
4. After the common key of an item is netted, compute `trueSurplusByPeriod` from its on-hand and its gross demand per period.
5. For each project segment of the same item and location:
   1. Net against the segment's own on-hand and job supply first.
   2. If the item is in `commonSurplusItems`, collect the remaining need per period.
   3. Call `allocateCommonSurplus` once for all segments of that item and location.
   4. Add each draw to `commonSurplusDraws`, and treat it as on-hand of the segment in its period before you explode the remainder.
6. Pass `commonSurplusDraws` out of `planCompany` in `PlanCompanyOutputs`.
7. Add tests to `mrp-engine.test.ts`:
   1. The spec case: P-101 has demand 20 and stock 5. Common has stock 8 and no demand. Expect a draw of 8 and a net requirement of 7 in P-101.
   2. With `allowCommonSupplyForProjects` off for the item, there is no draw, and the net requirement is 15.
   3. A Make item in a project segment explodes only its remainder after the draw.
8. Add a second fixture `plan-company.project.json` with the spec case. Snapshot it.

**Verify:**
```bash
pnpm --filter @carbon/database test -- mrp-engine && pnpm --filter @carbon/planning test -- plan-company
# Expected: all tests pass; the basic snapshot is unchanged, and the project snapshot is written
```

**Out of scope:** writing Transfer actions (Task 10).

---

## Task 8: Segment the actuals and the Phase 7 writes

**Depends on:** 7
**Files:**
- Modify: `packages/planning/src/mrp/plan-company.ts` (Phase 6 actuals; paging order at `mrp.ts` 991–994 and 1005–1008)
- Modify: `packages/planning/src/mrp/mrp.ts` (Phase 7, lines 1155–1275)
- Modify: `apps/erp/app/routes/x+/production+/planning.update.tsx` (lines 410–415)
- Modify: `apps/erp/app/routes/x+/purchasing+/planning.update.tsx` (lines 758–763)

**Steps:**
1. Write `planningSegmentId` on every row of `demandForecastUpserts`, `demandForecastSourceInserts`, `demandActualUpserts` and `supplyActualUpserts`, from the key's fourth part.
2. Add `"planningSegmentId"` to the 3 `onConflict` column lists (lines 1193, 1222, 1240).
3. Add `.order("planningSegmentId")` after each existing `.order(...)` in the actuals paging (lines 991–994, 1005–1008).
4. Write `consumptionUpdates` for segment `''` only.
5. In both `planning.update.tsx` files, add `planningSegmentId` to the `supplyForecast` upsert row and its conflict columns. Read the segment from the posted row; the default is `''`.

**Verify:**
```bash
pnpm --filter @carbon/planning test && pnpm exec turbo run typecheck --filter=erp --filter=@carbon/planning
# Expected: all tests pass; typecheck exits 0; the basic snapshot is unchanged
```

**Out of scope:** the planning actions (Task 10).

---

## Task 9: Segment the planning RPCs and grids

**Depends on:** 2
**Files:**
- Create: `packages/database/supabase/migrations/<timestamp>_planning-rpcs-segment.sql`
- Modify: `apps/erp/app/modules/production/production.service.ts`, `apps/erp/app/modules/purchasing/purchasing.service.ts` (the RPC callers)

**Steps:**
1. Redefine `get_production_planning` and `get_purchasing_planning` (latest in `20261006130001_demand-forecast-consumption.sql`). Also redefine their grid wrappers (`20261006205037…sql`).
   1. Add `"planningSegmentId"` to the RETURNS TABLE. This changes the signature, so `DROP FUNCTION` first.
   2. Return one row per (item, segment). Group demand, supply and actuals by `planningSegmentId`.
   3. Keep the on-hand source (`itemLedger`, lines 257–263 and 594–600). Group it by `project_planning_segment("projectId")`, which maps a null `projectId` to `''`.
   4. Order by `id` (the item id), then `planningSegmentId`, so every page has a total order.
2. Keep each function's `SECURITY` setting and its `assert_company_access` call.
3. Run `pnpm db:migrate`, then `pnpm run generate:types`.
4. In both services, add `.order("planningSegmentId")` after each `.order("id")` on these RPCs. Carry `planningSegmentId` in the row types.
5. Each grid row key becomes `id + KEY_SEP + planningSegmentId`. Find each key with `grep -rn "getRowId\|rowKey" apps/erp/app/modules/production/ui/Planning apps/erp/app/modules/purchasing/ui/Planning`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exit code 0
psql "$SUPABASE_DB_URL" -c "SELECT count(*) FROM get_purchasing_planning('<a dataset company id>', '<location id>', ...);"
# Expected: the same count as before the migration (fill the arguments from the function signature)
```

**Out of scope:** the Segment column (Task 13).

---

## Task 10: Generate segmented and Transfer planning actions

**Depends on:** 8, 9
**Files:**
- Modify: `packages/planning/src/mrp/planning-actions.ts` (`naturalKey` 717, `diffPlanningActions` 797, `writePlanningActionDiff` 946, `generatePlanningActions` 1084; `itemStockQuantities` read 1192–1196 and 1256–1264; RPC paging 1371–1380; existing actions 1597)
- Modify: `packages/planning/src/mrp/mrp.ts` (line 1282)
- Modify: `apps/erp/app/modules/production/planning-action-claims.ts` (lines 66–100)
- Modify: `apps/erp/app/modules/production/production.service.ts` (natural key copy near line 11007; `inPlanningWorklist` 10868–10875)
- Modify: `packages/planning/src/mrp/planning-actions.test.ts`, `planning-actions.write.test.ts`

**Steps:**
1. Add `planningSegmentId`, `fromProjectId` and `toProjectId` to `PlanningActionCandidate` and `ExistingPlanningAction`.
2. Add the segment to `naturalKey` after `locationId`, and `fromProjectId` and `toProjectId` (as `''` when null) at the end. Change the 2 raw copies (`planning-action-claims.ts`, `production.service.ts`) to call `naturalKey`, or to add the segment in the same position.
3. Read `itemStockQuantities` by segment (map `projectId` as in Task 6). Read the RPCs per (item, segment) with `.order("id").order("planningSegmentId")`.
4. Compute each segment's actions independently. Use lot-for-lot for segments other than `''`.
5. Add the parameter `commonSurplusDraws` to `generatePlanningActions`. `runMrp` passes `planCompany`'s output at line 1282.
   1. For each draw, emit a `Transfer` candidate with these values:
      - `planningSegmentId` = the project segment, `fromProjectId` = null (common) and `toProjectId` = the segment's project;
      - the draw's period, quantity, and `suggestedDate` = the period start;
      - `reason` = "Common stock not needed within the horizon".
   2. Treat the draw as on-hand of the project segment, so the segment's Order covers only the remainder.
6. Set `planningSegmentId` on every Order, Make and change action from its row.
7. Add `'Transfer'` and `'Borrow'` to `inPlanningWorklist`.
8. Add tests:
   1. `naturalKey` differs for the same item and week in segments `''` and `prj_1`, and for two Transfers that differ only in `fromProjectId`.
   2. The spec case gives 2 candidates: Transfer 8 and Order 7, both in segment `prj_1`.
   3. In `planning-actions.write.test.ts`, a second run with the same inputs writes no change.

**Verify:**
```bash
pnpm --filter @carbon/planning test
# Expected: all tests pass; the basic snapshot is unchanged
```

**Out of scope:** Borrow candidates (Phase 3, between members of a group).

---

## Task 11: Apply segmented Order, Make and Transfer actions

**Depends on:** 10
**Files:**
- Modify: `apps/erp/app/routes/x+/purchasing+/planning.update.tsx` (`order` at 127, `apply` at 1030)
- Modify: `apps/erp/app/routes/x+/production+/planning.update.tsx` (`order` at 106, `apply` at 660)
- Modify: `apps/erp/app/modules/production/ui/Planning/planned-orders-from-actions.ts`
- Modify: `apps/erp/app/modules/projects/projects.service.ts` — `createProjectStockTransferFromAction`

**Steps:**
1. **Order in a segment:** if the action's `planningSegmentId` is a project id, create the PO line with `projectId` = the segment. `projectElementId` stays null, so the receipt stripes the stock to the project (Phase 2a).
2. **Make in a segment:** create the job with `projectId` = the segment and `receiveToProjectStock = true`.
3. **Transfer:** call `createProjectStockTransferFromAction(client, { companyId, userId, action })`. It inserts a Draft `projectStockTransfer` with these values:
   - type `Transfer`, `fromProjectId` and `toProjectId` copied from the action;
   - the action's location and `planningActionId`;
   - reason = the action's `reason`;
   - one line with the item and quantity.

   Then set the action to `Actioned` with `projectStockTransferId`.
4. Keep the claim (`claimPlanningActions`) and release logic unchanged. Each new branch runs inside the existing claim.
5. A Transfer action is never applied in bulk with Orders. If a bulk apply includes one, create its transfer and report it in the flash message.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp && pnpm --filter erp test -- planning-action-writes
# Expected: typecheck exits 0; all tests pass
```

**Out of scope:** approving the transfer (the Phase 2a pages do it).

---

## Task 12: Add the project-manager rung and the company sweep

**Depends on:** 10
**Files:**
- Modify: `packages/planning/src/mrp/responsible-employee.ts`
- Modify: `packages/planning/src/mrp/responsible-employee.test.ts`
- Modify: `packages/jobs/src/inngest/functions/scheduled/mrp-companies.ts` (lines 121–160)

**Steps:**
1. For an action with a segment other than `''`, the resolver tries the segment project's manager (`project.ownerId`) first. Then it continues down the existing ladder.
2. Load the project managers once per run, with one `.in("id", segmentIds)` query.
3. Add a test: an action in segment `prj_1` whose project has a manager is assigned to that manager.
4. In `companiesWithPlanningWork`, add 2 existence checks to the same query:
   - a company with any `openProjectMaterialLines` row;
   - a company with any `projectBorrow` row in status `Open`.

**Verify:**
```bash
pnpm --filter @carbon/planning test -- responsible-employee && pnpm --filter @carbon/jobs test -- mrp-companies
# Expected: all tests pass
```

**Out of scope:** notifications to the project manager.

---

## Task 13: Add the Segment column to the planning worklists

**Depends on:** 10
**Files:**
- Modify: `apps/erp/app/modules/production/ui/Planning/ProductionPlanningTable.tsx`
- Modify: `apps/erp/app/modules/purchasing/ui/Planning/PurchasingPlanningTable.tsx`
- Modify: `apps/erp/app/modules/production/ui/Planning/PlanningActionLines.tsx`
- Modify: `apps/erp/app/modules/production/ui/Planning/usePlanningActions.ts`
- Modify: `apps/erp/app/routes/x+/production+/planning.tsx`, `apps/erp/app/routes/x+/purchasing+/planning.tsx` (loaders)

**Steps:**
1. Use the `carbon-design` skill.
2. Add a **Segment** column. Show "Common" for `''` and the project's identifier and name for a project id. Load the names once with `.in("id", segmentIds)` in the loader.
3. Add a **Segment** filter (Common, or a project).
4. Show a Transfer action with a transfer icon and the text "Transfer 8 from common stock". Its button is **Create transfer**, which posts `intent = apply`.
5. After apply, link the action's `projectStockTransferId` to `path.to.projectStockTransfer(id)`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exit code 0
```

**Out of scope:** a planning page per project.

---

## Task 14: Show borrow exceptions

**Depends on:** 10
**Files:**
- Modify: `apps/erp/app/modules/projects/ui/Stock/ProjectStock.tsx`
- Modify: `apps/erp/app/modules/projects/ui/Project/ProjectHeader.tsx`
- Modify: `apps/erp/app/routes/x+/project+/$projectId.tsx` (loader)
- Modify: `packages/planning/src/mrp/planning-actions.ts`

**Steps:**
1. In `generatePlanningActions`, MRP never emits a change action against a borrow. The Project Borrow supply and demand are firm.
2. In `ProjectHeader`, show an **Overdue borrows** badge when the project has an `Open` borrow with `paybackDueDate` before today in the company timezone. The `$projectId.tsx` loader counts them with one query. The badge links to the Stock tab, which lists item, quantity and due date.
3. In the planning worklist, show the same overdue borrows as a read-only row group **Overdue borrows** above the actions, filtered by the Segment filter.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exit code 0
```

**Out of scope:** automatic paybacks.

---

## Task 15: Update the rules, AGENTS.md, docs and spec

**Depends on:** 1–14
**Files:**
- Modify: `.claude/rules/mrp-system.md`, `.claude/rules/projects-system.md`
- Modify: `packages/planning/AGENTS.md`, `apps/erp/app/modules/production/AGENTS.md`, `apps/erp/app/modules/projects/AGENTS.md`
- Modify: `docs/content/docs/reference/projects.mdx`, and the MRP reference page
- Modify: `.ai/specs/2026-10-03-projects.md`

**Steps:**
1. Document these 5 points:
   1. the segment key and the `''` sentinel;
   2. `project_planning_segment`;
   3. the netting sequence and the true-surplus rule;
   4. the golden test and its rule (never edit the snapshot to pass);
   5. `planCompany` as the pure core of `runMrp`.
2. Remove the Phase 2a "common stock only" note from the MRP rule.
3. In the spec, record these 3 decisions:
   1. **Enum values:** `'Project Borrow'` is the source type for borrow demand and supply.
   2. **True surplus** counts on-hand only, not open or planned supply.
   3. **Planning RPCs:** they keep `itemLedger` as the on-hand source, grouped by segment.
4. Run the STE-80 review pass on every `.ai/` file you changed.

**Verify:**
```bash
cd docs && pnpm typecheck
# Expected: exit code 0
```

**Out of scope:** the changelog entry.

---

## Task 16: Verify in the browser

**Depends on:** 1–15
**Files:**
- Create: `.ai/playbooks/projects-phase-2b.md` (written by `/test`)

**Steps:**
1. Run `/test` on a satellite dataset company. Run MRP after each setup step.
2. Cover these spec acceptance criteria:
   1. **Segmented MRP:** P-101 has demand 20 and stock 5. Common stock has 8 left after common demand.
      - MRP emits Transfer 8 (common → P-101) and Order 7 in P-101's segment.
      - Applying the Order creates a PO line charged to P-101.
      - Applying the Transfer creates a Draft project stock transfer.
      - The common planning rows are unchanged.
   2. **Borrow in MRP:** post a Borrow of 5 from P-101 to P-102. MRP shows firm demand on P-102 and firm supply on P-101, both on the payback date.
   3. **Overdue borrows:** a borrow past its due date shows in the project header and in the worklist.
3. Save the playbook to `.ai/playbooks/projects-phase-2b.md`.

**Verify:**
```bash
ls .ai/playbooks/projects-phase-2b.md
# Expected: the file exists, and the /test run reports every step passed
```

**Out of scope:** planning groups (Phase 3).

## Execution notes

- Task 1: `planCompany` (`plan-company.ts`) holds Phases 3–6 and the pure map building of Phase 2. These are the replenishment and lead-time maps, the supersession maps, the on-hand map and the BOM map. Its inputs are the raw rows that Phase 1 loads, so the fixture is plain JSON. `activeMethodIdByItem` is shared, because `runMrp` needs the method ids to load the materials.
- Task 1 (deviation): `runMrp` reads the existing actuals before it calls `planCompany`, not inside Phase 6. The core is then pure. The read depends on nothing that Phases 3–5 compute, so the order changes no output. The BOM cycle warning moved after the call, and `planCompany` returns `cycleItemIds`. MRP never inserts `supplyForecast` rows, so the outputs have no `supplyForecast` array.
- Task 1: the fixture comes from the existing satellite company Carbon Development (`db47qcsgq0g02bpief00`), seeded before Phase 2a Task 19. No new seed was needed, so no company data was wiped. A temporary dump in `runMrp` wrote the inputs and threw before Phase 7, and was then removed. The fixture keeps only the columns `planCompany` reads. A one-off check gave equal outputs for the full dump and the trimmed fixture.
- Task 1: the fixture covers the 6 cases. It holds 4 Make items with a 2-level BOM, 25 Buy items, 7 open PO lines and 2 open jobs. It also holds 7 sales order lines, 28 demand projections and 1 effective Consume First supersession. The output holds 83 `demandForecast` rows, 391 `demandForecastSource` rows (8 redirected), 56 demand actuals, 9 supply actuals and 28 consumption updates. The planning suite passes (314), and `@carbon/planning` typechecks.
- Task 2: `20261010131214_projects-2b-enums.sql` and `20261010131217_mrp-planning-segment.sql` hold the plan's SQL as written. The real constraint names match the plan. `pnpm db:migrate` applied both and regenerated the types and swagger; `authz sync` changed nothing. 0 `planningAction` rows have a segment, and `@carbon/database` typechecks.
- Task 2 (deviation): `id-refs.ts` lists none of the 5 tables' key columns. But `planningSegmentId`, `fromProjectId`, `toProjectId`, `projectStockTransferId` and `projectBorrowId` hold row ids with no foreign key. The id-refs rule needs every such column, so `demandForecast` and `planningAction` gain entries. A backup carries both tables; the 4 other tables are transient and are not backed up.
- Task 2 (beyond the plan's file list): the ERP's hand-written `planningActionType` list (`production.models.ts`) gains `Transfer` and `Borrow`, or the `erp` typecheck fails. `PlanningActionLines` gives them an icon (`LuArrowLeftRight`, `LuHandCoins`), a label and a plain sentence ("Transfer 8 for Oct 4"). Task 13 replaces the sentence. The new strings wait for the run's final `/translate` pass. The commit carries the regenerated MCP digest. The workflow catalog check is clean.
- Task 2: `@carbon/jobs` fails to typecheck before and after this task, in `picked-consumption.ts` and `stock-stripes.ts` (Phase 2a). A separate `fix(projects)` commit after Task 2 fixes it.
- Task 3: `makeKey`, `makeLocationItemKey` and `makeActualKey` take the segment as their last part (default `COMMON_SEGMENT`, `''`), and the split helpers return it. `explodeBom` reads the segment from each key with `splitLocationItemKey`. The on-hand key, the period key, the child key and the Consume First successor key all carry the parent's segment. `DemandContributorBase` gains an optional `segmentId`, which no caller sets yet.
- Task 3: the 3 existing key tests in `mrp-engine.test.ts` now expect the extra `''` part, because the split helpers return one more element. The 2 new tests pass: the round trip, and a parent in `prj_1` that explodes into `prj_1` only and ignores common on-hand. The database suite passes (416) and the planning suite passes (314) with the golden snapshot unchanged. `@carbon/database`, `@carbon/planning`, `@carbon/server-functions` and `@carbon/jobs` typecheck.
- Task 4 (deviation): a draw in `allocateCommonSurplus` lowers the surplus of its own period and of every LATER period by the amount taken. An earlier period keeps at most what the draw period has left. Step 2 says "that period and every earlier period". But the draw leaves common stock from its period on. Test case 3 needs a later need to see less: 5 for week 1, then 1 for week 2. The rule is exact: it equals `trueSurplusByPeriod` recomputed with the draw taken out of on-hand at its period.
- Task 4: `mrp-netting-sequence.ts` is exported as `@carbon/database/mrp-netting-sequence`. Its 5 tests failed before the module existed and pass now. The database suite passes (421, with `SUPABASE_DB_URL` exported), and `@carbon/database` typechecks.
- Task 5: `20261010133214_mrp-segment-views.sql` recreates the 4 open views from their newest definitions with `planningSegmentId` as the last column, so `CREATE OR REPLACE` keeps every column and filter. All 6 views run `WITH (security_invoker = true)`.
- Task 5: `openPurchaseOrderLines` leaves out a line that the receipt consumes to its project. The condition mirrors `consumedByProject` in `post-receipt/index.ts`: not outside processing, an inventory item, a project without project stock, and `project_cost_treatment(…, company_today(companyId))` not Statistical. `IS DISTINCT FROM` keeps a NULL treatment from hiding the line.
- Task 5 (deviation): the `projectState` join also matches on `companyId`, because its primary key is `("id", "companyId")`. `openProjectBorrows` also carries `borrowerProjectId`, `lenderProjectId` and `id`.
- Task 5: on Carbon Development the 4 views give the same row counts and sums before and after, and 0 rows have a segment. The counts are sales 7, job materials 101, production 2 and PO lines 7. A rolled-back smoke test proved the 4 rules:
  1. a consumed PO line leaves the view;
  2. a stocked line carries the project segment;
  3. a receive-to-project-stock job carries the project segment;
  4. a consume-to-project job leaves `openProductionOrders`.
- Task 6: `runMrp` reads `openProjectMaterialLines` and `openProjectBorrows` with `fetchAll` (`.order("id")`), every stripe of `itemStockQuantities`, and the ids of the company's projects with project stock. `planCompany` maps each stripe to a segment with the new `planningSegmentOf` (the rule of `project_planning_segment`) and sums per key. The new inputs are optional, so the basic fixture loads unchanged.
- Task 6: Project Material and Project Borrow demand write `demandActual` rows of those source types. The lender's borrow supply writes a `Project Borrow` `supplyActual` row and enters the explosion's supply map. A material with no required date, or a borrow with no due date, falls in the current week.
- Task 6 (deviation): a Project Material contributor writes no `demandForecastSource` row. The table has no plan-line material column, and its `demandForecastSource_source_check` refuses the new source type. A borrow has no lineage source type, so it gets no contributor. Follow-up: a lineage column for plan-line materials, with the item planning chart's source list.
- Task 6: Phase 4.5 and forecast consumption already key on segment `''` only, and a project job material now consumes no forecast. Task 7 limits the BOM-level supersession to segment `''` too (see below). `planCompany` applies no reorder point or safety stock to any key, so lot-for-lot needs no change here; Task 10 applies it in the planning actions.
- Task 6: until Task 8 writes `planningSegmentId` on the actual rows, a company with project stock can write two actual rows with one key. The 2 tasks ship together.
- Task 7: `explodeBom` nets the common keys of a level first. Then it takes the project segments of each location and item in segment id order. A dry run gives each segment's need per period after its own on-hand and supply. One `allocateCommonSurplus` call per location and item draws from `trueSurplusByPeriod` of the common on-hand and the common gross demand. A second walk adds each draw as on-hand in its period and explodes the remainder.
- Task 7 (deviation): the input is `commonSurplusBlocked`, the location-item keys whose `itemPlanning.allowCommonSupplyForProjects` is false, not `commonSurplusItems`. The flag is per item and location, and an item with no `itemPlanning` row allows the draw (column default true). An allow-list would need every item at every location. `runMrp` reads the blocked rows with one query.
- Task 7 (deviation): supersession applies to segment `''` only (spec decision 24). The Consume First redirect in `explodeBom` runs for common keys only. Project segments explode through `segmentBomByItem`, a copy of the BOM taken before the swap. Its edges level too. `planCompany` builds the copy only when an effective supersession exists and a project segment has demand. So a company with no project stock levels as before.
- Task 7: `horizonPeriods` limits how far a true surplus looks ahead (`surplusWithinHorizon`). `planCompany` passes the whole MRP window. `planCompany` returns `commonSurplusDraws` as rows (`itemId`, `locationId`, `periodId`, `planningSegmentId`, `quantity`) for Task 10.
- Task 7: the Task 3 test "explodes a parent's demand in segment prj_1 into prj_1 only" now blocks the draw. Its point is that common on-hand does not net the segment. By default the segment would draw that stock. 4 new engine tests pass:
  1. the spec case (draw 8, remainder 7);
  2. the blocked item (15);
  3. a Make item that explodes only its remainder after a draw of 5;
  4. the horizon.

  The new `plan-company.project.json` holds the spec case (common on-hand 10, common demand 2, P-101 demand 20 and stock 5). Its snapshot is written and the basic snapshot is unchanged. The database suite passes (425), the planning suite passes (315), and `@carbon/planning`, `@carbon/server-functions` and `@carbon/jobs` typecheck.
- Task 8 (deviation): a row in a project segment carries `planningSegmentId`. A common row leaves the column out (`segmentColumn`), so Postgres writes the default `''`. Kysely sends `default` for a column that one row of a batch lacks. Writing `''` on every row would change the basic snapshot, which pins the rows of a company with no project stock.
- Task 8: the `demandForecast` map key, the lineage rows and both zeroing passes carry the segment, and `runMrp` reads `planningSegmentId` with the existing actuals. The 3 Phase 7 `onConflict` lists and both actuals reads (`.order("planningSegmentId")`) gain the segment. `consumptionUpdates` come from projections only, which are common, so they needed no change.
- Task 8: both `planning.update.tsx` routes read `planningSegmentId` from the posted item row (default `''`). It reaches the `supplyForecast` row, its dedupe key (now joined on `\u001f`, not `-`) and the conflict columns.
- Task 8: a new test writes 2 `Job Material` actuals for one item, location and week, one per segment. The planning suite passes (316). The basic snapshot is unchanged; the project snapshot gains `planningSegmentId` on its project row. `erp` and `@carbon/planning` typecheck. A real `runMrp` on Carbon Development wrote the same totals as before and 0 segmented rows. The totals are 83 `demandForecast`, 56 `demandActual`, 9 `supplyActual` and 84 open actions, with equal sums.
- Task 9: `20261010135634_planning-rpcs-segment.sql` drops and creates `get_production_planning`, `get_purchasing_planning` and both grid wrappers, each with `planningSegmentId` as its second column. A script built the SQL from the newest bodies (`20261006130001`, `20261006205037`) with exact text replacements, so every other line is unchanged. The SECURITY settings, `search_path` and both `assert_company_access` guards stay.
- Task 9: demand, supply and actuals group by segment, and projections are common demand. On-hand stays the `itemLedger` sum, grouped by `project_planning_segment("projectId")` (a `CASE` skips the project lookup for a null `projectId`). The common row keeps every rule it had. A project segment gets a row when it has demand at the location. Its reorder point, Stock Only reserve and supersession do not apply, and its `quantityToOrder` is lot-for-lot (`GREATEST(0, -MIN(projection))`). The rows are ordered by `id`, then `planningSegmentId`. The wrappers read the planning actions of the row's own segment.
- Task 9: Carbon Development has no project stock. For both locations, the 2 base RPCs and the 2 wrappers (also with an Actions filter) gave the same rows before and after. The row counts (6, 1, 20 and 7) and the md5 over every row without `planningSegmentId` are equal. A rolled-back smoke test set project stock of 5 and project demand of 20. It gave a second row in the project segment, with on-hand 5 and `quantityToOrder` 15. The common row lost the project stock from its on-hand.
- Task 9 (deviation): the services have no `.order("id")` on the grid RPCs. They sort with `setGenericQueryFilters`, so `.order("planningSegmentId")` follows it as the last tiebreaker. The grids have no `getRowId`, so TanStack keys rows by index, and 2 rows of one item are already distinct. Adding a `getRowId` would change when the selection clears. The item-keyed maps in the grids (`ordersMap`, actions by item) are left for Task 13. The row types gain `planningSegmentId` from the generated RPC types.
- Task 9: `erp`, `@carbon/planning` and `@carbon/jobs` typecheck. The ERP planning tests pass (119), and the planning suite passes (316). The commit carries the regenerated MCP digest: the 2 planning reads' response schemas gain the column. The `tracked-entity-readable-id` invariant fails on 25 existing rows of this database before and after this task; the definer and view invariants pass.
- Tasks 5–9: every commit ran with `CARBON_SKIP_BACKUP_CHECK=1`. The backup check fails only on `supplierPartPrice.unitPrice`, which `main` changed after this branch was cut (see the run log).
- Task 10 (deviation): the per-row closure of `generatePlanningActions` is now the pure, exported `deriveRowActions`, so the spec case has a unit test. The orchestrator only loads the rows and keys the maps by item, location and segment (`itemLocationSegmentKey`).
- Task 10: a project segment is lot-for-lot. `deriveRowActions` sizes it with `computePlanningOrders` as Demand-Based Reorder with a 1-week window and no safety stock, order limits or lot size. The action's policy name is "Lot-for-Lot". The policy floor is 0, and the Stock Only reserve applies to segment `''` only.
- Task 10: a draw adds to the segment's projection from its period on. The coverage walk of the change actions adds the whole draw to the segment's on-hand. A draw for an item and segment that has no planning RPC row gets no Transfer.
- Task 10 (deviation): the common segment's projection does not subtract the draws. A true surplus never makes the common segment short, and the plan keeps the common planning rows unchanged. Only a common reorder point can see the drawn stock; the next run after the transfer posts sees it.
- Task 10: `loadSegmentOnHand` replaces `loadCommonOnHand`. It reads every stripe and the projects with project stock, and sums each stripe into its segment with `planningSegmentOf`.
- Task 10 (beyond the plan's steps): `getPlanningActions` and `inPlanningWorklist` list Transfer and Borrow on both worklists. Each page reads the actions of its own items only, so an action shows on its item's page. `settleNewSupplyPlanningActions` matches the segment of each ordered pair (default `''`); Task 11 sends it.
- Task 10: two `runMrp` runs on Carbon Development, before and after, wrote no insert, update or delete. The existing common actions keep matching with the new natural key. The planning suite passes (321) with the golden snapshot unchanged. `@carbon/planning`, `erp` and `@carbon/jobs` typecheck, and the ERP planning tests pass (31).
- Task 11: an Order or Make action is not applied; the grid's Order or Make button places it through the `order` intent. So both `order` cases read the row's `planningSegmentId`, which both grids and both drawers send. Each case checks that it names a project of the company with project stock. A purchasing segment order writes `projectId` on the new PO line, and adds to an existing line only when the line has the same project. A production segment order creates the job with `projectId` and `receiveToProjectStock = true`. `settleNewSupplyPlanningActions` settles the segment's action.
- Task 11 (deviation): the Transfer apply is set-based and lives in `projects.server.ts`, not `projects.service.ts`, because a `*.service.ts` function becomes an MCP tool. `createProjectStockTransfersFromActions(db, …)` runs one transaction:
  1. the claim (`claimPlanningActions`);
  2. one statement for the readable ids (`get_next_sequence('projectStockTransfer', …)` over `generate_series`);
  3. one insert of the Draft headers (type `Transfer`, owners, location, reason, `planningActionId`);
  4. one insert of the lines;
  5. one UPDATE that sets `projectStockTransferId` on the actions.

  `applyTransferPlanningActions` wraps it for both routes and requires `update: projects`, the permission of the transfer pages.
- Task 11: both `apply` cases take the Transfer actions out of the batch before the change actions. The response carries `transfers`, and the flash message counts the Draft transfers it created. `planned-orders-from-actions.ts` needed no change: Task 13 keys each row's actions by item and segment upstream.
- Task 11: a new test (`transfer-planning-actions.test.ts`) pins the transfer statements and the claim lock. A rolled-back call proved that one statement draws distinct readable ids (`PST000001`, `PST000002`, `PST000003`). `erp` typechecks, and the ERP suite passes (2,065).
- Task 12 (deviation): the resolver loads the segment managers with one read of the company's projects with project stock and an owner, not with `.in("id", segmentIds)`. The resolver loads before the planning rows, so the segment ids are not known yet. The set is the same: a project with project stock is its own segment. The resolver takes the segment as an optional third argument, and `generatePlanningActions` passes the row's segment.
- Task 12: `companiesWithPlanningWork` adds `openProjectMaterialLines` and the `Open` rows of `projectBorrow` to its UNION. The pure resolver test, a loader test that reads the manager by segment, and a sweep test pass. The planning suite passes (324), `@carbon/jobs` passes (934), and both packages typecheck.
- Task 13: both grids key a row's actions and its draft orders by item and segment (`planningRowKey`). `usePlanningActions` returns `actionsByRowKey`, `fencedActionsByRowKey` and `visibleActionsByRowKey`, and `ordersMap` and `ordersByRowKey` use the same key. The time fence stays per item, so a fence change drops the drafts of every segment row of the item. The drawer link (`?item=`) still names the item only; it opens the item's first row.
- Task 13: the shared `segment` column (`planningColumns`) shows "Common" in muted text, or the project's identifier and name. It shows by default only when the company has a project with project stock. Its static filter writes `planningSegment` with `common` or a project id. `resolvePlanningSegmentScope` strips it in both loaders. The services filter the grid RPC with `planningSegmentFilter`: `eq.""` for Common and `in.(…)` for projects. An `in` list cannot hold the empty string. A live call proved that a repeated `or` parameter is ANDed with the search `or`.
- Task 13 (deviation): the loaders read the names with one query of the company's Standard projects with project stock, not `.in("id", segmentIds)`. The same list fills the filter, which must also offer projects that are not on the page.
- Task 13: a Transfer line reads "Transfer 8 from common stock" and its button is **Create transfer** (`onApply`). The applied action leaves the worklist, so the toast links each created transfer to `path.to.projectStockTransfer(id)`. The new strings wait for the run's final `/translate` pass.
- Task 13: the helper tests pass (16), the ERP suite passes (2,069), and `erp` typechecks. The commit carries the regenerated MCP digest: both planning reads gain `segments`. Browser verification waits for Task 16.
- Task 14: MRP already emits no change action against a borrow, because a borrow is never one of a row's open orders. `deriveRowActions` now says so in its comment.
- Task 14: `getProjectBorrows` gains the `locationId` and `dueBefore` filters. The `$projectId.tsx` loader reads the project's Open borrows due before today on the company's calendar, owed or lent, with that one query. `ProjectHeader` shows a red **Overdue borrows: N** badge that links to the Stock tab.
- Task 14 (deviation): `ProjectStock.tsx` needed no change. Since Phase 2a its borrow tables list the item, the quantity still owed and the payback due date, with an overdue date in red.
- Task 14: both planning loaders read the Open borrows at the location due before the location's today. A borrow passes the Segment filter when its borrower or its lender is a selected segment. `PlanningOverdueBorrows` shows them as a read-only group above the grid: item, quantity owed, borrower and lender, and the due date in red. The item links to the borrower's Stock tab, where the Payback starts. `erp` typechecks, and the planning suite passes (324).
- Task 15: the MRP rule gains a *Project netting segments* section and loses the Phase 2a "common stock only" note. The section covers the segment key and the `''` sentinel, `project_planning_segment`, the netting sequence, the true surplus, the golden test and `planCompany`. The projects rule, the 3 AGENTS.md files, `planning.mdx` and `projects.mdx` describe Phase 2b. The spec records decisions 18a–18d and marks Phase 2b implemented. `docs` typechecks, and the STE-80 check gives `long: 0` for this plan and the spec.
- Task 15 (deviation): the planning page does not tell the reader how to block a draw. No field in the app sets `itemPlanning.allowCommonSupplyForProjects`, so only the Mechanics block names the column. Follow-up: a field on the item's planning tab.
- Task 16: Browser verification deferred (overnight run).

