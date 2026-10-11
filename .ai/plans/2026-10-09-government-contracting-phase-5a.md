# Government Contracting Phase 5a — implementation plan

**Spec:** .ai/specs/2026-10-09-government-contracting.md (Phase 5a: *an adequate system*)
**Research:** .ai/research/government-contracting-layer.md
**Branch:** projects-wbs-research-spec
**Prerequisite:** these plans are done and committed:
- `.ai/plans/2026-10-07-projects-phase-1a.md` and `.ai/plans/2026-10-08-projects-phase-1b.md` (`timesheetEntry`, `laborCategory`, `projectLedger.unallowable`, `post-timesheet`, `project-posting.ts`);
- `.ai/plans/2026-10-09-field-service-phase-a.md`, Task 15 (the timesheet routes under `x+/timesheet`);
- `.ai/plans/2026-10-09-project-billing-phase-4a.md` (`customerContractLine.fundedCost`, `fundedAmount`, `projectElementId`, `billingMethod`, the server function `create-project-billing-invoices`, the line billing drawer and its **Edit funding** modal).

Task 1 checks each artifact. If one does not exist, STOP and report.

## Scope of this plan

Phase 5a gives a US defense manufacturer the accounting system that a pre-award survey (SF 1408) checks:
1. **Cost objectives:** Direct, IR&D, B&P, Indirect or Commercial on each project.
2. **Unallowable costs:** an allowability on each account and a flag on each element. The posting functions set `projectLedger.unallowable`. The Costs tab and the reports show unallowable cost in its own column.
3. **Preproduction:** a flag on each element, shown in the Costs tab.
4. **DCAA timekeeping mode** (a company setting, off by default):
   - the daily entry window, no advance entry, and a late reason;
   - certification at submit, and a correction trail in `timesheetEntryRevision`;
   - **Pending Employee Review** for edits by others, and supervisor entry on recorded absence;
   - re-approval after a change, and the total-time check against timecards;
   - the daily missing-time check, charge restrictions with `projectMember`, and leave elements;
   - labor transfers with a reason and a second approver.
5. **Dilution** for exempt staff at weekly certification.
6. **Labor distribution** with a payroll CSV import into `payrollPeriodTotal`.
7. **CLIN and ACRN funding:** numbers on contract lines, funding rows, and invoices by CLIN.
8. **Reports:** late entries, missing time, labor distribution, labor transfers, the auditor timesheet export, and cost by CLIN.

Phases 5b (indirect rates), 5c (control and earned value) and 5d (R&D tax) get their own plans. 5a and 5d are community code (spec Q1). Nothing in this plan goes into `packages/ee`.

## Decisions this plan adds

The spec leaves these points open. The plan decides them, and Task 34 records them in the spec.

| # | Point | Decision |
|---|---|---|
| P1 | Which element is a leave element | A new column `projectElement.isLeave`. A leave element must be on a project with cost objective Indirect. |
| P2 | Where the late reason lives | A new column `timesheetEntry.lateReason`. The late-entry report lists the entries that have one. |
| P3 | How a labor transfer links to its source | A new column `timesheetEntry.correctionOfId` on the replacement entry. A transfer is a correction whose charge number changes. |
| P4 | Re-dilution needs the factor that posted | A new column `timesheetEntry.dilutionFactor`. Null means 1. |
| P5 | A revision of a deleted Draft entry | `timesheetEntryRevision.timesheetEntryId` has no foreign key, so the trail outlives the entry. The table also stores `employeeId` for the owner read policy. |
| P6 | Certification history | `timesheetCertification` has no unique key. A re-certified week keeps every row; the latest row is current. |
| P7 | ACRN allocation storage | A new table `salesInvoiceFundingAllocation` (invoice, contract line, ACRN, amount). |
| P8 | Payroll import path | The existing CSV import wizard with a new table `payrollPeriodTotal`, in place of a separate `import-payroll-totals` function. It reuses upload, column mapping and employee mapping. |
| P9 | Shared timesheet writes | Two server functions, `save-timesheet-entry` and `submit-timesheet-week`. The ERP and the MES call them, so the DCAA rules live in one place. |
| P10 | Which lines take funding actions | Billing lines only (Time & Materials and Cost Plus). Billing Phase 4a (its decision P9) keeps a billing line's id for the line's whole life, so funding rows never move to another line. |

## Rules for the executor

- Read `.ai/lessons.md`, `.claude/rules/conventions-services.md`, `.claude/rules/conventions-forms.md`, `.claude/rules/database-patterns.md`, `.claude/rules/authz-manifest.md`, `.claude/rules/event-system.md`, `.claude/rules/csv-import-system.md` and `.claude/rules/projects-system.md` before Task 1.
- Use the `carbon-design` skill for every UI task.
- Start every new source file with its SPDX header. Run `pnpm --filter @carbon/checks license-headers` after you create files.
- Never use JavaScript `Date`. Use `@internationalized/date` and the `datetime` helpers in `@carbon/utils`.
- Round money with `round()` from `@carbon/utils`. Never query in a loop.
- Never construct a database client in a `*.service.ts`. Pass `db` from the route.
- 🛑 Every control is off until `companySettings.timekeepingControls = 'DCAA'`. In Standard mode, every timesheet path keeps its Phase 1a behavior. A test must prove it for each changed path.
- If a quoted code line or line number does not match the file, search for the quoted code. If you cannot find it, STOP and report. Do not improvise.

## Progress

- [x] Task 1: Check the prerequisites
- [x] Task 2: Create the enum migration
- [x] Task 3: Create the columns migration
- [x] Task 4: Create the timekeeping and funding tables migration
- [x] Task 5: Create the SQL functions migration
- [x] Task 6: Apply migrations, regenerate types, ship RLS
- [x] Task 7: Add the pure timekeeping helpers
- [x] Task 8: Add the pure funding helpers
- [x] Task 9: Set the unallowable flag and check charge restrictions at posting
- [x] Task 10: Add the `save-timesheet-entry` server function
- [x] Task 11: Add the `submit-timesheet-week` server function
- [x] Task 12: Apply dilution in `post-timesheet`
- [x] Task 13: Turn corrections into labor transfers
- [x] Task 14: Add the validators
- [ ] Task 15: Add the service functions
- [ ] Task 16: Route every timesheet write through the server functions
- [ ] Task 17: Add Settings → Timekeeping
- [ ] Task 18: Add allowability to the account drawer
- [ ] Task 19: Add the cost objective, restrict charging and members to the project
- [ ] Task 20: Add the element flags
- [ ] Task 21: Add the FLSA status to the employee job
- [ ] Task 22: Build the DCAA controls on My Timesheet
- [ ] Task 23: Add the employee timesheet page for managers
- [ ] Task 24: Add labor transfers to the correction modal and approvals
- [ ] Task 25: Add allowable, unallowable and preproduction cost to the Costs tab
- [ ] Task 26: Add CLIN numbers and funding actions to the contract line
- [ ] Task 27: Invoice by CLIN with ACRN allocation
- [ ] Task 28: Add the payroll totals import and list
- [ ] Task 29: Add the daily missing-time check
- [ ] Task 30: Add the Timesheets complete close task
- [ ] Task 31: Add the report queries and the CSV route
- [ ] Task 32: Add the Reports page
- [ ] Task 33: Keep the demo datasets green
- [ ] Task 34: Update the rules, AGENTS.md, docs and spec
- [ ] Task 35: Verify in the browser

## Dependencies

- Task 1 runs first. Tasks 2 → 3 → 4 → 5 → 6 run in order.
- Tasks 7 and 8 need Task 6 and are independent of each other.
- Task 9 needs Task 6. Tasks 10 and 11 need Tasks 7 and 9. Task 12 needs Tasks 7 and 9.
- Task 13 needs Task 10. Task 14 needs Task 6. Task 15 needs Tasks 8 and 14.
- Task 16 needs Tasks 10, 11 and 15. Tasks 17–21 need Tasks 14 and 15 and are independent of each other.
- Task 22 needs Tasks 16 and 17. Task 23 needs Task 22. Task 24 needs Tasks 13 and 16.
- Task 25 needs Tasks 5 and 9. Task 26 needs Tasks 8 and 15. Task 27 needs Tasks 8 and 26.
- Task 28 needs Task 6. Task 29 needs Task 5. Task 30 needs Tasks 5 and 29.
- Task 31 needs Tasks 13, 15 and 28. Task 32 needs Task 31.
- Task 33 needs Task 6. Task 34 needs Tasks 1–33. Task 35 runs last.

---

## Task 1: Check the prerequisites

**Depends on:** none
**Files:** none

**Steps:**
1. Run the command in **Verify**. Each line must print a non-zero count.
2. If a count is 0, STOP and report the missing artifact. Do not build it here.

**Verify:**
```bash
grep -c "timesheetEntryStatus" packages/database/src/types.ts
grep -c "unallowable" packages/database/src/types.ts
grep -c "laborCategoryId" packages/database/src/types.ts
grep -c "fundedCost" packages/database/src/types.ts
ls packages/server-functions/src/post-timesheet/index.ts packages/server-functions/src/create-project-billing-invoices/index.ts packages/server-functions/src/lib/project-posting.ts 'apps/erp/app/routes/x+/contract+/$id.$lineId.billing.tsx'
ls apps/erp/app/routes/x+/timesheet.tsx apps/erp/app/routes/x+/timesheet.update.tsx apps/erp/app/routes/x+/timesheet.submit.tsx apps/erp/app/routes/x+/timesheet.correct.tsx apps/erp/app/routes/x+/settings+/projects.tsx
# Expected: four counts above 0, and every listed file exists
```

**Out of scope:** any code change.

---

## Task 2: Create the enum migration

**Depends on:** 1
**Files:**
- Create: `packages/database/supabase/migrations/<timestamp>_government-contracting-enums.sql`
- Copy from (precedent): `.ai/plans/2026-10-09-field-service-phase-a.md` Task 1

**Steps:**
1. Run `pnpm db:migrate:new government-contracting-enums`.
2. Write only these statements. Postgres refuses a new enum value in the transaction that adds it, so they get their own migration:

```sql
CREATE TYPE "projectCostObjective" AS ENUM ('Direct', 'IR&D', 'B&P', 'Indirect', 'Commercial');
CREATE TYPE "accountAllowability" AS ENUM ('Allowable', 'Expressly Unallowable', 'Mutually Agreed Unallowable', 'Directly Associated Unallowable');
CREATE TYPE "elementOfCost" AS ENUM ('Labor', 'Material', 'Subcontract', 'Other Direct', 'Travel');
CREATE TYPE "timekeepingControls" AS ENUM ('Standard', 'DCAA');
CREATE TYPE "flsaStatus" AS ENUM ('Exempt', 'Non-Exempt');
ALTER TYPE "timesheetEntryStatus" ADD VALUE IF NOT EXISTS 'Pending Employee Review';
```

**Verify:**
```bash
grep -c "CREATE TYPE\|ADD VALUE" packages/database/supabase/migrations/*_government-contracting-enums.sql
# Expected: 6
```

**Out of scope:** the 5b, 5c and 5d enums.

---

## Task 3: Create the columns migration

**Depends on:** 2
**Files:**
- Create: `packages/database/supabase/migrations/<timestamp>_government-contracting-columns.sql`

**Steps:**
1. Run `pnpm db:migrate:new government-contracting-columns`.
2. Write the SQL below. Put each `ADD COLUMN IF NOT EXISTS` on its own line.
3. Add an index on every new FK column.

```sql
ALTER TABLE "account"
  ADD COLUMN IF NOT EXISTS "allowability" "accountAllowability" NOT NULL DEFAULT 'Allowable',
  ADD COLUMN IF NOT EXISTS "unallowableReason" TEXT,
  ADD COLUMN IF NOT EXISTS "elementOfCost" "elementOfCost";

ALTER TABLE "project"
  ADD COLUMN IF NOT EXISTS "costObjective" "projectCostObjective",
  ADD COLUMN IF NOT EXISTS "restrictCharging" BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE "project" DROP CONSTRAINT IF EXISTS "project_costObjective_treatment_check";
ALTER TABLE "project" ADD CONSTRAINT "project_costObjective_treatment_check"
  CHECK ("costObjective" IS NULL OR "costTreatment" <> 'Expense' OR "costObjective" IN ('IR&D', 'B&P', 'Indirect'));

ALTER TABLE "projectElement"
  ADD COLUMN IF NOT EXISTS "isUnallowable" BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS "isPreproduction" BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS "isLeave" BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE "companySettings"
  ADD COLUMN IF NOT EXISTS "timekeepingControls" "timekeepingControls" NOT NULL DEFAULT 'Standard',
  ADD COLUMN IF NOT EXISTS "timesheetEntryWindowDays" INTEGER NOT NULL DEFAULT 1 CHECK ("timesheetEntryWindowDays" >= 0),
  ADD COLUMN IF NOT EXISTS "timesheetTimecardCheck" TEXT NOT NULL DEFAULT 'Warn' CHECK ("timesheetTimecardCheck" IN ('Off', 'Warn', 'Block')),
  ADD COLUMN IF NOT EXISTS "certificationTextExempt" TEXT,
  ADD COLUMN IF NOT EXISTS "certificationTextNonExempt" TEXT,
  ADD COLUMN IF NOT EXISTS "standardWeeklyHours" NUMERIC NOT NULL DEFAULT 40 CHECK ("standardWeeklyHours" > 0);

ALTER TABLE "employeeJob"
  ADD COLUMN IF NOT EXISTS "flsaStatus" "flsaStatus";

ALTER TABLE "timesheetEntry"
  ADD COLUMN IF NOT EXISTS "lateReason" TEXT,
  ADD COLUMN IF NOT EXISTS "correctionOfId" TEXT,
  ADD COLUMN IF NOT EXISTS "dilutionFactor" NUMERIC CHECK ("dilutionFactor" > 0 AND "dilutionFactor" <= 1);
ALTER TABLE "timesheetEntry" DROP CONSTRAINT IF EXISTS "timesheetEntry_correctionOf_fkey";
ALTER TABLE "timesheetEntry" ADD CONSTRAINT "timesheetEntry_correctionOf_fkey"
  FOREIGN KEY ("correctionOfId", "companyId") REFERENCES "timesheetEntry"("id", "companyId") ON DELETE SET NULL ("correctionOfId");

ALTER TABLE "customerContractLine"
  ADD COLUMN IF NOT EXISTS "lineItemNumber" TEXT CHECK ("lineItemNumber" ~ '^[0-9]{4}([A-Z]{2}|[0-9]{2})?$'),
  ADD COLUMN IF NOT EXISTS "parentLineId" TEXT;
ALTER TABLE "customerContractLine" DROP CONSTRAINT IF EXISTS "customerContractLine_parentLine_fkey";
ALTER TABLE "customerContractLine" ADD CONSTRAINT "customerContractLine_parentLine_fkey"
  FOREIGN KEY ("parentLineId", "companyId") REFERENCES "customerContractLine"("id", "companyId") ON DELETE SET NULL ("parentLineId");
```

4. Add no unique index on `lineItemNumber`. An amendment of a Fixed line copies it, so two rows of one contract can share a number. The service checks uniqueness among current lines (Task 15).
5. `costTreatment` is the Phase 1a column name. If the project column has another name, use the real name.

**Verify:**
```bash
grep -c "ADD COLUMN IF NOT EXISTS" packages/database/supabase/migrations/*_government-contracting-columns.sql
# Expected: 20
```

**Out of scope:** the 5c project columns (`budgetControl`, `budgetTolerancePercent`, `stopWorkDate`) and the 5d columns.

---

## Task 4: Create the timekeeping and funding tables migration

**Depends on:** 3
**Files:**
- Create: `packages/database/supabase/migrations/<timestamp>_government-contracting-tables.sql`

**Steps:**
1. Run `pnpm db:migrate:new government-contracting-tables`.
2. Write the SQL below. Add an index on `companyId` and on every FK column.

```sql
CREATE TABLE IF NOT EXISTS "projectMember" (
  "projectId" TEXT NOT NULL,
  "userId" TEXT NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "companyId" TEXT NOT NULL,
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  CONSTRAINT "projectMember_pkey" PRIMARY KEY ("projectId", "userId", "companyId"),
  CONSTRAINT "projectMember_project_fkey" FOREIGN KEY ("projectId", "companyId") REFERENCES "project"("id", "companyId") ON DELETE CASCADE,
  CONSTRAINT "projectMember_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS "timesheetEntryRevision" (
  "id" TEXT NOT NULL DEFAULT id('tsr'),
  "companyId" TEXT NOT NULL,
  "timesheetEntryId" TEXT NOT NULL,                  -- no FK: the trail outlives a deleted Draft entry
  "employeeId" TEXT NOT NULL REFERENCES "user"("id"),
  "revisedBy" TEXT NOT NULL REFERENCES "user"("id"),
  "revisedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "reason" TEXT NOT NULL CHECK (length(trim("reason")) > 0),
  "before" JSONB,                                    -- null: the entry was created
  "after" JSONB,                                     -- null: the entry was deleted
  CONSTRAINT "timesheetEntryRevision_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "timesheetEntryRevision_change_check" CHECK ("before" IS NOT NULL OR "after" IS NOT NULL),
  CONSTRAINT "timesheetEntryRevision_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "timesheetEntryRevision_entry_idx" ON "timesheetEntryRevision" ("companyId", "timesheetEntryId", "revisedAt");
CREATE INDEX IF NOT EXISTS "timesheetEntryRevision_employee_idx" ON "timesheetEntryRevision" ("companyId", "employeeId", "revisedAt");

CREATE TABLE IF NOT EXISTS "timesheetCertification" (
  "id" TEXT NOT NULL DEFAULT id('tsc'),
  "companyId" TEXT NOT NULL,
  "employeeId" TEXT NOT NULL REFERENCES "user"("id"),
  "weekStart" DATE NOT NULL,
  "certifiedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "textHash" TEXT NOT NULL,
  "flsaStatus" "flsaStatus",
  CONSTRAINT "timesheetCertification_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "timesheetCertification_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "timesheetCertification_week_idx" ON "timesheetCertification" ("companyId", "employeeId", "weekStart", "certifiedAt");

CREATE TABLE IF NOT EXISTS "payrollPeriodTotal" (
  "id" TEXT NOT NULL DEFAULT id('ppt'),
  "companyId" TEXT NOT NULL,
  "employeeId" TEXT NOT NULL REFERENCES "user"("id"),
  "periodStart" DATE NOT NULL,
  "periodEnd" DATE NOT NULL,
  "grossWages" NUMERIC NOT NULL CHECK ("grossWages" >= 0),
  "hoursPaid" NUMERIC NOT NULL CHECK ("hoursPaid" >= 0),
  "importedBy" TEXT NOT NULL REFERENCES "user"("id"),
  "importedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  CONSTRAINT "payrollPeriodTotal_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "payrollPeriodTotal_period_key" UNIQUE ("employeeId", "periodStart", "periodEnd", "companyId"),
  CONSTRAINT "payrollPeriodTotal_dates_check" CHECK ("periodEnd" >= "periodStart"),
  CONSTRAINT "payrollPeriodTotal_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS "customerContractFunding" (
  "id" TEXT NOT NULL DEFAULT id('conf'),
  "companyId" TEXT NOT NULL,
  "customerContractLineId" TEXT NOT NULL,
  "modificationNumber" TEXT NOT NULL,
  "fundedDate" DATE NOT NULL,
  "acrn" TEXT NOT NULL CHECK ("acrn" ~ '^[A-Z0-9]{2}$'),
  "fundedCost" NUMERIC NOT NULL,                     -- negative for a deobligation
  "fundedFee" NUMERIC NOT NULL DEFAULT 0,
  "expiresOn" DATE,
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  CONSTRAINT "customerContractFunding_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "customerContractFunding_line_fkey" FOREIGN KEY ("customerContractLineId", "companyId") REFERENCES "customerContractLine"("id", "companyId") ON DELETE CASCADE,
  CONSTRAINT "customerContractFunding_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS "salesInvoiceFundingAllocation" (
  "id" TEXT NOT NULL DEFAULT id('sifa'),
  "companyId" TEXT NOT NULL,
  "salesInvoiceId" TEXT NOT NULL REFERENCES "salesInvoice"("id") ON DELETE CASCADE,
  "customerContractLineId" TEXT NOT NULL,
  "acrn" TEXT NOT NULL,
  "amount" NUMERIC NOT NULL,
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  CONSTRAINT "salesInvoiceFundingAllocation_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "salesInvoiceFundingAllocation_line_fkey" FOREIGN KEY ("customerContractLineId", "companyId") REFERENCES "customerContractLine"("id", "companyId"),
  CONSTRAINT "salesInvoiceFundingAllocation_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE
);
```

3. `salesInvoice` has `PRIMARY KEY ("id")` (`20250507143421_sales-invoice.sql:61`), so its FK is single-column.

**Verify:**
```bash
grep -c "CREATE TABLE IF NOT EXISTS" packages/database/supabase/migrations/*_government-contracting-tables.sql
# Expected: 6
```

**Out of scope:** the RLS rules (Task 6).

---

## Task 5: Create the SQL functions migration

**Depends on:** 4
**Files:**
- Create: `packages/database/supabase/migrations/<timestamp>_government-contracting-functions.sql`

**Steps:**
1. Run `pnpm db:migrate:new government-contracting-functions`.
2. Find the newest definition of `get_project_cost_summary`: `grep -ln "get_project_cost_summary" packages/database/supabase/migrations/*.sql | tail -1`.
3. Copy that definition into the new file. Put `DROP FUNCTION IF EXISTS get_project_cost_summary(TEXT, TEXT);` before it, because the return type changes.
4. Add one column at the end of its `RETURNS TABLE`: `"actualUnallowable" NUMERIC`. Add this CTE and join it like `actuals`:

```sql
  unallowable_actuals AS (
    SELECT pl."projectElementId", SUM(pl."amount") AS v
    FROM "projectLedger" pl
    WHERE pl."projectId" = p_project_id AND pl."companyId" = p_company_id AND pl."unallowable"
    GROUP BY pl."projectElementId"
  )
```

5. Add the missing-time function. The daily job (Task 29) and the missing-time report (Task 31) both read it:

```sql
CREATE OR REPLACE FUNCTION get_missing_timesheet_days(p_company_id TEXT, p_from DATE, p_to DATE)
RETURNS TABLE ("employeeId" TEXT, "date" DATE, "managerId" TEXT)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  SELECT DISTINCT es."employeeId", d::date, ej."managerId"
  FROM generate_series(p_from, p_to, interval '1 day') AS d
  JOIN "employeeShift" es ON es."companyId" = p_company_id
  JOIN "shift" s ON s."id" = es."shiftId" AND s."active"
  JOIN "employee" e ON e."id" = es."employeeId" AND e."companyId" = p_company_id AND e."active"
  LEFT JOIN "employeeJob" ej ON ej."id" = es."employeeId" AND ej."companyId" = p_company_id
  WHERE CASE EXTRACT(ISODOW FROM d)
          WHEN 1 THEN s."monday" WHEN 2 THEN s."tuesday" WHEN 3 THEN s."wednesday"
          WHEN 4 THEN s."thursday" WHEN 5 THEN s."friday" WHEN 6 THEN s."saturday"
          ELSE s."sunday" END
    AND NOT EXISTS (SELECT 1 FROM "holiday" h WHERE h."companyId" = p_company_id AND h."date" = d::date)
    AND NOT EXISTS (SELECT 1 FROM "peopleAbsence" a
                    WHERE a."companyId" = p_company_id AND a."employeeId" = es."employeeId" AND a."date" = d::date)
    AND NOT EXISTS (SELECT 1 FROM "timesheetEntry" t
                    WHERE t."companyId" = p_company_id AND t."employeeId" = es."employeeId" AND t."entryDate" = d::date)
$$;
```

6. Check `employeeJob` in `packages/database/src/types.ts`. Its `id` must be the employee's user id. If it is not, STOP and report.

**Verify:**
```bash
grep -c "CREATE OR REPLACE FUNCTION" packages/database/supabase/migrations/*_government-contracting-functions.sql
# Expected: 2
pnpm --filter @carbon/checks clobbers
# Expected: no finding for get_project_cost_summary
```

**Out of scope:** the pg_cron sweep (Task 29) and the close task row (Task 30).

---

## Task 6: Apply migrations, regenerate types, ship RLS

**Depends on:** 5
**Files:**
- Modify: `packages/database/src/authz/manifest.ts`
- Modify: `packages/jobs/src/backups/id-refs.ts`
- Modify: generated types

**Steps:**
1. Run `pnpm db:migrate`, then `pnpm run generate:types`.
2. Add these manifest entries. The precedent for the owner read is `timeCardEntry` (`manifest.ts:1511-1525`):

```ts
projectMember: company("projects"),
timesheetEntryRevision: company("projects", {
  read: or(and(owner("employeeId"), inCompany("companyId", "employee")), inCompany("companyId", "projects_view")),
  create: false, update: false, delete: false
}),
timesheetCertification: company("projects", {
  read: or(and(owner("employeeId"), inCompany("companyId", "employee")), inCompany("companyId", "projects_view")),
  create: false, update: false, delete: false
}),
payrollPeriodTotal: company("people", { read: "people_view" }),
customerContractFunding: company("sales"),
salesInvoiceFundingAllocation: company("invoicing", { create: false, update: false, delete: false }),
```

3. Only server functions write the revision, certification and allocation rows, through `ctx.db`. So the clients get no write policy.
4. Add `timesheetEntryRevision: ["timesheetEntryId"]` to `ID_REF_COLUMNS`. The column holds a row id with no FK (`id-refs.ts:17-34`).
5. Run `pnpm db:migrate`, then `pnpm --filter @carbon/database authz migration government-contracting-rls`, then `pnpm db:migrate` and `pnpm run generate:types`.

**Verify:**
```bash
pnpm --filter @carbon/database exec vitest run src/authz
# Expected: all tests pass
pnpm --filter @carbon/database authz check
# Expected: exit code 0 (no drift)
pnpm exec turbo run typecheck --filter=@carbon/database --filter=@carbon/jobs
# Expected: exit code 0
```

**Out of scope:** UI.

---

## Task 7: Add the pure timekeeping helpers

**Depends on:** 6
**Files:**
- Create: `packages/utils/src/timekeeping.ts`
- Create: `packages/utils/src/timekeeping.test.ts`
- Modify: `packages/utils/src/index.ts` — export it

**Steps:**
1. Write these pure functions. Compare dates as `YYYY-MM-DD` strings. Use `parseDate` and `startOfWeek` from `@internationalized/date` for date math.

```ts
export type TimekeepingControls = "Standard" | "DCAA";
export type TimesheetEntryStatus = "Draft" | "Submitted" | "Approved" | "Posted" | "Rejected" | "Pending Employee Review";

export function isEntryDateAllowed(args: {
  entryDate: string; today: string; windowDays: number; isLeave: boolean;
}): { allowed: true; late: boolean } | { allowed: false; reason: "future" };

export function nextEntryStatus(args: {
  mode: TimekeepingControls; current: TimesheetEntryStatus | null; actorIsOwner: boolean;
}): TimesheetEntryStatus | { refuse: string };

export function weekStartOf(date: string): string;            // the ISO Monday, YYYY-MM-DD
export function dilutionFactor(standardWeeklyHours: number, weekHours: number): number;
export function timecardShortfall(entryHours: number, timecardHours: number): number;
```

2. `isEntryDateAllowed`:
   1. If `entryDate > today` and not `isLeave`, return `{ allowed: false, reason: "future" }`.
   2. If `entryDate < today − windowDays`, return `{ allowed: true, late: true }`.
   3. Else return `{ allowed: true, late: false }`.
3. `nextEntryStatus` (`current` null means a new entry):
   - Standard, owner, new or Draft: `"Draft"`. Standard, any other case: refuse with "Only a Draft entry can change".
   - DCAA, `current` Posted: refuse with "A posted entry changes only by correction".
   - DCAA, actor is not the owner: `"Pending Employee Review"`.
   - DCAA, owner, any other status: `"Draft"`. This is the re-approval rule.
4. `dilutionFactor` returns `min(1, standard ÷ weekHours)`. It returns 1 when `weekHours <= 0`. Round with `round()`.
5. `timecardShortfall` returns `max(0, timecardHours − entryHours)`, rounded with `round()`.
6. Write `timekeeping.test.ts` with these 10 cases:
   1. Window 1, today 2026-10-09: 2026-10-08 is not late; 2026-10-06 is late.
   2. 2026-10-10 is refused as future; the same date on a leave element is allowed.
   3. Standard mode: a Submitted entry refuses.
   4. DCAA: a manager's change to a Draft entry gives Pending Employee Review.
   5. DCAA: the owner's change to an Approved entry gives Draft.
   6. DCAA: a Posted entry refuses.
   7. `weekStartOf("2026-10-11")` is `"2026-10-05"`.
   8. `dilutionFactor(40, 50)` is 0.8.
   9. `dilutionFactor(40, 32)` is 1.
   10. `timecardShortfall(38, 40)` is 2.

**Verify:**
```bash
pnpm --filter @carbon/utils test -- timekeeping
# Expected: 10 passed
```

**Out of scope:** the database reads (Task 10).

---

## Task 8: Add the pure funding helpers

**Depends on:** 6
**Files:**
- Create: `packages/utils/src/contract-funding.ts`
- Create: `packages/utils/src/contract-funding.test.ts`
- Modify: `packages/utils/src/index.ts` — export it

**Steps:**
1. Write these pure functions:

```ts
export function parseLineItemNumber(value: string):
  { clin: string; suffix: string | null; type: "CLIN" | "Priced SLIN" | "Informational SLIN" } | null;
export function sumFunding(rows: { fundedCost: number; fundedFee: number }[]):
  { fundedCost: number; fundedAmount: number };
export function allocateToAcrns(amount: number, acrns: {
  acrn: string; firstFundedDate: string; funded: number; billed: number;
}[]): { allocations: { acrn: string; amount: number }[]; unallocated: number };
```

2. `parseLineItemNumber`: `0001` is a CLIN, `0001AA` is a Priced SLIN, `000101` is an Informational SLIN. Any other text returns null.
3. `sumFunding` returns `fundedCost` = Σ `fundedCost`, and `fundedAmount` = Σ (`fundedCost` + `fundedFee`), each rounded.
4. `allocateToAcrns` (PGI 204.7108, oldest funds first):
   1. If `amount > 0`, order the ACRNs by `firstFundedDate`, then by `acrn`. Give each the lesser of its remainder (`funded − billed`, at least 0) and what is left.
   2. If `amount < 0`, order newest first. Take back from each up to its `billed`.
   3. Return what no ACRN takes as `unallocated`.
5. Write `contract-funding.test.ts` with these 6 cases:
   1. `parseLineItemNumber` gives the three types, and null for `001`.
   2. Funding rows of 50,000.00 and 30,000.00 with fees 0 give `fundedCost` 80,000.00.
   3. 60,000.00 over ACRN AA (50,000.00, funded first) and AB (30,000.00) gives AA 50,000.00 and AB 10,000.00.
   4. AA already billed 45,000.00: 10,000.00 gives AA 5,000.00 and AB 5,000.00.
   5. 90,000.00 against 80,000.00 of funding leaves 10,000.00 unallocated.
   6. A credit of −5,000.00 comes back from AB first.

**Verify:**
```bash
pnpm --filter @carbon/utils test -- contract-funding
# Expected: 6 passed
```

**Out of scope:** the invoice (Task 27).

---

## Task 9: Set the unallowable flag and check charge restrictions at posting

**Depends on:** 6
**Files:**
- Modify: `packages/server-functions/src/lib/project-posting.ts`
- Modify: `packages/server-functions/src/lib/project-posting.test.ts`
- Modify: every caller of `buildProjectLedgerRow` (find them with `grep -rln "buildProjectLedgerRow" packages/server-functions/src`)

**Steps:**
1. Extend the types:
   - `ProjectPostingElement` gains `isUnallowable: boolean`.
   - `ProjectPostingProject` gains `restrictCharging: boolean` and `memberIds: string[]`.
   - `ProjectPostingContext` gains `accountAllowability: Record<string, Database["public"]["Enums"]["accountAllowability"]>`.
2. In `loadProjectPostingContexts`, select the new columns. Add at most 2 queries, never one per ref:
   1. The allowability of every account that a default, a project or an element names (`.where("id", "in", …)`).
   2. The `projectMember` rows of the projects with `restrictCharging` true. Skip this query when there is none.
3. Add the pure `isUnallowableCharge(ctx, accountId: string | null): boolean`. It returns true when either:
   - `accountId` is set and its allowability is not `Allowable`; or
   - the element or one of its ancestors has `isUnallowable`.
4. Make `unallowable: boolean` a required argument of `buildProjectLedgerRow`. The compiler then lists every caller.
5. In each caller, pass `unallowable: isUnallowableCharge(ctx, accountId)`. Use the account that `resolveProjectPostingAccount` returned for that row.
6. Add an optional third argument to `assertChargeable(ctx, mode, timeEmployeeId?: string)`. If it is set, `restrictCharging` is true, and the employee is not in `memberIds`, throw `ProjectChargeError`. The message is "<identifier> accepts time only from its members".
7. Add 5 tests:
   1. An element under an `isUnallowable` parent gives true.
   2. An account with `Expressly Unallowable` gives true.
   3. An Allowable account and no flagged element gives false.
   4. `assertChargeable` refuses a non-member's time on a restricted project.
   5. `assertChargeable` accepts a member's time, and any charge with no employee.

**Verify:**
```bash
pnpm --filter @carbon/server-functions test -- project-posting
# Expected: all tests pass
pnpm exec turbo run typecheck --filter=@carbon/server-functions --concurrency=1
# Expected: exit code 0
```

**Out of scope:** billing rule 3 of the project billing spec. Billing already skips `unallowable` rows.

---

## Task 10: Add the `save-timesheet-entry` server function

**Depends on:** 7, 9
**Files:**
- Create: `packages/server-functions/src/save-timesheet-entry/index.ts`
- Create: `packages/server-functions/src/save-timesheet-entry/save-timesheet-entry.test.ts`
- Modify: `packages/server-functions/src/invoke.ts` — register it
- Copy from (precedent): `packages/server-functions/src/post-timesheet/index.ts` (context, transaction, `inOrder`)

**Steps:**
1. Input:

```ts
{
  employeeId: string; entryDate: string; projectId: string; projectElementId: string | null;
  laborCategoryId: string; hours: number; note?: string;
  lateReason?: string;   // required when the date is late in DCAA mode
  reason?: string;       // required to change a saved entry in DCAA mode
}
```

   Permissions: `{ update: "projects" }`. The ERP and the MES invoke it after their own checks. The actor is `ctx.userId`.
2. In one transaction:
   1. Load `companySettings` (`timekeepingControls`, `timesheetEntryWindowDays`) and the company time zone. Compute `today` with `datetime.today(tz).toString()`.
   2. Load the project (`restrictCharging`, `identifier`) and the element (`isLeave`), with one query each.
   3. Find the existing entry for (employee, date, project, element, category) with `.forUpdate()`. Ignore Posted entries and reversals.
   4. Compute the status with `nextEntryStatus`. If it refuses, return `{ error }` with its message.
3. **Standard mode:** keep the Phase 1a `upsertTimesheetCell` behavior exactly. Hours 0 deletes the Draft entry. Write no revision.
4. **DCAA mode**, in this order:
   1. If `isEntryDateAllowed` refuses, return the error "Time cannot be entered for a future date".
   2. If the date is late and `lateReason` is empty, return the error "Give a reason for the late entry". Store `lateReason`.
   3. If `restrictCharging` is true and the employee is not a member, return the error from Task 9.
   4. If the actor is not the employee and no entry exists, the actor creates one for the employee. Refuse unless a `peopleAbsence` row exists for the employee on that date. Require `reason`. This is supervisor entry.
   5. If an entry exists, require `reason`. Write the change.
   6. Write one `timesheetEntryRevision` row in the same transaction. Set `before` and `after` to `{ hours, projectElementId, laborCategoryId, entryDate }`, or null.
   7. If hours is 0, delete the entry. Write the revision with `after: null` first.
5. Never write a revision for the owner's first save of an entry. It is not a change.
6. Return `{ data: { entryId, status } }`.
7. Write `save-timesheet-entry.test.ts` with `databaseTest`:
   1. Standard mode: a Draft cell saves with no revision.
   2. DCAA, window 1: an entry 3 days ago with no late reason is refused; with one, it saves and stores it.
   3. DCAA: an entry for tomorrow is refused.
   4. DCAA: the owner changes 6 h to 4 h with a reason. One revision has `before.hours` 6, `after.hours` 4, the actor and the reason.
   5. DCAA: a manager changes the entry. Its status becomes Pending Employee Review.
   6. DCAA: a manager creates an entry for a day with no absence. It is refused. With an absence row, it saves as Pending Employee Review.
8. Run `pnpm --filter @carbon/server-functions test -- -u`. Read the permissions snapshot diff: it must add only `save-timesheet-entry`.

**Verify:**
```bash
pnpm --filter @carbon/server-functions test -- save-timesheet-entry permissions-manifest
# Expected: all tests pass
```

**Out of scope:** posting. Saving never posts.

---

## Task 11: Add the `submit-timesheet-week` server function

**Depends on:** 7, 9
**Files:**
- Create: `packages/server-functions/src/submit-timesheet-week/index.ts`
- Create: `packages/server-functions/src/submit-timesheet-week/submit-timesheet-week.test.ts`
- Modify: `packages/server-functions/src/invoke.ts` — register it

**Steps:**
1. Input: `{ employeeId: string; weekStart: string; certificationText?: string }`. Permissions: `{ update: "projects" }`.
2. In one transaction:
   1. Load the settings, the employee's `employeeJob.flsaStatus`, and the week's entries (Monday to Sunday) with `.forUpdate()`.
   2. **Standard mode:** set Draft entries to Submitted and stamp `submittedAt`, as Phase 1a `submitTimesheetEntries` does. Skip the steps below.
   3. **DCAA mode:**
      1. If an entry is Pending Employee Review, refuse with "Review the changes to your timesheet first".
      2. If `timeCardEnabled` is true and `timesheetTimecardCheck` is not Off, sum the week's timecard hours. Use `clockOut − clockIn` of the employee's `timeCardEntry` rows in the week.
      3. Compute `timecardShortfall(entryHours, timecardHours)`. The message is "Your entries account for X h of Y h on your timecards". If the shortfall is above 0 and the check is Block, refuse with it. If the check is Warn, add it to `warnings`.
      4. Pick the text: `certificationTextExempt` for an Exempt employee, else `certificationTextNonExempt`. If `certificationText` differs from it, refuse with "The certification text changed. Reload the page".
      5. Insert a `timesheetCertification` row. Store `textHash` = the SHA-256 hex of the text (`createHash` from `node:crypto`) and the FLSA status.
      6. Set every Draft entry of the week to Submitted.
3. Return `{ data: { entryIds, warnings } }`.
4. Write `submit-timesheet-week.test.ts` with `databaseTest`:
   1. Standard mode: Draft entries become Submitted, and no certification row exists.
   2. DCAA, check Block: 38 h of entries against 40 h of timecards are refused.
   3. DCAA, check Warn: the same week submits and returns one warning.
   4. DCAA: an exempt employee's certification row stores the hash of the exempt text.
   5. DCAA: a week with a Pending Employee Review entry is refused.
5. Update the permissions snapshot (`-u`) and review it.

**Verify:**
```bash
pnpm --filter @carbon/server-functions test -- submit-timesheet-week permissions-manifest
# Expected: all tests pass
```

**Out of scope:** posting after submit. The route invokes `post-timesheet` (Task 16).

---

## Task 12: Apply dilution in `post-timesheet`

**Depends on:** 7, 9
**Files:**
- Modify: `packages/server-functions/src/post-timesheet/index.ts`
- Modify: `packages/server-functions/src/post-timesheet/plan.ts`
- Modify: `packages/server-functions/src/post-timesheet/plan.test.ts`
- Modify: `packages/server-functions/src/post-timesheet/post-timesheet.test.ts`

**Steps:**
1. Pass the entry's `employeeId` to `assertChargeable` as `timeEmployeeId` (Task 9).
2. Load `timekeepingControls` and `standardWeeklyHours`, and the `flsaStatus` of every employee in the call, with one query each.
3. Dilution applies only when the mode is DCAA and the employee is Exempt. For each (employee, week) in the call:
   1. Week hours H = Σ `hours` of the employee's entries in the ISO week (`weekStartOf`) with status Submitted, Approved or Posted. Use one query for all pairs.
   2. Factor f = `dilutionFactor(standardWeeklyHours, H)`.
   3. A new entry's cost = `round(hours × rate × f)`. Stamp `costRate` = `round(rate × f)` and `dilutionFactor` = f.
4. **Re-dilution.** After the new entries post, load the Posted entries of each pair's week. Skip reversals and entries that have a reversal. For each other entry:
   1. Base rate = `costRate ÷ (dilutionFactor ?? 1)`.
   2. Target = `round(hours × base rate × f)`.
   3. Posted = Σ `projectLedger.amount` with `documentType 'Timesheet'` and `documentId` = the entry id.
   4. If target − posted is not 0, post the difference. Use the same account, the same lines and the same dimensions as the entry. Write a `projectLedger` row with `quantity` 0, the entry id, and `unallowable` from Task 9.
   5. Update `costRate` = `round(base rate × f)` and `dilutionFactor` = f on the entry.
5. A reversal keeps the original entry's `costRate`, as in Phase 1a. Step 4 updates that rate, so a reversal always nets the entry's posted cost.
6. Put the arithmetic in `plan.ts`: `planDilution(entries, rates, factor) → { costs, adjustments, stamps }`.
7. Add tests to `plan.test.ts`:
   1. An exempt employee records 50 h at 60.00 over 5 entries. The week posts 2,400.00, and each entry's `costRate` is 48.00.
   2. A Non-Exempt employee's 50 h post at 60.00.
   3. A correction removes 10 h from the 50 h week. The remaining 40 h are re-diluted to factor 1, with an adjustment of +480.00.
8. Add a `databaseTest` in Standard mode. An Exempt employee's 50 h post at the full rate.

**Verify:**
```bash
pnpm --filter @carbon/server-functions test -- post-timesheet
# Expected: all tests pass
```

**Out of scope:** the standard-rate method (CAM 6-410.4c).

---

## Task 13: Turn corrections into labor transfers

**Depends on:** 10
**Files:**
- Modify: `apps/erp/app/modules/projects/projects.service.ts` — `createTimesheetCorrection`
- Modify: `apps/erp/app/modules/projects/projects.models.ts` — `timesheetCorrectionValidator`, `assertCanApprove`
- Create: `apps/erp/test/projects-labor-transfer.test.ts`

**Steps:**
1. `timesheetCorrectionValidator` gains optional `projectId`, `projectElementId` and `laborCategoryId`. They name the new charge number and category.
2. `createTimesheetCorrection(db, args)` changes, in its one transaction:
   1. The replacement takes the new charge number and category when given, else the original's.
   2. Set `correctionOfId` = the original's id on the replacement.
   3. In DCAA mode, write one `timesheetEntryRevision` on the original. `before` is the original's fields, `after` is the replacement's (or null for 0 h), and `reason` is `correctionReason`.
   4. Return `{ reversalId, replacementId, isTransfer }`. `isTransfer` is true when the project or element differs from the original.
3. Add the pure `assertCanApprove({ mode, approverId, entry })` to `projects.models.ts`. In DCAA mode, it refuses when the entry has `correctionOfId` and `entry.createdBy` equals `approverId`. The message is "A labor transfer needs an approver other than the requester".
4. Write `projects-labor-transfer.test.ts` with 3 cases for `assertCanApprove`:
   1. DCAA: the requester cannot approve their own transfer.
   2. DCAA: another user can.
   3. Standard mode: the requester can.

**Verify:**
```bash
pnpm --filter erp test -- projects-labor-transfer && pnpm exec turbo run typecheck --filter=erp
# Expected: 3 passed; typecheck exits 0
```

**Out of scope:** the modal and the approvals action (Task 24).

---

## Task 14: Add the validators

**Depends on:** 6
**Files:**
- Modify: `apps/erp/app/modules/projects/projects.models.ts`
- Modify: `apps/erp/app/modules/accounting/accounting.models.ts` (`accountValidator` `:328`)
- Modify: `apps/erp/app/modules/people/people.models.ts` (`employeeJobValidator` `:44-51`)
- Modify: `apps/erp/app/modules/sales/sales.models.ts` (`customerContractLineValidator` `:1954`)
- Modify: `apps/erp/app/modules/settings/settings.models.ts`

**Steps:**
1. **Projects:**
   - `projectValidator` gains `costObjective` (optional enum) and `restrictCharging` (`zfd.checkbox()`).
   - `projectElementFieldUpdateValidator` accepts the fields `isUnallowable`, `isPreproduction` and `isLeave`.
   - `timesheetCellValidator` gains optional `lateReason` and `reason`.
   - Add `projectMemberValidator`: `projectId`, `userId`.
   - Add `timesheetWeekSubmitValidator`: `weekStart`, optional `certificationText`.
   - Add `timesheetReviewAcceptValidator`: `ids` (array of entry ids).
2. **Accounting:** `accountValidator` gains `allowability` (enum, default `Allowable`), optional `unallowableReason` and optional `elementOfCost`.
3. **People:** `employeeJobValidator` gains optional `flsaStatus`.
4. **Sales:**
   - `customerContractLineValidator` gains optional `lineItemNumber` (regex `^[0-9]{4}([A-Z]{2}|[0-9]{2})?$`) and optional `parentLineId`.
   - Add `customerContractFundingValidator`: `id` optional, `customerContractLineId`, `modificationNumber`, `fundedDate`, `acrn` (regex `^[A-Z0-9]{2}$`), `fundedCost`, `fundedFee`, optional `expiresOn`.
5. **Settings:** add `timekeepingSettingsValidator`:
   - `timekeepingControls` (enum);
   - `timesheetEntryWindowDays` (integer ≥ 0) and `timesheetTimecardCheck` (`Off` | `Warn` | `Block`);
   - `certificationTextExempt` and `certificationTextNonExempt`;
   - `standardWeeklyHours` (> 0).

   Refine: in DCAA mode, both texts are required.
6. Export the enum value arrays (`projectCostObjectives`, `accountAllowabilities`, `elementsOfCost`, `flsaStatuses`) next to the validators. Copy the shape of `accountTypes` in `accounting.models.ts`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exit code 0
```

**Out of scope:** forms (Tasks 17–26).

---

## Task 15: Add the service functions

**Depends on:** 8, 14
**Files:**
- Modify: `apps/erp/app/modules/projects/projects.service.ts`
- Modify: `apps/erp/app/modules/projects/projects.server.ts`
- Modify: `apps/erp/app/modules/accounting/accounting.service.ts` (`upsertAccount` `:4366`)
- Modify: `apps/erp/app/modules/people/people.service.ts` (`updateEmployeeJob` `:632`)
- Modify: `apps/erp/app/modules/sales/sales.service.ts` (`upsertContractLine` `:10022`)
- Modify: `apps/erp/app/modules/settings/settings.service.ts`
- Copy from (precedent): `updateInvoiceAutomationSetting` (`settings.service.ts:1405`)

**Steps:**
1. **Projects** (`projects.service.ts`, client first, `{data, error}`):
   - `getProjectMembers(client, projectId, companyId)`, `addProjectMember(client, args)`, `removeProjectMember(client, args)`.
   - `getTimesheetRevisions(client, { companyId, timesheetEntryId })`, ordered by `revisedAt`.
   - `getPendingReviewEntries(client, { companyId, employeeId })`: the employee's Pending Employee Review entries with their latest revision.
   - `acceptTimesheetReview(db, { companyId, employeeId, ids, userId })`: in one transaction, set those entries to Draft and write one revision each with reason "Accepted by employee". Refuse an entry that is not the employee's.
   - `updateProject` and the project insert write `costObjective` and `restrictCharging`.
   - `updateProjectElementField` handles `isUnallowable`, `isPreproduction` and `isLeave`. It refuses `isLeave` true unless the project's cost objective is Indirect.
2. **Projects** (`projects.server.ts`): add `saveTimesheetEntry(args)` and `submitTimesheetWeek(args)`. They invoke the Task 10 and Task 11 server functions through `serverFns.system(...)`, as `postTimesheetEntries` does.
3. **Accounting:** `upsertAccount` already writes the validator's fields. Check that `allowability`, `unallowableReason` and `elementOfCost` reach the insert and the update. Add them if `sanitize` drops them.
4. **People:** add `flsaStatus: sanitized.flsaStatus` to the explicit allow-list in `updateEmployeeJob`.
5. **Sales:**
   - `upsertContractLine` writes `lineItemNumber` and `parentLineId`. It refuses a number that a current line of the same contract uses. A current line is one that no other line names in `amendsLineId`.
   - It refuses a `parentLineId` whose number is not a CLIN with the same first 4 digits.
   - Add `getContractFundingActions(client, lineIds, companyId)`. Billing Phase 4a already owns the name `getContractLineFunding`.
   - Add `upsertContractFunding(db, args)` and `deleteContractFunding(db, args)`. Each runs one Kysely transaction and calls `syncContractLineFunding(trx, lineId)` before commit. Both refuse a Fixed line (decision P10).
   - `syncContractLineFunding` sums the line's funding rows with `sumFunding`. It writes `fundedCost` and `fundedAmount` on the line.
   - In DCAA mode, the billing Phase 4a function `updateContractLineFunding` stops writing `fundedCost` and `fundedAmount`. It still writes the notice percent, the notice window and the ceiling.
6. **Settings:** add `updateTimekeepingSettings(client, companyId, values)` with an `@mcp update` tag.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exit code 0
```

**Out of scope:** the report queries (Task 31).

---

## Task 16: Route every timesheet write through the server functions

**Depends on:** 10, 11, 15
**Files:**
- Modify: `apps/erp/app/routes/x+/timesheet.update.tsx`, `apps/erp/app/routes/x+/timesheet.submit.tsx`
- Modify: the element **Log time** action (Phase 1a Task 36; find it with `grep -rln "logTimeValidator" apps/erp/app/routes`)
- Modify: the field service charge route `apps/erp/app/routes/x+/service-order+/$id.charge.tsx` (intent `time`), if it exists
- Modify: `apps/mes/app/routes/x+/timesheet.tsx`, `apps/mes/app/services/projects.service.ts`
- Copy from (precedent): `apps/mes/app/services/maintenance.service.ts:178-186` (MES `serverFns.as`)

**Steps:**
1. `timesheet.update.tsx` calls `saveTimesheetEntry` for the current user. It returns `{ error }` or `{ data }`.
2. `timesheet.submit.tsx` calls `submitTimesheetWeek`. Then it calls `postTimesheetEntries` with the returned ids, when `timesheetApprovalRequired` is false. It flashes each warning.
3. The Log time action and the field service time intent insert through `saveTimesheetEntry`. The field service route then posts the entry, as it does today.
4. In the MES, replace `upsertTimesheetCell` and `submitTimesheetEntries` with calls through `serverFns.as({ client, db, companyId, userId }).invoke(...)`. Delete the two copied functions from `apps/mes/app/services/projects.service.ts`.
5. Leave `createTimesheetCorrection` as the only other insert path. It writes its own revision (Task 13).
6. Remove `upsertTimesheetCell` and `submitTimesheetEntries` from the ERP `projects.service.ts` when nothing calls them.

**Verify:**
```bash
grep -rn "from(\"timesheetEntry\").insert\|insertInto(\"timesheetEntry\")" apps/erp/app apps/mes/app packages/server-functions/src | grep -v test
# Expected: matches only in save-timesheet-entry and createTimesheetCorrection
pnpm exec turbo run typecheck --filter=erp --filter=mes
# Expected: exit code 0
```

**Out of scope:** the UI changes (Task 22).

---

## Task 17: Add Settings → Timekeeping

**Depends on:** 14, 15
**Files:**
- Create: `apps/erp/app/routes/x+/settings+/timekeeping.tsx`
- Modify: `apps/erp/app/modules/settings/ui/useSettingsSubmodules.tsx` — a **Timekeeping** entry next to Projects
- Modify: `apps/erp/app/utils/path.ts` — `timekeepingSettings`
- Copy from (precedent): `apps/erp/app/routes/x+/settings+/invoicing.tsx` (cards, intent switch)

**Steps:**
1. The page has one card with these fields:
   - **Controls** (Standard or DCAA), with one line that explains DCAA mode;
   - **Entry window (days)** and **Timecard check** (Off, Warn, Block);
   - **Certification text, exempt staff** and **Certification text, non-exempt staff** (text areas);
   - **Standard weekly hours**.
2. The action runs `requirePermissions(request, { update: "settings" })` and validates with `timekeepingSettingsValidator`.
3. Before it turns on DCAA, the action counts the company's Released projects with no `costObjective`. If the count is above 0, it refuses with "Set a cost objective on N projects first".
4. Then it calls `updateTimekeepingSettings`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exit code 0
```

**Out of scope:** per-employee overrides.

---

## Task 18: Add allowability to the account drawer

**Depends on:** 14, 15
**Files:**
- Modify: `apps/erp/app/modules/accounting/ui/ChartOfAccounts/ChartOfAccountForm.tsx` (hidden inputs `:122-125`)
- Modify: `apps/erp/app/routes/x+/accounting+/charts.$accountId.tsx` (action `:46`) and the new-account route (find it with `grep -rln "newChartOfAccount" apps/erp/app/routes`)

**Steps:**
1. Below the account fields, add **Allowability** (a `Select` of the four values) and **Element of cost** (a `Select`, optional).
2. Show **Unallowable reason** (`Input`) only when the allowability is not Allowable. Its placeholder is "31.205-14 Entertainment".
3. Hide all three for a group account (`isGroup`).
4. Check that both actions pass the new fields to `upsertAccount`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exit code 0
```

**Out of scope:** a column in the chart of accounts table.

---

## Task 19: Add the cost objective, restrict charging and members to the project

**Depends on:** 14, 15
**Files:**
- Modify: `apps/erp/app/modules/projects/ui/Projects/ProjectForm.tsx`
- Modify: `apps/erp/app/routes/x+/project+/$projectId.settings.tsx`
- Create: `apps/erp/app/modules/projects/ui/Project/ProjectMembers.tsx`
- Copy from (precedent): `apps/erp/app/modules/projects/ui/Project/ProjectLabels.tsx` (list with add and delete); `apps/erp/app/components/Form/Employee.tsx` (the user picker)

**Steps:**
1. `ProjectForm` gains **Cost objective** (a `Select`) and **Restrict charging to members** (a switch).
   - A new Contract-treatment project defaults to Direct.
   - An Expense project offers only IR&D, B&P and Indirect.
   - In DCAA mode, the field is required. The route action reads `timekeepingControls` and returns a field error when it is empty.
2. `ProjectMembers` lists the members with name and a remove button, and an **Add member** employee picker.
3. The settings route action gains the intents `addMember` and `removeMember`. Both require `update: "projects"`.
4. Show the members card only when `restrictCharging` is true.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exit code 0
```

**Out of scope:** member roles.

---

## Task 20: Add the element flags

**Depends on:** 14, 15
**Files:**
- Modify: `apps/erp/app/modules/projects/ui/Element/ElementSidebar.tsx`
- Copy from (precedent): the existing `isChargeable` field in `ElementSidebar.tsx`

**Steps:**
1. Add three switches below **Chargeable**: **Unallowable**, **Preproduction** and **Leave**. Each posts through the existing field update route.
2. Show **Leave** only when the project's cost objective is Indirect.
3. On the List layout, show a small "Unallowable" badge after the name of a flagged element.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exit code 0
```

**Out of scope:** the 5c and 5d element fields.

---

## Task 21: Add the FLSA status to the employee job

**Depends on:** 14, 15
**Files:**
- Modify: `apps/erp/app/modules/people/ui/Person/PersonJob.tsx`
- Modify: `apps/erp/app/routes/x+/person+/$personId.job.tsx`

**Steps:**
1. Add **FLSA status** (a `Select`: Exempt, Non-Exempt) after **Manager**.
2. Check that the route action passes `flsaStatus` to `updateEmployeeJob`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exit code 0
```

**Out of scope:** salary data. Carbon costs labor by category (spec decision 6).

---

## Task 22: Build the DCAA controls on My Timesheet

**Depends on:** 16, 17
**Files:**
- Modify: `apps/erp/app/routes/x+/timesheet.tsx`
- Modify: `apps/erp/app/modules/projects/ui/Timesheet/TimesheetGrid.tsx`
- Create: `apps/erp/app/modules/projects/ui/Timesheet/TimesheetChangeModal.tsx`
- Create: `apps/erp/app/modules/projects/ui/Timesheet/CertificationModal.tsx`
- Create: `apps/erp/app/modules/projects/ui/Timesheet/TimesheetReviewBanner.tsx`
- Create: `apps/erp/app/modules/projects/ui/Timesheet/TimesheetRevisionsPopover.tsx`
- Create: `apps/erp/app/routes/x+/timesheet.revisions.$entryId.tsx` (loader only)
- Create: `apps/erp/app/routes/x+/timesheet.review.tsx` (action only)
- Copy from (precedent):
  - `apps/erp/app/modules/sales/ui/Contracts/ContractCancelModal.tsx` (a modal with a reason)
  - `apps/erp/app/modules/sales/ui/Contracts/ContractConfirmModal.tsx` (a confirm modal)
  - `apps/erp/app/modules/sales/ui/Contracts/ContractAmendModal.tsx` (`Alert`)
  - `apps/erp/app/modules/accounting/ui/Periods/PeriodCloseUnpostedDocumentsPopover.tsx` (a popover list)

**Steps:**
1. The loader adds `timekeepingControls`, `timesheetEntryWindowDays`, today in the company time zone, the employee's FLSA status, the certification text, and `getPendingReviewEntries`.
2. In Standard mode, the page stays as it is. The steps below apply only in DCAA mode.
3. **Future days:** cells after today are read-only, except on rows whose element is a leave element.
4. **Change modal:** `TimesheetChangeModal` opens instead of a direct save in two cases:
   - a cell that already has an entry changes: the modal asks for **Reason for change**;
   - a new value on a late date: the modal asks for **Reason for late entry**.

   The modal posts to `timesheet.update.tsx` with the value and the reason.
5. **Submit:** **Submit week** opens `CertificationModal`. It shows the text, a checkbox "I certify this statement", and **Certify and submit**. It posts the text it showed to `timesheet.submit.tsx`.
6. **Review banner:** `TimesheetReviewBanner` shows above the grid when entries wait for review. It lists each change (date, charge number, before → after, who, reason). **Accept** posts to `timesheet.review.tsx`, which calls `acceptTimesheetReview`.
7. **Revision history:** a cell with revisions shows a small history icon. It opens `TimesheetRevisionsPopover`, which fetches `timesheet.revisions.$entryId.tsx`. That loader returns `getTimesheetRevisions` for an entry the user owns, or any entry when the user has `view: "projects"`.
8. A Pending Employee Review cell shows an amber status dot.
9. Every refusal shows the server's message in a toast.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exit code 0
```

**Out of scope:** the same controls in the MES grid. The MES gets the server refusals, shown as toasts.

---

## Task 23: Add the employee timesheet page for managers

**Depends on:** 22
**Files:**
- Create: `apps/erp/app/routes/x+/projects+/timesheets.$employeeId.tsx`
- Modify: `apps/erp/app/modules/projects/ui/Timesheet/TimesheetApprovals.tsx` — an **Open timesheet** link per employee
- Modify: `apps/erp/app/utils/path.ts` — `employeeTimesheet(employeeId)`

**Steps:**
1. The loader runs `requirePermissions(request, { view: "projects" })`. It allows the page when either:
   - the user is the employee's manager (`employeeJob.managerId`); or
   - the user has `update: "projects"`.

   Else it redirects with an error flash.
2. The page reuses `TimesheetGrid` for the employee's week, with the same `?week=` navigation.
3. Every cell change opens `TimesheetChangeModal` and needs a reason. The action calls `saveTimesheetEntry` with the employee's id. The server function sets Pending Employee Review.
4. A new entry on a day with no recorded absence shows the server's refusal. The page shows the absence days with a badge, from `peopleAbsence`.
5. The page has no **Submit week**. Only the employee certifies.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exit code 0
```

**Out of scope:** bulk entry for many employees.

---

## Task 24: Add labor transfers to the correction modal and approvals

**Depends on:** 13, 16
**Files:**
- Modify: `apps/erp/app/routes/x+/timesheet.correct.tsx`
- Modify: the correction modal in `apps/erp/app/modules/projects/ui/Timesheet/` (Phase 1a Task 39)
- Modify: `apps/erp/app/routes/x+/projects+/approvals.tsx`
- Modify: `apps/erp/app/modules/projects/ui/Timesheet/TimesheetApprovals.tsx`

**Steps:**
1. The correction modal gains **Move to another charge number**. It shows `ChargeNumber` and a labor category select, defaulted to the original's values.
2. `timesheet.correct.tsx` calls `createTimesheetCorrection`. In DCAA mode, when `isTransfer` is true, it never posts the entries, even with approval off. The flash says "The transfer waits for approval".
3. `TimesheetApprovals` marks a transfer with a **Transfer** badge. It shows from → to and the reason.
4. The approve action calls `assertCanApprove` for each entry before it changes a status. It flashes the refusal.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exit code 0
```

**Out of scope:** transfers of non-labor cost.

---

## Task 25: Add allowable, unallowable and preproduction cost to the Costs tab

**Depends on:** 5, 9
**Files:**
- Modify: `apps/erp/app/modules/projects/projects.models.ts` — `rollUpCostSummary`
- Modify: `apps/erp/app/modules/projects/ui/Costs/ProjectCostsTree.tsx`
- Modify: `apps/erp/app/modules/projects/ui/Costs/ProjectLedgerTable.tsx`
- Modify: `apps/erp/test/projects-timesheet-week.test.ts`

**Steps:**
1. `rollUpCostSummary` also sums `actualUnallowable`.
2. `ProjectCostsTree` replaces **Actual** with two columns, **Allowable** (actual − unallowable) and **Unallowable**.
3. A preproduction element shows a "Preproduction" badge. The total row gains a **Preproduction** line: the actual cost of every preproduction element's subtree, counted once.
4. `ProjectLedgerTable` gains an **Unallowable** column (a check icon) and a filter on it.
5. Add one test: a parent with an unallowable child row of 100.00 shows `actualUnallowable` 100.00.

**Verify:**
```bash
pnpm --filter erp test -- projects-timesheet-week && pnpm exec turbo run typecheck --filter=erp
# Expected: all tests pass; typecheck exits 0
```

**Out of scope:** burden columns (5b).

---

## Task 26: Add CLIN numbers and funding actions to the contract line

**Depends on:** 8, 15
**Files:**
- Modify: `apps/erp/app/modules/sales/ui/Contracts/ContractLineForm.tsx`
- Create: `apps/erp/app/modules/sales/ui/Contracts/ContractFundingActions.tsx`
- Modify: `apps/erp/app/modules/sales/ui/Contracts/ContractLineBilling.tsx` and its route `apps/erp/app/routes/x+/contract+/$id.$lineId.billing.tsx` (billing Phase 4a Task 16)
- Modify: the **Edit funding** modal of billing Phase 4a (it posts to `$id.$lineId.funding.tsx`)
- Create: `apps/erp/app/routes/x+/contract+/$id.$lineId.funding-actions.tsx` (action only)
- Modify: every path that copies a contract line (`create-contract-invoices/index.ts:324`, `post-customer-contract/index.ts:1373`, `post-customer-contract/schedule-writes.ts:99` and `:445`)
- Copy from (precedent): `apps/erp/app/modules/sales/ui/Contracts/ContractProductsGrid.tsx` (editable `Table`)

**Steps:**
1. `ContractLineForm` gains **CLIN / SLIN** (`Input`) and **Parent CLIN** (a `Select` of the contract's CLIN lines). Show the parent only when the number has 6 characters.
2. In DCAA mode, the **Edit funding** modal shows `fundedCost` and `fundedAmount` read-only, with the hint "Sum of the funding actions".
3. `ContractFundingActions` lists the funding rows: modification, date, ACRN, funded cost, funded fee, expiry. A total row shows the sums. **Add funding** adds a row.
4. `ContractLineBilling` shows `ContractFundingActions` below the `FundingBar`, in DCAA mode or when the line has funding rows.
5. The `funding-actions` route switches on `intent` (`upsert`, `delete`). It requires `update: "sales"` and calls `upsertContractFunding` or `deleteContractFunding`. The route accepts funding changes on an Active contract, because a funding modification is not a term change.
6. In each copy path, copy `lineItemNumber` and `parentLineId` to the new line.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp --filter=@carbon/server-functions
# Expected: exit code 0
```

**Out of scope:** importing funding from a contract modification document.

---

## Task 27: Invoice by CLIN with ACRN allocation

**Depends on:** 8, 26
**Files:**
- Modify: `packages/server-functions/src/create-project-billing-invoices/index.ts` (billing Phase 4a Task 10, step 6)
- Create: `packages/server-functions/src/create-project-billing-invoices/clin.ts`
- Create: `packages/server-functions/src/create-project-billing-invoices/clin.test.ts`

**Steps:**
1. Add the pure `planClinSections(lines, contractLines, acrnsByLine)` in `clin.ts`. Its input is the lines that `planProjectInvoiceLines` returns, with their contract line:
   1. Group the planned invoice lines by `customerContractLineId`.
   2. Order the groups by `lineItemNumber`. Lines with no number come last, in their current order.
   3. Before each numbered group, add a `Comment` line: "CLIN 0001AA — <description>: <amount>".
   4. Allocate each group's amount with `allocateToAcrns`. Add the split to the comment, for example "ACRN AA 10,000.00; ACRN AB 2,345.00".
   5. Return the lines and the allocation rows.
2. In `index.ts`, call `planClinSections` after `planProjectInvoiceLines` and before `insertDraftContractInvoice`. Before it, load the funding rows of the invoiced lines. Also load the allocations on invoices that are not Voided. Use one query each.
3. Insert the `salesInvoiceFundingAllocation` rows in the invoice's transaction.
4. With no `lineItemNumber` on any line, the invoice stays exactly as today.
5. Write `clin.test.ts`:
   1. Two CLINs give two comment lines in number order, each before its lines.
   2. CLIN 0001 with 12,345.00 over ACRN AA (10,000.00) and AB gives AA 10,000.00 and AB 2,345.00.
   3. Lines with no number give no comment line.

**Verify:**
```bash
pnpm --filter @carbon/server-functions test -- create-project-billing-invoices
# Expected: all tests pass
```

**Out of scope:** WAWF or iRAPT file formats.

---

## Task 28: Add the payroll totals import and list

**Depends on:** 6
**Files:**
- Modify: `apps/erp/app/modules/shared/imports.models.ts` — `fieldMappings`, `importPermissions` and `importSchemas` for `payrollPeriodTotal`
- Create: `packages/server-functions/src/import-csv/payroll-total-import.ts`
- Create: `packages/server-functions/src/import-csv/payroll-total-import.test.ts`
- Modify: `packages/server-functions/src/import-csv/index.ts` — the `table` enum (`:25`) and a dispatch case
- Create: `apps/erp/app/routes/x+/people+/payroll-totals.tsx`
- Create: `apps/erp/app/modules/people/ui/PayrollTotals/PayrollTotalsTable.tsx`
- Modify: `apps/erp/app/modules/people/ui/usePeopleSubmodules.tsx`, `apps/erp/app/modules/people/people.service.ts`, `apps/erp/app/utils/path.ts`
- Copy from (precedent): the `department` mapping (`imports.models.ts:1802`, `:2064`, `:2891`); `stock-quantity-import.ts` (a dispatch case in its own file); `apps/erp/app/routes/x+/people+/timecard.tsx` (list)

**Steps:**
1. Map these fields:
   - `employeeId`: an enum with a fetcher of the company's employees (value: id, label: name). The wizard maps each CSV value to an employee.
   - `periodStart` and `periodEnd`: strings, validated as `YYYY-MM-DD`.
   - `grossWages` and `hoursPaid`: numbers ≥ 0.
2. `importPermissions.payrollPeriodTotal` is `"people"`. Declare every field in both `fieldMappings` and `importSchemas` (the rule's invariant).
3. `importPayrollTotals(db, args)` writes one `INSERT … ON CONFLICT ("employeeId", "periodStart", "periodEnd", "companyId") DO UPDATE` per 500 rows. Set `importedBy` on insert and `updatedBy` on update.
4. A row with an unknown employee or `periodEnd < periodStart` becomes a row error. It does not stop the file.
5. Add `getPayrollPeriodTotals(client, companyId, args)` to `people.service.ts`.
6. The list page requires `view: "people"`. It shows employee, period, gross wages, hours paid and the import date. It passes `importCSV={[{ table: "payrollPeriodTotal", label: "Payroll totals" }]}` to `<Table>`.
7. Add **Payroll totals** to the people submodules, after Timecards.
8. Write `payroll-total-import.test.ts`. A re-import of the same period updates the row and does not add a second.

**Verify:**
```bash
pnpm --filter @carbon/server-functions test -- payroll-total-import && pnpm --filter erp test -- imports.models
# Expected: all tests pass
pnpm exec turbo run typecheck --filter=erp --filter=@carbon/server-functions
# Expected: exit code 0
```

**Out of scope:** a payroll provider connector (spec Q2).

---

## Task 29: Add the daily missing-time check

**Depends on:** 5
**Files:**
- Create: `packages/database/supabase/migrations/<timestamp>_timesheet-missing-time-sweep.sql`
- Create: `packages/database/supabase/tests/timesheet-missing-time.test.sql`
- Create: `packages/jobs/src/inngest/functions/scheduled/timesheet-missing-time.ts`
- Modify: `packages/jobs/src/inngest/functions/scheduled/index.ts`, `packages/jobs/src/inngest/index.ts`
- Modify: `packages/notifications/src/index.ts`, `packages/jobs/src/inngest/functions/notifications/content.ts`
- Modify: `apps/erp/app/components/Layout/Topbar/Notifications.tsx` (`:352`), `apps/erp/app/routes/api+/link.ts` (`:98`)
- Copy from (precedent):
  - `20261004183512_scheduled-jobs-from-database.sql:117-190` (`*_has_work`, `sweep_*`, the cron loop)
  - `packages/jobs/src/inngest/functions/scheduled/workflow-run-retention.ts` (an event-woken function)
  - `NotificationEvent.RecurringInvoicing` in every file above (a payload-carried notice)

**Steps:**
1. Run `pnpm db:migrate:new timesheet-missing-time-sweep`. Write:
   - `util.timesheet_missing_time_has_work()`: `EXISTS` a `companySettings` row with `timekeepingControls = 'DCAA'`;
   - `util.sweep_timesheet_missing_time()`: when it has work, send `carbon/timesheet-missing-time.process`;
   - the `REVOKE ALL … FROM PUBLIC` lines for both;
   - the pg_cron job `timesheet-missing-time-sweeper` at `0 12 * * *`, scheduled with the unschedule-then-schedule loop.
2. Add `NotificationEvent.TimesheetMissing = "timesheet-missing"`. Map it to topic `General`. Give it a heading, a CTA label ("Open timesheet"), a content case (`opts.body`) and a link to `path.to.timesheet`.
3. The Inngest function `timesheetMissingTimeFunction` (event `carbon/timesheet-missing-time.process`):
   1. Find the DCAA companies with one Kysely query.
   2. For each company, take yesterday in the company time zone.
   3. Call `get_missing_timesheet_days(companyId, yesterday, yesterday)`.
   4. Build one `carbon/notify` event per employee: "No time entered for <date>". Build one more per manager, listing their employees.
   5. Send them all with one `step.sendEvent`.
4. Register the function in both index files.
5. Write `timesheet-missing-time.test.sql` in a rolled-back transaction:
   1. An employee with a Monday shift and no entry on a Monday is listed.
   2. A holiday, an absence or an entry on that day removes them.
   3. `util.timesheet_missing_time_has_work()` is false with no DCAA company and true with one.
6. Run `pnpm db:migrate`.

**Verify:**
```bash
pnpm exec tsx scripts/run-local-accounting-check.ts psql -X -v ON_ERROR_STOP=1 -f packages/database/supabase/tests/timesheet-missing-time.test.sql
# Expected: no ERROR line
pnpm --filter @carbon/notifications test && pnpm exec turbo run typecheck --filter=@carbon/jobs --filter=erp
# Expected: all tests pass; typecheck exits 0
```

**Out of scope:** reminders at a time the employee chooses.

---

## Task 30: Add the Timesheets complete close task

**Depends on:** 5, 29
**Files:**
- Create: `packages/database/supabase/migrations/<timestamp>_timesheets-complete-close-task.sql`
- Modify: `packages/database/src/seed-data.ts` — `periodCloseTaskDefinitions` (`:2277`)
- Modify: `apps/erp/app/modules/accounting/accounting.service.ts` — `computePeriodReadiness` (`:3304`)
- Copy from (precedent): `20261006220201_revenue-recognition-core.sql:143-152`

**Steps:**
1. 🛑 An Auto task with no evaluator fails closed and blocks every close (`accounting.service.ts:3576-3582`). Ship the row and its evaluator in this one task.
2. Run `pnpm db:migrate:new timesheets-complete-close-task`. Insert the definition for every company: name "Timesheets complete", type `Auto`, key `timesheets-complete`, sort order 9, required, severity `Warning`. Use the `WHERE NOT EXISTS` guard of the precedent.
3. Add the same entry to `periodCloseTaskDefinitions` in `seed-data.ts`.
4. Add the check to `computePeriodReadiness`. In Standard mode, it always passes. In DCAA mode, it fails when either:
   - an entry dated in the period is Draft, Submitted, Approved, Rejected or Pending Employee Review; or
   - `get_missing_timesheet_days` returns a day in the period.

   `count` is the number of such entries plus missing days.
5. Run `pnpm db:migrate`.

**Verify:**
```bash
pnpm db:migrate && psql "$SUPABASE_DB_URL" -c "SELECT count(*) FROM \"company\" c WHERE NOT EXISTS (SELECT 1 FROM \"periodCloseTaskDefinition\" d WHERE d.\"companyId\" = c.id AND d.\"autoCheckKey\" = 'timesheets-complete');"
# Expected: the migration succeeds, and the count is 0
pnpm exec turbo run typecheck --filter=erp
# Expected: exit code 0
```

**Out of scope:** the 5b "Burden computed" and 5c "Earned value closed" tasks.

---

## Task 31: Add the report queries and the CSV route

**Depends on:** 13, 15, 28
**Files:**
- Modify: `apps/erp/app/modules/projects/projects.service.ts` — the report queries
- Modify: `apps/erp/app/modules/projects/projects.models.ts` — `buildLaborDistribution`
- Create: `apps/erp/app/routes/api+/projects.reports.$reportKey[.]csv.ts`
- Create: `apps/erp/test/projects-labor-distribution.test.ts`
- Copy from (precedent): `apps/erp/app/routes/api+/integrations.$id.sync-activity[.]csv.ts` (`encodeCsv`, `CSV_CONTENT_TYPE`, streamed pages)

**Steps:**
1. Add these queries to `projects.service.ts`. Each takes `db: Kysely<KyselyDatabase>` from the route and `{ companyId, from, to }`:
   - `getLateTimesheetEntries`: entries with `lateReason`, with employee, entry date, created date, hours, charge number and the reason.
   - `getMissingTimesheetDays`: the rows of `get_missing_timesheet_days` with employee and manager names.
   - `getLaborTransfers`: replacement entries with `correctionOfId`, where the project or element differs from the original. Return the date, employee, entry date, hours, from, to, reason, requester, approver, approval date, and days after the entry date.
   - `getTimesheetAuditRows`: every entry of the range and every revision of those entries, as one list ordered by employee and time.
   - `getLaborDistributionRows`: one SQL `GROUP BY` of `projectLedger` Labor rows by employee, project, element and accounting period. Return hours, dollars, unallowable dollars and the project's `costObjective`. Also return the timecard hours and the payroll totals per employee and period, with `periodEnd` in the period.
   - `getCostByClin`: per contract line with a `lineItemNumber`, the billing element subtree's allowable and unallowable cost. Also return funded cost, funded amount and billed amount.
2. Add the pure `buildLaborDistribution(rows)` in `projects.models.ts`. It puts dollars in one of 4 columns:
   - **Direct**: Direct and Commercial projects;
   - **Indirect**: Indirect, IR&D and B&P projects;
   - **Unclassified**: no cost objective;
   - **Unallowable**: the unallowable dollars of any project.

   Per employee and period, it adds the hours difference to timecards and the dollars difference to gross wages. With no payroll row, it says "No payroll imported".
3. The resource route switches on `reportKey`. It reads `from` and `to`, or `periodId` for `labor-distribution`. It streams the CSV with `encodeCsv`. The permissions:
   - `late-entries`, `missing-time`, `labor-transfers`, `timesheet-audit`: `view: "projects"`;
   - `labor-distribution`: `view: "projects"` and `view: "people"`;
   - `cost-by-clin`: `view: "sales"`.

   An unknown key returns 404.
4. The `timesheet-audit` file name carries the range, for example `timesheet-audit-2026-10-01-2026-10-31.csv`.
5. Write `projects-labor-distribution.test.ts`:
   1. Labor on a Direct, an IR&D and an unclassified project fills the three columns.
   2. An unallowable row adds to the Unallowable column.
   3. Payroll of 4,000.00 against 3,900.00 of labor shows a difference of −100.00.
   4. No payroll row shows "No payroll imported".

**Verify:**
```bash
pnpm --filter erp test -- projects-labor-distribution && pnpm exec turbo run typecheck --filter=erp
# Expected: 4 passed; typecheck exits 0
```

**Out of scope:** the 5b Statement of Indirect Expenses and the ICE schedules.

---

## Task 32: Add the Reports page

**Depends on:** 31
**Files:**
- Create: `apps/erp/app/routes/x+/projects+/reports.tsx`
- Modify: `apps/erp/app/modules/projects/ui/useProjectsSubmodules.tsx` — a **Reports** entry
- Modify: `apps/erp/app/utils/path.ts` — `projectReports`, `api.projectReport(reportKey)`
- Copy from (precedent): `apps/erp/app/routes/x+/reports+/_index.tsx` (report cards)

**Steps:**
1. Show one card per report:
   - Late entries, Missing time and Labor distribution;
   - Labor transfers, Timesheet export for auditors and Cost by CLIN.
2. Each card has a short description, a date range (an accounting period for labor distribution) and **Download CSV**. The button links to the resource route.
3. Hide a card when the user lacks its permission (Task 31, step 3).

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exit code 0
```

**Out of scope:** charts.

---

## Task 33: Keep the demo datasets green

**Depends on:** 6
**Files:**
- Modify: `packages/database/src/datasets/validate.ts` (`COVERAGE` `:178`), only if the check fails

**Steps:**
1. Run `pnpm db:check:datasets`.
2. A `COVERAGE` set built from `timesheetEntryStatus` can now miss `Pending Employee Review`. If so, add the value to that set's `except` list. Use the reason "DCAA mode only; the datasets run in Standard mode".
3. If another failure names a 5a enum or table, STOP and report.

**Verify:**
```bash
pnpm db:check:datasets
# Expected: all four datasets pass
```

**Out of scope:** seeding DCAA data.

---

## Task 34: Update the rules, AGENTS.md, docs and spec

**Depends on:** 1–33
**Files:**
- Create: `.claude/rules/government-contracting.md` (with `paths:` for `packages/utils/src/timekeeping.ts`, `packages/utils/src/contract-funding.ts`, `packages/server-functions/src/save-timesheet-entry/**`, `packages/server-functions/src/submit-timesheet-week/**` and `apps/erp/app/modules/projects/ui/Timesheet/**`)
- Modify: `.claude/rules/projects-system.md`, `.claude/rules/event-system.md` (the new sweep), `.claude/rules/csv-import-system.md` (the new table)
- Modify: `packages/jobs/AGENTS.md`, `packages/server-functions/AGENTS.md`, `apps/erp/app/modules/projects/AGENTS.md`
- Modify: `AGENTS.md` — a Task Router row: Government contracting (DCAA timekeeping, CLIN funding) → `.claude/rules/government-contracting.md`
- Create: `docs/content/docs/reference/government-contracting.mdx`
- Modify: `.ai/specs/2026-10-09-government-contracting.md`

**Steps:**
1. Document only committed code. Ground every claim in a file.
2. Run `pnpm run generate:mcp`. Commit the digest change for the new service functions.
3. In the spec, record decisions P1–P10 from this plan in *Design Decisions*. Add a changelog line.
4. Mark Phase 5a done in the spec's *Delivery phases*.
5. Run the STE-80 review pass on every `.ai/` file you changed.

**Verify:**
```bash
pnpm --filter docs typecheck
# Expected: exit code 0
pnpm --filter @carbon/checks license-headers
# Expected: no files changed
```

**Out of scope:** the changelog entry.

---

## Task 35: Verify in the browser

**Depends on:** 1–34
**Files:**
- Create: `.ai/playbooks/government-contracting-phase-5a.md` (written by `/test`)

**Steps:**
1. Run `/test` on a satellite dataset company with accounting on. Turn on DCAA mode in Settings → Timekeeping, with a window of 1 day and the timecard check on Block.
2. Cover the spec's Phase 5a acceptance criteria:
   1. **Unallowable:** set an account to Expressly Unallowable and charge to it. The ledger row is unallowable, no billable item exists, and the Costs tab shows it under Unallowable.
   2. **Daily entry:** an entry dated 3 days ago asks for a late reason and shows on the late-entry report. An entry for tomorrow is refused.
   3. **Certification:** an exempt employee sees the exempt text on submit. The certification row stores who, when and the text hash.
   4. **Correction trail:** change a saved entry from 6 h to 4 h with a reason. The revision popover shows before, after, who, when and why.
   5. **Edit by a manager:** a manager changes the employee's entry on the employee timesheet page. It shows Pending Employee Review and does not post until the employee accepts it.
   6. **Total time:** a week of 38 h of entries against 40 h of timecards cannot be submitted.
   7. **Dilution:** an exempt employee records 50 h at 60.00. The week posts 2,400.00, at 48.00 an hour.
   8. **Labor distribution:** the period's CSV shows hours and dollars by employee and charge number, and the difference to the imported payroll totals.
   9. **Funding by ACRN:** funding actions of 50,000.00 and 30,000.00 make the line's funded cost 80,000.00. A Cost Plus invoice shows a separate amount per CLIN.
   10. **Labor transfer:** a moved entry needs a second approver. It shows on the labor transfers report.
   11. **Standard mode:** turn DCAA off. My Timesheet behaves as before, with no reason modal and no certification.
3. Save the playbook to `.ai/playbooks/government-contracting-phase-5a.md`.

**Verify:**
```bash
ls .ai/playbooks/government-contracting-phase-5a.md
# Expected: the file exists, and the /test run reports every step passed
```

**Out of scope:** Phases 5b, 5c and 5d.

## Execution notes

- Task 1: every prerequisite exists. The live schema also has `projectLedger.unallowable`, `customerContractLine.fundedCost`, `fundedAmount`, `projectElementId`, `billingMethod` and `amendsLineId`, the `projectBillableItem` table, and `insertProjectLedgerRows` in `project-posting.ts`. `project.costTreatment` is the real column name. `employeeJob.id` is the employee's user id, and `employeeJob.managerId` exists. Task 1 changes no code, so it has no commit.
- Task 3: the columns migration also indexes the two new self FKs, `timesheetEntry ("correctionOfId", "companyId")` and `customerContractLine ("parentLineId", "companyId")` (step 3). Tasks 2 and 3 ran together in a `BEGIN … ROLLBACK` dry run against the local database before the commit.
- Task 4: `projectMember` and `salesInvoiceFundingAllocation` also get `updatedBy` and `updatedAt`. The migration rules require `updatedBy` on every table with `createdBy`, because the shared audit-injection path stamps it on each write. `timesheetEntryRevision` and `timesheetCertification` get no separate `companyId` index: their composite indexes start with `companyId`. Each table has an index on every FK column, except `updatedBy` (the table template indexes `createdBy` only).
- Task 5: the fork base is `20261010161720_project-commitments-pegs.sql`. A diff of the new body against it shows only the 4 intended hunks. The migration ends with `NOTIFY pgrst, 'reload schema'`, as its fork base does. `pnpm --filter @carbon/checks clobbers` reports no finding for `get_project_cost_summary`. It exits 1 on 2 earlier findings that this plan does not touch: `complete_job_to_inventory` and `backflush_job_materials` (`20261009071629` on this branch against `20261009010412` on main).
- Task 6, manifest:
  1. `projectMember` uses `projectTable()`, not `company("projects")`. Every project table uses `projectTable`, so the members of a Service project follow the Service module (`authz-manifest.md`).
  2. `customerContractFunding` reads with `sales_view`, and `salesInvoiceFundingAllocation` reads with `invoicing_view`. Every other contract table and invoice table reads that way, so a funding row is not visible to an employee who cannot see its line or its invoice.
  3. The entries were added before the first `pnpm db:migrate`, because `authz sync` fails on a public table with no rule. The generated migration is `20261011151539_government-contracting-rls.sql`.
- Task 6, compile fallout of the new types (the Phase 4a precedent `013bdfa4a3` did the same in its types task):
  1. `copyLineValues` (`post-customer-contract/schedule-writes.ts`) carries `lineItemNumber` and `parentLineId` to a line copy, and an added line sets both to null. An amendment of a Fixed line therefore keeps its CLIN number, as Task 3 step 4 expects.
  2. `Pending Employee Review` joins `TIMESHEET_ENTRY_STATUS_COLOR_MAP` (orange), `timesheetEntryStatuses` and the labels of `TimesheetEntryStatus.tsx`. The MES timesheet indexes the color map by status.
  3. The `balance-sheet.test.ts` account fixture gains the 3 new account columns.
- Task 6: `pnpm --filter @carbon/database authz check` reports no drift, the authz tests pass (35), and `erp`, `mes`, `@carbon/utils`, `@carbon/ee`, `@carbon/server-functions`, `@carbon/database` and `@carbon/jobs` typecheck. The workflow catalog is current. The new UI string has an empty `msgstr` in the other locales; the branch-wide `/translate` run fills it.
- Task 7: `nextEntryStatus` in Standard mode also lets the owner change a Rejected entry, which becomes Draft. Phase 1a `upsertTimesheetCell` edits a Draft or a Rejected entry, and the rule for the executor says Standard mode keeps Phase 1a behavior. The two types derive from the generated enums (`timekeepingControls`, `timesheetEntryStatus`) in place of hand-written unions, as `project-billing.ts` does. The refusal texts are exported constants (`TIMESHEET_REFUSAL_NOT_DRAFT`, `TIMESHEET_REFUSAL_POSTED`). `weekStartOf` uses `startOfWeek(…, "en-GB")`, as the ERP's week helper in `projects.models.ts` does.
- Task 8: `allocateToAcrns` leaves an ACRN that takes nothing out of `allocations`, and a credit's `unallocated` is negative. A credit breaks a tie on the first funding date by the reverse ACRN order. The plan does not say either point.
- Task 9:
  1. Most callers do not hold the posting context, so the flag travels on the charge objects that carry the account: `JobProjectCharge`, `ProjectLineCharge`, `InvoiceProjectCharge` (and `stockChargedAtReceipt`), `ReceiptProjectRoute` and `TimesheetLedgerRow` each gain `unallowable`.
  2. A reversal copies its original's flag: `reverseProjectLedgerRows`, the production event's own reversal rows and the coverage reclass reversal.
  3. A capital job's rows take the flag of the asset account that `resolveProjectPostingAccount` returns, because the cost ends on the asset. Its GL debit stays on WIP.
  4. The coverage reclass replacement uses the new coverage account only with accounting on. With accounting off it resolves no account, so only the element flag counts. This keeps the Phase 3 behavior: no new refusal for a missing default.
  5. A `Payback Variance` row sets `unallowable: false`. It sits on the project root and posts to the inventory variance account, and the stock transfer loads no posting context.
  6. `loadProjectPostingContexts` also reads the allowability of the asset class accounts. `isUnallowableCharge` falls back to the parent context's map, for a Service project's Contract charge.
  7. Billable items: `buildContractBillableItem` and the Cost Plus generator already skip an unallowable row. The field service `buildBillableItem` is unchanged.
- Task 10:
  1. Standard mode keeps the Phase 1a refusal texts ("This time is posted. Use a correction to change posted hours." and "This time is submitted. It can change only after it is rejected."), not the `nextEntryStatus` text. Step 3 asks for the Phase 1a behavior exactly. Standard mode refuses a save by anyone but the owner with `TIMESHEET_REFUSAL_NOT_DRAFT`; every Phase 1a caller saves for the signed-in user.
  2. The cell edits a Draft first, then a Rejected, Pending Employee Review, Submitted or Approved entry. It takes a Posted entry only when no other entry exists, so `nextEntryStatus` can refuse it. Step 2.3 says to ignore Posted entries, but then a new entry would sit beside a posted one, which Phase 1a refuses.
  3. A refusal throws a `ServerFnError` with status 422, so the caller gets `{ error }` with its message. This is the idiom of `defineServerFn`.
  4. An owner's or a manager's change also clears `submittedAt`, `approvedBy`, `approvedAt` and `rejectionNote`, because the entry needs approval again.
  5. The refusal texts are exported constants. A supervisor entry on a day with no absence reads "You can enter time for another employee only on a day of recorded absence". A change with no reason reads "Give a reason for the change".
  6. The test creates a second user (the manager) with `session_replication_role = replica`, and deletes it the same way.
- Task 11:
  1. Both modes submit the Draft entries of Standard projects only, as Phase 1a `submitTimesheetEntries` does. Service time posts from Draft.
  2. DCAA mode writes a certification row only when the week has a Draft entry to submit.
  3. If the certification text for the employee's FLSA status is not set, DCAA mode refuses with "Set the certification text in Settings → Timekeeping before you submit". The plan does not say what happens with no text.
  4. The timecard hours count the closed `timeCardEntry` rows whose `clockIn` falls in the week on the company's calendar. The entry hours are the sum of every entry of the week, reversals included, so a correction nets out.
  5. The shortfall message rounds both figures with `round()`. `timecardShortfallMessage` and `certificationTextHash` are exported for the routes and the test.
- Task 12:
  1. `post-timesheet` passes the employee to `assertChargeable` only in DCAA mode and only for a new entry. Charge restrictions are a DCAA control, so Standard mode keeps Phase 1a. A reversal undoes posted time, so membership never refuses it.
  2. The week's hours count the call's own entries as well as the Submitted, Approved and Posted entries. A Service entry posts from Draft, so a status filter alone would leave it out.
  3. `planDilution` returns the new entries' costs and the posted entries' adjustments and stamps. `planTimesheetPosting` takes the factors as `options.dilutionFactors` and stamps `dilutionFactor` only on a diluted entry. `planRedilutionPostings` builds the adjustment rows and journal lines through the shared `pushCost`, the same code a new entry uses.
  4. The adjustments are computed in the same transaction before any write, from the ledger sums of the week's other posted entries. The plan says "after the new entries post"; the result is the same, because the new rows belong to other entries.
  5. A re-diluted Service entry gets its order's Customer dimension: the service contexts load for its node too.
  6. `buildContractBillableItem` returns null for a Labor row with 0 hours. A dilution adjustment changes the cost, never the hours a Time & Materials line bills, so it must not add an empty billable item. The Cost Plus generator still bills the cost.
  7. The stamp UPDATE sets `dilutionFactor` with `COALESCE`, so Standard mode never writes the column.
  8. A second `databaseTest` covers DCAA end to end: 50 h post 3,400.00 at 68.00, then a reversal of 10 h re-dilutes the other 4 days by +170.00 each.
- Task 13:
  1. `assertCanApprove` throws `LABOR_TRANSFER_SAME_APPROVER`, as the other `assert*` helpers do. The plan says "refuses" and does not name the form.
  2. The transfer fields are empty strings from a form, so the service treats an empty value as "keep the original". If `projectId` is given, the element is `projectElementId` or null (the project root). Without `projectId`, the replacement keeps the original project and element.
  3. A replacement on another project drops `serviceVisitId`, `coverage` and `coverageReason`. They belong to the original project's service order. On the same project they still travel, as in Phase 1a.
  4. The revision's `before` and `after` also hold `projectId`. A transfer between two project roots changes only the project, so without it the revision shows no change of charge number.
  5. The composite foreign keys on `timesheetEntry` keep the new project and category in the company, and the element in the project. The service adds no separate check.
  6. The ERP has no database test harness, so the Standard-mode path of `createTimesheetCorrection` has no database test. In Standard mode the only change is `correctionOfId` on the replacement; the function writes no revision.
  7. `pnpm run generate:mcp` changes only the digest of `projects_createTimesheetCorrection` (3 new parameters).
- Task 14:
  1. `allowability` is optional, with no zod default. An account form or an MCP call without the field would otherwise reset an unallowable account to Allowable on update. A new account still gets Allowable, from the column default.
  2. `restrictCharging` is `zfd.checkbox().optional()`, the shape of the other project checkboxes (`projectStock`). A bare `zfd.checkbox()` made the field required in 3 callers that build the type (`ProjectsTable`, `projects+/new`, `$projectId.details`).
  3. The settings validator exports `timekeepingControlsModes` and `timesheetTimecardChecks`, and the sales validator exports `CONTRACT_LINE_ITEM_NUMBER_PATTERN`. The forms in Tasks 17 and 26 use them.
  4. `pnpm run generate:mcp` changes the digest of the 7 tools whose validators changed.
