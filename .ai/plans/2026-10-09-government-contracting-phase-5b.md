# Government Contracting Phase 5b — indirect rates and burden — implementation plan

**Spec:** .ai/specs/2026-10-09-government-contracting.md
- *Phase 5b: indirect rates and burden*; decisions 9, 10, 15–19; the Q1 and Q3 answers
- the Phase 5b acceptance criteria; Risks: *A rate engine error misstates every Cost Plus invoice*
**Research:** .ai/research/government-contracting-layer.md (patterns 1–3, Answers 1–2, Recommended Approach 2–7)
**Branch:** projects-wbs-research-spec
**Prerequisite:** these plans are done and committed:
- projects Phases 1a, 1b and 1c (`projectLedger`, `get_project_cost_summary`, `project-posting.ts`, `projectBaseline`);
- field service Phase A (`projectBillableItem`);
- project billing Phases 4a and 4b (Cost Plus lines, `feePercent`, `generateCostPlusItems`, `insertProjectLedgerRows`, `planProjectInvoiceLines`, `create-project-billing-invoices`, `synthesizeProjectRevenue`, `projectCostRelief`);
- government contracting Phase 5a (`account.allowability`, `account.elementOfCost`, `project.costObjective`, `projectLedger.unallowable` set at posting, `payrollPeriodTotal`).

If a named artifact does not exist, STOP and report.

## Scope of this plan

Indirect pools, rates and burden, as Costpoint does them:
1. **Pools.** An `indirectPool` has a type, a base type, a cascade `sequence` and an applied account. `indirectPoolAccount` maps a GL account, optionally narrowed by one dimension value, to a pool as **Cost** or **Base**.
2. **Rates.** `indirectRate` holds one rate per pool × fiscal year × period × rate type. Users enter Provisional, Target and Final rates. The run computes Actual rates as YTD pool cost ÷ YTD base, in sequence order.
3. **Statement of Indirect Expenses.** The run writes pool cost by account into `indirectExpenseStatement`, with unallowable cost in its own column.
4. **Burden.** The burden run posts the YTD catch-up as Burden rows in `projectLedger`, one per element and pool. They are memo rows by default. A company setting posts them as applied burden: Dr Project WIP / Cr the pool's applied account.
5. **Burden billing.** For each Cost Plus line, the billing run bills burden at the lower of the Provisional rate and the line's ceiling. It bills by difference, so the same run handles first billing, re-burden and the year-end true-up at Final rates.
6. **The ICE export.** Schedules A, B, C, E, G, H, I, K and L, one CSV each.
7. **The UI:** Accounting → Indirect Rates and Indirect Pools, and the rate ceilings on the contract line.
8. **Project and close views:** the burden by pool on the project Costs tab, and the close checklist task "Compute burden for the period".

## Commercial gating (decided)

Brad decided on 2026-10-09 that Phase 5b is commercial (spec decision 18, Q1). Follow `.claude/rules/commercial-licensing.md`:
1. Add `GOVERNMENT_CONTRACTING: [Plan.Business, Plan.Partner]` to `FEATURE_PLANS` (`packages/ee/src/plan.ts`).
2. Put the engine in `packages/ee/src/indirect-rates/`. Export it as `@carbon/ee/indirect-rates` (client-safe) and `@carbon/ee/indirect-rates.server` (server).
3. Embed `requireEntitlement(client, companyId, "GOVERNMENT_CONTRACTING")` at the top of every authoring function and every run.
4. The monthly job degrades with `companyHasFeature`: without the feature, it skips the company.
5. Gate the Indirect Rates and Indirect Pools pages with `usePlanGate({ feature: "GOVERNMENT_CONTRACTING" })` and the upgrade overlay. Keep them visible in the navigation. The list loaders never redirect. The write actions call `requireFeature` and catch `EntitlementError`.
6. Name every new UI component `*.ee.tsx`. Run `pnpm --filter @carbon/checks license-headers` after you create files.

## Rules for the executor

- Read `.ai/lessons.md`, `.claude/rules/commercial-licensing.md`, `.claude/rules/numeric-precision.md`, `.claude/rules/date-handling.md`, `.claude/rules/authz-manifest.md`, `.claude/rules/projects-system.md`, `packages/server-functions/AGENTS.md` and `apps/erp/app/modules/accounting/AGENTS.md` before Task 1.
- Before Task 1, run the checks below. If one prints nothing, STOP and report the missing artifact.

```bash
grep -n "costObjective" packages/database/src/types.ts | head -1
grep -n "allowability" packages/database/src/types.ts | head -1
grep -n "elementOfCost" packages/database/src/types.ts | head -1
grep -n "feePercent" packages/database/src/types.ts | head -1
grep -n "projectCostRelief: {" packages/database/src/types.ts
grep -n "payrollPeriodTotal: {" packages/database/src/types.ts
grep -n "insertProjectLedgerRows" packages/server-functions/src/lib/project-posting.ts | head -1
grep -n "generateCostPlusItems" packages/ee/src/project-revenue/service.server.ts | head -1
grep -n "planProjectInvoiceLines" packages/utils/src/project-billing.ts | head -1
grep -n "synthesizeProjectRevenue" packages/server-functions/src/project-revenue/index.ts | head -1
grep -n "create-project-billing-invoices" packages/server-functions/src/invoke.ts
```

- 🛑 `@carbon/ee` depends on `@carbon/server-functions`. Never import `@carbon/ee` from `packages/server-functions`. The ee code calls server functions through `serverFns`.
- Round money with `round()` from `@carbon/utils`. Keep rates at the internal scale. Never use JavaScript `Date`; use `@internationalized/date`.
- Never query in a loop. Read with `.in()` or one grouped SQL statement.
- Never construct a database client in a `*.service.ts`. Pass `db` from `getDatabaseClient()` (ERP) or `getJobDatabaseClient()` (jobs).
- Use the `carbon-design` skill for every UI task.
- If a quoted code line or line number does not match the file, search for the quoted code. If you cannot find it, STOP and report.

## Decisions this plan makes

These correct or add to the spec. Task 21 records them there.

| # | Decision | Why |
|---|---|---|
| B1 | The engine lives in `packages/ee/src/indirect-rates/`, not `@carbon/utils`. The runs are ee functions: `computeIndirectRates`, `computeProjectBurden` and `computeBurdenBilling` (the spec's `compute-retroactive-billing`). One community server function, `post-project-burden`, writes the computed Burden rows and the optional journal in one transaction. | Q1 makes 5b commercial, so the engine must be ee code. `@carbon/ee` depends on `@carbon/server-functions`, so a server function cannot import the engine. |
| B2 | A pool's base has 2 sources: GL accounts mapped as **Base**, and project ledger cost of projects with cost objective Direct, Commercial, IR&D or B&P. A G&A pool leaves IR&D and B&P out of its base. The service refuses a Base mapping of `projectExpenseAccount` or `projectWorkInProgressAccount`. | Carbon posts all project labor and material to one WIP or expense account, so the GL alone cannot isolate direct labor dollars. IR&D and B&P cost belongs in the G&A pool, not its base. |
| B3 | The cascade carries burden in 3 ways. (1) Pool Q's rate × a GL cell that is Q's Base and P's Cost goes into P's cost. (2) Q's burden on IR&D and B&P project cost goes into the cost of the next G&A pool. (3) A Total Cost Input base takes every earlier pool's burden; a Value Added base takes every earlier pool's burden except Material Handling. Single-element bases take none. | This is the spec's cascade ("fringe on indirect labor goes into overhead; every lower pool goes into the G&A base through TCI") written as rules a test can pin. |
| B4 | A journal line matches the most specific mapping: the account plus a dimension value it carries, else the account alone. One cell maps as Cost to at most one pool (a unique index). | A cell in two pools would count its cost twice. |
| B5 | Burden ledger rows create no billable item: `generateCostPlusItems` skips them, and the T&M pricer already returns null for them. `computeBurdenBilling` bills burden by difference per contract line × pool × fiscal year: target = billable base × billing rate × (1 + fee %), minus every burden item already created. The billing rate is the Final rate when one exists, else the Provisional rate, capped by the line's ceiling. | The spec bills Burden rows and also creates retroactive items, which bills a rate change twice. One difference rule covers first billing, re-burden and true-up, and never touches a posted invoice. |
| B6 | `projectBillableItem.projectLedgerId` becomes nullable. A burden item carries `indirectPoolId`, `fiscalYear`, `burdenRate`, `burdenBase` and `postingDate`. | A burden item belongs to no single ledger row. The invoicing source needs a date to order it. |
| B7 | `offsetAbsorbedOverhead` (Q3): the rate uses the gross pool cost. A project's target burden on that pool = max(0, rate × base − the project's YTD Overhead ledger rows). The statement shows the absorbed overhead as a credit line, `'Absorbed Overhead'`. It does not reduce the rate's numerator. | Subtracting the absorbed overhead from the numerator and again from the burden would remove it twice. Shown as a credit, it reads as overhead applied by work centers. |
| B8 | Burden is computed per element. The catch-up key is project × element × pool × unallowable flag. Burden rows carry `burdenFiscalYear`. Burden on an unallowable base is an unallowable row. | Earned value (Phase 5c) needs ACWP per work package. The Final true-up may post after the year ends, so the year cannot come from `postingDate`. CAS 405-40(e) keeps unallowable cost in the base. |
| B9 | `companySettings` gains `burdenRateType` (Provisional or Actual, default Provisional) and `postAppliedBurden` (default false). | The spec names both settings but the data model omits them. |
| B10 | The burden run needs a Locked period. Applied burden posts as an accounting adjustment: a Locked period accepts it, a Closed period refuses it. | The spec's risk mitigation runs burden only on a locked period. `getOrCreateAccountingPeriod(..., "accounting")` (`accounting.service.ts:2369`) applies the same rule. |
| B11 | A new table `indirectRateRun` records each period run. The close task "Compute burden for the period" (Warning) passes when the period has a run with `burdenComputedAt`, or the company has no active pool that applies to projects. | The UI lists runs, and the close checklist needs a marker. |
| B12 | A user sets a rate "from period N". The service writes periods N to 12 with `periodRate = ytdRate = rate`. The service refuses to write an Actual rate. | Contracting officers set provisional rates per year, not per month. Only the run computes Actual rates. |
| B13 | Memo Burden rows stay out of cost relief with no code change. Phase 4b relieves only rows whose journal debit line is on an Asset account (4b decision R4). Applied burden is relieved with the rest of the cost. Task 11 pins this with a test. | Relieving a memo row would credit Project WIP that was never debited. |
| B14 | When `accountingPeriod.fiscalYear` or `periodNumber` is null, derive them with `fiscalYearAndPeriodFor` (`packages/utils/src/accounting.ts:79`). | Job-costing SQL creates periods without fiscal numbers. |
| B15 | The engine computes ICE schedules E, G, H, I, K and L at export time from the same readers as the run. Schedule G reconciles the project ledger to the journal lines behind it. | The ICE export needs no stored copy. Carbon holds contract cost in Project WIP, so a GL expense total cannot reconcile direct cost. |

## Progress

- [x] Task 1: Create the Phase 5b enum migration
- [x] Task 2: Create the indirect rates tables migration
- [x] Task 3: Apply migrations, regenerate types, ship RLS
- [x] Task 4: Add the feature key and the ee package skeleton
- [x] Task 5: Add the pure rate engine
- [x] Task 6: Add the pure burden and billing engine
- [x] Task 7: Add the authoring functions
- [x] Task 8: Add `computeIndirectRates`
- [x] Task 9: Add the `post-project-burden` server function
- [x] Task 10: Add `computeProjectBurden`, `computeBurdenBilling` and the period run
- [x] Task 11: Teach the Phase 4 billing readers about burden
- [x] Task 12: Add the monthly job and the lock trigger
- [x] Task 13: Add the close checklist task
- [x] Task 14: Add the ICE schedules and the CSV route
- [x] Task 15: Build the Indirect Pools pages
- [x] Task 16: Build the Indirect Rates, Statement and ICE pages
- [x] Task 17: Add rate ceilings to the contract line
- [x] Task 18: Add burden by pool to the project Costs tab
- [x] Task 19: Extend the demo datasets
- [x] Task 20: Run the scoped gates
- [x] Task 21: Update the rules, docs and spec
- [ ] Task 22: Verify in the browser

## Dependencies

- Task 1 runs first. Task 2 needs Task 1. Task 3 needs Task 2.
- Task 4 needs Task 3. Tasks 5 and 6 need Task 4 and are independent of each other.
- Task 7 needs Task 4. Task 8 needs Tasks 5 and 7. Task 9 needs Task 3.
- Task 10 needs Tasks 6, 8 and 9. Task 11 needs Task 3. Task 12 needs Task 10. Task 13 needs Task 10.
- Task 14 needs Tasks 8 and 10. Tasks 15, 16 and 17 need Task 7; Task 16 also needs Tasks 10 and 14.
- Task 18 needs Task 3. Task 19 needs Task 7. Task 20 needs Tasks 1–19. Task 21 needs Task 20. Task 22 runs last.

---

## Task 1: Create the Phase 5b enum migration

**Depends on:** none
**Files:**
- Create: `packages/database/supabase/migrations/<timestamp>_government-contracting-5b-enums.sql`
- Copy from (precedent): the Phase 3 enum migration in `.ai/plans/2026-10-08-projects-phase-3.md` Task 1

**Steps:**
1. Run `pnpm db:migrate:new government-contracting-5b-enums`.
2. Write only these statements. Phase 5a may already have created these types, so each `CREATE TYPE` has a guard.

```sql
DO $$ BEGIN
  CREATE TYPE "indirectPoolType" AS ENUM ('Fringe', 'Overhead', 'Material Handling', 'G&A', 'Service Center');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE "indirectBaseType" AS ENUM ('Total Labor Dollars', 'Direct Labor Dollars', 'Direct Labor Hours',
    'Direct Material Dollars', 'Total Cost Input', 'Value Added');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE "indirectRateType" AS ENUM ('Provisional', 'Target', 'Actual', 'Final');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE "indirectPoolAccountRole" AS ENUM ('Cost', 'Base');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
ALTER TYPE "journalEntrySourceType" ADD VALUE IF NOT EXISTS 'Burden';
ALTER TYPE "journalLineDocumentType" ADD VALUE IF NOT EXISTS 'Burden';
```

3. If a type exists with different values, STOP and report. Do not alter it.

**Verify:**
```bash
grep -c "duplicate_object" packages/database/supabase/migrations/*_government-contracting-5b-enums.sql
# Expected: 4
```

**Out of scope:** tables and columns (Task 2). A new enum value cannot be used in the transaction that adds it.

---

## Task 2: Create the indirect rates tables migration

**Depends on:** 1
**Files:**
- Create: `packages/database/supabase/migrations/<timestamp>_indirect-rates.sql`
- Copy from (precedent): `packages/database/supabase/migrations/20261006220201_revenue-recognition-core.sql` (the `pg_constraint` guard at lines 158–168 and the close task insert at lines 143–152)

**Steps:**
1. Run `pnpm db:migrate:new indirect-rates`.
2. Write the SQL below. Add an index on `companyId` and on every FK column of every new table.
3. Wrap each `ADD CONSTRAINT` on an existing table in the `pg_constraint` guard of the precedent.
4. Write no `CREATE POLICY`. Task 3 adds the RLS rules.

```sql
CREATE TABLE IF NOT EXISTS "indirectPool" (
  "id" TEXT NOT NULL DEFAULT id('ipl'),
  "companyId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "poolType" "indirectPoolType" NOT NULL,
  "sequence" INTEGER NOT NULL CHECK ("sequence" > 0),
  "baseType" "indirectBaseType" NOT NULL,
  "appliedAccountId" TEXT REFERENCES "account"("id") ON DELETE RESTRICT,
  "appliesToProjects" BOOLEAN NOT NULL DEFAULT TRUE,
  "offsetAbsorbedOverhead" BOOLEAN NOT NULL DEFAULT FALSE,
  "active" BOOLEAN NOT NULL DEFAULT TRUE,
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  CONSTRAINT "indirectPool_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "indirectPool_name_key" UNIQUE ("name", "companyId"),
  CONSTRAINT "indirectPool_sequence_key" UNIQUE ("sequence", "companyId"),
  CONSTRAINT "indirectPool_serviceCenter_check" CHECK ("poolType" <> 'Service Center' OR NOT "appliesToProjects"),
  CONSTRAINT "indirectPool_offset_check" CHECK (NOT "offsetAbsorbedOverhead" OR "poolType" = 'Overhead'),
  CONSTRAINT "indirectPool_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS "indirectPoolAccount" (
  "id" TEXT NOT NULL DEFAULT id('ipa'),
  "companyId" TEXT NOT NULL,
  "indirectPoolId" TEXT NOT NULL,
  "accountId" TEXT NOT NULL REFERENCES "account"("id") ON DELETE RESTRICT,
  "dimensionId" TEXT REFERENCES "dimension"("id") ON DELETE CASCADE,
  "dimensionValueId" TEXT,                 -- polymorphic, like journalLineDimension.valueId
  "role" "indirectPoolAccountRole" NOT NULL,
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  CONSTRAINT "indirectPoolAccount_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "indirectPoolAccount_pool_fkey" FOREIGN KEY ("indirectPoolId", "companyId") REFERENCES "indirectPool"("id", "companyId") ON DELETE CASCADE,
  CONSTRAINT "indirectPoolAccount_dimension_check" CHECK (("dimensionId" IS NULL) = ("dimensionValueId" IS NULL)),
  CONSTRAINT "indirectPoolAccount_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "indirectPoolAccount_cell_key"
  ON "indirectPoolAccount" ("indirectPoolId", "accountId", COALESCE("dimensionValueId", ''), "role", "companyId");
-- B4: one cell is Cost in at most one pool
CREATE UNIQUE INDEX IF NOT EXISTS "indirectPoolAccount_cost_key"
  ON "indirectPoolAccount" ("companyId", "accountId", COALESCE("dimensionValueId", '')) WHERE "role" = 'Cost';

CREATE TABLE IF NOT EXISTS "indirectRate" (
  "id" TEXT NOT NULL DEFAULT id('irt'),
  "companyId" TEXT NOT NULL,
  "indirectPoolId" TEXT NOT NULL,
  "fiscalYear" INTEGER NOT NULL,
  "periodNumber" INTEGER NOT NULL CHECK ("periodNumber" BETWEEN 1 AND 12),
  "rateType" "indirectRateType" NOT NULL,
  "periodRate" NUMERIC,
  "ytdRate" NUMERIC NOT NULL,
  "poolCost" NUMERIC,              -- Actual only: YTD allowable pool cost
  "unallowableCost" NUMERIC,       -- Actual only
  "baseAmount" NUMERIC,            -- Actual only: YTD base
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  CONSTRAINT "indirectRate_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "indirectRate_period_key" UNIQUE ("indirectPoolId", "fiscalYear", "periodNumber", "rateType", "companyId"),
  CONSTRAINT "indirectRate_pool_fkey" FOREIGN KEY ("indirectPoolId", "companyId") REFERENCES "indirectPool"("id", "companyId") ON DELETE CASCADE,
  CONSTRAINT "indirectRate_actual_check" CHECK ("rateType" <> 'Actual' OR "baseAmount" IS NOT NULL),
  CONSTRAINT "indirectRate_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS "indirectExpenseStatement" (
  "id" TEXT NOT NULL DEFAULT id('ies'),
  "companyId" TEXT NOT NULL,
  "indirectPoolId" TEXT NOT NULL,
  "fiscalYear" INTEGER NOT NULL,
  "periodNumber" INTEGER NOT NULL,
  "lineType" TEXT NOT NULL CHECK ("lineType" IN ('Account', 'Carried Burden', 'Absorbed Overhead')),
  "accountId" TEXT REFERENCES "account"("id") ON DELETE RESTRICT,
  "dimensionValueId" TEXT,
  "sourcePoolId" TEXT,
  "amount" NUMERIC NOT NULL,                       -- YTD through the period
  "unallowableAmount" NUMERIC NOT NULL DEFAULT 0,
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  CONSTRAINT "indirectExpenseStatement_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "indirectExpenseStatement_pool_fkey" FOREIGN KEY ("indirectPoolId", "companyId") REFERENCES "indirectPool"("id", "companyId") ON DELETE CASCADE,
  CONSTRAINT "indirectExpenseStatement_source_fkey" FOREIGN KEY ("sourcePoolId", "companyId") REFERENCES "indirectPool"("id", "companyId") ON DELETE CASCADE,
  CONSTRAINT "indirectExpenseStatement_source_check" CHECK (("lineType" = 'Carried Burden') = ("sourcePoolId" IS NOT NULL)),
  CONSTRAINT "indirectExpenseStatement_account_check" CHECK ("lineType" = 'Carried Burden' OR "accountId" IS NOT NULL),
  CONSTRAINT "indirectExpenseStatement_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "indirectExpenseStatement_period_idx"
  ON "indirectExpenseStatement" ("companyId", "indirectPoolId", "fiscalYear", "periodNumber");

CREATE TABLE IF NOT EXISTS "customerContractRateCeiling" (
  "id" TEXT NOT NULL DEFAULT id('crc'),
  "companyId" TEXT NOT NULL,
  "customerContractLineId" TEXT NOT NULL,
  "indirectPoolId" TEXT NOT NULL,
  "ceilingRate" NUMERIC NOT NULL CHECK ("ceilingRate" >= 0),
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  CONSTRAINT "customerContractRateCeiling_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "customerContractRateCeiling_key" UNIQUE ("customerContractLineId", "indirectPoolId", "companyId"),
  CONSTRAINT "customerContractRateCeiling_line_fkey" FOREIGN KEY ("customerContractLineId", "companyId") REFERENCES "customerContractLine"("id", "companyId") ON DELETE CASCADE,
  CONSTRAINT "customerContractRateCeiling_pool_fkey" FOREIGN KEY ("indirectPoolId", "companyId") REFERENCES "indirectPool"("id", "companyId") ON DELETE CASCADE,
  CONSTRAINT "customerContractRateCeiling_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS "indirectRateRun" (
  "id" TEXT NOT NULL DEFAULT id('irr'),
  "companyId" TEXT NOT NULL,
  "accountingPeriodId" TEXT NOT NULL REFERENCES "accountingPeriod"("id") ON DELETE CASCADE,
  "fiscalYear" INTEGER NOT NULL,
  "periodNumber" INTEGER NOT NULL,
  "burdenRateType" "indirectRateType",
  "ratesComputedAt" TIMESTAMP WITH TIME ZONE,
  "burdenComputedAt" TIMESTAMP WITH TIME ZONE,
  "billingComputedAt" TIMESTAMP WITH TIME ZONE,
  "burdenRowCount" INTEGER NOT NULL DEFAULT 0,
  "billableItemCount" INTEGER NOT NULL DEFAULT 0,
  "error" TEXT,
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  CONSTRAINT "indirectRateRun_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "indirectRateRun_period_key" UNIQUE ("accountingPeriodId", "companyId"),
  CONSTRAINT "indirectRateRun_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE
);

ALTER TABLE "projectLedger"
  ADD COLUMN IF NOT EXISTS "indirectPoolId" TEXT,
  ADD COLUMN IF NOT EXISTS "indirectRateType" "indirectRateType",
  ADD COLUMN IF NOT EXISTS "burdenFiscalYear" INTEGER;
ALTER TABLE "projectLedger" ADD CONSTRAINT "projectLedger_pool_fkey"
  FOREIGN KEY ("indirectPoolId", "companyId") REFERENCES "indirectPool"("id", "companyId");
ALTER TABLE "projectLedger" ADD CONSTRAINT "projectLedger_burden_check"
  CHECK (("costType" = 'Burden') = ("indirectPoolId" IS NOT NULL AND "indirectRateType" IS NOT NULL AND "burdenFiscalYear" IS NOT NULL));
CREATE INDEX IF NOT EXISTS "projectLedger_burden_idx"
  ON "projectLedger" ("companyId", "projectId", "indirectPoolId", "burdenFiscalYear") WHERE "costType" = 'Burden';

ALTER TABLE "projectBillableItem"
  ALTER COLUMN "projectLedgerId" DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS "indirectPoolId" TEXT,
  ADD COLUMN IF NOT EXISTS "fiscalYear" INTEGER,
  ADD COLUMN IF NOT EXISTS "burdenRate" NUMERIC,
  ADD COLUMN IF NOT EXISTS "burdenBase" NUMERIC,
  ADD COLUMN IF NOT EXISTS "postingDate" DATE;
ALTER TABLE "projectBillableItem" ADD CONSTRAINT "projectBillableItem_pool_fkey"
  FOREIGN KEY ("indirectPoolId", "companyId") REFERENCES "indirectPool"("id", "companyId");
ALTER TABLE "projectBillableItem" ADD CONSTRAINT "projectBillableItem_source_check"
  CHECK ("projectLedgerId" IS NOT NULL OR ("indirectPoolId" IS NOT NULL AND "customerContractLineId" IS NOT NULL
    AND "fiscalYear" IS NOT NULL AND "postingDate" IS NOT NULL));
CREATE INDEX IF NOT EXISTS "projectBillableItem_burden_idx"
  ON "projectBillableItem" ("companyId", "customerContractLineId", "indirectPoolId", "fiscalYear") WHERE "indirectPoolId" IS NOT NULL;

ALTER TABLE "companySettings"
  ADD COLUMN IF NOT EXISTS "burdenRateType" "indirectRateType" NOT NULL DEFAULT 'Provisional',
  ADD COLUMN IF NOT EXISTS "postAppliedBurden" BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE "companySettings" ADD CONSTRAINT "companySettings_burdenRateType_check"
  CHECK ("burdenRateType" IN ('Provisional', 'Actual'));

-- The project Costs tab reads burden by pool (Task 18).
CREATE OR REPLACE FUNCTION get_project_burden_summary(p_project_id TEXT, p_company_id TEXT)
RETURNS TABLE ("projectElementId" TEXT, "indirectPoolId" TEXT, "poolName" TEXT, "amount" NUMERIC, "unallowableAmount" NUMERIC)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  SELECT pl."projectElementId", pl."indirectPoolId", p."name",
         SUM(pl."amount"), SUM(CASE WHEN pl."unallowable" THEN pl."amount" ELSE 0 END)
  FROM "projectLedger" pl
  JOIN "indirectPool" p ON p."id" = pl."indirectPoolId" AND p."companyId" = pl."companyId"
  WHERE pl."projectId" = p_project_id AND pl."companyId" = p_company_id AND pl."costType" = 'Burden'
  GROUP BY pl."projectElementId", pl."indirectPoolId", p."name";
$$;

INSERT INTO "periodCloseTaskDefinition"
  ("companyId", "name", "taskType", "autoCheckKey", "sortOrder", "required", "severity", "active", "isSystem", "createdBy")
SELECT c."id", 'Compute burden for the period', 'Auto', 'burden-computed', 5, true, 'Warning', true, true, 'system'
FROM "company" c
WHERE EXISTS (SELECT 1 FROM "user" u WHERE u."id" = 'system')
  AND NOT EXISTS (
    SELECT 1 FROM "periodCloseTaskDefinition" d
    WHERE d."companyId" = c.id AND d.name = 'Compute burden for the period'
  );
```

5. 🛑 Task 13 ships the evaluator for `burden-computed`. Until it ships, the close page shows this task as failing. Do not run `pnpm db:migrate` on a shared database before Task 13 is merged.

**Verify:**
```bash
grep -c "CREATE TABLE IF NOT EXISTS" packages/database/supabase/migrations/*_indirect-rates.sql
# Expected: 6
grep -c "CREATE POLICY" packages/database/supabase/migrations/*_indirect-rates.sql
# Expected: 0
```

**Out of scope:** the Phase 5c columns. The GL pool allocation entry (research pattern 2) is not in the spec.

---

## Task 3: Apply migrations, regenerate types, ship RLS

**Depends on:** 2
**Files:**
- Modify: `packages/database/src/authz/manifest.ts`
- Modify: `packages/jobs/src/backups/id-refs.ts`
- Modify: `packages/database/src/seed-data.ts` — `periodCloseTaskDefinitions`
- Modify: generated types

**Steps:**
1. Add these rules in alphabetical order:

```ts
customerContractRateCeiling: company("sales"),
indirectExpenseStatement: company("accounting", { create: false, update: false, delete: false }),
indirectPool: company("accounting"),
indirectPoolAccount: company("accounting"),
indirectRate: company("accounting"),
indirectRateRun: company("accounting", { create: false, update: false, delete: false }),
```

2. The runs write `indirectExpenseStatement`, `indirectRateRun` and the Actual rates through Kysely, so users need no write policy on them.
3. Add `indirectPoolAccount: ["dimensionValueId"]` to `ID_REF_COLUMNS`. The column holds a tenant row id with no FK.
4. Add this entry to `periodCloseTaskDefinitions`, after "Recognize revenue for the period":

```ts
{
  name: "Compute burden for the period",
  taskType: "Auto",
  autoCheckKey: "burden-computed",
  sortOrder: 5,
  required: true,
  severity: "Warning",
  active: true,
  isSystem: true
},
```

5. Run `pnpm db:migrate`.
6. Run `pnpm --filter @carbon/database authz migration indirect-rates-rls`.
7. Run `pnpm run generate:types`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/database
# Expected: exit code 0
pnpm --filter @carbon/database test -- migration
# Expected: all tests pass
```

**Out of scope:** UI.

---

## Task 4: Add the feature key and the ee package skeleton

**Depends on:** 3
**Files:**
- Modify: `packages/ee/src/plan.ts` — `FEATURE_PLANS`
- Modify: `packages/ee/package.json` — `exports`
- Create: `packages/ee/src/indirect-rates/models.ts`
- Create: `packages/ee/src/indirect-rates/types.ts`
- Create: `packages/ee/src/indirect-rates/index.ts`
- Create: `packages/ee/src/indirect-rates/server.ts`
- Copy from (precedent): `packages/ee/src/rules/index.ts`, `packages/ee/src/rules/server.ts`

**Steps:**
1. Add `GOVERNMENT_CONTRACTING: [Plan.Business, Plan.Partner],` to `FEATURE_PLANS`, with a one-line comment: "Indirect rates, burden, earned value and project budget control (spec 2026-10-09, Q1)."
2. Add 2 exports to `packages/ee/package.json`:
   - `"./indirect-rates": "./src/indirect-rates/index.ts"`
   - `"./indirect-rates.server": "./src/indirect-rates/server.ts"`
3. In `models.ts`, export the zod validators. Use `zfd` as `packages/ee/src/rules/sales/models.ts` does.
   - `indirectPoolValidator`: `id` optional, `name`, `poolType`, `sequence` (integer ≥ 1), `baseType`, `appliedAccountId` optional, `appliesToProjects`, `offsetAbsorbedOverhead`, `active`.
   - Refine 1: `offsetAbsorbedOverhead` needs `poolType` Overhead.
   - Refine 2: a Service Center pool cannot apply to projects.
   - `indirectPoolAccountValidator`: `indirectPoolId`, `accountId`, `dimensionId` optional, `dimensionValueId` optional, `role`. Refine: both dimension fields or neither.
   - `indirectRateEntryValidator`: `indirectPoolId`, `fiscalYear`, `fromPeriod` (1–12), `rateType` (`Provisional`, `Target` or `Final` only), `rate` (≥ 0, a fraction).
   - `contractRateCeilingValidator`: `customerContractLineId`, `indirectPoolId`, `ceilingRate` (≥ 0, a fraction).
   - `burdenSettingsValidator`: `burdenRateType` (`Provisional` or `Actual`), `postAppliedBurden`.
4. In `models.ts`, also export the constants and the enum types:

```ts
export type IndirectPoolType = Database["public"]["Enums"]["indirectPoolType"];
export type IndirectBaseType = Database["public"]["Enums"]["indirectBaseType"];
export type IndirectRateType = Database["public"]["Enums"]["indirectRateType"];
export type BaseBucket = "Labor" | "LaborHours" | "Material" | "Subcontract" | "Other";
export const PROJECT_BASE_BUCKETS: Record<Database["public"]["Enums"]["projectCostType"], BaseBucket[]> = {
  Labor: ["Labor", "LaborHours"],
  Material: ["Material"], "Material Variance": ["Material"], "Payback Variance": ["Material"],
  "Outside Processing": ["Subcontract"], "Purchased Service": ["Subcontract"],
  Machine: ["Other"], Overhead: ["Other"], "Other Direct": ["Other"],
  Burden: []
};
export const BASE_TYPE_BUCKETS: Record<IndirectBaseType, BaseBucket[]> = {
  "Total Labor Dollars": ["Labor"],
  "Direct Labor Dollars": ["Labor"],
  "Direct Labor Hours": ["LaborHours"],
  "Direct Material Dollars": ["Material"],
  "Total Cost Input": ["Labor", "Material", "Subcontract", "Other"],
  "Value Added": ["Labor", "Other"]
};
export const BURDENED_COST_OBJECTIVES = ["Direct", "Commercial", "IR&D", "B&P"] as const;
export const ICE_SCHEDULES = ["A", "B", "C", "E", "G", "H", "I", "K", "L"] as const;
```

5. If a `projectCostType` value is not in the map above, STOP and report. The map must name every value.
6. `types.ts` derives row types from `@carbon/database` only (`Database["public"]["Tables"]["indirectPool"]["Row"]`). It never imports a server file (the bundling gotcha in `commercial-licensing.md`).
7. `index.ts`: `export * from "./models"; export * from "./compute"; export type * from "./types";`. Task 5 creates `compute.ts`. Until then, leave the compute line commented out.
8. `server.ts`: `export * from "./service.server"; export * from "./ice.server";`. Leave both lines commented out until Tasks 7 and 14 create the files.
9. Run `pnpm --filter @carbon/checks license-headers`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/ee
# Expected: exit code 0
head -1 packages/ee/src/indirect-rates/models.ts
# Expected: // SPDX-License-Identifier: LicenseRef-Carbon-Commercial
```

**Out of scope:** any UI.

---

## Task 5: Add the pure rate engine

**Depends on:** 4
**Files:**
- Create: `packages/ee/src/indirect-rates/compute.ts`
- Create: `packages/ee/src/indirect-rates/compute.test.ts`
- Copy from (precedent): `packages/server-functions/src/post-maintenance-event/plan.ts` and `plan.test.ts`

**Steps:**
1. Export these input types:

```ts
export type PoolDef = {
  id: string; name: string; poolType: IndirectPoolType; sequence: number;
  baseType: IndirectBaseType; appliesToProjects: boolean; offsetAbsorbedOverhead: boolean;
};
export type PoolMapping = {
  id: string; indirectPoolId: string; accountId: string;
  dimensionId: string | null; dimensionValueId: string | null; role: "Cost" | "Base";
};
// YTD, debit-positive. dims holds the line's value per mapped dimension id.
export type GlCell = { accountId: string; dims: Record<string, string>; amount: number; unallowableAmount: number };
// YTD project ledger cost by objective and bucket. A LaborHours cell carries hours in amount.
export type ProjectCell = {
  costObjective: (typeof BURDENED_COST_OBJECTIVES)[number]; bucket: BaseBucket;
  amount: number; unallowableAmount: number;
};
export type StatementLine = {
  lineType: "Account" | "Carried Burden" | "Absorbed Overhead";
  accountId: string | null; dimensionValueId: string | null; sourcePoolId: string | null;
  amount: number; unallowableAmount: number;
};
export type PoolRateResult = {
  indirectPoolId: string; poolCost: number; unallowableCost: number;
  baseAmount: number; ytdRate: number; lines: StatementLine[];
};
```

2. Export `matchMapping(cell: GlCell, mappings: PoolMapping[], role)` (B4):
   1. Take the mappings of `cell.accountId` with the given role.
   2. Return the first one whose `dimensionId` is a key of `cell.dims` with the value `dimensionValueId`.
   3. Else return the one with no dimension. Else return null.
3. Export `projectCellInBase(pool: PoolDef, cell: ProjectCell): boolean`:
   - the cell's bucket is in `BASE_TYPE_BUCKETS[pool.baseType]`;
   - its objective is Direct or Commercial, or it is IR&D or B&P and the pool is not G&A (B2).
4. Export `computePoolRates({ pools, mappings, glCells, projectCells, absorbedOverhead })`. `absorbedOverhead` is the YTD debit-positive total of `accountDefault.overheadAbsorptionAccount` (negative for credits). Process the pools in `sequence` order. For each pool P:
   1. **Cost:** Σ of the allowable amount (`amount − unallowableAmount`) of every GL cell matched to P as Cost. Add one `Account` line per cell, with `amount` and `unallowableAmount`.
   2. **Base:** Σ of the full amount of every GL cell matched to P as Base. Add every project cell where `projectCellInBase(P, cell)`. The base includes unallowable cost (CAS 405-40(e)).
   3. **Carry-in (B3).** For each earlier pool Q with its rate already computed:
      1. Take each GL cell matched to Q as Base and to P as Cost. Add Q's rate × its allowable amount to P's cost. Add Q's rate × its unallowable amount to P's `unallowableCost`.
      2. If P is G&A and Q is not G&A, take Q's base project cells with objective IR&D or B&P. Add Q's rate × their amount to P's cost.
      3. If P's base type is Total Cost Input, take Q's burden on Q's Direct and Commercial base cells. Add it to P's base. If P's base type is Value Added, do the same unless Q is Material Handling.
      4. Write each non-zero carry into P's cost as one `Carried Burden` line with `sourcePoolId` = Q.
   4. **Rate:** `ytdRate = base === 0 ? 0 : poolCost / base`, rounded with `round()` at the default scale.
   5. **Absorbed overhead (B7):** if `P.offsetAbsorbedOverhead`, add one `Absorbed Overhead` line with `amount = absorbedOverhead`. Do not change `poolCost`.
5. Export `fiscalYearRange(fiscalYear, periodNumber, startMonth): { start: string; periodStart: string; periodEnd: string }`.
   - Build `start` with `new CalendarDate(startMonth === 1 ? fiscalYear : fiscalYear - 1, startMonth, 1)` from `@internationalized/date`.
   - `periodStart` is `start.add({ months: periodNumber - 1 })`; `periodEnd` is `endOfMonth(periodStart)`.
   - Return ISO strings. This must agree with `fiscalYearAndPeriodFor` (`packages/utils/src/accounting.ts:79`).
6. Export `periodRateFrom(current: { poolCost: number; baseAmount: number }, previous: { poolCost: number; baseAmount: number } | null): number | null`. It divides the period's cost change by its base change. It returns null when the base change is 0.
7. Write `compute.test.ts` with these 9 cases:
   1. **Spec criterion "Rates":** Fringe (base Total Labor Dollars, sequence 1) has GL cost 30,000.00. Its base is GL Base account 6100 (indirect labor) 20,000.00 plus Direct project Labor 80,000.00. Expect a rate of 0.3.
   2. Overhead (sequence 2, base Direct Labor Dollars) maps 6100 as Cost. Expect its cost to include 6,000.00 of fringe and one `Carried Burden` line from Fringe.
   3. **Spec criterion "Unallowable in the base":** G&A (base Total Cost Input) has account 7000 (50,000.00) and account 7100 (5,000.00, all unallowable). Its project cells total 500,000.00, of which 10,000.00 is unallowable labor. Expect cost 50,000.00, base 500,000.00, rate 0.1, and a 7100 line with an unallowable amount of 5,000.00.
   4. G&A's Total Cost Input base includes Fringe and Overhead burden on Direct labor.
   5. A Value Added base takes Overhead burden but not Material Handling burden.
   6. IR&D labor is in the Fringe base, outside the G&A base, and its fringe goes into G&A cost.
   7. A line with dimension value `CC-10` matches the mapping for `CC-10`, not the account-only mapping.
   8. `offsetAbsorbedOverhead` adds an `Absorbed Overhead` line and leaves the rate unchanged.
   9. `fiscalYearRange(2026, 3, 10)` gives start `2025-10-01`, period start `2025-12-01` and period end `2025-12-31`.
8. Uncomment the compute line in `index.ts`.

**Verify:**
```bash
pnpm --filter @carbon/ee test -- indirect-rates/compute
# Expected: 9 passed
```

**Out of scope:** reading data (Task 8).

---

## Task 6: Add the pure burden and billing engine

**Depends on:** 4
**Files:**
- Modify: `packages/ee/src/indirect-rates/compute.ts`
- Modify: `packages/ee/src/indirect-rates/compute.test.ts`

**Steps:**
1. Export these types:

```ts
// YTD cost of one element (null = project level), by bucket. Hours in the LaborHours bucket.
export type ElementCells = {
  projectId: string; projectElementId: string | null;
  costObjective: (typeof BURDENED_COST_OBJECTIVES)[number];
  buckets: Partial<Record<BaseBucket, { amount: number; unallowableAmount: number }>>;
  absorbedOverhead: number;    // YTD Overhead ledger rows of the element (B7)
};
export type PostedBurden = {
  projectId: string; projectElementId: string | null; indirectPoolId: string;
  unallowable: boolean; amount: number;          // Σ Burden rows for the fiscal year
};
export type BurdenRow = {
  projectId: string; projectElementId: string | null; indirectPoolId: string;
  unallowable: boolean; amount: number;          // the delta to post
};
```

2. Export `projectBurdenTargets(pools: PoolDef[], rates: Map<string, number>, element: ElementCells)`. It returns `Map<poolId, { allowable: number; unallowable: number }>`. Only pools with `appliesToProjects` and a rate count. In `sequence` order, for each pool P:
   1. If P is G&A and the element's objective is IR&D or B&P, skip P.
   2. Base = Σ of the element's buckets in `BASE_TYPE_BUCKETS[P.baseType]`, split into allowable and unallowable.
   3. If P's base type is Total Cost Input, add every earlier pool's target, split the same way. If it is Value Added, add every earlier pool's target except Material Handling (B3).
   4. Allowable target = rate × allowable base. Unallowable target = rate × unallowable base.
   5. If `P.offsetAbsorbedOverhead`, the allowable target = `max(0, allowable target − absorbedOverhead)` (B7).
3. Export `burdenCatchUp(targets, posted: PostedBurden[], element): BurdenRow[]`. For each pool and each unallowable flag:
   1. Delta = `round(target − posted)`.
   2. Skip the delta when `equals(delta, 0)`.
   3. If a posted pool has no target any more, return a delta that takes it back to 0.
4. Export `billingRateFor({ final, provisional, ceiling }: { final: number | null; provisional: number | null; ceiling: number | null }): number | null`:
   - rate = `final ?? provisional`; null when both are null;
   - when `ceiling` is set, return `Math.min(rate, ceiling)`.
5. Export `burdenBillingAdjustments(input)` (B5):

```ts
type BillingInput = {
  pools: PoolDef[];
  lines: {
    customerContractLineId: string; projectId: string; projectElementId: string; feePercent: number;
    // Σ ledger cost of the line's billable items that are not Written Off, by fiscal year and bucket
    baseByYear: Map<number, Partial<Record<BaseBucket, number>>>;
    ceilings: Map<string, number>;                 // poolId → ceiling rate
    existing: Map<string, number>;                 // `${poolId}|${fiscalYear}` → Σ amount of the line's burden items
  }[];
  rates: Map<string, { final: number | null; provisional: number | null }>; // `${poolId}|${fiscalYear}`
};
```

   It returns one adjustment per line × pool × fiscal year where `!equals(delta, 0)`: `{ customerContractLineId, projectId, projectElementId, indirectPoolId, fiscalYear, burdenRate, burdenBase, amount }`.
   1. Compute the burden base with the same cascade as `projectBurdenTargets`, with every bucket allowable.
   2. Burden = billing rate × base. Amount = `round(burden × (1 + feePercent) − existing)`.
   3. If a pool has no rate for a year, skip it. Return the warning "No Provisional rate for <pool> in FY<year>".
6. Add these 7 test cases:
   1. **Spec criterion "Burden catch-up":** month 1 posted 2,000.00 at 0.20 on a base of 10,000.00. In month 2 the rate is 0.25 and the YTD base is 25,000.00. Expect one row of 4,250.00.
   2. An unchanged rate and base give no row.
   3. `offsetAbsorbedOverhead` with rate 0.3, base 10,000.00 and absorbed 1,000.00 gives a target of 2,000.00. Absorbed 4,000.00 gives 0.
   4. Burden on 1,000.00 of unallowable labor gives a separate unallowable row.
   5. **Spec criterion "Ceiling":** Provisional 0.28, ceiling 0.25, base 10,000.00, fee 0. Expect one item of 2,500.00.
   6. **Spec criterion "True-up":** existing items of 2,800.00 at Provisional 0.28. A Final rate of 0.22 gives an item of −600.00.
   7. A fee of 0.08 on a burden of 2,500.00 gives 2,700.00.

**Verify:**
```bash
pnpm --filter @carbon/ee test -- indirect-rates/compute
# Expected: 16 passed
```

**Out of scope:** writing rows (Tasks 9 and 10).

---

## Task 7: Add the authoring functions

**Depends on:** 4
**Files:**
- Create: `packages/ee/src/indirect-rates/service.server.ts`
- Create: `packages/ee/src/indirect-rates/service.server.test.ts`
- Copy from (precedent): `packages/ee/src/forecast.server.ts` (the lock at the top), `packages/ee/src/rules/service.server.ts`

**Steps:**
1. Each authoring function takes `client: SupabaseClient<Database>` and starts with `await requireEntitlement(client, companyId, "GOVERNMENT_CONTRACTING")`.
2. Add these functions. Each returns `{ data, error }` as the precedent does.
   - `upsertIndirectPool(client, input & { companyId, userId })`.
   - `deleteIndirectPool(client, { id, companyId })`. Refuse when the pool has an `indirectRate` row or a Burden ledger row: "This pool has rates or burden. Deactivate it instead."
   - `upsertIndirectPoolAccount(client, input & { companyId, userId })`. For role Base, read `accountDefault` and refuse `projectExpenseAccount` and `projectWorkInProgressAccount` (B2): "Project accounts hold mixed cost. The base comes from the project ledger."
   - `deleteIndirectPoolAccount(client, { id, companyId })`.
   - `setIndirectRate(client, { companyId, userId, indirectPoolId, fiscalYear, fromPeriod, rateType, rate })`. Upsert one row per period from `fromPeriod` to 12 with `periodRate = ytdRate = rate`, in one `upsert` call on `indirectRate_period_key`. Refuse `rateType: "Actual"` (B12).
   - `upsertContractRateCeiling(client, input & { companyId, userId })` and `deleteContractRateCeiling(client, { id, companyId })`.
   - `updateBurdenSettings(client, { companyId, userId, burdenRateType, postAppliedBurden })`.
3. Add the readers. They read community tables and need no entitlement check:
   - `getIndirectPools(client, companyId)`: ordered by `sequence`;
   - `getIndirectPool(client, id, companyId)`: with its accounts, the account number and name, and the dimension name;
   - `getIndirectRates(client, { companyId, fiscalYear })`;
   - `getIndirectRateRuns(client, companyId)`: newest first, with the period start date;
   - `getIndirectExpenseStatement(client, { companyId, fiscalYear, periodNumber })`: with account number and name and the source pool name;
   - `getContractRateCeilings(client, { companyId, customerContractLineId })`;
   - `getBurdenSettings(client, companyId)`.
4. Write `service.server.test.ts` with a mocked client, as `packages/ee/src/plan.server.test.ts` mocks it. Cover 3 cases:
   1. `upsertIndirectPool` throws `EntitlementError` when `companyHasFeature` returns false.
   2. `setIndirectRate` from period 10 writes 3 rows.
   3. `setIndirectRate` refuses Actual.
5. Uncomment `export * from "./service.server";` in `server.ts`.

**Verify:**
```bash
pnpm --filter @carbon/ee test -- indirect-rates/service
# Expected: 3 passed
pnpm exec turbo run typecheck --filter=@carbon/ee
# Expected: exit code 0
```

**Out of scope:** the runs (Tasks 8 and 10).

---

## Task 8: Add `computeIndirectRates`

**Depends on:** 5, 7
**Files:**
- Modify: `packages/ee/src/indirect-rates/service.server.ts`
- Create: `packages/ee/src/indirect-rates/loaders.server.ts`

**Steps:**
1. In `loaders.server.ts`, add `loadRatePeriod(db, { companyId, accountingPeriodId })`. It returns `{ period, fiscalYear, periodNumber, fyStart, periodStart, periodEnd }`.
   1. Read the period and `fiscalYearSettings.startMonth` with 2 queries.
   2. If `fiscalYear` or `periodNumber` is null, derive them with `fiscalYearAndPeriodFor` (B14).
   3. Compute the dates with `fiscalYearRange`.
2. Add `loadGlCells(db, { companyId, mappings, from, to })`. Use one SQL statement:
   1. Sum `journalLine.amount` of Posted journals with `postingDate` from `from` to `to`, for the mapped account ids.
   2. Convert each sum to debit-positive. If the account class is Liability, Equity or Revenue, multiply by −1. See the lesson "Journal debit/credit is derived from account class".
   3. Build `dims` with `jsonb_object_agg` over `journalLineDimension` rows whose `dimensionId` is a mapped dimension.
   4. Count a line as unallowable in 2 cases. Its account's `allowability` is not `'Allowable'`. Or an unallowable `projectLedger` row points at the line through `journalLineId`.
   5. Group by `accountId` and `dims`.
3. Add `loadProjectCells(db, { companyId, from, to })`. Use one SQL statement over `projectLedger` joined to `project`:
   1. Keep projects whose `costObjective` is in `BURDENED_COST_OBJECTIVES`, and rows whose `costType` is not Burden.
   2. Group by `costObjective` and `costType`: Σ `amount`, Σ `quantity`, and Σ `amount` where `unallowable`.
   3. Map each group to buckets with `PROJECT_BASE_BUCKETS`. The LaborHours bucket takes the quantity.
4. Add `loadAbsorbedOverhead(db, { companyId, from, to })`: the debit-positive YTD sum on `accountDefault.overheadAbsorptionAccount`.
5. In `service.server.ts`, add `computeIndirectRates(db: Kysely<KyselyDatabase>, client, { companyId, userId, accountingPeriodId })`:
   1. `requireEntitlement`.
   2. Load the period, the active pools, the mappings, the cells and the absorbed overhead.
   3. Call `computePoolRates`.
   4. Read the previous period's Actual rows (one query) and compute `periodRate` with `periodRateFrom`.
   5. In one Kysely transaction:
      1. Upsert one Actual `indirectRate` row per pool on `indirectRate_period_key`, with `poolCost`, `unallowableCost` and `baseAmount`.
      2. Delete the pools' `indirectExpenseStatement` rows for the fiscal year and period, then insert the new lines.
      3. Upsert `indirectRateRun` for the period. Set `ratesComputedAt` and clear `error`.
   6. Return `{ data: PoolRateResult[], error: null }`.
6. Accept any period state here. Rates write no journal.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/ee
# Expected: exit code 0
pnpm --filter @carbon/ee test -- indirect-rates
# Expected: all tests pass
```

**Out of scope:** burden (Task 10).

---

## Task 9: Add the `post-project-burden` server function

**Depends on:** 3
**Files:**
- Create: `packages/server-functions/src/post-project-burden/index.ts`
- Create: `packages/server-functions/src/post-project-burden/post-project-burden.test.ts`
- Modify: `packages/server-functions/src/invoke.ts` — register `post-project-burden`
- Modify: `packages/server-functions/src/__snapshots__/permissions-manifest.test.ts.snap` (with `vitest -u`, after review)
- Copy from (precedent): `packages/server-functions/src/post-timesheet/index.ts` (projects Phase 1a), `packages/server-functions/src/lib/post-adjustment.ts:124` (`createAdjustmentJournal`), `insertProjectLedgerRows` in `packages/server-functions/src/lib/project-posting.ts` (project billing Phase 4a Task 8)

**Steps:**
1. Input (zod):

```ts
export const postProjectBurdenInput = z.object({
  indirectRateRunId: z.string(),
  accountingPeriodId: z.string(),
  postingDate: z.string(),                       // YYYY-MM-DD, the period end
  postApplied: z.boolean(),
  rows: z.array(z.object({
    projectId: z.string(),
    projectElementId: z.string().nullable(),
    indirectPoolId: z.string(),
    indirectRateType: z.enum(["Provisional", "Actual", "Final"]),
    burdenFiscalYear: z.number().int(),
    amount: z.number(),
    unallowable: z.boolean()
  })).max(10000)
});
```

2. Permissions: `"system"`. Only the ee runs call it, after their own checks.
3. In `run`, in one transaction:
   1. Read the period `FOR UPDATE`. Refuse a Closed period: "Accounting period is closed." Accept Open and Locked (B10).
   2. Re-read the project and pool ids under `companyId` with `assertCompanyRecords`.
   3. Load the posting contexts with `loadProjectPostingContexts` (one call). Do not call `assertChargeable`: burden catch-up is system cost, and it must post to a closed project too.
   4. If `postApplied` and `companySettings.accountingEnabled`:
      1. Keep the rows whose treatment resolves to Contract with `resolveProjectPostingAccount`.
      2. Refuse a pool without `appliedAccountId`: "Set the applied account of pool <name>."
      3. Create one journal with `createAdjustmentJournal({ sourceType: "Burden", accountingPeriodId, postingDate, description: "Applied burden" })`.
      4. Per row, insert Dr the project account (`debit("asset", amount)`) and Cr the applied account. Sign the credit with `credit(accountTypeFromClass(<applied account class>), amount)`. Set `documentType: "Burden"` and `documentId: indirectRateRunId`.
      5. Tag the lines with the Project and ProjectElement dimensions through `packages/utils/src/journal-dimensions.ts`.
   5. Build one `projectLedger` row per input row with `buildProjectLedgerRow`:
      - `costType: "Burden"`, `documentType: "Indirect Burden"`, `documentId: indirectRateRunId`;
      - `indirectPoolId`, `indirectRateType`, `burdenFiscalYear`, `unallowable`, `amount`;
      - `journalLineId` (the debit line) or null.
   6. Insert the rows with `insertProjectLedgerRows(trx, { companyId, userId, rows })`. Its T&M pricer returns null for Burden rows, so it writes no billable item. Burden billing is a separate run (B5).
4. 🛑 Use `inOrder` for the sequential work. Do not use `Promise.all`.
5. Write `post-project-burden.test.ts` with `databaseTest` from `local-database-test-fixture.ts`. Cover 4 cases:
   1. Two memo rows with `postApplied: false` write two Burden ledger rows and no journal.
   2. `postApplied: true` on a Contract project writes one balanced journal, Dr Project WIP / Cr the applied account. The ledger row carries the debit line id.
   3. A Locked period accepts the call.
   4. A Closed period refuses it.

**Verify:**
```bash
pnpm --filter @carbon/server-functions test -- post-project-burden permissions-manifest
# Expected: all tests pass
```

**Out of scope:** computing the rows (Task 10).

---

## Task 10: Add `computeProjectBurden`, `computeBurdenBilling` and the period run

**Depends on:** 6, 8, 9
**Files:**
- Modify: `packages/ee/src/indirect-rates/service.server.ts`
- Modify: `packages/ee/src/indirect-rates/loaders.server.ts`

**Steps:**
1. In `loaders.server.ts`, add `loadElementCells(db, { companyId, from, to })`. Use one SQL statement over `projectLedger` joined to `project`, for the burdened objectives:
   1. Group by `projectId`, `projectElementId` and `costType`, without Burden rows.
   2. Build `ElementCells`. Fill `absorbedOverhead` from the Overhead rows.
2. Add `loadPostedBurden(db, { companyId, fiscalYear })`: Σ Burden rows by project, element, pool and `unallowable`, where `burdenFiscalYear` is the year.
3. Add `computeProjectBurden(db, client, { companyId, userId, accountingPeriodId, rateType? })`:
   1. `requireEntitlement`.
   2. Load the period. Refuse unless `closeStatus` is Locked: "Lock the period before you compute burden." (B10).
   3. The rate type is `rateType ?? companySettings.burdenRateType`. A `rateType` of Final is the year-end true-up.
   4. Read the YTD rate of that type for every applied pool at the fiscal year and period (one query). For Final, read period 12. If a pool has no rate, return the error "No <type> rate for <pool> in FY<year> period <n>".
   5. For a Final true-up, use the full fiscal year as the cell range.
   6. Load the element cells and the posted burden.
   7. For each element, call `projectBurdenTargets`, then `burdenCatchUp`.
   8. Upsert `indirectRateRun` for the period and keep its id.
   9. Call `serverFns.system({ db, companyId, userId }).invoke("post-project-burden", { indirectRateRunId, accountingPeriodId, postingDate: periodEnd, postApplied: companySettings.postAppliedBurden, rows })`.
   10. For a Final true-up, set `burdenFiscalYear` to the rate's year and post into the given Locked period.
   11. Set `burdenComputedAt`, `burdenRateType` and `burdenRowCount` on the run.
4. Add `computeBurdenBilling(db, client, { companyId, userId, accountingPeriodId })` (B5):
   1. `requireEntitlement`.
   2. Load the Active contracts' Cost Plus lines with their billing element and `feePercent` (one query).
   3. Load the base with one SQL statement:
      1. Take each line's billable items that have a ledger row and a status other than Written Off.
      2. Leave out ledger rows of cost type Burden.
      3. Sum the ledger amount by line, by the fiscal year of the row's `postingDate`, and by bucket.
   4. Load the existing burden items by line, pool and `fiscalYear` (one query). Count every status, so a written-off item is never billed again.
   5. Load the ceilings of the lines (one query).
   6. Load the Final and Provisional YTD rates for each fiscal year in the base (one query). Take the latest period up to the run's period.
   7. Call `burdenBillingAdjustments`.
   8. In one Kysely transaction, insert one `projectBillableItem` per adjustment:
      - `projectLedgerId: null`, `projectElementId` = the line's billing element;
      - `indirectPoolId`, `fiscalYear`, `burdenRate`, `burdenBase`, `postingDate` = the period end;
      - `quantity: 1`, `unitPrice` and `amount` = the adjustment, `status: "Unbilled"`;
      - `description`: "<pool name> FY<year> at <rate as percent>".
   9. Set `billingComputedAt` and `billableItemCount` on the run.
5. Add `runIndirectRatePeriod(db, client, { companyId, userId, accountingPeriodId })`:
   1. Call `computeIndirectRates`, `computeProjectBurden` and `computeBurdenBilling`, in that order.
   2. On the first error, write it to `indirectRateRun.error` and return it.
6. Add `runFinalTrueUp(db, client, { companyId, userId, fiscalYear, accountingPeriodId })`:
   1. Call `computeProjectBurden` with `rateType: "Final"`.
   2. Then call `computeBurdenBilling`.
7. Run `pnpm --filter @carbon/checks license-headers`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/ee
# Expected: exit code 0
pnpm --filter @carbon/ee test -- indirect-rates
# Expected: all tests pass
```

**Out of scope:** the job (Task 12) and the UI (Task 16).

---

## Task 11: Teach the Phase 4 billing readers about burden

**Depends on:** 3
**Files:**
- Modify: `packages/ee/src/project-revenue/service.server.ts` — `generateCostPlusItems` (project billing Phase 4a Task 5)
- Modify: `packages/utils/src/project-billing.ts` — `planProjectInvoiceLines`
- Modify: `packages/utils/src/project-billing.test.ts`
- Modify: `packages/server-functions/src/create-project-billing-invoices/index.ts`
- Modify: `packages/server-functions/src/project-revenue/index.ts` — `synthesizeProjectRevenue`
- Modify: `packages/server-functions/src/project-revenue/right-to-invoice.test.ts`
- Modify: `apps/erp/app/routes/x+/contract+/$id.billing-backup.$invoiceId.tsx`

**Steps:**
1. In `generateCostPlusItems`, read only ledger rows whose `costType` is not Burden (B5).
2. Find every read of `projectBillableItem` that inner-joins `projectLedger`: `grep -rn "projectBillableItem" apps/erp/app/modules packages/server-functions/src packages/ee/src packages/utils/src`. Change each one to a left join, because a burden item has no ledger row.
3. Where a reader filters or orders items by the ledger row's `postingDate`, use `COALESCE(<ledger row>."postingDate", item."postingDate")`. This covers 2 readers:
   1. the Unbilled item read in `create-project-billing-invoices`;
   2. the earned-to-date read in `synthesizeProjectRevenue`.
4. In `planProjectInvoiceLines`, add `indirectPoolId` and `poolName` to the item shape.
   1. Group items with an `indirectPoolId` into one line per pool, described "Indirect costs: <pool name>", quantity 1.
   2. Put these lines after the other cost lines.
5. In the billing backup route, show the pool, the fiscal year, the rate and the base for each burden item.
6. Add 3 tests:
   1. `planProjectInvoiceLines` groups 2 burden items of one pool into one line.
   2. Right to Invoice counts a burden item by its own `postingDate`.
   3. A memo Burden row of 500.00 (no journal line) gets no `projectCostRelief` row (B13).
7. If a file or function named above does not exist, STOP and report.

**Verify:**
```bash
pnpm --filter @carbon/utils test -- project-billing
# Expected: all tests pass
pnpm --filter @carbon/server-functions test -- create-project-billing-invoices right-to-invoice
# Expected: all tests pass
pnpm exec turbo run typecheck --filter=@carbon/ee --filter=erp
# Expected: exit code 0
```

**Out of scope:** T&M lines. They never bill burden (project billing spec decision 8).

---

## Task 12: Add the monthly job and the lock trigger

**Depends on:** 10
**Files:**
- Modify: `packages/lib/src/events.ts` — add `"carbon/indirect-rates.compute"`
- Modify: `packages/lib/src/trigger.ts` — add `"indirect-rates": "carbon/indirect-rates.compute"` to `taskToEvent`
- Create: `packages/jobs/src/inngest/functions/tasks/indirect-rates.ts`
- Modify: `packages/jobs/src/inngest/functions/tasks/index.ts`, `packages/jobs/src/inngest/index.ts`
- Modify: `apps/erp/app/routes/x+/accounting+/periods.$periodId.close.tsx` — the `lock` intent
- Copy from (precedent): `packages/jobs/src/inngest/functions/events/webhook.ts` (the `companyHasFeature` degrade), `packages/jobs/src/inngest/functions/tasks/recalculate.ts`

**Steps:**
1. The event data is `{ companyId: string; accountingPeriodId: string; userId: string }`.
2. `indirectRatesFunction`: id `indirect-rates`, `concurrency: { key: "event.data.companyId", limit: 1 }`, `retries: 2`. Steps:
   1. `check-feature`: `companyHasFeature(getCarbonServiceRole(), companyId, { feature: "GOVERNMENT_CONTRACTING" })`. If false, return `{ skipped: "not entitled" }`.
   2. `check-pools`: count active pools with `appliesToProjects`. If 0, return `{ skipped: "no pools" }`.
   3. `run`: call `runIndirectRatePeriod(getJobDatabaseClient(), getCarbonServiceRole(), data)`. Return its result. Do not throw on a business error; the run row records it.
3. Register the function in both index files, next to `recalculateFunction`.
4. In the `lock` intent, after `lockAccountingPeriod` succeeds:
   1. Count the company's active pools with `appliesToProjects` (one query).
   2. If the count is above 0, call `trigger("indirect-rates", { companyId, accountingPeriodId: periodId, userId })`.
   3. Wrap the call in `try`/`catch`. A failed send logs a warning and never fails the lock.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/jobs --filter=@carbon/lib --filter=erp
# Expected: exit code 0
```

**Out of scope:** a cron. The lock is the monthly trigger (spec: "after period lock").

---

## Task 13: Add the close checklist task

**Depends on:** 10
**Files:**
- Modify: `apps/erp/app/modules/accounting/accounting.service.ts` — `computePeriodReadiness` (line 3304)
- Modify: `apps/erp/app/routes/x+/accounting+/periods.$periodId.close.tsx`
- Modify: `apps/erp/app/modules/accounting/accounting.periods.test.ts`

**Steps:**
1. In `computePeriodReadiness`, add 2 reads to the existing parallel reads:
   1. the count of active pools with `appliesToProjects`;
   2. the `indirectRateRun` of the period (join `accountingPeriod` on `startDate` and `endDate`), with `burdenComputedAt`.
2. Add this check to `checks`, after `unposted-revenue-schedules`:

```ts
{
  autoCheckKey: "burden-computed",
  severity: "Warning",
  label: "Burden not yet computed for this period",
  failing: poolCount > 0 && !burdenRun?.burdenComputedAt,
  count: poolCount > 0 && !burdenRun?.burdenComputedAt ? 1 : 0
},
```

3. In the close route, add an intent `compute-burden`:
   1. Run `requirePermissions(request, { create: "accounting" })`.
   2. Call `requireFeature({ request, client, companyId, redirectTo: path.to.accountingPeriodClose(periodId), feature: "GOVERNMENT_CONTRACTING" })`. Use the real path helper name from `path.ts`.
   3. Call `runIndirectRatePeriod(getDatabaseClient(), client, { companyId, userId, accountingPeriodId: periodId })`.
   4. Catch `EntitlementError`. Flash the error or "Burden computed".
4. Show a **Compute burden** button on the `burden-computed` task row while it fails. Copy the `createRunIntent` button (lines 504–515 and 668–672).
5. Add a test to `accounting.periods.test.ts` with 3 cases:
   1. One pool and no run: `burden-computed` fails.
   2. A run with `burdenComputedAt`: it passes.
   3. No pool: it passes.

**Verify:**
```bash
pnpm --filter erp test -- accounting.periods
# Expected: all tests pass
pnpm exec turbo run typecheck --filter=erp
# Expected: exit code 0
```

**Out of scope:** making the task a Blocker. A company that lost the feature must still close.

---

## Task 14: Add the ICE schedules and the CSV route

**Depends on:** 8, 10
**Files:**
- Create: `packages/ee/src/indirect-rates/ice.ts`
- Create: `packages/ee/src/indirect-rates/ice.test.ts`
- Create: `packages/ee/src/indirect-rates/ice.server.ts`
- Create: `apps/erp/app/routes/api+/indirect-rates.ice[.]csv.ts`
- Modify: `apps/erp/app/utils/path.ts` — `path.to.api.indirectRatesIceCsv(fiscalYear, schedule)`
- Copy from (precedent): `apps/erp/app/routes/api+/integrations.$id.sync-activity[.]csv.ts`

**Steps:**
1. In `ice.ts`, write one pure builder per schedule. Each returns `{ fields: string[]; rows: (string | number)[][] }`:

| Schedule | Fields | Source |
|---|---|---|
| A | Pool, Pool type, Base type, Base, Allowable pool cost, Claimed rate | The Actual rate rows of the last computed period of the year |
| B | Account number, Account name, Amount, Unallowable, Claimed | The statement lines of G&A pools. A Carried Burden line reads "Burden from <pool>". |
| C | Pool, Account number, Account name, Amount, Unallowable, Claimed | The statement lines of every other pool |
| E | Pool, Element of cost, Base | GL Base cells by `account.elementOfCost` (null reads Other Direct); project cells: Labor, Material, Subcontract, Other as Other Direct. An hours base reads "Labor (hours)". |
| G | Line, Amount | B15: (1) direct cost in the project ledger; (2) less unallowable; (3) claimed direct cost; (4) journal lines behind the ledger rows; (5) memo rows with no journal line; (6) difference (1 − 4 − 5) |
| H | Contract, Customer, Labor, Material, Subcontract, Other Direct, Direct total, one column per applied pool, Total | Allowable non-Burden ledger rows of the Direct projects on each contract's lines. Burden = `projectBurdenTargets` at the claimed rates. |
| I | Contract, Claimed this year, Claimed prior years, Cumulative claimed, Cumulative billed, Difference | H per fiscal year (the Final rate of period 12, else the Actual rate). Billed = Σ Billed items whose invoice posted on or before the year end. |
| K | Contract, Contract line, Labor category, Hours, Billed amount | Billable items of T&M lines with a Labor ledger row in the year |
| L | Employee, Payroll gross wages, Payroll hours, Labor distribution dollars, Labor distribution hours, Difference | `payrollPeriodTotal` with `periodEnd` in the year; Labor ledger rows by `employeeId` in the year |

2. In `ice.server.ts`, add `buildIceSchedule(db, client, { companyId, fiscalYear, schedule })`:
   1. `requireEntitlement`.
   2. Load only what the schedule needs. Use the Task 8 and Task 10 loaders. Read each table once; never read per contract or per year.
   3. Call the pure builder.
3. For Schedule L, copy the grouping of `getLaborDistributionRows` (`apps/erp/app/modules/projects/projects.service.ts`, government contracting Phase 5a Task 31). Do not import app code into `packages/ee`.
4. Write `ice.test.ts` with 4 cases:
   1. **Spec criterion "ICE export", Schedule H:** one contract has 10,000.00 labor. Overhead is 0.5 and G&A is 0.1 on Total Cost Input. Expect 5,000.00 overhead and 1,500.00 G&A.
   2. **Schedule I:** claimed 16,500.00 this year and 10,000.00 prior, billed 24,000.00. Expect cumulative claimed 26,500.00 and a difference of 2,500.00.
   3. Schedule B shows an unallowable account in its own column.
   4. Schedule G gives a difference of 0 when every ledger row has a journal line.
5. In the route `loader`:
   1. Run `requirePermissions(request, { view: "accounting" })`.
   2. Parse `fiscalYear` (integer) and `schedule` (`z.enum(ICE_SCHEDULES)`) from the query string. Answer 400 on failure.
   3. Call `buildIceSchedule`. Catch `EntitlementError` and answer `new Response("Upgrade required", { status: 402 })`.
   4. Return `encodeCsvTable(fields, rows)` with `Content-Type: CSV_CONTENT_TYPE` and `Content-Disposition: attachment; filename="ice-<fy>-schedule-<s>.csv"`.
6. Uncomment `export * from "./ice.server";` in `server.ts`.

**Verify:**
```bash
pnpm --filter @carbon/ee test -- indirect-rates/ice
# Expected: 4 passed
pnpm exec turbo run typecheck --filter=@carbon/ee --filter=erp
# Expected: exit code 0
```

**Out of scope:** schedules D, F, J, M, N and O (spec). A ZIP of all schedules.

---

## Task 15: Build the Indirect Pools pages

**Depends on:** 7
**Files:**
- Create: `apps/erp/app/routes/x+/accounting+/indirect-pools.tsx`, `indirect-pools.new.tsx`, `indirect-pools.$poolId.tsx`, `indirect-pools.delete.$poolId.tsx`
- Create: `apps/erp/app/modules/accounting/ui/IndirectRates/IndirectPoolsTable.ee.tsx`, `IndirectPoolForm.ee.tsx`, `IndirectPoolAccounts.ee.tsx`, `IndirectRatesUpgradeOverlay.ee.tsx`, `index.ts`
- Modify: `apps/erp/app/modules/accounting/ui/useAccountingSubmodules.tsx` — **Indirect Pools** under Configure
- Modify: `apps/erp/app/utils/path.ts`
- Copy from (precedent): `apps/erp/app/routes/x+/accounting+/cost-centers.tsx`, `cost-centers.new.tsx`, `cost-centers.$costCenterId.tsx`, `cost-centers.delete.$costCenterId.tsx`; `apps/erp/app/modules/accounting/ui/CostCenters/`; `apps/erp/app/routes/x+/accounting+/dimensions.$dimensionId.tsx` (child rows); `apps/erp/app/routes/x+/sales+/sales-rules.tsx` and `apps/erp/app/modules/sales/ui/SalesRules/SalesRulesUpgradeOverlay.tsx` (the gate)

**Steps:**
1. Add the path helpers: `indirectPools`, `newIndirectPool`, `indirectPool(id)`, `deleteIndirectPool(id)`.
2. `indirect-pools.tsx`:
   - loader: `requirePermissions(request, { view: "accounting" })`, then `getIndirectPools`. No redirect.
   - UI: if `usePlanGate({ feature: "GOVERNMENT_CONTRACTING" }).isGated`, render `IndirectRatesUpgradeOverlay`. Else render `IndirectPoolsTable`: sequence, name, type, base type, applies to projects, active.
3. `IndirectRatesUpgradeOverlay.ee.tsx` wraps `~/components/RulesUpgradeOverlay` with a blurred mock pools table.
   - Title: "Indirect rates".
   - Description: "Compute fringe, overhead and G&A rates, burden your projects and bill at provisional rates."
4. `indirect-pools.new.tsx` and `indirect-pools.$poolId.tsx`:
   - action: `requirePermissions(request, { create: "accounting" })` or `update`, then `requireFeature`, then `upsertIndirectPool`. Catch `EntitlementError`.
   - form `IndirectPoolForm.ee.tsx`: name, pool type, sequence, base type and applied account (`Account` picker);
   - the switches: applies to projects, offset absorbed overhead (Overhead only) and active.
5. `IndirectPoolAccounts.ee.tsx` on the pool page lists the mappings: role, account, dimension, value. **Add** opens a modal: role, account, dimension (`Dimension` picker), value. Intents `account-add` and `account-delete` call `upsertIndirectPoolAccount` and `deleteIndirectPoolAccount`.
6. Show the service errors (B2, B4) as a field error, not a 500.
7. `indirect-pools.delete.$poolId.tsx` calls `deleteIndirectPool` and shows its refusal.
8. Run `pnpm --filter @carbon/checks license-headers`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exit code 0
```

**Out of scope:** drag-and-drop sequence reordering.

---

## Task 16: Build the Indirect Rates, Statement and ICE pages

**Depends on:** 7, 10, 14
**Files:**
- Create: `apps/erp/app/routes/x+/accounting+/indirect-rates.tsx`, `indirect-rates.statement.tsx`, `indirect-rates.ice.tsx`
- Create: `apps/erp/app/modules/accounting/ui/IndirectRates/IndirectRatesGrid.ee.tsx`, `SetIndirectRateModal.ee.tsx`, `IndirectRateRuns.ee.tsx`, `BurdenSettingsForm.ee.tsx`, `IndirectExpenseStatement.ee.tsx`, `IceExport.ee.tsx`
- Modify: `apps/erp/app/modules/accounting/ui/useAccountingSubmodules.tsx` — **Indirect Rates** under Closing
- Modify: `apps/erp/app/utils/path.ts`
- Copy from (precedent): `apps/erp/app/routes/x+/accounting+/exchange-rates.tsx` (rate grid), `apps/erp/app/routes/x+/accounting+/revenue-recognition-runs.tsx` (run list), `apps/erp/app/modules/accounting/ui/Reports/` (statement layout)

**Steps:**
1. `indirect-rates.tsx` reads `?fiscalYear` (default: the current fiscal year in the company time zone). The loader reads the pools, the rates, the runs, the burden settings and the Locked periods. It never redirects. A gated company sees `IndirectRatesUpgradeOverlay`.
2. `IndirectRatesGrid.ee.tsx`: one row per pool × rate type (Provisional, Target, Actual, Final), one column per period 1–12, showing `ytdRate` with `usePercentFormatter`. An hours-base pool shows the rate per hour with `useCurrencyFormatter`.
3. **Set rate** opens `SetIndirectRateModal.ee.tsx`: pool, rate type (Provisional, Target, Final), fiscal year, from period, rate. The action intent `set-rate` calls `setIndirectRate`.
4. `IndirectRateRuns.ee.tsx` lists the runs: period, rates, burden and billing times, row and item counts, and the error.
   - **Run period** picks a Locked period. Intent `run` calls `runIndirectRatePeriod`.
   - **Run true-up** shows when the year has Final rates for every applied pool. It picks a Locked period. Intent `true-up` calls `runFinalTrueUp`.
5. `BurdenSettingsForm.ee.tsx`: burden rate type (Provisional or Actual) and **Post applied burden for Contract projects**. Intent `settings` calls `updateBurdenSettings`.
6. Every intent runs `requirePermissions(request, { update: "accounting" })`, then `requireFeature`. It catches `EntitlementError` and flashes the result.
7. `indirect-rates.statement.tsx` (`?fiscalYear&periodNumber`) renders `IndirectExpenseStatement.ee.tsx`. For each pool, in sequence order, it shows:
   1. the account lines (amount, unallowable, claimed);
   2. the Carried Burden lines;
   3. the pool cost, the base and the rate;
   4. an Absorbed Overhead line as a credit, with "Applied by work centers".
8. `indirect-rates.ice.tsx` (`?fiscalYear`) renders `IceExport.ee.tsx`. It shows one row per schedule with its title from the spec table. Each row has a **Download CSV** link to `path.to.api.indirectRatesIceCsv`.
9. Link **Statement** and **ICE export** from the rates page header.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exit code 0
```

**Out of scope:** editing an Actual rate. Users override the period with a re-run.

---

## Task 17: Add rate ceilings to the contract line

**Depends on:** 7
**Files:**
- Create: `apps/erp/app/modules/sales/ui/Contracts/ContractRateCeilings.ee.tsx`
- Modify: the contract line page that Phase 4a built, and the route action that saves its labor rates
- Copy from (precedent): the Phase 4a **Labor rates** table on the same page

**Steps:**
1. Find the page and its action with `grep -rln "upsertContractLaborRate" apps/erp/app/routes apps/erp/app/modules/sales/ui`. If nothing matches, STOP and report.
2. Show `ContractRateCeilings.ee.tsx` below the labor rates, for Cost Plus lines only. Its rows show the pool and the ceiling rate (`usePercentFormatter`), with **Add** and delete.
3. If the company is gated, render the section through `UpgradeOverlaySection` from `~/components/UpgradeOverlay`. Copy its use in `apps/erp/app/routes/x+/settings+/security.tsx`.
4. Add intents `ceiling-upsert` and `ceiling-delete` to the action. Each runs `requirePermissions(request, { update: "sales" })`, then `requireFeature`, then the ee function.
5. Load the ceilings with `getContractRateCeilings` in the page loader.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exit code 0
```

**Out of scope:** ceilings per contract (Costpoint has both). The spec puts them on the line.

---

## Task 18: Add burden by pool to the project Costs tab

**Depends on:** 3
**Files:**
- Modify: `apps/erp/app/routes/x+/project+/$projectId.costs.tsx`
- Create: `apps/erp/app/modules/projects/ui/Costs/ProjectBurdenByPool.ee.tsx`
- Modify: `apps/erp/app/modules/projects/projects.service.ts` — `getProjectBurdenSummary`
- Copy from (precedent): `apps/erp/app/modules/projects/ui/Costs/ProjectCostsTree.tsx` (projects Phase 1a)

**Steps:**
1. Add `getProjectBurdenSummary(client, projectId, companyId)`. It calls the `get_project_burden_summary` RPC.
2. In the loader, call it beside `get_project_cost_summary`.
3. Render `ProjectBurdenByPool.ee.tsx` only when the summary has rows. It lists each pool's burden, rolled up over the element tree the page already loads, with allowable and unallowable columns.
4. Show the element's burden in the cost tree tooltip of `ProjectCostsTree` as "of which burden: <amount>".
5. Run `pnpm run generate:mcp`, because `projects.service.ts` gains an export.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exit code 0
```

**Out of scope:** earned value (Phase 5c).

---

## Task 19: Extend the demo datasets

**Depends on:** 7
**Files:**
- Modify: `packages/database/src/datasets/types.ts`, `packages/database/src/datasets/tiers/09-accounting.ts`, `packages/database/src/datasets/data/satellite/accounting.ts`, `packages/database/src/datasets/coverage.ts`, `packages/database/src/datasets/validate.ts`
- Modify: the `accounting.ts` slice of the robotics, precision and motor datasets (empty arrays)

**Steps:**
1. Add `indirectPools` to the accounting slice type. Each pool has these fields:
   - name, type, sequence, base type and applied account number;
   - accounts (number and role);
   - Provisional and Target rates for the current fiscal year.
2. In the satellite dataset, seed 3 pools:
   1. **Fringe**, Total Labor Dollars, sequence 1, rate 0.32;
   2. **Overhead**, Direct Labor Dollars, sequence 2, rate 0.85;
   3. **G&A**, Total Cost Input, sequence 3, rate 0.12.
3. Map each pool to existing satellite chart accounts. Read the account numbers from `data/satellite/accounting.ts`. Add one Base mapping to Fringe for the indirect labor account.
4. If the satellite dataset has a Cost Plus contract line from Phase 4a, add a ceiling of 0.80 on Overhead.
5. Seed no Burden rows and no Actual rates. They need the runs, which cannot run inside the seed transaction.
6. In `validate.ts`, check that every pool account number exists in the chart.
7. Measure the new tables and add `indirectPool`, `indirectPoolAccount` and `indirectRate` to `COVERAGE_FLOORS`.
8. Run `pnpm db:check:datasets`.

**Verify:**
```bash
pnpm db:check:datasets
# Expected: all four datasets pass
```

**Out of scope:** pools in the other 3 datasets. Satellite is the A&D story.

---

## Task 20: Run the scoped gates

**Depends on:** 1–19
**Files:** none

**Steps:**
1. Run every command below.
2. Fix each failure in the task that owns the file. Then run the command again.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/ee --filter=@carbon/server-functions --filter=@carbon/jobs --filter=erp
# Expected: exit code 0
pnpm --filter @carbon/ee test && pnpm --filter @carbon/server-functions test
# Expected: all tests pass
pnpm run lint
# Expected: no errors
pnpm --filter @carbon/checks clobbers
# Expected: no clobbered functions or views
pnpm --filter erp build
# Expected: the build passes, with no "Server-only module referenced by client"
```

**Out of scope:** a whole-repo typecheck. It runs out of memory.

---

## Task 21: Update the rules, docs and spec

**Depends on:** 20
**Files:**
- Create: `.claude/rules/indirect-rates.md`
- Modify: `.claude/rules/commercial-licensing.md` — the rollout list
- Modify: `.claude/rules/projects-system.md`
- Modify: `docs/content/docs/reference/projects.mdx`
- Modify: `.ai/specs/2026-10-09-government-contracting.md`

**Steps:**
1. Write the rule file with `paths:` frontmatter for `packages/ee/src/indirect-rates/**` and `packages/server-functions/src/post-project-burden/**`. Cover these 6 points:
   1. the 2 base sources and the cascade rules (B2, B3);
   2. the catch-up key and `burdenFiscalYear` (B8);
   3. memo rows versus applied posting, and the Locked-period rule (B10);
   4. billing by difference, and why Burden rows create no billable item (B5);
   5. the absorbed overhead offset (B7);
   6. the run order: rates, burden, billing.
2. Add a ✅ **Government contracting (5b)** entry to the rollout list in `commercial-licensing.md`.
3. In `projects-system.md`, describe Burden rows and the burden billable items.
4. Add an **Indirect rates** section to the projects reference page. Name the paths Accounting → Indirect Pools and Accounting → Indirect Rates. State that it is available on the Business plan.
5. In the spec:
   1. Record decisions B1–B15.
   2. Correct *API / Service Changes*: the pure helpers live in `packages/ee`. The burden posting server function is `post-project-burden`. The billing run replaces `compute-retroactive-billing`.
   3. Add `indirectRateRun`, the `companySettings` columns and the `projectBillableItem` columns to *Data Model Changes*.
   4. Mark Phase 5b done.
6. Run the STE-80 review pass on every `.ai/` file you changed.

**Verify:**
```bash
cd docs && pnpm typecheck
# Expected: exit code 0
```

**Out of scope:** the changelog entry.

---

## Task 22: Verify in the browser

**Depends on:** 1–21
**Files:**
- Create: `.ai/playbooks/government-contracting-phase-5b.md` (written by `/test`)

**Steps:**
1. Run `/test` on a satellite dataset company with accounting on and the Business plan.
2. Cover the spec's Phase 5b criteria:
   1. **Rates:** with Fringe cost of 30,000.00 on a base of 100,000.00, the period run shows 30 % on the rates grid. The statement shows the fringe carried into Overhead.
   2. **Burden catch-up:** raise the Overhead Provisional rate from period 1 in month 2. The next run posts months 1 and 2 at the new rate, less the burden already posted.
   3. **Unallowable in the base:** an Expressly Unallowable G&A account shows in the unallowable column and not in the G&A rate. Its cost stays in the Total Cost Input base.
   4. **Ceiling:** a Cost Plus line has an Overhead ceiling of 25 %. The Provisional rate is 28 %. The line gets an overhead item at 25 %.
   5. **True-up:** Final rates below Provisional, then **Run true-up**, create negative burden items.
   6. **ICE export:** Schedule H lists each contract's direct cost and its burden at the claimed rates. Schedule I lists cumulative claimed and billed.
3. Check the gate: on a Community plan company, Indirect Rates shows the upgrade overlay.
4. Save the playbook to `.ai/playbooks/government-contracting-phase-5b.md`.

**Verify:**
```bash
ls .ai/playbooks/government-contracting-phase-5b.md
# Expected: the file exists, and the /test run reports every step passed
```

**Out of scope:** Phase 5c.

## Execution notes

- Prerequisites: every check prints a line except one. `synthesizeProjectRevenue` lives in `packages/server-functions/src/lib/project-revenue.ts`, not in `project-revenue/index.ts`. Tasks 1–8 do not use it.
- Tasks 1 and 2: the pre-commit backup check skipped both commits, because the migrations were not applied yet ("your database is 1 (2) migration(s) behind"). The Task 3 commit runs it against the applied schema. Tasks 1 and 2 ran together in a `BEGIN … ROLLBACK` dry run before the Task 2 commit.
- Task 2:
  1. Each new table also has an index on `createdBy`, as the table template asks. `indirectExpenseStatement.sourcePoolId` and `customerContractRateCeiling.indirectPoolId` get a composite index with `companyId`, the shape of their foreign keys.
  2. `projectLedger` and `projectBillableItem` get a partial index on `("indirectPoolId", "companyId")`. The new pool foreign keys have no `ON DELETE` action, so a pool delete would otherwise scan the whole ledger.
  3. 🛑 Until Task 13 ships the `burden-computed` evaluator, the close checklist shows "Compute burden for the period" as an open required task on this branch's database. A user can skip it.
- Task 3:
  1. `customerContractRateCeiling` reads with `sales_view`, not with any employee. Every other contract table reads that way (`customerContractLine`, `customerContractFunding`), so a ceiling is not visible to an employee who cannot see its line.
  2. `ID_REF_COLUMNS` also lists `indirectExpenseStatement.dimensionValueId`. It holds the same polymorphic dimension value id with no FK as `indirectPoolAccount.dimensionValueId`.
  3. The new journal source type `Burden` joins `POSTING_POLICY` with `defaultEnabled: false` (Brad's rule for journal types added after the returns types), `journalEntrySourceTypes` in `accounting.models.ts` and `JournalEntrySourceTypeIcon` (the project icon). Without them `@carbon/ee` and `erp` fail the typecheck. The posting-policy test comment names `Burden` with the other off-by-default types.
  4. The generated RLS migration is `20261011204730_indirect-rates-rls.sql`. `pnpm db:migrate` ran a second time to record it. `authz check` reports no drift.
  5. The regenerated types change the MCP digest (`tool-manifest.digest.json`); the commit carries it.
- Task 4:
  1. `packages/ee/src/rules/sales/models.ts` does not exist. The validators follow `packages/ee/src/approvals/models.ts`, the one ee models file that uses `zfd`.
  2. `models.ts` also exports the enum value lists (`indirectPoolTypes`, `indirectBaseTypes`, `indirectRateTypes`, `indirectPoolAccountRoles` from `Constants`), `enteredIndirectRateTypes` (Provisional, Target, Final) and `burdenRateTypes` (Provisional, Actual). The validators and the Task 15–16 forms use them.
  3. `indirectPoolAccountValidator` and `contractRateCeilingValidator` have an optional `id`, because their service functions are upserts.
  4. The license fixer scans files that git knows. New files need `git add -N` before `pnpm --filter @carbon/checks license-headers` writes their header.
- Task 5:
  1. `matchMapping` takes every pool's Cost mappings for the Cost role, so the most specific mapping wins across pools (B4). For the Base role, the engine matches within one pool's mappings, because one cell may be Base of several pools.
  2. Step 4.3.2 splits the earlier burden on IR&D and B&P cost: the rate × the allowable amount goes into G&A cost, and the rate × the unallowable amount goes into `unallowableCost`, as step 4.3.1 does for a GL cell. The plan says "their amount", which would put the burden on unallowable cost into the G&A numerator.
  3. Step 4.3.3 carries an earlier pool's burden into a TCI or Value Added base only when that pool applies to projects. `projectBurdenTargets` (Task 6) counts only such pools, so the rate's base and the base the burden applies to stay the same.
  4. The `Absorbed Overhead` line needs an account: `indirectExpenseStatement_account_check` requires one on every line that is not Carried Burden. `computePoolRates` takes an optional `absorbedOverheadAccountId` for it. Task 8 passes `accountDefault.overheadAbsorptionAccount`.
  5. Account lines merge by account and matched dimension value, so 2 cells that match the same account-only mapping make one statement line.
  6. `carriesBurdenIntoBase` and `sortPools` are exported, so Task 6 uses the same cascade rule. `periodRateFrom` treats a null previous period as zero, so period 1's rate is its YTD rate.
  7. `pnpm --filter @carbon/ee test -- indirect-rates/compute` runs the whole `@carbon/ee` suite (vitest ignores a filter after `--`). `pnpm exec vitest run src/indirect-rates` in `packages/ee` runs the 9 tests; the full suite passes too (2,004).
- Task 6:
  1. `burdenBillingAdjustments` returns `{ adjustments, warnings }`. The warnings are deduplicated across lines, one per pool and fiscal year.
  2. A billing line's years are the years of its base and the years of its existing burden items, so a year whose base is gone still bills back to zero.
  3. The billing cascade carries the burden at the billing rate, before the fee, into a later TCI or Value Added base. A pool with no rate for the year carries nothing.
  4. `BillingInput` lines carry no cost objective, so the billing cascade has no IR&D or B&P skip. Cost Plus lines bill Direct projects.
- Task 7:
  1. A refusal returns `{ data: null, error: { message } }`, the shape the callers read from a PostgREST result. The 3 refusal texts are exported constants (`INDIRECT_POOL_IN_USE`, `INDIRECT_POOL_BASE_PROJECT_ACCOUNT`, `INDIRECT_RATE_ACTUAL_REFUSED`). The plan gives no text for the Actual refusal; it reads "Actual rates come from the rate run. Enter a Provisional, Target or Final rate."
  2. `setIndirectRate` builds its rows with the exported pure `indirectRateRows`, then writes them in one `upsert` on `indirectRate_period_key`.
  3. `companySettings` has no `updatedBy` or `updatedAt` column, so `updateBurdenSettings` writes only the 2 settings.
  4. `getIndirectPool` and `getIndirectExpenseStatement` read with 2 queries each, not one embed. The statement has 2 foreign keys to `indirectPool`, so an embed of the pool name is ambiguous. The local PostgREST resolves every embed the readers use.
  5. The test mocks `../plan.server` (`companyHasFeature`) and records the rows at the `upsert` boundary. The assertions check the written rows, not call counts.
- Task 8:
  1. The GL readers count journals with status Posted or Reversed, not only Posted. Main's always-post model makes every pre-cutover journal Provisional, which counts nowhere, and its GL readers use `IN ('Posted', 'Reversed')` (`20261009005144_journal-gl-status-readers.sql`). A Reversed journal and its Posted reversal net to zero only when both count.
  2. `loadAbsorbedOverhead` returns `{ accountId, amount }`. The account id fills the `Absorbed Overhead` statement line (Task 5 note 4). With no absorption account, the amount is 0 and the run writes no such line.
  3. `computeIndirectRates` reads only active pools, and only the mappings of active pools. A more specific mapping on an inactive pool would otherwise take the cell out of every pool.
  4. Period 1 takes `periodRateFrom(result, null)`, so its period rate is its YTD rate. A later period whose previous period has no Actual row gets `periodRate` null: the run cannot know that period's own change.
  5. `toProjectCells` (the bucket mapping) is exported from `loaders.server.ts` and is pure.
  6. A database test (`compute-indirect-rates.test.ts`, `databaseTest`) seeds 3 pools, 5 mappings, a Posted, a Provisional and a prior-year journal, and a Direct project with 80,000.00 of labor on a period with no fiscal numbers (B14). It runs the rate run twice. It checks Fringe 0.3, Overhead 0.325 with 6,000.00 of carried fringe, G&A 0.38462 with 5,000.00 unallowable, 5 statement lines and one period run. Only `companyHasFeature` is stubbed. The `@carbon/ee` suite passes (2,015).
- Task 9:
  1. The applied burden journal follows `journalPostingStatus`, not `companySettings.accountingEnabled` (main's always-post rule). Before the cutover the journal is Provisional with no period. After it, the journal is Posted in the given period. The function writes the journal whenever `postApplied` is true and a row's project is Contract.
  2. The function signs each line by its account's class (`accountTypeFromClass`), the debit line too. A Contract project with its own cost account can name an Expense account; Asset and Expense take the same sign.
  3. The function writes the journal inline, not through `postProjectJournal`. That helper resolves the period with `"current"` mode, which refuses a Locked period. Its dimension tags are the same for every line, and burden lines need the Project and ProjectElement of each row.
  4. The function drops rows whose rounded amount is 0, and checks that the `indirectRateRun` and the pools belong to the company.
  5. The test has a fifth case: before the cutover the journal is Provisional with no period.
  6. The permissions snapshot also gains `payrollPeriodTotal` (`update: people`) in the `import-csv` map. Phase 5a added that import key without updating the snapshot.
- Task 10:
  1. `computeProjectBurden` takes an optional `fiscalYear`. The Final true-up reads period 12 of that year and burdens the whole year, and the posting period can sit in the next fiscal year. `runFinalTrueUp` passes its `fiscalYear`. `loadRatePeriod` also returns `startMonth`, so the run can build the full-year range.
  2. An element with posted burden and no cost in the range still catches up to zero. The run adds it with empty buckets, so its delta takes the posted burden back.
  3. The run sends at most 10,000 rows per `post-project-burden` call (the input limit), in order. Each call is its own transaction. A later re-run recomputes the catch-up, so a failed call leaves nothing to repair.
  4. The run row keeps the posting period's own fiscal year and period number, also for a true-up.
  5. The billing run reads the Cost Plus lines of Active contracts with no date filter, so a line that has ended still gets its true-up. The fiscal year of a ledger row comes from SQL with the fiscal start month as a literal, so the SELECT and the GROUP BY use one expression.
  6. The rate in a burden item description uses `formatPercent`. A Direct Labor Hours pool shows the rate per hour with `formatQuantity` ("<pool> FY<year> at 12.5 per hour").
  7. `runIndirectRatePeriod` and `runFinalTrueUp` catch a thrown error and write it to `indirectRateRun.error`, as a returned error. An `EntitlementError` propagates, so the caller can answer with the upgrade message.
  8. A database test (`compute-project-burden.test.ts`) covers the catch-up (5,000.00 once, then nothing), burden billing (5,400.00 with an 8% fee) and a Final rate (−540.00), plus the 2 refusals (period not Locked, no rate). The `@carbon/ee` suite passes (2,018).
- Task 11:
  1. `synthesizeProjectRevenue` lives in `packages/server-functions/src/lib/project-revenue.ts` (see the prerequisites note). Its earned-to-date read now left-joins the ledger and filters on `COALESCE(pl."postingDate", b."postingDate")`. The 2 new tests are in `lib/right-to-invoice.test.ts`, not in `project-revenue/right-to-invoice.test.ts`.
  2. 3 readers inner-joined `projectLedger`: `create-project-billing-invoices`, `synthesizeProjectRevenue` and `create-service-order-invoice`. All 3 now left-join it. The service order read locks `FOR UPDATE OF "projectBillableItem"`, because Postgres refuses `FOR UPDATE` on the nullable side of an outer join. The ERP readers use PostgREST embeds without `!inner`, which are already left joins.
  3. The Unbilled item read in `create-project-billing-invoices` also left-joins `indirectPool` for the pool name. A burden item takes the cost type Burden in the plan item.
  4. `ProjectInvoicePlanItem.indirectPoolId` and `poolName` are optional, so the Time & Materials callers need no change. Burden lines sort by pool name, after every other line.
  5. The billing backup reader (`getProjectBillingBackup`) also selects the item's `postingDate`, `fiscalYear`, `burdenRate`, `burdenBase` and the pool (`name`, `baseType`). The route shows Pool (with the fiscal year), Rate and Base columns. A Direct Labor Hours pool shows the rate per hour and the base in hours.
  6. The new UI strings have an empty `msgstr` in the other locales; the branch-wide `/translate` run fills them.
  7. One full `@carbon/server-functions` run had 1 failed test. The next 2 full runs passed (795), and the failure did not repeat.
- Task 12:
  1. The lock intent counts the pools through the user's Supabase client (`head: true`, count only). A failed read takes the same `catch` as a failed send: it logs a warning and the lock still succeeds.
  2. The job logs a failed run with `logger.error` and returns the result. The run row holds the error.
  3. `@carbon/jobs` typecheck failed on `indirectRateRows` (Task 7): its untyped `const rows = []` became `never[]` under the jobs `tsconfig`. The array now has the `indirectRate` Insert type. `@carbon/ee` alone had passed.
- Task 13:
  1. 🛑 The task row is required for every company, so the check passes, marked not applicable, when the company lacks GOVERNMENT_CONTRACTING or has no active pool that applies to projects. `burdenComputedCheck` (exported, pure) holds the rule.
  2. The browser-bundled service cannot import `companyHasFeature`. So `computePeriodReadiness`, `loadPeriodCloseChecklist` and `closeAccountingPeriod` take an optional `entitlements: PeriodCloseEntitlements` (`{ governmentContracting? }`), the same way they take the run previewer. The close route's loader and its `close` intent read the feature with `companyHasFeature` and pass it. MCP and the API pass none, so the check does not apply there, as the revenue synthesizers do not.
  3. The check reads with the privileged Kysely client, after the Timesheets complete check, as 5a Task 30 (`9efe6a2846`) does. It reads the pool count and the run in 2 queries, and only when the company has the feature. The run read matches the period by `startDate` and `endDate` through a subquery. A failed read counts as one, as the timesheet check does.
  4. The plan names 3 test cases. The test has 4 for `burdenComputedCheck` (with the not-applicable case) and 2 for `computePeriodReadiness`: a company without the feature that still has a pool passes (also with no entitlements passed), and an entitled company with a pool and no run fails.
  5. The **Compute Burden** button shows only while the period is Locked: `computeProjectBurden` refuses any other period. The task's tooltip explains the check. The intent logs and flashes an error that is not an `EntitlementError`.
- Task 14:
  1. A, B, C and E read the last period of the year with Actual rates. With none, A, B and C are empty, and E reads the whole year. E sums the base from the fiscal year start to that period's end.
  2. The claimed rate of a pool and year is the Final rate of period 12, else the Actual rate of the last computed period, for H and I alike. A year with no claimed rate claims its direct cost only.
  3. H and I read the allowable non-Burden ledger cost of Direct projects on each current contract line's billing element subtree (`get_contract_line_subtree`, the lines no amendment replaces), as Cost by CLIN does. A row at project level, with no element, is on no line. The Overhead rows feed `absorbedOverhead` for a pool with `offsetAbsorbedOverhead` (B7).
  4. G counts the ledger rows of Direct projects. It sums each journal line behind them once, debit-positive by account class, whatever the journal status.
  5. B and C show a Carried Burden line with an empty account number. An Absorbed Overhead line reads "Absorbed overhead (<account name>)" and claims 0 (B7: shown, never claimed).
  6. K counts Billed items only, as its "Billed amount" column says. The contract line reads its `lineItemNumber`, else its description.
  7. L joins payroll and labor per employee with a full outer join, so an employee with labor and no payroll still shows. The difference is payroll gross wages less labor distribution dollars.
  8. `index.ts` also exports `./ice` (pure, client-safe) for the Task 16 page. The route parses the query with zod and answers 400 on a bad year or schedule.
  9. A database test (`ice.server.test.ts`) runs all 9 schedules against a seeded company. It reads the seeded values back from A, C, E, G, H and I; K and L run their SQL with no rows.
- Task 15:
  1. Precedent: the planning groups pages (`x+/projects+/planning-groups*`), the newest ee list with an upgrade overlay. The pool page is a drawer: the pool form, then the account mappings below it, outside the form. The drawer's Save button submits the form by id, as `ExchangeRateForm` does, so the mapping modal and the remove dialog are not nested in the pool form.
  2. `~/components/Form` has no Dimension picker. The Add modal offers each active dimension with its values (`getActiveDimensionsWithValues`), then a Value select. A Customer, Supplier or Item dimension loads no values there, so the modal leaves it out.
  3. The database refusals become field errors through `indirectRatesFieldErrors` (`packages/ee/src/indirect-rates/models.ts`, client-safe): the pool's sequence and name keys, and the 2 pool account keys (B4). The B2 refusal is matched by its exported text (`INDIRECT_POOL_BASE_PROJECT_ACCOUNT`) and shown on the account field.
  4. The new and edit routes also call `requireFeature` in the new route's loader, as `planning-groups.new.tsx` does. The delete route catches `EntitlementError`, because `deleteIndirectPool` calls `requireEntitlement`; it flashes the "in use" refusal as its message.
  5. A Service Center pool hides **Applies to Projects** (posted as false); an Overhead pool alone shows **Offset Absorbed Overhead**. Both match the validator's refinements and the table checks.
- Task 16:
  1. The route names are the plan's, so `indirect-rates.statement.tsx` and `indirect-rates.ice.tsx` are child routes of `indirect-rates.tsx` (flat routes nest on the dot). They open as drawers over the rates page through its `RecordOutlet`; closing returns to the rates page of the same fiscal year.
  2. The Set Rate modal takes the fiscal year from the page's `?fiscalYear` (a hidden field, and the title names it). A Select of years would hold a string where the validator's default value is a number.
  3. The runs card lists the runs of the selected fiscal year. **Run Period** and **Run True-Up** pick from every Locked period (newest first) and are disabled, with a tooltip, while no period is Locked. **Run True-Up** shows when every active pool that applies to projects has a Final rate for period 12, the period the true-up reads.
  4. The statement opens on the last period of the year with Actual rates, else period 12. Its pool cost, base and rate come from that period's Actual rate row. The Absorbed Overhead line shows as a credit and claims nothing (B7).
  5. Run and true-up errors flash the message the run wrote to `indirectRateRun.error`.
- Task 17:
  1. The page is the contract line's **Billing** tab (`x+/contract+/$id.$lineId.billing.tsx`, `ContractLineBilling`). It shows **Labor Rates** on a Time & Materials line only, so **Rate Ceilings** takes the same place on a Cost Plus line. The labor rates action (`$id.$lineId.labor-rates.tsx`) takes the 2 new intents.
  2. The Add modal offers the active pools that apply to projects and have no ceiling on the line yet (`customerContractRateCeiling_key` is unique per line and pool), so the plan's edit is a delete and an add. A unique-key refusal still answers "This line already has a ceiling for the pool".
  3. A Direct Labor Hours pool's ceiling is an amount per hour in the company currency, like its rate. Every other ceiling is a percent.
  4. A gated company sees the section with no rows behind `UpgradeOverlaySection`. The intents call `requireFeature` and answer an `EntitlementError` with "Upgrade to use rate ceilings".
- Task 18:
  1. `ProjectCostsTree` had no tooltip. The Allowable cell of a row (and of the project total) gets one when its subtree carries allowable burden: "of which burden: <amount>". The loader rolls each burden row up its element's ancestors (`parentId`), in memory.
  2. `ProjectBurdenByPool.ee.tsx` is a strip under the tree, styled as `ServiceOrderCosts`: one row per pool with Allowable, Unallowable and Total, summed over the whole project. The tree renders it, so it scrolls with the tree's own layout.
  3. The page shows burden whatever the plan, because it reads ledger rows the company already has. No gate: a company that lost the feature still sees the burden it posted.
  4. `pnpm run generate:mcp` changed only `tool-manifest.digest.json`.
- Task 19:
  1. The satellite chart is the bootstrap chart, which has no fringe or indirect labor account. The pools map to its nearest accounts: Fringe collects 6100 Insurance with 6060 Salaries - Administrative as its one Base mapping (the indirect labor); Overhead collects 5050 Indirect Materials & Services and 6010 Maintenance Expense; G&A collects 6060, 6070 Rent & Utilities (Non-Factory) and 6080 Professional Fees. 6060 is G&A cost and Fringe base, so the fringe on it carries into G&A (B3). Applied accounts: 5060 Labor & Machine Absorption (Fringe), 5070 Overhead Absorption (Overhead, G&A).
  2. The spec has one `rate`, written as both the Provisional and the Target rate from period 1 (12 rows each), as `setIndirectRate` writes a rate.
  3. Step 4 does not apply: the satellite dataset has no Cost Plus contract line, so no ceiling is seeded.
  4. The floors go in `DATASET_COVERAGE_FLOORS.satellite` (3 pools, 7 mappings, 72 rates), not `COVERAGE_FLOORS`: the shared floors take the smallest count of any dataset, which is 0 for the other 3.
  5. The validator rule `indirectPools` also checks unique names and sequences, the rate is a fraction, and one account is Cost of at most one pool (B4).
  6. `pnpm db:check:datasets` passes all four datasets with the database layer (3.0 s for satellite).
- Task 20:
  1. Typecheck of `@carbon/ee`, `@carbon/server-functions`, `@carbon/jobs` and `erp`: 5 tasks pass.
  2. `pnpm --filter @carbon/ee test`: 148 files, 2,023 tests pass. `pnpm --filter @carbon/server-functions test`: 127 files, 795 tests pass. No flaky test in these runs.
  3. `pnpm run lint`: 37 tasks pass, warnings only. `pnpm --filter @carbon/checks clobbers`: no clobber risks.
  4. `pnpm --filter @carbon/checks test` (not in the task list) found one new violation in Task 16's route: `no-interpolated-error-log` at `indirect-rates.tsx` (a template string in `logger.error`). The fix commit moves the read's name into the log context. The suite then passes (300 tests).
  5. 🛑 `pnpm --filter erp build` fails with "Server-only module referenced by client", and the cause is outside Phase 5b: `packages/planning/src/mrp/mrp.ts` imports `@carbon/ee/plan.server` and `planning-actions.ts` imports `@carbon/ee/pegging.server` (dynamic imports, Projects Phase 3, `1b80ed58f5`). The ERP's client graph reaches `@carbon/planning` through `purchasing.service.ts` and `production.service.ts`. No 5b commit touches `packages/planning`. With those 2 imports bypassed in the working tree only (then restored), the build passes, so 5b adds no server-only import to the client graph. The fix belongs to Phase 3 and is left for Brad.
  6. `pnpm db:check:backups`: `schema.json` restorable. `pnpm db:check:datasets`: all four pass.
- Task 21:
  1. `.claude/rules/indirect-rates.md` also tracks the `indirect-rates` job, the Indirect Rates UI folder and the `indirect-*` routes in its `paths:`, so the rule loads where the pages are edited.
  2. `government-contracting.md` said Phases 5b–5d were not built. It now points to `indirect-rates.md` for 5b.
  3. The spec's *Data Model Changes* also gains `projectLedger.burdenFiscalYear` (B8), which the 5b migration adds. Phase 5b is marked done in the status line, *Delivery phases* and the changelog; the acceptance criteria stay unticked until the browser check.
  4. `cd docs && pnpm typecheck` passes.
- Task 22: Browser verification deferred (overnight run rule). The box stays unticked.
