# MRP Planning Actions (Phase 1) — implementation plan

**Spec:** .ai/specs/2026-08-22-mrp-v2-planned-order-generation.md (§P1 — Phase 1)
**Research:** .ai/research/mrp-planning-actions.md
**Run record:** .ai/runs/2026-09-08-mrp-planning-actions.md
**Branch:** mrp-action-suggestions

Scope = **Phase 1 only**: emit and persist assignable, dismissible planning actions
(`Order | Make | Expedite | Defer | Cancel | Increase | Decrease`) on a focused
`planningAction` table, routed to a responsible buyer/planner via an inheritance ladder,
worked from the two existing planning pages. **Everything in Phases 2+ of the spec
(plannedOrder cascade + Planned→Firm→Released lifecycle, pegging, continuous regen,
rough-cut capacity, what-if/CTP, programmable release, §9 calm-by-default) is OUT OF
SCOPE.** If a task seems to require any of those, STOP and report — do not build them.

## Progress
- [ ] Task 1: Migration — `planningAction` table, enums, ladder columns, tolerance, RLS
- [ ] Task 2: `pnpm run generate:types`
- [ ] Task 3: Shared pure reorder-sizing module (port `calculateOrders`) + parity test
- [ ] Task 4: Zod models + derived types for `planningAction`
- [ ] Task 5: `responsibleEmployee` ladder resolver (pure fn + bulk query)
- [ ] Task 6: `generatePlanningActions` engine step (diff-write) + wire into `runMrp`
- [ ] Task 7: Read + mutation services (`getPlanningActions`, dismiss, assign, mark-actioned)
- [ ] Task 8: Apply-action route handling (extend `planning.update` + commitment gate)
- [ ] Task 9: `responsibleEmployee` field on the item Planning tab (all 4 item types)
- [ ] Task 10: Ownership settings screen (clone printer `AssignmentsCard`)
- [ ] Task 11: Worklist columns + "my actions" filter + bulk apply/assign/dismiss on both planning pages
- [ ] Task 12: Browser verification via /test (satellite dataset)

## Dependencies
- Task 2 needs Task 1. Tasks 3, 4, 5 need Task 2 (types). Task 6 needs 3+4+5.
  Task 7 needs 4. Task 8 needs 4+7. Tasks 9 and 10 need 1+2 (independent of each other).
  Task 11 needs 6+7+8. Task 12 needs everything.
- Tasks 3, 4, 5 are independent of each other and may run in parallel after Task 2.
- Tasks 9 and 10 are independent and may run in parallel after Task 2.

---

## Task 1: Migration — `planningAction` table, enums, ladder columns, tolerance, RLS

**Depends on:** none
**Files:**
- Create: `packages/database/supabase/migrations/{generated}_mrp-planning-actions.sql`
- Copy from (precedent): `packages/database/supabase/migrations/20260820215433_sso-connection.sql` (idempotent `CREATE TYPE` guard + composite-PK table + full four-policy RLS); `packages/database/supabase/migrations/20260120171236_process-active-column.sql` (ALTER ADD COLUMN pattern)

**Steps:**
1. Create the file: `pnpm db:migrate:new mrp-planning-actions` (never hand-pick the timestamp; never `000000` HHMMSS).
2. Create the two enums idempotently (per the sso precedent's `DO $$ ... EXCEPTION WHEN duplicate_object THEN NULL; END $$;` guard):
   ```sql
   DO $$ BEGIN
     CREATE TYPE "planningActionType" AS ENUM
       ('Order', 'Make', 'Expedite', 'Defer', 'Cancel', 'Increase', 'Decrease');
   EXCEPTION WHEN duplicate_object THEN NULL; END $$;
   DO $$ BEGIN
     CREATE TYPE "planningActionStatus" AS ENUM ('Open', 'Dismissed', 'Actioned');
   EXCEPTION WHEN duplicate_object THEN NULL; END $$;
   ```
3. Create the table exactly as spec §P1.2 specifies (bare `NUMERIC`, no precision spec; audit columns; composite PK). Use `CREATE TABLE IF NOT EXISTS`:
   ```sql
   CREATE TABLE IF NOT EXISTS "planningAction" (
       "id" TEXT NOT NULL DEFAULT id('pla'),
       "companyId" TEXT NOT NULL,
       "itemId" TEXT NOT NULL,
       "locationId" TEXT NOT NULL,
       "periodId" TEXT NOT NULL,
       "type" "planningActionType" NOT NULL,
       "status" "planningActionStatus" NOT NULL DEFAULT 'Open',
       "suggestedQuantity" NUMERIC NOT NULL,
       "suggestedDate" DATE NOT NULL,
       "isASAP" BOOLEAN NOT NULL DEFAULT false,
       "purchaseOrderLineId" TEXT,
       "jobId" TEXT,
       "requiresManualAction" BOOLEAN NOT NULL DEFAULT false,
       "supplierId" TEXT,
       "policyName" TEXT,
       "reason" TEXT,
       "triggerValues" JSONB,
       "assignee" TEXT REFERENCES "user"("id"),
       "assigneeOverridden" BOOLEAN NOT NULL DEFAULT false,
       "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
       "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
       "updatedBy" TEXT REFERENCES "user"("id"),
       "updatedAt" TIMESTAMP WITH TIME ZONE,
       PRIMARY KEY ("id", "companyId"),
       FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE,
       CONSTRAINT "planningAction_change_target_chk" CHECK (
         ("type" IN ('Order','Make') AND "purchaseOrderLineId" IS NULL AND "jobId" IS NULL)
         OR ("type" NOT IN ('Order','Make') AND (("purchaseOrderLineId" IS NOT NULL)::int + ("jobId" IS NOT NULL)::int) = 1)
       )
   );
   ```
4. Indexes (companyId, assignee, item+loc, status) and the partial-unique natural key, exactly as spec §P1.2:
   ```sql
   CREATE INDEX IF NOT EXISTS "planningAction_companyId_idx" ON "planningAction" ("companyId");
   CREATE INDEX IF NOT EXISTS "planningAction_assignee_idx"  ON "planningAction" ("companyId", "assignee");
   CREATE INDEX IF NOT EXISTS "planningAction_item_loc_idx"  ON "planningAction" ("companyId", "itemId", "locationId");
   CREATE INDEX IF NOT EXISTS "planningAction_status_idx"    ON "planningAction" ("companyId", "status");
   CREATE INDEX IF NOT EXISTS "planningAction_createdBy_idx" ON "planningAction" ("createdBy");
   CREATE UNIQUE INDEX IF NOT EXISTS "planningAction_natural_key_idx" ON "planningAction"
     ("companyId", "itemId", "locationId", "type", "periodId",
      COALESCE("purchaseOrderLineId", "jobId", ''))
     WHERE "status" <> 'Actioned';
   ```
5. RLS: enable + four policies. SELECT = any employee; writes = purchasing OR production update (a buyer or planner may dismiss/assign/apply). The engine writes as service-role and bypasses RLS.
   ```sql
   ALTER TABLE "public"."planningAction" ENABLE ROW LEVEL SECURITY;
   CREATE POLICY "SELECT" ON "public"."planningAction" FOR SELECT USING (
     "companyId" = ANY ((SELECT get_companies_with_employee_role())::text[])
   );
   CREATE POLICY "INSERT" ON "public"."planningAction" FOR INSERT WITH CHECK (
     "companyId" = ANY ((SELECT get_companies_with_employee_permission('purchasing_update'))::text[])
     OR "companyId" = ANY ((SELECT get_companies_with_employee_permission('production_update'))::text[])
   );
   CREATE POLICY "UPDATE" ON "public"."planningAction" FOR UPDATE USING (
     "companyId" = ANY ((SELECT get_companies_with_employee_permission('purchasing_update'))::text[])
     OR "companyId" = ANY ((SELECT get_companies_with_employee_permission('production_update'))::text[])
   );
   CREATE POLICY "DELETE" ON "public"."planningAction" FOR DELETE USING (
     "companyId" = ANY ((SELECT get_companies_with_employee_permission('purchasing_update'))::text[])
     OR "companyId" = ANY ((SELECT get_companies_with_employee_permission('production_update'))::text[])
   );
   ```
6. Ladder columns + tolerance (idempotent `ADD COLUMN IF NOT EXISTS`). **No view recreation is required** — verified: no `SELECT *` view selects from `location`/`itemPlanning` (they appear only in RPC functions selecting explicit columns). Note the item-group tier is a TABLE (step 6b), not a column on `itemPostingGroup`.
   ```sql
   ALTER TABLE "itemPlanning"    ADD COLUMN IF NOT EXISTS "responsibleEmployee" TEXT REFERENCES "user"("id");
   ALTER TABLE "location"        ADD COLUMN IF NOT EXISTS "responsibleEmployee" TEXT REFERENCES "user"("id");
   ALTER TABLE "companySettings" ADD COLUMN IF NOT EXISTS "defaultResponsibleEmployee" TEXT REFERENCES "user"("id");
   ALTER TABLE "companySettings" ADD COLUMN IF NOT EXISTS "rescheduleToleranceDays" INTEGER NOT NULL DEFAULT 7
     CHECK ("rescheduleToleranceDays" >= 0);
   ```
   The tolerance comparison is **strictly greater than** everywhere (`gap > rescheduleToleranceDays` fires; `≤` is suppressed) — engine, tests, and acceptance all use the same `>`.
6b. **Location-specific item-group ownership table** (the "location → item group" tier — the same group can have a different owner per location, so it is NOT a column on `itemPostingGroup`). **Composite-FK prerequisites (verified 2026-09-11):** `location` already has `UNIQUE ("id","companyId")` (`location_id_companyId_key`, added by `20260905132037_job-operation-batching.sql:159`), but **`itemPostingGroup`'s PK is `("id")` alone** (`20230330024716_parts.sql:69`) with no `("id","companyId")` unique — the composite FK below FAILS without one. Add it first, idempotently:
   ```sql
   DO $$ BEGIN
     ALTER TABLE "itemPostingGroup"
       ADD CONSTRAINT "itemPostingGroup_id_companyId_key" UNIQUE ("id", "companyId");
   EXCEPTION WHEN duplicate_table THEN NULL; WHEN duplicate_object THEN NULL; END $$;
   ```
   Then:
   ```sql
   CREATE TABLE IF NOT EXISTS "itemPostingGroupResponsibility" (
       "id" TEXT NOT NULL DEFAULT id('pgr'),
       "companyId" TEXT NOT NULL,
       "locationId" TEXT NOT NULL,
       "itemPostingGroupId" TEXT NOT NULL,
       "responsibleEmployee" TEXT REFERENCES "user"("id"),
       "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
       "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
       "updatedBy" TEXT REFERENCES "user"("id"),
       "updatedAt" TIMESTAMP WITH TIME ZONE,
       PRIMARY KEY ("id", "companyId"),
       FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE,
       CONSTRAINT "itemPostingGroupResponsibility_location_fkey"
         FOREIGN KEY ("locationId", "companyId") REFERENCES "location"("id", "companyId") ON DELETE CASCADE,
       CONSTRAINT "itemPostingGroupResponsibility_group_fkey"
         FOREIGN KEY ("itemPostingGroupId", "companyId") REFERENCES "itemPostingGroup"("id", "companyId") ON DELETE CASCADE,
       CONSTRAINT "itemPostingGroupResponsibility_unique" UNIQUE ("companyId", "locationId", "itemPostingGroupId")
   );
   CREATE INDEX IF NOT EXISTS "itemPostingGroupResponsibility_companyId_idx" ON "itemPostingGroupResponsibility" ("companyId");
   CREATE INDEX IF NOT EXISTS "itemPostingGroupResponsibility_createdBy_idx" ON "itemPostingGroupResponsibility" ("createdBy");
   ```
   Then **explicitly enable RLS** — policies are inert without it — and add the four policies (SELECT via `get_companies_with_employee_role()`; INSERT/UPDATE/DELETE via `get_companies_with_employee_permission('settings_update')`), same form as the `planningAction` block above:
   ```sql
   ALTER TABLE "public"."itemPostingGroupResponsibility" ENABLE ROW LEVEL SECURITY;
   ```
   Include a cross-company access test in the browser-verification pass (a user of company A must not read/write company B's responsibility rows).
7. Apply locally: `pnpm db:migrate`.

**Verify:**
```bash
pnpm db:migrate
# Expected: migration applies cleanly, no errors; regenerates types + swagger.
```
If `pnpm db:migrate` fails because the local stack/DB is not up, STOP and report — do not hand-edit the DB or skip the migration.

**Out of scope:** the Phase-2 `plannedOrder`/`plannedOrderPeg`/`planningRun`/`planningState` tables, the `planningTimeFenceDays` columns, and any `companySettings` automation columns — do NOT create them.

---

## Task 2: Regenerate DB types

**Depends on:** Task 1
**Files:**
- Modify: `packages/database/src/types.ts` (generated — never hand-edit)

**Steps:**
1. Run `pnpm run generate:types`.
2. Commit the regenerated `types.ts` (types regen is normal — do not use casts to avoid it).

**Verify:**
```bash
pnpm run generate:types && grep -c "planningAction" packages/database/src/types.ts
# Expected: generate:types exits 0; grep count > 0 (the table + enums are present).
```

**Out of scope:** editing generated types by hand.

---

## Task 3: Shared pure reorder-sizing module + parity test

**Depends on:** Task 2
**Files:**
- Create: `packages/utils/src/planning-sizing.ts` — pure `computePlanningOrders(input): PlanningOrder[]`
- Create: `packages/utils/src/planning-sizing.test.ts`
- Modify: `packages/utils/src/index.ts` — export the new module
- Modify: `apps/erp/app/modules/items/ui/Item/ItemReorderPolicy.tsx` — refactor `calculateOrders` to delegate to the shared fn
- Copy from (precedent): the branch logic in `apps/erp/app/modules/items/ui/Item/ItemReorderPolicy.tsx:108-490` (`calculateOrders`) and the SQL `calculate_quantity_to_order` in `packages/database/supabase/migrations/20260324120000_planning-quantity-to-order.sql`

**Steps:**
1. Port `calculateOrders` (the four policy branches — `Manual Reorder`→[], `Demand-Based Reorder`, `Fixed Reorder Quantity`, `Maximum Quantity` — plus min/max OQ, `orderMultiple`, `lotSize`, lot-size splitting, ASAP detection) into a **pure, dependency-free** function in `@carbon/utils`. It must NOT import React or any app code. Signature:
   ```ts
   export function computePlanningOrders(input: {
     reorderingPolicy: string;
     periods: { id: string; startDate: string }[];
     projections: number[];              // per-period projected on-hand (week1..weekN), same order as periods
     params: {
       reorderPoint: number; reorderQuantity: number;
       minimumOrderQuantity: number; maximumOrderQuantity: number;
       orderMultiple: number; lotSize: number;
       maximumInventoryQuantity: number;
       demandAccumulationPeriod: number; demandAccumulationSafetyStock: number;
       leadTime: number;
     };
   }): {
     periodId: string; startDate: string; dueDate: string; quantity: number;
     isASAP: boolean; policyName: string;
     triggerValues: { projectedStock?: number; safetyStock?: number; reorderPoint?: number; reorderQuantity?: number; lotSize?: number; leadTime?: number };
   }[]
   ```
   Use `@internationalized/date` + `@carbon/utils` `formatDate` helpers for all date math — never JS `Date`. Use the numeric-precision helpers (`round(x, 0, Up)` for whole-unit ceils) — no raw `Math.ceil`/`toFixed` on value-bearing numbers (the `no-raw-rounding` check).
2. Refactor the client `calculateOrders` in `ItemReorderPolicy.tsx` to call `computePlanningOrders` (keep the supersession "Stock Only" branch and the client-side `ordersCache` where they are; only the four-policy math moves). The client output shape (which includes `dueDate`/`startDate`) must be preserved.
3. Write `planning-sizing.test.ts` with: (a) one fixture per policy asserting the exact orders, and (b) a **parity block** — for a fixture matrix of inputs, assert `computePlanningOrders(...)` total per item equals the SQL `calculate_quantity_to_order` result computed by hand from the same inputs (encode the expected SQL scalar as literals in the test; do not call the DB).

**Verify:**
```bash
pnpm --filter @carbon/utils test
pnpm exec turbo run typecheck --filter=@carbon/utils --filter=erp
# Expected: sizing tests pass (per-policy + parity); both packages typecheck clean.
```
If the ported math diverges from `calculateOrders` in any policy branch (parity fails), STOP and report — do not "adjust" the numbers to make the test pass.

**Out of scope:** Period-of-Supply (POQ) — a Phase-2 fifth policy; do NOT add it. Changing the SQL `calculate_quantity_to_order`.

---

## Task 4: Zod models + derived types for `planningAction`

**Depends on:** Task 2
**Files:**
- Modify: `apps/erp/app/modules/production/production.models.ts` — add `planningActionType`/`planningActionStatus` string-tuple constants + `planningActionValidator` (for mutations) and any filter enums
- Modify: `apps/erp/app/modules/production/types.ts` — derived `PlanningAction` type
- Copy from (precedent): `apps/erp/app/modules/purchasing/purchasing.models.ts` (validator style, `zfd` usage) and the enum-tuple pattern used for `purchaseOrderStatusType`

**Steps:**
1. Add exported string tuples mirroring the DB enums:
   ```ts
   export const planningActionType = ["Order","Make","Expedite","Defer","Cancel","Increase","Decrease"] as const;
   export const planningActionStatus = ["Open","Dismissed","Actioned"] as const;
   ```
2. Add `planningActionDismissValidator` / `planningActionAssignValidator` (fields: `id`, and for assign `assignee`) using `zfd`. (Apply-action reuses the existing planning.update payload — see Task 8 — so no new validator for apply.)
3. Add the derived read type `PlanningAction` in `production/types.ts` as `NonNullable<Awaited<ReturnType<typeof getPlanningActions>>["data"]>[number]` (wire once Task 7 exists).

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: clean typecheck.
```

**Out of scope:** models for any Phase-2 entity.

---

## Task 5: `responsibleEmployee` ladder resolver

**Depends on:** Task 2
**Files:**
- Create: `packages/ee/src/planning/mrp/responsible-employee.ts` — pure resolver + a bulk-load query helper
- Create: `packages/ee/src/planning/mrp/responsible-employee.test.ts`
- Modify: `packages/ee/src/planning/index.ts` — export the resolver if needed by callers

**Steps:**
1. Pure resolver:
   ```ts
   export function resolveResponsibleEmployee(rungs: {
     item: string | null;        // itemPlanning.responsibleEmployee for (itemId, locationId)
     itemGroup: string | null;   // itemPostingGroupResponsibility.responsibleEmployee for (locationId, group) — location-specific
     location: string | null;    // location.responsibleEmployee
     company: string | null;     // companySettings.defaultResponsibleEmployee
   }): string | null {
     return rungs.item ?? rungs.itemGroup ?? rungs.location ?? rungs.company ?? null;
   }
   ```
2. Bulk-load helper (Kysely) that, for a company, returns per-(itemId, locationId) the four rung values: `itemPlanning.responsibleEmployee` (by itemId+locationId); the **location-specific item-group** value from `itemPostingGroupResponsibility` joined by `(locationId, itemPostingGroupId)` where `itemPostingGroupId` comes from `item → itemCost.itemPostingGroupId`; `location.responsibleEmployee`; and the single `companySettings.defaultResponsibleEmployee`. Return a `Map<string, string|null>` keyed `itemId·locationId` of the resolved employee. One query per run — never per-item (no N+1). The item-group lookup is keyed by BOTH locationId and group, so the same group resolves to different owners at different locations.
3. Unit test the resolver: item wins over group wins over location wins over company; all null → null.

**Verify:**
```bash
pnpm --filter @carbon/ee test
# Expected: resolver precedence tests pass.
```

**Out of scope:** any (location × item-group) matrix — it is a single-value ladder per rung.

---

## Task 6: `generatePlanningActions` engine step + wire into `runMrp`

**Depends on:** Tasks 3, 4, 5
**Files:**
- Create: `packages/ee/src/planning/mrp/planning-actions.ts` — `generatePlanningActions(client, db, { companyId, userId })`
- Create: `packages/ee/src/planning/mrp/planning-actions.test.ts`
- Modify: `packages/ee/src/planning/mrp/mrp.ts` — call `generatePlanningActions` after the Phase-7 transaction commits (`mrp.ts:937` block)
- Copy from (precedent): the batched-write + Kysely-transaction style already in `mrp.ts` (Phase 7, `BATCH_SIZE = 500`); the RPC read style in `apps/erp/app/modules/purchasing/purchasing.service.ts:460` (`getPurchasingPlanning`)

**Steps:**
1. `generatePlanningActions` runs **after** `runMrp`'s forecast/actual transaction commits (so the planning RPCs read fresh data). For each location:
   - Get/create periods (reuse the same period helper the planning routes use).
   - Call the RPCs `get_purchasing_planning` and `get_production_planning` (via `client.rpc(...)`) → per-item rows with `reorderingPolicy`, reorder params, `week1..weekN` projections, `quantityToOrder`, `preferredSupplierId`, `suppliers`.
   - **Order/Make actions:** run `computePlanningOrders` (Task 3) per item from its projections+params → dated suggestions. Buy items (`replenishmentSystem != 'Make'`) → `Order` (+ `supplierId` = preferred); Make items → `Make`. Carry `policyName`/`triggerValues`/`isASAP`.
   - **Change actions:** query the `openPurchaseOrderLines` and `openProductionOrders` views for the company/location. Per (itemId, locationId), match open orders to net requirements greedily by date:
     - an open order whose matched requirement date is earlier than its own date by **strictly more than** `rescheduleToleranceDays` → **Expedite** (`suggestedDate` = requirement date, target = the PO line / job);
     - later by strictly more than the tolerance → **Defer** (a gap ≤ tolerance never fires — the `>` comparison is canonical everywhere including tests);
     - open order quantity < requirement (after order-multiple rounding) → **Increase**; > requirement → **Decrease**;
     - open order with no remaining requirement → **Cancel**.
     - **Exactly ONE action per target document.** Date and qty rules can both match the same PO line/job; emit only the single highest-priority action per target: **Cancel** (mutually exclusive — no requirement) → **Expedite/Defer** (date) → **Increase/Decrease** (qty). Suppress the lower-priority action *before* the diff-write; a target needing both gets the date action now and the qty action on a later run.
     - Set `requiresManualAction`: for a PO line, true **only** when `isPurchaseOrderLocked(status)` (`purchasing.models.ts` `PURCHASE_ORDER_LOCKED_STATUSES`). Do **NOT** gate on `orderDate` — `insertPurchaseOrder` defaults `orderDate` to today, so it is non-null even on freshly planned POs and would flag every one. For a job, true when `status = 'Ready'` or later (treat `Ready`/`In Progress`/`Paused` as committed; `Draft`/`Planned` are not).
   - Resolve `assignee` via the Task 5 bulk resolver.
2. **Diff-write** in a Kysely transaction on the natural key `(companyId, itemId, locationId, type, periodId, COALESCE(poLineId, jobId, ''))`:
   - matched `Open` row → UPDATE in place (suggested qty/date/reason/isASAP/requiresManualAction refreshed; `assignee` re-resolved ONLY when `assigneeOverridden = false`; bump `updatedAt`/`updatedBy` only on real change);
   - matched `Dismissed` row → leave dismissed UNLESS suggestion changed materially (qty beyond order-multiple rounding, or date beyond `rescheduleToleranceDays`) → set back to `Open`;
   - `Open` **or `Dismissed`** row with no matching computed action → **delete** (retire). A lingering Dismissed row whose need vanished would otherwise occupy the natural key and block a fresh Open row if the same need returns — a returning need is a new situation and must re-surface;
   - `Actioned` rows → ignore (excluded by the partial-unique predicate).
   - Batch 500/statement.
3. Wire into `runMrp` (`mrp.ts`): after the existing `db.transaction().execute(...)` at line 937 returns, call `await generatePlanningActions(client, db, { companyId, userId })` and let any error **propagate** — do NOT catch-and-swallow. A generation failure must fail the run so callers report it (the scheduled Inngest job already try/catches per company and logs; the manual `api/mrp` route surfaces the error to the user) instead of reporting success with stale actions; the already-committed forecasts are fine and actions self-heal on the next successful run. `userId` is the payload's `userId`. **Audit actor:** the scheduled path passes `userId: "system"`, which is a real seeded `user` row (`20230123004317_companies-rls.sql:76` inserts `('system', 'system@carbonos.dev', …)`), so the `createdBy` FK is satisfied on every deployment — assert this in the test below rather than assuming it.
4. Test `planning-actions.test.ts`: (a) an item short of coverage with no open order → one `Order`/`Make`; (b) an open PO due > tolerance late → `Expedite` referencing the PO line; (c) a date gap of **exactly** the tolerance → no message; tolerance+1 day → message (boundary pins the strict `>`); (d) two consecutive runs on identical inputs → identical rows (diff-write idempotency); (e) a `Dismissed` row survives an unchanged run; a `Dismissed` row whose need vanished is **deleted**, and the returning need creates a fresh `Open` row; (f) `requiresManualAction`: false for `Draft` and `Planned` PO statuses, true for each `PURCHASE_ORDER_LOCKED_STATUSES` value; (g) an open PO wrong on BOTH date and qty → exactly ONE action (the date action) for that target; (h) a run with `userId: "system"` writes actions whose `createdBy = 'system'` satisfies the FK (scheduled-path proof). Use injected fixtures / a test DB per the package's existing test setup.

**Verify:**
```bash
pnpm --filter @carbon/ee test
pnpm exec turbo run typecheck --filter=@carbon/ee
# Expected: generation + diff-write + idempotency tests pass; clean typecheck.
```
If the open-order-to-requirement matching cannot be made deterministic from the available data (no pegging exists in Phase 1), use the documented greedy date-match heuristic above and note its limits in a code comment — do NOT introduce a `plannedOrderPeg` table (Phase 2).

**Out of scope:** removing the `supplyForecast` delete (Phase 2); any planned-order cascade; capacity/what-if.

---

## Task 7: `planningAction` read + mutation services

**Depends on:** Task 4
**Files:**
- Modify: `apps/erp/app/modules/production/production.service.ts` — `getPlanningActions`, `dismissPlanningAction`, `markPlanningActionActioned`
- Modify: `apps/erp/app/modules/production/production.models.ts` — (validators from Task 4)
- Copy from (precedent): `getPurchasingPlanning` (`purchasing.service.ts:460`) for the `GenericQueryFilters` + `client.from(...)`/`client.rpc(...)` shape; `assign()` in `apps/erp/app/modules/shared/shared.server.ts` for assignment

**Steps:**
1. `getPlanningActions(client, { companyId, locationId, replenishmentSystem: "Buy" | "Make", filters })` — selects `planningAction` joined to item (readable id, name) for the location, filtered to `status <> 'Actioned'` by default, honoring `GenericQueryFilters` (assignee, type, status, search, sorts, pagination). **Also join through `purchaseOrderLine` to select the parent `purchaseOrderId` (+ its readable id)** — `planningAction` stores the LINE id, and `path.to.purchaseOrder(...)` needs the PO id, so "Review on PO" navigation would otherwise be a broken link. Include the job's readable id for the job case. Buy page passes the Buy set (`type IN ('Order','Expedite','Defer','Cancel','Increase','Decrease')` for items whose `replenishmentSystem != 'Make'`); Make page the Make set. Returns raw `{ data, error }`.
2. `dismissPlanningAction(client, { ids, userId })` — set `status = 'Dismissed'`, `updatedBy`, `updatedAt` for the ids (bulk).
3. `markPlanningActionActioned(client, { ids, userId })` — set `status = 'Actioned'` (called by the apply route after a successful apply — Task 8).
4. Assignment reuses the shared **`assign()`** service against `table: "planningAction"` (the column is named `assignee`), and additionally sets `assigneeOverridden = true`. Add a small `assignPlanningAction(client, { id, assignee, userId })` that does both in one update (do NOT route through `api/assign`, because that path also fires table→NotificationEvent mapping we don't want here; a dedicated fn keeps it quiet). Confirm no `NotificationEvent` is wired for `planningAction` in `api+/assign.ts`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: clean typecheck; services return {data,error} and scope by companyId.
```

**Out of scope:** notifications/digests (Phase 2 `PlanningExceptions`).

---

## Task 8: Apply-action route handling + commitment gate

**Depends on:** Tasks 4, 7
**Files:**
- Modify: `apps/erp/app/routes/x+/purchasing+/planning.update.tsx` — accept the new action types + a `planningActionId`
- Modify: `apps/erp/app/routes/x+/production+/planning.update.tsx` — same
- Modify: `apps/erp/app/modules/purchasing/purchasing.service.ts` — add `updatePurchaseOrderLineSchedule(client, { lineId, requiredDate?, purchaseQuantity?, userId })` (thin wrapper over the inline `client.from("purchaseOrderLine").update(...)` pattern already at `planning.update.tsx:244`)
- Copy from (precedent): the existing `action === "order"` branch in each `planning.update.tsx`; `shortClosePurchaseOrderLine` / `updateJobStatus` / `updateJobOperationDueDate` / `notifyScheduleInputsChanged` for change execution

**Steps:**
1. Extend each `planning.update` action switch beyond `"order"`. Keep `"order"` (Order/Make create) exactly as-is. Add branches for `"expedite" | "defer" | "increase" | "decrease" | "cancel"`. **Wire representation:** route discriminators are lowercase; the client maps the stored enum through ONE explicit map before submit (`{ Order: "order", Make: "order", Expedite: "expedite", Defer: "defer", Increase: "increase", Decrease: "decrease", Cancel: "cancel" }` — a raw `Order` must never reach `action === "order"` unmapped or it falls into the unknown-action branch).
2. **Bind to the persisted action first (IDOR guard — CWE-639).** Each change-action branch receives ONLY a `planningActionId`. Before any mutation the route loads the `planningAction` by **id AND companyId**, requires `status = 'Open'`, and takes the action **type, target reference (`purchaseOrderLineId`/`jobId`), `suggestedDate`, and `suggestedQuantity` from the stored row** — never from the request body. Reject id-not-found, cross-company, non-Open, or type-mismatch requests. Every subsequent target lookup and update is `companyId`-scoped.
3. **Commitment gate in the route** (defense-in-depth; the engine already flagged it): re-read the target document's status. If the PO is locked (**`isPurchaseOrderLocked(status)` only — do NOT check `orderDate`, which `insertPurchaseOrder` defaults to today even for planned POs**), or the job status is `Ready`+, **refuse the auto-apply** and return `{ requiresManualAction: true }` (the UI navigates instead — Task 11). Otherwise:
   - Expedite/Defer on a PO line → `updatePurchaseOrderLineSchedule({ lineId, requiredDate: suggestedDate })`.
   - Increase/Decrease on a PO line → `updatePurchaseOrderLineSchedule({ lineId, purchaseQuantity: suggestedQuantity })`.
   - Cancel on a PO line → `shortClosePurchaseOrderLine(db, { lineId, purchaseOrderId, companyId, userId, intent: "close" })`.
   - Expedite/Defer on a job → **exactly one path**: `updateJob({ dueDate: suggestedDate })` (the job's demand target; it recomputes priority), then `notifyScheduleInputsChanged(companyId, "reorder", reason, jobId)` (there is no `"job"` kind — use `"reorder"`). Do NOT call `updateJobOperationDueDate` — that pins an *operation* need-by and sets `manuallyScheduled`, a different input — and never write `jobOperation` dates directly.
   - Increase/Decrease on a job → `updateJob({ quantity })` then `recalculateJobRequirements`.
   - Cancel on a job → `updateJobStatus({ id, companyId, status: "Cancelled", updatedBy })`.
4. On success, call `markPlanningActionActioned(client, { ids: [planningActionId], userId })`.
5. Preserve the JSON-body + `action`-discriminator contract and the plain-object return shape (no redirect) both routes use today.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: clean typecheck; unknown-action default branch still errors.
```
If a job-side reschedule cannot be expressed as `updateJob({ dueDate })` + `notifyScheduleInputsChanged` without touching scheduler internals, STOP and report — do not write `jobOperation` dates directly, and do not repurpose `updateJobOperationDueDate` (it pins an operation need-by, a different input).

**Out of scope:** the automated reopen + supplier-notification / change-order flow for committed POs (deferred — the gate just navigates).

---

## Task 9: `responsibleEmployee` field on the item Planning tab

**Depends on:** Tasks 1, 2
**Files:**
- Modify: `apps/erp/app/modules/items/items.models.ts` — add `responsibleEmployee` to `itemPlanningValidator` (`:612`)
- Modify: `apps/erp/app/modules/items/ui/Item/ItemPlanningForm.tsx` — render an `Employee` field
- Modify: `apps/erp/app/modules/items/items.service.ts` — `upsertItemPlanning` (`:3719`) passes the field through (it spreads validated data, so likely no change beyond the validator)
- Copy from (precedent): any existing `Employee` field usage in a `ValidatedForm` (`apps/erp/app/components/Form/Employee.tsx`)

**Steps:**
1. Add `responsibleEmployee: zfd.text(z.string().optional())` to `itemPlanningValidator`.
2. In `ItemPlanningForm`, import `Employee` from `~/components/Form` and render `<Employee name="responsibleEmployee" label={t\`Responsible\`} />`. This single form serves Part/Material/Tool/Consumable, so all four item Planning tabs get the field at once.
3. Confirm `upsertItemPlanning` persists it (it spreads `validation.data`; the new column exists after Task 1).

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: clean typecheck.
```

**Out of scope:** the item-group/location/company rungs (Task 10).

---

## Task 10: Ownership settings screen (clone printer `AssignmentsCard`)

**Depends on:** Tasks 1, 2
**Files:**
- Create: `apps/erp/app/modules/settings/ui/Planning/ResponsibleEmployeeCard.tsx`
- Create/modify route: `apps/erp/app/routes/x+/settings+/planning.tsx` (new settings route) — loader + `intent`-switched action
- Modify: `apps/erp/app/utils/path.ts` — add `settingsPlanning: \`${x}/settings/planning\``
- Modify: settings navigation config to add the new settings link (find where `printing` settings link is registered and mirror it)
- Modify: `apps/erp/app/modules/settings/settings.service.ts` (or the appropriate settings service) — `setResponsibleEmployee` writers for company default / per-location / per-item-group
- Copy from (precedent): `apps/erp/app/modules/settings/ui/Printing/AssignmentsCard.tsx` + `apps/erp/app/routes/x+/settings+/printing.tsx` (fetcher + `intent` action returning `{success,message}`, Combobox-per-row, no ValidatedForm)

**Steps:**
1. Clone the `AssignmentsCard` + `LocationSection` **tree** structure into `ResponsibleEmployeeCard` — this maps 1:1 onto printers (location default → per-work-center override), here **company default → per-location → per-item-group**:
   - a top **company default** row (writes `companySettings.defaultResponsibleEmployee`);
   - one **section per location**, each with a **location default** row (writes `location.responsibleEmployee`) and, nested/indented beneath it, **one row per item group** (writes `itemPostingGroupResponsibility` for that `(locationId, itemPostingGroupId)`), exactly like `LocationSection` renders per-work-center rows under a location.
   - Each row = an `Employee`/`Combobox` picker; an unset item-group row shows an **inherited-placeholder** ("inherits {location default}" — or the company default when the location is itself unset), the way `AssignmentRow` computes `displayState` (`assigned` / `inherited` / `missing`).
2. Loader: `requirePermissions(request, { view: "settings" })`; load `companySettings`, `getLocationsList`, all `itemPostingGroup` rows, all `itemPostingGroupResponsibility` rows for the company (to seed the nested rows), + the people list (`usePeople` source).
3. Action: `requirePermissions(request, { update: "settings" })`; `intent`-switch:
   - `setCompanyDefault` → update `companySettings.defaultResponsibleEmployee`;
   - `setLocation` (locationId, employee) → update `location.responsibleEmployee`;
   - `setItemGroup` (locationId, itemPostingGroupId, employee) → **upsert** `itemPostingGroupResponsibility` on `(companyId, locationId, itemPostingGroupId)` (delete the row when employee is cleared, matching the printer "unset → inherit" behavior).
   Each returns `{ success, message }` (no redirect; fetcher + toast).
4. Register the settings link + `path.to.settingsPlanning`.
5. Settings writers go in the appropriate settings service (`setResponsibleEmployeeDefault`, `setLocationResponsibleEmployee`, `upsertItemPostingGroupResponsibility`).
6. Expose **`rescheduleToleranceDays`** on the same screen as a plain number field (its own small card above the ownership card), zod-validated `z.number().int().min(0).max(365)` in the mutation (the DB `CHECK (>= 0)` is the backstop; a negative value would make every gap actionable).

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: clean typecheck. (Browser check happens in Task 12.)
```

**Out of scope:** treating this as a free (customer-type × item-group)-style classification matrix — it is a printer-style **inheritance tree** (company → location → item-group) where only configured cells persist and each falls back up the tree.

---

## Task 11: Worklist columns + "my actions" filter + bulk actions on both planning pages

**Depends on:** Tasks 6, 7, 8
**Files:**
- Modify: `apps/erp/app/routes/x+/purchasing+/planning.tsx` + `apps/erp/app/routes/x+/production+/planning.tsx` — loaders also call `getPlanningActions`
- Modify: `apps/erp/app/modules/purchasing/ui/Planning/PurchasingPlanningTable.tsx` + `apps/erp/app/modules/production/ui/Planning/ProductionPlanningTable.tsx` — new columns, filters, bulk actions
- Copy from (precedent): the existing `columns` `useMemo`, `withSelectableRows`, `renderActions`, and `onBulkUpdate` in `PurchasingPlanningTable.tsx`; the `Assignee` inline control (`apps/erp/app/components/Assignee.tsx`)

**Steps:**
1. Loader: alongside the existing `getPurchasingPlanning`/`getProductionPlanning` projection query, call `getPlanningActions(...)` for the location + replenishment set and pass the rows to the table.
2. Columns: add **action type**, **suggested date**, **suggested qty**, **reason** (rendered from `triggerValues`/`policyName`), **assignee** (render the `Assignee` inline control with `table="planningAction"` — but wire its onChange to the quiet `assignPlanningAction` route, not the notification-firing `api/assign`; simplest: a dedicated fetcher POST), **status**, and an urgency flag from `isASAP`. Give the type and status columns `meta.filter` static options; give assignee a static filter of people so **"my actions"** is a filter value (default the page to the current user via the initial filter/search params).
3. Row primary control: **Apply** — submits to the extended `planning.update` route with the row's **`planningActionId` and the mapped lowercase `action`** (via the Task 8 enum→wire map; e.g. `Expedite` → `"expedite"`) and NOTHING else: the server derives type, target, and proposal values from the persisted row (Task 8 IDOR bind). EXCEPT when `requiresManualAction`, where the control is **"Review on PO/Job"** and links to `path.to.purchaseOrder(purchaseOrderId)` using the **parent PO id from Task 7's join** (never the stored `purchaseOrderLineId` — that link would 404) / `path.to.job(jobId)`.
4. Bulk (reuse `withSelectableRows` + `renderActions`): **Apply selected**, **Assign selected**, **Dismiss selected** (the latter two POST to the new services). Keep the existing "Recalculate" MRP button.
5. Keep the live 48-week projection columns exactly as they are.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp && pnpm run lint
# Expected: clean typecheck + lint.
```

**Out of scope:** a unified cross-module cockpit; the diff/live banners and capacity strip (Phase 2).

---

## Task 12: Browser verification (/test) on the satellite dataset

**Depends on:** Tasks 1–11
**Files:** none (verification only)

**Steps:**
1. Boot the stack (`crbn up`) and run `/test` for the planning-actions feature:
   - Trigger an MRP run (the planning page "Recalculate"), then confirm the worklist shows `Order`/`Make` rows with suggested qty/date/reason and a resolved assignee.
   - Set an item group's `responsibleEmployee` in the new settings screen; recalc; confirm that group's actions route to that person; set a per-item override on the Planning tab and confirm it wins.
   - Filter to "my actions"; apply an Order on an uncommitted plan → PO created, row goes Actioned; apply Expedite on a Draft/Planned PO line → date changes.
   - Confirm a sent/locked PO's change action shows "Review on PO" and navigates instead of editing.
   - Dismiss an action; recalc; confirm it stays dismissed.
2. Capture screenshots of the worklist + settings screen for the PR (net-new UI).

**Verify:**
```bash
# /test playbook passes for each flow above; screenshots saved for the PR.
```
If the stack cannot boot, the feature is BLOCKED (not done) — report it.

**Out of scope:** everything in Phases 2+.
