# Government Contracting Phase 5c — control and reporting — implementation plan

**Spec:** .ai/specs/2026-10-09-government-contracting.md
- *Phase 5c: control and reporting*; decisions 8, 12, 15–18; the Q1 answer
- the Phase 5c acceptance criteria

**Research:** .ai/research/government-contracting-layer.md (patterns 6, Answers 6–7, Recommended Approach 13 and 15)
**Branch:** projects-wbs-research-spec
**Prerequisite:** these plans are done and committed:
- projects Phases 1a, 1b, 1c and 2a (`projectLedger`, `get_project_cost_summary`, `projectBaseline`, `project.chargeAtReceipt`);
- government contracting Phases 5a and 5b (`project.costObjective`, Burden rows, the `GOVERNMENT_CONTRACTING` feature key).

If a named artifact does not exist, STOP and report.

## Scope of this plan

1. **Budget availability control.** `project.budgetControl` is None, Warn or Block, with `budgetTolerancePercent`. The check compares the nearest budgeted element's budget with its committed and actual cost plus the new amount. It runs at PO line save, PO finalize, Issue to Project and a job charged to the project.
2. **Timesheets only warn.** On a timesheet, a Block becomes a warning plus a notice to the project manager (CAM 6-404.6(10)).
3. **Earned value** for contracts under $50M:
   - control accounts (an element flag, with a control account manager) and work packages (a chargeable element below one, with a technique);
   - 6 techniques: 0/100, 50/50, Percent Complete, Milestone, Level of Effort and Apportioned;
   - BCWS from the baseline dates by fiscal period, BCWP from the technique, ACWP from the ledger by element of cost.
4. **The period snapshot.** `earnedValuePeriod` holds BCWS, BCWP and ACWP per work package. A trigger freezes it when the period closes (EIA-748 E24).
5. **The Costs tab** shows CV, SV, CPI, SPI, EAC and VAC per control account.
6. **The ACWP export** for Cobra: period-closed ACWP by charge number and element of cost, in hours and dollars, direct and burden.
7. **Material point of measurement:** Receipt or Issue (EIA-748 E14).
8. **Stop-work orders:** **Stop work** sets a Direct project On Hold with the order date and the 90-day end (FAR 52.242-15). **Resume** returns it to Released.

## Commercial gating (decided)

Brad decided on 2026-10-09 that Phase 5c is commercial (spec decision 18, Q1). Follow `.claude/rules/commercial-licensing.md`:
1. Reuse the `GOVERNMENT_CONTRACTING` feature key that Phase 5b added. If `FEATURE_PLANS` has no such key, STOP and report.
2. Put the engine in `packages/ee/src/project-control/`. Export it as `@carbon/ee/project-control` (client-safe) and `@carbon/ee/project-control.server` (server).
3. Embed `requireEntitlement(client, companyId, "GOVERNMENT_CONTRACTING")` at the top of every authoring function. These are the control settings, the element fields, `closeEarnedValuePeriod`, the ACWP export and `stopWork`.
4. Degrade at runtime with `companyHasFeature`: without the feature, `checkBudgetAvailability` returns "ok" and `getEarnedValue` returns `{ gated: true }`.
5. Do not gate `resumeWork`. A company that loses the feature must still be able to release a stopped project.
6. Show the gated sections with `UpgradeOverlaySection` or `UpgradeOverlayDialog` from `~/components/UpgradeOverlay`. Never hide them.
7. Name every new UI component `*.ee.tsx`. Run `pnpm --filter @carbon/checks license-headers` after you create files.

## Rules for the executor

- Read `.ai/lessons.md`, `.claude/rules/commercial-licensing.md`, `.claude/rules/numeric-precision.md`, `.claude/rules/date-handling.md`, `.claude/rules/authz-manifest.md`, `.claude/rules/projects-system.md`, `.claude/rules/indirect-rates.md` and `packages/server-functions/AGENTS.md` before Task 1.
- Before Task 1, run the checks below. If one prints nothing, STOP and report the missing artifact.

```bash
grep -n "GOVERNMENT_CONTRACTING" packages/ee/src/plan.ts
grep -n "costObjective" packages/database/src/types.ts | head -1
grep -n "burdenFiscalYear" packages/database/src/types.ts | head -1
grep -n "projectBaseline: {" packages/database/src/types.ts
grep -n "chargeAtReceipt" packages/database/src/types.ts | head -1
grep -n "export async function createProjectBaseline" apps/erp/app/modules/projects/projects.server.ts
```

- 🛑 A timesheet is never refused for budget. DCAAM 7641.90 §3.c(2): the nature of the work decides the charge, not the funds available.
- Never query in a loop. Read with `.in()` or one grouped SQL statement.
- Never use JavaScript `Date`. Use `@internationalized/date` for day arithmetic.
- Round money with `round()` from `@carbon/utils`. Keep indexes (CPI, SPI) at the internal scale.
- Never construct a database client in a `*.service.ts`.
- Use the `carbon-design` skill for every UI task.
- If a quoted code line or line number does not match the file, search for the quoted code. If you cannot find it, STOP and report.

## Decisions this plan makes

These correct or add to the spec. Task 22 records them there.

| # | Decision | Why |
|---|---|---|
| C1 | The engine lives in `packages/ee/src/project-control/`, not `@carbon/utils`. That includes `budgetAvailability` and `earnedValue`. | Q1 makes 5c commercial, so the engine must be ee code. |
| C2 | The budget check reads commitments and actual cost with 2 grouped queries over all the charged projects. It does not call `get_project_cost_summary` per project. When it checks a saved PO line, it leaves that line's own commitment out. | One RPC per project is a query in a loop. Without the exclusion, an edited line counts twice. |
| C3 | The check compares the budget with direct cost: commitments plus ledger cost without Burden rows. | Burden rows are memo rows by default, and element budgets are direct budgets. |
| C4 | Warn saves the document and flashes the overrun. Block refuses the save at PO line save, PO finalize, Issue to Project and a job charge. On a timesheet, Warn shows a warning. Block shows a warning and sends `ProjectBudgetExceeded` to the project owner. | Spec: "Timesheets only warn." The flash system has no warning type, so Warn uses a success flash with the overrun text. |
| C5 | A job charge checks only a consume-to-project job. Its new amount is job quantity × `itemCost.unitCost`, less the job's ledger cost already posted. | Only a consume-to-project job charges cost to the project. The posted cost is already in the actual cost. |
| C6 | The baseline snapshot gains `schedule`: each element's `startDate` and `targetDate`, with `formatVersion` 2. Change requests, the diff and the plan lock ignore it. Earned value uses the latest baseline with `formatVersion` ≥ 2 taken on or before the period end. A project without one is skipped with "Take a baseline first". | Phase 1c treats dates as progress fields, so a baseline holds no dates, but the spec spreads BCWS "from the baseline". |
| C7 | BAC is the baseline `budget` of the work package. A work package is a chargeable element with a technique whose nearest ancestor is a control account. A control account has no technique. | The spec defines both terms but not BAC or the link between them. |
| C8 | `projectElement.earnedValuePercent` (a fraction, 0–1) holds the Percent Complete value. | The spec's data model has no column for it. |
| C9 | Milestone: the work package's direct children are its weighted milestones. Each child's baseline `budget` is its weight, and its baseline `targetDate` places its BCWS. A child counts as earned when its state group is Completed. A work package with no budgeted child behaves as 0/100. | The research prefers weighted milestones. Carbon's milestones are project-level, not per work package. |
| C10 | BCWS by technique: 0/100 at the baseline end; 50/50 half at the baseline start and half at the end; Percent Complete, Level of Effort and Apportioned spread by day. BCWP: 0/100 on Completed; 50/50 half on Started, all on Completed; Percent Complete from C8; Level of Effort equals BCWS; Apportioned = factor × the base element's BCWP. | The spec names the techniques but not their rules. These follow the DAU Gold Card and NDIA guidance in the research. |
| C11 | ACWP's element of cost comes from the ledger cost type. Labor maps to Labor; Material, Material Variance and Payback Variance to Material; Outside Processing and Purchased Service to Subcontract; Machine, Overhead and Other Direct to Other Direct. Burden maps to G&A for a G&A pool, else to Overhead. v1 does not split Travel. | A Contract-treatment row debits Project WIP, so `account.elementOfCost` on the debit account says nothing. If Phase 5a added `projectLedger.elementOfCost`, use it instead. |
| C12 | `project.materialMeasurementPoint` is Receipt (default) or Issue. Issue holds back the Purchase Receipt Material rows of a project with `chargeAtReceipt` until project-stock issues consume them, first in first out by quantity. | Carbon's receipt posts straight into stock, so the spec's Stock point equals Receipt. Only `chargeAtReceipt` books material before its issue. |
| C13 | `earnedValuePeriod` also stores `projectId`, `controlAccountId`, `accountingPeriodId`, `technique`, `baselineId` and `bac`. Its trigger reads the period `FOR SHARE` and refuses any write to a Closed period. | The snapshot needs the period for the freeze. `FOR SHARE` serializes it against the close (lesson "A period snapshot written at close races Locked-period postings"). |
| C14 | The close checklist gains "Close earned value for the period" (Warning). It fails while a project with work packages has no snapshot for the period. The close page gets a **Close earned value** button. | The spec lists the item but not how it passes. |
| C15 | The ACWP export needs a Closed period. Each row is one charge number × element of cost, marked Direct or Burden. | Spec: "period-closed ACWP". Cobra maps rows to control accounts by charge number. |
| C16 | **Stop work** needs a Direct project in Released. A CHECK keeps `stopWorkDate` only on an On Hold project. The status route refuses Released while a stop-work order is open. | FAR 52.242-15 applies to contracts. Without the guard, the status menu would bypass **Resume**. |
| C17 | EAC = ACWP + (BAC − BCWP) ÷ CPI. When CPI has no value (no ACWP yet), EAC = BAC. VAC = BAC − EAC. | DAU Gold Card, the CPI method. |

## Progress

- [x] Task 1: Create the Phase 5c enum migration
- [x] Task 2: Create the project control migration
- [x] Task 3: Apply migrations, regenerate types, ship RLS
- [x] Task 4: Add the schedule to the baseline snapshot
- [x] Task 5: Add the ee package skeleton
- [x] Task 6: Add the pure budget engine
- [ ] Task 7: Add the pure earned value engine
- [ ] Task 8: Add `checkBudgetAvailability` and the budget notice
- [ ] Task 9: Check the budget at PO line save and PO finalize
- [ ] Task 10: Check the budget at Issue to Project and job charge
- [ ] Task 11: Warn on timesheets
- [ ] Task 12: Add the ACWP loader and the material point of measurement
- [ ] Task 13: Add `getEarnedValue` and `closeEarnedValuePeriod`
- [ ] Task 14: Add the close checklist task
- [ ] Task 15: Add the ACWP export
- [ ] Task 16: Add stop-work orders
- [ ] Task 17: Add the control fields to project settings and the element page
- [ ] Task 18: Add earned value to the Costs tab
- [ ] Task 19: Add Stop work and Resume to the project header
- [ ] Task 20: Extend the demo datasets
- [ ] Task 21: Run the scoped gates
- [ ] Task 22: Update the rules, docs and spec
- [ ] Task 23: Verify in the browser

## Dependencies

- Task 1 runs first. Task 2 needs Task 1. Task 3 needs Task 2.
- Task 4 needs Task 3. Task 5 needs Task 3. Tasks 6 and 7 need Task 5 and are independent of each other.
- Task 8 needs Task 6. Tasks 9, 10 and 11 need Task 8 and are independent of each other.
- Task 12 needs Task 5. Task 13 needs Tasks 4, 7 and 12. Task 14 needs Task 13. Task 15 needs Task 12.
- Task 16 needs Task 5. Task 17 needs Task 5. Task 18 needs Tasks 13 and 15. Task 19 needs Task 16.
- Task 20 needs Task 17. Task 21 needs Tasks 1–20. Task 22 needs Task 21. Task 23 runs last.

---

## Task 1: Create the Phase 5c enum migration

**Depends on:** none
**Files:**
- Create: `packages/database/supabase/migrations/<timestamp>_government-contracting-5c-enums.sql`
- Copy from (precedent): the Phase 5b enum migration (`*_government-contracting-5b-enums.sql`)

**Steps:**
1. Run `pnpm db:migrate:new government-contracting-5c-enums`.
2. Write only these statements. Phase 5a may already have created these types, so each `CREATE TYPE` has a guard.

```sql
DO $$ BEGIN
  CREATE TYPE "budgetControl" AS ENUM ('None', 'Warn', 'Block');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE "earnedValueTechnique" AS ENUM ('0/100', '50/50', 'Percent Complete', 'Milestone', 'Level of Effort', 'Apportioned');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
```

3. If a type exists with different values, STOP and report.

**Verify:**
```bash
grep -c "duplicate_object" packages/database/supabase/migrations/*_government-contracting-5c-enums.sql
# Expected: 2
```

**Out of scope:** columns and tables (Task 2).

---

## Task 2: Create the project control migration

**Depends on:** 1
**Files:**
- Create: `packages/database/supabase/migrations/<timestamp>_project-control.sql`
- Copy from (precedent): `packages/database/supabase/migrations/20261006220201_revenue-recognition-core.sql` (the `pg_constraint` guard at lines 158–168 and the close task insert at lines 143–152); `20260702044133_period-close-lifecycle.sql:69-131` (`check_accounting_period_open`)

**Steps:**
1. Run `pnpm db:migrate:new project-control`.
2. Write the SQL below. Add an index on `companyId` and on every FK column of `earnedValuePeriod`.
3. Wrap each `ADD CONSTRAINT` on an existing table in the `pg_constraint` guard of the precedent.
4. Phase 5a may already have added `budgetControl`, `budgetTolerancePercent` and `stopWorkDate`. `ADD COLUMN IF NOT EXISTS` skips them. If a column exists with another type, STOP and report.

```sql
ALTER TABLE "project"
  ADD COLUMN IF NOT EXISTS "budgetControl" "budgetControl" NOT NULL DEFAULT 'None',
  ADD COLUMN IF NOT EXISTS "budgetTolerancePercent" NUMERIC,          -- a fraction; null reads as 0
  ADD COLUMN IF NOT EXISTS "stopWorkDate" DATE,
  ADD COLUMN IF NOT EXISTS "materialMeasurementPoint" TEXT NOT NULL DEFAULT 'Receipt';
ALTER TABLE "project" ADD CONSTRAINT "project_budgetTolerance_check"
  CHECK ("budgetTolerancePercent" IS NULL OR "budgetTolerancePercent" >= 0);
ALTER TABLE "project" ADD CONSTRAINT "project_materialMeasurementPoint_check"
  CHECK ("materialMeasurementPoint" IN ('Receipt', 'Issue'));
ALTER TABLE "project" ADD CONSTRAINT "project_stopWork_check"
  CHECK ("stopWorkDate" IS NULL OR "status" = 'On Hold');

ALTER TABLE "projectElement"
  ADD COLUMN IF NOT EXISTS "isControlAccount" BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS "controlAccountManagerId" TEXT REFERENCES "user"("id"),
  ADD COLUMN IF NOT EXISTS "earnedValueTechnique" "earnedValueTechnique",
  ADD COLUMN IF NOT EXISTS "earnedValuePercent" NUMERIC,
  ADD COLUMN IF NOT EXISTS "apportionedToElementId" TEXT,
  ADD COLUMN IF NOT EXISTS "apportionedFactor" NUMERIC;
ALTER TABLE "projectElement" ADD CONSTRAINT "projectElement_apportioned_fkey"
  FOREIGN KEY ("apportionedToElementId", "projectId", "companyId")
  REFERENCES "projectElement"("id", "projectId", "companyId") ON DELETE SET NULL ("apportionedToElementId");
ALTER TABLE "projectElement" ADD CONSTRAINT "projectElement_apportioned_check"
  CHECK ("earnedValueTechnique" IS DISTINCT FROM 'Apportioned'
         OR ("apportionedToElementId" IS NOT NULL AND "apportionedFactor" > 0));
ALTER TABLE "projectElement" ADD CONSTRAINT "projectElement_earnedValuePercent_check"
  CHECK ("earnedValuePercent" IS NULL OR "earnedValuePercent" BETWEEN 0 AND 1);
ALTER TABLE "projectElement" ADD CONSTRAINT "projectElement_controlAccount_check"
  CHECK (NOT ("isControlAccount" AND "earnedValueTechnique" IS NOT NULL));

CREATE TABLE IF NOT EXISTS "earnedValuePeriod" (
  "id" TEXT NOT NULL DEFAULT id('evp'),
  "companyId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "projectElementId" TEXT NOT NULL,          -- the work package
  "controlAccountId" TEXT NOT NULL,          -- its control account element
  "accountingPeriodId" TEXT NOT NULL REFERENCES "accountingPeriod"("id") ON DELETE RESTRICT,
  "fiscalYear" INTEGER NOT NULL,
  "periodNumber" INTEGER NOT NULL,
  "technique" "earnedValueTechnique" NOT NULL,
  "baselineId" TEXT,
  "bac" NUMERIC NOT NULL,
  "bcws" NUMERIC NOT NULL,                   -- cumulative to the period end
  "bcwp" NUMERIC NOT NULL,
  "acwp" NUMERIC NOT NULL,
  "acwpHours" NUMERIC NOT NULL,
  "acwpByElement" JSONB NOT NULL,            -- { "Labor": n, "Material": n, "Subcontract": n, "Other Direct": n, "Overhead": n, "G&A": n }
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  CONSTRAINT "earnedValuePeriod_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "earnedValuePeriod_period_key" UNIQUE ("projectElementId", "accountingPeriodId", "companyId"),
  CONSTRAINT "earnedValuePeriod_project_fkey" FOREIGN KEY ("projectId", "companyId") REFERENCES "project"("id", "companyId") ON DELETE CASCADE,
  CONSTRAINT "earnedValuePeriod_element_fkey" FOREIGN KEY ("projectElementId", "projectId", "companyId") REFERENCES "projectElement"("id", "projectId", "companyId"),
  CONSTRAINT "earnedValuePeriod_controlAccount_fkey" FOREIGN KEY ("controlAccountId", "projectId", "companyId") REFERENCES "projectElement"("id", "projectId", "companyId"),
  CONSTRAINT "earnedValuePeriod_baseline_fkey" FOREIGN KEY ("baselineId", "companyId") REFERENCES "projectBaseline"("id", "companyId") ON DELETE SET NULL ("baselineId"),
  CONSTRAINT "earnedValuePeriod_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "earnedValuePeriod_project_idx" ON "earnedValuePeriod" ("companyId", "projectId", "accountingPeriodId");

-- C13: freeze at close. FOR SHARE waits behind an in-flight close.
CREATE OR REPLACE FUNCTION public.check_earned_value_period_open()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_status "periodCloseStatus";
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    SELECT "closeStatus" INTO v_status FROM "accountingPeriod" WHERE "id" = OLD."accountingPeriodId" FOR SHARE;
    IF v_status = 'Closed' THEN
      RAISE EXCEPTION 'Earned value of a closed period cannot change';
    END IF;
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    SELECT "closeStatus" INTO v_status FROM "accountingPeriod" WHERE "id" = NEW."accountingPeriodId" FOR SHARE;
    IF v_status = 'Closed' THEN
      RAISE EXCEPTION 'Earned value of a closed period cannot change';
    END IF;
    RETURN NEW;
  END IF;
  RETURN OLD;
END;
$$;
DROP TRIGGER IF EXISTS "earnedValuePeriod_check_period_open" ON "earnedValuePeriod";
CREATE TRIGGER "earnedValuePeriod_check_period_open"
  BEFORE INSERT OR UPDATE OR DELETE ON "earnedValuePeriod"
  FOR EACH ROW EXECUTE FUNCTION public.check_earned_value_period_open();

INSERT INTO "periodCloseTaskDefinition"
  ("companyId", "name", "taskType", "autoCheckKey", "sortOrder", "required", "severity", "active", "isSystem", "createdBy")
SELECT c."id", 'Close earned value for the period', 'Auto', 'earned-value-closed', 5, true, 'Warning', true, true, 'system'
FROM "company" c
WHERE EXISTS (SELECT 1 FROM "user" u WHERE u."id" = 'system')
  AND NOT EXISTS (
    SELECT 1 FROM "periodCloseTaskDefinition" d
    WHERE d."companyId" = c.id AND d.name = 'Close earned value for the period'
  );
```

5. 🛑 Task 14 ships the evaluator for `earned-value-closed`. Until it ships, the close page shows this task as failing. Do not run `pnpm db:migrate` on a shared database before Task 14 is merged.
6. If `check_accounting_period_open` in the precedent no longer matches lines 69–131, search for it. Copy only its pattern, not its body.

**Verify:**
```bash
grep -c "CREATE TABLE IF NOT EXISTS" packages/database/supabase/migrations/*_project-control.sql
# Expected: 1
grep -c "CREATE POLICY" packages/database/supabase/migrations/*_project-control.sql
# Expected: 0
```

**Out of scope:** an estimated-actuals log (research recommendation 15.2). Baselines over target (spec *Out of scope*).

---

## Task 3: Apply migrations, regenerate types, ship RLS

**Depends on:** 2
**Files:**
- Modify: `packages/database/src/authz/manifest.ts`
- Modify: `packages/database/src/seed-data.ts` — `periodCloseTaskDefinitions`
- Modify: generated types

**Steps:**
1. Add this rule in alphabetical order:

```ts
earnedValuePeriod: company("projects", { create: false, update: false, delete: false }),
```

2. `closeEarnedValuePeriod` writes the snapshot through Kysely, so users need no write policy.
3. Add this entry to `periodCloseTaskDefinitions`, after "Compute burden for the period":

```ts
{
  name: "Close earned value for the period",
  taskType: "Auto",
  autoCheckKey: "earned-value-closed",
  sortOrder: 5,
  required: true,
  severity: "Warning",
  active: true,
  isSystem: true
},
```

4. Run `pnpm db:migrate`.
5. Run `pnpm --filter @carbon/database authz migration project-control-rls`.
6. Run `pnpm run generate:types`.
7. Prove the freeze with a rolled-back psql transaction:
   1. `BEGIN;`
   2. Insert one `earnedValuePeriod` row for a Locked period.
   3. Set the period's `closeStatus` to `'Closed'`.
   4. Update the row. Expect the error "Earned value of a closed period cannot change".
   5. `ROLLBACK;`

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/database
# Expected: exit code 0
pnpm --filter @carbon/database test -- migration
# Expected: all tests pass
```

**Out of scope:** UI.

---

## Task 4: Add the schedule to the baseline snapshot

**Depends on:** 3
**Files:**
- Modify: `apps/erp/app/modules/projects/projects.models.ts` — `ProjectPlanSnapshot`, `toPlanSnapshot`, `diffPlanSnapshots`
- Modify: `apps/erp/app/modules/projects/projects.server.ts` — `loadPlanSnapshot`, `createProjectBaseline`
- Modify: `apps/erp/test/projects-snapshot.test.ts`

**Steps:**
1. Add `schedule?: { id: string; startDate: string | null; targetDate: string | null }[]` to `ProjectPlanSnapshot` (C6).
2. In `toPlanSnapshot`, build `schedule` from the element rows, sorted by `id`.
3. Leave `diffPlanSnapshots` unchanged. It must not diff `schedule`. Dates stay progress fields, so change requests and the plan lock ignore them.
4. In `createProjectBaseline`, insert `formatVersion: 2`.
5. Add 2 cases to `projects-snapshot.test.ts`:
   1. `toPlanSnapshot` returns each element's `startDate` and `targetDate` in `schedule`.
   2. A changed `targetDate` alone gives no diff.

**Verify:**
```bash
pnpm --filter erp test -- projects-snapshot
# Expected: all tests pass, including 2 new ones
```

**Out of scope:** backfilling older baselines. A project takes a new baseline to start earned value.

---

## Task 5: Add the ee package skeleton

**Depends on:** 3
**Files:**
- Modify: `packages/ee/package.json` — `exports`
- Create: `packages/ee/src/project-control/models.ts`, `types.ts`, `index.ts`, `server.ts`
- Copy from (precedent): `packages/ee/src/indirect-rates/` (Phase 5b)

**Steps:**
1. Add 2 exports:
   - `"./project-control": "./src/project-control/index.ts"`
   - `"./project-control.server": "./src/project-control/server.ts"`
2. In `models.ts`, export these zod validators:
   - `projectControlSettingsValidator`: `projectId`, `budgetControl`, `budgetTolerancePercent` (≥ 0, a fraction), `materialMeasurementPoint` (`Receipt` or `Issue`).
   - `elementEarnedValueValidator`: `elementId`, `isControlAccount`, `controlAccountManagerId` optional, `earnedValueTechnique` optional, `earnedValuePercent` optional (0–1), `apportionedToElementId` optional, `apportionedFactor` optional.
   - Refine 1: a control account has no technique.
   - Refine 2: Apportioned needs a base element and a factor above 0.
   - `stopWorkValidator`: `projectId`, `orderDate` (`YYYY-MM-DD`).
3. Also export the types and constants:

```ts
export type BudgetControl = Database["public"]["Enums"]["budgetControl"];
export type EarnedValueTechnique = Database["public"]["Enums"]["earnedValueTechnique"];
export const ACWP_ELEMENTS = ["Labor", "Material", "Subcontract", "Other Direct", "Overhead", "G&A"] as const;
export type AcwpElement = (typeof ACWP_ELEMENTS)[number];
export const STOP_WORK_DAYS = 90;
export const BUDGET_COMMITMENT_STATUSES = ["To Receive", "To Receive and Invoice", "To Invoice", "Planned"] as const;
```

4. `BUDGET_COMMITMENT_STATUSES` must equal the status list in `get_project_cost_summary`. Read the newest definition of that function and compare. If they differ, use the function's list.
5. `types.ts` derives row types from `@carbon/database` only. It never imports a server file.
6. `index.ts`: `export * from "./models"; export * from "./compute"; export type * from "./types";`. Leave the compute line commented out until Task 6.
7. `server.ts`: `export * from "./service.server";`. Leave it commented out until Task 8.
8. Run `pnpm --filter @carbon/checks license-headers`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/ee
# Expected: exit code 0
```

**Out of scope:** UI.

---

## Task 6: Add the pure budget engine

**Depends on:** 5
**Files:**
- Create: `packages/ee/src/project-control/compute.ts`
- Create: `packages/ee/src/project-control/compute.test.ts`

**Steps:**
1. Export these functions:

```ts
type ElementNode = { id: string; parentId: string | null; budget: number | null };

/** The element itself, else its nearest ancestor with a budget. Null when none has one. */
export function nearestBudgetedAncestor(elementId: string, elements: ElementNode[]): string | null;
/** The root and every descendant. */
export function subtreeIds(rootId: string, elements: ElementNode[]): string[];
export function budgetAvailability(input: {
  budget: number; committed: number; actual: number; newAmount: number; tolerancePercent: number;
}): { limit: number; projected: number; overBy: number; over: boolean };
```

2. `budgetAvailability`:
   - `limit = budget × (1 + tolerancePercent)`;
   - `projected = committed + actual + newAmount`;
   - `over = projected > limit && !equals(projected, limit)`;
   - `overBy = max(0, round(projected − limit))`.
3. Write `compute.test.ts` with these 5 cases:
   1. **Spec criterion "Budget control":** budget 10,000.00, tolerance 0, committed 6,000.00, actual 3,000.00, new 1,500.00. Expect `over` true and `overBy` 500.00.
   2. The same with tolerance 0.10 is not over.
   3. A charge on a child without a budget finds the parent's budget.
   4. A charge with no budgeted ancestor returns null.
   5. `subtreeIds` returns the root and 2 levels of children.
4. Uncomment the compute line in `index.ts`.

**Verify:**
```bash
pnpm --filter @carbon/ee test -- project-control/compute
# Expected: 5 passed
```

**Out of scope:** earned value (Task 7).

---

## Task 7: Add the pure earned value engine

**Depends on:** 5
**Files:**
- Modify: `packages/ee/src/project-control/compute.ts`
- Modify: `packages/ee/src/project-control/compute.test.ts`

**Steps:**
1. Export `plannedValue(input)` (C10). It returns the cumulative BCWS at `periodEnd`:

```ts
type PlannedInput = {
  technique: EarnedValueTechnique; bac: number;
  start: string | null; end: string | null;            // baseline dates, YYYY-MM-DD
  periodEnd: string;
  milestones: { budget: number; targetDate: string | null }[];   // baseline children (Milestone only)
};
```

   - 0/100: `bac` once `periodEnd ≥ end`, else 0.
   - 50/50: `bac / 2` once `periodEnd ≥ start`; `bac` once `periodEnd ≥ end`.
   - Milestone: `bac × Σ(budget of milestones with targetDate ≤ periodEnd) / Σ(budget)`. With no budgeted milestone, use the 0/100 rule (C9).
   - Percent Complete, Level of Effort, Apportioned: `bac × elapsed / total`.
     - `total` = `parseDate(end).compare(parseDate(start)) + 1` days.
     - `elapsed` = the days from `start` to `periodEnd`, plus 1, clamped to 0 and `total`.
   - With no `start` or `end`, return 0.
2. Export `earnedValue(input)`. It returns the cumulative BCWP:

```ts
type EarnedInput = {
  technique: EarnedValueTechnique; bac: number; bcws: number;
  stateGroup: "Backlog" | "Unstarted" | "Started" | "Completed" | "Cancelled";
  percent: number | null;                                        // earnedValuePercent
  milestones: { budget: number; completed: boolean }[];
  apportioned: { factor: number; baseBcwp: number } | null;
};
```

   - 0/100: `bac` when Completed, else 0.
   - 50/50: `bac` when Completed; `bac / 2` when Started; else 0.
   - Percent Complete: `bac × (percent ?? 0)`.
   - Milestone: `bac × Σ(budget of completed milestones) / Σ(budget)`. With no budgeted milestone, use the 0/100 rule.
   - Level of Effort: `bcws`.
   - Apportioned: `factor × baseBcwp`.
   - Round the result with `round()`.
3. Export `performanceIndexes({ bac, bcws, bcwp, acwp })` (C17). It returns:
   - `cv = bcwp − acwp`, `sv = bcwp − bcws`;
   - `cpi = acwp === 0 ? null : bcwp / acwp`, `spi = bcws === 0 ? null : bcwp / bcws`;
   - `eac = cpi === null ? bac : acwp + (bac − bcwp) / cpi`, `vac = bac − eac`.
4. Export `acwpElementFor(costType, poolType: IndirectPoolType | null): AcwpElement` with the mapping of C11.
5. Export `rollUpControlAccounts(packages)`. It sums `bac`, `bcws`, `bcwp`, `acwp` and `acwpHours` by `controlAccountId`, then adds `performanceIndexes` to each control account.
6. Export `holdUntilIssued(receipts, issues, periodEnd)` (C12):
   - `receipts`: `{ projectElementId, itemId, postingDate, quantity, amount }[]` (Purchase Receipt Material rows);
   - `issues`: `{ itemId, postingDate, quantity }[]` (project-stock issue quantities, positive);
   - it takes the issues on or before `periodEnd` against the receipts of each item, oldest receipt first;
   - it returns the recognized amount per element: `quantity issued × receipt amount / receipt quantity`.
7. Add these 8 test cases:
   1. **Spec criterion "Earned value":** a 50/50 work package with BAC 10,000.00 that started this period has BCWP 5,000.00.
   2. With ACWP 4,000.00 and BCWS 5,000.00, expect CPI 1.25 and SPI 1.
   3. A 0/100 work package with a baseline end after the period end has BCWS 0.
   4. Linear BCWS for 1–30 June at a period end of 15 June is half of BAC.
   5. Milestones with budgets 3,000.00 and 7,000.00, the first completed, give BCWP 3,000.00.
   6. Level of Effort BCWP equals BCWS.
   7. Apportioned with factor 0.1 and a base BCWP of 20,000.00 gives 2,000.00.
   8. `holdUntilIssued` with a receipt of 10 at 1,000.00 and issues of 4 recognizes 400.00.

**Verify:**
```bash
pnpm --filter @carbon/ee test -- project-control/compute
# Expected: 13 passed
```

**Out of scope:** the PERT cost formula and weighted X/Y splits other than 50/50.

---

## Task 8: Add `checkBudgetAvailability` and the budget notice

**Depends on:** 6
**Files:**
- Create: `packages/ee/src/project-control/service.server.ts`
- Create: `packages/ee/src/project-control/service.server.test.ts`
- Modify: `packages/notifications/src/index.ts` — `NotificationEvent.ProjectBudgetExceeded`
- Modify: every other file that names `NotificationEvent.TrainingReminder` (find them with `grep -rln "NotificationEvent.TrainingReminder" packages apps`)
- Copy from (precedent): `packages/ee/src/console.server.ts` (`companyHasFeature` degrade)

**Steps:**
1. Add `checkBudgetAvailability(db, client, input)`:

```ts
type BudgetCharge = {
  projectId: string; projectElementId: string | null; amount: number;
  excludePurchaseOrderLineIds?: string[];
};
type BudgetCheckInput = {
  companyId: string;
  source: "purchase" | "issue" | "job" | "timesheet";
  charges: BudgetCharge[];
};
type BudgetCheckResult = {
  status: "ok" | "warn" | "block";
  overruns: { projectId: string; projectName: string; elementId: string; readableId: string;
              elementName: string; budget: number; projected: number; overBy: number;
              budgetControl: BudgetControl; ownerId: string | null }[];
};
```

2. Its steps:
   1. If `companyHasFeature(client, companyId, { feature: "GOVERNMENT_CONTRACTING" })` is false, return `{ status: "ok", overruns: [] }`.
   2. Read the charged projects: `budgetControl`, `budgetTolerancePercent`, `ownerId`, `name` (one query). Drop the charges of projects with None. If none is left, return ok.
   3. Read the elements of those projects: `id`, `parentId`, `budget`, `readableId`, `name` (one `.in("projectId", …)` query).
   4. Read the commitments with one grouped query over `purchaseOrderLine` joined to `purchaseOrder`:
      - `GREATEST(purchaseQuantity − quantityReceived, 0) × unitPrice` per `projectElementId`;
      - only POs with a status in `BUDGET_COMMITMENT_STATUSES`;
      - leave out every id in `excludePurchaseOrderLineIds` (C2).
   5. Read the actual cost with one grouped query: Σ `projectLedger.amount` per `projectElementId`, without Burden rows (C3).
   6. For each charge, find `nearestBudgetedAncestor`. Skip a charge with no element or no budgeted ancestor.
   7. Sum the new amounts per budgeted ancestor. Sum the commitments and the actual cost over `subtreeIds` of that ancestor.
   8. Call `budgetAvailability` with the tolerance (null reads as 0).
   9. Status: `block` when one overrun is on a Block project and the source is not `timesheet`. Else `warn` when one overrun exists. Else `ok` (C4).
3. Export `budgetOverrunMessage(result, formatMoney: (n: number) => string): string` from `models.ts`. Each overrun reads "<readableId> <elementName> goes over its budget of <budget> by <overBy>." Join the overruns with a space.
4. Add `ProjectBudgetExceeded = "project-budget-exceeded"` to `NotificationEvent`. In each file the grep finds, add a branch next to `TrainingReminder`:
   - title "Budget exceeded on <project>";
   - body: the overrun message;
   - link: the project's Costs tab.
5. Write `service.server.test.ts` with a mocked client and a mocked `db`. Cover 3 cases:
   1. Without the feature, the result is ok and no query runs.
   2. A Block project with a purchase overrun gives `block`.
   3. The same overrun from a timesheet gives `warn`.
6. Uncomment `export * from "./service.server";` in `server.ts`.

**Verify:**
```bash
pnpm --filter @carbon/ee test -- project-control/service
# Expected: 3 passed
pnpm exec turbo run typecheck --filter=@carbon/ee --filter=@carbon/notifications --filter=@carbon/jobs --filter=erp
# Expected: exit code 0
```

**Out of scope:** a budget check inside the posting server functions. They cannot import `@carbon/ee`.

---

## Task 9: Check the budget at PO line save and PO finalize

**Depends on:** 8
**Files:**
- Modify: `apps/erp/app/routes/x+/purchase-order+/$orderId.new.tsx`
- Modify: `apps/erp/app/routes/x+/purchase-order+/$orderId.$lineId.details.tsx`
- Modify: `apps/erp/app/routes/x+/purchase-order+/$orderId.finalize.tsx`

**Steps:**
1. In the 2 line routes, after validation and before `upsertPurchaseOrderLine` (`purchasing.service.ts:2099`):
   1. If the line has a `projectId`, call `checkBudgetAvailability` with `source: "purchase"`.
   2. Pass one charge: the line's project and element, `amount = purchaseQuantity × unitPrice`.
   3. On the details route, pass `excludePurchaseOrderLineIds: [lineId]`.
2. If the status is `block`, return a validation error on the quantity field with `budgetOverrunMessage`. Do not save.
3. If the status is `warn`, save the line. Then flash `success("Line saved. " + budgetOverrunMessage(...))`.
4. In the finalize route, before `finalizePurchaseOrder` (about line 168):
   1. Read the order's lines that have a `projectId` (one query).
   2. Call `checkBudgetAvailability` with one charge per line and every line id in `excludePurchaseOrderLineIds`.
   3. If the status is `block`, redirect to the order with an error flash of the message. Do not finalize.
   4. If the status is `warn`, finalize and add the message to the success flash.
5. Format money with the company currency, as the routes already do for flashes.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exit code 0
```

**Out of scope:** kanban and planning PO lines (`api+/kanban.$id.tsx`, `purchasing+/planning.update.tsx`). They carry no charge number.

---

## Task 10: Check the budget at Issue to Project and job charge

**Depends on:** 8
**Files:**
- Modify: `apps/erp/app/routes/x+/projects+/issue.tsx` (projects Phase 1a Task 36)
- Modify: `apps/erp/app/routes/x+/job+/new.tsx`
- Modify: `apps/erp/app/routes/x+/job+/$jobId.details.tsx`

**Steps:**
1. In `issue.tsx`, before `postProjectIssue`:
   1. For direction Issue, read the item's `itemCost.unitCost` (one query).
   2. Call `checkBudgetAvailability` with `source: "issue"` and `amount = quantity × unitCost`.
   3. A Return is never checked.
2. If the status is `block`, return the message as the modal's error. Do not post.
3. If the status is `warn`, post. Then add the message to the success flash.
4. In both job routes, when `consumeToProject` is true (C5):
   1. Read the item's `itemCost.unitCost` and, on details, the job's Σ `projectLedger.amount` (one query each).
   2. Call `checkBudgetAvailability` with `source: "job"` and `amount = max(0, quantity × unitCost − posted)`.
   3. Apply the same block and warn rules before the job insert or update.
5. If `issue.tsx` has a different name or path in the Phase 1a code, search for `postProjectIssue(`. If you cannot find it, STOP and report.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exit code 0
```

**Out of scope:** bulk job creation (`bulk.new.tsx`). It sets no charge number.

---

## Task 11: Warn on timesheets

**Depends on:** 8
**Files:**
- Modify: `apps/erp/app/routes/x+/projects+/log-time.tsx`
- Modify: `apps/erp/app/routes/x+/projects+/timesheet.update.tsx`
- Modify: `apps/mes/app/routes/x+/timesheet.tsx`

**Steps:**
1. 🛑 Never refuse an entry for budget in these routes (spec decision 8).
2. After the entry saves, call `checkBudgetAvailability` with `source: "timesheet"`. The amount is hours × the labor category cost rate on the entry date. Use the rate rule of `rateOn` (projects Phase 1a Task 14).
3. If the status is `warn`, return the message as fetcher data. Show it under the entry as a warning.
4. For each overrun on a Block project with an `ownerId`, call `trigger("notify", { event: NotificationEvent.ProjectBudgetExceeded, companyId, documentId: projectId, recipient: { type: "user", userId: ownerId } })`.
5. Wrap the notice in `try`/`catch`. A failed send never fails the entry.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp --filter=mes
# Expected: exit code 0
```

**Out of scope:** Phase 5a's DCAA controls on the same routes.

---

## Task 12: Add the ACWP loader and the material point of measurement

**Depends on:** 5
**Files:**
- Create: `packages/ee/src/project-control/loaders.server.ts`

**Steps:**
1. Add `loadAcwp(db, { companyId, projectIds, from, to })`. `from` may be null for a cumulative read. It returns, per project and element, `{ hours, byElement: Record<AcwpElement, number>, direct: number, burden: number }`.
2. Read the ledger with one SQL statement:
   1. `projectLedger` rows of the projects with `postingDate` up to `to` (and from `from` when set).
   2. Left join `indirectPool` for the pool type of Burden rows.
   3. Group by `projectId`, `projectElementId`, `costType` and the pool type.
   4. Return Σ `amount`, and Σ `quantity` for Labor rows.
3. Map each group with `acwpElementFor`. Labor quantity adds to `hours`.
4. For the projects with `materialMeasurementPoint = 'Issue'` and `chargeAtReceipt` (C12):
   1. Read their Purchase Receipt Material rows (one query).
   2. Read their project-stock issues: `itemLedger` rows with `projectId` set, `documentType` Project Issue or Job Consumption, negative `quantity` (one query).
   3. Take the receipt rows out of the Material totals. Add back `holdUntilIssued(receipts, issues, to)`.
   4. For a period read (`from` set), apply the rule at `from − 1 day` and at `to`. Use the difference.
5. If `itemLedger.documentType` has no Job Consumption value, use the Phase 1a Task 18 value for job issues to a project. If you cannot find one, STOP and report.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/ee
# Expected: exit code 0
```

**Out of scope:** estimated actuals.

---

## Task 13: Add `getEarnedValue` and `closeEarnedValuePeriod`

**Depends on:** 4, 7, 12
**Files:**
- Modify: `packages/ee/src/project-control/service.server.ts`
- Modify: `packages/ee/src/project-control/loaders.server.ts`

**Steps:**
1. Add `loadWorkPackages(db, { companyId, projectIds, asOf })` in `loaders.server.ts`. It returns, per project:
   1. the elements: `id`, `parentId`, `readableId`, `name`, `isChargeable`, `isControlAccount`, `controlAccountManagerId`, `earnedValueTechnique`, `earnedValuePercent`, `apportionedToElementId`, `apportionedFactor`, and the state group from `projectState`;
   2. the latest `projectBaseline` with `formatVersion ≥ 2` and a `createdAt` date on or before `asOf` (C6).
   - Read each table once for all the projects.
2. Add `computeProjectEarnedValue(project, baseline, acwp, periodEnd)` in `service.server.ts`:
   1. A work package is an element with a technique whose nearest ancestor is a control account (C7).
   2. BAC is the baseline element's `budget`; null reads as 0. Dates come from the baseline `schedule`.
   3. Milestones are the baseline children of the work package (C9).
   4. Compute BCWS with `plannedValue` and BCWP with `earnedValue`. Compute Apportioned work packages last, from their base element's BCWP.
   5. ACWP is the `loadAcwp` total over `subtreeIds` of the work package.
   6. Roll up with `rollUpControlAccounts`.
3. Add `getEarnedValue(db, client, { companyId, projectId, asOf })`:
   1. If `companyHasFeature` is false, return `{ gated: true }`.
   2. Compute as of `asOf`. Return `{ gated: false, workPackages, controlAccounts, warnings }`.
   3. A project with work packages and no qualifying baseline returns the warning "Take a baseline first".
4. Add `getEarnedValueSnapshots(client, { companyId, projectId, accountingPeriodId })`. It reads `earnedValuePeriod` rows and rolls them up the same way.
5. Add `closeEarnedValuePeriod(db, client, { companyId, userId, accountingPeriodId })`:
   1. `requireEntitlement`.
   2. Read the period. Refuse an Open period with "Lock the period before you close earned value."
   3. Refuse a Closed period with "This period is closed. Its earned value is frozen."
   4. Derive the fiscal year and period number with `fiscalYearAndPeriodFor` when they are null.
   5. Find the projects with status Released, On Hold or Technically Complete that have a work package (one query).
   6. Load the work packages, the baselines and the cumulative ACWP for all of them.
   7. In one Kysely transaction, delete the period's `earnedValuePeriod` rows for those projects. Insert one row per work package. Fill `acwpByElement` from the ACWP.
   8. Return `{ projects, workPackages, warnings }`.
6. Add `updateProjectControlSettings(client, input)` and `updateElementEarnedValue(client, input)`. Each starts with `requireEntitlement`.
7. In `updateElementEarnedValue`, refuse a technique on an element that is not chargeable. Also refuse it when no ancestor is a control account. The message is "Mark a control account above this element first."

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/ee
# Expected: exit code 0
pnpm --filter @carbon/ee test -- project-control
# Expected: all tests pass
```

**Out of scope:** the IPMDAR CPD JSON export (spec *Out of scope*).

---

## Task 14: Add the close checklist task

**Depends on:** 13
**Files:**
- Modify: `apps/erp/app/modules/accounting/accounting.service.ts` — `computePeriodReadiness` (line 3304)
- Modify: `apps/erp/app/routes/x+/accounting+/periods.$periodId.close.tsx`
- Modify: `apps/erp/app/modules/accounting/accounting.periods.test.ts`

**Steps:**
1. In `computePeriodReadiness`, add 2 reads to the existing parallel reads:
   1. the count of distinct projects in Released, On Hold or Technically Complete that have an element with `earnedValueTechnique`;
   2. the count of distinct projects with an `earnedValuePeriod` row for the period (join `accountingPeriod` on `startDate` and `endDate`).
2. Add this check after `burden-computed`:

```ts
{
  autoCheckKey: "earned-value-closed",
  severity: "Warning",
  label: "Projects with work packages that have no earned value snapshot for this period",
  failing: evProjects > evSnapshots,
  count: Math.max(0, evProjects - evSnapshots)
},
```

3. In the close route, add an intent `close-earned-value`:
   1. Run `requirePermissions(request, { update: "accounting" })`.
   2. Call `requireFeature` with `feature: "GOVERNMENT_CONTRACTING"`.
   3. Call `closeEarnedValuePeriod(getDatabaseClient(), client, { companyId, userId, accountingPeriodId: periodId })`.
   4. Catch `EntitlementError`. Flash the warnings, or "Earned value closed for <n> projects".
4. Show a **Close earned value** button on that task row while it fails. Copy the `createRunIntent` button (lines 504–515 and 668–672).
5. Add 2 test cases: one project with a work package and no snapshot fails; with a snapshot it passes.

**Verify:**
```bash
pnpm --filter erp test -- accounting.periods
# Expected: all tests pass
pnpm exec turbo run typecheck --filter=erp
# Expected: exit code 0
```

**Out of scope:** making the task a Blocker.

---

## Task 15: Add the ACWP export

**Depends on:** 12
**Files:**
- Modify: `packages/ee/src/project-control/service.server.ts` — `buildAcwpExport`
- Create: `apps/erp/app/routes/api+/earned-value.acwp[.]csv.ts`
- Modify: `apps/erp/app/utils/path.ts` — `path.to.api.earnedValueAcwpCsv(periodId, projectId?)`
- Copy from (precedent): `apps/erp/app/routes/api+/integrations.$id.sync-activity[.]csv.ts`

**Steps:**
1. Add `buildAcwpExport(db, client, { companyId, accountingPeriodId, projectId })`. `projectId` is optional.
   1. `requireEntitlement`.
   2. Refuse unless the period is Closed: "Close the period before you export its actual cost." (C15).
   3. Take the projects with cost objective Direct, or only `projectId` when it is set.
   4. Call `loadAcwp` with the period's start and end dates.
   5. Return `{ fields, rows }` with one row per element × ACWP element with a non-zero amount.
2. Use these fields, in this order:

| Field | Value |
|---|---|
| Project | the project identifier |
| Charge Number | the element `readableId`; the project identifier at project level |
| Element | the element name |
| Control Account | the nearest control account's `readableId` |
| Fiscal Year, Period | from the period |
| Element of Cost | the `AcwpElement` |
| Cost Class | `Burden` for Overhead and G&A, else `Direct` |
| Hours | Labor rows only |
| Amount | the dollars |

3. In the route `loader`:
   1. Run `requirePermissions(request, { view: "projects" })`.
   2. Parse `periodId` and the optional `projectId`.
   3. Call `buildAcwpExport`. Catch `EntitlementError` and answer 402. Answer 400 with the message for a refusal.
   4. Return `encodeCsvTable(fields, rows)` with `CSV_CONTENT_TYPE` and the file name `acwp-<fiscalYear>-<period>.csv`.
4. Add one test case to `service.server.test.ts`: `buildAcwpExport` refuses an Open period.

**Verify:**
```bash
pnpm --filter @carbon/ee test -- project-control/service
# Expected: all tests pass
pnpm exec turbo run typecheck --filter=erp
# Expected: exit code 0
```

**Out of scope:** the Cobra import format itself. Cobra maps the columns on import.

---

## Task 16: Add stop-work orders

**Depends on:** 5
**Files:**
- Modify: `packages/ee/src/project-control/service.server.ts` — `stopWork`, `resumeWork`
- Modify: `packages/ee/src/project-control/compute.ts` — `stopWorkEnd`, `stopWorkDaysLeft`
- Create: `apps/erp/app/routes/x+/project+/$projectId.stop-work.tsx`
- Modify: `apps/erp/app/routes/x+/project+/$projectId.status.tsx`

**Steps:**
1. In `compute.ts`, add 2 pure functions and 2 test cases:
   - `stopWorkEnd(orderDate)`: `parseDate(orderDate).add({ days: STOP_WORK_DAYS }).toString()`;
   - `stopWorkDaysLeft(today, orderDate)`: `max(0, parseDate(stopWorkEnd(orderDate)).compare(parseDate(today)))`.
   - Tests: an order on 2026-10-01 ends on 2026-12-30; on 2026-10-11 it has 80 days left.
2. Add `stopWork(client, { companyId, userId, projectId, orderDate })`:
   1. `requireEntitlement`.
   2. Read the project. Refuse unless `costObjective` is Direct: "Stop-work orders apply to Direct projects."
   3. Refuse unless the status is Released.
   4. Set `status: "On Hold"` and `stopWorkDate: orderDate` in one update.
3. Add `resumeWork(client, { companyId, userId, projectId })`. Do not call `requireEntitlement`; add a comment that a downgrade must not strand a stopped project.
   1. Refuse unless `stopWorkDate` is set.
   2. Set `stopWorkDate: null` and `status: "Released"` in one update.
4. `assertChargeable` already refuses new charges on an On Hold project (projects Phase 1a Task 15). Commitments still post, as FAR 52.242-15 allows. Change nothing there.
5. The route action reads `intent`:
   - `stop`: `requirePermissions(request, { update: "projects" })`, `requireFeature`, validate with `stopWorkValidator`, then `stopWork`.
   - `resume`: `requirePermissions(request, { update: "projects" })`, then `resumeWork`.
   - Catch `EntitlementError`. Flash the result.
6. In `$projectId.status.tsx`, add a guard (C16). If the project has `stopWorkDate` and the new status is not On Hold, refuse the change. The message is "This project has a stop-work order. Use Resume."

**Verify:**
```bash
pnpm --filter @carbon/ee test -- project-control/compute
# Expected: all tests pass
pnpm exec turbo run typecheck --filter=@carbon/ee --filter=erp
# Expected: exit code 0
```

**Out of scope:** a stop-work history table. The audit log records each change.

---

## Task 17: Add the control fields to project settings and the element page

**Depends on:** 5
**Files:**
- Modify: `apps/erp/app/routes/x+/project+/$projectId.settings.tsx`
- Create: `apps/erp/app/modules/projects/ui/Project/ProjectControlSettings.ee.tsx`
- Modify: `apps/erp/app/modules/projects/ui/Element/ElementSidebar.tsx`
- Create: `apps/erp/app/modules/projects/ui/Element/ElementEarnedValue.ee.tsx`
- Modify: `apps/erp/app/routes/x+/project+/$projectId.elements.$elementId.tsx` — the action
- Copy from (precedent): `apps/erp/app/modules/projects/ui/Project/ProjectStates.tsx` (a settings section), `apps/erp/app/routes/x+/settings+/security.tsx` (`UpgradeOverlaySection`)

**Steps:**
1. `ProjectControlSettings.ee.tsx` is a section of the Settings tab. It has these fields:
   - **Budget control** (None, Warn, Block);
   - **Tolerance** (a percent, with `INPUT_FORMAT` for percent);
   - **Material measurement point** (Receipt, Issue), with the help text "Receipt counts material when it is received. Issue counts it when project stock is issued."
2. Its action intent `control-settings` runs `requirePermissions(request, { update: "projects" })`, then `requireFeature`, then `updateProjectControlSettings`.
3. `ElementEarnedValue.ee.tsx` is a sidebar section with these fields:
   - **Control account** (switch) and **Control account manager** (`User` picker);
   - **Earned value technique**: shown only on a chargeable element below a control account;
   - **Percent complete**: shown for Percent Complete;
   - **Base element** and **Factor**: shown for Apportioned.
4. Its action intent `earned-value` calls `updateElementEarnedValue`. Show its refusal as a field error.
5. If `usePlanGate({ feature: "GOVERNMENT_CONTRACTING" }).isGated`, render both sections through `UpgradeOverlaySection`.
6. Run `pnpm --filter @carbon/checks license-headers`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exit code 0
```

**Out of scope:** the Phase 5a project fields (cost objective, restrict charging).

---

## Task 18: Add earned value to the Costs tab

**Depends on:** 13, 15
**Files:**
- Modify: `apps/erp/app/routes/x+/project+/$projectId.costs.tsx`
- Create: `apps/erp/app/modules/projects/ui/Costs/ProjectEarnedValue.ee.tsx`
- Copy from (precedent): `apps/erp/app/modules/projects/ui/Costs/ProjectCostsTree.tsx` (projects Phase 1a)

**Steps:**
1. The loader reads `?evPeriod` (`current` or an accounting period id). For `current`, it calls `getEarnedValue` as of today in the company time zone. For a period id, it calls `getEarnedValueSnapshots`.
2. The loader also reads the company's Closed periods for the picker (one query).
3. `ProjectEarnedValue.ee.tsx` shows one row per control account, with its work packages below it. The columns are BAC, BCWS, BCWP, ACWP, CV, SV, CPI, SPI, EAC and VAC.
   - Money uses `useCurrencyFormatter`. CPI and SPI show 2 decimals with `useQuantityFormatter`. A null index shows "—".
   - Show CPI or SPI below 1 in the destructive text color.
4. A period picker switches between **Current** and each Closed period.
5. Show the warnings, for example "Take a baseline first", as an `Alert` above the table.
6. When the user picks a Closed period, show **Export ACWP** linking to `path.to.api.earnedValueAcwpCsv(periodId, projectId)`.
7. When `getEarnedValue` returns `{ gated: true }`, render `UpgradeOverlaySection` with the copy "Earned value: CPI, SPI and EAC per control account."
8. Render nothing when the project has no control account and the company is not gated.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exit code 0
```

**Out of scope:** S-curve charts.

---

## Task 19: Add Stop work and Resume to the project header

**Depends on:** 16
**Files:**
- Modify: `apps/erp/app/modules/projects/ui/Project/ProjectHeader.tsx`
- Create: `apps/erp/app/modules/projects/ui/Project/StopWorkModal.ee.tsx`
- Copy from (precedent): the status menu in `ProjectHeader.tsx` (projects Phase 1a Task 29)

**Steps:**
1. Show **Stop work** in the header menu for a Released Direct project. It opens `StopWorkModal.ee.tsx` with an order date (default today in the company time zone). It posts `intent: stop` to the stop-work route.
2. If the company is gated, **Stop work** opens `UpgradeOverlayDialog` instead.
3. When `stopWorkDate` is set, show a badge: "Stop-work order <date> · ends <date> · <n> days left". Compute the end and the days with `stopWorkEnd` and `stopWorkDaysLeft`. Show **Resume**, which posts `intent: resume`.
4. Format dates with `formatDate` from `@carbon/utils`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exit code 0
```

**Out of scope:** a notice to the customer.

---

## Task 20: Extend the demo datasets

**Depends on:** 17
**Files:**
- Modify: `packages/database/src/datasets/types.ts`, `packages/database/src/datasets/coverage.ts`
- Modify: the projects tier and the satellite projects data that projects Phase 1a Task 45 added (find them with `grep -rln "projectElement" packages/database/src/datasets/tiers packages/database/src/datasets/data/satellite`)

**Steps:**
1. Add optional fields to the satellite project element data: `isControlAccount`, `earnedValueTechnique`, `earnedValuePercent`.
2. On the satellite Direct project, mark 2 elements as control accounts.
3. Under them, give 4 work packages one technique each: 0/100, 50/50, Percent Complete (0.4) and Level of Effort.
4. Set `budgetControl: 'Warn'` and a tolerance of 0.05 on that project.
5. Seed no `earnedValuePeriod` rows. The close function writes them after the seed.
6. Run `pnpm db:check:datasets`.

**Verify:**
```bash
pnpm db:check:datasets
# Expected: all four datasets pass
```

**Out of scope:** the other 3 datasets.

---

## Task 21: Run the scoped gates

**Depends on:** 1–20
**Files:** none

**Steps:**
1. Run every command below.
2. Fix each failure in the task that owns the file. Then run the command again.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/ee --filter=@carbon/notifications --filter=@carbon/jobs --filter=erp --filter=mes
# Expected: exit code 0
pnpm --filter @carbon/ee test && pnpm --filter erp test
# Expected: all tests pass
pnpm run lint
# Expected: no errors
pnpm --filter @carbon/checks clobbers
# Expected: no clobbered functions or views
pnpm --filter erp build
# Expected: the build passes, with no "Server-only module referenced by client"
```

**Out of scope:** a whole-repo typecheck.

---

## Task 22: Update the rules, docs and spec

**Depends on:** 21
**Files:**
- Create: `.claude/rules/project-control.md`
- Modify: `.claude/rules/commercial-licensing.md` — the rollout list
- Modify: `.claude/rules/projects-system.md`
- Modify: `docs/content/docs/reference/projects.mdx`
- Modify: `.ai/specs/2026-10-09-government-contracting.md`

**Steps:**
1. Write the rule file with `paths:` frontmatter for `packages/ee/src/project-control/**` and the 4 route files that call `checkBudgetAvailability`. Cover these 5 points:
   1. where the budget check runs, and why timesheets only warn;
   2. the work package and BAC definitions (C7);
   3. the technique rules (C9, C10);
   4. the snapshot freeze and its `FOR SHARE` read (C13);
   5. the material point of measurement (C12).
2. Add a ✅ **Government contracting (5c)** entry to the rollout list. Note that `resumeWork` is deliberately not gated.
3. In `projects-system.md`, describe the baseline `schedule` (C6) and the stop-work guard (C16).
4. Add **Budget control**, **Earned value** and **Stop-work orders** sections to the projects reference page. State that they are available on the Business plan.
5. In the spec:
   1. Record decisions C1–C17.
   2. Correct *Data Model Changes*: `earnedValuePercent`, the `earnedValuePeriod` columns, and `materialMeasurementPoint` with 2 values.
   3. Correct *API / Service Changes*: the helpers live in `packages/ee`, and `close-earned-value-period` is the ee function `closeEarnedValuePeriod`.
   4. Mark Phase 5c done.
6. Run the STE-80 review pass on every `.ai/` file you changed.

**Verify:**
```bash
cd docs && pnpm typecheck
# Expected: exit code 0
```

**Out of scope:** the changelog entry.

---

## Task 23: Verify in the browser

**Depends on:** 1–22
**Files:**
- Create: `.ai/playbooks/government-contracting-phase-5c.md` (written by `/test`)

**Steps:**
1. Run `/test` on a satellite dataset company with accounting on and the Business plan.
2. Cover the spec's Phase 5c criteria:
   1. **Budget control:** set the project to Block with 0 % tolerance. Carbon refuses, at save, a PO line that takes an element over its budget. A timesheet entry that does the same saves with a warning. The project owner gets the notice.
   2. **Earned value:** take a baseline. A 50/50 work package with a budget of 10,000.00 that started this period shows BCWP 5,000.00. Its CPI and SPI show on the Costs tab.
   3. **Snapshot freeze:** lock the period, run **Close earned value**, then close the period. The snapshot for the period does not change after close.
   4. **Stop work:** **Stop work** sets the project On Hold with the order date and the 90-day end date. Carbon refuses a new charge. **Resume** returns it to Released.
3. Check the ACWP export. For the Closed period, **Export ACWP** downloads a CSV. It has charge numbers, elements of cost, hours and amounts.
4. Check the gate on a Community plan company. The earned value section shows the upgrade overlay. No budget check runs.
5. Save the playbook to `.ai/playbooks/government-contracting-phase-5c.md`.

**Verify:**
```bash
ls .ai/playbooks/government-contracting-phase-5c.md
# Expected: the file exists, and the /test run reports every step passed
```

**Out of scope:** Phase 5d.

## Execution notes

- Prerequisites: every check prints a line. Neither enum type exists in the database before Task 1, and `project` has no `budgetControl`, `budgetTolerancePercent` or `stopWorkDate` column.
- Task 1: the migration is `20261011224853_government-contracting-5c-enums.sql`. It is applied in Task 3.
- Tasks 1 and 2: the pre-commit backup check skips both commits, because the migrations are not applied yet. Tasks 1 and 2 ran together in a `BEGIN … ROLLBACK` dry run before the Task 2 commit. The dry run inserted the close task for 29 companies.
- Task 2:
  1. The migration is `20261011225048_project-control.sql`.
  2. `earnedValuePeriod` also has `updatedBy` and `updatedAt`. The migration rules require `updatedBy` on every table with `createdBy`.
  3. Indexes: `companyId`, the control account FK, `accountingPeriodId`, `baselineId` (partial) and `createdBy`. The unique key covers `projectElementId`, and `earnedValuePeriod_project_idx` covers `projectId`. `projectElement` also gets partial indexes on the 2 new FK columns, `controlAccountManagerId` and `apportionedToElementId`.
  4. Each `ADD CONSTRAINT` sits in one `DO` block per table with the `pg_constraint` guard.
  5. Risk, not changed: a delete of an Apportioned element's base element fails on `projectElement_apportioned_check`, because the FK sets `apportionedToElementId` to null. A project delete fails while a snapshot of a Closed period exists, because the freeze trigger refuses the cascade delete.
  6. 🛑 Until Task 14 ships the `earned-value-closed` evaluator, the close checklist shows "Close earned value for the period" as an open required task on this branch's database. A user can skip it.
- Task 3:
  1. The generated RLS migration is `20261011225309_project-control-rls.sql`. `pnpm db:migrate` ran a second time to record it. `authz check` reports no drift. The SELECT policy lets any employee of the company read, the default of `company("projects", …)`.
  2. The freeze proof ran in a rolled-back transaction on an Open period of a test company: set it Locked, insert a row, update it (allowed), set the period Closed, update again. The last update failed with "Earned value of a closed period cannot change".
  3. The regenerated types change the MCP digest (`tool-manifest.digest.json`); the commit carries it. `check:workflow-catalog` passes with no catalog change.
  4. `pnpm --filter @carbon/database test -- migration` runs the whole suite: 518 pass.
- Task 4:
  1. `PROJECT_BASELINE_FORMAT_VERSION` is now 2, and `insertProjectBaseline` writes it. No other code reads the constant.
  2. `ProjectPlanSnapshotKey` excludes `schedule`, so the code that loops over the 5 plan tables stays as it is. The schedule row type is `PlanScheduleRow`.
  3. `loadPlanSnapshot` also selects `startDate` and `targetDate` for `projectElement`. `toPlanSnapshot` builds `schedule` from the element rows. The element rows of the snapshot still hold only the plan-layer columns.
  4. `parsePlanSnapshot` also returns a stored `schedule`, so Task 13 can read it from a baseline. A version 1 baseline has none.
  5. A restore into another company does not rewrite the ids in `schedule`, the same open gap as the rest of the snapshot (run log follow-up, Phase 1c).
- Task 5:
  1. `BUDGET_COMMITMENT_STATUSES` equals the status list of the live `get_project_cost_summary` (last defined in `20261011151313_government-contracting-functions.sql`).
  2. `models.ts` also exports the enum value lists `budgetControls` and `earnedValueTechniques` (from `Constants`) and `MATERIAL_MEASUREMENT_POINTS` with its type. The validators use them. The validators follow `indirect-rates/models.ts` (`zfd` for form fields).
  3. `budgetTolerancePercent` is optional in `projectControlSettingsValidator`, because null reads as 0.
  4. `server.ts` holds `export {};` until Task 8, so the empty module is valid TypeScript.
  5. A dev server that is already running needs a restart before it resolves the 2 new export paths (lesson "A new package `exports` subpath 500s").
- Task 6:
  1. `nearestBudgetedAncestor` reads a budget of 0 as a budget (only null is "no budget"). Both tree walks stop on a parent loop.
  2. `ElementNode` is exported, so Task 8 and the test name the same type.
  3. `pnpm --filter @carbon/ee test -- project-control/compute` runs the whole suite (vitest ignores the filter after `--`). `pnpm exec vitest run src/project-control` in `packages/ee` runs the 5 tests.
