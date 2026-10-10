# Projects Phase 3 — planning groups, live pegging, distribution — implementation plan

**Spec:** .ai/specs/2026-10-03-projects.md (*Phase 3: planning groups, live pegging, distribution at the physical event*; decisions 20–23 and 34; Risks: *Pegging performance*, *Distribution at receipt*)
**Research:** .ai/research/projects-wbs-pmmo.md (Grouping, Pegging and Distribution)
**Branch:** projects-wbs-research-spec
**Prerequisite:** the Phase 2a and 2b plans are done and committed. If a named Phase 2 artifact does not exist, STOP and report.

## Scope of this plan

This is SAP PMMO's Grouping, Pegging and Distribution, done inside the MRP run and at the physical event:
1. **Grouping.** A `planningGroup` pools projects with project stock. Its members' demand nets in one segment, the group id. A PO line or job made for the group carries `planningGroupId` and no `projectId`.
2. **Pegging in the run.** A pure function `pegGroupSegment` allocates the group's supply to its members' demands. The run diff-writes the result to the versioned `projectPeg` table.
   - A **Soft** peg sits on open supply. MRP may change it on any run.
   - A **Hard** peg sits on received or completed supply. MRP never changes it.
   - A **Manual** peg is a planner's override with a reason. MRP keeps it.
3. **Pegs follow the BOM.** The component demand of a grouped job, or of a planned grouped Make, carries the member attribution of its parent.
4. **Distribution at the physical event.** A grouped PO receipt, or a grouped job completion, splits into member stripes by the current pegs. The pegs turn Hard. The remainder follows the group's excess rule.
5. **Later costs follow the split.** Purchase price variance spreads over the striped layers. Project commitments include each member's soft-peg share of open grouped supply.
6. **Member Transfers and Borrows.** MRP proposes a Transfer or a Borrow from a sibling with excess to a short member.
7. **The UI:** Planning Groups pages, the project Pegging tab, and the history as of a date.

## Commercial gating (decided)

Brad decided on 2026-10-09 that Phase 3 is commercial (spec decision 34). Follow `.claude/rules/commercial-licensing.md`:
1. Put the pure pegging functions (Task 6, `mrp-pegging.ts`) and the peg writer (Task 7, `peg-writer.ts`) under `packages/ee/src/pegging/`, exported as `@carbon/ee/pegging` and `@carbon/ee/pegging.server`. Every other path in this plan stays as written.
2. Add `PLANNING_GROUPS` to `FEATURE_PLANS` (`packages/ee/src/plan.ts`).
3. Embed `requireEntitlement(client, companyId, "PLANNING_GROUPS")` at the top of `upsertPlanningGroup`. Move that function into `packages/ee/src/pegging/service.server.ts`.
4. In `runMrp` and `generatePlanningActions`, degrade with `companyHasFeature`: without the feature, a group's members net as separate project segments and no peg is written.
5. Gate the Planning Groups pages with `usePlanGate({ feature: "PLANNING_GROUPS" })` and the upgrade overlay. Keep them visible in the navigation.
6. Before you add the imports, check that `@carbon/ee` does not depend on `@carbon/planning`. If it does, STOP and report: the import would form a cycle.

## Rules for the executor

- Read `.ai/lessons.md`, `.claude/rules/mrp-system.md`, `.claude/rules/inventory-system.md`, `.claude/rules/projects-system.md` and `packages/planning/AGENTS.md` before Task 1.
- 🛑 Never edit the Phase 2b golden snapshot (`plan-company.basic`) to make a test pass. A company with no planning group must get the same output as before.
- Never update a peg row in place. There are 2 exceptions:
  1. Set `supersededAt` and `supersededByRunId` when a newer row replaces it.
  2. Set `itemLedgerId` on the Hard row that a receipt has just created.
- Use one peg split rule. `harden_pegs_for_supply` (Task 9) is the only code that turns Soft pegs Hard. `post-receipt` and `complete_job_to_inventory` both call it.
- If a quoted code line or line number does not match the file, search for the quoted code. If you cannot find it, STOP and report.

## Progress

- [x] Task 1: Create the Phase 3 enum and table migration
- [x] Task 2: Redefine the segment rule and the views for groups
- [x] Task 3: Regenerate types and add the RLS rules
- [x] Task 4: Add the planning group services and pages
- [x] Task 5: Carry member attribution through the explosion
- [x] Task 6: Add `pegGroupSegment` as a pure function
- [x] Task 7: Diff-write the pegs in the planning-action transaction
- [x] Task 8: Apply grouped Order and Make actions and move their pegs
- [x] Task 9: Add `harden_pegs_for_supply`
- [x] Task 10: Distribute grouped PO receipts and their reversals
- [x] Task 11: Distribute grouped job output
- [ ] Task 12: Charge price variance to member projects
- [ ] Task 13: Add soft-peg commitments to the cost summary
- [ ] Task 14: Propose member Transfers and Borrows
- [ ] Task 15: Add the Pegging tab and manual pegs
- [ ] Task 16: Extend the demo datasets
- [ ] Task 17: Update the rules, AGENTS.md, docs and spec
- [ ] Task 18: Verify in the browser

## Dependencies

- Task 1 runs first. Task 2 needs Task 1. Task 3 needs Task 2.
- Task 4 needs Task 3. Task 5 needs Task 3. Task 6 needs Task 5. Task 7 needs Task 6.
- Task 8 needs Task 7. Task 9 needs Task 3. Tasks 10 and 11 need Task 9.
- Task 12 needs Task 10. Task 13 needs Task 7. Task 14 needs Task 6.
- Task 15 needs Task 7. Task 16 needs Tasks 10 and 11. Task 17 needs Tasks 1–16. Task 18 runs last.

---

## Task 1: Create the Phase 3 enum and table migration

**Depends on:** none
**Files:**
- Create: `packages/database/supabase/migrations/<timestamp>_projects-3-enums.sql`
- Create: `packages/database/supabase/migrations/<timestamp>_planning-groups-and-pegs.sql`

**Steps:**
1. Run `pnpm db:migrate:new projects-3-enums`. Write only:

```sql
CREATE TYPE "planningGroupExcessRule" AS ENUM ('Common Stock', 'Exception Project');
CREATE TYPE "planningGroupPriorityRule" AS ENUM ('Earliest Need', 'Project Priority');
CREATE TYPE "projectPegState" AS ENUM ('Soft', 'Hard', 'Manual');
CREATE TYPE "projectPegSupplyType" AS ENUM ('Purchase Order Line', 'Job', 'Planning Action');
```

2. Run `pnpm db:migrate:new planning-groups-and-pegs`. Write the SQL below. Add an index on `companyId` and every FK column.

```sql
CREATE TABLE IF NOT EXISTS "planningGroup" (
  "id" TEXT NOT NULL DEFAULT id('plg'),
  "companyId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "locationId" TEXT NOT NULL REFERENCES "location"("id"),
  "excessRule" "planningGroupExcessRule" NOT NULL DEFAULT 'Common Stock',
  "exceptionProjectId" TEXT,
  "priorityRule" "planningGroupPriorityRule" NOT NULL DEFAULT 'Earliest Need',
  "active" BOOLEAN NOT NULL DEFAULT TRUE,
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  CONSTRAINT "planningGroup_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "planningGroup_name_key" UNIQUE ("name", "companyId"),
  CONSTRAINT "planningGroup_exception_fkey" FOREIGN KEY ("exceptionProjectId", "companyId") REFERENCES "project"("id", "companyId") ON DELETE SET NULL ("exceptionProjectId"),
  CONSTRAINT "planningGroup_exception_check" CHECK ("excessRule" <> 'Exception Project' OR "exceptionProjectId" IS NOT NULL),
  CONSTRAINT "planningGroup_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE
);

ALTER TABLE "project"
  ADD COLUMN IF NOT EXISTS "planningGroupId" TEXT,
  ADD COLUMN IF NOT EXISTS "planningPriority" INTEGER NOT NULL DEFAULT 100;
ALTER TABLE "project" ADD CONSTRAINT "project_planningGroup_fkey"
  FOREIGN KEY ("planningGroupId", "companyId") REFERENCES "planningGroup"("id", "companyId") ON DELETE SET NULL ("planningGroupId");
ALTER TABLE "project" ADD CONSTRAINT "project_planningGroup_stock_check"
  CHECK ("planningGroupId" IS NULL OR "projectStock");

ALTER TABLE "purchaseOrderLine" ADD COLUMN IF NOT EXISTS "planningGroupId" TEXT;
ALTER TABLE "purchaseOrderLine" ADD CONSTRAINT "purchaseOrderLine_planningGroup_fkey"
  FOREIGN KEY ("planningGroupId", "companyId") REFERENCES "planningGroup"("id", "companyId");
ALTER TABLE "purchaseOrderLine" ADD CONSTRAINT "purchaseOrderLine_owner_check"
  CHECK ("planningGroupId" IS NULL OR "projectId" IS NULL);

ALTER TABLE "job" ADD COLUMN IF NOT EXISTS "planningGroupId" TEXT;
ALTER TABLE "job" ADD CONSTRAINT "job_planningGroup_fkey"
  FOREIGN KEY ("planningGroupId", "companyId") REFERENCES "planningGroup"("id", "companyId");
ALTER TABLE "job" ADD CONSTRAINT "job_owner_check"
  CHECK ("planningGroupId" IS NULL OR "projectId" IS NULL);

CREATE TABLE IF NOT EXISTS "projectPeg" (
  "id" TEXT NOT NULL DEFAULT id('peg'),
  "companyId" TEXT NOT NULL,
  "planningGroupId" TEXT NOT NULL,
  "itemId" TEXT NOT NULL REFERENCES "item"("id"),
  "locationId" TEXT NOT NULL REFERENCES "location"("id"),
  "supplyType" "projectPegSupplyType" NOT NULL,
  "supplyId" TEXT NOT NULL,                  -- purchaseOrderLine.id, job.id or planningAction.id
  "projectId" TEXT NOT NULL,
  "projectElementId" TEXT,
  "demandSourceType" "demandForecastSourceType" NOT NULL,
  "demandSourceId" TEXT NOT NULL,
  "parentPegId" TEXT,
  "quantity" NUMERIC NOT NULL CHECK ("quantity" > 0),
  "needDate" DATE,
  "state" "projectPegState" NOT NULL DEFAULT 'Soft',
  "manualReason" TEXT,
  "exception" TEXT,                          -- set by the run when a Manual peg's demand is gone
  "createdByRunId" TEXT,
  "supersededAt" TIMESTAMP WITH TIME ZONE,
  "supersededByRunId" TEXT,
  "hardenedAt" TIMESTAMP WITH TIME ZONE,
  "itemLedgerId" TEXT,
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  CONSTRAINT "projectPeg_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "projectPeg_group_fkey" FOREIGN KEY ("planningGroupId", "companyId") REFERENCES "planningGroup"("id", "companyId"),
  CONSTRAINT "projectPeg_project_fkey" FOREIGN KEY ("projectId", "companyId") REFERENCES "project"("id", "companyId"),
  CONSTRAINT "projectPeg_manual_check" CHECK ("state" <> 'Manual' OR "manualReason" IS NOT NULL),
  CONSTRAINT "projectPeg_hard_check" CHECK ("state" <> 'Hard' OR "hardenedAt" IS NOT NULL),
  CONSTRAINT "projectPeg_planned_check" CHECK ("supplyType" <> 'Planning Action' OR "state" = 'Soft'),
  CONSTRAINT "projectPeg_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "projectPeg_current_idx" ON "projectPeg" ("companyId", "planningGroupId", "itemId") WHERE "supersededAt" IS NULL;
CREATE INDEX IF NOT EXISTS "projectPeg_project_idx" ON "projectPeg" ("companyId", "projectId") WHERE "supersededAt" IS NULL;
CREATE INDEX IF NOT EXISTS "projectPeg_supply_idx" ON "projectPeg" ("supplyType", "supplyId") WHERE "supersededAt" IS NULL;
CREATE INDEX IF NOT EXISTS "projectPeg_history_idx" ON "projectPeg" ("companyId", "planningGroupId", "createdAt");
```

3. `supplyId` has no FK, because it points at one of 3 tables. A planned supply is a `planningAction`, which MRP deletes and recreates. The Task 7 diff-writer supersedes a peg whose supply no longer exists.
4. The spec named the planned supply column `plannedOrderId`. Planning actions are the planned orders on main, so this plan uses `supplyType = 'Planning Action'`. Task 17 records this in the spec.

**Verify:**
```bash
grep -c "CREATE TABLE IF NOT EXISTS" packages/database/supabase/migrations/*_planning-groups-and-pegs.sql
# Expected: 2
```

**Out of scope:** the views (Task 2).

---

## Task 2: Redefine the segment rule and the views for groups

**Depends on:** 1
**Files:**
- Create: `packages/database/supabase/migrations/<timestamp>_planning-group-segments.sql`

**Steps:**
1. Redefine `project_planning_segment` so a member project nets in its group:

```sql
CREATE OR REPLACE FUNCTION project_planning_segment(p_project_id TEXT)
RETURNS TEXT LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  SELECT COALESCE((SELECT CASE
                     WHEN g."id" IS NOT NULL AND g."active" THEN g."id"
                     WHEN p."projectStock" THEN p."id"
                     ELSE '' END
                   FROM "project" p
                   LEFT JOIN "planningGroup" g ON g."id" = p."planningGroupId" AND g."companyId" = p."companyId"
                   WHERE p."id" = p_project_id), '');
$$;
```

2. Recreate `openPurchaseOrderLines`, `openProductionOrders` and `openJobMaterialLines` from their Phase 2b definitions. Set the segment to `COALESCE(<row>."planningGroupId", project_planning_segment(<row>."projectId"))`. For job materials, use the job's `planningGroupId`.
3. Add these columns to each view, for the pegging function:
   - `ownerProjectId`: the line's `projectId` (null for grouped supply);
   - `planningGroupId`.
4. Add `projectPriority` (`project.planningPriority`) to `openProjectMaterialLines`, `openJobMaterialLines` and `openProjectBorrows`.
5. Run `pnpm db:migrate`, then `pnpm run generate:types`.

**Verify:**
```bash
psql "$SUPABASE_DB_URL" -c "SELECT project_planning_segment('does-not-exist');"
# Expected: one row with an empty string
```

**Out of scope:** the RPCs. They already group by `planningSegmentId` (Phase 2b).

---

## Task 3: Regenerate types and add the RLS rules

**Depends on:** 2
**Files:**
- Modify: `packages/database/src/authz/manifest.ts`
- Modify: generated types

**Steps:**
1. Add these rules in alphabetical order:

```ts
planningGroup: company("projects"),
projectPeg: company("projects", { create: false, update: false, delete: false }),
```

2. MRP writes `projectPeg` with the service role. Manual pegs go through a server action that uses the service role after it checks `update: projects` (Task 15).
3. Run `pnpm db:migrate`, then `pnpm --filter @carbon/database authz migration projects-3-rls`, then `pnpm run generate:types`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/database
# Expected: exit code 0
```

**Out of scope:** UI.

---

## Task 4: Add the planning group services and pages

**Depends on:** 3
**Files:**
- Modify: `apps/erp/app/modules/projects/projects.models.ts`, `projects.service.ts`
- Create: `apps/erp/app/routes/x+/projects+/planning-groups.tsx`, `planning-groups.new.tsx`, `planning-groups.$id.tsx`, `planning-groups.delete.$id.tsx`
- Create: `apps/erp/app/modules/projects/ui/PlanningGroups/PlanningGroupsTable.tsx`, `PlanningGroupForm.tsx`
- Modify: `apps/erp/app/modules/projects/ui/useProjectsSubmodules.tsx` — **Planning Groups**
- Modify: `apps/erp/app/modules/projects/ui/Projects/ProjectForm.tsx` — **Planning group** and **Planning priority**
- Copy from (precedent): the Labor Categories pages from Phase 1a

**Steps:**
1. Use the `carbon-design` skill.
2. Add `planningGroupValidator` (name, location, excess rule, exception project, priority rule, active). Add a refine: the exception project is required for **Exception Project**.
3. Add `getPlanningGroups`, `getPlanningGroup`, `upsertPlanningGroup` and `deletePlanningGroup`. `deletePlanningGroup` refuses while a member, a grouped PO line or a grouped job exists.
4. Add `getPlanningGroupMembers(client, planningGroupId, companyId)`.
5. The group page lists the members with identifier, name, priority and status. The spec asks that membership is visible, because a hidden group lets a program hoard stock.
6. In `ProjectForm`, the **Planning group** select shows only when **Project stock** is on. Its location must equal the project's location; refine the validator for it.
7. When a project joins or leaves a group, open stock stays in the project's stripe. Only planning changes.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exit code 0
```

**Out of scope:** pegs (Task 6).

---

## Task 5: Carry member attribution through the explosion

**Depends on:** 3
**Files:**
- Modify: `packages/database/src/mrp-engine.ts` (`DemandContributorBase`; contributors at lines 354–372)
- Modify: `packages/database/src/mrp-engine.test.ts`
- Modify: `packages/planning/src/mrp/plan-company.ts`, `packages/planning/src/mrp/mrp.ts`

**Steps:**
1. Add `projectId?: string`, `projectElementId?: string` and `needDate?: string` to `DemandContributorBase`.
2. In `planCompany`, set them on every demand contributor of a group segment:
   - Project Material rows: the plan line's project and element;
   - Job Material rows of a member's job: the job's project and element;
   - Project Borrow demand: the borrower project.
3. Job Material rows of a **grouped** job have no project. Leave `projectId` empty for them. Task 6 splits them by the job's pegs.
4. In `explodeBom`, a child contributor copies `projectId`, `projectElementId` and `needDate` from its parent contributor.
5. Contributors are gross. In a group segment only, scale the parent's contributors by `netRequirement / grossDemand` before you copy them to the child. In segment `''` and project segments, keep today's behavior so the golden snapshot stays the same.
6. Add a test: a grouped Make parent with gross 30 (members 20 and 10) and on-hand 6 explodes child contributors of 16 and 8.

**Verify:**
```bash
pnpm --filter @carbon/database test -- mrp-engine && pnpm --filter @carbon/planning test
# Expected: all tests pass; the basic snapshot is unchanged
```

**Out of scope:** the allocation (Task 6).

---

## Task 6: Add `pegGroupSegment` as a pure function

**Depends on:** 5
**Files:**
- Create: `packages/database/src/mrp-pegging.ts`
- Create: `packages/database/src/mrp-pegging.test.ts`
- Modify: `packages/database/package.json` — export `./mrp-pegging`

**Steps:**
1. Export these types:

```ts
export type PegDemand = {
  projectId: string; projectElementId: string | null; priority: number;
  sourceType: "Job Material" | "Project Material" | "Sales Order" | "Project Borrow";
  sourceId: string; needDate: string; quantity: number;
  parentSupply?: { supplyType: PegSupplyType; supplyId: string }; // set for a grouped job's components
};
export type PegSupplyType = "Purchase Order Line" | "Job" | "Planning Action";
export type PegSupply = {
  supplyType: PegSupplyType | "Stock"; supplyId: string; // "Stock" supplyId = the owner project id
  ownerProjectId: string | null;  // null = grouped supply
  availableDate: string; quantity: number;
};
export type ExistingPeg = {
  id: string; supplyType: PegSupplyType; supplyId: string; projectId: string;
  demandSourceType: string; demandSourceId: string; quantity: number;
  state: "Soft" | "Hard" | "Manual";
};
export type ComputedPeg = Omit<ExistingPeg, "id" | "state"> & {
  projectElementId: string | null; needDate: string; parentPegKey: string | null;
};
```

2. Export `splitGroupedJobDemand(demands, jobPegs)`. For each demand with `parentSupply` of type Job, split its quantity over the job's pegs in proportion to each peg's quantity. Each part gets the peg's project and element. Use `distributeRoundingResidual` from `@carbon/utils` with `SCALE`, so the parts sum exactly to the demand.
3. Export `pegGroupSegment({ demands, supplies, existing, priorityRule })`. It returns `{ pegs: ComputedPeg[], shortages, excess, manualWithoutDemand }`:
   1. Keep every existing Hard and Manual peg as fixed. Subtract its quantity from its supply and its demand.
   2. Cover each member's demand with its own stock and its own supply first (`ownerProjectId` = the member). Write no peg for these.
   3. Sort the remaining demands. With **Earliest Need**: need date, then priority, then source id. With **Project Priority**: priority, then need date, then source id.
   4. Sort the grouped supplies by available date, then supply type (`Purchase Order Line`, `Job`, `Planning Action`), then id.
   5. Walk the demands in order. Take from the grouped supplies in order, and emit one `ComputedPeg` per (demand, supply) pair.
   6. Return the demand left uncovered as `shortages`, and the grouped supply left over as `excess`.
   7. Return each fixed Manual peg whose demand is not in `demands` as `manualWithoutDemand`.
4. Export `diffPegs(existingSoft, computed)`. Key a peg by `(supplyType, supplyId, projectId, demandSourceType, demandSourceId)`.
   - A key in both with the same quantity: keep.
   - A key in both with a different quantity: supersede the old row, and insert a new row.
   - A key only in `existingSoft`: supersede.
   - A key only in `computed`: insert.
5. Write `mrp-pegging.test.ts` with these 8 cases:
   1. The spec example: demands 20, 30 and 10, and one grouped Planning Action of 60, give pegs of 20, 30 and 10.
   2. P-103's demand drops to 5: `diffPegs` supersedes the 10 peg, inserts a 5 peg, and keeps the others.
   3. A Hard peg of 20 stays fixed when its demand drops to 15. The function reports no change to it.
   4. A Manual peg whose demand is gone appears in a returned `manualWithoutDemand` list.
   5. A member's own stock of 8 against its demand of 20 leaves 12 to peg.
   6. **Project Priority** pegs a priority-1 project before a priority-5 project with an earlier need.
   7. `splitGroupedJobDemand` splits a component demand of 10 over job pegs of 2 and 1 into 6.66667 and 3.33333, summing to 10.
   8. A 1 000-member, 20 000-demand input runs in less than 500 ms. This is the spec's performance risk.

**Verify:**
```bash
pnpm --filter @carbon/database test -- mrp-pegging
# Expected: 8 passed
```

**Out of scope:** writes (Task 7) and member transfers (Task 14).

---

## Task 7: Diff-write the pegs in the planning-action transaction

**Depends on:** 6
**Files:**
- Modify: `packages/planning/src/mrp/plan-company.ts` — return `groupPegInputs` per (group, item, location)
- Modify: `packages/planning/src/mrp/planning-actions.ts` (the transaction at about line 1591; `writePlanningActionDiff` 946)
- Create: `packages/planning/src/mrp/peg-writer.ts`
- Create: `packages/planning/src/mrp/peg-writer.write.test.ts`
- Modify: `packages/planning/src/mrp/mrp.ts` — generate `runId` with `nanoid()` once per run, and pass it on

**Steps:**
1. Pegs on planned supply need the `planningAction` ids. So the peg writer runs in the planning-action transaction, not in Phase 7. That transaction already holds the company's advisory lock.
2. In `planCompany`, collect the demands (from the contributors, Task 5) and the supplies of each group segment key. The supplies are:
   - member stock;
   - open PO lines and jobs, grouped or owned by a member;
   - the planned Order and Make candidates of the segment. Each has a temporary key equal to its natural key.
3. In the transaction, after `writePlanningActionDiff`:
   1. Read the ids of the non-Actioned actions of the company with their natural key fields. Map each planned supply's temporary key to its action id.
   2. Read the current pegs (`supersededAt IS NULL`) of every group, in one query.
   3. For each (group, item, location), call `splitGroupedJobDemand`, then `pegGroupSegment`, then `diffPegs` on the Soft pegs.
   4. Supersede in one `UPDATE … WHERE id IN (…)` per 500 ids. Set `supersededAt = now` and `supersededByRunId = runId`.
   5. Insert the new pegs per 500 rows, with `createdByRunId = runId` and `createdBy = userId`.
   6. Supersede every current Soft peg whose supply is gone. That is an Actioned or deleted planning action, a received or closed PO line, or a completed or cancelled job.
   7. Set `exception = 'Demand no longer exists'` on each Manual peg in `manualWithoutDemand`. Clear `exception` on Manual pegs that have demand again.
4. Write `peg-writer.write.test.ts` (`databaseTest`) with 2 cases:
   1. Two runs with the same inputs write no peg change on the second run.
   2. A demand change supersedes 1 row and inserts 1 row, with the run id on both.

**Verify:**
```bash
pnpm --filter @carbon/planning test
# Expected: all tests pass; the basic snapshot is unchanged
```

**Out of scope:** pegs in segment `''` or in a single-project segment. Only group segments have pegs.

---

## Task 8: Apply grouped Order and Make actions and move their pegs

**Depends on:** 7
**Files:**
- Modify: `apps/erp/app/routes/x+/purchasing+/planning.update.tsx`, `apps/erp/app/routes/x+/production+/planning.update.tsx`
- Modify: `apps/erp/app/modules/projects/projects.server.ts` — `moveActionPegsToSupply`

**Steps:**
1. If the action's segment is a planning group id, an **Order** creates the PO line with `planningGroupId` and no `projectId`. A **Make** creates the job with `planningGroupId` and no `projectId`.
2. In the same request, call `moveActionPegsToSupply(db, { companyId, userId, planningActionId, supplyType, supplyId })`. It runs one Kysely transaction:
   1. Supersede the action's current pegs.
   2. Insert copies with the new `supplyType` and `supplyId`.
3. The project costs then show the commitment at once, without waiting for the next run.
4. Read the group id from the segment with one query on `planningGroup`. A segment that is neither a group nor a project is `''`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp && pnpm --filter erp test -- planning-action-writes
# Expected: typecheck exits 0; all tests pass
```

**Out of scope:** splitting one action into several PO lines.

---

## Task 9: Add `harden_pegs_for_supply`

**Depends on:** 3
**Files:**
- Create: `packages/database/supabase/migrations/<timestamp>_harden-pegs-for-supply.sql`
- Create: `packages/database/supabase/tests/harden-pegs-for-supply.test.sql`

**Steps:**
1. Write one function that both `post-receipt` and `complete_job_to_inventory` call:

```sql
CREATE OR REPLACE FUNCTION harden_pegs_for_supply(
  p_company_id TEXT, p_user_id TEXT,
  p_supply_type "projectPegSupplyType", p_supply_id TEXT, p_quantity NUMERIC
) RETURNS TABLE ("projectId" TEXT, "quantity" NUMERIC, "pegId" TEXT)
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$ … $$;
```

2. The body does these steps:
   1. Lock the current Soft and Manual pegs of the supply `FOR UPDATE`. Order them by `needDate`, then `project.planningPriority`, then `demandSourceId`.
   2. Walk them, taking from `p_quantity` until it is used up.
   3. For a peg covered in full, supersede it. Insert a Hard copy with `hardenedAt = now()`.
   4. For a peg covered in part, supersede it. Insert a Hard row for the covered part and a Soft row for the rest.
   5. Return one row per Hard row inserted (`projectId`, `quantity`, `pegId`).
   6. If quantity is left after every peg, apply the group's excess rule. Return one more row with `pegId` NULL and `projectId` = the exception project, or NULL for **Common Stock**.
3. Call `assert_company_access(p_company_id)` first, like the other RPCs.
4. In `harden-pegs-for-supply.test.sql`, copy the fixture style of `job-completion-to-asset.test.sql` (an isolated company, `BEGIN` … `ROLLBACK`). Test 3 cases:
   1. Pegs of 20, 30 and 10 with a receipt of 60 return 3 rows and leave no Soft peg.
   2. A receipt of 25 returns 20 for the first and 5 for the second, and leaves Soft rows of 25 and 10.
   3. A receipt of 65 returns 4 rows, with the excess row last.
5. Run `pnpm db:migrate`, then `pnpm run generate:types`.

**Verify:**
```bash
pnpm exec tsx scripts/run-local-accounting-check.ts psql -X -f packages/database/supabase/tests/harden-pegs-for-supply.test.sql
# Expected: exit code 0 and no ERROR line
```

**Out of scope:** writing ledger rows (the callers do it).

---

## Task 10: Distribute grouped PO receipts and their reversals

**Depends on:** 9
**Files:**
- Modify: `packages/server-functions/src/post-receipt/index.ts`
- Create: `packages/server-functions/src/post-receipt/grouped-receipt.test.ts`

**Steps:**
1. For a received line whose PO line has `planningGroupId`:
   1. Call `harden_pegs_for_supply(companyId, userId, 'Purchase Order Line', purchaseOrderLineId, receivedQuantity)` inside the posting transaction.
   2. Write one `itemLedger` row and one `costLedger` layer per returned row, with `projectId` from the row and the receipt's unit cost.
   3. Set `projectPeg.itemLedgerId` on each returned `pegId`.
   4. Debit inventory once for the whole receipt, as for a common receipt. All stripes use the inventory account.
2. **Tracked items:** assign serials and lots to the returned rows in order. A lot that spans two rows gets two `itemLedger` rows with the same `trackedEntityId`.
3. **Reversal (receipt void):** reverse each striped row with its own `projectId` (Phase 2a rule). Then supersede the Hard pegs of those rows and insert Soft copies, so the next run can re-peg.
4. Write `grouped-receipt.test.ts` (`databaseTest`) with 2 cases:
   1. Receiving 60 against pegs of 20, 30 and 10 writes 3 striped rows and 3 Hard pegs.
   2. Voiding that receipt writes 3 reversing rows and turns the pegs Soft again.

**Verify:**
```bash
pnpm --filter @carbon/server-functions test -- post-receipt
# Expected: all tests pass
```

**Out of scope:** price variance (Task 12).

---

## Task 11: Distribute grouped job output

**Depends on:** 9
**Files:**
- Create: `packages/database/supabase/migrations/<timestamp>_complete-job-grouped.sql`
- Modify: `packages/server-functions/src/issue/project-issue.test.ts`

**Steps:**
1. Copy the latest `complete_job_to_inventory` (Phase 2a, Task 10) into a new migration.
2. If the job has `planningGroupId`:
   1. Call `harden_pegs_for_supply(…, 'Job', job id, completed quantity)`.
   2. Write the receipt rows per returned row, with its `projectId`, on the `itemLedger` inserts and on the `costLedger` Output rows.
   3. Set `projectPeg.itemLedgerId`.
3. Scrap and loss: the job's output unit cost already carries the scrap cost. Each stripe takes the same unit cost, so the scrap spreads by quantity, which is the PMMO proportional rule. No extra posting is needed.
4. Copy the backflush branch of Phase 2a: a grouped job's components draw from member stripes in the order of the job's pegs. If no member stock is left, they draw common stock.
5. Run `pnpm db:migrate`, then `pnpm run generate:types`.
6. Add a `databaseTest`: completing 3 of a grouped job with pegs 2 and 1 writes 2 striped receipt rows.

**Verify:**
```bash
pnpm --filter @carbon/server-functions test -- project-issue
# Expected: all tests pass
```

**Out of scope:** rework jobs. They follow the excess rule through `harden_pegs_for_supply`.

---

## Task 12: Charge price variance to member projects

**Depends on:** 10
**Files:**
- Modify: `packages/server-functions/src/post-purchase-invoice/index.ts` (`allocateVarianceAcrossLayers` calls at lines 1343 and 1406)
- Modify: `packages/utils/src/purchase-cost-adjustment.ts`

**Steps:**
1. Distribution wrote one layer per peg. So `allocateVarianceAcrossLayers` already spreads a variance over the hard pegs by quantity. The on-hand share revalues each stripe's layer.
2. Carry `projectId` through `VarianceAllocation` for each layer.
3. For the consumed share of a layer with `projectId`:
   1. Post it to the project's posting account (`project_posting_account`, Phase 1a) instead of the default variance account.
   2. Write a `Material Variance` row in that project's `projectLedger`.
4. Add a test: a +60.00 variance on a grouped line of 60 units, with P-101's 20 units already issued, writes 20.00 to P-101's ledger. It revalues the layers of P-102 and P-103 by 30.00 and 10.00.

**Verify:**
```bash
pnpm --filter @carbon/server-functions test -- post-purchase-invoice && pnpm --filter @carbon/utils test -- purchase-cost-adjustment
# Expected: all tests pass
```

**Out of scope:** supplier down payments (Phase 4 billing).

---

## Task 13: Add soft-peg commitments to the cost summary

**Depends on:** 7
**Files:**
- Create: `packages/database/supabase/migrations/<timestamp>_project-commitments-pegs.sql`

**Steps:**
1. Redefine `get_project_cost_summary` (Phase 1a, `projects-functions` migration). Add each current Soft or Manual peg on a `Purchase Order Line` to the committed amount: `peg quantity × the PO line's unit price`. Attribute it to the peg's element, or to the project root when the element is null.
2. Keep the direct lines' commitment unchanged.
3. Run `pnpm db:migrate`, then `pnpm run generate:types`.

**Verify:**
```bash
psql "$SUPABASE_DB_URL" -c "SELECT count(*) FROM get_project_cost_summary('<a dataset company id>', '<project id>');"
# Expected: the function runs without error
```

**Out of scope:** commitments for planned supply. A planning action is not a commitment.

---

## Task 14: Propose member Transfers and Borrows

**Depends on:** 6
**Files:**
- Modify: `packages/database/src/mrp-pegging.ts`, `mrp-pegging.test.ts`
- Modify: `packages/planning/src/mrp/planning-actions.ts`
- Modify: `apps/erp/app/modules/projects/projects.service.ts` — `createProjectStockTransferFromAction` handles Borrow

**Steps:**
1. Export `proposeMemberMoves({ members, horizonEndDate, leadTimeDays })` from `mrp-pegging.ts`. For each member: own stock, own demands with dates, and own supply.
   1. A member's **excess** is its stock beyond its own demand up to `horizonEndDate`.
   2. Walk the short members in priority order (Task 6 rule). Take from siblings with excess, in sibling id order.
   3. If the sibling has no own demand within the horizon, emit a **Transfer**.
   4. Else emit a **Borrow**. Its payback date is the sibling's next need date minus `leadTimeDays`, but never before today.
2. In `generatePlanningActions`, call it for each group segment. Emit each move as a candidate:
   - type `Transfer` or `Borrow`;
   - `planningSegmentId` = the group id;
   - `fromProjectId` = the sibling and `toProjectId` = the short member;
   - for a Borrow, put the payback date in `triggerValues.paybackDueDate`.
3. A move reduces the short member's demand before pegging (Task 6 step 2). A Transfer or Borrow never changes the group's net requirement.
4. Apply a Borrow action: create a Draft `projectStockTransfer` of type `Borrow` with the payback date.
5. Add 2 tests (the spec's sibling-excess case):
   1. A member short by 4, with a sibling that has 6 excess and no demand in the horizon, gets a Transfer of 4.
   2. If the sibling needs the stock in 3 weeks, the member gets a Borrow with a payback date of 3 weeks minus the lead time.

**Verify:**
```bash
pnpm --filter @carbon/database test -- mrp-pegging && pnpm --filter @carbon/planning test
# Expected: all tests pass
```

**Out of scope:** transfers between groups.

---

## Task 15: Add the Pegging tab and manual pegs

**Depends on:** 7
**Files:**
- Create: `apps/erp/app/routes/x+/project+/$projectId.pegging.tsx`
- Create: `apps/erp/app/routes/x+/project+/$projectId.pegging.manual.tsx`
- Create: `apps/erp/app/modules/projects/ui/Pegging/ProjectPegging.tsx`, `ManualPegForm.tsx`
- Modify: `apps/erp/app/modules/projects/projects.service.ts` — `getProjectPegs(client, { companyId, projectId, asOf })`
- Modify: `apps/erp/app/modules/projects/projects.server.ts` — `createManualPeg`
- Modify: `apps/erp/app/modules/projects/ui/Project/useProjectNavigation.tsx` — **Pegging** (members of a group)

**Steps:**
1. Use the `carbon-design` skill.
2. `getProjectPegs`:
   - with no `asOf`, read the rows with `supersededAt IS NULL`;
   - with an `asOf`, read the rows with `createdAt <= asOf AND (supersededAt IS NULL OR supersededAt > asOf)`.

   Embed the item, the element and the supply document's readable id.
3. The tab groups pegs by item. Each row shows the supply (PO line, job, or planned order), quantity, need date, state badge (Soft, Hard, Manual) and the element.
4. An **As of** date picker reloads with `asOf`. Use `@internationalized/date` for the value.
5. **Override** opens `ManualPegForm` (supply, quantity, reason required). `createManualPeg` checks `update: projects`, then uses the service role in one transaction:
   1. Supersede the Soft peg it replaces.
   2. Insert the Manual peg.
6. Show a Manual peg with an `exception` as a warning row.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exit code 0
```

**Out of scope:** pegging charts.

---

## Task 16: Extend the demo datasets

**Depends on:** 10, 11
**Files:**
- Modify: `packages/database/src/datasets/types.ts`, the projects tier, `data/satellite/*.ts`, `coverage.ts`

**Steps:**
1. In the satellite dataset, add planning group **Star Tracker** with 3 member projects. Each member has project stock and a plan-line material of `ST-050`.
2. Seed one received grouped PO line with its 3 striped receipt rows and 3 Hard pegs. Seed one open grouped PO line with Soft pegs.
3. Measure the new tables, and add `planningGroup` and `projectPeg` to `COVERAGE_FLOORS`.
4. Run `pnpm db:check:datasets`.

**Verify:**
```bash
pnpm db:check:datasets
# Expected: all four datasets pass
```

**Out of scope:** the other 3 datasets. Satellite is the A&D story.

---

## Task 17: Update the rules, AGENTS.md, docs and spec

**Depends on:** 1–16
**Files:**
- Modify: `.claude/rules/mrp-system.md`, `.claude/rules/projects-system.md`, `.claude/rules/inventory-system.md`
- Modify: `packages/planning/AGENTS.md`, `apps/erp/app/modules/projects/AGENTS.md`
- Modify: `docs/content/docs/reference/projects.mdx`
- Modify: `.ai/specs/2026-10-03-projects.md`

**Steps:**
1. Document these 5 points:
   1. the peg states and the one-way rule (Soft to Hard only through `harden_pegs_for_supply`);
   2. the diff-writer and its transaction;
   3. the distribution at receipt and at completion;
   4. the member moves;
   5. the history query.
2. In the spec, record these 4 decisions:
   1. **Peg write location:** the peg writer runs in the planning-action transaction, not in Phase 7, because pegs on planned supply need action ids.
   2. **Planned supply column:** `supplyType = 'Planning Action'` replaces `plannedOrderId`.
   3. **Scrap:** scrap spreads through the output unit cost; there is no separate posting.
   4. **Price variance:** the variance spread reuses `allocateVarianceAcrossLayers`.
3. Record the answer to the Gate.
4. Run the STE-80 review pass on every `.ai/` file you changed.

**Verify:**
```bash
cd docs && pnpm typecheck
# Expected: exit code 0
```

**Out of scope:** the changelog entry.

---

## Task 18: Verify in the browser

**Depends on:** 1–17
**Files:**
- Create: `.ai/playbooks/projects-phase-3.md` (written by `/test`)

**Steps:**
1. Run `/test` on a satellite dataset company. Run MRP after each setup step.
2. Cover these spec acceptance criteria:
   1. **Grouped demand:** with demands of 20, 30 and 10 and no stock, MRP emits one Order of 60 in the group segment. Applying it creates one PO line with `planningGroupId` and 3 Soft pegs of 20, 30 and 10.
   2. **Re-pegging before receipt:** P-103's demand drops to 5. The next run supersedes its peg with a 5 peg, and the history keeps the 10 peg. The project costs show the commitment move.
   3. **Distribution at receipt:** receiving 60 writes striped rows of 20, 30, 5, and 5 excess per the group rule. The pegs turn Hard. A later run does not change them.
   4. **Price variance spread:** an invoice price variance spreads over the stripes. Each project's share revalues its stock or lands as Material Variance in its ledger.
   5. **Sibling excess:** a member short by 4, with a sibling that has 6 excess, gets a Transfer action. With a sibling need in 3 weeks, it gets a Borrow action with a payback date.
   6. **Pegging history:** the Pegging tab with an **As of** date before the re-peg shows the 10 peg.
3. Save the playbook to `.ai/playbooks/projects-phase-3.md`.

**Verify:**
```bash
ls .ai/playbooks/projects-phase-3.md
# Expected: the file exists, and the /test run reports every step passed
```

**Out of scope:** Phase 4 billing.

## Execution notes

- Before Task 1: `@carbon/ee` does not depend on `@carbon/planning`, directly or through its workspace dependencies. Only `@carbon/jobs` and `erp` depend on `@carbon/planning`. So `@carbon/planning` may import `@carbon/ee` with no cycle.
- Task 1: `20261010145055_projects-3-enums.sql` and `20261010145057_planning-groups-and-pegs.sql` hold the plan's SQL. The second file also adds an index on `companyId` and on each FK column: `planningGroup` (location, exception project, `createdBy`, `updatedBy`), the 3 new `planningGroupId` columns (partial, not null), and `projectPeg` (group, project, item, location, `createdBy`).
- Task 1: `pnpm db:migrate` applied both files and regenerated the types and swagger. Then `authz sync` failed on the 2 new tables, which have no rule until Task 3, as in Phase 2a Task 1. The commit carries the regenerated MCP digest and workflow catalog (`job.planningGroupId` gains a label).
- Task 1 (beyond the plan's file list): the new FK on `purchaseOrderLine` made 2 bare embeds in `purchasing+/planning.update.tsx` fail with TS2589. Both now name `purchaseOrderLine_purchaseOrderId_fkey`, as the lesson on new FKs says. `erp`, `mes`, `@carbon/jobs`, `@carbon/server-functions`, `@carbon/planning` and `@carbon/ee` typecheck.
- Task 1 (open point for Task 6): `projectPeg.demandSourceType` uses `demandForecastSourceType`, which has no `Project Borrow` value. `PegDemand.sourceType` allows `Project Borrow`. So the peg writer cannot store a peg for a borrow demand. Task 6 or 7 must add the value or skip borrow demand.
- Task 2: `20261010145821_planning-group-segments.sql` redefines `project_planning_segment` as written and recreates the 5 views from `20261010133214`. Each new column is last, and every view keeps `WITH (security_invoker = true)`. The anon role reads 0 rows of `openJobMaterialLines`.
- Task 2 (deviation): `openJobMaterialLines` also carries the job's `projectElementId`. Task 5 needs the element of a member's job, and the view had no project columns. `openProjectBorrows` carries the borrower's priority as `projectPriority`; it joins `project` with a LEFT JOIN on `id` and `companyId`.
- Task 2: `ownerProjectId` is the row's `projectId` as the plan says, also on a job that does not receive to project stock. Such a job is supply in segment `''`, so it never reaches a group's pegging.
- Task 2: a grouped PO line or job stays in its group's segment when the group is inactive. Only the members leave the group then, through `project_planning_segment`.
- Task 2: on Carbon Development the 5 views give the same row counts and the same md5 over the old columns, before and after. The counts are PO lines 7, production 2, job materials 101, project materials 0 and borrows 0. `SELECT project_planning_segment('does-not-exist')` returns an empty string. A rolled-back smoke test checked 3 cases:
  1. a stocked project gives its own id;
  2. after it joins a group, it gives the group id;
  3. after the group turns inactive, it gives its own id again.
- Task 2: the TS twin `planningSegmentOf` (`plan-company.ts`) changes in Task 5, with the other `plan-company.ts` work. No company has a group before Task 4, so MRP output does not change between the 2 commits.
- Task 3: the 2 rules are in `manifest.ts` as written. `authz migration projects-3-rls` wrote `20261010150329_projects-3-rls.sql`. `pnpm db:migrate` then synced with no error: `planningGroup` has 4 policies, `projectPeg` has SELECT only, and RLS is on for both. `vitest run src/authz` passes (35), and `@carbon/database` and `@carbon/jobs` typecheck.
- Task 3 (beyond the plan's file list): `id-refs.ts` gains `projectPeg` (`demandSourceId`, `itemLedgerId`, `parentPegId`, `supplyId`). These hold row ids with no FK, so a backup restore into another company must rewrite them. The run ids are not row ids. The backups tests pass (58).
- Task 4 (gating): `PLANNING_GROUPS` (Business, Partner) is in `FEATURE_PLANS`. `upsertPlanningGroup` lives in `packages/ee/src/pegging/service.server.ts` (`@carbon/ee/pegging.server`) and calls `requireEntitlement` first. It also refuses a location of another company (the column has a single-column FK) and an exception project without project stock. The new and edit routes call `requireFeature` and turn an `EntitlementError` into a redirect with a flash. The list route loads with no plan check and shows `PlanningGroupsUpgradeOverlay` through `usePlanGate`. The nav lists **Planning Groups** under Configure on every plan.
- Task 4 (deviation): `deletePlanningGroup` stays in `projects.service.ts`, and its route has no plan check. So a company whose plan lapsed can still clean up, as Two-factor lets a downgrade disable. It refuses while a member, a grouped PO line or a grouped job exists, with 3 count reads in parallel. A peg's FK also refuses the delete.
- Task 4 (deviation): `planningGroupValidator` stays in `projects.models.ts`, as the plan's file list says. The ee function takes an inline input type, so `@carbon/ee` imports no app code. The UI files keep the plan's names, without `.ee.`.
- Task 4 (deviation): the location rule is a check in the `$projectId.details.tsx` action, not a validator refine, because the validator cannot read the group. The action also requires project stock. It reads that from the stored row once the project leaves Draft, because the disabled switch posts nothing. The action leaves `planningPriority` out of the update when it is empty, because the column is NOT NULL.
- Task 4 (deviation): `ProjectForm` shows **Planning Group** and **Planning Priority** on an existing project only. `createProject` and `copyProject` insert named columns, so a new project joins a group on its Details tab after it exists. The form reads the active groups with `getPlanningGroupsList`, like `useCipClasses`.
- Task 4: the group drawer lists the members with identifier, name, priority and status (`getPlanningGroupMembers`). The exception project picker lists the projects with project stock (`getStockOwnerProjects`). `erp` and `@carbon/ee` typecheck. The commit carries the regenerated MCP digest. Browser verification waits for Task 18; the new strings wait for the run's final `/translate` pass.
- Task 5: `DemandContributorBase` gains `projectId`, `projectElementId` and `needDate` (YYYY-MM-DD). A child contributor copies them through the existing spread. `explodeBom` takes `groupSegments`. In a group segment only, it scales the parent's contributors by `netRequirement / grossQty` before it copies them. Every other segment multiplies by 1, so its numbers are bit-for-bit the same.
- Task 5: `planCompany` sets the 3 fields on the contributors of a group segment. The sources are:
  1. a Project Material row: its project and element;
  2. a member's Job Material row: the job's project and element;
  3. a grouped job's Job Material row: no project. The need date is the job material's required date (due date less lead time), the plan line's required date, or the borrow's payback date.
- Task 5 (deviation): `DemandContributor` gains a `Project Borrow` variant (`projectBorrowId`). A borrow in a group segment now gets a contributor with the borrower project, as step 2 asks. It writes no lineage row: the `demandForecastSource` writer handles 3 source types and skips the rest.
- Task 5 (beyond the plan's file list): the TS twin of the segment rule changes here. `planningSegmentOf` takes the project-to-group map, so a member's stock nets in its group. `loadSegmentOnHand` (`planning-actions.ts`) takes the same map from `generatePlanningActions`, so the planning actions read the same on-hand as `planCompany`.
- Task 5 (gating): `runMrp` reads the company's planning groups and their members (2 queries). Only if a group exists does it import `companyHasFeature` from `@carbon/ee/plan.server`, lazily, and ask for `PLANNING_GROUPS`. A company with no group loads no commercial code. With the feature, `planCompany` gets `planningGroups` (active groups and members). Without it, `planCompany` gets `ungroupedPlanningGroupIds`. It maps each row that the views put in a group segment back to its owner project's own segment. A row with no owner (grouped supply) nets as common.
- Task 5 (deviation): `@carbon/planning` now depends on `@carbon/ee` (workspace). There is no cycle (see the note before Task 1). `packages/planning/AGENTS.md` said "never add a gate here"; it now names this one exception.
- Task 5 (known gap): without the feature, the planning RPCs still group on-hand by `project_planning_segment`, which knows nothing of the plan. So a company whose plan lapsed while it has groups sees group rows on the planning pages. MRP and the planning actions plan the members on their own.
- Task 5: the engine test (gross 30, members 20 and 10, on-hand 6, child contributors 16 and 8 with their elements and need dates) passes. 2 new `planCompany` tests pass: the members net in `plg_1` and draw the common surplus of 8, and without the feature they net in their own segments (20 and 10). The database MRP tests pass (36) and the planning suite passes (326) with the basic snapshot unchanged. `@carbon/planning`, `@carbon/database`, `@carbon/jobs` and `erp` typecheck.
- Task 6 (gating): the pure functions are in `packages/ee/src/pegging/mrp-pegging.ts`, exported as `@carbon/ee/pegging` (`pegging/index.ts`). The test is `packages/ee/src/pegging/mrp-pegging.test.ts`, so the verify command is `pnpm --filter @carbon/ee test -- mrp-pegging`. The 8 cases pass. The performance case (1 000 members, 20 000 demands, 3 000 supplies) runs in about 50 ms.
- Task 6 (deviation): a Hard peg is kept and never diffed, but it takes nothing from supply or demand. The open-supply views already leave out the received quantity, and the received stock is in the member's own stripe, which step 2 counts. Taking it again counted a receipt twice: after receiving 25 of 60, the open 35 would offer only 10. A Manual peg is on open supply, so it takes from its supply and its demand as the plan says.
- Task 6 (beyond the plan's types): `ExistingPeg` has an optional `projectElementId`, so a split part takes the job peg's element. `PegDemand` has an optional `parentPegKey`, which `splitGroupedJobDemand` sets to the job peg's id. It becomes `projectPeg.parentPegId`. `splitGroupedJobDemand` takes an optional `priorityOf(projectId)`, because a part takes the peg's project and so that project's priority.
- Task 6: `pegGroupSegment` merges demands with the same project, source type and source id (a job with 2 lines of the item is one demand). It does not peg a demand with no project: a grouped job's component demand stays unattributed until the job has pegs. `diffPegs` returns `{ keepIds, supersedeIds, inserts }`.
- Task 7 (open point from Task 1, decided): `20261010153423_project-peg-demand-source-type.sql` changes `projectPeg.demandSourceType` to the `demandSourceType` enum. Its 4 values (Sales Order, Job Material, Project Material, Project Borrow) are exactly `PegDemand.sourceType`. So a borrow's payback demand is pegged too. The table had no row and no view depends on it.
- Task 7 (gating): the writer is `packages/ee/src/pegging/peg-writer.ts` (`writeGroupPegs`). `@carbon/ee/pegging.server` now points at `pegging/server.ts`, which re-exports `upsertPlanningGroup` and the writer. `generatePlanningActions` imports it lazily, so a company without the feature loads no commercial code. The test is `packages/ee/src/pegging/peg-writer.write.test.ts`, not under `packages/planning`. It has its own local-database gate, because the `databaseTest` fixture is not exported from `@carbon/server-functions`.
- Task 7: `planCompany` returns `groupPegInputs`, one per (group, item, location). The demands are every top-level and BOM-derived contributor of a group segment key. A grouped job's material with no project gets `parentSupply` = the job. The supplies are the members' own stock and the open PO lines and jobs of the segment. `openPurchaseOrderLines.id` and `openProductionOrders.id` enter the input types as optional fields. The member priorities come from `project.planningPriority` (`projectPriorities`). With no group segment, `groupPegInputs` is empty. The golden snapshot is unchanged, and the golden test now also asserts the empty list.
- Task 7: `runMrp` passes `pegging` (run id, inputs, each group's priority rule, member priorities) only with PLANNING_GROUPS. It passes it even with no active group, so the writer supersedes the Soft pegs of a group that turned inactive. In the transaction, after `writePlanningActionDiff`, `writePegs` reads the non-Actioned Order and Make actions of the groups. It maps each candidate to its action id with `naturalKey` (`withPlannedPegSupplies`). Then it calls `writeGroupPegs`.
- Task 7 (deviation): the run id is `randomUUID()` from `node:crypto`, not `nanoid()`. `@carbon/planning` does not depend on `nanoid`, and the plan rules ask before a new production dependency.
- Task 7: `writeGroupPegs` reads the current pegs in one query. It splits job demand by the current Job pegs of every item (a parent job's pegs are on its own output item). It supersedes with `supersededAt = now()`, so a replaced row and its new row have the same timestamp. A current Soft peg of a (group, item, location) with no input this run is superseded. A Manual peg there gets the exception. Supersede, insert and exception writes go in batches of 500.
- Task 7: the 2 writer cases pass against the local database (rolled back). `@carbon/planning` passes (326) with the basic snapshot unchanged. `@carbon/ee`, `@carbon/planning`, `@carbon/jobs`, `@carbon/database` and `erp` typecheck. `check:workflow-catalog` is clean.
- Task 8: both `planning.update` routes resolve the order segments with `getPlanningSegmentOwners` (`projects.server.ts`), which reads `project` (project stock) and `planningGroup` in parallel. A segment that is neither one answers 404, as an unknown project did. In a group segment, an Order creates the PO line with `planningGroupId` and no `projectId`, and a Make creates the job with `planningGroupId`, no project and no `receiveToProjectStock`. A planned order joins an existing PO line only when the line has the same owner (`planningGroupId`, else `projectId`).
- Task 8 (beyond the plan's file list): `insertJob` (`production.service.ts`) takes `planningGroupId`, and the create branch of `upsertPurchaseOrderLine` (`purchasing.service.ts`) takes it too. `settleNewSupplyPlanningActions` returns `itemId`, `periodId` and `planningSegmentId` with each settled id, so the route can match a settled action to the supply it created. The commit carries the regenerated MCP digest.
- Task 8 (deviation): the Order button's suggested orders carry no action id, so the routes find the action through the settle. Each settled action of a group segment takes the first PO line or job created for its (item, week, segment). `moveActionPegsToSupply(db, { companyId, userId, moves })` takes every move of the request in one list. It runs one transaction: one UPDATE supersedes the actions' current pegs, and one INSERT copies them onto the new supply. The plan's signature named one action, which would be a transaction per action. A failed move is logged; the order stands, and the next MRP run re-pegs.
- Task 8: `move-action-pegs.test.ts` pins the 2 statements at the Kysely wire (2 cases). The same function also passed once against the local database with a temporary vitest config: 2 pegs moved, the 2 action pegs superseded, and the fixture rows deleted. The ERP vitest config sets `SUPABASE_DB_URL` to `postgresql://localhost`, so a committed database test cannot run in `erp`. `pnpm --filter erp test` passes (180 files, 2069 tests) and `erp` typechecks.
- Task 9: `20261010155314_harden-pegs-for-supply.sql` defines `harden_pegs_for_supply` as the plan writes it: SECURITY INVOKER, `assert_company_access` first, the pegs locked `FOR UPDATE` in need date, project priority and demand source order. A peg it takes is superseded, and a Hard row with `hardenedAt` replaces it. The Hard row keeps the peg's `createdByRunId`. The function uses `#variable_conflict use_column`, because its output columns (`projectId`, `quantity`) share names with the peg columns.
- Task 9 (deviation): the uncovered part of a peg keeps the peg's state, not always Soft. A Manual peg covered in part leaves a Manual row with its reason, so a receipt does not drop a planner's override.
- Task 9: the excess row reads the group from the pegs, else from the PO line's or job's `planningGroupId`. Without a group the excess goes to common stock (`projectId` NULL).
- Task 9: `harden-pegs-for-supply.test.sql` runs in an isolated company and rolls back. It passes 5 cases: the plan's 3 (60, 25, 65), excess to the exception project, and a second receipt that takes no Hard peg again. There is no `psql` binary here, so it ran as `/tmp/kpsql -X < packages/database/supabase/tests/harden-pegs-for-supply.test.sql` (exit 0, no ERROR line). `@carbon/database` typechecks.
- Task 10: `post-receipt` collects the receipt lines of grouped PO lines (a stocked item, not outside processing, a positive quantity). In the posting transaction it calls `harden_pegs_for_supply` per receipt line, then splits the line's item ledger rows and cost layers into the returned stripes. The journal does not change: one inventory debit per line. A receipt line split in 2 calls the function twice, and the second call takes the Soft rest of the first.
- Task 10 (beyond the plan's file list): the pure split and the 3 statements are in `post-receipt/grouped-receipt.ts` (`hardenPegsForSupply`, `allocateToStripes`, `stripeItemLedgerRows`, `stripeCostLedgerRows`, `linkPegsToItemLedger`, `softenPegsOfItemLedger`). `project-posting-test-fixture.ts` gains `addPlanningGroup`, `addPeg` and `planningGroupId` on a PO line.
- Task 10: a cost layer piece takes the receipt's unit cost, and the last piece of a layer takes the rounding rest, so the pieces add up to the layer. An invoice-first layer and a PO-cost layer of one line are cut by the same walk. Serial rows take the stripes in order. A lot that spans 2 stripes gets 2 rows with the same `trackedEntityId`.
- Task 10: each Hard peg's `itemLedgerId` is the first row written for it, set by one `UPDATE … FROM (VALUES …)`. The void runs one statement only when a PO line of the order has `planningGroupId`: it supersedes the current Hard pegs whose `itemLedgerId` is a row of the receipt and inserts a Soft copy of each. The reversing rows already copy each row's stripe.
- Task 10 (known gap): a negative receipt on a grouped line draws common stock, as before. It does not draw a member stripe or soften a peg.
- Task 10: `grouped-receipt.test.ts` has 4 pure cases and the plan's 2 database cases in one test (receive 60 against 20, 30 and 10; then void). The post-receipt tests pass (14). The full server-functions suite passes except `rows.test.ts` and `post-charge-transaction.test.ts`, the known shared-database races, which pass alone. The 5 job-completion and backflush pgTAP scripts and `harden-pegs-for-supply.test.sql` exit 0 with no ERROR line. `@carbon/server-functions` typechecks.
- Task 11: `20261010160658_complete-job-grouped.sql` forks `complete_job_to_inventory` from `20261010030228` and `backflush_job_materials` from `20261010023707`, the newest definitions (checked against the live functions). Make to Asset, consume-to-project, capital jobs, Receive to project stock, the guards, stamped layer children and project stripes are kept.
- Task 11: every stocked receipt now loops over a stripe list. A job without `planningGroupId` has one stripe (the output project or common stock) with the whole delta, so it writes the same rows as before. A grouped job calls `harden_pegs_for_supply('Job', job, delta)` once (one `array_agg` statement `WITH ORDINALITY`) and writes its untracked, batch, serial and seed-serial rows per returned row. Serial units take the stripes in order. Each Hard peg gets `itemLedgerId` (for serial units, one of the stripe's rows).
- Task 11: the Output layer is written per stripe at the job's unit cost (`ROUND(…, 5)`), and the last stripe takes the rounding rest. So scrap spreads by quantity, with no extra posting.
- Task 11: the backflush of a grouped job reads the job's current pegs (any state) in the order `harden_pegs_for_supply` walks and draws the members' stock in that order, then common stock. A grouped job with no peg draws common stock, as before. The migration changed no signature, so `generate:types` gave no diff.
- Task 11: the new `project-issue.test.ts` case completes 3 of a grouped job with pegs 2 and 1. It checks 2 striped receipt rows, 2 Output layers (65.33333 and 32.66667), the backflush (member A's 4, then 5 common) and 2 Hard pegs linked to their rows. `project-issue` passes (13), and the full server-functions suite passes (514). The 5 job-completion and backflush pgTAP scripts and `harden-pegs-for-supply.test.sql` exit 0 with no ERROR line.
