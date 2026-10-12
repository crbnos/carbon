# Government Contracting Phase 5d — implementation plan

**Spec:** .ai/specs/2026-10-09-government-contracting.md (Phase 5d: *R&D tax*)
**Research:** .ai/research/government-contracting-layer.md (section 8, *R&D tax: §174A and Form 6765 Section G*)
**Branch:** projects-wbs-research-spec
**Prerequisite:** these plans are done and committed:
- `.ai/plans/2026-10-07-projects-phase-1a.md` and `.ai/plans/2026-10-08-projects-phase-1b.md` (`timesheetEntry`, `laborCategory`, `projectLedger`, `projectElement`);
- `.ai/plans/2026-10-09-field-service-phase-a.md`, Task 15 (the timesheet routes under `x+/timesheet`);
- `.ai/plans/2026-10-09-project-billing-phase-4a.md` (`customerContractLine.billingMethod`);
- `.ai/plans/2026-10-09-government-contracting-phase-5a.md` (`project.costObjective`, `payrollPeriodTotal`, the server function `save-timesheet-entry`, and the report route `api+/projects.reports.$reportKey[.]csv.ts`).

Task 1 checks each artifact. If one does not exist, STOP and report.

## Scope of this plan

Phase 5d tags the data that a US R&D tax filing needs, and reports it:
1. **Business components:** `projectElement.isBusinessComponent`, with a component type and a software type.
2. **Research role:** `rdActivityRole` on each timesheet entry. It defaults from the labor category's role.
3. **Work location:** `timesheetEntry.workLocationId`. It defaults to the employee's job location. The location's `countryCode` decides domestic or foreign research.
4. **Funded research:** three flags on the customer contract. Cost of a Direct project under a funded contract is not a qualified research expense (QRE).
5. **Officer flag:** `employeeJob.isOfficer`, for Form 6765 Section E.
6. **Reports:** the §174A domestic and foreign R&E report, and the Form 6765 Section G report.

5d is community code (spec Q1). Nothing in this plan goes into `packages/ee`.

## Decisions this plan adds

The spec leaves these points open. The plan decides them, and Task 15 records them in the spec.

| # | Point | Decision |
|---|---|---|
| D1 | Which countries are domestic | The United States, Puerto Rico and the US possessions: `US`, `PR`, `GU`, `VI`, `AS`, `MP`, `UM`. IRC §41(d)(4)(F) defines foreign research as research outside these. |
| D2 | A location with no `countryCode` | Its cost goes to an **Unknown** column in the §174A report. The Section G report excludes its hours and states the count. |
| D3 | The work country of a non-labor ledger row | The country of the project's `locationId`. Only a labor row has its own work location. |
| D4 | Where wages come from | The employee's imported payroll totals (`payrollPeriodTotal.grossWages`) with `periodEnd` in the tax year. If none exist, the employee's labor cost in the ledger, and the row says "Estimated from labor cost". |
| D5 | Which ledger rows a business component owns | Its own rows and its subtree's, down to the next business component. A nested business component owns its own subtree. |
| D6 | Funded research in the §174A report | §174A rows are not excluded. A column shows the funded part, so the preparer can decide. |
| D7 | Column 55 (computer rental) | Carbon has no source for it. The column is 0, and the file says "Not tracked in Carbon". |
| D8 | Column 53 | The research file does not define it. The plan writes the sum of columns 50–52. Task 15 records this assumption in the spec. |
| D9 | The tax year | Twelve months from `fiscalYearSettings.taxStartMonth`, named by the calendar year in which it starts. |
| D10 | `researchFunded` left empty | It counts as true when the contract has a Cost Plus or Time & Materials line, else false (spec default). |

## Rules for the executor

- Read `.ai/lessons.md`, `.claude/rules/conventions-services.md`, `.claude/rules/conventions-forms.md`, `.claude/rules/database-patterns.md`, `.claude/rules/projects-system.md` and `.claude/rules/government-contracting.md` before Task 1.
- Use the `carbon-design` skill for every UI task.
- Start every new source file with its SPDX header. Run `pnpm --filter @carbon/checks license-headers` after you create files.
- Never use JavaScript `Date`. Use `@internationalized/date` and the `datetime` helpers in `@carbon/utils`.
- Round money with `round()` from `@carbon/utils`. Never query in a loop.
- Never construct a database client in a `*.service.ts`. Pass `db` from the route.
- If a quoted code line or line number does not match the file, search for the quoted code. If you cannot find it, STOP and report. Do not improvise.

## Progress

- [x] Task 1: Check the prerequisites
- [x] Task 2: Create the enum migration
- [x] Task 3: Create the R&D tax columns migration
- [x] Task 4: Apply migrations and regenerate types
- [ ] Task 5: Add the pure R&D tax helpers
- [ ] Task 6: Default the work location and research role on timesheet entries
- [ ] Task 7: Add the validators and service functions
- [ ] Task 8: Add the work location and research role to My Timesheet
- [ ] Task 9: Add the business component fields to the element
- [ ] Task 10: Add the research role to the labor category
- [ ] Task 11: Add the research flags to the contract
- [ ] Task 12: Add the officer flag to the employee job
- [ ] Task 13: Add the R&D report queries and builders
- [ ] Task 14: Add the two reports to the CSV route and the Reports page
- [ ] Task 15: Update the rules, AGENTS.md, docs and spec
- [ ] Task 16: Verify in the browser

## Dependencies

- Task 1 runs first. Tasks 2 → 3 → 4 run in order.
- Task 5 needs Task 4. Task 6 needs Task 4. Task 7 needs Task 4.
- Task 8 needs Tasks 6 and 7. Tasks 9–12 need Task 7 and are independent of each other.
- Task 13 needs Tasks 5 and 7. Task 14 needs Task 13.
- Task 15 needs Tasks 1–14. Task 16 runs last.

---

## Task 1: Check the prerequisites

**Depends on:** none
**Files:** none

**Steps:**
1. Run the command in **Verify**. Each line must print a non-zero count.
2. If a count is 0 or a file is missing, STOP and report the missing artifact. Do not build it here.

**Verify:**
```bash
grep -c "costObjective" packages/database/src/types.ts
grep -c "payrollPeriodTotal" packages/database/src/types.ts
grep -c "billingMethod" packages/database/src/types.ts
grep -c "taxStartMonth" packages/database/src/types.ts
ls packages/server-functions/src/save-timesheet-entry/index.ts "apps/erp/app/routes/api+/projects.reports.\$reportKey[.]csv.ts" apps/erp/app/routes/x+/projects+/reports.tsx
# Expected: four counts above 0, and every listed file exists
```

**Out of scope:** any code change.

---

## Task 2: Create the enum migration

**Depends on:** 1
**Files:**
- Create: `packages/database/supabase/migrations/<timestamp>_rd-tax-enums.sql`

**Steps:**
1. Run `pnpm db:migrate:new rd-tax-enums`.
2. Write only this statement:

```sql
CREATE TYPE "rdActivityRole" AS ENUM ('Direct Research', 'Direct Supervision', 'Direct Support', 'Not Qualified');
```

**Verify:**
```bash
grep -c "CREATE TYPE" packages/database/supabase/migrations/*_rd-tax-enums.sql
# Expected: 1
```

**Out of scope:** the 5b and 5c enums.

---

## Task 3: Create the R&D tax columns migration

**Depends on:** 2
**Files:**
- Create: `packages/database/supabase/migrations/<timestamp>_rd-tax-columns.sql`

**Steps:**
1. Run `pnpm db:migrate:new rd-tax-columns`.
2. Check the `location` primary key in its newest migration. If it is `("id", "companyId")`, write the work location FK as a composite with `ON DELETE SET NULL ("workLocationId")`.
3. Write the SQL below. Put each `ADD COLUMN IF NOT EXISTS` on its own line. Add an index on `workLocationId`.

```sql
ALTER TABLE "projectElement"
  ADD COLUMN IF NOT EXISTS "isBusinessComponent" BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS "rdComponentType" TEXT CHECK ("rdComponentType" IN ('Product', 'Process', 'All Others')),
  ADD COLUMN IF NOT EXISTS "rdSoftwareType" TEXT CHECK ("rdSoftwareType" IN ('Internal Use', 'Dual Function', 'Non-Internal Use', 'Excepted'));
ALTER TABLE "projectElement" DROP CONSTRAINT IF EXISTS "projectElement_rdComponent_check";
ALTER TABLE "projectElement" ADD CONSTRAINT "projectElement_rdComponent_check"
  CHECK ("isBusinessComponent" OR ("rdComponentType" IS NULL AND "rdSoftwareType" IS NULL));

ALTER TABLE "timesheetEntry"
  ADD COLUMN IF NOT EXISTS "rdActivityRole" "rdActivityRole",
  ADD COLUMN IF NOT EXISTS "workLocationId" TEXT REFERENCES "location"("id") ON DELETE SET NULL;

ALTER TABLE "laborCategory"
  ADD COLUMN IF NOT EXISTS "rdActivityRole" "rdActivityRole";

ALTER TABLE "customerContract"
  ADD COLUMN IF NOT EXISTS "researchFunded" BOOLEAN,
  ADD COLUMN IF NOT EXISTS "paymentContingentOnSuccess" BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS "contractorRetainsRights" BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE "employeeJob"
  ADD COLUMN IF NOT EXISTS "isOfficer" BOOLEAN NOT NULL DEFAULT FALSE;

-- Existing entries took place at the employee's job location (the spec default).
UPDATE "timesheetEntry" t
SET "workLocationId" = ej."locationId"
FROM "employeeJob" ej
WHERE ej."id" = t."employeeId" AND ej."companyId" = t."companyId" AND t."workLocationId" IS NULL;
```

4. The backfill is one `UPDATE … FROM`. Do not loop.

**Verify:**
```bash
grep -c "ADD COLUMN IF NOT EXISTS" packages/database/supabase/migrations/*_rd-tax-columns.sql
# Expected: 10
```

**Out of scope:** the 5c element columns.

---

## Task 4: Apply migrations and regenerate types

**Depends on:** 3
**Files:**
- Modify: generated types

**Steps:**
1. Run `pnpm db:migrate`, then `pnpm run generate:types`.
2. Phase 5d adds no table, so the RLS manifest does not change. Every new id column has an FK, so `ID_REF_COLUMNS` does not change.
3. Run `pnpm db:check:datasets`. If a `COVERAGE` set now misses a `rdActivityRole` value, add the value to its `except` list. Use the reason "R&D tagging is optional; the datasets do not tag it".

**Verify:**
```bash
pnpm --filter @carbon/database authz check
# Expected: exit code 0 (no drift)
pnpm db:check:datasets
# Expected: all four datasets pass
pnpm exec turbo run typecheck --filter=@carbon/database
# Expected: exit code 0
```

**Out of scope:** UI.

---

## Task 5: Add the pure R&D tax helpers

**Depends on:** 4
**Files:**
- Create: `packages/utils/src/rd-tax.ts`
- Create: `packages/utils/src/rd-tax.test.ts`
- Modify: `packages/utils/src/index.ts` — export it

**Steps:**
1. Write these pure functions:

```ts
export type RdActivityRole = "Direct Research" | "Direct Supervision" | "Direct Support" | "Not Qualified";
export const DOMESTIC_COUNTRY_CODES = ["US", "PR", "GU", "VI", "AS", "MP", "UM"] as const;

export function workCountryClass(countryCode: string | null): "Domestic" | "Foreign" | "Unknown";
export function taxYearBounds(year: number, startMonth: number): { from: string; to: string };
export function isFundedResearch(contract: { researchFunded: boolean | null; hasCostPlusOrTimeAndMaterialsLine: boolean }): boolean;

export type QualifiedHours = { componentId: string; role: Exclude<RdActivityRole, "Not Qualified">; hours: number };
export function wageQres(employees: {
  employeeId: string; wages: number; totalHours: number; isOfficer: boolean; qualified: QualifiedHours[];
}[]): {
  byComponent: Record<string, { research: number; supervision: number; support: number }>;
  officerWages: number;
};

export type Section6765Input = {
  componentId: string; name: string; componentType: string | null; softwareType: string | null;
  research: number; supervision: number; support: number;
  supplies: number; computerRental: number; contractResearch: number;   // contractResearch at 100 %
};
export type Section6765Row = Section6765Input & { wageTotal: number; contractResearchQre: number; total: number; isAggregate: boolean };
export function section6765Rows(components: Section6765Input[]): Section6765Row[];
```

2. `workCountryClass`: null gives Unknown. A code in `DOMESTIC_COUNTRY_CODES` gives Domestic. Any other code gives Foreign.
3. `taxYearBounds`: build the dates with `CalendarDate` from `@internationalized/date`. `from` is the first day of `startMonth` in `year`. `to` is one year later, less one day.
4. `isFundedResearch` returns `researchFunded` when it is set, else `hasCostPlusOrTimeAndMaterialsLine` (decision D10).
5. `wageQres`, per employee:
   1. Q = Σ qualified hours. If `totalHours <= 0` or Q is 0, skip the employee.
   2. If Q ÷ `totalHours` is 0.8 or more, the qualified wages are all of `wages` ("substantially all"). Else they are `wages × Q ÷ totalHours`.
   3. Spread the qualified wages over (component, role) in proportion to hours ÷ Q.
   4. If `isOfficer`, add the qualified wages to `officerWages`.
   5. Round each amount with `round()`.
6. `section6765Rows`:
   1. For each component, `wageTotal` = research + supervision + support. `contractResearchQre` = `contractResearch × 0.65`. `total` = `wageTotal` + supplies + computer rental + `contractResearchQre`.
   2. Sort by `total` descending, then by name.
   3. Take rows while fewer than 50 are taken and the taken total is below 80 % of the grand total.
   4. Sum the rest into one row with `isAggregate: true` and the name "All other business components (N)". Add it only when one or more components remain.
7. Write `rd-tax.test.ts` with these 10 cases:
   1. `workCountryClass("DE")` is Foreign; `"US"` and `"PR"` are Domestic; null is Unknown.
   2. `taxYearBounds(2026, 1)` is 2026-01-01 to 2026-12-31.
   3. `taxYearBounds(2026, 7)` is 2026-07-01 to 2027-06-30.
   4. `isFundedResearch` with `researchFunded` null and a Cost Plus line is true; with `false` set, it is false.
   5. An employee with 1,700 of 2,000 hours qualified (85 %) and wages 100,000.00 gives 100,000.00 of wage QREs.
   6. The same employee with 1,000 of 2,000 hours gives 50,000.00.
   7. An officer's qualified wages appear in `officerWages`.
   8. Contract research of 10,000.00 gives a QRE of 6,500.00.
   9. **Section G:** 60 components give rows in descending order. The listed rows hold at least 80 % of the total, or there are exactly 50. One aggregate row follows.
   10. The sum of every row's `total`, aggregate included, equals the grand total.

**Verify:**
```bash
pnpm --filter @carbon/utils test -- rd-tax
# Expected: 10 passed
```

**Out of scope:** state R&D credits (spec *Out of scope*).

---

## Task 6: Default the work location and research role on timesheet entries

**Depends on:** 4
**Files:**
- Modify: `packages/server-functions/src/save-timesheet-entry/index.ts`
- Modify: `packages/server-functions/src/save-timesheet-entry/save-timesheet-entry.test.ts`
- Modify: `apps/erp/app/modules/projects/projects.service.ts` — `createTimesheetCorrection`

**Steps:**
1. The input of `save-timesheet-entry` gains optional `workLocationId` and `rdActivityRole`.
2. On a new entry, fill each one that the input leaves empty:
   - `workLocationId` = the employee's `employeeJob.locationId`;
   - `rdActivityRole` = the labor category's `rdActivityRole`, which may be null.

   Read both with one query each, before the insert.
3. Add `workLocationId` and `rdActivityRole` to the key that finds the existing entry. Two entries on one day may then differ only by location or role.
4. In DCAA mode, add both fields to the revision's `before` and `after` objects.
5. `createTimesheetCorrection` copies both fields to the reversal. The replacement copies them too, unless the correction names new values.
6. Add 2 `databaseTest` cases:
   1. An entry saved with no location gets the job location.
   2. An entry on a category with role Direct Research gets that role.

**Verify:**
```bash
pnpm --filter @carbon/server-functions test -- save-timesheet-entry
# Expected: all tests pass
pnpm exec turbo run typecheck --filter=erp --filter=@carbon/server-functions
# Expected: exit code 0
```

**Out of scope:** changing the location of a posted entry. That is a correction.

---

## Task 7: Add the validators and service functions

**Depends on:** 4
**Files:**
- Modify: `apps/erp/app/modules/projects/projects.models.ts`, `apps/erp/app/modules/projects/projects.service.ts`
- Modify: `apps/erp/app/modules/people/people.models.ts` (`employeeJobValidator` `:44-51`), `apps/erp/app/modules/people/people.service.ts` (`updateEmployeeJob` `:632`)
- Modify: `apps/erp/app/modules/sales/sales.models.ts`, `apps/erp/app/modules/sales/sales.service.ts`
- Copy from (precedent): `updateContractType` (`sales.service.ts:9907`)

**Steps:**
1. **Projects:**
   - `timesheetCellValidator` gains optional `workLocationId` and `rdActivityRole`.
   - `laborCategoryValidator` gains optional `rdActivityRole`. `upsertLaborCategory` writes it.
   - `projectElementFieldUpdateValidator` accepts `isBusinessComponent`, `rdComponentType` and `rdSoftwareType`.
   - `updateProjectElementField` clears both type fields when `isBusinessComponent` becomes false.
   - `getTimesheetWeek` selects `workLocationId`, the location name and `rdActivityRole`. `groupTimesheetRows` adds both fields to the row key.
   - Export `rdActivityRoles`, `rdComponentTypes` and `rdSoftwareTypes` as value arrays.
2. **People:** `employeeJobValidator` gains `isOfficer` (`zfd.checkbox()`). Add `isOfficer: sanitized.isOfficer` to the allow-list in `updateEmployeeJob`.
3. **Sales:** add `updateContractResearchFlags(client, args)` with an `@mcp update` tag. It sets `researchFunded`, `paymentContingentOnSuccess` and `contractorRetainsRights` in any contract status, because they are tax facts, not terms.
4. Update `apps/erp/test/projects-timesheet-week.test.ts`. Two entries that differ only by work location give two rows.

**Verify:**
```bash
pnpm --filter erp test -- projects-timesheet-week && pnpm exec turbo run typecheck --filter=erp
# Expected: all tests pass; typecheck exits 0
```

**Out of scope:** the report queries (Task 13).

---

## Task 8: Add the work location and research role to My Timesheet

**Depends on:** 6, 7
**Files:**
- Modify: `apps/erp/app/modules/projects/ui/Timesheet/TimesheetGrid.tsx`
- Modify: `apps/erp/app/routes/x+/timesheet.tsx`, `apps/erp/app/routes/x+/timesheet.update.tsx`
- Copy from (precedent): `apps/erp/app/components/Form/Location.tsx` (the location picker)

**Steps:**
1. The **Add row** form gains a **More** section with **Work location** and **Research role**.
   - Work location defaults to the employee's job location.
   - Research role defaults to the chosen labor category's role.
2. The row label shows the location name when it differs from the job location. It shows the role as a badge when the role is set.
3. Each cell posts `workLocationId` and `rdActivityRole` with the hours.
4. The loader passes the employee's job location and the labor categories' roles to the grid.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exit code 0
```

**Out of scope:** the MES grid. MES entries take the defaults from Task 6.

---

## Task 9: Add the business component fields to the element

**Depends on:** 7
**Files:**
- Modify: `apps/erp/app/modules/projects/ui/Element/ElementSidebar.tsx`
- Copy from (precedent): the `isUnallowable` switch from Phase 5a Task 20 in the same file

**Steps:**
1. Add a switch **Business component (R&D)** below the Phase 5a flags.
2. When it is on, show two selects:
   - **Component type**: Product, Process, All Others;
   - **Software type** (optional): Internal Use, Dual Function, Non-Internal Use, Excepted.
3. Each field posts through the existing field update route.
4. On the List layout, show a small "R&D" badge after the name of a business component.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exit code 0
```

**Out of scope:** a narrative field for "information sought to be discovered" (column 49(f), amended returns only).

---

## Task 10: Add the research role to the labor category

**Depends on:** 7
**Files:**
- Modify: `apps/erp/app/modules/projects/ui/LaborCategories/LaborCategoryForm.tsx`
- Modify: `apps/erp/app/modules/projects/ui/LaborCategories/LaborCategoriesTable.tsx`

**Steps:**
1. Add **Research role** (a `Select` of the four roles, optional) after **Description**. The hint is "Default role for time in this category".
2. Add a **Research role** column to the table.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exit code 0
```

**Out of scope:** a role per employee.

---

## Task 11: Add the research flags to the contract

**Depends on:** 7
**Files:**
- Modify: `apps/erp/app/modules/sales/ui/Contracts/ContractProperties.tsx`
- Modify: `apps/erp/app/routes/x+/contract+/update.tsx`
- Modify: `apps/erp/app/routes/x+/contract+/$id.tsx` (the loader, if it does not select the new columns)

**Steps:**
1. Add a **Research (R&D tax)** group to the properties panel with three fields:
   - **Funded research**, a `Select`: Default, Funded, Not funded. Default shows the computed value, for example "Default (funded: has a Cost Plus line)".
   - **Payment depends on success** (a switch).
   - **We keep substantial rights** (a switch).
2. Each field posts to `update.tsx`, as the contract type field does.
3. The `update.tsx` action calls `updateContractResearchFlags`. It requires `update: "sales"`. Default writes null.
4. When both switches are on and the value is Funded, show the hint "Both tests pass; consider Not funded (§41(d)(4)(H))".

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exit code 0
```

**Out of scope:** flags per contract line.

---

## Task 12: Add the officer flag to the employee job

**Depends on:** 7
**Files:**
- Modify: `apps/erp/app/modules/people/ui/Person/PersonJob.tsx`
- Modify: `apps/erp/app/routes/x+/person+/$personId.job.tsx`

**Steps:**
1. Add a switch **Officer** after **FLSA status**. The hint is "Used for Form 6765 Section E".
2. Check that the route action passes `isOfficer` to `updateEmployeeJob`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exit code 0
```

**Out of scope:** officer compensation data.

---

## Task 13: Add the R&D report queries and builders

**Depends on:** 5, 7
**Files:**
- Modify: `apps/erp/app/modules/projects/projects.service.ts`
- Modify: `apps/erp/app/modules/projects/projects.models.ts`
- Create: `apps/erp/test/projects-rd-tax.test.ts`

**Steps:**
1. Add `getRdLedgerRows(db, { companyId, from, to })`. It uses one SQL query that starts with this CTE (decision D5):

```sql
WITH RECURSIVE bc AS (
  SELECT e."id" AS "elementId", e."id" AS "componentId", e."companyId"
  FROM "projectElement" e
  WHERE e."companyId" = $1 AND e."isBusinessComponent"
  UNION ALL
  SELECT c."id", bc."componentId", c."companyId"
  FROM "projectElement" c
  JOIN bc ON c."parentId" = bc."elementId" AND c."companyId" = bc."companyId"
  WHERE NOT c."isBusinessComponent"
)
```

2. It joins `projectLedger` rows with `postingDate` in the range to `bc` by `projectElementId`, and returns per row:
   - `componentId`, `costType`, `amount`, `employeeId`, `quantity`;
   - the work country (decision D3): the `countryCode` of the entry's `workLocationId` for a `Timesheet` row, else of the project's `locationId`;
   - `rdActivityRole` from the entry, else from its labor category;
   - `costObjective` of the project;
   - `funded`: true for a Direct project with a line on a funded contract (`isFundedResearch`).
3. Compute `funded` in SQL with the rule of decision D10. Do not call the TS helper per row.
4. Add `getRdEmployeeYear(db, { companyId, from, to })`. Per employee, it returns:
   - total Posted timesheet hours in the range;
   - Σ `grossWages` of payroll rows with `periodEnd` in the range;
   - Σ Labor ledger amount in the range;
   - `isOfficer`.
5. Add `getRdComponents(client, companyId)`: id, readable id, name, component type and software type of every business component.
6. Add the pure `buildSection174ARows(rows, components)` in `projects.models.ts`. Per component, it sums `amount` into the columns Domestic, Foreign and Unknown with `workCountryClass`. It adds **Burden** (rows of cost type Burden, for review), **Of which funded**, and **Total**. A last row holds the totals.
7. Add the pure `buildSection6765Input(rows, employees, components)`:
   1. Qualified hours = Timesheet rows with a role other than Not Qualified, not funded, and a Domestic country.
   2. Wages = payroll gross wages, else the ledger labor amount with the note "Estimated from labor cost" (decision D4).
   3. Call `wageQres`. Supplies = Material rows that are not funded and Domestic. Contract research = Outside Processing and Purchased Service rows on the same terms. Computer rental = 0 (decision D7).
   4. Return the `Section6765Input[]`, `officerWages`, the estimated employee count, and the count of Unknown-country hours.
8. Write `projects-rd-tax.test.ts`:
   1. Time at a location in Germany adds to the Foreign column of the §174A rows.
   2. Time at a US location adds to Domestic, and a location with no country adds to Unknown.
   3. Time on a Direct project under a funded contract gives no wage QRE, and shows under Of which funded.
   4. An employee with no payroll rows uses the labor cost, and the estimated count is 1.

**Verify:**
```bash
pnpm --filter erp test -- projects-rd-tax && pnpm exec turbo run typecheck --filter=erp
# Expected: 4 passed; typecheck exits 0
```

**Out of scope:** the gross receipts and base amounts of Form 6765 Sections A and B.

---

## Task 14: Add the two reports to the CSV route and the Reports page

**Depends on:** 13
**Files:**
- Modify: `apps/erp/app/routes/api+/projects.reports.$reportKey[.]csv.ts`
- Modify: `apps/erp/app/routes/x+/projects+/reports.tsx`

**Steps:**
1. Add two report keys. Both read `taxYear` and compute the range with `taxYearBounds` from `fiscalYearSettings.taxStartMonth`. Both require `view: "projects"` and `view: "accounting"`.
2. **`rd-section-174a`**: one line per business component with the columns of `buildSection174ARows`, then the totals line.
3. **`rd-form-6765-g`**: one line per row of `section6765Rows`, with these columns:
   - 49(a) EIN (`company.taxId`) and 49(b) principal business activity code (empty);
   - 49(c) the component's readable id and name, 49(d) the component type, 49(e) the software type;
   - 50, 51 and 52 (wages by role), and 53 (their sum, decision D8);
   - 54 supplies, 55 computer rental, 56 contract research at 65 %, and the total QRE.
4. After the rows, write these note lines:
   - "Section E line 38, officers' wage QREs: <amount>";
   - "Column 55: Not tracked in Carbon";
   - "Employees with wages estimated from labor cost: <N>", when N is above 0;
   - "Hours excluded for an unknown work country: <H>", when H is above 0.
5. On the Reports page, add the cards **§174A R&E (domestic and foreign)** and **Form 6765 Section G**. Each has a tax year select and **Download CSV**.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exit code 0
```

**Out of scope:** an e-file format. The CSV goes to the tax preparer.

---

## Task 15: Update the rules, AGENTS.md, docs and spec

**Depends on:** 1–14
**Files:**
- Modify: `.claude/rules/government-contracting.md` — an *R&D tax* section, and `packages/utils/src/rd-tax.ts` in `paths:`
- Modify: `.claude/rules/projects-system.md`, `apps/erp/app/modules/projects/AGENTS.md`
- Modify: `docs/content/docs/reference/government-contracting.mdx` — an R&D tax section
- Modify: `.ai/specs/2026-10-09-government-contracting.md`

**Steps:**
1. Document only committed code. Ground every claim in a file.
2. Run `pnpm run generate:mcp`. Commit the digest change for the new service functions.
3. In the spec, record decisions D1–D10 from this plan in *Design Decisions*. State in D8 that column 53 needs a check against the Form 6765 instructions. Add a changelog line.
4. Mark Phase 5d done in the spec's *Delivery phases*.
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

## Task 16: Verify in the browser

**Depends on:** 1–15
**Files:**
- Create: `.ai/playbooks/government-contracting-phase-5d.md` (written by `/test`)

**Steps:**
1. Run `/test` on a satellite dataset company with accounting on.
2. Set up the data:
   1. Add a location with country Germany.
   2. Mark one element as a business component of type Product.
   3. Give a labor category the role Direct Research.
3. Cover the spec's Phase 5d acceptance criteria:
   1. **Work country:** log time on the business component at the German location. The §174A report shows it as foreign R&E.
   2. **Funded research:** mark a contract on a Direct project as Funded, and log time there. The Section G report gives no QRE for it.
   3. **Section G:** the unit test of Task 5 covers 60 components. In the browser, check that the file lists the components in descending QRE order. Check for an aggregate row when components remain.
   4. **Defaults:** a new entry takes the job location and the category's role.
4. Save the playbook to `.ai/playbooks/government-contracting-phase-5d.md`.

**Verify:**
```bash
ls .ai/playbooks/government-contracting-phase-5d.md
# Expected: the file exists, and the /test run reports every step passed
```

**Out of scope:** Phases 5b and 5c.

## Execution notes

- Task 1: every prerequisite exists. `location` has `PRIMARY KEY ("id")` and a separate `UNIQUE ("id", "companyId")`, so Task 3 writes the plain FK of the plan. `location.countryCode` exists; the local database has 2 locations with `US` and 8 with none. Task 1 changes no code, so it has no commit of its own; its tick is in the Task 2 commit.
- Task 3: the work location FK is composite, `("workLocationId", "companyId") REFERENCES "location"("id", "companyId") ON DELETE SET NULL ("workLocationId")`, against `location`'s `UNIQUE ("id", "companyId")`. The plan's plain FK on `location("id")` would accept a location of another company. The index is `("workLocationId", "companyId")`, as the 5a self FKs do. Tasks 2 and 3 ran together in a `BEGIN … ROLLBACK` dry run against the local database before the commit (the backfill updated 0 rows there).
- Task 4: `pnpm db:migrate` applied both migrations (11 and 1 statements recorded) and regenerated the types and swagger. `authz check` reports no drift. `pnpm db:check:datasets` passes all four datasets with no change: no `COVERAGE` set is built from `rdActivityRole`, so step 3 does not apply. The workflow catalog is current. The regenerated MCP digest changes the response digest of the tools that return `employeeJob`, `laborCategory`, `projectElement` and `customerContract` rows; it is in this commit. The pre-commit backup check skipped Tasks 2 and 3 (their migrations were not applied yet), so this commit also holds the backup baseline `packages/jobs/manifests/schema.json`, from `pnpm db:check:backups -- --stage` (restorable).
