# Project Materials Page — implementation plan

**Spec:** .ai/specs/2026-11-25-project-materials-page.md
**Research:** .ai/research/2026-11-24-project-items-view.md
**Closest sibling:** the project Pegging page (`$projectId.pegging.tsx`, `ui/Pegging/ProjectPegging.tsx`); the read path copies `getProjectStockOnHand`
**Branch:** naveenkash/assigned-items-projects

## Progress
- [x] Task 1: Write the migration for `get_project_materials` and `get_item_used_in`
- [x] Task 2: Apply the migration and regenerate the types
- [x] Task 3: Write the database test for `get_project_materials`
- [x] Task 4: Add the `getProjectMaterials` building block and operation
- [x] Task 5: Add the issue status color map
- [x] Task 6: Write the pure grouping and filter helper, with its test
- [x] Task 7: Add the route, the path, the shortcut and the sidebar link
- [x] Task 8: Build the `ProjectMaterials` component
- [x] Task 9: Add the Projects group to Used In
- [x] Task 10: Show the linked part on the Plan list and the Tree cards
- [x] Task 11: Show the past-average hint in the element sidebar
- [x] Task 12: Update the rule and the module guide
- [x] Task 13: Extract and translate the new strings
- [x] Task 14: Run the heavy checks (main agent only)
- [x] Task 15: Verify in the browser

## Dependencies
- Task 2 needs Task 1.
- Tasks 3, 4 and 9 need Task 2 (types).
- Task 7 needs Task 4.
- Task 8 needs Tasks 5, 6 and 7.
- Tasks 5, 6, 10 and 11 are independent of each other and of Tasks 1–4.
- Task 12 needs Tasks 8–11.
- Task 13 needs Tasks 8–11.
- Task 14 needs Tasks 1–13. Only the main agent runs it.
- Task 15 needs Task 14.

Rules for every task:
- Start every new source file with its SPDX header. Run `pnpm --filter @carbon/checks license-headers` after you create a file.
- Do not run the `erp` typecheck, `pnpm generate:mcp` or `pnpm check:manifest` in a subagent. Task 14 runs them once.
- Answer `.claude/rules/write-time-checklist.md` before you write each file.

---

## Task 1: Write the migration for `get_project_materials` and `get_item_used_in`

**Depends on:** none
**Files:**
- Create: `packages/database/supabase/migrations/<timestamp>_project-materials.sql` (the command makes the name)
- Copy from (precedent): `packages/database/supabase/migrations/20261023011138_project-ledger-relocates-receipt-charge.sql` (the inventory-account rule), `packages/database/supabase/migrations/20261023065804_remove-service-orders.sql` lines 12–52 (the `covered` rule), `packages/database/supabase/migrations/20261005041631_item-usage-and-change-notice-lookups.sql` (the newest `get_item_used_in`)

**Steps:**
1. Read `.claude/rules/workflow-database-migration.md`.
2. Run `pnpm db:migrate:new project-materials`.
3. Put this header at the top of the new file:
   ```sql
   -- Projects: the Materials page and the Projects group of Used In.
   -- Spec: .ai/specs/2026-11-25-project-materials-page.md
   ```
4. Add the function `get_project_materials` with exactly this SQL:
   ```sql
   CREATE OR REPLACE FUNCTION public.get_project_materials(project_id TEXT, company_id TEXT)
   RETURNS TABLE (
     "rowKind" TEXT,
     "projectElementMaterialId" TEXT,
     "projectElementId" TEXT,
     "elementReadableId" TEXT,
     "elementName" TEXT,
     "elementSequence" INTEGER,
     "elementStateName" TEXT,
     "elementStateGroup" "projectStateGroup",
     "elementStateColor" TEXT,
     "itemId" TEXT,
     "itemReadableId" TEXT,
     "itemName" TEXT,
     "methodType" "methodType",
     "unitOfMeasureCode" TEXT,
     "quantityRequired" NUMERIC,
     "quantityOrdered" NUMERIC,
     "quantityReceived" NUMERIC,
     "quantityIssued" NUMERIC,
     "quantityRemaining" NUMERIC,
     "requiredDate" DATE,
     "issueStatus" TEXT,
     "supplies" JSONB,
     "projectOnHand" NUMERIC,
     "unassignedOnHand" NUMERIC
   )
   LANGUAGE sql
   STABLE
   SECURITY INVOKER
   SET search_path TO 'public'
   AS $$
     WITH proj AS (
       SELECT p."id", p."locationId", p."projectStock", p."startDate"
       FROM "project" p
       WHERE p."id" = project_id AND p."companyId" = company_id
     ),
     materials AS (
       SELECT m.*
       FROM "projectElementMaterial" m
       WHERE m."projectId" = project_id AND m."companyId" = company_id
     ),
     -- The rule of project_receipt_charge_quantities: a relocation row whose
     -- journal line is on an inventory account is the inventory side.
     inventory_accounts AS (
       SELECT ARRAY[ad."rawMaterialsAccount", ad."finishedGoodsAccount"] AS "accounts"
       FROM "accountDefault" ad
       WHERE ad."companyId" = company_id
     ),
     issues AS (
       SELECT pl."projectElementId", pl."itemId", SUM(pl."quantity") AS "quantity"
       FROM "projectLedger" pl
       LEFT JOIN "journalLine" jl
         ON jl."id" = pl."journalLineId" AND jl."companyId" = pl."companyId"
       LEFT JOIN inventory_accounts a ON TRUE
       WHERE pl."companyId" = company_id
         AND pl."projectId" = project_id
         AND pl."documentType" = 'Project Issue'
         AND pl."itemId" IS NOT NULL
         AND NOT (
           pl."relocatesReceiptCharge"
           AND COALESCE(jl."accountId" = ANY(a."accounts"), FALSE)
         )
       GROUP BY pl."projectElementId", pl."itemId"
     ),
     -- The covered rule of openProjectMaterialLines.
     po_supply AS (
       SELECT
         pol."id" AS "lineId",
         pol."projectId",
         pol."projectElementId",
         pol."itemId",
         po."id" AS "documentId",
         po."purchaseOrderId" AS "readableId",
         po."status"::TEXT AS "status",
         CASE
           WHEN pol."receivedComplete" OR po."status" IN ('Closed', 'Rejected')
             THEN COALESCE(pol."quantityReceived", 0)
           ELSE GREATEST(COALESCE(pol."purchaseQuantity", 0), COALESCE(pol."quantityReceived", 0))
         END * COALESCE(pol."conversionFactor", 1) AS "ordered",
         COALESCE(pol."quantityReceived", 0) * COALESCE(pol."conversionFactor", 1) AS "received",
         purchase_order_line_consumed_by_project(
           pol."companyId", pol."projectId", pol."projectElementId",
           po."purchaseOrderType", i."itemTrackingType"
         ) AS "consumed"
       FROM "purchaseOrderLine" pol
       JOIN "purchaseOrder" po
         ON po."id" = pol."purchaseOrderId" AND po."companyId" = pol."companyId"
       JOIN "item" i
         ON i."id" = pol."itemId" AND i."companyId" = pol."companyId"
       WHERE pol."companyId" = company_id
         AND (
           pol."projectId" = project_id
           OR pol."id" IN (SELECT "purchaseOrderLineId" FROM materials WHERE "purchaseOrderLineId" IS NOT NULL)
         )
     ),
     job_supply AS (
       SELECT
         j."id" AS "documentId",
         j."projectId",
         j."projectElementId",
         j."itemId",
         j."jobId" AS "readableId",
         j."status"::TEXT AS "status",
         CASE
           WHEN j."status" IN ('Completed', 'Closed', 'Cancelled') THEN j."quantityComplete"
           ELSE j."quantity"
         END AS "ordered",
         j."quantityComplete" AS "received",
         j."consumeToProject" AS "consumed"
       FROM "job" j
       WHERE j."companyId" = company_id
         AND (
           j."projectId" = project_id
           OR j."id" IN (SELECT "jobId" FROM materials WHERE "jobId" IS NOT NULL)
         )
     ),
     plan_rows AS (
       SELECT
         'Plan'::TEXT AS "rowKind",
         m."id" AS "projectElementMaterialId",
         m."projectElementId",
         m."itemId",
         m."methodType",
         m."unitOfMeasureCode",
         m."quantity" AS "quantityRequired",
         COALESCE(ps."ordered", js."ordered", 0) AS "quantityOrdered",
         COALESCE(ps."received", js."received", 0) AS "quantityReceived",
         m."quantityIssued"
           + CASE WHEN ps."consumed" THEN ps."received" ELSE 0 END
           + CASE WHEN js."consumed" THEN js."received" ELSE 0 END AS "quantityIssued",
         COALESCE(m."requiredDate", e."startDate", (SELECT "startDate" FROM proj)) AS "requiredDate",
         CASE
           WHEN ps."lineId" IS NOT NULL THEN jsonb_build_array(jsonb_build_object(
             'type', 'Purchase Order', 'documentId', ps."documentId",
             'readableId', ps."readableId", 'lineId', ps."lineId", 'status', ps."status"))
           WHEN js."documentId" IS NOT NULL THEN jsonb_build_array(jsonb_build_object(
             'type', 'Job', 'documentId', js."documentId",
             'readableId', js."readableId", 'lineId', NULL, 'status', js."status"))
           ELSE '[]'::jsonb
         END AS "supplies"
       FROM materials m
       JOIN "projectElement" e
         ON e."id" = m."projectElementId" AND e."companyId" = m."companyId"
       LEFT JOIN po_supply ps ON ps."lineId" = m."purchaseOrderLineId"
       LEFT JOIN job_supply js ON js."documentId" = m."jobId"
     ),
     unplanned_sources AS (
       SELECT i."projectElementId", i."itemId",
         0::NUMERIC AS "ordered", 0::NUMERIC AS "received", i."quantity" AS "issued",
         NULL::JSONB AS "supply"
       FROM issues i
       WHERE NOT EXISTS (
         SELECT 1 FROM materials m
         WHERE m."projectElementId" IS NOT DISTINCT FROM i."projectElementId"
           AND m."itemId" = i."itemId"
       )
       UNION ALL
       SELECT ps."projectElementId", ps."itemId", ps."ordered", ps."received",
         CASE WHEN ps."consumed" THEN ps."received" ELSE 0 END,
         jsonb_build_object('type', 'Purchase Order', 'documentId', ps."documentId",
           'readableId', ps."readableId", 'lineId', ps."lineId", 'status', ps."status")
       FROM po_supply ps
       WHERE ps."projectId" = project_id
         AND NOT EXISTS (SELECT 1 FROM materials m WHERE m."purchaseOrderLineId" = ps."lineId")
       UNION ALL
       SELECT js."projectElementId", js."itemId", js."ordered", js."received",
         CASE WHEN js."consumed" THEN js."received" ELSE 0 END,
         jsonb_build_object('type', 'Job', 'documentId', js."documentId",
           'readableId', js."readableId", 'lineId', NULL, 'status', js."status")
       FROM job_supply js
       WHERE js."projectId" = project_id
         AND NOT EXISTS (SELECT 1 FROM materials m WHERE m."jobId" = js."documentId")
     ),
     unplanned_rows AS (
       SELECT
         'Unplanned'::TEXT AS "rowKind",
         NULL::TEXT AS "projectElementMaterialId",
         u."projectElementId",
         u."itemId",
         NULL::"methodType" AS "methodType",
         NULL::TEXT AS "unitOfMeasureCode",
         0::NUMERIC AS "quantityRequired",
         SUM(u."ordered") AS "quantityOrdered",
         SUM(u."received") AS "quantityReceived",
         SUM(u."issued") AS "quantityIssued",
         NULL::DATE AS "requiredDate",
         COALESCE(jsonb_agg(u."supply") FILTER (WHERE u."supply" IS NOT NULL), '[]'::jsonb) AS "supplies"
       FROM unplanned_sources u
       GROUP BY u."projectElementId", u."itemId"
     ),
     all_rows AS (
       SELECT * FROM plan_rows
       UNION ALL
       SELECT * FROM unplanned_rows
     ),
     stock AS (
       SELECT q."itemId",
         SUM(q."quantityOnHand") FILTER (WHERE q."projectId" = project_id) AS "projectOnHand",
         SUM(q."quantityOnHand") FILTER (
           WHERE q."projectId" = '' AND q."locationId" = (SELECT "locationId" FROM proj)
         ) AS "unassignedOnHand"
       FROM "itemStockQuantities" q
       WHERE q."companyId" = company_id
         AND (SELECT "projectStock" FROM proj)
         AND q."itemId" IN (SELECT "itemId" FROM all_rows)
       GROUP BY q."itemId"
     )
     SELECT
       r."rowKind",
       r."projectElementMaterialId",
       r."projectElementId",
       e."readableId",
       e."name",
       e."sequence",
       s."name",
       s."group",
       s."color",
       r."itemId",
       COALESCE(it."readableIdWithRevision", it."readableId"),
       it."name",
       r."methodType",
       COALESCE(r."unitOfMeasureCode", it."unitOfMeasureCode"),
       r."quantityRequired",
       r."quantityOrdered",
       r."quantityReceived",
       r."quantityIssued",
       CASE WHEN r."rowKind" = 'Plan'
         THEN GREATEST(0, r."quantityRequired" - r."quantityIssued") END,
       r."requiredDate",
       CASE
         WHEN r."rowKind" = 'Unplanned' THEN 'Unplanned'
         WHEN r."quantityIssued" >= r."quantityRequired" THEN 'Issued'
         WHEN r."quantityIssued" > 0 THEN 'Partly issued'
         ELSE 'Not issued'
       END,
       r."supplies",
       st."projectOnHand",
       st."unassignedOnHand"
     FROM all_rows r
     JOIN proj ON TRUE
     JOIN "item" it ON it."id" = r."itemId" AND it."companyId" = company_id
     LEFT JOIN "projectElement" e
       ON e."id" = r."projectElementId" AND e."companyId" = company_id
     LEFT JOIN "projectState" s
       ON s."id" = e."stateId" AND s."companyId" = company_id
     LEFT JOIN stock st ON st."itemId" = r."itemId"
     ORDER BY e."sequence" NULLS LAST, r."rowKind", COALESCE(it."readableIdWithRevision", it."readableId"), r."projectElementMaterialId"
     LIMIT 1001;
   $$;
   ```
5. Copy the whole `CREATE OR REPLACE FUNCTION get_item_used_in` statement from `20261005041631_item-usage-and-change-notice-lookups.sql` into the new file.
6. Put `-- Forked from 20261005041631_item-usage-and-change-notice-lookups.sql` on the line above it.
7. In the copy, add this block right after the `'jobs'` block, before `'maintenanceDispatchItems'`:
   ```sql
       'projectMaterials', (
         SELECT coalesce(
           jsonb_agg(to_jsonb(r) - 'createdAt' ORDER BY r."createdAt" DESC, r."id"), '[]'::jsonb
         )
         FROM (
           SELECT l."id", l."createdAt", l."methodType",
             e."readableId" AS "documentReadableId",
             l."projectId" AS "documentId",
             l."projectElementId" AS "documentParentId"
           FROM "projectElementMaterial" l
           JOIN "projectElement" e
             ON e."id" = l."projectElementId" AND e."companyId" = l."companyId"
           WHERE l."itemId" = item_id AND l."companyId" = company_id
           ORDER BY l."createdAt" DESC, l."id"
           LIMIT 100
         ) r
       ),
   ```
8. Change nothing else in the copied function.

If a newer migration than `20261005041631` redefines `get_item_used_in` on main, STOP and report. Fork that newer one instead.
If `item."readableId"` does not exist as a column, STOP and report.

**Verify:**
```bash
grep -c "CREATE OR REPLACE FUNCTION" packages/database/supabase/migrations/*_project-materials.sql
# Expected: 2
grep -rl "FUNCTION get_item_used_in\|FUNCTION public.get_item_used_in" packages/database/supabase/migrations | sort | tail -1
# Expected: the new *_project-materials.sql file
```

**Out of scope:** `openProjectMaterialLines`, `project_receipt_charge_quantities`, and every other key of `get_item_used_in`.

## Task 2: Apply the migration and regenerate the types

**Depends on:** Task 1
**Files:**
- Modify: `packages/database/src/types.ts` (generated — never edit by hand)

**Steps:**
1. Run `pnpm db:migrate`.
2. Run `pnpm run generate:types`.

If `pnpm db:migrate` fails, STOP and report the error. Do not rebuild the database.

**Verify:**
```bash
grep -n "get_project_materials:" packages/database/src/types.ts
# Expected: one match under Functions
pnpm --filter @carbon/checks exec vitest run src/run.test.ts
# Expected: all tests pass (migration-replay-safe, function-redefinition-keeps-changes)
```

**Out of scope:** any edit to `types.ts` by hand.

## Task 3: Write the database test for `get_project_materials`

**Depends on:** Task 2
**Files:**
- Create: `apps/erp/test/database/get-project-materials.test.ts`
- Copy from (precedent): `apps/erp/test/database/post-project-issue/charge-at-receipt.test.ts` (fixture, `invokePosting`, charged stock), `apps/erp/test/database/post-project-issue.test.ts` (direct `projectElementMaterial` insert)

**Steps:**
1. Use `databaseTest` and `projectPostingFixture`.
2. Read rows with `sql\`SELECT * FROM get_project_materials(${projectId}, ${companyId})\`.execute(f.db)`.
3. Insert plan lines straight into `projectElementMaterial`, as `post-project-issue.test.ts` does.
4. Post issues with `invokePosting(handlesOf(f.ctx), "post-project-issue", …, postProjectIssue)`.
5. Write one test per case below. Each test asserts the exact numbers.

| # | Case | Expected row |
|---|---|---|
| 1 | Purchase to Order line, quantity 10, linked PO line orders 10, receives 4 to project stock | Plan; Ordered 10, Received 4, Issued 0, Remaining 10, `issueStatus` Not issued, `supplies[0].status` = the PO's status |
| 2 | Purchase to Order line, quantity 10, linked PO line consumed by the project, receives 10 | Issued 10, Issued |
| 3 | Make to Order line, quantity 5, linked `consumeToProject` job (`addConsumeToProjectJob`), `quantityComplete` 2 | Received 2, Issued 2, Partly issued |
| 4 | Purchase to Order line with no PO line | `supplies` = `[]` |
| 5 | Linked PO line orders 10, receives 3, PO set to Closed | Ordered 3 |
| 6 | Issue 3 to an element with no plan line for the item, then return 1 | One Unplanned row; Required 0, Issued 2 |
| 7 | Charge at receipt: issue 3 with 3 charged units on the shelf | Issued 3 |
| 8 | Charge at receipt: issue 5 with 3 charged units on the shelf | Issued 5 |
| 9 | A job with the project and the element, linked by no plan line | Unplanned row; the job in `supplies` |
| 10 | A PO line with the project and no element | Unplanned row; `projectElementId` NULL |
| 11 | A `consumeToProject` job that consumes 2 components | No Unplanned row for either component |
| 12 | Call with company A's id and a project id of company B | 0 rows |
| 13 | Call through `localAnonClient().rpc("get_project_materials", …)` | 0 rows or an error, never data |
| 14 | A plan line with `projectStock` false, then with `enableProjectStock()` and stock on hand | First `projectOnHand` and `unassignedOnHand` NULL; then both are numbers |

If `projectPostingFixture` cannot make a case, add a helper inside the test file. Do not edit the fixture.
If case 8 cannot be set up with the fixture, STOP and report.

**Verify:**
```bash
SUPABASE_DB_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres pnpm --filter erp exec vitest run test/database/get-project-materials.test.ts
# Expected: 14 passed
```
If the local database URL differs, read it from `apps/erp/test/database/fixtures/local-database.ts`.

**Out of scope:** UI tests. Changes to `projectPostingFixture`.

## Task 4: Add the `getProjectMaterials` building block and operation

**Depends on:** Task 2
**Files:**
- Modify: `apps/erp/app/modules/projects/projects.service.ts` — add `ProjectMaterialRow`, `ProjectMaterialSupply` and `getProjectMaterials` next to `getProjectStockOnHand` (line ~13999)
- Modify: `apps/erp/app/modules/projects/projects.server.ts` — add the operation after `getProjectStockOnHand` (line ~5768)
- Copy from (precedent): `getProjectStockOnHand` (service and operation); `getMissingTimesheetDays` (`projects.service.ts:4951`) for the `sql` call

**Steps:**
1. In `projects.service.ts`, add:
   ```ts
   export type ProjectMaterialSupply = {
     type: "Purchase Order" | "Job";
     documentId: string;
     readableId: string;
     lineId: string | null;
     status: string;
   };

   export type ProjectMaterialIssueStatus =
     | "Not issued"
     | "Partly issued"
     | "Issued"
     | "Unplanned";

   /** One row of the project Materials page (`get_project_materials`). */
   export type ProjectMaterialRow = {
     rowKind: "Plan" | "Unplanned";
     projectElementMaterialId: string | null;
     projectElementId: string | null;
     elementReadableId: string | null;
     elementName: string | null;
     elementSequence: number | null;
     elementStateName: string | null;
     elementStateGroup: ProjectStateGroup | null;
     elementStateColor: string | null;
     itemId: string;
     itemReadableId: string;
     itemName: string;
     methodType: Database["public"]["Enums"]["methodType"] | null;
     unitOfMeasureCode: string | null;
     quantityRequired: number;
     quantityOrdered: number;
     quantityReceived: number;
     quantityIssued: number;
     quantityRemaining: number | null;
     requiredDate: string | null;
     issueStatus: ProjectMaterialIssueStatus;
     supplies: ProjectMaterialSupply[];
     projectOnHand: number | null;
     unassignedOnHand: number | null;
   };

   /** The page shows the first 1,000 rows; the RPC returns 1,001 to flag more. */
   export const PROJECT_MATERIALS_LIMIT = 1000;

   /** Every plan line and unplanned item of a project (`get_project_materials`). */
   export async function getProjectMaterials(
     db: Kysely<KyselyDatabase>,
     args: { companyId: string; projectId: string }
   ) {
     const result = await sql<ProjectMaterialRow>`
       SELECT * FROM get_project_materials(${args.projectId}, ${args.companyId})
     `.execute(db);
     const rows = result.rows.map((row) => ({
       ...row,
       quantityRequired: Number(row.quantityRequired),
       quantityOrdered: Number(row.quantityOrdered),
       quantityReceived: Number(row.quantityReceived),
       quantityIssued: Number(row.quantityIssued),
       quantityRemaining: row.quantityRemaining === null ? null : Number(row.quantityRemaining),
       projectOnHand: row.projectOnHand === null ? null : Number(row.projectOnHand),
       unassignedOnHand: row.unassignedOnHand === null ? null : Number(row.unassignedOnHand)
     }));
     return {
       rows: rows.slice(0, PROJECT_MATERIALS_LIMIT),
       isTruncated: rows.length > PROJECT_MATERIALS_LIMIT
     };
   }
   ```
2. Use the `ProjectStateGroup` type and `Database` import the file already has. If `ProjectStateGroup` is not imported in `projects.service.ts`, import it from `./types`.
3. In `projects.server.ts`, add:
   ```ts
   /**
    * Get the materials of a project.
    *
    * @remarks
    * One row per plan line, plus one Unplanned row per element and item that
    * has issues, PO lines or jobs no plan line links. Quantities only, with the
    * stored status of each PO and job.
    *
    * @mcp read
    */
   export const getProjectMaterials = defineServiceFn({
     input: z.object({ projectId: z.string() }),
     permission: { "projects.projects": "View" },
     async run(ctx, { projectId }) {
       return service.getProjectMaterials(ctx.asSystem.pg, {
         companyId: ctx.company.id,
         projectId
       });
     }
   });
   ```

**Verify:**
```bash
pnpm exec biome check apps/erp/app/modules/projects/projects.service.ts apps/erp/app/modules/projects/projects.server.ts
# Expected: no errors
grep -n "export const getProjectMaterials = defineServiceFn" apps/erp/app/modules/projects/projects.server.ts
# Expected: one match
```

**Out of scope:** `getProjectStockOnHand`. Any change to `defineServiceFn`.

## Task 5: Add the issue status color map

**Depends on:** none
**Files:**
- Modify: `packages/utils/src/status-colors.ts` — add `PROJECT_MATERIAL_ISSUE_STATUS_COLOR_MAP` after `PROJECT_PEG_STATE_COLOR_MAP` (line ~243), and register it in `statusColorMaps` (line ~515)
- Copy from (precedent): `PROJECT_PEG_STATE_COLOR_MAP`

**Steps:**
1. Add:
   ```ts
   export const PROJECT_MATERIAL_ISSUE_STATUS_COLOR_MAP = {
     "Not issued": "gray",
     "Partly issued": "orange",
     Issued: "green",
     Unplanned: "purple"
   } as const satisfies Record<string, StatusColor>;
   ```
2. Register it in `statusColorMaps`. Copy the entry of `PROJECT_PEG_STATE_COLOR_MAP`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/utils
# Expected: 0 errors
```

**Out of scope:** every other color map.

## Task 6: Write the pure grouping and filter helper, with its test

**Depends on:** none (it imports only the row type; write the type import as `import type` and let Task 4 provide it)
**Files:**
- Create: `apps/erp/app/modules/projects/ui/Materials/project-materials.ts`
- Create: `apps/erp/app/modules/projects/ui/Materials/project-materials.test.ts`
- Copy from (precedent): `apps/erp/app/modules/projects/ui/Element/plan-rows.ts` and `plan-rows.test.ts`

**Steps:**
1. Export `NO_SUPPLY = "No supply"`.
2. Export `supplyStatuses(row)`. It returns `[NO_SUPPLY]` when `row.supplies` is empty and `row.methodType` is not `"Pull from Inventory"`. It returns `[]` for an empty Pull from Inventory row. Otherwise it returns each supply's `status`.
3. Export `filterMaterialRows(rows, { search, supplyStatus, issueStatus })`.
   - `search` matches `itemReadableId`, `itemName`, `elementReadableId` and `elementName`, case-insensitive.
   - `supplyStatus` (string[]) keeps a row if one of its `supplyStatuses` is in the list. An empty list keeps every row.
   - `issueStatus` (string[]) keeps a row if its `issueStatus` is in the list. An empty list keeps every row.
4. Export `groupMaterialRows(rows, groupBy: "element" | "item")`.
   - `"element"`: one group per `projectElementId`, in the row order the RPC returns. Rows with a NULL element form the last group, with `key` = `"no-element"`.
   - `"item"`: one group per `itemId`, ordered by `itemReadableId`.
   - Each group has `key`, `rows` and `totals`.
5. Make `totals` hold the sums of `quantityRequired`, `quantityOrdered`, `quantityReceived`, `quantityIssued` and `quantityRemaining`. If the rows of a group have more than one `unitOfMeasureCode`, set `totals` to `null`.
6. In the test, cover these 6 cases with literal rows:
   1. The search matches an element name.
   2. The supply status "No supply" keeps a Purchase to Order row with no supply and drops a Pull from Inventory row.
   3. The issue status filter keeps only Unplanned rows.
   4. Grouping by element puts the NULL element group last.
   5. Grouping by item totals 2 rows with one unit.
   6. Grouping by item gives `totals` = `null` for 2 rows with different units.

**Verify:**
```bash
pnpm --filter erp exec vitest run app/modules/projects/ui/Materials/project-materials.test.ts
# Expected: 6 passed
```

**Out of scope:** any React code in this file.

## Task 7: Add the route, the path, the shortcut and the sidebar link

**Depends on:** Task 4
**Files:**
- Create: `apps/erp/app/routes/x+/project+/$projectId.materials.tsx`
- Modify: `apps/erp/app/utils/path.ts` — add `projectMaterials` next to `projectPegging` (line ~2328)
- Modify: `apps/erp/app/shortcuts.ts` — add `materials: "mod+shift+u"` to `PROJECT_TAB_SHORTCUTS` (line ~49)
- Modify: `apps/erp/app/modules/projects/ui/Project/useProjectNavigation.tsx` — add the Materials link between Plan (lines 65–73) and Schedule
- Copy from (precedent): `apps/erp/app/routes/x+/project+/$projectId.pegging.tsx` (loader, error log, `RecordOutlet`)

**Steps:**
1. Add to `path.ts`: ``projectMaterials: (id: string) => generatePath(`${x}/project/${id}/materials`),``.
2. Add `materials: "mod+shift+u"` to `PROJECT_TAB_SHORTCUTS`.
3. Before step 2, confirm `mod+shift+u` appears nowhere else: `grep -rn '"mod+shift+u"' apps/erp/app packages/react/src`. If it appears, STOP and report.
4. Add this entry after Plan in `useProjectSidebarLinks`. Import `LuBoxes` from `react-icons/lu`:
   ```tsx
   {
     name: t`Materials`,
     to: path.to.projectMaterials(projectId),
     icon: <LuBoxes />,
     shortcut: PROJECT_TAB_SHORTCUTS.materials
   },
   ```
5. Write the route. The loader:
   ```ts
   export async function loader({ request, params }: LoaderFunctionArgs) {
     const { api, companyId } = await authorize(request, {
       "projects.projects": "View"
     });
     const { projectId } = params;
     if (!projectId) throw new Error("Could not find projectId");
     const materials = await api.projects.getProjectMaterials({ projectId });
     if (materials.error) {
       logger.error("Failed to load the project's materials", {
         companyId,
         projectId,
         error: materials.error
       });
     }
     return {
       rows: materials.data?.rows ?? [],
       isTruncated: materials.data?.isTruncated ?? false
     };
   }
   ```
6. The default export renders `<ProjectMaterials rows={rows} isTruncated={isTruncated} />` and `<RecordOutlet />`, as the Pegging route does.

**Verify:**
```bash
pnpm exec biome check apps/erp/app/routes/x+/project+/\$projectId.materials.tsx apps/erp/app/utils/path.ts apps/erp/app/shortcuts.ts apps/erp/app/modules/projects/ui/Project/useProjectNavigation.tsx
# Expected: no errors
```

**Out of scope:** the Stock, Pegging and Billing links.

## Task 8: Build the `ProjectMaterials` component

**Depends on:** Tasks 5, 6, 7
**Files:**
- Create: `apps/erp/app/modules/projects/ui/Materials/ProjectMaterials.tsx`
- Copy from (precedent): `apps/erp/app/modules/projects/ui/Pegging/ProjectPegging.tsx` — imports (5–34), toolbar row (109–136), `Empty` (138–155), `TableBase` and `Thead` (157–183), group header row (193–211), element cell (252–269), `supplyCell` (77–105)

**Steps:**
1. Read `.claude/rules/conventions-ui.md` and the Pegging component end to end before you write.
2. Take props `{ rows: ProjectMaterialRow[]; isTruncated: boolean }`.
3. Read `search`, `supplyStatus`, `issueStatus` and `groupBy` from `useUrlParams`. The default of `groupBy` is `"element"`.
4. Build the toolbar row like Pegging's. Put 4 controls in it: search, Supply status, Issue status and Group by. Grep `apps/erp/app/components` for the filter combobox that list pages use, and reuse it.
5. Run `filterMaterialRows`, then `groupMaterialRows`.
6. Render one `TableBase full` with these columns: Item, Element, Method, Required, Ordered, Received, Issued, Remaining, Required date, Supply, Issue status.
7. If any row has `projectOnHand` not null, add the columns Project on hand and Unassigned on hand.
8. Render a group header row like Pegging's (`<Tr className="bg-muted/40">`).
   - Element groups show `StateIcon`, `elementReadableId` and `elementName`, or "Project (no element)".
   - Item groups show the item link and the totals. If `totals` is null, show no totals.
9. Render the Element cell with a `Hyperlink` to `path.to.projectElement(projectId, projectElementId)` and `StateIcon` from `ui/Project/StateIcon`.
10. Render the Supply cell for each supply.
    - Show a `Hyperlink` to `path.to.purchaseOrder(documentId)` or `path.to.job(documentId)` with `readableId`.
    - Show `PurchasingStatus` (`~/modules/purchasing/ui/PurchaseOrder/PurchasingStatus`) or `JobStatus` (`~/modules/production/ui/Jobs/JobStatus`) beside the link.
    - If the row has no supply and is not Pull from Inventory, show the text "No supply".
11. Render the Issue status with `Status` and `PROJECT_MATERIAL_ISSUE_STATUS_COLOR_MAP`.
12. Format quantities with `useQuantityFormatter` and the unit. Format the date with the `DateTime` component that Pegging imports.
13. If `rows` is empty, render `Empty` with the title "No materials" and a description that says plan lines appear here.
14. If `isTruncated`, render the truncated notice that `.claude/rules/table-infinite-scroll.md` names for single-load lists.
15. Wrap every string in `t` or `Trans`.

**Verify:**
```bash
pnpm exec biome check apps/erp/app/modules/projects/ui/Materials/
# Expected: no errors
```
Task 14 runs the typecheck. Task 15 checks the page in the browser.

**Out of scope:** row actions (spec Q3). Money columns (spec Q4). Inner scroll regions.

## Task 9: Add the Projects group to Used In

**Depends on:** Task 2
**Files:**
- Modify: `apps/erp/app/modules/items/items.service.ts` — `ItemUsedIn` (~2393), `NOT_USED` (~2422), `getMaterialUsedIn` key list (~1535–1555)
- Modify: `apps/erp/app/modules/items/ui/Item/UsedIn.tsx` — `UsedInKey` (75–91), `USED_IN_TOOLTIPS` (118–122), `getUseInLink` (~651)
- Modify: `apps/erp/app/routes/x+/part+/$itemId.tsx` — trees at :326 and :501
- Modify: `apps/erp/app/routes/x+/tool+/$itemId.tsx` — trees at :309 and :473
- Modify: `apps/erp/app/routes/x+/material+/$itemId.tsx` — tree at :144
- Modify: `apps/erp/app/routes/x+/consumable+/$itemId.tsx` — tree at :142
- Modify: `apps/erp/app/modules/items/ui/ChangeNotice/ImpactPanel.tsx` — its `usedIn` type (27–43) and its group list (:67)
- Copy from (precedent): the `jobMaterials` entries in each file

**Steps:**
1. Add `projectMaterials: UsedInMethod[]` to `ItemUsedIn`. Use `UsedInDocument` instead if `UsedInMethod` needs fields the RPC does not return.
2. Add `projectMaterials: []` to `NOT_USED`.
3. Add `projectMaterials: usedIn.projectMaterials` to the `getMaterialUsedIn` key list.
4. Add `"projectMaterials"` to `UsedInKey`.
5. Add `projectMaterials: msg\`Projects that have this item on their plan\`` to `USED_IN_TOOLTIPS`.
6. Add a `case "projectMaterials":` to `getUseInLink`. It returns `path.to.projectElement(child.documentId, child.documentParentId)`. It returns `"#"` if either is missing.
7. In each of the 6 route trees, read `projectMaterials` from the same object that gives `jobMaterials`. Add this group after the `jobMaterials` group:
   ```ts
   {
     key: "projectMaterials",
     name: t`Projects`,
     pages: ["projects.projects"],
     children: projectMaterials
   },
   ```
8. In the material and consumable routes, write `name: "Projects"` as a plain string. Those two files use plain strings for the other groups.
9. In `ImpactPanel.tsx`, add `projectMaterials` to its `usedIn` type. Add the same group with `children: u.projectMaterials`.

If `"projects.projects"` is not a valid `PageId`, STOP and report.

**Verify:**
```bash
grep -rln 'key: "projectMaterials"' apps/erp/app | sort
# Expected: 5 files (part, tool, material, consumable routes, ImpactPanel)
grep -c 'key: "projectMaterials"' apps/erp/app/routes/x+/part+/\$itemId.tsx apps/erp/app/routes/x+/tool+/\$itemId.tsx
# Expected: 2 and 2
```

**Out of scope:** every other Used In group. The `get_item_used_in` SQL (Task 1).

## Task 10: Show the linked part on the Plan list and the Tree cards

**Depends on:** none
**Files:**
- Modify: `apps/erp/app/modules/projects/ui/Elements/ElementList.tsx` — add `itemId` to `ElementRowProps.element` (304–315); show the part after the name (405–411)
- Modify: `apps/erp/app/modules/projects/ui/Elements/graph/ElementCardNode.tsx` — add `itemId` to `ElementCardData` (43–59); show the part in the state/job row (154–164)
- Modify: `apps/erp/app/modules/projects/ui/Elements/ElementGraph.tsx` — pass `itemId` in the card data (256–275)
- Copy from (precedent): `apps/erp/app/modules/projects/ui/Element/ElementJobs.tsx` lines 23–28 (`useItems` + a `Map` by id)

**Steps:**
1. In both components, read the items with `const [items] = useItems()`. Build a `Map` by id with `useMemo`.
2. If `element.itemId` is set and the item exists, show `item.readableIdWithRevision` as small muted text.
3. Keep the Tree card at its fixed size (256×100, `tree-layout.ts`). Truncate the text with `truncate`.
4. Check every caller of `ElementRow`, including `ui/Element/ElementChildren.tsx:76`. Make each one pass `itemId`.

**Verify:**
```bash
pnpm exec biome check apps/erp/app/modules/projects/ui/Elements/
# Expected: no errors
```

**Out of scope:** the Graph layout's box nodes (`ElementBoxNode.tsx`). `PROJECT_ELEMENT_LIST_COLUMNS`, which already selects `itemId`.

## Task 11: Show the past-average hint in the element sidebar

**Depends on:** none
**Files:**
- Modify: `apps/erp/app/modules/projects/ui/Element/ElementView.tsx` — take `itemHistory` from the props (115–145); pass it to `ElementSidebar` (~651)
- Modify: `apps/erp/app/modules/projects/ui/Element/ElementSidebar.tsx` — add the prop `itemHistory: ProjectElementPage["itemHistory"]` (82–112); render the hint after Hours estimate (292–304)

**Steps:**
1. Add `itemHistory` to the `ElementSidebar` props.
2. Pass it from `ElementView`.
3. If `element.itemId` is set and `itemHistory?.elementCount` > 0, render one line under Hours estimate:
   `t\`Past average: ${hours} h, ${money} material over ${count} elements\``.
4. Format `hours` with `useQuantityFormatter()`. Format `money` with `formatMoney.format(...)`; `formatMoney` already exists at line 118.
5. Render the line as `text-xs text-muted-foreground`. It has no action.

**Verify:**
```bash
pnpm exec biome check apps/erp/app/modules/projects/ui/Element/ElementView.tsx apps/erp/app/modules/projects/ui/Element/ElementSidebar.tsx
# Expected: no errors
```

**Out of scope:** `getProjectElementPage` and `get_element_history_by_item`.

## Task 12: Update the rule and the module guide

**Depends on:** Tasks 8–11
**Files:**
- Modify: `.claude/rules/projects-system.md` — the line that says the element page no longer shows the history; add a Materials page section
- Modify: `apps/erp/app/modules/projects/AGENTS.md` — add `getProjectMaterials` to Key Service Functions and `get_project_materials` to Key Data Model

**Steps:**
1. Replace the history line with: "The element sidebar shows the history as one hint line under Hours estimate."
2. Add a short Materials page section to `projects-system.md`. Name the route, the RPC and the 2 row kinds. Then state the Issued rule, the Project Issue count rule and the system-handle read.
3. Add one row for `get_project_materials` and one bullet for `getProjectMaterials` to `AGENTS.md`.
4. Write in STE-80.

**Verify:**
```bash
grep -n "get_project_materials" .claude/rules/projects-system.md apps/erp/app/modules/projects/AGENTS.md
# Expected: at least one match in each file
```

**Out of scope:** product docs under `docs/`.

## Task 13: Extract and translate the new strings

**Depends on:** Tasks 8–11
**Files:**
- Modify: `packages/locale/locales/*/*.po`

**Steps:**
1. Run `pnpm run lingui:extract`.
2. Run the `/translate` skill.

**Verify:**
```bash
pnpm exec linguito check
# Expected: exit code 0
```

**Out of scope:** strings outside this feature.

## Task 14: Run the heavy checks (main agent only)

**Depends on:** Tasks 1–13
**Files:**
- Modify: `tool-manifest.digest.json` (generated)

**Steps:**
1. Run `pnpm generate:mcp`.
2. Run `pnpm check:manifest`. Commit the updated digest.
3. Run `pnpm exec turbo run typecheck --filter=erp`.
4. Run `pnpm run lint`.
5. Run `pnpm --filter @carbon/checks exec vitest run src/run.test.ts`.
6. Run `pnpm --filter erp exec vitest run app/modules/projects`.

If the typecheck shows TS2589 in a file this plan did not touch, STOP and report.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: 0 errors
pnpm check:manifest
# Expected: exit code 0
```

**Out of scope:** whole-repo typecheck.

## Task 15: Verify in the browser

**Depends on:** Task 14
**Files:** none

**Steps:**
1. Run `/test` against the branch diff.
2. Check these spec acceptance criteria in the browser:
   1. The Materials link shows after Plan in the project sidebar.
   2. The page groups rows by element. Group by Item shows totals.
   3. The Supply status filter "No supply" and the Issue status filter "Not issued" work. A reload keeps them.
   4. Change a linked PO's status on the PO page. A reload of the Materials page shows the new status.
   5. A part's Used In tab shows the Projects group. An entry opens the element page.
   6. An element that links a part shows the part id in the List layout and on its Tree card.
   7. An element with part history shows the hint under Hours estimate.
3. Take a screenshot of the Materials page at 1440 px. Save it under `.context/`.

**Verify:** the `/test` report lists every check above as passed, with the screenshot path.

**Out of scope:** a broad smoke test.

---

## Execution notes

Executed 2026-11-25 on `naveenkash/assigned-items-projects`. Deviations from the task text:

1. **Commits.** The pre-commit hook stages every `.po` file in the first commit that touches a file with Lingui markers, and `projects.service.ts` is one. So Tasks 4 and 6–12 shipped as one feature commit with the catalogs. Tasks 1–2, 3 and 5 have their own commits.
2. **Task 2.** `crbn up` applied the migration and regenerated `types.ts` and `swagger-docs-schema.ts`. The diff holds only the 2 functions.
3. **Task 3.** The database URL is this worktree's database (`wt_…` in `.env.local`), not `/postgres`. Cases 7 and 8 build Unplanned rows: a plan row takes Issued from `quantityIssued`, so only an Unplanned row reads the relocation pair. Cases 3, 5, 10 and 14 set one column directly (a job's `quantityComplete`, a PO's status, a PO line's element, the project's location).
4. **Task 7.** The shortcut is `mod+shift+u`. The file's own rule (the first free letter of the name) gives `a`, which the Detail and Explorer sets use.
5. **Task 8.** The Supply status and Issue status filters are 2 entries in one Filter button (`?filter=`), as on the Plan page (`ElementsHeader`). Two Filter buttons cannot both hold a filter. `useMethodTypeLabels` is exported from `ElementPlanLines.tsx` and reused, not copied.
6. **Task 9.** `projectMaterials` is typed `(UsedInMethod & { documentParentId: string })[]`, like `quoteMaterials`. The part and tool routes' second trees use plain strings for every group name, so "Projects" is a plain string there.
7. **Task 10.** Each row and card building its own item map is O(rows × items), so `useItemsById` (`stores/items.ts`) caches one map per items array in a `WeakMap`.
8. **Task 11.** The interpolation is named `materialCost`, because `money` is taken in `ElementSidebar`. The browser test found "over 1 elements", so the count uses `plural()`.
9. **Task 13.** `lingui:extract` found 1,320 missing strings: 20 new strings × 12 locales, plus the strings `main` had left untranslated. All are filled. `check-glossary` flags 3 hard hits in this feature's strings. All 3 are "Filter" used as a noun, where the glossary approves the verb.
10. **Task 15.** The browser test found that at 1440 px the status columns sat off-screen and the whole card scrolled sideways. Fix commit `97edb8587b`: the table scrolls on its own, the column the group row names is hidden, and Issue status and Supply come before the quantities. Playbook: `.ai/playbooks/project-materials-page.md`.
