# Field Service Phase A — implementation plan

**Spec:** .ai/specs/2026-10-08-field-service.md (Phase A), and .ai/specs/2026-10-03-projects.md (*Service projects*, which ships with this phase)
**Research:** .ai/research/field-service.md, .ai/research/serial-service-cost-treatment.md
**Branch:** projects-wbs-research-spec
**Prerequisite:** every task of `.ai/plans/2026-10-07-projects-phase-1a.md` and `.ai/plans/2026-10-08-projects-phase-1b.md` is done and committed. This plan uses `projectElement`, `projectLedger`, `timesheetEntry`, `post-timesheet`, `post-project-issue`, `project-posting.ts`, part links and `buildElementsFromPart`. If one of them does not exist, STOP and report.

## Scope of this plan

Phase A gives a service team its own module, with the work tree shared with Projects underneath:
1. **Service projects** (projects spec): `projectType`, the **By Coverage** treatment, coverage on charges, `projectExpenseEntry`, `projectBillableItem`, fixed-price nodes and `parentProjectId`.
2. **The Service module:** permissions (Q1), navigation, and RLS that lets `service_*` govern Service projects.
3. **Customer assets:** created at shipment, registered by hand, backfilled, with components and a history per component.
4. **Field Visit service orders:** the work tree, visits, coverage, posting by coverage, and installed components.
5. **Invoicing** from billable items, following the tree, with fixed-price nodes and no second stock relief. **Print estimate.**
6. **The technician's phone pages:** My Visits and the visit page with a signature. **Schedule** for dispatch.
7. **Settings:** warranty months on items, the service labor item, Warranty Expense, and the technician's van.

Phases B (depot repair), C (refurbishment) and D (the contract project roll-up) get their own plans. Phase A creates only `Field Visit` orders.

## Rules for the executor

- Read `.ai/lessons.md`, `.claude/rules/conventions-services.md`, `.claude/rules/conventions-forms.md`, `.claude/rules/database-patterns.md`, `.claude/rules/authz-manifest.md`, `.claude/rules/accounting-sync-handlers.md`, `.claude/rules/projects-system.md` and `.claude/rules/traceability-model.md` before Task 1.
- Use the `carbon-design` skill for every UI task. Phone pages must work at 390 px wide with no horizontal scroll.
- Start every new source file with its SPDX header. Run `pnpm --filter @carbon/checks license-headers` after you create files.
- Never use JavaScript `Date`. Use `@internationalized/date` and the `datetime` helpers in `@carbon/utils`.
- Round money with `round()` from `@carbon/utils`. Never query in a loop.
- Never construct a database client in a `*.service.ts`.
- 🛑 The path names `path.to.service`, `serviceRoot`, `serviceDetails` and `services` already belong to the Service **item** page (`apps/erp/app/utils/path.ts:2340-2352`). Name every new helper `serviceOrder*`, `customerAsset*`, `serviceVisit*`, `myVisits` or `serviceSchedule`.
- A Service user never sees the word "project" (spec, *Who uses what*). UI copy says "service order", "work" and "node".
- If a quoted code line or line number does not match the file, search for the quoted code. If you cannot find it, STOP and report.

## Progress

- [x] Task 1: Create the enum migration
- [x] Task 2: Create the Service projects migration
- [x] Task 3: Create the field service tables migration
- [x] Task 4: Create the module, permissions and seeds migration
- [x] Task 5: Apply migrations, regenerate types, ship RLS
- [x] Task 6: Add `resolveCoverage` and the coverage account
- [x] Task 7: Add `buildBillableItem` to the project posting helpers
- [x] Task 8: Post service time in `post-timesheet`
- [x] Task 9: Post service parts and install components in `post-project-issue`
- [x] Task 10: Add `post-project-expense` and the coverage reclass
- [x] Task 11: Create customer assets in `post-shipment`
- [x] Task 12: Stop the second stock relief and release billable item stamps
- [x] Task 13: Add `create-service-order-invoice`
- [x] Task 14: Hide Service projects outside Service
- [x] Task 15: Make My Timesheet personal
- [x] Task 16: Add the service models and services
- [x] Task 17: Add `createServiceOrder` and the status roll-up
- [x] Task 18: Add the Service module navigation and layout
- [ ] Task 19: Add the customer asset pages and the customer Assets tab
- [ ] Task 20: Add the service order list, new form and document page
- [ ] Task 21: Add the Work section
- [ ] Task 22: Add visits and the Schedule page
- [ ] Task 23: Add the `SignaturePad` component
- [ ] Task 24: Add My Visits and the visit page
- [ ] Task 25: Add invoicing and the billable item review
- [ ] Task 26: Add Print estimate
- [ ] Task 27: Add service templates
- [ ] Task 28: Add the settings fields
- [ ] Task 29: Extend the demo datasets
- [ ] Task 30: Update the rules, AGENTS.md, docs and specs
- [ ] Task 31: Verify in the browser

## Dependencies

- Tasks 1 → 2 → 3 → 4 → 5 run in order.
- Task 6 needs Task 5. Task 7 needs Task 6. Tasks 8, 9 and 10 need Task 7.
- Task 11 needs Task 5. Task 12 needs Task 5. Task 13 needs Tasks 7 and 12.
- Tasks 14 and 15 need Task 5. Task 16 needs Task 5. Task 17 needs Task 16.
- Task 18 needs Task 5. Tasks 19–22 need Tasks 16, 17 and 18. Task 21 needs Tasks 8–10.
- Task 23 has no dependency. Task 24 needs Tasks 21, 22 and 23.
- Task 25 needs Tasks 13 and 21. Task 26 needs Task 21. Task 27 needs Task 21. Task 28 needs Task 5.
- Task 29 needs Tasks 11, 17 and 27. Task 30 needs Tasks 1–29. Task 31 runs last.

---

## Task 1: Create the enum migration

**Depends on:** none
**Files:**
- Create: `packages/database/supabase/migrations/<timestamp>_field-service-enums.sql`
- Copy from (precedent): `packages/database/supabase/migrations/20260810100100_workflows-foundation.sql:3-5`

**Steps:**
1. Run `pnpm db:migrate:new field-service-enums`.
2. Write only these statements. Postgres refuses a new enum value in the transaction that adds it, so these get their own migration:

```sql
ALTER TYPE "module" ADD VALUE IF NOT EXISTS 'Service';
ALTER TYPE "projectCostTreatment" ADD VALUE IF NOT EXISTS 'By Coverage';
ALTER TYPE "journalEntrySourceType" ADD VALUE IF NOT EXISTS 'Project Expense';
ALTER TYPE "journalLineDocumentType" ADD VALUE IF NOT EXISTS 'Project Expense';
CREATE TYPE "projectType" AS ENUM ('Standard', 'Service');
CREATE TYPE "serviceCoverage" AS ENUM ('Warranty', 'Contract', 'Billable', 'Capitalized');
CREATE TYPE "projectBillableItemStatus" AS ENUM ('Unbilled', 'On Hold', 'Billed', 'Written Off');
CREATE TYPE "serviceOrderType" AS ENUM ('Field Visit', 'Depot Repair', 'Refurbishment');
CREATE TYPE "serviceOrderStatus" AS ENUM ('Draft', 'Scheduled', 'In Progress', 'On Hold', 'Completed', 'Closed', 'Cancelled');
CREATE TYPE "serviceVisitStatus" AS ENUM ('Scheduled', 'Traveling', 'On Site', 'Completed', 'Cancelled');
CREATE TYPE "customerAssetStatus" AS ENUM ('In Service', 'At Depot', 'Returned');
CREATE TYPE "serviceInvoiceDetail" AS ENUM ('Itemized', 'By Node');
```

3. `trackedActivity.type` is `TEXT` (`20250225145619_tracked-entities.sql:47`), so the `Service` activity type needs no enum change.

**Verify:**
```bash
grep -c "ADD VALUE\|CREATE TYPE" packages/database/supabase/migrations/*_field-service-enums.sql
# Expected: 12
```

**Out of scope:** tables.

---

## Task 2: Create the Service projects migration

**Depends on:** 1
**Files:**
- Create: `packages/database/supabase/migrations/<timestamp>_service-projects.sql`

**Steps:**
1. Run `pnpm db:migrate:new service-projects`.
2. Read the identifier CHECK name from the Phase 1a `projects-workspace` migration (`grep -n "identifier" packages/database/supabase/migrations/*projects*.sql`). Use the real name below.
3. Write the SQL below. Add an index on `companyId` and every FK column.

```sql
ALTER TABLE "project"
  ADD COLUMN IF NOT EXISTS "projectType" "projectType" NOT NULL DEFAULT 'Standard',
  ADD COLUMN IF NOT EXISTS "parentProjectId" TEXT;
ALTER TABLE "project" ADD CONSTRAINT "project_parent_fkey"
  FOREIGN KEY ("parentProjectId", "companyId") REFERENCES "project"("id", "companyId") ON DELETE SET NULL ("parentProjectId");
-- A Service project's identifier is its order's readable id (SVC000123).
ALTER TABLE "project" DROP CONSTRAINT "<the identifier format CHECK>";
ALTER TABLE "project" ADD CONSTRAINT "project_identifier_format_check"
  CHECK ("projectType" = 'Service' OR "identifier" ~ '^[A-Z][A-Z0-9]{1,5}$');
ALTER TABLE "project" ADD CONSTRAINT "project_service_treatment_check"
  CHECK (("projectType" = 'Service') = ("costTreatment" = 'By Coverage'));

ALTER TABLE "projectElement" ADD COLUMN IF NOT EXISTS "fixedPrice" NUMERIC CHECK ("fixedPrice" IS NULL OR "fixedPrice" >= 0);

ALTER TABLE "timesheetEntry"
  ADD COLUMN IF NOT EXISTS "coverage" "serviceCoverage",
  ADD COLUMN IF NOT EXISTS "coverageReason" TEXT,
  ADD COLUMN IF NOT EXISTS "serviceVisitId" TEXT;
ALTER TABLE "projectLedger"
  ADD COLUMN IF NOT EXISTS "coverage" "serviceCoverage",
  ADD COLUMN IF NOT EXISTS "coverageReason" TEXT;

CREATE TABLE IF NOT EXISTS "projectExpenseEntry" (
  "id" TEXT NOT NULL DEFAULT id('pjx'),
  "companyId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "projectElementId" TEXT,
  "employeeId" TEXT NOT NULL REFERENCES "user"("id"),
  "entryDate" DATE NOT NULL,
  "description" TEXT NOT NULL,
  "amount" NUMERIC NOT NULL CHECK ("amount" <> 0),
  "coverage" "serviceCoverage",
  "coverageReason" TEXT,
  "serviceVisitId" TEXT,
  "journalId" TEXT,
  "reversalOfId" TEXT,
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  CONSTRAINT "projectExpenseEntry_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "projectExpenseEntry_element_fkey" FOREIGN KEY ("projectElementId", "projectId", "companyId") REFERENCES "projectElement"("id", "projectId", "companyId"),
  CONSTRAINT "projectExpenseEntry_project_fkey" FOREIGN KEY ("projectId", "companyId") REFERENCES "project"("id", "companyId"),
  CONSTRAINT "projectExpenseEntry_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS "projectBillableItem" (
  "id" TEXT NOT NULL DEFAULT id('pbi'),
  "companyId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "projectElementId" TEXT,
  "projectLedgerId" TEXT NOT NULL,
  "customerContractLineId" TEXT,                     -- projects Phase 4
  "itemId" TEXT REFERENCES "item"("id"),
  "description" TEXT NOT NULL,
  "quantity" NUMERIC NOT NULL,
  "unitPrice" NUMERIC NOT NULL,
  "amount" NUMERIC NOT NULL,
  "coverage" "serviceCoverage",
  "status" "projectBillableItemStatus" NOT NULL DEFAULT 'Unbilled',
  "statusReason" TEXT,
  "reversalOfId" TEXT,
  "salesInvoiceLineId" TEXT,
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  CONSTRAINT "projectBillableItem_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "projectBillableItem_project_fkey" FOREIGN KEY ("projectId", "companyId") REFERENCES "project"("id", "companyId"),
  CONSTRAINT "projectBillableItem_element_fkey" FOREIGN KEY ("projectElementId", "projectId", "companyId") REFERENCES "projectElement"("id", "projectId", "companyId"),
  CONSTRAINT "projectBillableItem_ledger_fkey" FOREIGN KEY ("projectLedgerId", "companyId") REFERENCES "projectLedger"("id", "companyId"),
  CONSTRAINT "projectBillableItem_invoiceLine_fkey" FOREIGN KEY ("salesInvoiceLineId") REFERENCES "salesInvoiceLine"("id") ON DELETE SET NULL,
  CONSTRAINT "projectBillableItem_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "projectBillableItem_ledger_key" ON "projectBillableItem" ("projectLedgerId", "companyId") WHERE "reversalOfId" IS NULL;
CREATE INDEX IF NOT EXISTS "projectBillableItem_unbilled_idx" ON "projectBillableItem" ("companyId", "projectId") WHERE "status" = 'Unbilled';
CREATE INDEX IF NOT EXISTS "projectBillableItem_invoiceLine_idx" ON "projectBillableItem" ("salesInvoiceLineId") WHERE "salesInvoiceLineId" IS NOT NULL;
```

4. Check the `salesInvoiceLine` primary key. If it is `("id", "companyId")`, write the invoice line FK as a composite with `ON DELETE SET NULL ("salesInvoiceLineId")`.

**Verify:**
```bash
grep -c "CREATE TABLE IF NOT EXISTS" packages/database/supabase/migrations/*_service-projects.sql
# Expected: 2
```

**Out of scope:** the RLS rules (Task 5).

---

## Task 3: Create the field service tables migration

**Depends on:** 2
**Files:**
- Create: `packages/database/supabase/migrations/<timestamp>_field-service.sql`

**Steps:**
1. Run `pnpm db:migrate:new field-service`.
2. Write the tables from the spec's *Data Model Changes*: `customerAsset`, `serviceOrder`, `serviceVisit` and `customerAssetComponent`, with every constraint and index shown there. Add these to `serviceOrder`, which the spec already lists: `projectId TEXT NOT NULL`, `serviceTemplateId`, `invoiceDetail`, and `UNIQUE ("projectId", "companyId")`.
3. Add the visit FK on the projects tables, which Task 2 could not add before `serviceVisit` existed:

```sql
ALTER TABLE "timesheetEntry" ADD CONSTRAINT "timesheetEntry_visit_fkey"
  FOREIGN KEY ("serviceVisitId", "companyId") REFERENCES "serviceVisit"("id", "companyId") ON DELETE SET NULL ("serviceVisitId");
ALTER TABLE "projectExpenseEntry" ADD CONSTRAINT "projectExpenseEntry_visit_fkey"
  FOREIGN KEY ("serviceVisitId", "companyId") REFERENCES "serviceVisit"("id", "companyId") ON DELETE SET NULL ("serviceVisitId");
```

4. Add these columns:

```sql
ALTER TABLE "itemUnitSalePrice"
  ADD COLUMN IF NOT EXISTS "laborWarrantyMonths" INTEGER CHECK ("laborWarrantyMonths" >= 0),
  ADD COLUMN IF NOT EXISTS "partsWarrantyMonths" INTEGER CHECK ("partsWarrantyMonths" >= 0);
ALTER TABLE "salesInvoice" ADD COLUMN IF NOT EXISTS "serviceOrderId" TEXT;
ALTER TABLE "employeeJob" ADD COLUMN IF NOT EXISTS "defaultStorageUnitId" TEXT;
ALTER TABLE "companySettings" ADD COLUMN IF NOT EXISTS "serviceLaborItemId" TEXT;
```

   Add an FK and an index for each, with `ON DELETE SET NULL` on the column. `salesReturnOrderLine.serviceOrderId` waits for Phase B.
5. The `serviceOrder_customer_check` of the spec stays as written. Phase A creates only `Field Visit` orders; the service refuses the other types.

**Verify:**
```bash
grep -c "CREATE TABLE" packages/database/supabase/migrations/*_field-service.sql
# Expected: 4
```

**Out of scope:** `accountDefault.warrantyExpenseAccount` (Task 4, with its backfill).

---

## Task 4: Create the module, permissions and seeds migration

**Depends on:** 3
**Files:**
- Create: `packages/database/supabase/migrations/<timestamp>_field-service-module.sql`
- Modify: `packages/database/src/seed-data.ts` — the account, the default and the sequence
- Copy from (precedent):
  - `20260810100100_workflows-foundation.sql:7-30` (the `modules` view and the permission backfill)
  - `20261006220201_revenue-recognition-core.sql:6-135` (the `accountDefault` column, its FK, the account per company group and the backfill with its guard)
  - `20261006221301_contracts.sql:268` (the sequence for every company)

**Steps:**
1. Recreate the `modules` view `WITH (security_invoker = true)`. The workflows migration omits it; the `no-view-without-invoker` check refuses that.
2. Insert full `Service` rights in `employeeTypePermission` for the `Admin` employee type only, `ON CONFLICT DO NOTHING`. The spec's Q1 answer excludes Management.
3. In `userPermission`, set `service_view` to `true` for every row with `sales_view = true`. Do not copy `sales_create`, `sales_update` or `sales_delete`.
4. Add `accountDefault.warrantyExpenseAccount` with its FK (`ON DELETE RESTRICT ON UPDATE CASCADE`). Add account `6120 Warranty Expense` per company group: class Expense, Income Statement, Average rate, parent group "Operating Expenses", sibling 6010. Backfill the default by account number, then by name. Copy the guard that raises when a default is missing.
5. Insert the `serviceOrder` sequence (prefix `SVC`, size 6) for every company with `WHERE NOT EXISTS`.
6. Backfill `customerAsset`. One `INSERT … SELECT`, no loop:

```sql
INSERT INTO "customerAsset" ("trackedEntityId", "itemId", "customerId", "customerLocationId", "shippedDate", "shipmentId", "source", "companyId", "createdBy")
SELECT te."id", te."itemId", s."customerId",
       CASE WHEN sos."dropShipment" THEN sos."customerLocationId" ELSE so."customerLocationId" END,
       s."postingDate", s."id", 'Shipment', te."companyId", 'system'
FROM "trackedEntity" te
JOIN "shipment" s ON s."id" = te."attributes"->>'Shipment' AND s."companyId" = te."companyId"
  AND s."status" = 'Posted' AND s."sourceDocument" = 'Sales Order'
JOIN "salesOrder" so ON so."id" = s."sourceDocumentId"
LEFT JOIN "salesOrderShipment" sos ON sos."id" = so."id"
WHERE te."status" = 'Consumed' AND te."itemId" IS NOT NULL AND te."quantity" = 1
ON CONFLICT ("trackedEntityId", "companyId") DO NOTHING;
```

   Check the join of `salesOrderShipment` to `salesOrder` in the generated types before you write it. Warranty dates stay null.
7. In `seed-data.ts`, add the 6120 account under the `operating-expenses` parent, `warrantyExpenseAccount: "6120"` in `accountDefaults`, and the sequence entry `{ table: "serviceOrder", name: "Service Order", prefix: "SVC", suffix: null, next: 0, size: 6, step: 1 }`.

**Verify:**
```bash
pnpm db:migrate && psql "$SUPABASE_DB_URL" -c "SELECT count(*) FROM \"accountDefault\" WHERE \"warrantyExpenseAccount\" IS NULL;"
# Expected: the migration succeeds, and the count is 0
```

**Out of scope:** API key scopes. `apiKeyPermissionModules` (`apps/erp/app/modules/settings/settings.models.ts:50-64`) does not list Workflows either; Service follows it.

---

## Task 5: Apply migrations, regenerate types, ship RLS

**Depends on:** 4
**Files:**
- Modify: `packages/database/src/authz/rules.ts` — add `projectModule`
- Modify: `packages/database/src/authz/manifest.ts`
- Modify: the authz pieces test (`packages/database/supabase/tests/authz-pieces.test.sql`)
- Modify: `packages/jobs/src/backups/id-refs.ts`
- Modify: generated types

**Steps:**
1. Run `pnpm run generate:types`.
2. **Who governs a project row.** Add a rule piece `projectModule(projectIdColumn, action)` in `rules.ts`. It compiles to an `EXISTS` on `project` that admits the row when either:
   - the project is `Standard` and the user holds `projects_<action>` in the row's company; or
   - the project is `Service` and the user holds `service_<action>` in the row's company.

   Build it from the existing `inCompany` pieces, so it uses the current permission helpers. The legacy helpers are gone (`20260927224314_retire-legacy-rls-helpers.sql`).
3. Replace the `company("projects")` rules of these tables with `projectModule("projectId", …)` per action. For `project` itself, use `"id"`. The tables: `projectElement`, `projectElementLink`, `projectElementMaterial`, `projectElementLabor`, `projectElementCost`, `projectState`, `projectLabel`, `projectElementLabel`, `projectMilestone`, `projectElementComment`, `projectLedger`, `projectExpenseEntry`, `projectBillableItem`. Keep the owner rules of `timesheetEntry` and add `projectModule` beside the `projects_*` branch.
4. Add the field service rules:

```ts
customerAsset: company("service"),
customerAssetComponent: company("service", { create: false, update: false, delete: false }),
serviceOrder: company("service"),
serviceVisit: company("service", {
  create: or(and(owner("technicianId"), inCompany("companyId", "employee")), inCompany("companyId", "service_create")),
  update: or(and(owner("technicianId"), inCompany("companyId", "employee")), inCompany("companyId", "service_update"))
}),
```

   The precedent is `timeCardEntry` (`manifest.ts:1510-1524`). `maintenanceDispatchEvent` has no owner check.
5. Add cases to `authz-pieces.test.sql`:
   1. A user with `service_view` and no `projects_view` reads a Service project's elements and not a Standard project's.
   2. A user with `projects_view` only reads the Standard project and not the Service one.
6. Add `ID_REF_COLUMNS` entries: `serviceOrder: ["trackedEntityId", "serviceTemplateId"]`, `customerAsset: ["shipmentId"]`, `customerAssetComponent: ["projectLedgerId"]`, `salesInvoice: [… "serviceOrderId"]` (merge into the existing entry).
7. Run `pnpm db:migrate`, then `pnpm --filter @carbon/database authz migration field-service-rls`, then `pnpm run generate:types`.

**Verify:**
```bash
pnpm --filter @carbon/database exec vitest run src/authz && pnpm exec tsx scripts/run-local-accounting-check.ts psql -X -f packages/database/supabase/tests/authz-pieces.test.sql
# Expected: all tests pass; no ERROR line
pnpm exec turbo run typecheck --filter=@carbon/database --filter=@carbon/jobs
# Expected: exit code 0
```

**Out of scope:** UI.

---

## Task 6: Add `resolveCoverage` and the coverage account

**Depends on:** 5
**Files:**
- Create: `packages/utils/src/service-coverage.ts`
- Create: `packages/utils/src/service-coverage.test.ts`
- Modify: `packages/utils/src/index.ts` — export it
- Modify: `packages/server-functions/src/lib/project-posting.ts` — the By Coverage branch

**Steps:**
1. `resolveCoverage` lives in `@carbon/utils`, not in `service.models.ts`, because the posting functions in `@carbon/server-functions` need it too. Task 30 records this in the spec.
2. Write it as a pure function:

```ts
export type CoverageChargeType = "Time" | "Part" | "Expense";
export function resolveCoverage(args: {
  chargeType: CoverageChargeType;
  serviceDate: string;                         // YYYY-MM-DD
  orderType: "Field Visit" | "Depot Repair" | "Refurbishment";
  laborWarrantyEndDate: string | null;
  partsWarrantyEndDate: string | null;
  componentPartsWarrantyEndDate: string | null; // the node's installed component
  hasCoverageContract: boolean;
}): "Warranty" | "Contract" | "Billable" | "Capitalized"
```

   1. A Refurbishment gives Capitalized.
   2. Time gives Warranty when `serviceDate <= laborWarrantyEndDate`.
   3. A part gives Warranty when `serviceDate <= partsWarrantyEndDate` or `serviceDate <= componentPartsWarrantyEndDate`.
   4. Else a coverage contract gives Contract.
   5. Else Billable.

   Compare dates as `YYYY-MM-DD` strings; the columns are `DATE`.
3. In `resolveProjectPostingAccount`, add the `By Coverage` branch. It takes the charge's coverage:
   - Warranty: `accountDefault.warrantyExpenseAccount`;
   - Contract: the parent project's posting account when `parentProjectId` is set, else `costOfGoodsSoldAccount`;
   - Billable: `costOfGoodsSoldAccount`;
   - Capitalized: `workInProgressAccount`.

   If the account is null, throw `ProjectChargeError` that names the missing default.
4. Write `service-coverage.test.ts` with these 6 cases from the spec:
   1. Time on 2028-02-01 with labor warranty to 2027-11-01: Billable.
   2. A part on 2028-02-01 with parts warranty to 2028-11-01: Warranty.
   3. The same time with a coverage contract: Contract.
   4. A part on 2029-01-10, parts warranty ended, component warranty to 2029-06-01: Warranty.
   5. An expense inside both warranties: Billable.
   6. A Refurbishment: Capitalized.

**Verify:**
```bash
pnpm --filter @carbon/utils test -- service-coverage && pnpm --filter @carbon/server-functions test -- project-posting
# Expected: all tests pass
```

**Out of scope:** coverage overrides (the services take a user override with a reason).

---

## Task 7: Add `buildBillableItem` to the project posting helpers

**Depends on:** 6
**Files:**
- Modify: `packages/server-functions/src/lib/project-posting.ts`
- Modify: `packages/server-functions/src/lib/project-posting.test.ts`

**Steps:**
1. Add `loadServicePostingContext(trx, { companyId, projectId, elementId })`. It returns, with at most 4 queries:
   - the service order (`type`, `customerContractId`, `customerAssetId`);
   - the asset's warranty end dates;
   - the node's installed component warranty: the `customerAssetComponent` with `removedDate IS NULL` whose `trackedEntityId` equals the node's `trackedEntityId`;
   - the service labor price: `companySettings.serviceLaborItemId` and its `itemUnitSalePrice.unitSalePrice`.
2. Add the pure `buildBillableItem({ ledgerRow, coverage, laborPrice, partPrice, description })`. It returns a `projectBillableItem` row, or null:
   - Capitalized: null.
   - Labor: quantity = hours, unit price = `laborPrice`.
   - Material: quantity, unit price = `partPrice` (the item's `itemUnitSalePrice.unitSalePrice`).
   - Other Direct: quantity 1, unit price = the amount.
   - Warranty or Contract: unit price 0, and the description gains "Covered by warranty" or "Covered by contract".
   - `amount` = `round(quantity × unitPrice)`.
3. Add the pure `reverseBillableItem(original)`:
   - Unbilled original: return `{ update: { status: "Written Off", statusReason: "Reversed" } }`.
   - Billed original: return `{ insert: <negative copy with reversalOfId> }`.
4. Add 4 tests:
   1. A 2 h Labor row at price 95.00 gives 190.00.
   2. A Warranty Material row gives price 0.
   3. Reversing an Unbilled item writes it off.
   4. Reversing a Billed item inserts −190.00.

**Verify:**
```bash
pnpm --filter @carbon/server-functions test -- project-posting
# Expected: all tests pass
```

**Out of scope:** Phase 4 contract pricing.

---

## Task 8: Post service time in `post-timesheet`

**Depends on:** 7
**Files:**
- Modify: `packages/server-functions/src/post-timesheet/index.ts`
- Modify: `packages/server-functions/src/post-timesheet/post-timesheet.test.ts`

**Steps:**
1. For an entry whose project is `Service`:
   1. Accept a `Draft` entry. Service time posts at Stop work, with no submit and no approval (spec decision 35).
   2. If `coverage` is null, compute it with `resolveCoverage` from `loadServicePostingContext`, and store it on the entry. A stored coverage with `coverageReason` is a user override; keep it.
   3. Post with the By Coverage account. Write the `projectLedger` row with `coverage`.
   4. Insert the billable item from `buildBillableItem`.
2. A correction of a service entry reverses the billable item with `reverseBillableItem`.
3. Entries of Standard projects keep the current path.
4. Add a `databaseTest`. Post a 2 h Draft entry on a Service node inside the labor warranty. Expect Dr Warranty Expense / Cr Labor Absorption at the labor category rate. Expect one ledger row with coverage Warranty and one billable item at price 0.

**Verify:**
```bash
pnpm --filter @carbon/server-functions test -- post-timesheet
# Expected: all tests pass
```

**Out of scope:** the timesheet approval setting. It applies to Standard projects only.

---

## Task 9: Post service parts and install components in `post-project-issue`

**Depends on:** 7
**Files:**
- Modify: `packages/server-functions/src/post-project-issue/index.ts`
- Modify: `packages/server-functions/src/post-project-issue/post-project-issue.test.ts`

**Steps:**
1. For an issue to a Service project node:
   1. Compute the coverage with `resolveCoverage` (chargeType `Part`), unless the request carries an override with a reason.
   2. Post with the By Coverage account. Write `coverage` on the ledger row.
   3. Insert the billable item.
2. **Install.** If the order is a Field Visit or Depot Repair with a customer asset, in the same transaction:
   1. Insert one `customerAssetComponent` per issued serial, or one row with its quantity for an untracked part. Fill item, serial, node, order and `projectLedgerId`. Set `installedDate` to the posting date. Set `partsWarrantyEndDate` to the posting date + the issued item's `partsWarrantyMonths`, or null. Read the months with one query on `itemUnitSalePrice`. Add months with `@internationalized/date` `CalendarDate.add`.
   2. If the node links a serial that is an installed component, set that component's `removedDate` and `removedByServiceOrderId`.
   3. For each issued serial, insert a `trackedActivity` of type `Service` (`sourceDocument 'Service Order'`, `sourceDocumentId` the order id). Add a `trackedActivityInput` for the issued serial and a `trackedActivityOutput` for the asset's serial. This keeps the asset's build history current.
3. **Return.** A return of a service issue reverses the billable item. It deletes the component rows that the issue wrote, and clears the removal it set.
4. Add `databaseTest`s:
   1. Issuing serial `TR-200` to a node that links the installed `TR-100` writes a component for `TR-200`, removes `TR-100`, and writes the `Service` activity.
   2. A return undoes all three.

**Verify:**
```bash
pnpm --filter @carbon/server-functions test -- post-project-issue
# Expected: all tests pass
```

**Out of scope:** core returns of the removed part.

---

## Task 10: Add `post-project-expense` and the coverage reclass

**Depends on:** 7
**Files:**
- Create: `packages/server-functions/src/post-project-expense/index.ts`
- Create: `packages/server-functions/src/post-project-expense/post-project-expense.test.ts`
- Create: `packages/server-functions/src/reclass-project-coverage/index.ts`
- Create: `packages/server-functions/src/reclass-project-coverage/reclass-project-coverage.test.ts`
- Modify: `packages/server-functions/src/invoke.ts` — register both
- Copy from (precedent): `packages/server-functions/src/post-maintenance-event/index.ts:40-276` (accounting check, posting date, journal, lines)

**Steps:**
1. Input: `{ projectExpenseEntryId }`. Permissions: `{ update: "projects" }`, as `post-project-issue` declares. The ERP invokes the charge functions through `serverFns.system(...)` (Phase 1a `projects.server.ts`). Before that, the route checks `update: "service"` for a Service project, or `update: "projects"` for a Standard one.
2. In one transaction:
   1. Load the entry and its project. If `accountingEnabled` is false, write the ledger row and the billable item with no journal.
   2. Resolve the coverage (chargeType `Expense`) for a Service project.
   3. Post Dr the treatment's account / Cr `goodsReceivedNotInvoicedAccount`, with `sourceType 'Project Expense'` and the Project, Project Element and Employee dimensions.
   4. Write a `projectLedger` row of type Other Direct and, for a Service project, the billable item.
3. A reversal entry (`reversalOfId`) posts the negative and reverses the billable item.
4. Add `reclass-project-coverage`. Input: `{ projectLedgerId, coverage, reason }`. It changes the coverage of a posted charge without moving stock or time. In one transaction:
   1. Refuse when the charge's billable item is Billed, or when the coverage does not change.
   2. Post a reclass journal: Dr the new coverage account / Cr the old one, for the ledger row's amount.
   3. Write a reversal `projectLedger` row and a new row with the new coverage and `coverageReason`. The ledger stays append-only.
   4. Reverse the old billable item and insert the new one with `buildBillableItem`.
   5. Update `coverage` and `coverageReason` on the source `timesheetEntry` or `projectExpenseEntry`, when there is one.
5. Update the permissions snapshot (`-u`) and review it.
6. Add tests:
   1. A 40.00 Billable expense posts Dr COGS / Cr GRNI = 40.00 and one billable item of 40.00.
   2. Reclass a 120.00 Warranty labor charge to Billable. Expect Dr COGS / Cr Warranty Expense = 120.00, plus a reversal ledger row and a new one. The 0.00 billable item is replaced by one at the labor price.

**Verify:**
```bash
pnpm --filter @carbon/server-functions test -- post-project-expense reclass-project-coverage permissions-manifest
# Expected: all tests pass
```

**Out of scope:** receipts or attachments on expenses (the visit's files hold them).

---

## Task 11: Create customer assets in `post-shipment`

**Depends on:** 5
**Files:**
- Modify: `packages/server-functions/src/post-shipment/index.ts`
- Create: `packages/server-functions/src/post-shipment/customer-assets.test.ts`

**Steps:**
1. In the `Sales Order` post branch:
   1. Add `"dropShipment"` and `"customerLocationId"` to the `salesOrderShipment` columns (`:192-198`).
   2. Before the transaction, read `itemUnitSalePrice` (`itemId`, `laborWarrantyMonths`, `partsWarrantyMonths`) for the shipped items with one query.
   3. Inside the transaction (`:934`), after the consumption loop closes (`:1187`), upsert one `customerAsset` per id in `serialNumbersConsumed` (`:296`, filled at `:490-492`):
      - customer: `salesOrder.data.customerId`;
      - site: `salesOrderShipment.customerLocationId` when `dropShipment`, else `salesOrder.data.customerLocationId`;
      - `shippedDate` = `today`; warranty end dates = `today` + the item's months, or null;
      - `shipmentId` = the shipment id; status `In Service`; source `Shipment`.

      On conflict (`trackedEntityId`, `companyId`), update the customer, site, ship date, shipment and status. Reset the warranty dates too: a sale is a new sale.
2. In the `Sales Return Order` post branch (RMA return to customer), add a step after the tracked entity loop (`:2388`). It updates the existing assets of the shipped serials: site, ship date, shipment and status `In Service`. It keeps the warranty dates.
3. In the Sales Order void (`:3396-3518`), set the assets that this shipment created or last moved to status `Returned`.
4. Write `customer-assets.test.ts` (`databaseTest`):
   1. Shipping serial `SN-0001` of an item with 12 and 24 warranty months on 2026-11-01 creates an asset with labor end 2027-11-01 and parts end 2028-11-01.
   2. A drop shipment takes the site from `salesOrderShipment`.
   3. Shipping the same serial again on a new sale updates the asset and resets the warranty.

**Verify:**
```bash
pnpm --filter @carbon/server-functions test -- post-shipment
# Expected: all tests pass
```

**Out of scope:** marking an asset Returned on an RMA receipt (Phase B).

---

## Task 12: Stop the second stock relief and release billable item stamps

**Depends on:** 5
**Files:**
- Modify: `packages/server-functions/src/post-sales-invoice/index.ts` (`:1279-1330`)
- Modify: `apps/erp/app/modules/sales/sales.server.ts` (`releaseRecurringInvoiceStamps` `:439-518`, `deleteSalesInvoiceReleasingRentals` `:527-571`, `deleteSalesInvoiceLineReleasingRentals` `:627-673`)
- Modify: `packages/server-functions/src/post-sales-invoice/post-sales-invoice.test.ts`

**Steps:**
1. 🛑 A part issued to a service node already left stock. But today `post-sales-invoice` also relieves stock and posts COGS for a `Service` line in one case (`:1279-1330`). The line has no `salesOrderLineId`, its method is not Make to Order, and its item is Inventory-tracked.
2. Before the line loop, read the stamped line ids with one query: `projectBillableItem` where `salesInvoiceLineId` is in the invoice's line ids.
3. Skip the stock relief and the COGS journal for those lines. Revenue posts as before.
4. In `releaseRecurringInvoiceStamps`, clear `projectBillableItem.salesInvoiceLineId` for the deleted lines and set their status back to `Unbilled`. Clear `salesInvoice.serviceOrderId`.
5. In both delete functions, add lines that a billable item stamps to the line filter (`:552-557`), so they release too.
6. Add a test. Post an invoice with a `Service` line for an Inventory part that a billable item stamps. Expect no `itemLedger` row and no COGS line.

**Verify:**
```bash
pnpm --filter @carbon/server-functions test -- post-sales-invoice && pnpm exec turbo run typecheck --filter=erp
# Expected: all tests pass; typecheck exits 0
```

**Out of scope:** other invoice sources.

---

## Task 13: Add `create-service-order-invoice`

**Depends on:** 7, 12
**Files:**
- Create: `packages/server-functions/src/create-service-order-invoice/index.ts`
- Create: `packages/server-functions/src/create-service-order-invoice/plan.ts`
- Create: `packages/server-functions/src/create-service-order-invoice/plan.test.ts`
- Modify: `packages/server-functions/src/invoke.ts`
- Copy from (precedent): `packages/server-functions/src/create-contract-invoices/index.ts` (`insertContractInvoice` `:739-863`)

**Steps:**
1. Input: `{ serviceOrderId }`. Permissions: `{ update: "service", create: "invoicing" }`.
2. Put the pure layout in `plan.ts`: `planServiceInvoiceLines({ elements, items, invoiceDetail })`:
   1. Walk the elements in tree order. Each top-level node is a `Comment` line with the node name.
   2. Each Unbilled item becomes a `Service` line: description, quantity, unit price, `itemId`.
   3. A node with `fixedPrice` gives one `Service` line at that price. Every item in its subtree gets a line at price 0 with "Included in fixed price". The fixed price applies at invoicing, so an item keeps its own price for history.
   4. With `By Node`, each top-level node gives one `Service` line with its subtree total, and no item lines.
   5. Return the lines, and for each line the billable item ids it stamps.
3. `index.ts`, in one transaction:
   1. Lock the order `FOR UPDATE`. Refuse unless the status is Completed and an Unbilled item exists.
   2. Read the sequence. Insert the opportunity, the `salesInvoice` header and `salesInvoiceShipment`, as `insertContractInvoice` does. The header takes `serviceOrderId`, the customer, the site, the order's location, and the customer's payment term and currency.
   3. Insert the lines with `invoiceLineType` from the plan and `sortOrder`.
   4. Stamp each billable item: `salesInvoiceLineId` and status `Billed`.
   5. Set the order to Closed.
4. Write `plan.test.ts`:
   1. Two top-level nodes with 2 items each give 2 comments and 4 lines in tree order.
   2. A fixed-price node of 900.00 gives one 900.00 line and its items at 0.
   3. `By Node` gives one line per top-level node with the total.
5. Update the permissions snapshot (`-u`) and review it.

**Verify:**
```bash
pnpm --filter @carbon/server-functions test -- create-service-order-invoice permissions-manifest
# Expected: all tests pass
```

**Out of scope:** tax rules beyond the customer's default, as `create-contract-invoices` does.

---

## Task 14: Hide Service projects outside Service

**Depends on:** 5
**Files:**
- Modify: `apps/erp/app/modules/projects/projects.service.ts` — `getProjects`, `getChargeableProjectElements`, the template list of `copyProject`
- Modify: the project search source (`grep -rn "\"project\"" apps/erp/app/modules/search* packages/database/supabase/migrations/*search*` to find it)
- Modify: `packages/ee/src/accounting/core/dimension-mapping.ts` (the Project label source) and the Project dimension picker
- Modify: `packages/ee/src/ramp/lib/projects.ts`, `packages/ee/src/ramp/hooks.server.ts`

**Steps:**
1. Add `.eq("projectType", "Standard")` to `getProjects`, the charge number picker and the Copy from list.
2. Exclude `projectType = 'Service'` from the search index source.
3. In the dimension picker, list only Standard projects. Journal lines keep their Project dimension, so reports still group by service order.
4. In the Ramp project sync, skip Service projects, both when pushing and in the hooks.
5. Add a test in `packages/ee/src/ramp/` (or extend the existing projects test): a Service project is not in the pushed list.

**Verify:**
```bash
pnpm --filter @carbon/ee test -- ramp && pnpm exec turbo run typecheck --filter=erp --filter=@carbon/ee
# Expected: all tests pass; typecheck exits 0
```

**Out of scope:** removing existing Service projects from Ramp (none exist before this phase).

---

## Task 15: Make My Timesheet personal

**Depends on:** 5
**Files:**
- Create: `apps/erp/app/routes/x+/timesheet.tsx`, `timesheet.update.tsx`, `timesheet.submit.tsx`, `timesheet.correct.tsx` (moved from `x+/projects+/`)
- Modify: `apps/erp/app/utils/path.ts` — `path.to.timesheet` replaces `path.to.projectTimesheet`
- Modify: `apps/erp/app/modules/projects/ui/useProjectsSubmodules.tsx`
- Modify: `apps/erp/app/modules/projects/ui/Timesheet/TimesheetGrid.tsx`

**Steps:**
1. Move the Phase 1a timesheet routes out of the projects layout, so they need only an employee role, not `projects_view`. Keep a redirect from `/x/projects/timesheet`.
2. The loader reads the user's entries of every project type. A Service row shows the order's readable id and links to `path.to.serviceOrder(id)`. A Standard row links to the element.
3. Rows of Service projects are read-only in the grid: the visit page posts them (Task 24).
4. Link **My Timesheet** from both the Projects and the Service navigation, and from the user menu.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exit code 0
```

**Out of scope:** the MES timesheet (it already reads the employee's entries).

---

## Task 16: Add the service models and services

**Depends on:** 5
**Files:**
- Create: `apps/erp/app/modules/service/service.models.ts`, `service.service.ts`, `types.ts`, `index.ts`
- Create: `apps/erp/test/service-models.test.ts`

**Steps:**
1. Add these validators to `service.models.ts`:
   - `customerAssetValidator`: item, serial, customer, site, ship date, warranty dates, notes;
   - `serviceOrderValidator`: type (Field Visit only in Phase A), subject asset, contact, location, coverage contract, priority, problem, template or build source;
   - `serviceVisitValidator`: technician, planned start and end;
   - `serviceVisitStatusValidator`;
   - `coverageOverrideValidator`: coverage, and a required reason.
2. Add the pure `rollUpOrderStatus(order, visits)` (spec *Lifecycle*):
   - It keeps On Hold, Completed, Closed and Cancelled as the user set them.
   - A Traveling or On Site visit, or a Completed visit with work not complete, gives In Progress.
   - A Scheduled visit and none started gives Scheduled.
   - No visit gives Draft.
3. `service.service.ts` (client first, `{data, error}`):
   - `getCustomerAssets(client, companyId, args)` with filters customer, item, warranty status (In warranty, Labor ended, Expired) and serial search; `getCustomerAsset`; `upsertCustomerAsset` (site, warranty dates, notes).
   - `getCustomerAssetComponents(client, assetId, companyId)`.
   - `getCustomerAssetHistoryByComponent(client, assetId, companyId)`: one query over the asset's orders' elements and their ledger rows, grouped by the element's `trackedEntityId`, else `itemId`. It returns hours, part cost, cost and the last posting date per component.
   - `getServiceOrders(client, companyId, args)`; `getServiceOrder` (with the asset, the item, the customer, the site and the contract); `updateServiceOrder` (Draft fields, problem, resolution, invoice detail).
   - `getServiceVisits(client, companyId, { technicianId, from, to, status })`; `upsertServiceVisit`.
   - `getServiceBillableItems(client, projectId, companyId)`; `updateServiceBillableItem` (unit price, hold, write-off with reason; Unbilled only).
4. Write `service-models.test.ts` with 4 cases for `rollUpOrderStatus`, one per rule.

**Verify:**
```bash
pnpm --filter erp test -- service-models && pnpm exec turbo run typecheck --filter=erp
# Expected: 4 passed; typecheck exits 0
```

**Out of scope:** Depot Repair and Refurbishment validators.

---

## Task 17: Add `createServiceOrder` and the status roll-up

**Depends on:** 16
**Files:**
- Create: `apps/erp/app/modules/service/service.server.ts`
- Modify: `apps/erp/app/modules/projects/projects.server.ts` — `createServiceProject`

**Steps:**
1. `createServiceProject(trx, { companyId, userId, serviceOrder })` inserts, in the caller's transaction:
   - the project, with these values:
     - `projectType 'Service'`, status Released, treatment By Coverage;
     - `identifier` = the order's readable id, and the name "<serial> — <customer>";
     - `customerId` and `locationId` from the order;
     - `parentProjectId` = the coverage contract's `projectId`;
   - the default states, as Phase 1a seeds them.
2. `createServiceOrder(db, args)` in `service.server.ts`, in one Kysely transaction:
   1. Read the `serviceOrder` sequence.
   2. Check the subject: an `In Service` customer asset of the customer.
   3. Propose the coverage contract when the customer has exactly one Active contract and none was chosen.
   4. Insert the order with status Draft, then call `createServiceProject` and set `serviceOrder.projectId`.
   5. If the user chose a template or a build source, call `buildElementsFromPart` (projects Phase 1b) with the order's project. Pass the template project for a template, the asset's serial for the build history, or the asset's item for the make method.
3. `registerCustomerAsset(db, args)` runs one transaction. It inserts a `trackedEntity` and the asset with source `Manual`. The tracked entity has status `Consumed`, quantity 1, the `itemId`, `readableId` = the typed serial, `sourceDocument 'Item'` and `sourceDocumentId` = the item.
4. `syncServiceOrderStatus(db, { serviceOrderId })` computes `rollUpOrderStatus` and saves it. Then it sets the project status:
   - On Hold → On Hold;
   - Completed → Technically Complete;
   - Closed or Cancelled → Closed;
   - any other status → Released. Call it after every visit change and every order status change.
5. `cancelServiceOrder`: refuse while the project has a posted ledger row.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exit code 0
```

**Out of scope:** Depot Repair creation from an RMA (Phase B).

---

## Task 18: Add the Service module navigation and layout

**Depends on:** 5
**Files:**
- Modify: `apps/erp/app/hooks/useModules.tsx` — a **Service** entry (`permission: "service"`)
- Create: `apps/erp/app/modules/service/ui/useServiceSubmodules.tsx`
- Create: `apps/erp/app/routes/x+/service-orders+/_layout.tsx`
- Modify: `apps/erp/app/utils/path.ts`
- Copy from (precedent): `apps/erp/app/modules/workflows/ui/useWorkflowsSubmodules.tsx:12-60`; `apps/erp/app/routes/x+/workflows+/_layout.tsx:20-38`

**Steps:**
1. Add the path helpers: `serviceOrders`, `newServiceOrder`, `serviceOrder(id)`, `serviceOrderDetails(id)`, `serviceOrderWork(id)`, `serviceOrderVisits(id)`, `serviceVisit(orderId, visitId)`, `serviceOrderInvoice(id)`, `serviceOrderEstimate(id)`, `serviceOrderStatus(id)`, `myVisits`, `serviceSchedule`, `customerAssets`, `newCustomerAsset`, `customerAsset(id)`, `customerAssetsTab(customerId)`, `serviceTemplates`.
2. The submodules are grouped as **Work** (Service Orders, My Visits, Schedule), **Installed base** (Customer Assets) and **Setup** (Service Templates, plus My Timesheet from Task 15).
3. The layout's handle is `{ breadcrumb: msg\`Service\`, to: path.to.serviceOrders, module: "service", sidebar }`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exit code 0
```

**Out of scope:** the pages (Tasks 19–27).

---

## Task 19: Add the customer asset pages and the customer Assets tab

**Depends on:** 16, 17, 18
**Files:**
- Create: `apps/erp/app/routes/x+/service-orders+/assets.tsx`, `assets.new.tsx`, `assets.$assetId.tsx`
- Create: `apps/erp/app/routes/x+/customer+/$customerId.assets.tsx`
- Create: `apps/erp/app/modules/service/ui/CustomerAssets/CustomerAssetsTable.tsx`, `CustomerAssetForm.tsx`, `CustomerAssetPage.tsx`, `ComponentHistory.tsx`
- Modify: `apps/erp/app/modules/sales/ui/Customer/CustomerSidebar/useCustomerSidebar.tsx` — an **Assets** item with `permission: { action: "view", module: "service" }`
- Copy from (precedent): `apps/erp/app/routes/x+/sales+/rmas.tsx` (list); `apps/erp/app/routes/x+/customer+/$customerId.risks.tsx:10-23` (a tab); Bank Accounts in `useCustomerSidebar.tsx:68-74` (a tab gated by permission)

**Steps:**
1. The list shows item, serial, customer, site, ship date, a warranty badge (In warranty, Labor ended, Expired) and the count of open orders.
2. **New** registers a unit sold before Carbon with `registerCustomerAsset`. It needs `create: "service"`.
3. The asset page shows:
   - the warranty with both end dates (editable with `update: "service"`), the shipment, the site;
   - **Installed components**: item, serial, installed date, parts warranty end, removed date;
   - **History by order**: each order with status, dates and cost;
   - **History by component** from `getCustomerAssetHistoryByComponent`;
   - **New service order**, which opens the new form with the asset filled.
4. The customer **Assets** tab lists the customer's assets with the same table.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exit code 0
```

**Out of scope:** an asset tree (assets inside assets).

---

## Task 20: Add the service order list, new form and document page

**Depends on:** 16, 17, 18
**Files:**
- Create: `apps/erp/app/routes/x+/service-orders+/_index.tsx`, `new.tsx`
- Create: `apps/erp/app/routes/x+/service-order+/$id.tsx`, `$id.details.tsx`, `$id.status.tsx`
- Create: `apps/erp/app/modules/service/ui/ServiceOrders/ServiceOrdersTable.tsx`, `ServiceOrderForm.tsx`, `ServiceOrderHeader.tsx`, `ServiceOrderProperties.tsx`
- Copy from (precedent): `apps/erp/app/routes/x+/sales-return-order+/$id.tsx` (document layout); `SalesReturnOrderHeader.tsx`; `apps/erp/app/modules/quality/ui/Issue/IssueProperties.tsx` (inline properties)

**Steps:**
1. The list columns: id, status, customer, subject serial, item, site, next visit, coverage contract, assignee. Filters on status, technician and customer.
2. The new form has these fields:
   - customer asset (search by serial), contact, the company location;
   - coverage contract (proposed), priority, problem;
   - **Start from**: Empty, Service template, the unit's build history, or the item's bill of materials. The action calls `createServiceOrder`.
3. The document page:
   - the header: id, status, the warranty badge, and the actions **Put on hold**, **Complete**, **Create invoice**, **Print estimate**, **Close**, **Cancel**, each shown by status;
   - the properties panel: customer, site, contact, coverage contract, priority, assignee, invoice detail, dates;
   - the details content: **Subject** (serial, item, warranty, asset link), **Work** (Task 21), **Visits** (Task 22), **Problem** and **Resolution** (rich text), **Files**, **Activity**.
4. `$id.status.tsx` is action-only. It requires `update: "service"` and calls `syncServiceOrderStatus` after the change.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exit code 0
```

**Out of scope:** Depot Repair and Refurbishment forms.

---

## Task 21: Add the Work section

**Depends on:** 8, 9, 10, 16, 17, 18
**Files:**
- Create: `apps/erp/app/routes/x+/service-order+/$id.work.tsx`
- Create: `apps/erp/app/routes/x+/service-order+/$id.work.$elementId.tsx` (the node peek)
- Create: `apps/erp/app/routes/x+/service-order+/$id.charge.tsx` (time, part and expense actions)
- Create: `apps/erp/app/modules/service/ui/Work/WorkTree.tsx`, `NodePeek.tsx`, `AddExpenseModal.tsx`
- Reuse: the projects `ElementList`, `LogTimeModal`, `IssueMaterialModal`, `PartLink` and `BuildFromPartDrawer`

**Steps:**
1. `WorkTree` renders the order's project elements with the projects List layout. Hide the engineering types: the type menu offers System, Task and Folder only. Columns: node, coverage mix, hours, part cost, cost, billable amount, fixed price.
2. A node opens `NodePeek` with:
   - **Log time**, **Issue material** (defaults to the user's van, `employeeJob.defaultStorageUnitId`) and **Add expense**;
   - the node's charges with coverage pills;
   - **Override coverage** on a charge that is not yet billed, with a reason (`coverageOverrideValidator`). It invokes `reclass-project-coverage` (Task 10);
   - the part link and, for a linked component, its last service date.
3. The charge route switches on `intent`:
   - `time`: insert a Draft `timesheetEntry` on the node with the visit (if any), then invoke `post-timesheet`;
   - `part`: invoke `post-project-issue`;
   - `expense`: insert a `projectExpenseEntry`, then invoke `post-project-expense`.

   It requires `update: "service"`, plus `update: "inventory"` for a part.
4. The section header has **Build tree** (`BuildFromPartDrawer` with the asset's serial and item preselected) and **Print estimate**.
5. Copy says "node" and "work", never "element" or "project".

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exit code 0
```

**Out of scope:** the Board, Tree, Timeline and Reader layouts for service.

---

## Task 22: Add visits and the Schedule page

**Depends on:** 16, 17, 18
**Files:**
- Create: `apps/erp/app/routes/x+/service-order+/$id.visits.tsx`, `$id.visits.new.tsx`, `$id.visits.$visitId.status.tsx`
- Create: `apps/erp/app/routes/x+/service-orders+/schedule.tsx`
- Create: `apps/erp/app/modules/service/ui/Visits/VisitsList.tsx`, `ScheduleVisitModal.tsx`, `ServiceSchedule.tsx`

**Steps:**
1. **Schedule visit** sets the technician and the planned window. Use the existing date and time inputs; store `TIMESTAMP WITH TIME ZONE` values from the company timezone with `@internationalized/date`.
2. The status action stamps `travelStartedAt`, `arrivedAt` or `completedAt`. **Complete** asks **Work complete?**:
   - Yes: the order's work is complete, so `rollUpOrderStatus` gives Completed.
   - No: the order stays In Progress.

   Then it calls `syncServiceOrderStatus`.
3. **Schedule** groups visits by day, then by technician, with filters for status and technician. A row opens the visit page.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exit code 0
```

**Out of scope:** drag-and-drop scheduling.

---

## Task 23: Add the `SignaturePad` component

**Depends on:** none
**Files:**
- Create: `packages/react/src/SignaturePad.tsx`
- Create: `packages/react/src/SignaturePad.test.tsx`
- Modify: `packages/react/src/index.tsx` — export it

**Steps:**
1. No signature or canvas pad exists in the repo. Write one with no new dependency:
   - a `<canvas>` sized to its container, scaled by `window.devicePixelRatio`;
   - pointer events (`pointerdown`, `pointermove`, `pointerup`) with `setPointerCapture`, so mouse, pen and touch work; `touch-action: none` on the canvas;
   - smooth strokes with quadratic curves between points;
   - **Clear**, and `onChange(isEmpty)`;
   - an imperative `toBlob(): Promise<Blob>` (PNG) through a ref.
2. Props: `className?`, `strokeColor?` (default the theme foreground), `onChange?`, `disabled?`.
3. Test: rendering shows the canvas and a Clear button; Clear calls `onChange(true)`.

**Verify:**
```bash
pnpm --filter @carbon/react test -- SignaturePad && pnpm exec turbo run typecheck --filter=@carbon/react
# Expected: all tests pass; typecheck exits 0
```

**Out of scope:** signature verification.

---

## Task 24: Add My Visits and the visit page

**Depends on:** 21, 22, 23
**Files:**
- Create: `apps/erp/app/routes/x+/service-orders+/my-visits.tsx`
- Create: `apps/erp/app/routes/x+/service-order+/$id.visits.$visitId.tsx`
- Create: `apps/erp/app/routes/x+/service-order+/$id.visits.$visitId.signature.tsx`
- Create: `apps/erp/app/modules/service/ui/Visits/MyVisits.tsx`, `VisitPage.tsx`, `NodePicker.tsx`, `WorkTimer.tsx`
- Copy from (precedent): `apps/erp/app/components/FileDropzone.tsx` (photos, HEIC conversion); `apps/erp/app/components/ItemThumnailUpload.tsx:157-186` (upload, then save the path)

**Steps:**
1. Both pages are phone-first. Use `useIsMobile`, one column, and touch targets of at least 44 px. Test at 390 px.
2. **My Visits** lists the signed-in technician's visits for today and the next 7 days. Each card shows customer, site address (a map link), serial, window and status.
3. **The visit page**, top to bottom:
   1. Status buttons: **Start travel** → **Arrive** → **Complete**.
   2. The subject: item, serial, warranty badge, and the last 3 orders of the asset.
   3. `NodePicker`: the work tree as an indented list. The selected node is the target of the next 3 actions. Each node shows its component's last service date.
   4. `WorkTimer`: **Start work** / **Stop work**, or **Add time**. Stop work posts the time through the charge route (Task 21) with the visit.
   5. **Issue part** (defaults to the van) and **Add expense**.
   6. Notes (rich text, saved on the visit).
   7. Photos: `FileDropzone`, uploaded to `${companyId}/service/${orderId}/${visitId}/` in the company private bucket.
   8. **Signature**: `SignaturePad` and a "Signed by" name. The signature route uploads the PNG to `${companyId}/service/${orderId}/${visitId}/signature.png` and saves `signaturePath` and `signedByName`.
   9. **Complete**, with **Work complete?**
4. A technician without `service_update` can work only their own visits (RLS, Task 5). The page hides the actions for others.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exit code 0
```

**Out of scope:** offline mode.

---

## Task 25: Add invoicing and the billable item review

**Depends on:** 13, 21
**Files:**
- Create: `apps/erp/app/routes/x+/service-order+/$id.invoice.tsx`
- Create: `apps/erp/app/routes/x+/service-order+/$id.billing.tsx`
- Create: `apps/erp/app/modules/service/ui/Billing/BillableItemsTable.tsx`
- Modify: `apps/erp/app/modules/service/ui/Work/NodePeek.tsx` — the fixed price field

**Steps:**
1. The billing section lists the order's billable items grouped by node, with coverage, quantity, unit price, amount and status. An Unbilled item allows **Edit price**, **Hold** and **Write off** (reason required).
2. A node's **Fixed price** (`projectElement.fixedPrice`) is editable while the order is not Closed.
3. **Create invoice** (header action) invokes `create-service-order-invoice`, then redirects to the Draft invoice. An order with no Unbilled item shows **Close** instead.
4. The **Invoice detail** property chooses Itemized or By Node.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exit code 0
```

**Out of scope:** credit memos for billed items (a reversal creates a negative Unbilled item for the next invoice).

---

## Task 26: Add Print estimate

**Depends on:** 21
**Files:**
- Create: `packages/documents/src/pdf/ServiceEstimatePDF.tsx`
- Create: `apps/erp/app/routes/file+/service-estimate+/$id[.]pdf.tsx`
- Copy from (precedent): the sales quote PDF component in `packages/documents/src/pdf/` and its `file+` route (find them with `grep -rln "QuotePDF" packages/documents/src apps/erp/app/routes/file+`)

**Steps:**
1. Read `.claude/rules/pdf-generation-patterns.md` and `packages/documents/AGENTS.md` first.
2. The estimate lists the tree in order. Each node shows its plan lines priced at sale prices: labor at the service labor item's price, materials at `itemUnitSalePrice.unitSalePrice`, other costs at their amount. A fixed-price node shows one line at its price.
3. The header shows the customer, the site, the unit (item and serial), the warranty and the date.
4. The route requires `view: "service"`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp --filter=@carbon/documents
# Expected: exit code 0
```

**Out of scope:** customer approval of the estimate.

---

## Task 27: Add service templates

**Depends on:** 21
**Files:**
- Create: `apps/erp/app/routes/x+/service-orders+/templates.tsx`, `templates.new.tsx`, `templates.$id.tsx`
- Modify: `apps/erp/app/modules/service/service.server.ts` — `createServiceTemplate`

**Steps:**
1. A service template is a project with `projectType 'Service'` and `isTemplate = true`. Its identifier is `TPL-` plus the first 6 characters of its id in capitals, so its nodes read `TPL-4F9A2C-3`.
2. The list shows name, node count and use count.
3. The template page reuses `WorkTree` with plan lines (materials, labor, other costs) per node, so the estimate has prices.
4. The new order form's **Start from → Service template** lists these templates only.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exit code 0
```

**Out of scope:** templates per item.

---

## Task 28: Add the settings fields

**Depends on:** 5
**Files:**
- Modify: `apps/erp/app/modules/items/items.models.ts` (`itemUnitSalePriceValidator` `:812-822`), `apps/erp/app/modules/items/ui/Item/ItemSalePriceForm.tsx`, and the five `$itemId.sales.tsx` routes (`part+`, `tool+`, `material+`, `consumable+`, `service+`)
- Modify: `apps/erp/app/modules/items/items.service.ts` (`upsertItemUnitSalePrice` `:4546-4557`)
- Modify: `apps/erp/app/modules/settings/settings.models.ts`, `settings.service.ts`, `apps/erp/app/routes/x+/settings+/invoicing.tsx`
- Modify: `apps/erp/app/modules/accounting/accounting.models.ts` (`defaultIncomeAcountValidator` `:491`), `apps/erp/app/modules/accounting/ui/AccountDefaults/AccountDefaultsForm.tsx` (`:490-525`)
- Modify: `apps/erp/app/modules/people/people.models.ts` (`employeeJobValidator` `:44-51`), `apps/erp/app/modules/people/ui/Person/PersonJob.tsx`, `apps/erp/app/modules/people/people.service.ts` (`updateEmployeeJob` `:632`, add the column to its allow-list)

**Steps:**
1. **Item sales settings:** **Labor warranty (months)** and **Parts warranty (months)**, whole numbers ≥ 0. Add them to the validator, the form and the upsert. While there, add `.eq("companyId", companyId)` to `upsertItemUnitSalePrice`, which filters by `itemId` only.
2. **Settings → Invoicing:** a **Service labor item** picker (`Item` with `validItemTypes={["Service"]}`), with intent `serviceLabor`, saved by `updateServiceLaborItemSetting`.
3. **Account defaults:** **Warranty Expense** in the expenses section.
4. **Employee job:** **Van (default storage unit)** with the `StorageUnit` picker (`apps/erp/app/components/Form/StorageUnit.tsx`), filtered by the job's location.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exit code 0
```

**Out of scope:** warranty by customer.

---

## Task 29: Extend the demo datasets

**Depends on:** 11, 17, 27
**Files:**
- Modify: `packages/database/src/datasets/types.ts` — `SalesData` gains `customerAssets` and `serviceOrders`
- Modify: `packages/database/src/datasets/tiers/04-sales.ts`
- Modify: `packages/database/src/datasets/data/{satellite,robotics,precision,motor}/sales.ts`
- Modify: `packages/database/src/datasets/coverage.ts`, `packages/database/src/datasets/validate.ts`

**Steps:**
1. The datasets ship no serials to customers (`ShipmentSpec` lines are untracked). So register customer assets the way `registerCustomerAsset` does: a `trackedEntity` with status `Consumed` and a `customerAsset` with source `Manual`. Seed 3 per dataset, with warranty dates set by day offsets: one in warranty, one with labor ended, one expired.
2. Seed one service template per dataset with 3 nodes and plan lines.
3. Seed 2 service orders per dataset, each with its Service project and states:
   - one Scheduled order with the template's tree and a visit tomorrow;
   - one Draft order with no visit.

   Seed no charges: posted charges need hand-authored journals, ledger rows and billable items (*Posted documents carry their downstream rows*), which is later work.
4. Add the service statuses to the `COVERAGE` sets that apply (the order statuses Draft and Scheduled; list the others in `except` with a reason).
5. Measure and add `customerAsset`, `serviceOrder` and `serviceVisit` to `COVERAGE_FLOORS`.
6. Run `pnpm db:check:datasets`.

**Verify:**
```bash
pnpm db:check:datasets
# Expected: all four datasets pass
```

**Out of scope:** posted service charges in the datasets.

---

## Task 30: Update the rules, AGENTS.md, docs and specs

**Depends on:** 1–29
**Files:**
- Create: `.claude/rules/field-service.md` (with `paths:` for `apps/erp/app/modules/service/**`, the service server functions and the post-shipment asset code)
- Modify: `.claude/rules/projects-system.md`, `.claude/rules/authz-manifest.md` (`projectModule`), `.claude/rules/traceability-model.md` (the `Service` activity)
- Create: `apps/erp/app/modules/service/AGENTS.md` (use the `create-agents-md` skill)
- Modify: `AGENTS.md` (the Task Router: a Field service row)
- Create: `docs/content/docs/reference/service-orders.mdx`, `customer-assets.mdx`
- Modify: `.ai/specs/2026-10-08-field-service.md`, `.ai/specs/2026-10-03-projects.md`

**Steps:**
1. Document only committed code. Ground every claim in a file.
2. In the field service spec, record these decisions:
   1. **`resolveCoverage` location:** `@carbon/utils`, because posting functions need it.
   2. **Fixed prices:** applied at invoicing; items keep their own price.
   3. **Service time posting:** `post-timesheet` posts Draft entries of Service projects.
   4. **Second stock relief:** `post-sales-invoice` skips stock and COGS on lines that billable items stamp.
   5. **My Timesheet:** moved to `x+/timesheet`.
   6. **RLS:** the `projectModule` rule piece decides between `projects_*` and `service_*`.
3. Mark Phase A done in the spec's delivery phases.
4. Run the STE-80 review pass on every `.ai/` file you changed.

**Verify:**
```bash
cd docs && pnpm typecheck
# Expected: exit code 0
pnpm --filter @carbon/checks license-headers
# Expected: no files changed
```

**Out of scope:** the changelog entry.

---

## Task 31: Verify in the browser

**Depends on:** 1–30
**Files:**
- Create: `.ai/playbooks/field-service-phase-a.md` (written by `/test`)

**Steps:**
1. Run `/test` on a satellite dataset company with accounting on. Test the phone pages at 390 px wide.
2. Cover the spec's Phase A acceptance criteria:
   1. **Asset at shipment:** ship a serial of an item with 12 and 24 warranty months. The asset has the right end dates and shows on the customer's Assets tab.
   2. **Manual registration** creates a Consumed serial and an asset with source Manual.
   3. **Work tree:** a Field Visit from the *Engine rebuild* template gets the nodes Engine, Cylinders, Boring and Transmission.
   4. **Charges on any node:** time on Boring and Engine and a part on Transmission roll up correctly.
   5. **Coverage:**
      - Time after the labor warranty is Billable.
      - A part inside the parts warranty is Warranty.
      - A coverage contract makes the time Contract.
      - An override needs a reason.
   6. **Component warranty:** a part on a node whose component is inside its own warranty is Warranty.
   7. **Install and replace:** issuing `TR-200` to the node that links `TR-100` installs it and removes `TR-100`.
   8. **Visits drive status:** Scheduled, In Progress, then Completed after **Work complete? Yes**.
   9. **Time posting:** Stop work after 2 h posts Dr Warranty Expense / Cr Labor Absorption at once.
   10. **Invoice:** the Draft invoice follows the tree, covered items show 0, a fixed-price node gives one line, and posting it relieves no stock.
   11. **Phone:** My Visits and the full visit flow work at 390 px, and the signature saves as a PNG.
   12. **Roles:** a user with `sales_view` only sees orders and assets read-only; a Projects-only user sees no service order in Projects.
3. Save the playbook to `.ai/playbooks/field-service-phase-a.md`.

**Verify:**
```bash
ls .ai/playbooks/field-service-phase-a.md
# Expected: the file exists, and the /test run reports every step passed
```

**Out of scope:** Phases B, C and D.

## Execution notes

- Prerequisite check: the Phase 1a, 1b and 1c artifacts this plan names exist (`projectElement`, `projectLedger`, `timesheetEntry`, `post-timesheet`, `post-project-issue`, `project-posting.ts`, part links, `buildElementsFromPart`). Each migration is applied with `pnpm db:migrate` before its commit, and the regenerated types, swagger and MCP digest go in the same commit, as in Phases 1a–1c.
- Task 1: the new `journalEntrySourceType` value `Project Expense` broke the `@carbon/ee` and `erp` typechecks, so this commit fixes the enum mirrors. `POSTING_POLICY` gains `Project Expense` (journal, `defaultEnabled: true`, like `Timesheet` and `Project Issue`; the open follow-up on those defaults covers it too), and `posting-policy.test.ts` lists it. `journalEntrySourceTypes` (`accounting.models.ts`) gains it, and `JournalEntrySourceTypeIcon` shows it as `LuHandCoins`. The new `projectCostTreatment` value `By Coverage` broke `$projectId.details.tsx`, whose form offers 4 treatments; the route shows Expense for it, as it did for Capitalize in Phase 1a. A Service project never opens that page (Task 14), and its CHECK refuses any other treatment on save.
- Task 2: the identifier CHECK is `project_identifier_check` (`20261009054539_projects-workspace.sql`), and it allows a NULL identifier. The new CHECK keeps that name and the NULL branch: `"identifier" IS NULL OR "projectType" = 'Service' OR "identifier" ~ '^[A-Z][A-Z0-9]{1,5}$'`. `project` also gains `project_parent_check` (no self parent), as `projectElement_parent_check` does.
- Task 2: `projectExpenseEntry` gains `updatedBy` and `updatedAt`; the database conventions require `updatedBy` on every table with `createdBy`. Its `journalId` references `journal` (`ON DELETE SET NULL`) and `reversalOfId` the table itself, as on `timesheetEntry`. `projectBillableItem.reversalOfId` references the table itself, and `customerContractLineId` references `customerContractLine` (composite, `ON DELETE SET NULL ("customerContractLineId")`), so neither needs an `ID_REF_COLUMNS` entry. `salesInvoiceLine` has a single-column primary key, so its FK stays single-column, as the plan writes it. Every FK column is indexed as its full column list, and `timesheetEntry.serviceVisitId` is indexed here.
- Task 2: `pnpm db:migrate` applied the migration, then its `authz sync` step failed because `projectExpenseEntry` and `projectBillableItem` have no manifest rule until Task 5 (as in Phase 1a Tasks 3–7). The migration is recorded in `supabase_migrations.schema_migrations`.
- Task 3: every tenant row id column of the four tables has an FK, so the backup restore remaps it and `ID_REF_COLUMNS` needs no entry (the Phase 1b Task 3 and 1c Task 2 precedent). The spec left these without one: `customerAsset.shipmentId` → `shipment` and `serviceOrder.salesInvoiceId` → `salesInvoice` (single-column, `ON DELETE SET NULL`), `serviceOrder.serviceTemplateId` → `project`, and `customerAssetComponent.projectElementId`, `projectLedgerId` and `removedByServiceOrderId` (composite, `ON DELETE SET NULL (<col>)`). `salesInvoice.serviceOrderId` is composite too. `serviceOrder.trackedEntityId` already had an FK in the spec.
- Task 3: `customerAssetComponent` gains `updatedBy` and `updatedAt` (the spec had `createdBy` only). `serviceVisit` gains `serviceVisit_window_check` (planned end not before planned start) and an index on `(companyId, technicianId, plannedStart)` for My Visits and Schedule. The nullable `customerLocationId` and `customerContactId` FKs are `ON DELETE SET NULL`. Every FK column has an index.
- Task 3: the new `salesInvoice.serviceOrderId` column reaches the workflow catalog. `pnpm generate:workflow-catalog` added its property and label (`events.generated.ts`, `labels.generated.ts`); the `/translate` pass at the end of the run fills the new `.po` entry.
- Task 4: `service_view` copies the user's `sales_view` company list (a permission is a list of company ids, not a boolean). A second UPDATE adds every company where the user is an active Admin employee (an `employee` row of type Admin with a `userToCompany` row) to all four `service_*` lists. The plan's `employeeTypePermission` row only reaches users whose permissions are rebuilt later; without the UPDATE no existing Admin could create a service order. `apiKey` scopes are left alone (plan: out of scope).
- Task 4: the backfill keeps a serial by `item.itemTrackingType = 'Serial'`, not `trackedEntity.quantity = 1`. The spec says every serialized item, and a batch of one unit also has quantity 1. It joins `salesOrder` on `companyId` too, and takes the customer from the shipment, else the sales order; a row with neither is skipped (`customerId` is NOT NULL). The local database has no shipped serial, so the backfill inserted 0 rows.
- Task 4 Verify: `/tmp/kpsql` returned 0 rows with a NULL `warrantyExpenseAccount`. Account 6120 sits under Operating Expenses, the `serviceOrder` sequence exists, and the Admin user holds all four `service_*` permissions. `pnpm db:migrate` applied the migration, then `authz sync` failed on the tables still without a rule (Task 5).
- Task 5 (🛑 behavior decision): `projectModule` keeps a Standard project readable by any employee, as `company("projects")` read it before. The plan's piece would have read Standard rows with `projects_view`. That would have hidden projects from every employee without it: MES operators reading charge numbers for My Timesheet, purchasing users on the PO line picker, and the project names embedded in a timesheet. So the piece takes a `standard` actor (default `projects_<action>`), and the project tables pass `standard: "employee"` for reads. Writes need `projects_<action>` (Standard) or `service_<action>` (Service), and reads of a Service project need `service_view`. `timesheetEntry` keeps `projects_view` for Standard reads, because it had that before. The plan's first pgTAP case ("not a Standard project's elements") therefore reads: a `service_*` user cannot add or update a Standard element, and an employee with neither permission still reads a Standard element but no Service element.
- Task 5: `projectModule(column, action, { standard?, via? })` (`rules.ts`) compiles to an `EXISTS` on `project` pinned to the row's company. On `project` itself, the row's own `projectType` and `companyId` decide; an `EXISTS` on the table a policy guards would recurse. `projectElementComment` and `projectElementLabel` have no `projectId`, so `via: "projectElement"` joins the element to its project. The manifest's `projectTable(column, via)` builds the four policies. The comment rule keeps its author-only update and delete, and its insert also needs the element's project to be readable.
- Task 5: the Phase 1b and 1c project tables (`projectView`, `projectUserPreference`, `projectBaseline`, `projectChangeRequest*`) keep their rules; the plan's list leaves them out, and a Service order uses none of them.
- Task 5 step 6: no `ID_REF_COLUMNS` entry was added. Every column the step names has an FK (Task 3 note), so the backup restore remaps it. `pnpm db:check:backups` passes.
- Task 5: `authz migration field-service-rls` wrote `20261009154248_field-service-rls.sql` for 19 tables, and a second `pnpm db:migrate` recorded it. `vitest run src/authz` passes (35, with 2 new render tests for `projectModule`). The full `@carbon/database` suite passes (412). `authz-pieces.test.sql` passes with the new `projectModule` case (26 assertions), and `authz-fixes` and `journal-update-tenant-check` still pass. The pgTAP scripts were run through `/tmp/kpsql` (no `psql` binary). `@carbon/database`, `@carbon/jobs`, `@carbon/server-functions` and `erp` typecheck green.
- Task 6: `resolveCoverage` types its order type and result with the generated enums (`ServiceOrderType`, `ServiceCoverage`, both exported from `@carbon/utils`). `resolveProjectPostingAccount` takes the coverage as an optional third argument; a By Coverage charge without one is refused ("A charge on a service order needs a coverage"), and so is every caller that does not pass one yet (a PO line, a job or a charge line on a Service project).
- Task 6: the Contract branch needs the parent project's account, so `ProjectPostingContext` gains `parent` (the parent project's own context) and the project gains `parentProjectId`. `loadProjectPostingContexts` loads the parents with one more call, one level deep, only when a project names a parent; the defaults query also reads `warrantyExpenseAccount`, `costOfGoodsSoldAccount` and `workInProgressAccount`. A Statistical contract project has no account, so a Contract charge then posts to Cost of Goods Sold.
- Task 6: the SQL mirror `project_posting_account` did not change. It raises "Cost treatment By Coverage is not available yet", which is right: job completion and backflush (its only callers) never charge a Service project in Phase A, and the SQL has no coverage to decide with.
- Task 6: `project-posting.test.ts` adds 3 By Coverage cases beside the plan's 6 `resolveCoverage` cases. The project server-function tests (61) and the `@carbon/utils` suite (613) pass. `@carbon/utils`, `@carbon/server-functions`, `@carbon/jobs`, `erp` and `mes` typecheck green.
- Task 7: `loadServicePostingContext` runs 3 queries, not 4: the order joins its asset's warranty dates, the labor item joins its sale price (`companySettings` → `itemUnitSalePrice`), and the component query joins the node's serial to the asset's open component. It returns null when no service order owns the project. It also returns `componentId` and `laborItemId`, for Task 9's replace step and the invoice.
- Task 7: `buildBillableItem` returns null for a cost type other than Labor, Material and Other Direct, as well as for Capitalized. A covered item's description gains " (Covered by warranty)" or " (Covered by contract)"; the contract's readable id waits for the invoice (Task 13). A null labor or part price gives price 0. `reverseBillableItem(original, { projectLedgerId?, createdBy? })` points the negative copy at the reversing ledger row when given (the original's otherwise; the unique index skips reversal rows). An On Hold item is written off like an Unbilled one, and a Written Off item needs nothing.
- Task 7: a throwaway vitest run against this worktree's database (rolled back) built a Service project with an order, an asset (labor warranty to 2027-11-01, parts to 2028-11-01), a node linked to an installed component (parts warranty to 2029-06-01) and a labor item at 95.00. `loadServicePostingContext` returned all of them, no component without an element, and null for a project with no order. The script was not committed. The project server-function tests (42) pass; `@carbon/server-functions`, `@carbon/jobs` and `erp` typecheck green.
- Task 8: `loadServicePostingContext` became a wrapper over the new `loadServicePostingContexts(trx, companyId, refs)`. It loads every ref in 3 queries, keyed by `projectPostingKey`, so a post of many entries does not query in a loop. The context gains `customerId`. `serviceChargeCoverage(service, chargeType, date)` wraps `resolveCoverage` for the three posters.
- Task 8: `buildProjectLedgerRow` takes `coverage` and `coverageReason`, and `reverseProjectLedgerRows` copies them to the reversal row. Both are null on every Standard row, so those paths write what they wrote before.
- Task 8: a reversal entry posts at its original's coverage and stores it, so it credits the account the original debited. `createTimesheetCorrection` (`projects.service.ts`) copies a coverage override (a coverage with a reason) to the reversal and the replacement; it copies nothing else new.
- Task 8: a Service entry's journal line says "Service Labor" and carries the Customer dimension (the order's customer), as the spec's *Accounting* section asks. The billable item's description is the entry's note, else "Labor", and its `itemId` is the service labor item.
- Task 8: a Service entry whose project no service order owns is refused ("No service order owns the project of this timesheet entry").
- Task 8: the fixture gains `addServiceOrder` (`project-posting-test-fixture.ts`). The suite adds 3 cases: a Draft Standard entry stays unposted, the plan's Warranty case (Dr Warranty Expense 170.00 / Cr Labor Absorption, a 0.00 billable item, Customer tag), and a correction of a Billable entry (credit to Cost of Goods Sold, the item written off). The full server-functions suite passes (439) except `get-accounting-period` and `post-charge-concurrency`, which pass alone (the known shared-database races).
- Task 9: `post-project-issue` takes 3 optional inputs: `coverage` and `coverageReason` (an override counts only with a reason) and `returnOfProjectLedgerId`. A Service project is one whose `costTreatment` is By Coverage; the CHECK ties it to `projectType`, so a Standard issue pays no extra query.
- Task 9 (🛑 design decision): a return was not linked to its issue. A Service return now reverses one whole open issue: the named one, else the latest open issue of the same item and serial or batch to the same node (`findServiceIssueToReturn`). The return's ledger row sets `reversalOfId` to the issue's row, which closes it, and posts at the issue's coverage. A partial return of a Service issue is refused ("Return the whole quantity of one issue"). Standard returns are unchanged.
- Task 9: the install, the replace and the genealogy live in `post-project-issue/service.ts`. The `Service` activity carries the attribute `{ "Project Issue": <ledger id> }`, so a return deletes exactly the activity its issue wrote. The return restores the replaced component only when no other part this order installed still sits on the node.
- Task 9: the `Service` activity is written for any tracked issue (serial or batch). Build from part still nets only `Consume` and `Unconsume`, so it does not show a `Service` replacement yet.
- Task 9: the service context gains `serviceOrderReadableId` and `assetTrackedEntityId` (same query). The journal carries the Customer dimension and says "Service Material". The billable item's description is the item name, priced at the item's `itemUnitSalePrice.unitSalePrice`.
- Task 9: 2 new database tests (the plan's install and return cases). The project server-function tests (44) pass; `@carbon/server-functions` and `erp` typecheck green.
- Task 10: `post-project-expense` posts every project, not only Service ones. A Statistical project debits `indirectCostAccount` and writes no ledger row, as `post-project-issue` does. A Capitalize project is refused ("An expense entry cannot charge a capital project"): the `fixedAssetCipCost_sourceType_check` has no `Project Expense` value, and adding one needs a migration outside this task.
- Task 10: the entry has no status column. A ledger row with `documentType 'Project Expense'` for the entry, or a `journalId` on it, marks it posted, and a second post is a no-op (`posted: false`). A reversal entry stores its own negative amount and posts it as is, at its original's coverage.
- Task 10: GRNI is credited with `credit("liability", amount)`, the natural-balance convention of `post-receipt`. So a 40.00 expense gives the lines COGS +40.00 and GRNI +40.00.
- Task 10: the shared helper `postProjectJournal` (`lib/project-journal.ts`) posts one journal with its period, lines and dimension tags; both new functions use it. `journalReference.to` gains `projectExpense` and `coverageReclass` (`@carbon/database`).
- Task 10: `reclass-project-coverage` permissions are `{ update: "projects" }`, as the other charge functions. It credits the account on the charge's own journal line (`journalLineId`), else the account the old coverage resolves to on the charge's date. It posts nothing when both accounts are the same, and it refuses Capitalized in either direction (a Refurbishment's charges stay Capitalized). The journal's `sourceType` and `documentType` are the charge's own (Timesheet, Project Issue or Project Expense). For a part, the installed component moves to the new ledger row.
- Task 10: a reclass leaves the old row without `reversalOfId`, reversed by a later row. So `post-timesheet` now reads a correction's original row only when no row reverses it, and the `Service` activity of an issue carries the issue's item ledger id (stable across a reclass), not its ledger row id. A return after a reclass finds the new row.
- Task 10: tests: a Standard Expense project expense (no billable item; a second post is a no-op), the plan's 40.00 Billable expense with its reversal, and the plan's 120.00 Warranty labor reclass. That test also refuses a second reclass and posts a correction against the reclassed row. The permissions snapshot gains the two functions, reviewed. `@carbon/server-functions` and `@carbon/database` typecheck green.
- Task 11: the upsert is one `INSERT … SELECT … ON CONFLICT` inside the transaction (`upsertShippedCustomerAssets`, `post-shipment/customer-assets.ts`). It joins the warranty months in the same statement, so the plan's read of `itemUnitSalePrice` before the transaction is not needed. Postgres adds the months (`make_interval`), which clamps a month end as `CalendarDate.add` does. `itemUnitSalePrice` has no key on `itemId`, so a lateral join takes the oldest row.
- Task 11: a reshipped serial keeps its `source` (an asset registered by hand stays Manual); every other field the plan names is reset.
- Task 11: on a return to customer, the site becomes the RMA's `customerLocationId` when it has one, else the asset keeps its site. The step updates only serials that are already assets.
- Task 11: `customer-assets.test.ts` posts a real Sales Order shipment of a serial with accounting off: the new asset with 12 and 24 months, the void setting it Returned, a drop shipment's site, and a reshipped serial's reset. The RMA return step has no database test (no post-shipment test fixture exists for an RMA).
- Task 12: `post-sales-invoice` reads the stamped line ids before the line loop (one query, `billedServiceLineIds`) and skips the whole "no sales order line" block for them: the shipment line, the `itemLedger` row and the COGS lines. Revenue posts as before. The new `post-sales-invoice.test.ts` posts one stamped and one unstamped `Service` line of an Inventory part. Only the unstamped line relieves stock and posts COGS; both post revenue. With the skip removed the test fails, so it proves the change.
- Task 12: `projectBillableItem.salesInvoiceLineId` has an FK with `ON DELETE SET NULL`, so a deleted line already loses the stamp, but the item stays Billed. `releaseServiceOrderStamps` (`sales.server.ts`, called first by `releaseRecurringInvoiceStamps`) sets the items back to Unbilled. When the invoice has no other stamped line, it clears `salesInvoice.serviceOrderId`.
- Task 12 (deviation): the release also moves the order from Closed back to Completed and clears `serviceOrder.salesInvoiceId`. Task 13 closes the order at invoicing and refuses any order that is not Completed, so without this step a deleted Draft invoice would leave the order impossible to invoice again.
- Task 12: no ERP database test exists for the release functions. The release SQL was checked by hand against the local database. `erp` and `@carbon/server-functions` typecheck green. The invoice, payment, memo and contract and rental invoice suites pass (67).
- Task 13: the header takes the customer's `customerPayment` (invoice customer, contact, site and payment term) and currency, at `get_exchange_rate`, as `convert` does. `customerReference` is the order's readable id. `serviceOrder.salesInvoiceId` is stamped beside the Closed status, so a deleted Draft can reopen the order (Task 12 note). Unit prices stay in base currency with the invoice's exchange rate, as other sales lines do.
- Task 13: tax is 0. The customer has no default tax rate (`customerTax` holds only the exemption), and the plan leaves tax rules out of scope.
- Task 13: the plan also handles items on no node (or on a node outside the tree): they come last under "Other charges". A node with no unbilled item in its subtree gives no line, so a fixed-price node with nothing left to bill does not bill its price again. A Comment line has quantity 0. A line's unit is the charge's ledger unit (HR for time), else EA.
- Task 13: a covered item on an order with a coverage contract reads "(Covered by contract CON000012)" on the invoice; the billable item keeps "(Covered by contract)".
- Task 13: tests: the plan's 3 `plan.test.ts` cases, and a database test (`create-service-order-invoice.test.ts`) that posts 2 h of time and a 40.00 expense, refuses an order that is not Completed, then drafts the invoice (a heading and 2 Service lines, 230.00), stamps both items Billed and closes the order. The permissions snapshot gains the function, reviewed. The full server-functions suite passes (452); `@carbon/server-functions`, `@carbon/jobs`, `erp` and `mes` typecheck green.
- Fix after Task 13 (`fix(service)`): Build from part on a serial now counts a `Service` activity's input as a `Consume` input, so a part a service order installed shows up in the asset's build. A component drops out when every `customerAssetComponent` row of the pair (the asset's serial, the component's serial) has a `removedDate`. The netting moved into the pure `netBuildComponents` (`projects.models.ts`), tested in `projects-build-from-part.test.ts` (4 cases); the walk reads the removals with one more query per level, in parallel with the activity types. Gap: a component the factory built in has no `customerAssetComponent` row, so Task 9 cannot remove it, and a replacement of it shows both the old and the new serial.
- Task 14: the charge number picker is `getChargeNumbers` (`projects.service.ts`); there is no `getChargeableProjectElements`. It filters `projectType = 'Standard'` on the projects and on the elements' project, and so does its MES twin (`apps/mes/app/services/projects.service.ts`), which offers the same picker on the MES timesheet. The Copy from list is the loader of `x+/projects+/new.tsx`; the template list of Build from part (`$projectId.elements.build.tsx`) gets the same filter, so a Service template never shows in Projects.
- Task 14: no search index source lists projects (the `sync_*_to_search_index` functions cover items, customers, suppliers, jobs, orders and invoices only), so step 2 had nothing to change.
- Task 14: `dimension-mapping.ts` is unchanged. Its `DIMENSION_LABEL_SOURCES` resolves the labels of journal lines that already carry a Project value, and a Service order's journal lines must keep resolving (step 3). The picker is `getEntityValues` (`accounting.service.ts`): the Project case lists Standard projects only, and the ProjectElement case lists only elements of Standard projects.
- Task 14: the Ramp hooks call only `pushProjects`, so the filter in `PROJECT_SPEC.loadDesiredOptions` covers both. It moved into the pure `desiredProjectOptions`, tested in `lib/__tests__/projects.test.ts`. `ramp-integration.md` says so.
- Task 15: the four routes already needed only `role: "employee"`; the move takes them out of the Projects layout and its sidebar. `/x/timesheet` has no module, so it shows no module sidebar. `x+/projects+/timesheet.tsx` is now a redirect to `/x/timesheet` that keeps `?week=`. `path.to.timesheet`, `timesheetUpdate`, `timesheetSubmit` and `timesheetCorrect` replace the `projectTimesheet*` helpers; `projectTimesheetApprovals` stays in Projects.
- Task 15: `path.to.serviceOrder(id)` (`/x/service-order/:id`, the Task 20 document page) is added here, because a Service row links to it. Task 18 adds the other service helpers. The Service navigation link to My Timesheet comes with Task 18's submodules.
- Task 15: the grid reads the project's `projectType` and its service order (embedded in `TIMESHEET_ENTRY_COLUMNS`). A Service row shows the order's readable id and the node's name, links to the order, and shows its cells read-only (status and hours, no correction). A Standard row's name links to its element, else its project. `submitTimesheetEntries` now submits Standard projects' Draft entries only, so **Submit week** never posts a service order's time; Submit is enabled only by a Standard Draft cell.
- Task 15: **My Timesheet** is in the user menu (`AvatarMenu`) for employees. `projects.mdx` names the new route.
- Task 16: `customerAssetValidator` registers a unit (item, serial, customer, site, ship date, warranty dates, notes); the edit of an existing asset has its own `customerAssetUpdateValidator` (id, site, warranty dates, notes), because item, serial and customer never change after registration. `serviceOrderValidator` takes `startFrom` (`Empty`, `Template`, `Serial`, `Item`, matching `buildFromPartSources`) and requires `serviceTemplateId` for Template. The module also adds `serviceOrderUpdateValidator` (for `updateServiceOrder`) and `serviceBillableItemValidator` (for `updateServiceBillableItem`).
- Task 16: `rollUpOrderStatus(order, visits)` takes `order.workComplete`: the **Work complete?** answer of Task 22 that gives Completed. Cancelled visits do not count. The test has the plan's 4 cases plus one for the pure `warrantyStatus(asset, today)` (In warranty while labor runs, Labor ended while only parts runs, else Expired), which the list filter and the badge share.
- Task 16: `getCustomerAssets` takes `today` (the company's day) for the warranty filter; `openOrders` is an embedded count of the asset's orders that are not Closed or Cancelled. `getCustomerAssetHistoryByComponent` groups a node with neither a serial nor an item by its name, so an unlinked node still has a row. `updateServiceOrder` refuses a Closed or Cancelled order and drops contact, site and contract unless the order is Draft. `updateServiceBillableItem` changes an Unbilled or On Hold item (a hold is released by setting Unbilled), never a reversal, and recomputes the amount from the price. Every select string was checked against the local PostgREST.
- Task 16: the service functions carry no `@mcp` tag, so none is an MCP or API tool yet.
- Task 17: `serviceOrder.projectId` is NOT NULL, so `createServiceOrder` creates the project first and inserts the order with its `projectId`, not the plan's insert-then-set. `createServiceProject(trx, …)` takes the serial, customer name, customer, location and the contract's `projectId` it needs for the name and parent.
- Task 17: `buildElementsFromPart` opens its own transaction, so its body moved into `insertElementsFromPart(client, trx, args)` and the order builds its tree in the transaction that creates its project. `createServiceOrder(client, db, args)` therefore also takes the Supabase client (the item source reads the make method with it). A template copies every level (`BUILD_FROM_PART_MAX_DEPTH`); the serial and the item build 2 levels; the serial keeps bought components (what a service replaces), the item keeps only made lines.
- Task 17: the asset decides the order's customer, site, item and subject serial; a chosen contract must be the asset's customer's, and with none chosen the customer's only Active contract is used.
- Task 17: `registerCustomerAsset` refuses an item that is not serial-tracked and a serial the item already has (it becomes an asset when it ships).
- Task 17: `syncServiceOrderStatus(db, { companyId, serviceOrderId, userId, status?, workComplete? })` runs in the caller's transaction when given one. `status` starts the roll-up from a status the user chose (a Resume passes Draft so the visits decide again); it stamps `completedAt`/`completedBy` on Completed and clears them when the order leaves Completed for an open status. `projectStatusOfOrder` holds the plan's mapping. `cancelServiceOrder` refuses an order with any ledger row and also cancels its open visits.
- Task 17: a throwaway vitest run against this worktree's database (rolled back) registered an asset, created an order from the serial (project `SVC000001`, Service, Released, By Coverage), rolled it to Scheduled with a visit and to On Hold (project On Hold), then cancelled it. The script was not committed.
- Task 18: the module layout also checks `view: "service"` in its loader, and a second layout, `x+/service-order+/_layout.tsx`, does the same for the order workspace (as `project+/_layout.tsx` does for Projects). Its handle has only `module: "service"`; the order route emits the breadcrumb. `path.to.serviceOrderEstimate(id)` is the PDF route `/file/service-estimate/<id>.pdf` (Task 26). The Service submodules are also registered in the command palette (`Search.tsx`). The module icon is `LuHardHat`.
