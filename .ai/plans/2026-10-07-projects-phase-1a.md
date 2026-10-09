# Projects Phase 1a — implementation plan

**Spec:** .ai/specs/2026-10-03-projects.md (Phase 1a: *The project workspace*, *Charging: the five entry points*, *Cost treatment → posting account*, *Plan, budget, actuals*)
**Research:** .ai/research/projects-systems-engineering-ux.md, .ai/research/projects-wbs-pmmo.md
**Branch:** projects-wbs-research-spec

## Scope of this plan

Phase 1a delivers:
- the Projects module and its permissions;
- projects with typed elements, states, labels, milestones and plan lines;
- the List, Board and Table layouts and the element page;
- charge numbers on jobs, PO lines and purchase invoice lines;
- **Log time** and **Issue material** on the element page, the timesheet (ERP and MES) and approvals;
- the cost treatments Statistical, Expense and Contract;
- `projectLedger` and the Costs tab.

Phase 1b gets these items (the spec's *Delivery phases* records the move):
- the Capitalize treatment;
- trace links, verification and Parameters;
- the Tree, Timeline and Reader layouts;
- saved views and templates;
- Create Job and Create PO from a plan line.

Phase 1c gets baselines and change requests.

## Rules for the executor

- Read `.ai/lessons.md`, `.claude/rules/conventions-services.md`, `.claude/rules/conventions-forms.md`, `.claude/rules/database-patterns.md` and `.claude/rules/authz-manifest.md` before Task 1.
- Use the `carbon-design` skill for every UI task.
- Start every new source file with its SPDX header. Run `pnpm --filter @carbon/checks license-headers` after you create files.
- Never use JavaScript `Date`. Use `@internationalized/date` and the `datetime` helpers in `@carbon/utils`.
- Round money with `round()` from `@carbon/utils`. Never use `Math.round` or `toFixed`.
- Never query in a loop. Collect the ids and use one `.in()` call or one Kysely query.
- Never construct a database client in a `*.service.ts`. Pass `db` from the route.
- If a quoted code line or line number does not match the file, search for the quoted code. If you cannot find it, STOP and report. Do not improvise.

## Progress

- [x] Task 1: Create the enum migration
- [x] Task 2: Create the Projects module and permissions migration
- [x] Task 3: Create the workspace tables migration
- [x] Task 4: Create the time and ledger tables migration
- [x] Task 5: Create the backfill migration
- [x] Task 6: Create the SQL functions migration
- [x] Task 7: Apply migrations and regenerate types
- [x] Task 8: Add authz rules and ship the RLS migration
- [x] Task 9: Register backup id references and audit config
- [x] Task 10: Update seed data for new companies
- [x] Task 11: Add the projects module models
- [x] Task 12: Add the project and workspace service functions
- [x] Task 13: Add the element service functions
- [ ] Task 14: Add the time, labor category and ledger service functions
- [ ] Task 15: Add the pure project posting helpers and tests
- [ ] Task 16: Add the `post-timesheet` server function
- [ ] Task 17: Add the `post-project-issue` server function
- [ ] Task 18: Route job material issues to the project account
- [ ] Task 19: Route production events to the project account
- [ ] Task 20: Change job completion for consume-to-project jobs
- [ ] Task 21: Route PO receipts to the project account
- [ ] Task 22: Route purchase invoice lines to the project account
- [ ] Task 23: Route charges and reimbursements to the project account
- [ ] Task 24: Add Project and Project Element to the journal dimension builder
- [x] Task 25: Add the new enum values to the TS mirrors
- [ ] Task 26: Move the accounting Projects screens into the new module
- [ ] Task 27: Add module navigation, layout and paths
- [ ] Task 28: Build the project list and the new-project form
- [ ] Task 29: Build the project page shell and the Details tab
- [ ] Task 30: Build the project Settings tab (states and labels)
- [ ] Task 31: Build the `ChargeNumberSelect` picker and its API route
- [ ] Task 32: Build the Elements page with the List layout
- [ ] Task 33: Add the Board layout
- [ ] Task 34: Add the Table layout
- [ ] Task 35: Build the element page (peek and full page)
- [ ] Task 36: Add Log time and Issue material to the element page
- [ ] Task 37: Build the Milestones tab
- [ ] Task 38: Build the Costs tab and the Time & materials tab
- [ ] Task 39: Build My Timesheet and Approvals in the ERP
- [ ] Task 40: Build the MES timesheet
- [ ] Task 41: Add charge numbers to the job, PO line and purchase invoice line forms
- [ ] Task 42: Add the account defaults and project settings UI
- [ ] Task 43: Add keyboard shortcuts for the Elements page and element page
- [ ] Task 44: Register the MCP namespace and regenerate tools
- [ ] Task 45: Add projects to the demo datasets
- [ ] Task 46: Write the module AGENTS.md, the rule file and the docs page
- [ ] Task 47: Verify in the browser

## Dependencies

- Tasks 1 → 2 → 3 → 4 → 5 → 6 → 7 run in order. Task 7 regenerates types for all later tasks.
- Task 8 needs Task 7. Tasks 9 and 10 need Task 7 and are independent of each other.
- Task 11 needs Task 7. Tasks 12, 13 and 14 need Task 11 and are independent of each other.
- Task 15 needs Task 7. Tasks 16 and 17 need Task 15 and are independent of each other.
- Tasks 18–23 need Task 15 and Task 24. They are independent of each other.
- Task 24 needs Task 7. Task 25 needs Task 7.
- Task 26 needs Tasks 12 and 27. Task 27 needs Task 8.
- Tasks 28–30 need Tasks 12 and 27. Task 31 needs Task 13.
- Task 32 needs Tasks 13 and 29. Tasks 33 and 34 need Task 32 and are independent of each other.
- Task 35 needs Task 32. Task 36 needs Tasks 16, 17 and 35. Task 37 needs Task 29.
- Task 38 needs Tasks 6 and 29. Task 39 needs Tasks 14 and 16. Task 40 needs Task 39.
- Task 41 needs Task 31. Task 42 needs Task 7. Task 43 needs Tasks 32 and 35.
- Task 44 needs Tasks 12–14. Task 45 needs Task 7. Task 46 needs Tasks 1–45.
- Task 47 runs last.

---

## Task 1: Create the enum migration

**Depends on:** none
**Files:**
- Create: `packages/database/supabase/migrations/<timestamp>_projects-enums.sql`
- Copy from (precedent): `packages/database/supabase/migrations/20261006220301_fleet-rental-lease-enums.sql`

**Steps:**
1. Run `pnpm db:migrate:new projects-enums`.
2. Write only these statements in the new file. Add nothing else, because a new enum value cannot be used in the same transaction.

```sql
ALTER TYPE "module" ADD VALUE IF NOT EXISTS 'Projects';
ALTER TYPE "dimensionEntityType" ADD VALUE IF NOT EXISTS 'ProjectElement';
ALTER TYPE "itemLedgerDocumentType" ADD VALUE IF NOT EXISTS 'Project Issue';
ALTER TYPE "journalEntrySourceType" ADD VALUE IF NOT EXISTS 'Project Issue';
ALTER TYPE "journalEntrySourceType" ADD VALUE IF NOT EXISTS 'Timesheet';
ALTER TYPE "journalLineDocumentType" ADD VALUE IF NOT EXISTS 'Project Issue';
ALTER TYPE "journalLineDocumentType" ADD VALUE IF NOT EXISTS 'Timesheet';
```

**Verify:**
```bash
ls packages/database/supabase/migrations | tail -1
# Expected: a file ending in _projects-enums.sql with a timestamp later than 20261007171726
```

**Out of scope:** any table or view change.

---

## Task 2: Create the Projects module and permissions migration

**Depends on:** 1
**Files:**
- Create: `packages/database/supabase/migrations/<timestamp>_projects-module.sql`
- Copy from (precedent): `packages/database/supabase/migrations/20250325103806_quality-module.sql` (lines 26–31), `20260810100100_workflows-foundation.sql`

**Steps:**
1. Run `pnpm db:migrate:new projects-module`.
2. Write this SQL. It recreates the `modules` view with `security_invoker`, which the `no-view-without-invoker` check requires.

```sql
DROP VIEW IF EXISTS "modules";
CREATE VIEW "modules" WITH (security_invoker = true) AS
  SELECT unnest(enum_range(NULL::module)) AS name;

-- Each employee type's Production row becomes a Projects row (Brad 2026-10-07).
INSERT INTO "employeeTypePermission" ("employeeTypeId", "module", "create", "delete", "update", "view")
SELECT "employeeTypeId", 'Projects'::module, "create", "delete", "update", "view"
FROM "employeeTypePermission"
WHERE "module" = 'Production'
ON CONFLICT ("employeeTypeId", "module") DO NOTHING;

-- Admin and Management always get Projects.
INSERT INTO "employeeTypePermission" ("employeeTypeId", "module", "create", "delete", "update", "view")
SELECT et.id, 'Projects'::module, ARRAY[et."companyId"], ARRAY[et."companyId"], ARRAY[et."companyId"], ARRAY[et."companyId"]
FROM "employeeType" et
WHERE et.name IN ('Admin', 'Management')
ON CONFLICT ("employeeTypeId", "module") DO NOTHING;

-- Each user's production_* permissions become projects_*.
UPDATE "userPermission"
SET "permissions" = "permissions" || jsonb_build_object(
  'projects_view',   COALESCE("permissions"->'production_view',   '[]'::jsonb),
  'projects_create', COALESCE("permissions"->'production_create', '[]'::jsonb),
  'projects_update', COALESCE("permissions"->'production_update', '[]'::jsonb),
  'projects_delete', COALESCE("permissions"->'production_delete', '[]'::jsonb)
);

-- API keys keep parity with users.
UPDATE "apiKey"
SET "scopes" = "scopes" || jsonb_build_object(
  'projects_view',   COALESCE("scopes"->'production_view',   '[]'::jsonb),
  'projects_create', COALESCE("scopes"->'production_create', '[]'::jsonb),
  'projects_update', COALESCE("scopes"->'production_update', '[]'::jsonb),
  'projects_delete', COALESCE("scopes"->'production_delete', '[]'::jsonb)
)
WHERE "scopes" IS NOT NULL;
```

3. If `apiKey."scopes"` is not a JSONB column, STOP and report.

**Verify:**
```bash
grep -c "projects_view" packages/database/supabase/migrations/*_projects-module.sql
# Expected: 2
```

**Out of scope:** the `project` RLS rule (Task 8).

---

## Task 3: Create the workspace tables migration

**Depends on:** 2
**Files:**
- Create: `packages/database/supabase/migrations/<timestamp>_projects-workspace.sql`
- Copy from (precedent): `packages/database/supabase/migrations/20261006221301_contracts.sql` (table and index style)

**Steps:**
1. Run `pnpm db:migrate:new projects-workspace`.
2. Write the SQL below. Do not add any `CREATE POLICY`; Task 8 adds RLS.
3. Add an index on `companyId` and on every FK column of every new table, with `CREATE INDEX IF NOT EXISTS "<table>_<column>_idx"`. Include `createdBy` and `updatedBy`.

```sql
CREATE TYPE "projectStatus" AS ENUM ('Draft', 'Released', 'On Hold', 'Technically Complete', 'Closed');
CREATE TYPE "projectCostTreatment" AS ENUM ('Statistical', 'Expense', 'Capitalize', 'Contract');
CREATE TYPE "projectElementType" AS ENUM ('Folder', 'System', 'Requirement', 'Function', 'Task', 'Test Case', 'Parameter');
CREATE TYPE "projectStateGroup" AS ENUM ('Backlog', 'Unstarted', 'Started', 'Completed', 'Cancelled');
CREATE TYPE "projectElementPriority" AS ENUM ('Urgent', 'High', 'Medium', 'Low', 'None');

-- project: grow the existing table. Every new column is nullable or has a DEFAULT,
-- so db:check:backups stays green.
ALTER TABLE "project"
  ADD COLUMN IF NOT EXISTS "identifier" TEXT,
  ADD COLUMN IF NOT EXISTS "nextElementSequence" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS "status" "projectStatus" NOT NULL DEFAULT 'Released',
  ADD COLUMN IF NOT EXISTS "costTreatment" "projectCostTreatment" NOT NULL DEFAULT 'Statistical',
  ADD COLUMN IF NOT EXISTS "costAccountId" TEXT,
  ADD COLUMN IF NOT EXISTS "customerId" TEXT,
  ADD COLUMN IF NOT EXISTS "ownerId" TEXT REFERENCES "user"("id"),
  ADD COLUMN IF NOT EXISTS "locationId" TEXT,
  ADD COLUMN IF NOT EXISTS "startDate" DATE,
  ADD COLUMN IF NOT EXISTS "endDate" DATE,
  ADD COLUMN IF NOT EXISTS "priority" "projectElementPriority" NOT NULL DEFAULT 'None',
  ADD COLUMN IF NOT EXISTS "isTemplate" BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS "customFields" JSONB;

ALTER TABLE "project"
  ADD CONSTRAINT "project_identifier_check" CHECK ("identifier" IS NULL OR "identifier" ~ '^[A-Z][A-Z0-9]{1,5}$'),
  ADD CONSTRAINT "project_costAccount_fkey" FOREIGN KEY ("costAccountId") REFERENCES "account"("id") ON DELETE SET NULL,
  ADD CONSTRAINT "project_customer_fkey" FOREIGN KEY ("customerId") REFERENCES "customer"("id") ON DELETE SET NULL,
  ADD CONSTRAINT "project_location_fkey" FOREIGN KEY ("locationId") REFERENCES "location"("id") ON DELETE SET NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "project_identifier_key" ON "project" ("companyId", "identifier") WHERE "identifier" IS NOT NULL;

CREATE TABLE IF NOT EXISTS "projectState" (
  "id" TEXT NOT NULL DEFAULT id('pjs'),
  "companyId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "group" "projectStateGroup" NOT NULL,
  "color" TEXT NOT NULL,
  "sortOrder" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "isDefault" BOOLEAN NOT NULL DEFAULT FALSE,
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  CONSTRAINT "projectState_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "projectState_project_key" UNIQUE ("id", "projectId", "companyId"),
  CONSTRAINT "projectState_name_key" UNIQUE ("projectId", "name", "companyId"),
  CONSTRAINT "projectState_project_fkey" FOREIGN KEY ("projectId", "companyId") REFERENCES "project"("id", "companyId") ON DELETE CASCADE,
  CONSTRAINT "projectState_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE
);
-- one default state per group per project
CREATE UNIQUE INDEX IF NOT EXISTS "projectState_default_key" ON "projectState" ("projectId", "group", "companyId") WHERE "isDefault";

CREATE TABLE IF NOT EXISTS "projectMilestone" (
  "id" TEXT NOT NULL DEFAULT id('pjm'),
  "companyId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" JSONB,
  "startDate" DATE,
  "endDate" DATE,
  "completedAt" TIMESTAMP WITH TIME ZONE,
  "sortOrder" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  CONSTRAINT "projectMilestone_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "projectMilestone_project_key" UNIQUE ("id", "projectId", "companyId"),
  CONSTRAINT "projectMilestone_project_fkey" FOREIGN KEY ("projectId", "companyId") REFERENCES "project"("id", "companyId") ON DELETE CASCADE,
  CONSTRAINT "projectMilestone_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE,
  CONSTRAINT "projectMilestone_dates_check" CHECK ("endDate" IS NULL OR "startDate" IS NULL OR "endDate" >= "startDate")
);

CREATE TABLE IF NOT EXISTS "projectLabel" (
  "id" TEXT NOT NULL DEFAULT id('pjb'),
  "companyId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "color" TEXT NOT NULL,
  "sortOrder" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  CONSTRAINT "projectLabel_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "projectLabel_project_key" UNIQUE ("id", "projectId", "companyId"),
  CONSTRAINT "projectLabel_name_key" UNIQUE ("projectId", "name", "companyId"),
  CONSTRAINT "projectLabel_project_fkey" FOREIGN KEY ("projectId", "companyId") REFERENCES "project"("id", "companyId") ON DELETE CASCADE,
  CONSTRAINT "projectLabel_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS "projectElement" (
  "id" TEXT NOT NULL DEFAULT id('pje'),
  "companyId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "readableId" TEXT NOT NULL DEFAULT '',            -- set by insertProjectElement: identifier-sequence
  "sequence" INTEGER NOT NULL DEFAULT 0,
  "type" "projectElementType" NOT NULL,
  "parentId" TEXT,
  "name" TEXT NOT NULL,
  "description" JSONB,
  "stateId" TEXT NOT NULL,
  "ownerId" TEXT REFERENCES "user"("id"),
  "priority" "projectElementPriority" NOT NULL DEFAULT 'None',
  "milestoneId" TEXT,
  "startDate" DATE,
  "targetDate" DATE,
  "completedAt" TIMESTAMP WITH TIME ZONE,
  "estimatedHours" NUMERIC,
  "isChargeable" BOOLEAN NOT NULL DEFAULT TRUE,
  "isBilling" BOOLEAN NOT NULL DEFAULT FALSE,
  "budget" NUMERIC,
  "estimateAtCompletion" NUMERIC,
  "costTreatment" "projectCostTreatment",
  "costTreatmentEffectiveFrom" DATE,
  "costAccountId" TEXT REFERENCES "account"("id") ON DELETE SET NULL,
  "itemId" TEXT,
  "sortOrder" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  "customFields" JSONB,
  CONSTRAINT "projectElement_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "projectElement_project_key" UNIQUE ("id", "projectId", "companyId"),
  CONSTRAINT "projectElement_project_fkey" FOREIGN KEY ("projectId", "companyId") REFERENCES "project"("id", "companyId") ON DELETE CASCADE,
  CONSTRAINT "projectElement_parent_fkey" FOREIGN KEY ("parentId", "projectId", "companyId") REFERENCES "projectElement"("id", "projectId", "companyId") ON DELETE CASCADE,
  CONSTRAINT "projectElement_state_fkey" FOREIGN KEY ("stateId", "projectId", "companyId") REFERENCES "projectState"("id", "projectId", "companyId"),
  CONSTRAINT "projectElement_milestone_fkey" FOREIGN KEY ("milestoneId", "companyId") REFERENCES "projectMilestone"("id", "companyId") ON DELETE SET NULL ("milestoneId"),
  CONSTRAINT "projectElement_item_fkey" FOREIGN KEY ("itemId") REFERENCES "item"("id") ON DELETE SET NULL,
  CONSTRAINT "projectElement_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE,
  CONSTRAINT "projectElement_parent_check" CHECK ("parentId" IS NULL OR "parentId" <> "id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "projectElement_readable_key" ON "projectElement" ("readableId", "companyId") WHERE "readableId" <> '';

CREATE TABLE IF NOT EXISTS "projectElementLabel" (
  "projectElementId" TEXT NOT NULL,
  "projectLabelId" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  CONSTRAINT "projectElementLabel_pkey" PRIMARY KEY ("projectElementId", "projectLabelId", "companyId"),
  CONSTRAINT "projectElementLabel_element_fkey" FOREIGN KEY ("projectElementId", "companyId") REFERENCES "projectElement"("id", "companyId") ON DELETE CASCADE,
  CONSTRAINT "projectElementLabel_label_fkey" FOREIGN KEY ("projectLabelId", "companyId") REFERENCES "projectLabel"("id", "companyId") ON DELETE CASCADE,
  CONSTRAINT "projectElementLabel_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS "projectElementComment" (
  "id" TEXT NOT NULL DEFAULT id('pjc'),
  "companyId" TEXT NOT NULL,
  "projectElementId" TEXT NOT NULL,
  "content" JSONB NOT NULL,
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  CONSTRAINT "projectElementComment_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "projectElementComment_element_fkey" FOREIGN KEY ("projectElementId", "companyId") REFERENCES "projectElement"("id", "companyId") ON DELETE CASCADE,
  CONSTRAINT "projectElementComment_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE
);

-- Plan lines: the BOM-like content of an element.
CREATE TABLE IF NOT EXISTS "projectElementMaterial" (
  "id" TEXT NOT NULL DEFAULT id('pjp'),
  "companyId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "projectElementId" TEXT NOT NULL,
  "itemId" TEXT NOT NULL REFERENCES "item"("id"),
  "methodType" "methodType" NOT NULL DEFAULT 'Pull from Inventory',
  "quantity" NUMERIC NOT NULL CHECK ("quantity" > 0),
  "unitOfMeasureCode" TEXT,
  "requiredDate" DATE,
  "quantityIssued" NUMERIC NOT NULL DEFAULT 0,
  "unitCost" NUMERIC,
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  CONSTRAINT "projectElementMaterial_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "projectElementMaterial_element_fkey" FOREIGN KEY ("projectElementId", "projectId", "companyId") REFERENCES "projectElement"("id", "projectId", "companyId") ON DELETE CASCADE,
  CONSTRAINT "projectElementMaterial_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS "projectElementCost" (
  "id" TEXT NOT NULL DEFAULT id('pjo'),
  "companyId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "projectElementId" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "amount" NUMERIC NOT NULL,
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  CONSTRAINT "projectElementCost_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "projectElementCost_element_fkey" FOREIGN KEY ("projectElementId", "projectId", "companyId") REFERENCES "projectElement"("id", "projectId", "companyId") ON DELETE CASCADE,
  CONSTRAINT "projectElementCost_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE
);
```

4. The labor plan table needs `laborCategory`. Task 4 creates both.

**Verify:**
```bash
grep -c "CREATE TABLE IF NOT EXISTS" packages/database/supabase/migrations/*_projects-workspace.sql
# Expected: 8
grep -c "CREATE POLICY" packages/database/supabase/migrations/*_projects-workspace.sql
# Expected: 0
```

**Out of scope:** trace links, Parameters, Requirement and Test Case columns, `isFinalAsset` and `fixedAssetId` (all Phase 1b).

---

## Task 4: Create the time and ledger tables migration

**Depends on:** 3
**Files:**
- Create: `packages/database/supabase/migrations/<timestamp>_projects-time-and-ledger.sql`
- Copy from (precedent): `packages/database/supabase/migrations/20260726012013_add_scrap_account.sql` (accountDefault column), `20260319200000_employee-time-clock.sql` (companySettings column)

**Steps:**
1. Run `pnpm db:migrate:new projects-time-and-ledger`.
2. Write the SQL below.
3. Add an index on `companyId` and on every FK column of every new table and every new column, as in Task 3.

```sql
CREATE TYPE "projectCostType" AS ENUM ('Material', 'Labor', 'Machine', 'Overhead',
  'Outside Processing', 'Purchased Service', 'Other Direct', 'Material Variance',
  'Payback Variance', 'Burden');
CREATE TYPE "timesheetEntryStatus" AS ENUM ('Draft', 'Submitted', 'Approved', 'Posted', 'Rejected');

CREATE TABLE IF NOT EXISTS "laborCategory" (
  "id" TEXT NOT NULL DEFAULT id('lbc'),
  "companyId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "active" BOOLEAN NOT NULL DEFAULT TRUE,
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  CONSTRAINT "laborCategory_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "laborCategory_name_key" UNIQUE ("companyId", "name"),
  CONSTRAINT "laborCategory_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS "laborCategoryRate" (
  "id" TEXT NOT NULL DEFAULT id('lbr'),
  "companyId" TEXT NOT NULL,
  "laborCategoryId" TEXT NOT NULL,
  "effectiveFrom" DATE NOT NULL,
  "costRate" NUMERIC NOT NULL CHECK ("costRate" >= 0),
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  CONSTRAINT "laborCategoryRate_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "laborCategoryRate_effective_key" UNIQUE ("laborCategoryId", "effectiveFrom", "companyId"),
  CONSTRAINT "laborCategoryRate_category_fkey" FOREIGN KEY ("laborCategoryId", "companyId") REFERENCES "laborCategory"("id", "companyId") ON DELETE CASCADE,
  CONSTRAINT "laborCategoryRate_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE
);

ALTER TABLE "employeeJob" ADD COLUMN IF NOT EXISTS "laborCategoryId" TEXT;
ALTER TABLE "employeeJob" ADD CONSTRAINT "employeeJob_laborCategory_fkey"
  FOREIGN KEY ("laborCategoryId", "companyId") REFERENCES "laborCategory"("id", "companyId") ON DELETE SET NULL ("laborCategoryId");

CREATE TABLE IF NOT EXISTS "projectElementLabor" (
  "id" TEXT NOT NULL DEFAULT id('pjr'),
  "companyId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "projectElementId" TEXT NOT NULL,
  "laborCategoryId" TEXT NOT NULL,
  "hours" NUMERIC NOT NULL CHECK ("hours" > 0),
  "startDate" DATE,
  "endDate" DATE,
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  CONSTRAINT "projectElementLabor_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "projectElementLabor_element_fkey" FOREIGN KEY ("projectElementId", "projectId", "companyId") REFERENCES "projectElement"("id", "projectId", "companyId") ON DELETE CASCADE,
  CONSTRAINT "projectElementLabor_category_fkey" FOREIGN KEY ("laborCategoryId", "companyId") REFERENCES "laborCategory"("id", "companyId"),
  CONSTRAINT "projectElementLabor_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS "timesheetEntry" (
  "id" TEXT NOT NULL DEFAULT id('tse'),
  "companyId" TEXT NOT NULL,
  "employeeId" TEXT NOT NULL REFERENCES "user"("id"),
  "entryDate" DATE NOT NULL,
  "projectId" TEXT NOT NULL,
  "projectElementId" TEXT,                           -- null = the project itself
  "laborCategoryId" TEXT NOT NULL,
  "hours" NUMERIC NOT NULL CHECK ("hours" <> 0),     -- negative only on a reversal
  "note" TEXT,
  "status" "timesheetEntryStatus" NOT NULL DEFAULT 'Draft',
  "submittedAt" TIMESTAMP WITH TIME ZONE,
  "approvedBy" TEXT REFERENCES "user"("id"),
  "approvedAt" TIMESTAMP WITH TIME ZONE,
  "rejectionNote" TEXT,
  "costRate" NUMERIC,
  "reversalOfId" TEXT,
  "correctionReason" TEXT,
  "journalId" TEXT REFERENCES "journal"("id") ON DELETE SET NULL,
  "postedAt" TIMESTAMP WITH TIME ZONE,
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  CONSTRAINT "timesheetEntry_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "timesheetEntry_project_fkey" FOREIGN KEY ("projectId", "companyId") REFERENCES "project"("id", "companyId"),
  CONSTRAINT "timesheetEntry_element_fkey" FOREIGN KEY ("projectElementId", "projectId", "companyId") REFERENCES "projectElement"("id", "projectId", "companyId"),
  CONSTRAINT "timesheetEntry_category_fkey" FOREIGN KEY ("laborCategoryId", "companyId") REFERENCES "laborCategory"("id", "companyId"),
  CONSTRAINT "timesheetEntry_reversal_fkey" FOREIGN KEY ("reversalOfId", "companyId") REFERENCES "timesheetEntry"("id", "companyId"),
  CONSTRAINT "timesheetEntry_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE,
  CONSTRAINT "timesheetEntry_correction_check" CHECK ("reversalOfId" IS NULL OR "correctionReason" IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS "timesheetEntry_employee_date_idx" ON "timesheetEntry" ("companyId", "employeeId", "entryDate");

CREATE TABLE IF NOT EXISTS "projectLedger" (
  "id" TEXT NOT NULL DEFAULT id('pjl'),
  "companyId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "projectElementId" TEXT,                           -- null = the project itself
  "postingDate" DATE NOT NULL,
  "costType" "projectCostType" NOT NULL,
  "documentType" TEXT NOT NULL,
  "documentId" TEXT NOT NULL,
  "documentLineId" TEXT,
  "jobId" TEXT,
  "itemId" TEXT,
  "employeeId" TEXT,
  "laborCategoryId" TEXT,
  "supplierId" TEXT,
  "quantity" NUMERIC,
  "unitOfMeasureCode" TEXT,
  "amount" NUMERIC NOT NULL,
  "journalLineId" TEXT,
  "reversalOfId" TEXT,
  "unallowable" BOOLEAN NOT NULL DEFAULT FALSE,
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  CONSTRAINT "projectLedger_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "projectLedger_project_fkey" FOREIGN KEY ("projectId", "companyId") REFERENCES "project"("id", "companyId"),
  CONSTRAINT "projectLedger_element_fkey" FOREIGN KEY ("projectElementId", "projectId", "companyId") REFERENCES "projectElement"("id", "projectId", "companyId"),
  CONSTRAINT "projectLedger_reversal_fkey" FOREIGN KEY ("reversalOfId", "companyId") REFERENCES "projectLedger"("id", "companyId"),
  CONSTRAINT "projectLedger_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "projectLedger_element_idx" ON "projectLedger" ("companyId", "projectId", "projectElementId", "postingDate");
CREATE INDEX IF NOT EXISTS "projectLedger_document_idx" ON "projectLedger" ("companyId", "documentType", "documentId");

-- Charge numbers on documents. The composite FK makes a mismatched project/element pair impossible.
ALTER TABLE "job"
  ADD COLUMN IF NOT EXISTS "projectId" TEXT,
  ADD COLUMN IF NOT EXISTS "projectElementId" TEXT,
  ADD COLUMN IF NOT EXISTS "consumeToProject" BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE "job"
  ADD CONSTRAINT "job_project_fkey" FOREIGN KEY ("projectId", "companyId") REFERENCES "project"("id", "companyId") ON DELETE SET NULL ("projectId"),
  ADD CONSTRAINT "job_projectElement_fkey" FOREIGN KEY ("projectElementId", "projectId", "companyId") REFERENCES "projectElement"("id", "projectId", "companyId"),
  ADD CONSTRAINT "job_consumeToProject_check" CHECK (NOT "consumeToProject" OR "projectId" IS NOT NULL);

ALTER TABLE "purchaseOrderLine"
  ADD COLUMN IF NOT EXISTS "projectId" TEXT,
  ADD COLUMN IF NOT EXISTS "projectElementId" TEXT;
ALTER TABLE "purchaseOrderLine"
  ADD CONSTRAINT "purchaseOrderLine_project_fkey" FOREIGN KEY ("projectId", "companyId") REFERENCES "project"("id", "companyId") ON DELETE SET NULL ("projectId"),
  ADD CONSTRAINT "purchaseOrderLine_projectElement_fkey" FOREIGN KEY ("projectElementId", "projectId", "companyId") REFERENCES "projectElement"("id", "projectId", "companyId");

ALTER TABLE "purchaseInvoiceLine" ADD COLUMN IF NOT EXISTS "projectElementId" TEXT;
ALTER TABLE "purchaseInvoiceLine" ADD CONSTRAINT "purchaseInvoiceLine_projectElement_fkey"
  FOREIGN KEY ("projectElementId", "projectId", "companyId") REFERENCES "projectElement"("id", "projectId", "companyId");
ALTER TABLE "chargeLine" ADD COLUMN IF NOT EXISTS "projectElementId" TEXT;
ALTER TABLE "chargeLine" ADD CONSTRAINT "chargeLine_projectElement_fkey"
  FOREIGN KEY ("projectElementId", "projectId", "companyId") REFERENCES "projectElement"("id", "projectId", "companyId");
ALTER TABLE "reimbursementLine" ADD COLUMN IF NOT EXISTS "projectElementId" TEXT;
ALTER TABLE "reimbursementLine" ADD CONSTRAINT "reimbursementLine_projectElement_fkey"
  FOREIGN KEY ("projectElementId", "projectId", "companyId") REFERENCES "projectElement"("id", "projectId", "companyId");

ALTER TABLE "accountDefault"
  ADD COLUMN IF NOT EXISTS "projectExpenseAccount" TEXT REFERENCES "account"("id") ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS "projectWorkInProgressAccount" TEXT REFERENCES "account"("id") ON DELETE RESTRICT;

ALTER TABLE "companySettings"
  ADD COLUMN IF NOT EXISTS "timesheetApprovalRequired" BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS "requireProjectElement" BOOLEAN NOT NULL DEFAULT FALSE;
```

4. If `accountDefault` keys accounts by a column other than `account.id`, copy the FK form from `20260726012013_add_scrap_account.sql` instead.

**Verify:**
```bash
grep -c "CREATE TABLE IF NOT EXISTS" packages/database/supabase/migrations/*_projects-time-and-ledger.sql
# Expected: 5
```

**Out of scope:** `receiptLine` columns. `post-receipt` reads the charge number from the PO line (Task 21).

---

## Task 5: Create the backfill migration

**Depends on:** 4
**Files:**
- Create: `packages/database/supabase/migrations/<timestamp>_projects-backfill.sql`
- Copy from (precedent): `packages/database/supabase/migrations/20260919153014_accounting-projects.sql` (dimension backfill at its end)

**Steps:**
1. Run `pnpm db:migrate:new projects-backfill`.
2. Write the SQL below.

```sql
-- 1. Identifiers for existing projects: initials of the name, capitals, made unique per company.
CREATE OR REPLACE FUNCTION derive_project_identifier(p_name TEXT, p_company_id TEXT)
RETURNS TEXT LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  base TEXT;
  candidate TEXT;
  n INTEGER := 1;
BEGIN
  base := upper(regexp_replace(
    COALESCE((SELECT string_agg(left(w, 1), '') FROM regexp_split_to_table(p_name, '\s+') AS w WHERE w <> ''), ''),
    '[^A-Za-z0-9]', '', 'g'));
  IF base !~ '^[A-Z]' THEN base := 'P' || base; END IF;
  IF length(base) < 2 THEN base := rpad(base, 2, 'X'); END IF;
  base := left(base, 4);
  candidate := base;
  WHILE EXISTS (SELECT 1 FROM "project" WHERE "companyId" = p_company_id AND "identifier" = candidate) LOOP
    n := n + 1;
    candidate := left(base, 6 - length(n::TEXT)) || n::TEXT;
  END LOOP;
  RETURN candidate;
END;
$$;

DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT "id", "companyId", "name" FROM "project" WHERE "identifier" IS NULL ORDER BY "createdAt" LOOP
    UPDATE "project" SET "identifier" = derive_project_identifier(r."name", r."companyId")
    WHERE "id" = r."id" AND "companyId" = r."companyId";
  END LOOP;
END $$;

-- 2. Seeded states for every existing project.
INSERT INTO "projectState" ("projectId", "companyId", "name", "group", "color", "sortOrder", "isDefault", "createdBy")
SELECT p."id", p."companyId", s.name, s.grp::"projectStateGroup", s.color, s.sort, s.is_default, 'system'
FROM "project" p
CROSS JOIN (VALUES
  ('Backlog', 'Backlog', '#60646C', 1, TRUE),
  ('Todo', 'Unstarted', '#60646C', 2, TRUE),
  ('In Progress', 'Started', '#F59E0B', 3, TRUE),
  ('In Review', 'Started', '#3B82F6', 4, FALSE),
  ('Done', 'Completed', '#46A758', 5, TRUE),
  ('Cancelled', 'Cancelled', '#9AA4BC', 6, TRUE)
) AS s(name, grp, color, sort, is_default)
ON CONFLICT ("projectId", "name", "companyId") DO NOTHING;

-- 3. The "Project Element" dimension for every company group.
INSERT INTO "dimension" ("name", "entityType", "companyGroupId", "createdBy")
SELECT 'Project Element', 'ProjectElement'::"dimensionEntityType", cg."id", 'system'
FROM "companyGroup" cg
ON CONFLICT ("name", "companyGroupId") WHERE "active" = true DO NOTHING;

-- 4. Account defaults: Project WIP = the WIP account; Project Expense = account 7080 when it exists.
UPDATE "accountDefault" ad
SET "projectWorkInProgressAccount" = ad."workInProgressAccount"
WHERE ad."projectWorkInProgressAccount" IS NULL;

UPDATE "accountDefault" ad
SET "projectExpenseAccount" = a."id"
FROM "company" c
JOIN "account" a ON a."companyGroupId" = c."companyGroupId" AND a."number" = '7080' AND a."isGroup" = FALSE
WHERE c."id" = ad."companyId" AND ad."projectExpenseAccount" IS NULL;
```

3. If `system` is not a valid `user.id` in this database, use the value the `20260919153014` backfill uses.

**Verify:**
```bash
grep -c "derive_project_identifier" packages/database/supabase/migrations/*_projects-backfill.sql
# Expected: 2
```

**Out of scope:** element rows for existing projects. Existing projects start with no elements.

---

## Task 6: Create the SQL functions migration

**Depends on:** 5
**Files:**
- Create: `packages/database/supabase/migrations/<timestamp>_projects-functions.sql`

**Steps:**
1. Run `pnpm db:migrate:new projects-functions`.
2. Write `get_project_cost_summary`. It returns one row per element of the project, plus one row with `projectElementId` NULL for project-level charges. The roll-up to ancestors happens in the app (Task 38), because the tree is already loaded there.

```sql
CREATE OR REPLACE FUNCTION get_project_cost_summary(p_project_id TEXT, p_company_id TEXT)
RETURNS TABLE (
  "projectElementId" TEXT,
  "planMaterial" NUMERIC,
  "planLabor" NUMERIC,
  "planOther" NUMERIC,
  "committed" NUMERIC,
  "actual" NUMERIC,
  "actualHours" NUMERIC
)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  WITH elements AS (
    SELECT e."id" FROM "projectElement" e
    WHERE e."projectId" = p_project_id AND e."companyId" = p_company_id
    UNION ALL SELECT NULL
  ),
  plan_material AS (
    SELECT m."projectElementId", SUM(m."quantity" * COALESCE(m."unitCost", ic."unitCost", 0)) AS v
    FROM "projectElementMaterial" m
    LEFT JOIN "itemCost" ic ON ic."itemId" = m."itemId" AND ic."companyId" = m."companyId"
    WHERE m."projectId" = p_project_id AND m."companyId" = p_company_id
    GROUP BY m."projectElementId"
  ),
  plan_labor AS (
    SELECT l."projectElementId", SUM(l."hours" * COALESCE((
      SELECT r."costRate" FROM "laborCategoryRate" r
      WHERE r."laborCategoryId" = l."laborCategoryId" AND r."companyId" = l."companyId"
        AND r."effectiveFrom" <= CURRENT_DATE
      ORDER BY r."effectiveFrom" DESC LIMIT 1), 0)) AS v
    FROM "projectElementLabor" l
    WHERE l."projectId" = p_project_id AND l."companyId" = p_company_id
    GROUP BY l."projectElementId"
  ),
  plan_other AS (
    SELECT c."projectElementId", SUM(c."amount") AS v
    FROM "projectElementCost" c
    WHERE c."projectId" = p_project_id AND c."companyId" = p_company_id
    GROUP BY c."projectElementId"
  ),
  commitments AS (
    SELECT pol."projectElementId",
      SUM(GREATEST(pol."purchaseQuantity" - COALESCE(pol."quantityReceived", 0), 0) * COALESCE(pol."unitPrice", 0)) AS v
    FROM "purchaseOrderLine" pol
    JOIN "purchaseOrder" po ON po."id" = pol."purchaseOrderId"
    WHERE pol."projectId" = p_project_id AND pol."companyId" = p_company_id
      AND po."status" IN ('To Receive', 'To Receive and Invoice', 'To Invoice', 'Planned')
    GROUP BY pol."projectElementId"
  ),
  actuals AS (
    SELECT pl."projectElementId", SUM(pl."amount") AS v
    FROM "projectLedger" pl
    WHERE pl."projectId" = p_project_id AND pl."companyId" = p_company_id
    GROUP BY pl."projectElementId"
  ),
  hours AS (
    SELECT t."projectElementId", SUM(t."hours") AS v
    FROM "timesheetEntry" t
    WHERE t."projectId" = p_project_id AND t."companyId" = p_company_id AND t."status" = 'Posted'
    GROUP BY t."projectElementId"
  )
  SELECT e."id",
    COALESCE(pm.v, 0), COALESCE(pl.v, 0), COALESCE(po.v, 0),
    COALESCE(c.v, 0), COALESCE(a.v, 0), COALESCE(h.v, 0)
  FROM elements e
  LEFT JOIN plan_material pm ON pm."projectElementId" IS NOT DISTINCT FROM e."id"
  LEFT JOIN plan_labor pl ON pl."projectElementId" IS NOT DISTINCT FROM e."id"
  LEFT JOIN plan_other po ON po."projectElementId" IS NOT DISTINCT FROM e."id"
  LEFT JOIN commitments c ON c."projectElementId" IS NOT DISTINCT FROM e."id"
  LEFT JOIN actuals a ON a."projectElementId" IS NOT DISTINCT FROM e."id"
  LEFT JOIN hours h ON h."projectElementId" IS NOT DISTINCT FROM e."id";
$$;
```

3. Open `purchaseOrderLine` in `packages/database/src/types.ts` (Task 7 regenerates it) or in its newest migration. Confirm the column names `purchaseQuantity`, `quantityReceived` and `unitPrice`, and the `purchaseOrderStatus` values. If a name differs, use the real name. If no received-quantity column exists, STOP and report.
4. Write `project_posting_account`. It mirrors `resolveProjectPostingAccount` (Task 15) for SQL callers (Task 20). Keep the two in step.

```sql
-- Mirror of resolveProjectPostingAccount in packages/server-functions/src/lib/project-posting.ts.
-- Returns NULL for a Statistical project (the caller keeps its natural account).
CREATE OR REPLACE FUNCTION project_posting_account(
  p_company_id TEXT, p_project_id TEXT, p_element_id TEXT, p_posting_date DATE
) RETURNS TEXT LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = public AS $$
DECLARE
  v_treatment "projectCostTreatment";
  v_account TEXT;
  v_project RECORD;
  v_defaults RECORD;
BEGIN
  SELECT "costTreatment", "costAccountId" INTO v_project
  FROM "project" WHERE "id" = p_project_id AND "companyId" = p_company_id;
  IF NOT FOUND THEN RETURN NULL; END IF;

  -- nearest element (self, then ancestors) with a treatment effective on the date
  WITH RECURSIVE chain AS (
    SELECT e."id", e."parentId", e."costTreatment", e."costTreatmentEffectiveFrom", e."costAccountId", 0 AS depth
    FROM "projectElement" e WHERE e."id" = p_element_id AND e."companyId" = p_company_id
    UNION ALL
    SELECT p."id", p."parentId", p."costTreatment", p."costTreatmentEffectiveFrom", p."costAccountId", c.depth + 1
    FROM "projectElement" p JOIN chain c ON p."id" = c."parentId" AND p."companyId" = p_company_id
  )
  SELECT c."costTreatment", c."costAccountId" INTO v_treatment, v_account
  FROM chain c
  WHERE c."costTreatment" IS NOT NULL
    AND (c."costTreatmentEffectiveFrom" IS NULL OR c."costTreatmentEffectiveFrom" <= p_posting_date)
  ORDER BY c.depth LIMIT 1;

  IF v_treatment IS NULL THEN
    v_treatment := v_project."costTreatment";
    v_account := v_project."costAccountId";
  END IF;

  IF v_treatment = 'Statistical' THEN RETURN NULL; END IF;
  IF v_account IS NOT NULL THEN RETURN v_account; END IF;

  SELECT "projectExpenseAccount", "projectWorkInProgressAccount" INTO v_defaults
  FROM "accountDefault" WHERE "companyId" = p_company_id;
  IF v_treatment = 'Expense' THEN RETURN v_defaults."projectExpenseAccount"; END IF;
  IF v_treatment = 'Contract' THEN RETURN v_defaults."projectWorkInProgressAccount"; END IF;
  RAISE EXCEPTION 'Cost treatment % is not available yet', v_treatment;
END;
$$;
```

5. 🛑 `CURRENT_DATE` in `get_project_cost_summary` is the database's UTC day. It only picks a rate for a plan estimate, never a posting, so the UTC day is acceptable here. Do not copy this into any posting path.

**Verify:**
```bash
grep -c "CREATE OR REPLACE FUNCTION" packages/database/supabase/migrations/*_projects-functions.sql
# Expected: 2
```

**Out of scope:** any trigger. Readable ids come from the service (Task 13).

---

## Task 7: Apply migrations and regenerate types

**Depends on:** 6
**Files:**
- Modify: `packages/database/src/types.ts`, `packages/database/supabase/functions/lib/types.ts`, `packages/database/src/swagger-docs-schema.ts` (generated)

**Steps:**
1. Run `pnpm db:migrate`.
2. Run `pnpm run generate:types`.

**Verify:**
```bash
grep -c '"Projects"' packages/database/src/types.ts
# Expected: at least 1
grep -c "projectElement: {" packages/database/src/types.ts
# Expected: 1
pnpm exec turbo run typecheck --filter=@carbon/database
# Expected: exit code 0
```

**Out of scope:** hand edits to generated files.

---

## Task 8: Add authz rules and ship the RLS migration

**Depends on:** 7
**Files:**
- Modify: `packages/database/src/authz/manifest.ts`
- Create: the generated migration from `authz migration projects-rls`

**Steps:**
1. In `manifest.ts`, change `project: company("accounting"),` (about line 1090) to `project: company("projects"),`.
2. Add these rules in alphabetical order:

```ts
laborCategory: company("projects"),
laborCategoryRate: company("projects"),
projectElement: company("projects"),
projectElementComment: company("projects", { create: "employee", update: owner("createdBy"), delete: owner("createdBy") }),
projectElementCost: company("projects"),
projectElementLabel: company("projects"),
projectElementLabor: company("projects"),
projectElementMaterial: company("projects"),
projectLabel: company("projects"),
projectLedger: company("projects", { create: false, update: false, delete: false }),
projectMilestone: company("projects"),
projectState: company("projects"),
timesheetEntry: policies({
  select: or(owner("employeeId"), inCompany("companyId", "projects_view")),
  insert: and(owner("employeeId"), inCompany("companyId", "employee")),
  update: {
    using: or(and(owner("employeeId"), where<"timesheetEntry">((eb) => eb("status", "=", "Draft"))), inCompany("companyId", "projects_update")),
    check: inCompany("companyId", "employee")
  },
  delete: and(owner("employeeId"), where<"timesheetEntry">((eb) => eb("status", "=", "Draft")))
}),
```

3. If `owner`, `or`, `and`, `inCompany` or `where` take different arguments than shown, read `packages/database/src/authz/rules.ts` and use its real signatures. Keep the same meaning: employees edit their own Draft rows; `projects_update` holders edit any row; the project ledger takes writes only from the service role.
4. Run `pnpm db:migrate`.
5. Run `pnpm --filter @carbon/database authz migration projects-rls`.

**Verify:**
```bash
pnpm --filter @carbon/database exec vitest run src/authz
# Expected: all tests pass
```

**Out of scope:** hand edits to the generated migration or `baseline.json`.

---

## Task 9: Register backup id references and audit config

**Depends on:** 7
**Files:**
- Modify: `packages/jobs/src/backups/id-refs.ts` — add `projectLedger.documentId`, `projectLedger.documentLineId`, `projectLedger.jobId`, `projectLedger.itemId`, `projectLedger.journalLineId`
- Modify: `packages/database/src/audit.config.ts` — add `projectElement` as an entity, with `projectElementLabel`, `projectElementMaterial`, `projectElementLabor` and `projectElementCost` as its children
- Copy from (precedent): the `inspection` entry in `id-refs.ts`; an existing parent/child entry in `audit.config.ts`

**Steps:**
1. Add the five `projectLedger` columns to `ID_REF_COLUMNS`. Each holds a tenant row id with no FK.
2. Add the `projectElement` entity to `audit.config.ts`, with the four child tables mapped to it.
3. Run `pnpm exec turbo run typecheck --filter=@carbon/jobs`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/jobs --filter=@carbon/database
# Expected: exit code 0
```

**Out of scope:** `TABLE_RENAMES`. No table is renamed or dropped.

---

## Task 10: Update seed data for new companies

**Depends on:** 7
**Files:**
- Modify: `packages/database/src/seed-data.ts` — `accountDefaults` (line 2125) and `dimensions` (line 12)
- Modify: `packages/server-functions/src/seed-company/index.ts` — only if it needs an explicit mapping for the new defaults

**Steps:**
1. Add `projectExpenseAccount: "7080"` and `projectWorkInProgressAccount: "1230"` to `accountDefaults`.
2. Add `{ name: "Project Element", entityType: "ProjectElement" }` to `dimensions`, next to the `Project` entry.
3. Read `seed-company/index.ts` lines 442–483. If it maps every key of `accountDefaults` generically, change nothing there. If it lists keys one by one, add the two new keys.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/database --filter=@carbon/server-functions
# Expected: exit code 0
```

**Out of scope:** seeding project states for new companies. A project gets its states when it is created (Task 12).

---

## Task 11: Add the projects module models

**Depends on:** 7
**Files:**
- Create: `apps/erp/app/modules/projects/projects.models.ts`
- Create: `apps/erp/app/modules/projects/types.ts`
- Create: `apps/erp/app/modules/projects/index.ts`
- Copy from (precedent): `apps/erp/app/modules/workflows/` (barrel shape), `apps/erp/app/modules/accounting/accounting.models.ts` lines 638–642 (`projectValidator`)

**Steps:**
1. In `projects.models.ts`, export these const arrays from the generated enums: `projectStatuses`, `projectCostTreatments` (UI offers Statistical, Expense and Contract only in 1a), `projectElementTypes`, `projectStateGroups`, `projectElementPriorities`, `projectCostTypes`, `timesheetEntryStatuses`.
2. Export `chargeableByDefault: Record<ProjectElementType, boolean>` with `Folder: false`, `Parameter: false`, and `true` for the other types.
3. Export `defaultProjectStates`, the six states from Task 5 step 2 as an array of `{ name, group, color, sortOrder, isDefault }`.
4. Export these zod validators (zod + `zfd`, as in `conventions-forms.md`):
   - `projectValidator`: `id` optional, `name`, `identifier` (regex `^[A-Z][A-Z0-9]{1,5}$`, optional on create), `description`, `costTreatment`, `costAccountId`, `customerId`, `ownerId`, `locationId`, `startDate`, `endDate`, `priority`.
   - `projectStatusValidator`: `status`.
   - `projectStateValidator`: `id` optional, `name`, `group`, `color`.
   - `projectLabelValidator`: `id` optional, `name`, `color`.
   - `projectMilestoneValidator`: `id` optional, `name`, `startDate`, `endDate`.
   - `projectElementValidator`: `id` optional, `type`, `name`, `parentId`, `stateId`, `ownerId`, `priority`, `milestoneId`, `startDate`, `targetDate`, `estimatedHours`, `isChargeable`, `budget`, `itemId`.
   - `projectElementFieldUpdateValidator`: `ids` (array), `field` (enum of the editable field names), `value`.
   - `projectElementCommentValidator`: `projectElementId`, `content` (JSON string).
   - `projectElementMaterialValidator`, `projectElementLaborValidator`, `projectElementCostValidator`: one per plan-line table.
   - `laborCategoryValidator` and `laborCategoryRateValidator`.
   - `timesheetCellValidator`: `entryDate`, `projectId`, `projectElementId` optional, `laborCategoryId`, `hours`, `note` optional.
   - `logTimeValidator`: the same fields as `timesheetCellValidator`.
   - `timesheetCorrectionValidator`: `timesheetEntryId`, `hours`, `correctionReason` (required, at least 1 character).
   - `projectIssueValidator`: `projectId`, `projectElementId` optional, `itemId`, `locationId`, `storageUnitId` optional, `trackedEntityId` optional, `quantity` (> 0), `direction` (`Issue` | `Return`).
5. Add a refine to `projectElementValidator`: if `type` is `Parameter`, `isChargeable` must be false.
6. In `types.ts`, export the row types from `Database["public"]["Tables"]` and the return types of the service functions (Tasks 12–14).
7. In `index.ts`, export `*` from `./projects.models` and `./projects.service`, and export the types.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exit code 0 (the barrel can export a stub service file until Task 12)
```

**Out of scope:** validators for Phase 1b fields (trace links, targets, verdicts, parameters).

---

## Task 12: Add the project and workspace service functions

**Depends on:** 11
**Files:**
- Create: `apps/erp/app/modules/projects/projects.service.ts`
- Create: `apps/erp/app/modules/projects/projects.server.ts`
- Create: `apps/erp/test/projects-identifier.test.ts`
- Copy from (precedent): `getProjects` / `upsertProject` in `apps/erp/app/modules/accounting/accounting.service.ts` (lines 4543–4620); `updateQuoteLineOrder` in `sales.service.ts`

**Steps:**
1. Move `getProjects`, `getProject`, `upsertProject` and `deleteProject` from `accounting.service.ts` into `projects.service.ts`. Keep their `@mcp` tags. Delete them from the accounting file.
2. Extend `getProjects` to select the new columns and to filter by `status`, `costTreatment` and `ownerId`.
3. Add a pure function `suggestProjectIdentifier(name: string): string` in `projects.models.ts`:
   - initials of the name, capitals, 2–4 characters;
   - prefix `P` if it does not start with a letter;
   - pad with `X` to 2 characters.

   This mirrors `derive_project_identifier` without the uniqueness loop.
4. Add `createProject(db, args)` to `projects.server.ts` (Kysely, one transaction):
   1. Insert the project row. If `identifier` is empty, call `derive_project_identifier(name, companyId)` in SQL.
   2. Insert the six `defaultProjectStates` for the project.
   3. Return the project id.
5. Add `updateProject(client, args)` (supabase update by `id` and `companyId`, with `sanitize`) and `updateProjectStatus(client, { id, companyId, status, updatedBy })`.
6. Before `Closed`, `updateProjectStatus` must refuse when the project has open PO lines or open jobs. Read them with one query each.
7. Add the state, label and milestone functions:
   - `getProjectStates(client, projectId, companyId)` ordered by `sortOrder`;
   - `upsertProjectState`;
   - `deleteProjectState`, refusing when an element uses the state or when it is the last state of its group;
   - `getProjectLabels`, `upsertProjectLabel`, `deleteProjectLabel`;
   - `getProjectMilestones`, `upsertProjectMilestone`, `deleteProjectMilestone`.
8. Add a doc comment with an `@mcp` tag to each read and write function. Leave the tag off `createProject` (it needs `db`).
9. Write `apps/erp/test/projects-identifier.test.ts` with 4 cases:

| Input | Expected |
|---|---|
| `"Star Tracker"` | `"ST"` |
| `"next-gen sensor"` | `"NS"` (words split on whitespace only) |
| `"9 axis gimbal"` | `"P9AG"` |
| `"a"` | `"AX"` |

10. Split words on whitespace only, in both `suggestProjectIdentifier` and `derive_project_identifier`. Both must give the same result for these 4 inputs.

**Verify:**
```bash
pnpm --filter erp test -- projects-identifier
# Expected: 4 passed
pnpm exec turbo run typecheck --filter=erp
# Expected: exit code 0 (callers of the moved functions are fixed in Task 26; if typecheck fails only on those imports, continue)
```

**Out of scope:** element functions (Task 13).

---

## Task 13: Add the element service functions

**Depends on:** 11
**Files:**
- Modify: `apps/erp/app/modules/projects/projects.service.ts`
- Modify: `apps/erp/app/modules/projects/projects.server.ts`
- Create: `apps/erp/test/projects-element-tree.test.ts`
- Copy from (precedent): `getNextSerialNumbers` in `packages/database/src/sequence.ts` (lines 144–188); `accountsToFlatTree` in `apps/erp/app/modules/accounting/ui/ChartOfAccounts/ChartOfAccountsTree.tsx` (lines 50–86)

**Steps:**
1. Add `insertProjectElement(db, args)` to `projects.server.ts`. In one Kysely transaction:
   1. Run `UPDATE "project" SET "nextElementSequence" = "nextElementSequence" + 1 WHERE "id" = :projectId AND "companyId" = :companyId RETURNING "nextElementSequence" - 1 AS seq, "identifier"`.
   2. If `identifier` is NULL, set it with `derive_project_identifier` in the same transaction.
   3. If `stateId` is empty, use the project's default Unstarted state.
   4. If `isChargeable` is not given, use `chargeableByDefault[type]`.
   5. Insert the element with `sequence = seq` and `readableId = identifier || '-' || seq`.
   6. Set `sortOrder` to the largest `sortOrder` among its siblings plus 1.
2. If the parent is a Parameter, refuse the insert.
3. Add `getProjectElements(client, projectId, companyId, filters)`. Select every element of the project with its state (`name`, `group`, `color`) and label ids, in one query. Filters are `type[]`, `stateGroup[]`, `ownerId[]`, `milestoneId[]`, `labelId[]` and `search`. Use `fetchAllFromTable` or `.range()` paging, because a project can have more than 1000 elements.
4. Add a pure function `buildElementTree(elements)` in `projects.models.ts`. It returns a depth-first list of `{ id, parentId, level, children: string[], hasChildren, data }`, in the `FlatTreeItem` shape of `apps/erp/app/components/TreeView`. It orders siblings by `sortOrder`. A child whose parent was filtered out shows at level 0.
5. Add `getProjectElement(client, id, companyId)`, with its state, owner, milestone, labels and parent (`readableId`, `name`).
6. Add `updateProjectElementField(client, { ids, field, value, companyId, updatedBy })`. It handles `name`, `stateId`, `ownerId`, `priority`, `milestoneId`, `startDate`, `targetDate`, `estimatedHours`, `budget`, `isChargeable`, `itemId` and `description`.
   - When `stateId` moves into the Completed group, set `completedAt` to now.
   - When it moves out of that group, clear `completedAt`.
7. Add `setProjectElementLabels(client, { projectElementId, labelIds, companyId, createdBy })`. It deletes the removed rows and inserts the new ones.
8. Add `moveProjectElement(db, { companyId, userId, projectId, elementId, parentId, sortOrder })`. In SQL, refuse a parent that is the element itself or one of its descendants (a recursive CTE). Then update `parentId` and `sortOrder`.
9. Add `updateProjectElementOrder(db, …)` with `updateSortOrder` (`apps/erp/app/modules/shared/sort-order.ts`), parent `{ column: "projectId", id: projectId }`.
10. Add `deleteProjectElement(client, id, companyId)`. Refuse when the element or a descendant has a `projectLedger` row, a `timesheetEntry`, a `job` or a `purchaseOrderLine`. Check with 4 queries that use `.in()` over the subtree ids.
11. Add `getProjectElementComments`, `insertProjectElementComment` and `deleteProjectElementComment`.
12. Add the plan-line functions: `getProjectElementPlanLines(client, elementId, companyId)` (3 queries), and `upsert`/`delete` for `projectElementMaterial`, `projectElementLabor` and `projectElementCost`.
13. Add `startElementOnFirstCharge(db, { companyId, projectElementId })` in `projects.server.ts`. If the element's state is in the Unstarted group, move it to the project's default Started state. Tasks 16 and 17 call it.
14. Write `apps/erp/test/projects-element-tree.test.ts` with 3 cases for `buildElementTree`:
    1. Three levels: levels are 0, 1 and 2, in depth-first order.
    2. Siblings with `sortOrder` 2 and 1: the second sibling comes first.
    3. A child whose parent is not in the input: it shows at level 0.

**Verify:**
```bash
pnpm --filter erp test -- projects-element-tree
# Expected: 3 passed
pnpm exec turbo run typecheck --filter=erp
# Expected: no new errors in modules/projects
```

**Out of scope:** trace links and verification (Phase 1b).

---

## Task 14: Add the time, labor category and ledger service functions

**Depends on:** 11
**Files:**
- Modify: `apps/erp/app/modules/projects/projects.service.ts`
- Modify: `apps/erp/app/modules/projects/projects.server.ts`
- Create: `apps/erp/test/projects-timesheet-week.test.ts`
- Copy from (precedent): `apps/mes/app/routes/x+/timecard.tsx` (the loader's week bounds); `datetime.weekBounds` in `packages/utils/src/datetime.ts` line 65

**Steps:**
1. Add `getLaborCategories(client, companyId, args)`, `getLaborCategoriesList(client, companyId)`, `upsertLaborCategory`, and `upsertLaborCategoryRate`.
2. Add `getLaborCategoryRates(client, laborCategoryId, companyId)`, ordered by `effectiveFrom` descending.
3. Add a pure function `rateOn(rates, date)` in `projects.models.ts`. It returns the rate with the latest `effectiveFrom` on or before `date`, else null. It compares `YYYY-MM-DD` strings.
4. Add `getTimesheetWeek(client, { companyId, employeeId, from, to })`. It returns the entries in the date range with project identifier, element readable id and name, and labor category name.
5. Add a pure function `groupTimesheetRows(entries)` in `projects.models.ts`. It returns one row per (projectId, projectElementId, laborCategoryId), with a map of date → `{ entryId, hours, status }` and a row total.
6. Add `upsertTimesheetCell(client, args)`:
   - If a Draft entry exists for (employee, date, project, element, category), update its hours.
   - If `hours` is 0, delete the Draft entry.
   - Otherwise insert a Draft entry.
   - Refuse to change an entry that is not Draft.
7. Add `submitTimesheetEntries(db, { companyId, employeeId, from, to, userId })`. It sets the employee's Draft entries in the range to `Submitted`, stamps `submittedAt`, and returns their ids.
8. Add `rejectTimesheetEntries(client, { ids, companyId, note, updatedBy })`. It sets `Rejected` and `rejectionNote` on Submitted entries.
9. Add `createTimesheetCorrection(db, { companyId, userId, timesheetEntryId, hours, correctionReason })`. On a Posted entry, in one transaction:
   1. Insert a reversal: same fields, `hours` = −original, `reversalOfId` = original, `correctionReason`, status `Submitted`.
   2. If the new `hours` is not 0, insert a replacement with `hours`, `correctionReason`, status `Submitted`.
   3. Return both ids.
10. Add `getTimesheetApprovals(client, companyId, args)`. It returns Submitted entries grouped by employee and week. Filter by projects where the current user is the owner, unless the user has `projects_update` on the company.
11. Add `getProjectLedger(client, companyId, args)`. Filters are `projectId`, `projectElementIds` and `costType`, with `setGenericQueryFilters`.
12. Add `getProjectCostSummary(client, projectId, companyId)`. It calls `client.rpc("get_project_cost_summary", { p_project_id, p_company_id })`.
13. Add a pure function `rollUpCostSummary(tree, rows)` in `projects.models.ts`. It sums plan, committed, actual and hours from descendants into each ancestor, plus each element's own row. It returns a map by element id and a project total that includes the NULL row.
14. Write `apps/erp/test/projects-timesheet-week.test.ts` with these cases:
    1. `rateOn` picks the 2026-01-01 rate for 2026-03-15 when the rates start on 2025-06-01 and 2026-01-01.
    2. `rateOn` returns null before the first rate.
    3. `groupTimesheetRows` makes one row from 3 entries on the same charge number and category, with total = the sum.
    4. `rollUpCostSummary` gives a parent the sum of its own row and its two children.

**Verify:**
```bash
pnpm --filter erp test -- projects-timesheet-week
# Expected: 4 passed
```

**Out of scope:** posting (Task 16).

---

## Task 15: Add the pure project posting helpers and tests

**Depends on:** 7
**Files:**
- Create: `packages/server-functions/src/lib/project-posting.ts`
- Create: `packages/server-functions/src/lib/project-posting.test.ts`
- Copy from (precedent): `packages/server-functions/src/post-maintenance-event/plan.ts` and `plan.test.ts`

**Steps:**
1. Export these types:

```ts
export type ProjectCostTreatment = Database["public"]["Enums"]["projectCostTreatment"];
export type ProjectStateGroup = Database["public"]["Enums"]["projectStateGroup"];
export type ProjectPostingProject = {
  id: string; status: Database["public"]["Enums"]["projectStatus"];
  costTreatment: ProjectCostTreatment; costAccountId: string | null;
};
export type ProjectPostingElement = {
  id: string; parentId: string | null; isChargeable: boolean; stateGroup: ProjectStateGroup;
  costTreatment: ProjectCostTreatment | null; costTreatmentEffectiveFrom: string | null; costAccountId: string | null;
};
export type ProjectPostingContext = {
  project: ProjectPostingProject;
  element: ProjectPostingElement | null;
  ancestors: ProjectPostingElement[];   // nearest parent first
  defaults: { projectExpenseAccount: string | null; projectWorkInProgressAccount: string | null };
};
export class ProjectChargeError extends Error {}
```

2. Export `resolveProjectPostingAccount(ctx, postingDate: string): { treatment: ProjectCostTreatment; accountId: string | null }`:
   1. Walk `[element, ...ancestors]`. Take the first one whose `costTreatment` is set and whose `costTreatmentEffectiveFrom` is null or `<= postingDate`.
   2. If none, use the project's treatment and `costAccountId`.
   3. Statistical → `accountId: null`.
   4. An explicit account → that account.
   5. Expense → `defaults.projectExpenseAccount`. Contract → `defaults.projectWorkInProgressAccount`.
   6. Capitalize → throw `ProjectChargeError("The Capitalize treatment is not available yet")`.
   7. If the resolved account is null, throw `ProjectChargeError` naming the missing default ("Set Project Expense in Account Defaults").
3. Export `assertChargeable(ctx, mode: "new" | "commitment")`:
   - `new`: the project status must be `Released`. The element, if present, must have `isChargeable` true and a state group of Unstarted or Started.
   - `commitment`: the project status must be `Released`, `On Hold` or `Technically Complete`. The element must not be in Backlog or Cancelled.
   - On failure, throw `ProjectChargeError` with a sentence that names the project and the rule.
4. Export `buildProjectLedgerRow(args)`. It returns an `Insertable<DB["projectLedger"]>` with `amount` rounded by `round()` from `@carbon/utils`.
5. Export `loadProjectPostingContexts(trx, companyId, refs: { projectId: string; projectElementId: string | null }[])`. It uses 3 queries in total, never one per ref:
   1. The projects, with `.where("id", "in", …)`.
   2. The elements with their ancestors, with a recursive CTE over all requested element ids, joined to `projectState` for the group.
   3. `accountDefault` for the company.

   It returns `Map<string, ProjectPostingContext>`, keyed by `projectId + "\x1f" + (projectElementId ?? "")`.
6. Write `project-posting.test.ts` with at least these 8 cases:
   1. Expense project, no element: returns `projectExpenseAccount`.
   2. Contract project: returns `projectWorkInProgressAccount`.
   3. Statistical project: returns `accountId: null`.
   4. An ancestor override to Contract, effective from 2026-03-01: posting date 2026-02-28 gives the project treatment; 2026-03-01 gives Contract.
   5. An explicit `costAccountId` on the element wins over the defaults.
   6. A missing default throws `ProjectChargeError`.
   7. `assertChargeable("new")` throws for a Draft project, for an element in Backlog, and for a non-chargeable element.
   8. `assertChargeable("commitment")` passes for a Completed element of an On Hold project, and throws for a Cancelled element.

**Verify:**
```bash
pnpm --filter @carbon/server-functions test -- project-posting
# Expected: at least 8 passed
```

**Out of scope:** CIP accounts (Phase 1b).

---

## Task 16: Add the `post-timesheet` server function

**Depends on:** 15
**Files:**
- Create: `packages/server-functions/src/post-timesheet/index.ts`
- Create: `packages/server-functions/src/post-timesheet/plan.ts`
- Create: `packages/server-functions/src/post-timesheet/plan.test.ts`
- Create: `packages/server-functions/src/post-timesheet/post-timesheet.test.ts`
- Modify: `packages/server-functions/src/invoke.ts` — add `"post-timesheet": () => import("./post-timesheet")` to `registry`
- Modify: `packages/database/src/utils.ts` — add `timesheet: (entryId: string) => …` to `journalReference.to` (lines 31–42)
- Copy from (precedent): `packages/server-functions/src/post-maintenance-event/index.ts` and `plan.ts`; `post-charge/post-charge-test-fixture.ts` for the database test

**Steps:**
1. Input: `{ timesheetEntryIds: string[] }`. Permissions: `{ update: "projects" }`. The ERP calls it with `serverFns.system(...)` after its own permission check (Tasks 36 and 39).
2. In `run`, in one transaction:
   1. Lock the entries with `.forUpdate()`. Keep entries with status `Submitted` or `Approved` and no `postedAt`.
   2. Load the posting contexts with `loadProjectPostingContexts` (one call).
   3. Load the labor category rates for all categories (one query). Pick each entry's rate with the same rule as `rateOn` (Task 14).
   4. For each entry, call `assertChargeable(ctx, entry.reversalOfId ? "commitment" : "new")`.
   5. Compute the cost:
      - a reversal uses the original entry's `costRate` (load the originals in one query);
      - any other entry uses `hours × rate`, rounded with `round()`.
   6. Resolve the account with `resolveProjectPostingAccount(ctx, entry.entryDate)`.
   7. If the treatment is Statistical, write no journal and no ledger row. Only stamp the entry Posted.
   8. If `companySettings.accountingEnabled`:
      1. Resolve the accounting period with `resolveAccountingPeriod(trx, companyId, entry.entryDate, "current")`.
      2. Create one journal for the call, with `sourceType: "Timesheet"`.
      3. Insert Dr project account / Cr `laborAbsorptionAccount`, with `documentType: "Timesheet"`, `documentId: entry.id` and `documentLineReference: journalReference.to.timesheet(entry.id)`.
      4. Tag the lines with the Project, ProjectElement and Employee dimensions.
   9. Insert one `projectLedger` row per entry with `buildProjectLedgerRow`: `costType: "Labor"`, `documentType: "Timesheet"`, `documentId: entry.id`, `employeeId`, `laborCategoryId`, `quantity: hours`, `unitOfMeasureCode: "HR"`, `amount: cost`, and `journalLineId` (the debit line) or null.
      - For a reversal, set `reversalOfId` to the original entry's ledger row.
   10. Stamp each entry: `status: "Posted"`, `costRate`, `journalId`, `postedAt`.
   11. Call the logic of `startElementOnFirstCharge` (Task 13) in SQL on the same transaction, for each distinct element. If the element's state group is Unstarted, set the project's default Started state.
3. 🛑 Use `inOrder` for sequential work inside the transaction. Do not use `Promise.all` (`packages/server-functions/AGENTS.md`).
4. Put the pure part in `plan.ts`: `planTimesheetPosting(entries, contexts, rates, originals) → { lines, ledgerRows, stamps }`. Test it in `plan.test.ts` with 3 cases:
   1. One entry of 6 h at 85.00 on an Expense project gives a 510.00 debit to the expense account and a 510.00 credit to labor absorption.
   2. A reversal of that entry gives −510.00 at the original rate, even when today's rate is 90.00.
   3. A Statistical project gives no lines and no ledger rows.
5. Write `post-timesheet.test.ts` with `databaseTest` from `local-database-test-fixture.ts`. Cover one Submitted entry on an Expense project: after the call, a journal with two lines exists, one `projectLedger` row exists, and the entry is Posted.
6. Run `pnpm --filter @carbon/server-functions test -- -u` to add the permissions snapshot. Read the snapshot diff: it must add only `post-timesheet`.

**Verify:**
```bash
pnpm --filter @carbon/server-functions test -- post-timesheet permissions-manifest
# Expected: all tests pass (the database test runs only with a local database)
pnpm exec turbo run typecheck --filter=@carbon/server-functions --concurrency=1
# Expected: exit code 0
```

**Out of scope:** approval routing (Task 39). The function posts what it is given.

---

## Task 17: Add the `post-project-issue` server function

**Depends on:** 15
**Files:**
- Create: `packages/server-functions/src/post-project-issue/index.ts`
- Create: `packages/server-functions/src/post-project-issue/post-project-issue.test.ts`
- Modify: `packages/server-functions/src/invoke.ts` — register `post-project-issue`
- Modify: `packages/server-functions/src/lib/plan-adjustment.ts` — add `"Project Issue"` to `JOURNAL_LINE_SAFE_DOCUMENT_TYPES` (lines 34–48)
- Modify: `packages/server-functions/src/lib/post-adjustment.ts` — only if step 3 needs it
- Modify: `packages/database/src/utils.ts` — add `projectIssue: (id: string) => …` to `journalReference.to`
- Copy from (precedent): `packages/server-functions/src/post-inventory-adjustment/index.ts` (lines 254–455 and 1141–1150)

**Steps:**
1. Input: `projectIssueValidator` fields from Task 11 (`projectId`, `projectElementId`, `itemId`, `locationId`, `storageUnitId`, `trackedEntityId`, `quantity`, `direction`). Permissions: `{ update: "inventory" }`. The ERP route also checks `update: "projects"` (Task 36).
2. In `run`:
   1. Call `assertCompanyRecords` for `project`, `item` and `location`.
   2. Load the posting context. Call `assertChargeable(ctx, "new")` for an Issue and `assertChargeable(ctx, "commitment")` for a Return.
   3. Resolve the account. For Statistical, use `accountDefaults.indirectCostAccount` and write no `projectLedger` row.
   4. Call `bookAdjustment(trx, …)` as `post-inventory-adjustment` does:
      - quantity: negative for Issue, positive for Return;
      - itemLedger `entryType`: `Negative Adjmt.` or `Positive Adjmt.`;
      - itemLedger `documentType: "Project Issue"`, `documentId: projectId`;
      - `accounting.offsetAccount`: the resolved account;
      - `accounting.sourceType: "Project Issue"`;
      - `extraDimensions`: `{ entityType: "Project", valueId: projectId }`, and `{ entityType: "ProjectElement", valueId: projectElementId }` when present.
   5. Read the movement's total cost from the `bookAdjustment` result. Insert one `projectLedger` row: `costType: "Material"`, `documentType: "Project Issue"`, `documentId: itemLedgerId`, `itemId`, `quantity` (positive for Issue, negative for Return), `amount` (positive for Issue, negative for Return).
   6. If `projectElementId` is set and the element has a `projectElementMaterial` line for the item, update its `quantityIssued` by ± quantity.
   7. Run the first-charge state change, as Task 16 step 2.11 does.
3. If `bookAdjustment` does not return the movement's cost, add a `cost` field to its return value. Add the field only; do not change any other return field. If its structure makes this impossible, STOP and report.
4. A Return values the stock at the item's current cost (the `bookAdjustment` increase rule). The ledger row uses that same cost, so the project total stays equal to the GL. This replaces the spec's "original cost" wording for v1; Task 46 records it in the spec.
5. Write `post-project-issue.test.ts` with `databaseTest`:
   1. Issue 5 units of a FIFO item at 10.00 to an Expense project. Expect itemLedger −5, `costLedger` consumption 50.00, a journal Dr expense 50.00 / Cr inventory 50.00, and `projectLedger` 50.00.
   2. Return 2 units. Expect `projectLedger` −20.00 (with a FIFO current cost of 10.00).
6. Update the permissions snapshot (`-u`) and review it, as in Task 16.

**Verify:**
```bash
pnpm --filter @carbon/server-functions test -- post-project-issue permissions-manifest plan-adjustment
# Expected: all tests pass
```

**Out of scope:** the Inventory → Issue to Project menu entry (Task 36 adds the route).

---

## Task 18: Route job material issues to the project account

**Depends on:** 15, 24
**Files:**
- Modify: `packages/server-functions/src/issue/index.ts`
- Create: `packages/server-functions/src/issue/project-issue.test.ts`

**Steps:**
1. In `loadConsumeAccountingContext` (lines 1120–1166), also load the job's `projectId`, `projectElementId` and `consumeToProject`. Add `"Project"` and `"ProjectElement"` to the dimension lookup.
2. When the job has `consumeToProject = true`:
   1. Load the posting context with `loadProjectPostingContexts`, then call `assertChargeable(ctx, "commitment")`.
   2. Resolve the account. Statistical cannot have `consumeToProject` (Task 41 refuses it). If you see Statistical here, throw `ProjectChargeError`.
   3. In `issueJobOperationMaterials`, replace `accountDefaults.data.workInProgressAccount` at line 454 with the project account.
   4. In the three `createMaterialWipEntries` callers (lines 1867, 3358 and 4598), pass the project account as `wipAccount`.
   5. Tag the debit lines with Project and ProjectElement.
   6. After each consumption, insert one `projectLedger` row: `costType: "Material"`, `documentType: "Job Consumption"`, `documentId: jobId`, `jobId`, `itemId`, `quantity`, `amount` = the COGS total.
   7. On an un-consume (credit), insert a negative row.
3. Write the ledger row wherever the cost is computed, even when `accountingEnabled` is false.
4. Leave every path for jobs without `consumeToProject` unchanged.
5. Write `project-issue.test.ts` with `databaseTest`. A consume-to-project job on an Expense project issues 3 units at 10.00. Expect one journal line Dr expense 30.00 and no line on the WIP account for that job. Expect one `projectLedger` Material row of 30.00.

**Verify:**
```bash
pnpm --filter @carbon/server-functions test -- issue
# Expected: all tests pass, including the existing issue tests
```

**Out of scope:** scrap paths (lines 2931 and 3724). They credit WIP and stay unchanged.

---

## Task 19: Route production events to the project account

**Depends on:** 15, 24
**Files:**
- Modify: `packages/server-functions/src/post-production-event/index.ts`
- Create: `packages/server-functions/src/post-production-event/project-event.test.ts`

**Steps:**
1. Load the job's `projectId`, `projectElementId` and `consumeToProject` with the job.
2. When `consumeToProject` is true:
   1. Load the context, then call `assertChargeable(ctx, "commitment")`.
   2. Resolve the account.
   3. Replace the debit at line 317 (labor or machine) and line 343 (overhead) with the project account.
   4. Tag the lines with Project and ProjectElement.
3. Insert `projectLedger` rows for the net change, in the same transaction:
   - `costType` is `Labor` or `Machine` from the event type, and `Overhead` for the overhead line;
   - `documentType: "Production Event"`, `documentId: productionEvent.id`, `jobId`, `employeeId`, `quantity` = hours.
4. On a repost, the function already reverses prior lines by `documentLineReference` (lines 203–214). Mirror that: insert negative `projectLedger` rows that equal the prior rows of the same `documentId` and `costType`, with `reversalOfId` set. Then insert the new rows.
5. Write `project-event.test.ts` with `databaseTest`: a 2 h labor event on a consume-to-project job at work center rate 50.00 gives Dr project 100.00 and a `projectLedger` Labor row of 100.00. Editing the event to 3 h gives a −100.00 row and a 150.00 row.

**Verify:**
```bash
pnpm --filter @carbon/server-functions test -- post-production-event
# Expected: all tests pass
```

**Out of scope:** events of jobs without `consumeToProject`.

---

## Task 20: Change job completion for consume-to-project jobs

**Depends on:** 6, 15
**Files:**
- Create: `packages/database/supabase/migrations/<timestamp>_complete-job-consume-to-project.sql`
- Modify: `packages/server-functions/src/close-job/index.ts` — only if step 5 finds a zero-amount journal
- Copy from (precedent): the latest `complete_job_to_inventory` in `packages/database/supabase/migrations/20261006221601_complete-job-to-asset.sql` (line 13)

**Steps:**
1. Run `pnpm db:migrate:new complete-job-consume-to-project`.
2. Copy the latest full definition of `complete_job_to_inventory` into the new file, unchanged.
3. Add `v_consume_to_project BOOLEAN` and `v_project_account TEXT` to its declarations. Read `consumeToProject`, `projectId` and `projectElementId` with the job.
4. When `v_consume_to_project` is true, change four things:
   1. Before the catch-up blocks (about lines 741 and 805), set `v_project_account := project_posting_account(companyId, projectId, projectElementId, <the function's posting date>)`. Use the project account in place of `v_wip_account` for the catch-up debits.
   2. Skip the WIP discharge (lines 956–983).
   3. Skip the `costLedger` Output insert (lines 987–999).
   4. Skip the `itemLedger` receipt insert, while still updating the job's completed quantities exactly as the Non-Inventory path does.
5. Read `close-job/index.ts` lines 66–143. If it skips a WIP balance of 0, change nothing. If it would post a zero-amount journal, add `if (wipBalance === 0) return` before the journal insert.
6. If the function's blocks do not match the line references and the descriptions above, STOP and report.
7. Run `pnpm db:migrate`, then `pnpm run generate:types`.
8. Add a `databaseTest` in `packages/server-functions/src/issue/project-issue.test.ts` that completes the consume-to-project job from Task 18. Expect no `itemLedger` row with `documentType` `Job Receipt` for the job, and no journal line on the WIP account for the job.

**Verify:**
```bash
pnpm --filter @carbon/server-functions test -- project-issue
# Expected: all tests pass
```

**Out of scope:** the Make to Asset branch of the function.

---

## Task 21: Route PO receipts to the project account

**Depends on:** 15, 24
**Files:**
- Modify: `packages/server-functions/src/post-receipt/index.ts`
- Create: `packages/server-functions/src/post-receipt/project-receipt.test.ts`

**Steps:**
1. Load `projectId`, `projectElementId` and the job's `consumeToProject` for each PO line of the receipt. Use the existing PO-line load (no extra query per line). Load the posting contexts once.
2. In the debit choice (lines 1606–1628), add these branches before the existing ones:
   1. Outside processing whose job has `consumeToProject`: the job's project account.
   2. A line with `projectId` whose item is `Non-Inventory`, and the project is not Statistical: the project account.
   3. A line with `projectId` whose item is inventory, and the project is not Statistical: **consume at receipt**. The debit is the project account. Write the normal `Positive Adjmt.` itemLedger row and then a `Negative Adjmt.` row with `documentType: "Project Issue"` and the same quantity, so on-hand does not change. Skip the `costLedger` layer for this line, because nothing stays in stock.
3. For each branch, call `assertChargeable(ctx, "commitment")`.
4. Insert one `projectLedger` row per line: `costType` is `Outside Processing` (branch 1), `Purchased Service` (branch 2) or `Material` (branch 3). Use `documentType: "Purchase Receipt"`, `documentId: receiptId`, `documentLineId: receiptLineId` and `supplierId`. A negative receipt writes a negative row.
5. Tag the debit lines with Project and ProjectElement.
6. If skipping the `costLedger` layer in branch 3 breaks the receipt's later invoice matching (PPV), STOP and report.
7. Write `project-receipt.test.ts` with `databaseTest` for branches 2 and 3. Branch 3 must leave `itemStockQuantities` unchanged for the item.

**Verify:**
```bash
pnpm --filter @carbon/server-functions test -- post-receipt
# Expected: all tests pass
```

**Out of scope:** project stock (Phase 2).

---

## Task 22: Route purchase invoice lines to the project account

**Depends on:** 15, 24
**Files:**
- Modify: `packages/server-functions/src/post-purchase-invoice/index.ts`
- Modify: the code that creates `purchaseInvoiceLine` rows from `purchaseOrderLine` rows (find it with `grep -rn "purchaseInvoiceLine" packages/server-functions/src/convert apps/erp/app/modules/invoicing`)
- Create: `packages/server-functions/src/post-purchase-invoice/project-invoice.test.ts`

**Steps:**
1. Where purchase invoice lines are created from PO lines, copy `projectId` and `projectElementId` from the PO line.
2. In `post-purchase-invoice`, load the posting contexts for all lines with a `projectId` in one call.
3. Override the debit for a non-Statistical project in these paths:
   1. `G/L Account` (line 1995): the project account in place of `account.data.id`.
   2. Service accrual (line 1562): the project account in place of `indirectCostAccount`.
   3. Direct invoice with no PO (lines 1077–1092): the project account in place of `indirectCostAccount` or `workInProgressAccount` for `Non-Inventory` and G/L lines.
4. For each overridden line, call `assertChargeable(ctx, "commitment")`. Insert one `projectLedger` row: `costType` `Purchased Service` for Service lines, else `Other Direct`. Use `documentType: "Purchase Invoice"`, `documentId: invoiceId` and `documentLineId: invoiceLineId`.
5. Do not write a ledger row for a line whose receipt already wrote one (Task 21). The invoice then writes only the price variance:
   1. If the PPV posts to a project-routed line, insert a `Material Variance` row with the PPV amount.
   2. If the PPV goes to `purchaseVarianceAccount`, write no row.
6. Add ProjectElement next to the inline Project tag (line 2291).
7. Write `project-invoice.test.ts` with `databaseTest`: a G/L Account line of 200.00 charged to an Expense project debits the expense account (not the line's account) and writes a 200.00 `projectLedger` row.

**Verify:**
```bash
pnpm --filter @carbon/server-functions test -- post-purchase-invoice
# Expected: all tests pass
```

**Out of scope:** Statistical projects. They keep today's behavior: line account plus Project tag.

---

## Task 23: Route charges and reimbursements to the project account

**Depends on:** 15, 24
**Files:**
- Modify: `packages/server-functions/src/post-charge/build-charge-journal.ts`, `post-charge/post-charge-post.ts`
- Modify: `packages/server-functions/src/post-reimbursement/build-reimbursement-journal.ts`, `post-reimbursement/post-reimbursement-post.ts`
- Modify: the existing test fixtures only to add cases

**Steps:**
1. In `post-charge-post.ts`, after the project validation (lines 130–145), load the posting contexts for the lines' projects in one call.
2. In `build-charge-journal.ts` (lines 207–212), use the project account in place of `line.accountId` when the line's project is not Statistical. Call `assertChargeable(ctx, "commitment")` for those lines.
3. Insert one `projectLedger` row per such line: `costType: "Other Direct"`, `documentType: "Charge"`, `documentId: chargeId`, `documentLineId: lineId`. Refund and credit lines write negative rows.
4. Do the same for reimbursements: lines 183–188 of `build-reimbursement-journal.ts`, with `documentType: "Reimbursement"`.
5. Add one `databaseTest` case to the existing charge and reimbursement test files: a line on an Expense project debits the project expense account and writes a ledger row.

**Verify:**
```bash
pnpm --filter @carbon/server-functions test -- post-charge post-reimbursement
# Expected: all tests pass
```

**Out of scope:** the Ramp sync. It still writes `projectId` only.

---

## Task 24: Add Project and Project Element to the journal dimension builder

**Depends on:** 7
**Files:**
- Modify: `packages/utils/src/journal-dimensions.ts`
- Modify: its test file if one exists (`ls packages/utils/src | grep journal-dimensions`)

**Steps:**
1. Add `projectId` and `projectElementId` to `JournalDimensionMeta` (lines 15–26).
2. Add `["Project", "projectId"]` and `["ProjectElement", "projectElementId"]` to `DIMENSION_FIELDS`.
3. If a test file exists, add a case: meta with both ids and a map that has both dimensions gives two inserts.

**Verify:**
```bash
pnpm --filter @carbon/utils test
# Expected: all tests pass
pnpm exec turbo run typecheck --filter=@carbon/utils
# Expected: exit code 0
```

**Out of scope:** changing the posters that write the Project tag inline today. Tasks 18–23 change only their own paths.

---

## Task 25: Add the new enum values to the TS mirrors

**Depends on:** 7
**Files:**
- Modify: `packages/ee/src/accounting/core/models.ts` — `POSTING_POLICY` (line 425): add `Timesheet` and `Project Issue`, copying the policy of `Maintenance Event` (line 523)
- Modify: `packages/ee/src/accounting/core/posting-policy.test.ts` (lines 70–82) — add both to the sorted list if `Maintenance Event` is in it
- Modify: `apps/erp/app/modules/accounting/accounting.models.ts` — `journalEntrySourceTypes` (lines 747–777); `dimensionEntityTypes` (lines 877–894): add `ProjectElement`
- Modify: `apps/erp/app/components/Icons.tsx` — `JournalEntrySourceTypeIcon` (about line 643): add both values
- Modify: `apps/erp/app/modules/accounting/accounting.service.ts` — `getJournalEntryRelatedItems` (about line 5914): map `Timesheet` to the project time page and `Project Issue` to the project
- Modify: `apps/erp/app/modules/accounting/ui/JournalEntries/JournalEntryDocuments.tsx` (lines 80–100)
- Modify: `apps/erp/app/modules/inventory/inventory.models.ts` — `itemLedgerDocumentTypes` (lines 45–69): add `Project Issue`
- Modify: `apps/erp/app/modules/inventory/ui/Inventory/InventoryActivity.tsx` (about line 190): add `Project Issue` text
- Modify: `apps/erp/app/modules/accounting/accounting.service.ts` — `getEntityDimensionValues` (line 4899) and `getEntityValuesByIds` (line 5036): add `case "ProjectElement"` that reads `projectElement` (`readableId` + `name`)
- Modify: `packages/ee/src/accounting/core/dimension-mapping.ts` — `DIMENSION_LABEL_SOURCES` (line 515): add `ProjectElement`

**Steps:**
1. Make each change listed above.
2. Use the `Maintenance Event` handling as the precedent in each file.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/ee --filter=erp
# Expected: exit code 0
pnpm --filter @carbon/ee test -- posting-policy
# Expected: all tests pass
```

**Out of scope:** accounting provider sync mappings beyond `POSTING_POLICY`.

---

## Task 26: Move the accounting Projects screens into the new module

**Depends on:** 12, 27
**Files:**
- Delete: `apps/erp/app/routes/x+/accounting+/projects.new.tsx`, `projects.$projectId.tsx`, `projects.delete.$projectId.tsx`
- Modify: `apps/erp/app/routes/x+/accounting+/projects.tsx` — replace with a loader that redirects to `path.to.projects`
- Move: `apps/erp/app/modules/accounting/ui/Projects/ProjectsTable.tsx` and `ProjectForm.tsx` to `apps/erp/app/modules/projects/ui/Projects/`
- Delete: `apps/erp/app/modules/accounting/ui/Projects/index.tsx` (after moving its exports)
- Modify: `apps/erp/app/modules/accounting/ui/useAccountingSubmodules.tsx` — remove the Projects entry (lines 172–177)
- Modify: `apps/erp/app/modules/accounting/accounting.models.ts` — remove `projectValidator` (lines 638–642)
- Modify: `apps/erp/app/modules/accounting/types.ts` — remove `Project` (lines 22, 408–410); import it from `~/modules/projects` where used
- Move: `apps/erp/app/modules/accounting/accounting.projects.test.ts` to `apps/erp/test/projects-validator.test.ts`, updating its import
- Modify: `apps/erp/app/modules/sales/ui/Contracts/ContractProject.tsx` — update its doc comment from "(Accounting → Projects)" to "(Projects)"
- Modify: `apps/erp/app/modules/accounting/AGENTS.md` (line 16) — say that projects now live in the projects module and remain a dimension

**Steps:**
1. Move the files. Change every `permissions.can(..., "accounting")` in them to `"projects"`.
2. Fix every import of the moved functions and components. Find them with `grep -rn "getProjects\|upsertProject\|deleteProject\|ProjectsTable\|ProjectForm" apps/erp/app`.
3. Keep `getEntityDimensionValues` and `getEntityValuesByIds` in accounting.

**Verify:**
```bash
grep -rn "accounting+/projects\|ui/Projects" apps/erp/app | grep -v "modules/projects"
# Expected: only the redirect route file
pnpm exec turbo run typecheck --filter=erp
# Expected: exit code 0
pnpm --filter erp test -- projects-validator
# Expected: all tests pass
```

**Out of scope:** the Ramp sync files. They read the `project` table and need no change.

---

## Task 27: Add module navigation, layout and paths

**Depends on:** 8
**Files:**
- Modify: `apps/erp/app/hooks/useModules.tsx` — add a Projects entry after Production
- Create: `apps/erp/app/modules/projects/ui/useProjectsSubmodules.tsx`
- Create: `apps/erp/app/routes/x+/projects+/_layout.tsx`
- Create: `apps/erp/app/routes/x+/project+/_layout.tsx`
- Modify: `apps/erp/app/utils/path.ts`
- Modify: `apps/erp/app/modules/settings/settings.models.ts` — `apiKeyPermissionModules` (lines 50–64): add `projects: ["view", "create", "update", "delete"]`
- Copy from (precedent): `apps/erp/app/modules/workflows/ui/useWorkflowsSubmodules.tsx`; `apps/erp/app/routes/x+/production+/_layout.tsx`; `apps/erp/app/routes/x+/job+/_layout.tsx`

**Steps:**
1. Add the module entry: `{ key: "projects", permission: "projects", name: t\`Projects\`, to: path.to.projects, icon: LuFolderKanban }`.
2. Write `useProjectsSubmodules` with two groups:
   - **Manage:** Projects (`path.to.projects`, table `project`), My Timesheet (`path.to.projectTimesheet`), Approvals (`path.to.projectTimesheetApprovals`, `setting: "timesheetApprovalRequired"`).
   - **Configure:** Labor Categories (`path.to.laborCategories`, role `employee`).
3. Copy the setting filter from `usePeopleSubmodules.tsx` (about line 75), so Approvals shows only when the setting is on.
4. Re-point the existing paths and add new ones in `path.ts`:

```ts
projects: `${x}/projects`,
newProject: `${x}/projects/new`,
project: (id: string) => generatePath(`${x}/project/${id}`),
projectDetails: (id: string) => generatePath(`${x}/project/${id}/details`),
projectElements: (id: string) => generatePath(`${x}/project/${id}/elements`),
projectElement: (id: string, elementId: string) => generatePath(`${x}/project/${id}/elements/${elementId}`),
projectElementFull: (id: string, elementId: string) => generatePath(`${x}/project/${id}/element/${elementId}`),
newProjectElement: (id: string) => generatePath(`${x}/project/${id}/elements/new`),
projectElementUpdate: (id: string) => generatePath(`${x}/project/${id}/elements/update`),
projectElementMove: (id: string) => generatePath(`${x}/project/${id}/elements/move`),
projectElementComments: (id: string, elementId: string) => generatePath(`${x}/project/${id}/elements/${elementId}/comments`),
projectElementPlan: (id: string, elementId: string) => generatePath(`${x}/project/${id}/elements/${elementId}/plan`),
deleteProjectElement: (id: string, elementId: string) => generatePath(`${x}/project/${id}/elements/${elementId}/delete`),
projectMilestones: (id: string) => generatePath(`${x}/project/${id}/milestones`),
projectCosts: (id: string) => generatePath(`${x}/project/${id}/costs`),
projectTime: (id: string) => generatePath(`${x}/project/${id}/time`),
projectSettings: (id: string) => generatePath(`${x}/project/${id}/settings`),
projectStatus: (id: string) => generatePath(`${x}/project/${id}/status`),
projectIssue: `${x}/projects/issue`,
projectLogTime: `${x}/projects/log-time`,
projectTimesheet: `${x}/projects/timesheet`,
projectTimesheetApprovals: `${x}/projects/approvals`,
laborCategories: `${x}/projects/labor-categories`,
newLaborCategory: `${x}/projects/labor-categories/new`,
laborCategory: (id: string) => generatePath(`${x}/projects/labor-categories/${id}`),
```

5. Delete the old `deleteProject` path (lines 906–907).
6. Add `api.projectChargeNumbers: \`${api}/projects/charge-numbers\`` and `api.laborCategories: \`${api}/projects/labor-categories\`` under `path.to.api`.
7. In `x+/projects+/_layout.tsx`, set `handle = { breadcrumb: msg\`Projects\`, to: path.to.projects, module: "projects", sidebar: ProjectsSidebar }`.
8. In `x+/project+/_layout.tsx`, set the same `module` and breadcrumb, with no sidebar.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exit code 0
```

**Out of scope:** the page routes (Tasks 28–39).

---

## Task 28: Build the project list and the new-project form

**Depends on:** 12, 27
**Files:**
- Create: `apps/erp/app/routes/x+/projects+/_index.tsx`
- Create: `apps/erp/app/routes/x+/projects+/new.tsx`
- Modify: `apps/erp/app/modules/projects/ui/Projects/ProjectsTable.tsx`
- Modify: `apps/erp/app/modules/projects/ui/Projects/ProjectForm.tsx`
- Copy from (precedent): `apps/erp/app/routes/x+/sales+/rmas.tsx` and `apps/erp/app/modules/production/ui/Jobs/JobsTable.tsx`

**Steps:**
1. The `_index.tsx` loader calls `requirePermissions(request, { view: "projects" })`, then `getGenericQueryFilters`, then `getProjects`.
2. Render `<VStack spacing={0} className="h-full"><ProjectsTable data count /><RecordOutlet /></VStack>`.
3. The table columns are:
   - identifier (a `Hyperlink` to `path.to.projectElements(id)`), name, status (`Status` with a color map), treatment, owner (`EmployeeAvatar`);
   - budget, actual, committed (from a `projects` list view or a second query keyed by the page's ids);
   - active.
4. Add static filters for status, treatment and owner. Keep CSV export on.
5. `new.tsx` renders `ProjectForm` in a drawer. Its action:
   1. Run `assertIsPost`.
   2. Run `requirePermissions(request, { create: "projects" })`.
   3. Validate with `projectValidator`.
   4. Call `createProject(getDatabaseClient(), …)`.
   5. Redirect to `path.to.projectElements(id)`.
6. `ProjectForm` fields:
   - name, and identifier (prefilled with `suggestProjectIdentifier(name)` until the user edits it);
   - description and treatment (Statistical, Expense, Contract);
   - cost account (`Account`), customer (`Customer`), owner (`Employee`), location (`Location`);
   - start date, end date and priority.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exit code 0
```

**Out of scope:** project templates (Phase 1b).

---

## Task 29: Build the project page shell and the Details tab

**Depends on:** 12, 27
**Files:**
- Create: `apps/erp/app/routes/x+/project+/$projectId.tsx`
- Create: `apps/erp/app/routes/x+/project+/$projectId._index.tsx`
- Create: `apps/erp/app/routes/x+/project+/$projectId.details.tsx`
- Create: `apps/erp/app/routes/x+/project+/$projectId.status.tsx`
- Create: `apps/erp/app/modules/projects/ui/Project/ProjectHeader.tsx`
- Create: `apps/erp/app/modules/projects/ui/Project/useProjectNavigation.tsx`
- Modify: `apps/erp/app/shortcuts.ts` — add `PROJECT_TAB_SHORTCUTS` if `DETAIL_TAB_SHORTCUTS` does not cover six tabs
- Copy from (precedent): `apps/erp/app/routes/x+/part+/$itemId.tsx`, `$itemId._index.tsx`, `apps/erp/app/modules/items/ui/Parts/usePartNavigation.tsx`, `PartHeader.tsx` (line 126, `DetailsTopbar`)

**Steps:**
1. The `$projectId.tsx` loader:
   1. Calls `requirePermissions(request, { view: "projects", bypassRls: true })`.
   2. Loads the project, its states, labels and milestones (4 queries in parallel), and checks `companyId`.
   3. Sets `handle.breadcrumb` with `detailBreadcrumb`, showing the identifier.
2. `$projectId._index.tsx` redirects to `path.to.projectElements(projectId)` with `redirectBeforeLoaders`.
3. `useProjectNavigation` returns these tabs: Elements, Milestones, Costs, Time & materials, Settings, Details.
4. `ProjectHeader` shows the identifier, name, status, treatment and owner, plus the tabs. It also shows the status actions:
   - **Release** (Draft → Released);
   - **Put on hold** (Released → On Hold);
   - **Resume** (On Hold → Released);
   - **Technically complete** (Released or On Hold → Technically Complete);
   - **Reopen** (Technically Complete → Released);
   - **Close** (Technically Complete → Closed).

   Each action posts to `path.to.projectStatus(id)`.
5. `$projectId.status.tsx` is action-only. It runs `requirePermissions(request, { update: "projects" })`, validates with `projectStatusValidator`, and calls `updateProjectStatus`. On a refused Close it flashes the reason.
6. `$projectId.details.tsx` renders `ProjectForm` with the project as initial values. Its action calls `updateProject`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exit code 0
```

**Out of scope:** the tab bodies other than Details.

---

## Task 30: Build the project Settings tab (states and labels)

**Depends on:** 12, 27
**Files:**
- Create: `apps/erp/app/routes/x+/project+/$projectId.settings.tsx`
- Create: `apps/erp/app/modules/projects/ui/Project/ProjectStates.tsx`
- Create: `apps/erp/app/modules/projects/ui/Project/ProjectLabels.tsx`
- Create: `apps/erp/app/modules/projects/ui/Project/StateIcon.tsx`
- Copy from (precedent): `apps/erp/app/components/Grid/Grid.tsx` usage in `CustomerParts.tsx`; `apps/erp/app/assets/icons/TodoStatusIcon.tsx`, `InProgressStatusIcon.tsx`

**Steps:**
1. `StateIcon` takes `group` and `color`. It renders a dashed circle for Backlog, a hollow circle for Unstarted, `InProgressStatusIcon` for Started, a filled check for Completed and a filled cross for Cancelled, all in `color`. Size is 14 px.
2. `ProjectStates` shows states grouped by state group. Each row has a `StateIcon`, the name, a color input, a default toggle and a delete button. A user can add a state to a group.
3. `ProjectLabels` shows labels with a color dot and name. A user can add, rename, recolor and delete labels.
4. The route action switches on `intent`: `upsertState`, `deleteState`, `upsertLabel`, `deleteLabel`. It requires `update: "projects"`. Show refusals (state in use, last state of a group) as an error flash.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exit code 0
```

**Out of scope:** project members. Phase 1a uses company permissions only.

---

## Task 31: Build the `ChargeNumberSelect` picker and its API route

**Depends on:** 13
**Files:**
- Create: `apps/erp/app/components/Form/ChargeNumber.tsx`
- Modify: `apps/erp/app/components/Form/index.ts` — export it
- Create: `apps/erp/app/routes/api+/projects.charge-numbers.ts`
- Modify: `apps/erp/app/modules/projects/projects.service.ts` — add `getChargeNumbers(client, companyId)`
- Copy from (precedent): `apps/erp/app/components/Form/Account.tsx` (`useLoaderQuery` + `Combobox`); `apps/erp/app/routes/api+/accounting.cost-centers.ts`

**Steps:**
1. `getChargeNumbers` uses 2 queries and returns two kinds of rows:
   - one row per Released project: value `projectId|`, label = identifier + name;
   - one row per chargeable element in an Unstarted or Started state of a Released project: value `projectId|elementId`, label = readable id + name, helper = project name.
2. If the company setting `requireProjectElement` is true, it leaves out the project-only rows.
3. The API route runs `requirePermissions(request, { role: "employee" })` and returns `{ data }`.
4. `ChargeNumber.tsx` exports:
   - `ChargeNumber`: a form field with two hidden inputs, `projectId` and `projectElementId`, that splits the selected value;
   - `useChargeNumbers()`: the loader query.

   Options use `keywords` = readable id + name + project name, so search works with JSX labels.
5. Show recent picks first. Keep the last 8 picks in `useLocalStorage("charge-numbers-recent")`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exit code 0
```

**Out of scope:** server-side search while typing. The full list loads once, as `Account.tsx` does.

---

## Task 32: Build the Elements page with the List layout

**Depends on:** 13, 29
**Files:**
- Create: `apps/erp/app/routes/x+/project+/$projectId.elements.tsx`
- Create: `apps/erp/app/routes/x+/project+/$projectId.elements.new.tsx`
- Create: `apps/erp/app/routes/x+/project+/$projectId.elements.update.tsx`
- Create: `apps/erp/app/routes/x+/project+/$projectId.elements.move.tsx`
- Create: `apps/erp/app/modules/projects/ui/Elements/ElementsHeader.tsx`
- Create: `apps/erp/app/modules/projects/ui/Elements/ElementList.tsx`
- Create: `apps/erp/app/modules/projects/ui/Elements/ElementTypeIcon.tsx`
- Create: `apps/erp/app/modules/projects/ui/Elements/ElementProperties.tsx` (the pills)
- Copy from (precedent):
  - `apps/erp/app/modules/accounting/ui/ChartOfAccounts/ChartOfAccountsTree.tsx` (`useTree`, `TreeView`, `LevelLine`)
  - `apps/erp/app/routes/x+/inventory+/quantities.tsx` (split view with `RecordOutlet`)
  - `apps/erp/app/components/ActionTasks/ActionTaskStatusButton.tsx` (state pill)
  - `apps/erp/app/components/Assignee.tsx` (owner pill)
  - `apps/erp/app/modules/production/ui/Jobs/OperationDueDatePicker.tsx` (date pill)
  - `apps/erp/app/modules/production/ui/Schedule/Kanban/ScheuleNavigation.tsx` (layout switcher)
  - `apps/erp/app/routes/x+/priority+/operations.tsx` lines 740–830 (Display popover)

**Steps:**
1. The `$projectId.elements.tsx` loader reads `layout` (`list` | `board` | `table`, default `list`) and the filters from the search params. It calls `getProjectElements`.
2. The route renders `ElementsHeader`, then the layout, then `<RecordOutlet />` in a `ResizablePanelGroup` split like `inventory+/quantities.tsx`. The element peek (Task 35) renders in the right panel.
3. `ElementsHeader` holds:
   - left: the breadcrumb, the count chip and the type filter (All, System, Requirement, Function, Task, Test Case, Parameter, Folder);
   - right: the layout switcher, a **Filters** toggle, a **Display** popover and **+ New** with a type menu.
   - The Filters row shows chips for state group, owner, milestone and label.
4. The **Display** popover lists the shown properties as switches (state, owner, priority, labels, dates, milestone, hours, budget, actual). Store them with `useLocalStorage("project-display-" + projectId)`.
5. `ElementList` uses `buildElementTree` and `useTree`. Each row is 44 px high and shows, left to right:
   1. a checkbox on hover;
   2. the readable id (muted, monospace);
   3. `ElementTypeIcon`;
   4. a chevron when the row has children;
   5. the name;
   6. the property pills on the right;
   7. a `…` menu (Open, Add child, Copy id, Delete).

   Children indent with `LevelLine`, one per level.
6. `ElementProperties` renders one pill per shown property, 20 px high. Each pill is its own editor:
   - state: dropdown with `StateIcon`;
   - owner: `Assignee`-style picker;
   - priority: dropdown with `getPriorityIcon` from `modules/quality/ui/Issue/IssueIcons.tsx`;
   - labels: multi-select with color dots;
   - start and target date: `DatePicker isPreviewInline`;
   - milestone: dropdown;
   - hours and budget: `NumberField` popover.

   Each change calls `fetcher.submit({ ids, field, value }, { action: path.to.projectElementUpdate(projectId), method: "post" })`.
7. A row click navigates to `path.to.projectElement(projectId, id)` (the peek). Use a `Link`, so Cmd-click opens a new tab. The `…` menu's Open goes to `path.to.projectElementFull`.
8. Add a quick-add row at the end of the list: an input prefixed with the identifier. Enter posts to `path.to.newProjectElement` with `type: "Task"`, `name`, and the selected row's id as `parentId` when a row is selected. The input stays open for the next entry.
9. `$projectId.elements.new.tsx` is action-only. It runs `requirePermissions(request, { create: "projects" })`, validates with `projectElementValidator`, and calls `insertProjectElement(getDatabaseClient(), …)`. It returns `data({ id }, { status: 201 })`.
10. `$projectId.elements.update.tsx` is action-only. It runs `update: "projects"`, validates with `projectElementFieldUpdateValidator`, and calls `updateProjectElementField`. For `labelIds` it calls `setProjectElementLabels`. It returns `{ error }` or `{ success: true }`.
11. `$projectId.elements.move.tsx` is action-only. It calls `moveProjectElement` or `updateProjectElementOrder` from `intent`.
12. Add **Move to…** to the row `…` menu. It opens a combobox of other elements (and "Top level"), then posts to the move route. This replaces drag in a tree, which Carbon has no precedent for.
13. Show an empty state with `<Empty>` and a "Create the first element" button when the project has no elements.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exit code 0
```

**Out of scope:** drag and drop in the tree. Grouping in the List layout. Saved views (Phase 1b).

---

## Task 33: Add the Board layout

**Depends on:** 32
**Files:**
- Create: `apps/erp/app/modules/projects/ui/Elements/ElementBoard.tsx`
- Modify: `apps/erp/app/routes/x+/project+/$projectId.elements.tsx` — render it when `layout=board`
- Copy from (precedent): `apps/erp/app/modules/production/ui/Schedule/Kanban/Kanban.tsx`, `components/ColumnCard.tsx`, `components/ItemCard.tsx`

**Steps:**
1. Columns are the project's states in `sortOrder`. Each column header shows the `StateIcon`, the name and the count.
2. Each card shows the readable id, the type icon, the name and the shown property pills from `ElementProperties` (compact).
3. Dragging a card to another column posts `{ ids: [id], field: "stateId", value: columnStateId }` to the update route with `fetcherKey: "element:" + id`. Read `useFetchers()` to show the card in its new column before the server answers, as `Kanban.tsx` does.
4. A card click opens the peek.
5. Each column has a quick-add at its end. It creates a Task in that column's state.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exit code 0
```

**Out of scope:** swimlanes.

---

## Task 34: Add the Table layout

**Depends on:** 32
**Files:**
- Create: `apps/erp/app/modules/projects/ui/Elements/ElementTable.tsx`
- Modify: `apps/erp/app/routes/x+/project+/$projectId.elements.tsx` — render it when `layout=table`, and load `getProjectCostSummary` for that layout
- Copy from (precedent): `apps/erp/app/modules/sales/ui/Contracts/ContractProductsGrid.tsx` (`useCellSave`, `EditableDate/List/Number`, `Table compact forceEditMode`)

**Steps:**
1. Rows are the elements in tree order. The first column shows the readable id and the name, indented 12 px per level.
2. Columns:
   - editable: state, priority and milestone (`EditableList`); start date and target date (`EditableDate`); hours estimated and budget (`EditableNumber`);
   - read-only: type, owner, hours actual, and committed, actual and remaining (from `rollUpCostSummary`).
3. Build the editable cell components inside `useMemo` (the comment at `PlanningOrderGrids.tsx:379` explains why).
4. Each cell edit posts `{ ids: [row.id], field, value }` to the update route through `useCellSave`.
5. Add `groupRowsBy` for state, type, owner and milestone from the Display popover. Sort the data by the group key first.
6. Format money with `useCurrencyFormatter`. Format hours with `useQuantityFormatter`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exit code 0
```

**Out of scope:** Parameter value columns (Phase 1b).

---

## Task 35: Build the element page (peek and full page)

**Depends on:** 32
**Files:**
- Create: `apps/erp/app/routes/x+/project+/$projectId.elements.$elementId.tsx` (peek)
- Create: `apps/erp/app/routes/x+/project+/$projectId.element.$elementId.tsx` (full page)
- Create: `apps/erp/app/routes/x+/project+/$projectId.elements.$elementId.comments.tsx`
- Create: `apps/erp/app/routes/x+/project+/$projectId.elements.$elementId.plan.tsx`
- Create: `apps/erp/app/routes/x+/project+/$projectId.elements.$elementId.delete.tsx`
- Create: `apps/erp/app/modules/projects/ui/Element/ElementView.tsx`
- Create: `apps/erp/app/modules/projects/ui/Element/ElementSidebar.tsx`
- Create: `apps/erp/app/modules/projects/ui/Element/ElementDescription.tsx`
- Create: `apps/erp/app/modules/projects/ui/Element/ElementChildren.tsx`
- Create: `apps/erp/app/modules/projects/ui/Element/ElementPlanLines.tsx`
- Create: `apps/erp/app/modules/projects/ui/Element/ElementComments.tsx`
- Copy from (precedent):
  - `apps/erp/app/routes/x+/inventory+/quantities+/$itemId.tsx` (the right `ResizablePanel`)
  - `apps/erp/app/modules/quality/ui/Issue/IssueProperties.tsx` (properties panel with inline selects)
  - `apps/erp/app/modules/items/ui/ChangeNotice/ChangeNoticeContent.tsx` (debounced JSON editor)
  - `apps/erp/app/routes/x+/maintenance+/$dispatchId.comments.tsx` (comments)
  - `apps/erp/app/components/AuditLog/` (`AuditLogFeed`)
  - `packages/react/src/BarProgress.tsx` (progress)

**Steps:**
1. Both routes load the element with `getProjectElement`, its children, its comments, its plan lines, and the cost summary rows of its subtree. They render the same `ElementView`. The peek wraps it in a `ResizablePanel` with a close button (to `path.to.projectElements`) and a button that opens the full page.
2. `ElementView` shows, top to bottom:
   1. the parent pill (a link to the parent) and the readable id with a copy button;
   2. the name, as an inline editable heading;
   3. `ElementDescription` (the editor; it saves through the update route with `field: "description"`, debounced 2.5 s);
   4. the action row: **Add child**, **Log time**, **Issue material**, **Attach** (Task 36 builds Log time and Issue material);
   5. collapsible sections:
      - **Children**: a `BarProgress` of completed children ÷ all children, and a mini list using the List row;
      - **Plan**: `ElementPlanLines`, three small `Grid`s for materials, labor and other costs, posting to the plan route;
      - **Time & materials** (Task 36);
      - **Budget**: plan, budget, committed, actual, remaining and estimate at completion for the element and its subtree;
      - **Attachments**: `RecordDocuments` if the document system supports a project element source; otherwise leave this section out and record it in the run log;
   6. **Activity**: `ElementComments` (a `Textarea` and send button, with the list of comments) followed by `AuditLogFeed` for `entityType: "projectElement"`.
3. `ElementSidebar` has a 120 px label column with ghost selects. Each field posts to the update route, as in `IssueProperties.tsx`. The fields are:
   - type, state, owner, priority, labels, start date, target date, milestone;
   - charge number (the readable id with a copy button) and chargeable (switch);
   - budget and hours estimate;
   - linked part (`Item`, System type only).
4. On mobile (`useIsMobile`), the sidebar moves under the content.
5. The comments route action switches on `intent` (`insert` or `delete`). It runs `requirePermissions(request, { view: "projects" })` for insert and checks ownership in the service for delete.
6. The plan route action switches on `intent` (`upsertMaterial`, `deleteMaterial`, `upsertLabor`, `deleteLabor`, `upsertCost`, `deleteCost`). It requires `update: "projects"`.
7. The delete route calls `deleteProjectElement`. It shows the refusal reason when charges exist.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exit code 0
```

**Out of scope:** trace links and verification sections (Phase 1b).

---

## Task 36: Add Log time and Issue material to the element page

**Depends on:** 16, 17, 35
**Files:**
- Create: `apps/erp/app/routes/x+/projects+/log-time.tsx`
- Create: `apps/erp/app/routes/x+/projects+/issue.tsx`
- Create: `apps/erp/app/modules/projects/ui/Element/LogTimeModal.tsx`
- Create: `apps/erp/app/modules/projects/ui/Element/IssueMaterialModal.tsx`
- Create: `apps/erp/app/modules/projects/ui/Element/ElementTimeAndMaterials.tsx`
- Modify: `apps/erp/app/modules/projects/projects.server.ts` — add `postTimesheetEntries(args)` and `postProjectIssue(args)` wrappers
- Modify: `apps/erp/app/modules/inventory/ui/useInventorySubmodules.tsx` — add **Issue to Project** (opens the same modal)
- Copy from (precedent):
  - `apps/erp/app/modules/resources/resources.server.ts` lines 16–37 (`postMaintenanceLabor`)
  - `apps/erp/app/modules/inventory/ui/Inventory/InventoryStorageUnits.tsx` lines 588–735 (adjustment modal)
  - `apps/erp/app/routes/x+/inventory+/quantities+/$itemId.adjustment.tsx` (action)

**Steps:**
1. `postTimesheetEntries({ timesheetEntryIds, companyId, userId })` calls `serverFns.system({ db: getDatabaseClient(), companyId, userId }).invoke("post-timesheet", { timesheetEntryIds })`. It returns an error message or null.
2. `postProjectIssue(args)` calls `invoke("post-project-issue", …)` the same way.
3. `LogTimeModal` fields: date (default today in the company time zone), hours, labor category (default the employee's `employeeJob.laborCategoryId`), note. The charge number is fixed to the element.
4. The `log-time.tsx` action:
   1. Run `requirePermissions(request, { role: "employee" })`.
   2. Validate with `logTimeValidator`.
   3. Insert a Draft entry for the current user.
   4. If `timesheetApprovalRequired` is false, set it Submitted and call `postTimesheetEntries`.
   5. If the setting is true, set it Submitted and leave it for approval.
   6. Return the result as fetcher data with a success or error flash.
5. `IssueMaterialModal` fields: item (`Item`, inventory items only), location (default the project location), storage unit, batch or serial (for tracked items), quantity, and direction (Issue or Return). The charge number is fixed to the element, or picked with `ChargeNumber` when opened from Inventory.
6. The `issue.tsx` action runs `requirePermissions(request, { update: ["inventory", "projects"] })`. It validates with `projectIssueValidator`, then calls `postProjectIssue`.
7. If `requirePermissions` does not accept an array of modules for one action, call it with `{ update: "inventory" }` and then check `permissions.can("update", "projects")` from the same result.
8. `ElementTimeAndMaterials` lists the element's subtree `projectLedger` rows (date, type, document, quantity, amount) and its timesheet entries that are not Posted (date, employee, hours, status). It has **Log time** and **Issue material** buttons.
9. Show posting errors (`ProjectChargeError` messages) in the modal, not as a 500.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exit code 0
```

**Out of scope:** issuing from MES.

---

## Task 37: Build the Milestones tab

**Depends on:** 29
**Files:**
- Create: `apps/erp/app/routes/x+/project+/$projectId.milestones.tsx`
- Create: `apps/erp/app/modules/projects/ui/Milestones/MilestonesList.tsx`
- Create: `apps/erp/app/modules/projects/ui/Milestones/MilestoneForm.tsx`
- Copy from (precedent): `apps/erp/app/modules/production/ui/Schedule/OutboundTable.tsx` (`groupRowsBy`); `packages/react/src/BarProgress.tsx`; `apps/erp/app/modules/items/ui/Item/ItemCostHistoryChart.tsx` (line chart)

**Steps:**
1. The loader loads milestones, elements (id, `milestoneId`, state group, estimated hours) and the cost summary.
2. Group milestones into Active (today between start and end), Upcoming (start after today) and Completed (`completedAt` set). Compare `YYYY-MM-DD` strings from `datetime` helpers.
3. Each row shows a `BarProgress` (completed elements ÷ elements in the milestone), the name, the date range, the element count, hours actual ÷ estimated and cost actual ÷ budget.
4. A row click filters the Elements page by the milestone: `path.to.projectElements(id) + "?milestone=" + milestoneId`.
5. `MilestoneForm` (drawer) creates and edits a milestone. A **Complete** action sets `completedAt`.
6. The action switches on `intent`: `upsert`, `complete`, `delete`. It requires `update: "projects"`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exit code 0
```

**Out of scope:** the burn chart (Phase 1b, with the progress ring decision).

---

## Task 38: Build the Costs tab and the Time & materials tab

**Depends on:** 6, 29
**Files:**
- Create: `apps/erp/app/routes/x+/project+/$projectId.costs.tsx`
- Create: `apps/erp/app/routes/x+/project+/$projectId.time.tsx`
- Create: `apps/erp/app/modules/projects/ui/Costs/ProjectCostsTree.tsx`
- Create: `apps/erp/app/modules/projects/ui/Costs/ProjectLedgerTable.tsx`
- Copy from (precedent): `apps/erp/app/modules/accounting/ui/TrialBalance/TrialBalanceTree.tsx` (tree with number columns), `apps/erp/app/modules/production/ui/Jobs/JobsTable.tsx`

**Steps:**
1. The Costs loader loads the elements and `getProjectCostSummary`, then builds `rollUpCostSummary(buildElementTree(elements), rows)`.
2. `ProjectCostsTree` shows the tree with the columns plan, budget, committed, actual, remaining (budget − committed − actual) and estimate at completion. The estimate is actual + committed + max(plan − actual − committed, 0), unless `estimateAtCompletion` is set. A top row shows the project total, including charges with no element.
3. A row click opens a drawer with `ProjectLedgerTable` filtered to that element's subtree.
4. `ProjectLedgerTable` columns: posting date, element, cost type, document (a link by `documentType`), item, employee, quantity and amount. Add static filters for cost type and CSV export.
5. The Time & materials loader loads `getProjectLedger` for the project and the open timesheet entries for the project. It renders `ProjectLedgerTable` and a small table of entries that are not Posted.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exit code 0
```

**Out of scope:** earned value (Phase 5).

---

## Task 39: Build My Timesheet and Approvals in the ERP

**Depends on:** 14, 16
**Files:**
- Create: `apps/erp/app/routes/x+/projects+/timesheet.tsx`
- Create: `apps/erp/app/routes/x+/projects+/timesheet.update.tsx`
- Create: `apps/erp/app/routes/x+/projects+/timesheet.submit.tsx`
- Create: `apps/erp/app/routes/x+/projects+/timesheet.correct.tsx`
- Create: `apps/erp/app/routes/x+/projects+/approvals.tsx`
- Create: `apps/erp/app/routes/x+/projects+/labor-categories.tsx`, `labor-categories.new.tsx`, `labor-categories.$id.tsx`
- Create: `apps/erp/app/modules/projects/ui/Timesheet/TimesheetGrid.tsx`
- Create: `apps/erp/app/modules/projects/ui/Timesheet/TimesheetApprovals.tsx`
- Create: `apps/erp/app/modules/projects/ui/LaborCategories/LaborCategoriesTable.tsx`, `LaborCategoryForm.tsx`
- Create: `apps/erp/app/routes/api+/projects.labor-categories.ts`
- Copy from (precedent):
  - `apps/mes/app/routes/x+/timecard.tsx` (week navigation, `datetime.weekBounds`)
  - `apps/erp/app/modules/sales/ui/Contracts/ContractProductsGrid.tsx` (editable `Table`)
  - `apps/erp/app/routes/x+/people+/timecard.tsx` (list)
  - `apps/erp/app/routes/x+/accounting+/cost-centers*.tsx` (CRUD drawer routes)

**Steps:**
1. The `timesheet.tsx` loader:
   1. Reads `?week=` as an offset and gets the company time zone.
   2. Calls `datetime.weekBounds(tz, weekOffset)` to get Mon–Sun.
   3. Calls `getTimesheetWeek` for the current user and the timecard hours of the same week (the MES `timecard.tsx` query), and groups the entries with `groupTimesheetRows`.
2. `TimesheetGrid` is a `Table compact forceEditMode`:
   - rows are charge number + labor category;
   - columns are Mon–Sun and a total;
   - day cells are `EditableNumber` posting to `timesheet.update.tsx`;
   - a cell whose entry is not Draft is read-only and shows a status dot;
   - a footer row shows the day totals, and a second footer row shows the timecard hours.
3. An **Add row** button opens a small form: `ChargeNumber` and a labor category select. The new row shows with empty cells.
4. `timesheet.update.tsx` validates with `timesheetCellValidator` and calls `upsertTimesheetCell` for the current user. It returns `{ error }`.
5. A **Submit week** button posts to `timesheet.submit.tsx`, which:
   1. Calls `submitTimesheetEntries(getDatabaseClient(), …)`.
   2. If `timesheetApprovalRequired` is false, calls `postTimesheetEntries` with the returned ids.
   3. Flashes the result.
6. A posted cell has a **Correct** menu. It opens a modal with the new hours and a required reason, and posts to `timesheet.correct.tsx`. That action:
   1. Calls `createTimesheetCorrection`.
   2. Posts both new entries when approval is off.
7. `approvals.tsx`:
   - loader: `requirePermissions(request, { update: "projects" })`, then `getTimesheetApprovals`;
   - UI: `TimesheetApprovals` groups by employee and week, with Approve, Reject (with a note) and Approve all;
   - action: on approve, set `approvedBy` and `approvedAt`, set status `Approved`, then call `postTimesheetEntries`; on reject, call `rejectTimesheetEntries`.
8. The labor category routes follow the cost center CRUD routes. The form has name, description, active, and a rates `Grid` (effective from, cost rate).
9. The API route `projects.labor-categories.ts` returns `getLaborCategoriesList`.
10. Add a **Labor category** select to the employee job form. Find it with `grep -rn "employeeJobValidator" apps/erp/app/modules/people`. Add `laborCategoryId` to that validator and to its update service.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exit code 0
```

**Out of scope:** blocking on timecard mismatch (Phase 5). Daily-entry rules (Phase 5).

---

## Task 40: Build the MES timesheet

**Depends on:** 39
**Files:**
- Create: `apps/mes/app/routes/x+/timesheet.tsx`
- Create: `apps/mes/app/services/projects.service.ts`
- Modify: the MES navigation that lists `timecard` (find it with `grep -rn "path.to.timecard" apps/mes/app/components`)
- Modify: `apps/mes/app/utils/path.ts` — add `timesheet`
- Copy from (precedent): `apps/mes/app/routes/x+/timecard.tsx`; `apps/mes/app/services/people.service.ts`

**Steps:**
1. `projects.service.ts` has `getChargeNumbers` (the same queries as the ERP version), `getTimesheetWeek`, `upsertTimesheetCell` and `submitTimesheetEntries`. Copy the ERP logic. The MES has no shared module with the ERP for these.
2. `timesheet.tsx` shows the same week layout as the MES timecard page, with:
   - one row per charge number + labor category;
   - large touch-friendly number inputs per day;
   - an **Add row** sheet (`BottomSheet` from `@carbon/react`) with a searchable charge number list;
   - a **Submit week** button.
3. The submit action posts the entries through `serverFns.as({ client, db, companyId, userId }).invoke("post-timesheet", …)` when approval is off. Follow `apps/mes/app/services/maintenance.service.ts` lines 178–186.
4. Add the Timesheet entry to the MES navigation next to Timecard.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=mes
# Expected: exit code 0
```

**Out of scope:** Issue material in the MES. Field service in the MES (Brad 2026-10-07).

---

## Task 41: Add charge numbers to the job, PO line and purchase invoice line forms

**Depends on:** 31
**Files:**
- Modify: `apps/erp/app/modules/production/production.models.ts` — `baseJobValidator` (line 248) and `jobValidator` (line 339)
- Modify: `apps/erp/app/modules/production/ui/Jobs/JobForm.tsx`, `JobProperties.tsx`, `JobHeader.tsx`
- Modify: the job create and update service calls that pass validator fields
- Modify: `apps/erp/app/modules/purchasing/purchasing.models.ts` — `purchaseOrderLineValidator` (line 226)
- Modify: `apps/erp/app/modules/purchasing/ui/PurchaseOrder/PurchaseOrderLineForm.tsx`
- Modify: `apps/erp/app/modules/invoicing/invoicing.models.ts` — `purchaseInvoiceLineValidator` (line 145)
- Modify: `apps/erp/app/modules/invoicing/ui/PurchaseInvoice/PurchaseInvoiceLineForm.tsx`
- Copy from (precedent): the Make to Asset fields in `JobForm.tsx` (lines 71–183, 325) and the refine at `production.models.ts` line 352

**Steps:**
1. Add `projectId`, `projectElementId` and `consumeToProject` (`zfd.checkbox()`) to `baseJobValidator`.
2. Add a refine to `jobValidator`:
   - `consumeToProject` requires `projectId`;
   - `consumeToProject` cannot be combined with `fixedAssetClassId` or `fixedAssetId`;
   - `consumeToProject` cannot be combined with a sales order line.
3. In `JobForm`, add the `ChargeNumber` field and a **Consume to project** switch.
   - The switch defaults to on when the picked project's treatment is Expense or Contract.
   - It is disabled for a Statistical project.
4. Read the treatment from the charge number options (add `costTreatment` to `getChargeNumbers` rows).
5. In `JobHeader`, show the charge number, and a "Consumes to project" badge when `consumeToProject` is on.
6. In `JobProperties`, show the charge number as read-only after the job is released.
7. Add `projectId` and `projectElementId` to `purchaseOrderLineValidator`. Add the `ChargeNumber` field to `PurchaseOrderLineForm` next to `CostCenter` (line 922).
8. Add `projectId` and `projectElementId` to `purchaseInvoiceLineValidator`. Add the `ChargeNumber` field to `PurchaseInvoiceLineForm` next to `CostCenter` (line 834).
9. Make sure each route that saves these forms passes the two fields to its service. Find them with `grep -rn "purchaseOrderLineValidator\|purchaseInvoiceLineValidator\|jobValidator" apps/erp/app/routes`.
10. If a route builds the row field by field, add the two fields there.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exit code 0
pnpm --filter erp test
# Expected: all tests pass
```

**Out of scope:** charge numbers on charge and reimbursement lines. They keep the project-only dimension in Phase 1a.

---

## Task 42: Add the account defaults and project settings UI

**Depends on:** 7
**Files:**
- Modify: `apps/erp/app/modules/accounting/accounting.models.ts` — `defaultIncomeAcountValidator` (line 491): add `projectExpenseAccount` (optional); `defaultBalanceSheetAccountValidator` (line 418): add `projectWorkInProgressAccount` (optional)
- Modify: `apps/erp/app/modules/accounting/ui/AccountDefaults/AccountDefaultsForm.tsx` — add both fields (next to `maintenanceAccount`, line 496, and `workInProgressAccount`, line 179)
- Create: `apps/erp/app/routes/x+/settings+/projects.tsx`
- Modify: `apps/erp/app/modules/settings/settings.models.ts` — add `projectSettingsValidator` with `timesheetApprovalRequired` and `requireProjectElement` (`zfd.checkbox()`)
- Modify: `apps/erp/app/modules/settings/settings.service.ts` — add `updateProjectSettings(client, companyId, values)` with an `@mcp update` tag
- Modify: `apps/erp/app/modules/settings/ui/useSettingsSubmodules.tsx` — add **Projects** to the Modules group
- Copy from (precedent): `apps/erp/app/routes/x+/settings+/people.tsx` (`timeCardEnabled` switch); `settings.models.ts` line 801; `settings.service.ts` line 1076

**Steps:**
1. Add the two account default fields. Label them "Project Expense" and "Project WIP".
2. Build the settings page with two switches: "Require approval of timesheets" and "Require an element on every project charge".
3. The settings action runs `requirePermissions(request, { update: "settings" })`, switches on `intent`, and calls `updateProjectSettings`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exit code 0
```

**Out of scope:** per-project overrides of these settings.

---

## Task 43: Add keyboard shortcuts for the Elements page and element page

**Depends on:** 32, 35
**Files:**
- Modify: `apps/erp/app/shortcuts.ts` — add `PROJECT_SHORTCUTS`
- Modify: `apps/erp/app/modules/projects/ui/Elements/ElementsHeader.tsx`, `ElementList.tsx`, `apps/erp/app/modules/projects/ui/Element/ElementView.tsx`
- Modify: `apps/erp/app/components/ShortcutHelp.tsx` — list the new shortcuts
- Copy from (precedent): `apps/erp/app/modules/sales/ui/SalesReturnOrders/SalesReturnOrderExplorer.tsx` lines 108–115 (`useShortcutKeys`)

**Steps:**
1. 🛑 The keyboard shortcuts spec (`.ai/specs/2026-09-07-keyboard-shortcuts.md`) rules out new global single-letter shortcuts. Register these keys only while the Elements page or the element page is mounted, and only when focus is not in an input.
2. Add `PROJECT_SHORTCUTS = { create: "c", state: "s", owner: "a", priority: "p", labels: "l", logTime: "t", issueMaterial: "i" }`.
3. On the Elements page, `c` opens the quick-add input.
4. On the element page, or on a selected list row:
   - `s`, `a`, `p` and `l` open the matching pill's dropdown;
   - `t` opens Log time;
   - `i` opens Issue material.
5. Use `useShortcutKeys` with `disabled` when no element is selected or focused.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exit code 0
```

**Out of scope:** global shortcuts and `cmd+k` changes.

---

## Task 44: Register the MCP namespace and regenerate tools

**Depends on:** 12, 13, 14
**Files:**
- Modify: `scripts/lib/service-metadata.ts` — add `projects` to `MODULE_LIST` (line 75)
- Modify: `apps/erp/app/routes/api+/mcp+/lib/mcp-exposure.ts` — add `projects` to `MCP_MODULE_ALLOWLIST` (line 37)
- Modify: `apps/erp/app/routes/api+/v1+/lib/registry.server.ts` — import the projects service and add it to `functionRegistry` (lines 10–43)
- Modify: `.claude/rules/mcp-tools-reference.md` — the module list (line 699)
- Modify: `apps/erp/app/routes/api+/mcp+/lib/tool-manifest.digest.json` (generated)

**Steps:**
1. Make the three registrations.
2. Run `pnpm run generate:mcp`.
3. Read the digest diff. Expect the `accounting_*Project*` tools to be gone and `projects_*` tools to appear.

**Verify:**
```bash
pnpm run generate:mcp
# Expected: exit code 0, and the digest lists projects_getProjects
grep -c "projects_getProjects" apps/erp/app/routes/api+/mcp+/lib/tool-manifest.digest.json
# Expected: 1
```

**Out of scope:** new MCP tools for server-only functions.

---

## Task 45: Add projects to the demo datasets

**Depends on:** 7
**Files:**
- Modify: `packages/database/src/datasets/types.ts` — `ProjectSpec` (lines 1826–1832)
- Modify: `packages/database/src/datasets/tiers/09-accounting.ts` (lines 123–150)
- Modify: `packages/database/src/datasets/data/{satellite,robotics,precision,motor}/accounting.ts`
- Modify: `packages/database/src/datasets/coverage.ts`
- Copy from (precedent): the existing project seeding in `tiers/09-accounting.ts`

**Steps:**
1. Extend `ProjectSpec` with:
   - `identifier`, `costTreatment` and `status`;
   - `elements: { key, type, name, parentKey?, state, estimatedHours?, budget? }[]`;
   - `milestones: { key, name, startOffset, endOffset }[]`;
   - `laborCategories: { name, costRate }[]` on the accounting slice.
2. In tier 09:
   1. Insert the labor categories and rates.
   2. Insert each project with its identifier, treatment and status.
   3. Insert its six default states.
   4. Insert its milestones.
   5. Insert its elements, in parent-first order, with `readableId` = identifier + sequence, and set `nextElementSequence`.
3. Insert 4 Draft and 4 Submitted timesheet entries per dataset, against the applying user.
4. Use `DayOffset` and `resolveDate` for every date. Never use JavaScript `Date` or `CURRENT_DATE`.
5. Per dataset, add one Expense R&D project and one Contract project. Each has 8–12 elements across System, Requirement, Task and Test Case types, in 3 levels, with 2 milestones.
6. Add coverage floors after measuring: `projectState`, `projectMilestone`, `projectElement`, `laborCategory`, `laborCategoryRate`, `timesheetEntry`. Use the smallest count across the four datasets, × 0.8 for `projectElement` and `timesheetEntry`.
7. Run `pnpm db:check:datasets`.

**Verify:**
```bash
pnpm db:check:datasets
# Expected: all four datasets pass
```

**Out of scope:** seeded `projectLedger` rows and posted timesheets. Posting needs the server functions, which the seed cannot run.

---

## Task 46: Write the module AGENTS.md, the rule file and the docs page

**Depends on:** 1–45
**Files:**
- Create: `apps/erp/app/modules/projects/AGENTS.md`
- Create: `.claude/rules/projects-system.md`
- Modify: `AGENTS.md` (root) — add a Task Router row: "Projects (elements, charge numbers, timesheets, project ledger)" → the rule file and the module AGENTS.md
- Create: `docs/content/docs/reference/projects.mdx`
- Modify: `docs/content/src/glossary/terms.ts` — add Charge number, Element, Milestone, Timesheet, Labor category, Cost treatment, Project ledger
- Modify: `.ai/specs/2026-10-03-projects.md` — record what changed in implementation
- Copy from (precedent): `.claude/skills/create-agents-md/SKILL.md` (template); `apps/erp/app/modules/production/AGENTS.md`; the `carbon-docs` skill

**Steps:**
1. Write the module `AGENTS.md` with the `create-agents-md` skill. Ground every claim in the committed code.
2. Write the rule file, with `paths:` frontmatter for `apps/erp/app/modules/projects/**`, `packages/server-functions/src/post-timesheet/**`, `packages/server-functions/src/post-project-issue/**` and `packages/server-functions/src/lib/project-posting.ts`. Cover:
   - treatment at source;
   - `projectLedger`;
   - charge gates;
   - readable ids;
   - consume-to-project jobs;
   - the SQL mirror `project_posting_account`.
3. Write the docs page with the `carbon-docs` skill.
4. In the spec, record:
   - the Return valuation from Task 17;
   - that `receiptLine` has no charge columns;
   - that a timesheet on a Statistical project posts no cost;
   - that `BarProgress` replaces the ring;
   - that single-letter keys are page-scoped;
   - the Phase 1a scope at the top of this plan.

**Verify:**
```bash
cd docs && pnpm typecheck
# Expected: exit code 0
pnpm --filter @carbon/checks license-headers
# Expected: no files changed (all headers present)
```

**Out of scope:** the changelog entry. It ships with the release, through the `changelog-entry` skill.

---

## Task 47: Verify in the browser

**Depends on:** 1–46
**Files:**
- Create: `.ai/playbooks/projects-phase-1a.md` (written by `/test`)

**Steps:**
1. Run `/test` with this plan's spec section. Use a dataset company (`pnpm db:seed:dev --dataset satellite`) with accounting on.
2. Cover these spec acceptance criteria:
   1. **Backfill** and **Permission backfill**: an old project shows with an identifier and states; a production-only user can open Projects.
   2. **Workspace**: create project `SNS`, add a System, a Requirement and a Task under it; move the Task and check its id stays the same.
   3. **Direct time and materials**: from the Task's page, log 6 h and issue 4 parts; check the state moves to In Progress and both rows show in Time & materials and Costs.
   4. **Timesheet posting** with approval on: submit a week, approve it, and check the journal in Accounting.
   5. **Corrections**: correct a posted entry with a reason; check the reversal and the replacement.
   6. **Consume-to-project job**: issue to it, log labor, complete it; check no inventory receipt.
   7. **Non-inventory PO line** and **Inventory PO line, no project stock**: receive and invoice; check commitments and the expense account.
   8. **Issue to project** and **Return**.
   9. **Status gates**: On Hold refuses Log time; Closed is refused with an open PO line.
   10. **State gates**: a Backlog element refuses Log time.
   11. **Layouts**: List, Board (drag a card to Done) and Table (edit a budget cell).
   12. **Plan versus actual roll-up** on the Costs tab.
   13. **Missing account default**: clear Project Expense, then try to log time on an Expense project; check the error names the default.
3. Save the playbook to `.ai/playbooks/projects-phase-1a.md`.

**Verify:**
```bash
ls .ai/playbooks/projects-phase-1a.md
# Expected: the file exists, and the /test run reports every step passed
```

**Out of scope:** the Phase 1b acceptance criteria (verification, allocation, Tree, Timeline, Reader, baselines).

## Execution notes

- Tasks 1–6: each migration was applied with `pnpm db:migrate` before its commit, and the regenerated `types.ts`, `swagger-docs-schema.ts` and MCP `tool-manifest.digest.json` were committed with it. The pre-commit `check:manifest` gate refuses a migration commit whose digest is stale, so the type regeneration could not wait for Task 7.
- The shell exports `SUPABASE_DB_URL` for port 54322, which `.env.local` does not override, so the backup check skipped silently. Commits ran with `SUPABASE_DB_URL` pointed at this worktree's database (port 60387), so the dataset and backup checks ran for real.
- Tasks 3–7: `pnpm db:migrate` applies each migration, then its last step (`authz sync`) fails because the new tables have no manifest rule yet. That is expected until Task 8 adds the rules; each migration was confirmed applied in `supabase_migrations.schema_migrations`.
- Task 3: composite FK columns are indexed as their full column list (`("projectId", "companyId")`, `("parentId", "projectId", "companyId")`), named `<table>_<firstColumn>_idx`.
- Task 6: the migration ends with `NOTIFY pgrst, 'reload schema';` so PostgREST sees the two new functions (lessons: "Appending SQL to an already-applied migration silently does nothing", corollary).
- Task 7: nothing left to commit on its own. Each earlier migration commit already carried its regenerated types. Its checks were run (`"Projects"` ×2, `projectElement: {` ×1, `@carbon/database` typecheck green) and its box is ticked in the Task 8 commit. `packages/database/supabase/functions/lib/types.ts` does not exist in this tree.
- Task 8, `projectElementComment`: the update rule is `and(owner("createdBy"), inCompany("companyId", "employee"))`, not bare `owner("createdBy")`. With no `where`, the WITH CHECK reuses USING, and an owner-only check lets the author move the row to another company (`authz-manifest.md` gotcha).
- Task 8, `timesheetEntry`: the owner branches of INSERT and of the UPDATE WITH CHECK also require `status = 'Draft'`. The plan's check (`inCompany(employee)`) let an employee set their own Draft row to Approved or Posted through the API. Submit, corrections and posting run over Kysely, so they are not affected. `projects_update` holders still edit any row.
- Task 8: `vitest run src/authz` needs `@carbon/config` built (`turbo run build --filter=@carbon/config`) and `SUPABASE_DB_URL` set to this worktree's database; with both, 33/33 pass.
- Task 4 follow-up (commit `9fe4ab5750`): the new FKs on `job` and `purchaseOrderLine` pushed 14 bare PostgREST embeds of their parents past TS2589 in `erp` and `@carbon/jobs`. Each now names its FK (lessons: "A new FK on a busy table breaks bare PostgREST embeds of it"). Checked against the local PostgREST.
- Task 9: `projectLedger` also lists `laborCategoryId` and `supplierId` in `ID_REF_COLUMNS`. Both hold tenant row ids with no FK, which is the rule the file states; the plan listed only five columns.
- Tasks 9–10 Verify: `turbo run typecheck` for `@carbon/jobs` and `@carbon/server-functions` fails on one error only, `POSTING_POLICY` in `packages/ee/src/accounting/core/models.ts` missing `Project Issue` and `Timesheet`. Task 1's enum values cause it and Task 25 fixes it, so it stays until Task 25 (the plan orders it that way). With `--continue`, `erp` also shows only the Task 25 enum-mirror errors (`JournalEntriesTable.tsx`, `JournalEntryDocuments.tsx`, `dimensions.$dimensionId.tsx`). No other errors remain in `erp`, `mes`, `@carbon/jobs`, `@carbon/server-functions`, `@carbon/planning` or `@carbon/api`.
- Task 10: `seed-company` and the dataset `bootstrap.ts` both map every `accountDefaults` key generically, so neither changed. The two new keys sit next to `workInProgressAccount`. `db:check:datasets` passes ×4.
- Task 25: `getJournalEntryRelatedItems` lists a `Project Issue` line as kind `project` (the line's `documentId` is the project id, because `bookAdjustment` copies the itemLedger `documentId`). It lists a `Timesheet` line as kind `projectTime`, read through `timesheetEntry` → `project`. Both open `path.to.project` for now, because `path.to.projectTime` does not exist until Task 27. Task 27 must re-point `projectTime` in `JournalEntryDocuments.tsx` to `path.to.projectTime`.
- Task 25: `DIMENSION_LABEL_SOURCES` takes one label column, so `ProjectElement` uses `readableId`. The ERP dimension picker shows `readableId name` and lists chargeable elements only.
- Task 25: `pnpm exec turbo run typecheck --filter=@carbon/ee --filter=erp` is green (3/3). `@carbon/ee` tests pass (1928).
- Task 25 onwards: the overnight brief names Biome and the scoped typecheck as the gates. The `/translate` fill for new UI strings (`Project`, `Project Time`) is left for one pass at the end of the plan.
- Task 11: `projectCostTreatments` holds the three treatments the UI offers (Statistical, Expense, Contract), so `projectValidator` refuses Capitalize. `projectElementValidator.isChargeable` reads an absent value as `undefined`, not `false`, so `insertProjectElement` can apply `chargeableByDefault`. The editable field names are exported as `projectElementEditableFields`.
- Task 12: to keep `erp` green between Task 12 and Task 26, the 4 accounting project routes and `accounting/types.ts` now import the moved functions from `~/modules/projects`. They still use the accounting `projectValidator`. Task 26 deletes or moves them as planned. `upsertProject` takes every field except `name` as optional, so the old accounting form still type-checks.
- Task 12: `createProject` starts a new project in `Draft` (the spec's lifecycle starts there). The column default `Released` still applies to existing rows and to `upsertProject`.
- Task 12: "open" for the Close check means a purchase order not in Completed, Closed or Rejected, and a job not in Completed, Cancelled or Closed. Both checks use `count: "exact", head: true`.
- Task 12: `deleteProjectState` takes `db` (Kysely), not `client`. When the deleted state is its group's default, the next state of the group becomes the default in the same transaction. Without this, the group has no default and `insertProjectElement` cannot pick one.
- Task 12: the generated `tool-manifest.digest.json` drops the 4 `accounting_*Project*` tools. They return as `projects_*` tools in Task 44, which adds the module to `MODULE_LIST`.
- Task 12: the new module file shifted type-check order, and `x+/sales-order+/$orderId.cancel-preview.tsx` hit TS2589 on a bare `item(...)` embed from `job`. It now names the FK (`item!job_itemId_fkey`), per the lesson "A new FK on a busy table breaks bare PostgREST embeds of it".
- Task 12: `projects.models.ts` imports `methodType` from `../shared/shared.models`, not the `../shared` barrel. The barrel pulls in the glossary's Lingui `msg` macros, and a plain vitest run fails on them.
- Task 13: `insertProjectElement`, `moveProjectElement` and `startElementOnFirstCharge` live in `projects.server.ts`. `updateProjectElementOrder` lives in `projects.service.ts`, next to its precedent `updateQuoteLineOrder`. `moveProjectElement` also refuses a Parameter parent, as the insert does.
- Task 13: when no `stateId` is given, the insert takes the default Unstarted state, else the first Unstarted state by `sortOrder`.
- Task 13: `getProjectElements` resolves the `labelId` filter with one `projectElementLabel` query, then one `.in("id", …)`, so the embedded label list keeps every label. `getProjectElement` reads the parent with a second query, because a self-referencing embed is ambiguous.
- Task 13: a throwaway vitest run against this worktree's database created a project, inserted 3 elements (`STG-1`…`STG-3`), refused a move under a descendant, moved one element to the top level and started an Unstarted element (Todo → In Progress). The test project was then deleted. The script was not committed.
