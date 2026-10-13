# WBS Interop, Contract Financing and the Earned Value Demo — implementation plan

**Spec:** .ai/specs/2026-10-12-wbs-interop-and-contract-financing.md
**Research:** .ai/research/wbs-interop-and-contract-financing.md
**Branch:** projects-wbs-research-spec
**Run record:** .ai/runs/2026-10-12-defense-manufacturer-pitch.md

## Progress

Phase A — WBS interop
- [x] Task 1: Write the WBS code engine
- [x] Task 2: Write the MIL-STD-881F template data
- [x] Task 3: Add `projectElement.wbsCode`
- [x] Task 4: Make `wbsCode` a plan-layer field and pin, renumber and template writes
- [x] Task 5: Write the CSV reader, writer and import
- [x] Task 6: Write the MSPDI export
- [x] Task 7: Show and edit the WBS code on the Plan and element pages
- [x] Task 8: Add the Plan page menu and the import modal
- [x] Task 9: Offer the 881F templates in New Project

Phase B — contract financing
- [x] Task 10: Add the financing tables and the contract deposit scope
- [x] Task 11: Scope a customer deposit to a contract
- [x] Task 12: Write the financing compute engine
- [x] Task 13: Write the financing service and its package exports
- [x] Task 14: Add the contract Financing routes
- [x] Task 15: Build the Financing UI
- [x] Task 16: Print the financing request
- [x] Task 17: Show the expected liquidation on invoices and payments

Phase C — demo and proof
- [x] Task 18: Move the plan snapshot builder to `@carbon/database`
- [x] Task 19: Seed the satellite baseline, element dates and financing
- [ ] Task 20: Update the docs, rules and AGENTS.md
- [ ] Task 21: Run the browser verification of 5a–5d, A and B
- [ ] Task 22: Mark the spec implemented

## Dependencies

- Task 3 needs nothing. Tasks 1 and 2 are independent of each other and of Task 3.
- Task 4 needs 1, 2 and 3. Tasks 5 and 6 need 4. Tasks 7–9 need 4, 5 and 6.
- Task 10 is independent of Phase A. Task 11 needs 10. Task 12 needs nothing. Task 13 needs 10 and 12. Tasks 14–17 need 11 and 13.
- Task 18 needs 4 (it moves the field list that Task 4 changes). Task 19 needs 10, 13 and 18.
- Task 20 needs 1–19. Task 21 needs 20. Task 22 needs 21.

## Conventions for every task

- Start each new source file with its SPDX header. Run `pnpm --filter @carbon/checks license-headers` after creating files. Files under `packages/ee/` and `.ee.` files take the commercial header.
- Export the database URL before any database command: `export SUPABASE_DB_URL=$(grep '^SUPABASE_DB_URL' .env.local | cut -d= -f2- | tr -d '"')`.
- Commit each task with `/check-and-commit`. It runs Biome, the scoped typecheck, the tests and `/translate`.
- Money and rates use `@carbon/utils` `round` and named kinds. Never use `Math.round` or `.toFixed` (`numeric-precision.md`).
- Dates use `@internationalized/date` or `YYYY-MM-DD` strings. Never use JavaScript `Date` (`date-handling.md`).

---

## Task 1: Write the WBS code engine

**Depends on:** none
**Files:**
- Create: `packages/utils/src/wbs.ts`
- Create: `packages/utils/src/wbs.test.ts`
- Modify: `packages/utils/src/index.ts` — add `export * from "./wbs";`
- Copy from (precedent): `packages/utils/src/timekeeping.ts` (pure rules with a test file)

**Steps:**
1. Define the input type:
   ```ts
   export type WbsNode = {
     id: string;
     parentId: string | null;
     type: string;            // projectElementType
     sortOrder: number;
     sequence: number;        // the number after the last "-" in readableId
     wbsCode: string | null;  // the pinned code
   };
   ```
2. Write `isValidWbsCode(code: string): boolean`. It tests `/^[A-Za-z0-9][A-Za-z0-9.-]{0,39}$/`.
3. Write `childWbsCode(parentCode: string | null, position: number): string`.
   - With no parent, return `String(position)`.
   - If the parent code ends with `.0`, remove the `.0`.
   - Return `${base}.${position}`.
4. Write `computeWbsCodes(nodes: WbsNode[]): { codes: Map<string, string>; duplicates: Set<string> }`.
   1. Group the nodes by `parentId`.
   2. Sort each group by `sortOrder`, then `sequence`.
   3. Walk from the roots, depth first.
   4. Skip a node with `type === "Parameter"`. Skip its whole subtree.
   5. Count positions only over the nodes that are not skipped.
   6. Use the pinned `wbsCode` when it is set. Else use `childWbsCode(parentCode, position)`.
   7. Put the code in `codes` by node id.
   8. Put every code that more than one node has into `duplicates`.
5. Write `wbsSequence(readableId: string): number`. It returns the integer after the last `-`.
6. Write tests:
   - roots A and B, A with children A1 and A2: codes 1, 1.1, 1.2, 2;
   - A2 sorted before A1: A2 = 1.1;
   - a pinned `1.0` root: children 1.1, 1.2;
   - a Parameter between two Tasks: the second Task is 1.2, and the Parameter has no code;
   - a pinned `1.2` beside a derived `1.2`: `duplicates` holds `1.2`;
   - a pinned `5` under a derived parent: its child derives `5.1`;
   - `isValidWbsCode`: `1.2.3a` and `1.0` pass; ``, `.1` and a 41-character code fail.

**Verify:**
```bash
pnpm --filter @carbon/utils exec vitest run src/wbs.test.ts
# Expected: every test passes
pnpm exec turbo run typecheck --filter=@carbon/utils
# Expected: 1 successful
```

**Out of scope:** any database column, any UI.

## Task 2: Write the MIL-STD-881F template data

**Depends on:** none
**Files:**
- Create: `packages/utils/src/wbs-templates.ts`
- Create: `packages/utils/src/wbs-templates.test.ts`
- Modify: `packages/utils/src/index.ts` — add `export * from "./wbs-templates";`
- Read: `.context/research/881f.txt` (the 881F text)

**Steps:**
1. Define:
   ```ts
   export type WbsTemplateRow = { code: string; name: string };
   export type WbsTemplate = { key: "B" | "A" | "C" | "F"; name: string; rows: WbsTemplateRow[] };
   export const WBS_TEMPLATES: readonly WbsTemplate[];
   export function wbsTemplate(key: string): WbsTemplate | undefined;
   export function wbsTemplateParentCode(code: string, rows: WbsTemplateRow[]): string | null;
   ```
2. Fill the rows of Appendix B, A, C and F, levels 1 to 3, in tree order.
   1. Find each appendix's level 1–3 table in `.context/research/881f.txt`: `grep -n "Appendix B" .context/research/881f.txt`.
   2. Copy the codes and names exactly as the table prints them.
   3. Write level 1 as `1.0` for every appendix, because the spec's `.0` rule depends on it.
   4. Keep "1...n (Specify)" in the name.
3. Name the templates: `MIL-STD-881F Appendix B — Electronics/Avionics/Generic Systems`, and the same pattern for A (Aircraft Systems), C (Missile/Ordnance Systems) and F (Space Systems).
4. `wbsTemplateParentCode` returns the row whose code is the longest proper prefix of the code, ending at a `.`, with the `.0` rule applied. `1.1` has the parent `1.0`, and `1.1.2` has the parent `1.1`.
5. Write tests:
   - every code passes `isValidWbsCode`;
   - no code repeats inside a template;
   - every row except the first has a parent in the template;
   - Appendix B has exactly 13 level-2 rows, `1.1` to `1.13`;
   - Appendix B row `1.3` is "Systems Engineering".

🛑 If `.context/research/881f.txt` is missing, STOP and report. Do not write the names from memory.

**Verify:**
```bash
pnpm --filter @carbon/utils exec vitest run src/wbs-templates.test.ts
# Expected: every test passes
```

**Out of scope:** Appendixes D, E, G–M; levels below 3.

## Task 3: Add `projectElement.wbsCode`

**Depends on:** none
**Files:**
- Create: `packages/database/supabase/migrations/<timestamp>_project-element-wbs-code.sql` (from `pnpm db:migrate:new project-element-wbs-code`)
- Copy from (precedent): `packages/database/supabase/migrations/20261011225048_project-control.sql` (guarded `ALTER TABLE`)

**Steps:**
1. Run `pnpm db:migrate:new project-element-wbs-code`.
2. Write:
   ```sql
   ALTER TABLE "projectElement" ADD COLUMN IF NOT EXISTS "wbsCode" TEXT;

   DO $wbs$
   BEGIN
     IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'projectElement_wbsCode_check') THEN
       ALTER TABLE "projectElement" ADD CONSTRAINT "projectElement_wbsCode_check"
         CHECK ("wbsCode" ~ '^[A-Za-z0-9][A-Za-z0-9.-]{0,39}$');
     END IF;
   END $wbs$;

   CREATE UNIQUE INDEX IF NOT EXISTS "projectElement_wbsCode_key"
     ON "projectElement" ("projectId", "companyId", "wbsCode")
     WHERE "wbsCode" IS NOT NULL;
   ```
3. Run `pnpm db:migrate`. It applies the migration and regenerates the types.
4. Run `pnpm run generate:workflow-catalog`, then `pnpm run check:workflow-catalog`.
5. Run `pnpm db:check:datasets` and `pnpm db:check:backups`.

**Verify:**
```bash
grep -c '"wbsCode"' packages/database/src/types.ts
# Expected: 3 or more (Row, Insert, Update of projectElement)
pnpm db:check:datasets
# Expected: all 4 datasets pass
```

**Out of scope:** any code that reads the column.

## Task 4: Make `wbsCode` a plan-layer field and add the pin, renumber and template writes

**Depends on:** 1, 2, 3
**Files:**
- Modify: `apps/erp/app/modules/projects/projects.models.ts` — add `"wbsCode"` to `PLAN_LAYER_FIELDS.projectElement`; add `wbsCodeValidator`
- Modify: `apps/erp/app/modules/projects/projects.server.ts` — add `pinProjectWbsCodes`, `renumberWbsSubtree`, `insertElementsFromWbsTemplate`; extend `createProject`
- Modify: `apps/erp/app/modules/projects/projects.service.ts` — `getProjectElements` selects `wbsCode`
- Create: `apps/erp/app/modules/projects/projects.wbs.test.ts`
- Copy from (precedent): `moveProjectElement` and `insertProjectElement` in `projects.server.ts`

**Steps:**
1. Add `"wbsCode"` to `PLAN_LAYER_FIELDS.projectElement`.
2. Check that `diffRows` (`apps/erp/app/modules/shared/diff.ts`) treats a key missing on one side as `null`.
   - If it reports `undefined → null` as a change, normalize missing keys to `null` in `diffPlanSnapshots`.
   - Add a test: a version 2 snapshot element without `wbsCode` against a live element with `wbsCode: null` gives no diff.
3. Add `wbsCodeValidator = z.object({ wbsCode: zfd.text(z.string().refine(isValidWbsCode).optional()) })`.
4. Add `pinProjectWbsCodes(db, { companyId, userId, projectId })`:
   1. Open a transaction.
   2. Read the elements: `id, parentId, type, sortOrder, readableId, wbsCode`.
   3. Run `computeWbsCodes`. If `duplicates` is not empty, throw `Error("Duplicate WBS codes: …")`.
   4. Update every element whose `wbsCode` is null to its computed code: one `UPDATE … FROM (VALUES …)` statement.
5. Add `renumberWbsSubtree(db, { companyId, userId, projectId, elementId })`. It sets `wbsCode = NULL` on the element and its descendants (recursive CTE, as `moveProjectElement` uses).
6. Add `insertElementsFromWbsTemplate(trx, { companyId, userId, projectId, templateKey })`:
   1. Read the template with `wbsTemplate(templateKey)`. Throw if it is unknown.
   2. Insert the rows in order. A row with children gets type `System`. A leaf gets type `Task`.
   3. Pin each `wbsCode` to the template's code.
   4. Take `readableId` from `project.nextElementSequence`, as `insertProjectElement` does, and advance the counter once by the row count.
   5. Use the default Unstarted state, as `insertProjectElement` does.
   6. Give `sortOrder` by position among siblings, starting at 1.
7. Extend `createProject` with an optional `wbsTemplateKey`. When it is set, call `insertElementsFromWbsTemplate` inside the same transaction.
8. Write `projects.wbs.test.ts` with the pure parts: the template row-to-type mapping (`wbsTemplateElementType`, exported from `projects.models.ts`).

**Verify:**
```bash
pnpm --filter erp exec vitest run app/modules/projects/projects.wbs.test.ts
# Expected: every test passes
pnpm exec turbo run typecheck --filter=erp
# Expected: 2 successful
```

**Out of scope:** UI; CSV; MSPDI.

## Task 5: Write the CSV reader, writer and import

**Depends on:** 4
**Files:**
- Modify: `apps/erp/app/modules/projects/projects.models.ts` — `WBS_CSV_COLUMNS`, `toWbsCsvRows`, `readWbsCsv`
- Modify: `apps/erp/app/modules/projects/projects.server.ts` — `importProjectWbs`
- Create: `apps/erp/app/routes/api+/projects.$projectId.wbs[.]csv.ts`
- Create: `apps/erp/app/routes/x+/project+/$projectId.wbs.import.tsx`
- Create: `apps/erp/app/modules/projects/projects.wbs-csv.test.ts`
- Modify: `apps/erp/app/utils/path.ts` — `projectWbsCsv(id)`, `projectWbsImport(id)`
- Copy from (precedent): `apps/erp/app/routes/api+/projects.reports.$reportKey[.]csv.ts` (CSV download)

**Steps:**
1. `WBS_CSV_COLUMNS = ["Element ID","WBS Code","Parent WBS Code","Level","Type","Name","Start","Target","Budget","Predecessors","Milestone"] as const`.
2. `toWbsCsvRows(elements, links)` returns `string[][]` in tree order.
   - It uses `computeWbsCodes`.
   - It throws when `duplicates` is not empty.
   - `Predecessors` lists the codes of the `precedes` links' `fromElementId`, joined by `; `.
   - `Milestone` is `Y` when the element has a `milestoneId`.
3. `readWbsCsv(rows: Record<string,string>[], existing: { readableId: string; id: string; code: string }[])` returns `{ creates, updates, links, errors }`. Each error is `{ row: number; message: string }`. Validate:
   1. `Name` is required.
   2. `Type` is one of `projectElementTypes`. The default is `Task`.
   3. `WBS Code` passes `isValidWbsCode` when it is set.
   4. `Element ID`, when set, is an existing readable id of the project.
   5. `Parent WBS Code`, when set, is a code in the file or an existing code.
   6. `Start` and `Target` are `YYYY-MM-DD` when set. `Target` is not before `Start`.
   7. `Budget` is a number of 0 or more when set.
   8. Every `Predecessors` code exists.
   9. No code repeats in the file.
4. `importProjectWbs(db, { companyId, userId, projectId, rows })`:
   1. Read the project's elements and links.
   2. Run `readWbsCsv`. If it returns errors, return them and write nothing.
   3. Open one transaction.
   4. Insert the creates parent first, with readable ids from `nextElementSequence`.
   5. Apply the updates.
   6. Insert the missing `precedes` links.
   7. Return the counts.
5. The CSV route needs `view: projects`. It streams the file with `Content-Disposition: attachment; filename="<identifier>-wbs.csv"`. If codes repeat, it returns 422 with the message.
6. The import route action needs `update: projects`. It calls `requireEditablePlanRoute` with `changeRequestId: null`.
   - Intent `preview` returns `readWbsCsv`'s result.
   - Intent `apply` calls `importProjectWbs`.
   - The rows arrive as JSON in a form field named `rows`.
7. Write tests: a round trip (`toWbsCsvRows` then `readWbsCsv` gives 0 creates and 0 errors), an unknown parent code, a repeated code, and a bad date.

**Verify:**
```bash
pnpm --filter erp exec vitest run app/modules/projects/projects.wbs-csv.test.ts
# Expected: every test passes
```

**Out of scope:** deleting elements or links on import; import inside a change request.

## Task 6: Write the MSPDI export

**Depends on:** 4
**Files:**
- Modify: `apps/erp/app/modules/projects/projects.models.ts` — `buildMspdiXml`
- Create: `apps/erp/app/modules/projects/projects.mspdi.test.ts`
- Create: `apps/erp/app/modules/projects/__fixtures__/mspdi-golden.xml`
- Create: `apps/erp/app/routes/api+/projects.$projectId.mspdi[.]xml.ts`
- Modify: `apps/erp/app/utils/path.ts` — `projectMspdi(id)`
- Read: `.ai/research/wbs-interop-and-contract-financing.md` → *Primavera P6, MS Project, Deltek Cobra*

**Steps:**
1. Write `buildMspdiXml({ project, elements, links, baseline })`, returning a string. Escape `& < > " '` in every text value.
2. Write the `Project` children in this order:
   1. `SaveVersion` 14;
   2. `Name`;
   3. `ScheduleFromStart` 1;
   4. `StartDate`;
   5. `CurrencyCode`;
   6. `CalendarUID` 1;
   7. `DefaultStartTime` 08:00:00;
   8. `DefaultFinishTime` 17:00:00;
   9. `MinutesPerDay` 480;
   10. `MinutesPerWeek` 2400;
   11. `DaysPerMonth` 20;
   12. `ExtendedAttributes` (Text1, Text2, Text3);
   13. `Calendars` (one Standard calendar, Monday–Friday 08:00–12:00 and 13:00–17:00);
   14. `Tasks`.
3. Take the FieldIDs from MPXJ's `FieldTypeClass` mapping. Text1 is `188743731`.
   - Read Text2 and Text3 from https://github.com/joniles/mpxj/blob/master/src/main/java/org/mpxj/TaskField.java and the MPXJ MSPDI field map.
   - 🛑 If you cannot confirm the Text2 and Text3 ids, write only Text1 and report it.
4. Write each `Task`'s children in the order of the research file. The task fields:
   - `UID`: `wbsSequence(readableId)`;
   - `ID`: the tree row;
   - `Name`;
   - `Active` 1 and `Manual` 0;
   - `WBS` and `OutlineNumber`: the code;
   - `OutlineLevel`: the depth;
   - `Start` and `Finish`;
   - `Duration` (`PT{8 × working days}H0M0S`) and `DurationFormat` 7;
   - `Milestone` and `Summary`;
   - leaves only: `FixedCost` (budget × 100) and `FixedCostAccrual` 2;
   - leaves with a start only: `ConstraintType` 4 and `ConstraintDate`;
   - one `PredecessorLink` per `precedes` link: `PredecessorUID`, `Type` 1, `LinkLag` 0, `LagFormat` 7;
   - `ExtendedAttribute` rows;
   - `Baseline` with `Number` 0, from the baseline's `schedule` and budgets.
5. Count working days Monday to Friday with `@internationalized/date` (`getDayOfWeek`).
6. Skip Parameter elements and their subtrees, as `computeWbsCodes` does.
7. The route needs `view: projects`. It reads the latest baseline with `formatVersion` 2 or more and refuses repeated codes with 422.
   - It answers with `Content-Type: application/xml`.
   - It names the file `<identifier>.xml`.
8. Write a golden test: a project of 4 elements and 1 link equals `__fixtures__/mspdi-golden.xml`, byte for byte.
   - Write the fixture from the research file's example.
   - Change the fixture only on purpose.

**Verify:**
```bash
pnpm --filter erp exec vitest run app/modules/projects/projects.mspdi.test.ts
# Expected: the golden test passes
```

**Out of scope:** MSPDI import; XER; resources and assignments.

## Task 7: Show and edit the WBS code on the Plan and element pages

**Depends on:** 4, 5, 6
**Files:**
- Modify: `apps/erp/app/modules/projects/ui/Elements/ElementList.tsx` — a `WBS` column
- Modify: `apps/erp/app/modules/projects/ui/Project/ProjectElementTree.tsx` — the code before the name
- Modify: `apps/erp/app/modules/projects/ui/Element/ElementSidebar.tsx` — the WBS code field
- Modify: `apps/erp/app/modules/projects/ui/Element/ElementView.tsx` — **Renumber WBS** in the ⋯ menu
- Create: `apps/erp/app/routes/x+/project+/$projectId.wbs.renumber.tsx`
- Modify: `apps/erp/app/routes/x+/project+/$projectId.elements.tsx` — loader computes the codes
- Copy from (precedent): the readable id cell in `ElementList.tsx`; a text property in `ElementSidebar.tsx` that saves through the element field route

**Steps:**
1. In the elements loader, call `computeWbsCodes` on the loaded elements. Return `wbsCodes` (an object by id) and `wbsDuplicates` (an array).
2. In `ElementList`, add a `WBS` column before Name. Use `tabular-nums`. Show a pin icon (`LuPin`) on a pinned code. Show a warning icon with a tooltip when the code is in `wbsDuplicates`.
3. In `ProjectElementTree`, show the code in muted text before the name.
4. In `ElementSidebar`, add a "WBS code" text field.
   - Its placeholder is the derived code.
   - It saves through the same field-update route as the other plan fields, so the change request overlay applies.
   - Validate it with `wbsCodeValidator`.
5. Add the **Renumber WBS** menu item. It posts to `$projectId.wbs.renumber.tsx`.
   - The action needs `update: projects` and calls `requireEditablePlanRoute`.
   - It then calls `renumberWbsSubtree`.
6. Run `pnpm --filter @carbon/locale lingui:extract` through `/check-and-commit`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: 2 successful
```
Browser check in Task 21.

**Out of scope:** the board and timeline layouts.

## Task 8: Add the Plan page menu and the import modal

**Depends on:** 7
**Files:**
- Modify: `apps/erp/app/modules/projects/ui/Elements/ElementsHeader.tsx` — a ⋯ menu beside Export PDF
- Create: `apps/erp/app/modules/projects/ui/Elements/ImportWbsModal.tsx`
- Create: `apps/erp/app/routes/x+/project+/$projectId.wbs.pin.tsx`
- Copy from (precedent): the ⋯ `DropdownMenu` in `apps/erp/app/modules/projects/ui/Project/ProjectHeader.tsx`; `apps/erp/app/components/ImportCSVModal/UploadCSV.tsx` (PapaParse drop zone)

**Steps:**
1. Add a ⋯ icon button with these items:
   - **Export CSV**: a link to `path.to.projectWbsCsv`;
   - **Export MS Project XML**: a link to `path.to.projectMspdi`;
   - **Import CSV**: opens `ImportWbsModal`;
   - **Pin WBS codes**: a confirm, then a post to `$projectId.wbs.pin.tsx`.
2. The pin action needs `update: projects` and calls `requireEditablePlanRoute`. It then calls `pinProjectWbsCodes` and flashes "WBS codes pinned".
3. `ImportWbsModal`:
   1. A file drop zone. Parse with PapaParse, `header: true`.
   2. Post intent `preview`. Show a table of rows: row number, action (Create or Update), WBS code, name, error.
   3. Enable **Apply** only with 0 errors. Apply posts intent `apply`.
   4. On success, close the modal and flash "N created, M updated".

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: 2 successful
```

**Out of scope:** the generic import wizard.

## Task 9: Offer the 881F templates in New Project

**Depends on:** 4
**Files:**
- Modify: `apps/erp/app/routes/x+/projects+/new.tsx` — loader adds the template options; action routes `wbs:<key>`
- Modify: `apps/erp/app/modules/projects/ui/Projects/ProjectForm.tsx` — none, if `copyFrom.options` already accepts groups; else group the 881F options under a "MIL-STD-881F" label
- Copy from (precedent): the `copyFrom` options in `new.tsx`

**Steps:**
1. Append one option per `WBS_TEMPLATES` entry, with value `wbs:<key>` and label `template.name`.
2. In the action, if `copyFromProjectId` starts with `wbs:`, call `createProject` with `wbsTemplateKey` set to the key.
3. Keep `copyProject` for every other value.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: 2 successful
```

**Out of scope:** Copy from on an existing project's page.

## Task 10: Add the financing tables and the contract deposit scope

**Depends on:** none
**Files:**
- Create: `packages/database/supabase/migrations/<timestamp>_contract-financing.sql` (from `pnpm db:migrate:new contract-financing`)
- Modify: `packages/database/src/authz/manifest.ts` — 5 new tables
- Create: the generated RLS migration (`pnpm --filter @carbon/database authz migration contract-financing-rls`)
- Copy from (precedent): `20261011225048_project-control.sql` (tables, indexes, guarded constraints); `manifest.ts` entry `customerContractFunding`

**Steps:**
1. Run `pnpm db:migrate:new contract-financing`.
2. Write the 3 enums and the 5 tables exactly as the spec's *Data Model Changes* shows. Add to each table:
   - `companyId` FK to `company` (`ON DELETE CASCADE`);
   - the audit columns;
   - composite FKs `(…, "companyId")` to `customerContract`, `customerContractLine`, `contractFinancingRequest`, `performanceBasedPaymentEvent` and `payment`;
   - an index on `companyId`, on each FK, and on `createdBy`.
3. Guard each enum with `DO $$ … IF NOT EXISTS (SELECT 1 FROM pg_type …)`.
4. Add `payment.customerContractId` with a composite FK to `customerContract`. Index it.
5. Replace the deposit CHECK:
   ```sql
   ALTER TABLE "payment" DROP CONSTRAINT IF EXISTS "payment_deposit_document_check";
   ALTER TABLE "payment" ADD CONSTRAINT "payment_deposit_document_check"
     CHECK (num_nonnulls("salesOrderId", "rentalAgreementId", "customerContractId") <= 1);
   ```
6. Add the 5 tables to `manifest.ts` as `company("sales", { read: "sales_view" })`.
7. Run `pnpm db:migrate`.
8. Run `pnpm --filter @carbon/database authz migration contract-financing-rls`.
9. Run `pnpm db:migrate` again.
10. Run `pnpm run generate:workflow-catalog` and `pnpm run check:workflow-catalog`.
11. Run `pnpm db:check:datasets` and `pnpm db:check:backups`.

🛑 If `pnpm db:check:backups` names a column for `ID_REF_COLUMNS`, add it to `packages/jobs/src/backups/id-refs.ts`. Do not skip the check.

**Verify:**
```bash
pnpm --filter @carbon/database authz check
# Expected: no drift
grep -c "contractFinancingRequest" packages/database/src/types.ts
# Expected: 1 or more
```

**Out of scope:** seed data (Task 19).

## Task 11: Scope a customer deposit to a contract

**Depends on:** 10
**Files:**
- Modify: `packages/utils/src/payment-funding.ts` — `FundingScope.type` adds `"customerContract"`; `FundingRequest` adds `customerContractIds`; `fundingScopeCovers`, `depositScopeMessage`, `assertScope`
- Modify: `packages/utils/src/payment-funding.test.ts`
- Modify: `packages/database/src/deposit-scope.ts` — `InvoiceDocumentIds.customerContractIds` (from `salesInvoice.customerContractId` and `salesInvoiceLine.customerContractId`); `loadDepositScope` reads `payment.customerContractId`
- Modify: `packages/server-functions/src/post-payment/journal-input.ts` — `isDeposit` includes `customerContractId`
- Modify: `packages/server-functions/src/post-payment/post-payment-transaction.ts` — pass `customerContractIds` wherever it passes `salesOrderIds`
- Modify: `apps/erp/app/modules/invoicing/invoicing.models.ts` — `customerContractId` on the payment validator and its refines
- Modify: `apps/erp/app/modules/invoicing/invoicing.service.ts` — every `salesOrderIds` / `rentalAgreementIds` build site also builds `customerContractIds`; `getDepositDocuments` lists Active contracts of the customer
- Modify: `apps/erp/app/modules/invoicing/ui/Payment/PaymentForm.tsx`, `PaymentDocuments.tsx`, `PaymentApplyTable.tsx`
- Modify: `apps/erp/app/routes/x+/payments+/new.tsx`, `$paymentId.tsx` — accept `customerContractId`

**Steps:**
1. List every call site with this command:
   ```bash
   grep -rn "rentalAgreementIds\|rentalAgreementId" packages/utils/src/payment-funding.ts packages/database/src/deposit-scope.ts packages/server-functions/src/post-payment apps/erp/app/modules/invoicing apps/erp/app/routes/x+/payments+
   ```
2. At each site, add the contract case beside the rental agreement case.
3. Add the contract scope to `depositScopeMessage`: "A deposit for {readableId} can only be applied to that contract's invoices".
4. Add tests to `payment-funding.test.ts`:
   - a contract deposit covers an invoice with the contract id;
   - it refuses an invoice of another contract;
   - the existing sales order and rental agreement cases still pass.

🛑 If any existing test of `payment-funding.test.ts` or `post-payment` fails after the change, STOP and report. The 2 existing scopes must not change.

**Verify:**
```bash
pnpm --filter @carbon/utils exec vitest run src/payment-funding.test.ts
# Expected: every test passes
pnpm --filter @carbon/server-functions test -- post-payment
# Expected: every test passes
pnpm exec turbo run typecheck --filter=erp
# Expected: 2 successful
```

**Out of scope:** financing requests; any GL account change.

## Task 12: Write the financing compute engine

**Depends on:** none
**Files:**
- Create: `packages/ee/src/contract-financing/compute.ts`
- Create: `packages/ee/src/contract-financing/compute.test.ts`
- Copy from (precedent): `packages/ee/src/indirect-rates/compute.ts` and its test

**Steps:**
1. Export `SF1443_WHOLE_DOLLAR_SCALE = 0`.
2. `rateOn(rates, date)` returns the row with the latest `effectiveDate` on or before `date`, or null.
3. `lossRatio(price, incurred, estimateToComplete)` returns `price / (incurred + estimateToComplete)` when the sum exceeds `price`, else 1.
4. `computeSf1443(input)` takes:
   - `contractPrice`, `progressPaymentRate`, `liquidationRate`;
   - `eligibleCost`, `incurredCost`, `estimateToComplete`;
   - `subcontract` (`{ a, b, d }`);
   - `previousRequested`, `deliveredCost20a`, `deliveredPrice21a`, `liquidated23`;
   - `overrides` (`Record<line, number>`).
   It returns `Record<Sf1443Line, number>` for lines 5 to 26. Apply the formulas of the research file's *SF 1443 lines* table:
   - Line 13 = 11 × `lossRatio` × 6A.
   - Section III only when 21a > 0. Else line 26 = line 19.
   - An override replaces a line before later lines use it.
   - Round every line with `round(x, SF1443_WHOLE_DOLLAR_SCALE)`, half up.
   - A negative line 19 or 26 becomes 0.
5. `expectedLiquidation({ rate, invoiceSubtotal, unliquidated, earlierExpected })` returns the lesser of `rate × subtotal` and `unliquidated − earlierExpected`, never below 0.
6. `unliquidatedBalance(deposits, applications)` returns Σ deposits − Σ applications.
7. `buildPbpRequest({ events, billedEventIds, contractPrice, maximumShare, previousBilled, incurredCost })`:
   1. Take the complete events that are not billed yet.
   2. Drop a Cumulative event when an event before it in sequence is not complete.
   3. Return `{ eventIds, values: { "1a", "1b", "1c", "2" } }`.
   4. Return `error: "PBP_CAP_EXCEEDED"` when 1c > `maximumShare × contractPrice`.
8. Write tests:
   - the spec's acceptance numbers: $1,000,000 price, rates 0.80/0.80, $300,000 eligible, no delivery → line 26 = 240,000;
   - the FAR loss-ratio example: price 3,000,000, incurred 2,700,000, ETC 900,000, eligible 2,700,000 → ratio 0.8333 and line 13 = 1,800,000 (2,700,000 × 0.8333… × 0.8). Assert the exact rounded result;
   - an override of 20a feeds 20b;
   - `expectedLiquidation` caps at the balance;
   - the PBP Cumulative order;
   - the PBP 90 % cap.

**Verify:**
```bash
pnpm --filter @carbon/ee exec vitest run src/contract-financing/compute.test.ts
# Expected: every test passes
```

**Out of scope:** database reads.

## Task 13: Write the financing service and its package exports

**Depends on:** 10, 12
**Files:**
- Create: `packages/ee/src/contract-financing/models.ts`, `types.ts`, `index.ts`, `service.server.ts`, `server.ts`
- Modify: `packages/ee/package.json` — exports `./contract-financing` and `./contract-financing.server`
- Copy from (precedent): `packages/ee/src/indirect-rates/` (the same 5 files and their exports)

**Steps:**
1. `models.ts` validators:
   - `contractFinancingTermsValidator` (method, price, award date, small business, maximum share);
   - `contractFinancingRateValidator` (effective date, the 2 rates as fractions, modification number);
   - `pbpEventValidator`;
   - `pbpEventCompleteValidator`;
   - `financingRequestValidator` (request date, costs-through date, ETC, ETC date);
   - `financingOverrideValidator` (line, value, reason; reason required);
   - `financingApproveValidator` (approved amount).
2. `types.ts` derives the row types from `@carbon/database` only. It never imports `service.server.ts` (`commercial-licensing.md` → Bundling gotcha).
3. In `service.server.ts`, each authoring function starts with `await requireEntitlement(client, companyId, "GOVERNMENT_CONTRACTING")`:
   - `upsertContractFinancing` refuses a contract whose currency is not the base currency.
   - `addFinancingRate` refuses a progress payment rate on a PBP contract.
   - `upsertPbpEvent`.
   - `completePbpEvent`.
   - `createFinancingRequest` computes the lines with `loadSf1443Inputs` and `computeSf1443`, or with `buildPbpRequest`.
   - `overrideRequestLine` works on a Draft only. It recomputes the lines with the overrides.
   - `submitFinancingRequest` gives `requestNumber` from `nextRequestNumber` in one transaction (UPDATE … RETURNING), then sets Submitted.
   - `approveFinancingRequest` works from Submitted. It sets Approved and `approvedAmount`.
   - `withdrawFinancingRequest` works from Draft or Submitted.
4. `loadSf1443Inputs(db, { companyId, customerContractId, costsThroughDate })` runs 5 grouped Kysely queries:
   1. The contract projects: the contract's project, and the projects of lines with `billingMethod = 'Fixed'`.
   2. `projectLedger` sums: eligible (`unallowable = false`) and incurred, with `postingDate <= costsThroughDate`.
   3. The earlier requests' `requestedAmount`, status not Withdrawn.
   4. The posted invoices of the contract, `status` not in Draft or Voided, `postingDate <= costsThroughDate`: Σ `subtotal`.
   5. The contract deposits and their applications (`invoiceSettlement` with `sourcePaymentId` in the deposit ids).
5. `getExpectedLiquidation(client, companyId, salesInvoiceId)` degrades with `companyHasFeature`. It returns null without the feature or without financing.
6. A Paid status: `markRequestPaid(db, { paymentId })` sets Paid when the request's payment is Posted. The payment route calls it after a successful post.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/ee
# Expected: 1 successful
```

**Out of scope:** routes and UI.

## Task 14: Add the contract Financing routes

**Depends on:** 11, 13
**Files:**
- Create: `apps/erp/app/routes/x+/contract+/$id.financing.tsx` (the loader and the terms, rates and events actions)
- Create: `apps/erp/app/routes/x+/contract+/$id.financing.$requestId.tsx` (the request drawer and its actions)
- Create: `apps/erp/app/routes/x+/contract+/$id.financing.new.tsx` (create a request)
- Modify: `apps/erp/app/utils/path.ts` — `contractFinancing`, `contractFinancingRequest`, `newContractFinancingRequest`
- Modify: `apps/erp/app/modules/sales/ui/Contracts/ContractHeader.tsx` — a Financing tab
- Copy from (precedent): `apps/erp/app/routes/x+/contract+/$id.$lineId.funding-actions.tsx` (`requireFeature` plus `EntitlementError`); `apps/erp/app/routes/x+/accounting+/indirect-rates.tsx` (intents)

**Steps:**
1. Loaders need `view: sales`. Actions need `update: sales`. **Record payment** needs `create: invoicing`.
2. Each action calls `requireFeature({ … feature: "GOVERNMENT_CONTRACTING" })` and catches `EntitlementError` into a flash.
3. The intents of `$id.financing.tsx`: `terms`, `rate`, `event`, `complete-event`.
4. The intents of `$id.financing.$requestId.tsx`: `override`, `submit`, `approve`, `withdraw`, `record-payment`.
   - `record-payment` creates a Draft customer payment with `customerContractId` and `totalAmount = approvedAmount`.
   - It stores `paymentId` and redirects to the payment.
5. In `ContractHeader`, build the tab list. Add Financing when `useGovernmentContracting()` is true. Show the tabs when there are 2 or more.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: 2 successful
```

**Out of scope:** UI components beyond the header tab (Task 15).

## Task 15: Build the Financing UI

**Depends on:** 14
**Files:**
- Create: `apps/erp/app/modules/sales/ui/Contracts/ContractFinancing.ee.tsx`
- Create: `apps/erp/app/modules/sales/ui/Contracts/ContractFinancingRequest.ee.tsx`
- Modify: `apps/erp/app/modules/sales/ui/Contracts/index.ts` — the 2 exports
- Copy from (precedent): `ContractFundingActions.tsx` (inline-edit grid), `ContractRateCeilings.ee.tsx` (gate), `apps/erp/app/modules/accounting/ui/IndirectRates/IndirectRateRuns.ee.tsx` (runs table with title badge)

**Steps:**
1. `ContractFinancing`:
   1. If `usePlanGate({ feature: "GOVERNMENT_CONTRACTING" }).isGated`, render `UpgradeOverlaySection` and nothing else.
   2. The terms card: a `ValidatedForm` with `contractFinancingTermsValidator`.
   3. The rate history: a grid with `contractFinancingRateValidator`.
   4. PBP only: the events grid, an inline-edit grid like `ContractFundingActions`, with a Complete action per row.
   5. The requests `Table`: number, request date, through date, status, requested, approved. Put the unliquidated balance in `titleBadge`. **New Request** is the primary action.
2. `ContractFinancingRequest` (drawer):
   1. A table of the lines: line, label, computed, override with its reason.
   2. A Draft row has an edit button that opens the override modal.
   3. Actions follow the status: Submit and Withdraw (Draft); Approve and Withdraw (Submitted); Record payment (Approved); Print (all).
   4. A warning shows when `estimateDate` is more than 6 months before the request date.
3. Label every string with Lingui.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: 2 successful
```

**Out of scope:** the PDF (Task 16).

## Task 16: Print the financing request

**Depends on:** 13
**Files:**
- Create: `packages/documents/src/pdf/ContractFinancingRequestPDF.tsx`
- Modify: `packages/documents/src/pdf/index.ts` — export it
- Create: `apps/erp/app/routes/file+/contract+/financing.$requestId[.]pdf.tsx`
- Copy from (precedent): `packages/documents/src/pdf/SalesInvoicePDF.tsx`; `apps/erp/app/routes/file+/purchase-order+/$orderId[.]pdf.tsx`

**Steps:**
1. For a progress payment request, print Section I (lines 1–8B), Section II (lines 11–19) and, when 21a > 0, Section III (lines 20a–26). Show line 27 blank for the contracting officer.
2. Print the amounts as whole dollars with `formatMoney` and 0 decimals, through the named kind.
3. For a PBP request, print the events table (code, description, CLIN, amount) and the 1a, 1b, 1c and 2 values.
4. Add a footer: "Prepared in Carbon. Enter this request in WAWF."
5. The route needs `view: sales` and streams the PDF.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/documents --filter=erp
# Expected: 3 successful
```

**Out of scope:** WAWF EDI 810P.

## Task 17: Show the expected liquidation on invoices and payments

**Depends on:** 11, 13
**Files:**
- Modify: `apps/erp/app/routes/x+/sales-invoice+/$invoiceId.tsx` — loader calls `getExpectedLiquidation`
- Modify: `apps/erp/app/modules/invoicing/ui/SalesInvoice/SalesInvoiceSummary.tsx` — an informational row
- Modify: `apps/erp/app/routes/file+/sales-invoice+/$id[.]pdf.tsx` and `packages/documents/src/pdf/SalesInvoicePDF.tsx` — a note line
- Modify: `apps/erp/app/modules/invoicing/ui/Payment/PaymentApplyTable.tsx` — the suggested credit amount
- Copy from (precedent): the existing `SummaryLineRow` rows in `SalesInvoiceSummary.tsx`

**Steps:**
1. The loader returns `expectedLiquidation` (`{ amount, rate } | null`).
2. When it is set, `SalesInvoiceSummary` shows the row "Progress payment liquidation expected" with the amount. It does not change the total.
3. The PDF prints the same note under the totals. The invoice total stays gross.
4. In `PaymentApplyTable`, when the payment applies a contract deposit to an invoice of that contract, prefill the amount with the expected liquidation.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp --filter=@carbon/documents
# Expected: 3 successful
pnpm --filter erp exec vitest run app/modules/invoicing/ui/Payment/PaymentApplyTable.test.tsx
# Expected: every test passes
```

**Out of scope:** changing the invoice total or its posting.

## Task 18: Move the plan snapshot builder to `@carbon/database`

**Depends on:** 4
**Files:**
- Create: `packages/database/src/project-plan.ts`
- Modify: `packages/database/package.json` — export `./project-plan`
- Modify: `apps/erp/app/modules/projects/projects.models.ts` — re-export the moved names

**Steps:**
1. Move these names from `projects.models.ts` to `project-plan.ts`, with every type and helper they need:
   - `ProjectPlanTable`;
   - `PLAN_LAYER_FIELDS`;
   - `PROJECT_BASELINE_FORMAT_VERSION`;
   - `toPlanSnapshot`;
   - `ProjectPlanSnapshot`;
   - `PlanScheduleRow`.
2. In `projects.models.ts`, replace the bodies with `export { … } from "@carbon/database/project-plan";`.
3. 🛑 If a moved name depends on ERP-only code (`~/…`), STOP and report.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/database --filter=erp --filter=@carbon/ee
# Expected: 4 successful
pnpm --filter erp test
# Expected: every test passes
```

**Out of scope:** behavior changes.

## Task 19: Seed the satellite baseline, element dates and financing

**Depends on:** 10, 13, 18
**Files:**
- Modify: `packages/database/src/datasets/types.ts` — `ProjectElementSpec.startOffset`, `targetOffset`; `ProjectSpec.baseline`; `SalesData` (or the slice that holds contracts) gains `contractFinancing`
- Modify: `packages/database/src/datasets/tiers/09-accounting.ts` — write the dates, the baseline and the financing rows
- Modify: `packages/database/src/datasets/data/satellite/accounting.ts` — dates on the ORBSEC Block 2 work packages, `baseline: { name: "Contract award", dateOffset: -120 }`
- Modify: `packages/database/src/datasets/data/satellite/sales.ts` (or the file that holds the ORBSEC contract) — progress payment terms, 1 rate, 1 Paid request, 1 Draft request, 1 deposit, 1 liquidation
- Modify: `packages/database/src/datasets/coverage.ts` — `DATASET_COVERAGE_FLOORS.satellite`: `projectBaseline: 1`, `customerContractFinancing: 1`, `contractFinancingRequest: 2`
- Modify: `packages/database/src/datasets/validate.ts` — element dates (target not before start)
- Copy from (precedent): `seedProjects` in tier 09; the posted payment and settlement seeding in `helpers/post-documents.ts`

**Steps:**
1. Give each OB2 work package a `startOffset` and `targetOffset` inside the project's milestones.
2. After the elements and links of a project with `baseline`, call `toPlanSnapshot` on the rows just inserted.
   - Insert `projectBaseline` with `formatVersion: PROJECT_BASELINE_FORMAT_VERSION`, `source: "Manual"`, `sequence` 1, and `createdAt` at the offset.
   - Set `project.nextBaselineSequence = 2`.
   - 🛑 If `projectBaseline.source` has no `Manual` value, read the enum and use the value that `createProjectBaseline` uses.
3. Seed the financing rows of the ORBSEC contract:
   - terms: price 2,400,000, award date −200, not small business;
   - one rate: 0.80 / 0.80 at −200;
   - the Paid request: number 1;
   - the Draft request: no number; `nextRequestNumber` 2.
4. Seed the deposit payment of request 1 as a Posted customer payment with `customerContractId`, journaled through `buildPaymentJournal`. Follow the existing Posted payment convention in `post-documents.ts`.
5. If the contract has a posted invoice, seed 1 liquidation as an `invoiceSettlement` sourced from the deposit. If it has none, skip the liquidation and record that in the plan's *Execution notes*.
6. Run `pnpm db:check:datasets`.
7. Run `pnpm db:seed:dev -- --email <the dev user> --dataset satellite`.
8. Open the ORBSEC Block 2 Costs page to check the earned value rows.

**Verify:**
```bash
pnpm db:check:datasets
# Expected: all 4 datasets pass, no coverage shortfall
```

**Out of scope:** the other 3 datasets (the content is satellite-only, as the planning group precedent).

## Task 20: Update the docs, rules and AGENTS.md

**Depends on:** 1–19
**Files:**
- Modify: `.claude/rules/projects-system.md` — a *WBS codes* section (computed codes, pin, renumber, templates, CSV, MSPDI)
- Create: `.claude/rules/contract-financing.md` — the financing model, gates, the deposit scope and the SF 1443 lines; `paths:` for `packages/ee/src/contract-financing/**` and the financing routes
- Modify: `.claude/rules/government-contracting.md` — a pointer to `contract-financing.md`
- Modify: `apps/erp/app/modules/projects/AGENTS.md`, `apps/erp/app/modules/sales/AGENTS.md`, `apps/erp/app/modules/accounting/AGENTS.md` (the deposit scope)
- Modify: `AGENTS.md` — Task Router row for contract financing
- Modify: `docs/content/docs/reference/projects.mdx`, `docs/content/docs/reference/government-contracting.mdx`
- Modify: `docs/content/src/glossary/terms.ts` — WBS code, Progress payment, Liquidation, Performance-based payment

**Steps:**
1. Write each section from the committed code, not from the spec.
2. Mark anything unverified with `<!-- UNVERIFIED: … -->`.
3. Use the `carbon-docs` skill for the two reference pages.

**Verify:**
```bash
pnpm --filter docs typecheck
# Expected: no errors
```

**Out of scope:** a changelog entry.

## Task 21: Run the browser verification of 5a–5d, A and B

**Depends on:** 20
**Files:**
- Create: `.ai/playbooks/government-contracting-phase-5a.md`, `-5b.md`, `-5c.md`, `-5d.md`, `wbs-interop.md`, `contract-financing.md` (written by `/test`)

**Steps:**
1. Run `/test` with the steps of `.ai/plans/2026-10-09-government-contracting-phase-5a.md` Task 35.
2. Run `/test` with the steps of `-5b.md` Task 22.
3. Run `/test` with the steps of `-5c.md` Task 23.
4. Run `/test` with the steps of `-5d.md` Task 16.
5. Run `/test` with the spec's Phase A acceptance criteria.
6. Run `/test` with the spec's Phase B acceptance criteria.

🛑 If the dev stack is not running, STOP. Report the flows as not run. Never report them as passed.

**Verify:**
```bash
ls .ai/playbooks/government-contracting-phase-5a.md .ai/playbooks/wbs-interop.md .ai/playbooks/contract-financing.md
# Expected: the files exist, and each /test run reports every step passed
```

**Out of scope:** fixing bugs outside these flows.

## Task 22: Mark the spec implemented

**Depends on:** 21
**Files:**
- Modify: `.ai/specs/2026-10-12-wbs-interop-and-contract-financing.md` — status, changelog
- Move: the spec to `.ai/specs/implemented/` only when Task 21 passed

**Steps:**
1. Update the spec where the code differs from the design.
2. Add a changelog line with the date and the plan path.
3. Move the spec only when every acceptance criterion has evidence. Else leave it with status `in-progress`.

**Verify:**
```bash
grep -n "^> Status" .ai/specs/implemented/2026-10-12-wbs-interop-and-contract-financing.md .ai/specs/2026-10-12-wbs-interop-and-contract-financing.md 2>/dev/null
# Expected: one file, with the status that matches the evidence
```

**Out of scope:** the PR.

## Execution notes
- Task 4: `computeWbsCodes` sorts siblings by `projectElement.sequence` (an existing column) rather than parsing `readableId`; `wbsSequence` stays as a helper. `wbsCodeValidator` was not added: the field route validates the code in `updateProjectElementField` and `parseElementPlanFieldValue`. Build from part sets `wbsCode` to null on the elements it copies, so a template's pinned codes cannot collide with the project's own.
- Task 5: the `Milestone` column was dropped. A project element has no milestone type (`milestoneId` groups elements under a milestone), so the column had nothing true to say. On an update a blank cell keeps the current value, and a code is pinned only when it differs from the element's current code, so an export read back changes nothing.
- Task 6: Text2 and Text3 field ids confirmed from MPXJ `MPPTaskField` (base `0x0B400000`, Text1 = 51, Text2 = 54, Text3 = 57): 188743734 and 188743737. `OutlineNumber` is the row's position, `WBS` the code. The golden file is a vitest file snapshot (`toMatchFileSnapshot`), reviewed by hand.
- Task 7: the list and the sidebar tree show WBS codes only once the project has a pinned code (Layer 5: a feature shows when used). The element page's WBS code field shows for every type but Parameter, with the derived code as its placeholder. The board is not a layout here: the Plan page has list, tree (graph) and reader.
- Task 8: the import modal uses a plain file input with `parseCsvFile` (`@carbon/files/csv`) rather than the `UploadCSV` drop zone, which uploads to storage for the generic wizard. The ⋯ menu sits in a `wbsMenu` slot of `ElementsHeader` before Filter.
- Task 9: the 881F templates are Copy from options with value `wbs:<key>`; `ProjectForm` needed no change. Translations of the new Phase A and B strings are filled once, after Task 17, rather than per task.
- Task 11: a contract's invoices are those with the contract on the header, on a line, or on a line of the contract's own sales order (`customerContract.salesOrderId`): a shipment converts to an invoice that carries the order, not the contract. `loadSalesInvoiceDocumentIds` and the ERP's open-invoice reader both apply it, and `loadContractInvoiceIds` (`deposit-scope.ts`) gives the same set to financing. The prior-source query of post-payment already used `selectAll`, so it needed no change. The contract deposit links to the contract with the Contracts module icon.
- Task 13: a Draft request is deleted, not set Withdrawn: the CHECK ties the Draft status to a null number, and a Withdrawn request keeps the number Submit gave it. Paid is set by `markFinancingRequestsPaid`, which the payment post route calls after a successful post (no entitlement: it records a fact). `lines` holds the computed values and `overrides` the user's; `requestedAmount` is line 26 with the overrides applied. `getExpectedLiquidation` reads the invoice's contracts with `loadSalesInvoiceDocumentIds`, one read, not one per financed contract.
- Tasks 14 and 15 shipped as one commit: the routes and their components import each other. The request is created through intent `request` of `$id.financing.tsx` (no `$id.financing.new.tsx`). Rates and events use read-only tables with add modals, not the inline-edit grid of `ContractFundingActions`: rates are append-only and an event changes rarely once billed. Record Payment redirects to New Payment with `customerContractId`, `financingRequestId` and the approved amount; the payment's create action links it (`linkFinancingPayment`) and its post action marks the request Paid (`markFinancingRequestsPaid`). `checkDepositDocument` now checks a contract deposit's customer and status, so the hidden field is never trusted.
- Task 16: the PDF is hand-built like `ProjectReaderPDF` (no template engine): a government form, not a customer document. The route formats every value; amounts print in whole dollars through `formatMoney` with `SF1443_WHOLE_DOLLAR_SCALE`, and an overridden line prints its computed value and reason under it.
- Task 17: DEFERRED, two parts. (1) The sales invoice PDF note: `SalesInvoicePDF` renders through the document template engine (blocks and sections), and a note there is a template change. (2) Prefilling the payment form's credit amount with the expected liquidation: it needs a per-invoice liquidation read in the payment loaders. The invoice prints the GROSS amount either way, which is what DFAS asks; the invoice page shows the expected liquidation, and the user types it on the payment's credit row. Both are follow-ups.
- Task 18: `planSnapshotKeys`, `isPlanLayerField`, `pickPlanLayerFields` and `parsePlanSnapshot` moved too, because `toPlanSnapshot` needs them. `projects.models.ts` imports and re-exports every moved name, and keeps its own `byId` for the diff code. ERP tests: 203 files, 2293 passed.
- Task 19: the four ORBSEC Block 2 work packages also needed budgets (BAC comes from the baseline budget): 40,000, 30,000, 50,000 and 25,000. The baseline reads the 5 plan tables as `to_jsonb` rows, one after another on the tier's single client, so dates and numbers reach the snapshot as the app's reads give them. DEFERRED: the financing demo rows. The satellite dataset has no ORBSEC contract (its contracts are NovaSat service contracts), so seeding financing means adding a contract with its lines, schedule and invoices; that is a follow-up. `db:seed:dev` was not run: it wipes a company, so the earned value page is checked in Task 21 on an existing seeded company.
