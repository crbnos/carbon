# Projects Phase 2a — project stock — implementation plan

**Spec:** .ai/specs/2026-10-03-projects.md (*Phase 2: Project stock*, *Transfer, Borrow, Payback*; decisions 14–17; Q2 answer)
**Research:** .ai/research/projects-wbs-pmmo.md (patterns 5 and 7)
**Branch:** projects-wbs-research-spec
**Prerequisite:** the Phase 1a, 1b and 1c plans are done and committed. If a named earlier artifact does not exist, STOP and report.

## Scope of this plan

Project stock as **valuated striping** (Q2, 2026-10-07):
- a nullable `projectId` on `itemLedger` and `costLedger`, where null is common stock;
- `itemStockQuantities.projectId` with the sentinel `''` in its primary key.

The plan covers:
1. **Issue rules.** Project demand draws its own project's stock, then common stock. Common demand draws common stock only. Another project's stock needs a Transfer or a Borrow first. The bin and lot pickers enforce this through one stripe set per call.
2. **Writers that create project stock:** PO receipts of lines charged to a project with project stock, and job output with **Receive to project stock**.
3. **Writers that carry the stripe:** issues record the stripe they drew. Picking, stock transfers, returns, voids and corrections copy their source stripe.
4. **Valuation and quantity reads by stripe.**
5. **`projectStockTransfer`:** Transfer, Borrow and Payback, with approval, a reason, a payback variance charged to the borrower, and a government-furnished guard.
6. **The inventory UI and the project Stock tab.**

Phase 2b plans MRP. Until 2b ships, every MRP and planning reader filters to common stock (`projectId = ''`), so planning output does not change.

## Rules for the executor

- Read `.ai/lessons.md`, `.claude/rules/inventory-system.md`, `.claude/rules/traceability-model.md`, `.claude/rules/authz-manifest.md`, `.claude/rules/company-backup-restore.md` and `.claude/rules/projects-system.md` before Task 1.
- 🛑 Tasks 2 and 3 ship together. Between the primary-key change and the new handler body, every `itemLedger` insert fails. Never run `pnpm db:migrate` with only one of them on disk.
- **Stripe rule for every ledger row you touch:**
  - a row that **creates** stock sets the stripe its source names;
  - a row that **draws** stock sets the stripe it drew;
  - a reversal or correction **copies** the row it reverses.
- Never query in a loop. Never construct a database client in a `*.service.ts`.
- Use the `carbon-design` skill for every UI task.
- If a quoted code line or line number does not match the file, search for the quoted code. If you cannot find it, STOP and report.

## Progress

- [x] Task 1: Create the Phase 2a enum and table migration
- [x] Task 2: Change the `itemStockQuantities` primary key and the reconcile function
- [x] Task 3: Change the stock handler and ship it with the authz migration
- [x] Task 4: Regenerate types and add the RLS rules
- [x] Task 5: Make the planning readers read common stock only
- [x] Task 6: Add the stripe to `calculateCOGS` and the SQL FIFO
- [x] Task 7: Add the stripe to `bookAdjustment` and corrections
- [x] Task 8: Make the bin and lot pickers stripe-aware
- [x] Task 9: Stripe PO receipts and their voids
- [x] Task 10: Stripe job output and the backflush
- [x] Task 11: Record the drawn stripe in `issue`
- [ ] Task 12: Carry the stripe through picking and stock transfers
- [ ] Task 13: Carry the stripe through shipments, invoices, returns and counts
- [ ] Task 14: Draw project stock in Issue to Project
- [ ] Task 15: Stripe the inventory snapshot and the quantity and valuation RPCs
- [ ] Task 16: Add the `post-project-stock-transfer` server function
- [ ] Task 17: Add the project stock transfer pages
- [ ] Task 18: Add the project stock UI
- [ ] Task 19: Extend the demo datasets
- [ ] Task 20: Update the rules, AGENTS.md, docs and spec
- [ ] Task 21: Verify in the browser

## Dependencies

- Task 1 runs first. Tasks 2 and 3 run together, then Task 4.
- Task 5 needs Task 4 and must ship in the same release as Task 3.
- Tasks 6 and 7 need Task 4. Task 8 needs Task 4.
- Tasks 9–14 need Tasks 6, 7 and 8. They are independent of each other.
- Task 15 needs Task 4. Task 16 needs Tasks 6 and 8. Task 17 needs Task 16. Task 18 needs Tasks 15 and 17.
- Task 19 needs Task 16. Task 20 needs Tasks 1–19. Task 21 runs last.

---

## Task 1: Create the Phase 2a enum and table migration

**Depends on:** none
**Files:**
- Create: `packages/database/supabase/migrations/<timestamp>_projects-2a-enums.sql`
- Create: `packages/database/supabase/migrations/<timestamp>_projects-stock.sql`
- Copy from (precedent): the `stockTransfer` tables (`grep -l 'CREATE TABLE "stockTransfer"' packages/database/supabase/migrations/*.sql`)

**Steps:**
1. Run `pnpm db:migrate:new projects-2a-enums`. Write only:

```sql
CREATE TYPE "projectStockTransferType" AS ENUM ('Transfer', 'Borrow', 'Payback');
CREATE TYPE "projectStockTransferStatus" AS ENUM ('Draft', 'Approved', 'Posted', 'Cancelled');
CREATE TYPE "projectBorrowStatus" AS ENUM ('Open', 'Paid Back');
ALTER TYPE "itemLedgerDocumentType" ADD VALUE IF NOT EXISTS 'Project Transfer';
ALTER TYPE "journalEntrySourceType" ADD VALUE IF NOT EXISTS 'Project Transfer';
ALTER TYPE "journalLineDocumentType" ADD VALUE IF NOT EXISTS 'Project Transfer';
```

2. Run `pnpm db:migrate:new projects-stock`. Write the SQL below. Add an index on `companyId` and every FK column.

```sql
ALTER TABLE "project"
  ADD COLUMN IF NOT EXISTS "projectStock" BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS "chargeAtReceipt" BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS "governmentFurnished" BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE "itemLedger" ADD COLUMN IF NOT EXISTS "projectId" TEXT;
ALTER TABLE "itemLedger" ADD CONSTRAINT "itemLedger_project_fkey"
  FOREIGN KEY ("projectId", "companyId") REFERENCES "project"("id", "companyId");
CREATE INDEX IF NOT EXISTS "itemLedger_project_idx" ON "itemLedger" ("companyId", "projectId") WHERE "projectId" IS NOT NULL;

ALTER TABLE "costLedger" ADD COLUMN IF NOT EXISTS "projectId" TEXT;
ALTER TABLE "costLedger" ADD CONSTRAINT "costLedger_project_fkey"
  FOREIGN KEY ("projectId", "companyId") REFERENCES "project"("id", "companyId");
CREATE INDEX IF NOT EXISTS "costLedger_open_stripe_idx" ON "costLedger" ("itemId", "projectId", "remainingQuantity") WHERE "remainingQuantity" > 0;

ALTER TABLE "job" ADD COLUMN IF NOT EXISTS "receiveToProjectStock" BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE "job" ADD CONSTRAINT "job_receiveToProjectStock_check"
  CHECK (NOT "receiveToProjectStock" OR ("projectId" IS NOT NULL AND NOT "consumeToProject"));

ALTER TABLE "pickingListLine" ADD COLUMN IF NOT EXISTS "projectId" TEXT;
ALTER TABLE "inventoryCountLine" ADD COLUMN IF NOT EXISTS "projectId" TEXT;
ALTER TABLE "itemPlanning" ADD COLUMN IF NOT EXISTS "allowCommonSupplyForProjects" BOOLEAN NOT NULL DEFAULT TRUE;

CREATE TABLE IF NOT EXISTS "projectStockTransfer" (
  "id" TEXT NOT NULL DEFAULT id('pst'),
  "companyId" TEXT NOT NULL,
  "projectStockTransferId" TEXT NOT NULL,     -- readable, sequence 'projectStockTransfer' prefix PST
  "type" "projectStockTransferType" NOT NULL,
  "status" "projectStockTransferStatus" NOT NULL DEFAULT 'Draft',
  "fromProjectId" TEXT,                        -- null = common
  "toProjectId" TEXT,                          -- null = common
  "locationId" TEXT NOT NULL REFERENCES "location"("id"),
  "reason" TEXT NOT NULL,
  "paybackDueDate" DATE,
  "settlesBorrowId" TEXT,
  "planningActionId" TEXT,
  "approvedBy" TEXT REFERENCES "user"("id"),
  "approvedAt" TIMESTAMP WITH TIME ZONE,
  "postedAt" TIMESTAMP WITH TIME ZONE,
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  CONSTRAINT "projectStockTransfer_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "projectStockTransfer_readable_key" UNIQUE ("projectStockTransferId", "companyId"),
  CONSTRAINT "projectStockTransfer_from_fkey" FOREIGN KEY ("fromProjectId", "companyId") REFERENCES "project"("id", "companyId"),
  CONSTRAINT "projectStockTransfer_to_fkey" FOREIGN KEY ("toProjectId", "companyId") REFERENCES "project"("id", "companyId"),
  CONSTRAINT "projectStockTransfer_owner_check" CHECK ("fromProjectId" IS DISTINCT FROM "toProjectId"),
  CONSTRAINT "projectStockTransfer_borrow_check" CHECK ("type" <> 'Borrow' OR ("paybackDueDate" IS NOT NULL AND "fromProjectId" IS NOT NULL AND "toProjectId" IS NOT NULL)),
  CONSTRAINT "projectStockTransfer_payback_check" CHECK ("type" <> 'Payback' OR "settlesBorrowId" IS NOT NULL),
  CONSTRAINT "projectStockTransfer_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS "projectStockTransferLine" (
  "id" TEXT NOT NULL DEFAULT id('psl'),
  "companyId" TEXT NOT NULL,
  "projectStockTransferId" TEXT NOT NULL,
  "itemId" TEXT NOT NULL REFERENCES "item"("id"),
  "quantity" NUMERIC NOT NULL CHECK ("quantity" > 0),
  "storageUnitId" TEXT,
  "trackedEntityId" TEXT REFERENCES "trackedEntity"("id"),
  "unitCost" NUMERIC,                          -- stamped at posting
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  CONSTRAINT "projectStockTransferLine_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "projectStockTransferLine_header_fkey" FOREIGN KEY ("projectStockTransferId", "companyId") REFERENCES "projectStockTransfer"("id", "companyId") ON DELETE CASCADE,
  CONSTRAINT "projectStockTransferLine_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS "projectBorrow" (
  "id" TEXT NOT NULL DEFAULT id('pbw'),
  "companyId" TEXT NOT NULL,
  "borrowerProjectId" TEXT NOT NULL,
  "lenderProjectId" TEXT NOT NULL,
  "itemId" TEXT NOT NULL REFERENCES "item"("id"),
  "locationId" TEXT NOT NULL REFERENCES "location"("id"),
  "quantity" NUMERIC NOT NULL CHECK ("quantity" > 0),
  "quantityPaidBack" NUMERIC NOT NULL DEFAULT 0,
  "borrowedUnitCost" NUMERIC NOT NULL,
  "paybackDueDate" DATE NOT NULL,
  "status" "projectBorrowStatus" NOT NULL DEFAULT 'Open',
  "projectStockTransferLineId" TEXT NOT NULL,
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  CONSTRAINT "projectBorrow_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "projectBorrow_borrower_fkey" FOREIGN KEY ("borrowerProjectId", "companyId") REFERENCES "project"("id", "companyId"),
  CONSTRAINT "projectBorrow_lender_fkey" FOREIGN KEY ("lenderProjectId", "companyId") REFERENCES "project"("id", "companyId"),
  CONSTRAINT "projectBorrow_paid_check" CHECK ("quantityPaidBack" <= "quantity"),
  CONSTRAINT "projectBorrow_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE
);
ALTER TABLE "costLedger" ADD COLUMN IF NOT EXISTS "projectBorrowId" TEXT;

-- sequence for every company (seed-data.ts gets the same entry in Task 4)
INSERT INTO "sequence" ("table", "name", "prefix", "suffix", "next", "size", "step", "companyId")
SELECT 'projectStockTransfer', 'Project Stock Transfer', 'PST', NULL, 0, 6, 1, c.id FROM "company" c
ON CONFLICT DO NOTHING;
```

3. If `inventoryCountLine` or `pickingListLine` has another table name, find it with `grep -l "CREATE TABLE \"pickingListLine\"\|CREATE TABLE \"inventoryCountLine\"" packages/database/supabase/migrations/*.sql` and use the real name.

**Verify:**
```bash
grep -c "CREATE TABLE IF NOT EXISTS" packages/database/supabase/migrations/*_projects-stock.sql
# Expected: 3
```

**Out of scope:** `trackedEntity.projectId`. The stripe lives on `itemLedger` only, because a batch can sit in two stripes after a partial transfer.

---

## Task 2: Change the `itemStockQuantities` primary key and the reconcile function

**Depends on:** 1
**Files:**
- Create: `packages/database/supabase/migrations/<timestamp>_item-stock-quantities-project.sql`
- Copy from (precedent): `packages/database/supabase/migrations/20260812002454_item-stock-quantities-incremental.sql` (lines 68–80, 218–257)

**Steps:**
1. 🛑 Do not run `pnpm db:migrate` until Task 3's handler migration is also on disk.
2. Run `pnpm db:migrate:new item-stock-quantities-project`. Write:

```sql
ALTER TABLE "itemStockQuantities" ADD COLUMN IF NOT EXISTS "projectId" TEXT NOT NULL DEFAULT '';
ALTER TABLE "itemStockQuantities" DROP CONSTRAINT "itemStockQuantities_pkey";
ALTER TABLE "itemStockQuantities" ADD PRIMARY KEY ("itemId", "companyId", "locationId", "projectId");
```

3. Read the real primary-key name with `grep -n "PRIMARY KEY" 20260812002454_item-stock-quantities-incremental.sql` and in the generated schema. If it is not `itemStockQuantities_pkey`, use the real name.
4. In the same file, redefine `reconcile_item_stock_quantities` from lines 218–257 of `20260812002454`:
   - add `COALESCE("projectId", '')` to the SELECT list and the GROUP BY, and `"projectId"` to the `ON CONFLICT` list;
   - change `ORDER BY 1, 2, 3` to `ORDER BY 1, 2, 3, 4`;
   - add `AND COALESCE(il."projectId", '') = isq."projectId"` to the `DELETE … NOT EXISTS` (lines 248–255);
   - write `SECURITY INVOKER` (as `20260925121735_rpc-function-guards.sql:2777` set it).

**Verify:**
```bash
grep -c '"projectId"' packages/database/supabase/migrations/*_item-stock-quantities-project.sql
# Expected: at least 5
```

**Out of scope:** the handler (Task 3).

---

## Task 3: Change the stock handler and ship it with the authz migration

**Depends on:** 2
**Files:**
- Modify: `packages/database/src/event-system/handlers/apply_item_stock_quantities.sql`
- Create: the generated authz migration (its timestamp must come directly after Task 2's)

**Steps:**
1. In each of the 3 branches of the handler (INSERT lines 8–20, UPDATE 27–51, DELETE 57–68), make 4 edits:
   1. Add `COALESCE("projectId", '')` to the SELECT list, after `COALESCE("locationId", '')`.
   2. Add the same expression to the GROUP BY.
   3. Change `ORDER BY 1, 2, 3` to `ORDER BY 1, 2, 3, 4`.
   4. Add `"projectId"` to the `ON CONFLICT` list.
2. Do not write this body into a hand-written migration. The `no-authz-ddl-in-migrations` check refuses it.
3. Run `pnpm --filter @carbon/database authz migration item-stock-quantities-project-handler`.
4. Check that the generated file's timestamp is later than Task 2's file and that no other migration sits between them. If one does, rename nothing; STOP and report.
5. Run `pnpm db:migrate`.

**Verify:**
```bash
pnpm db:migrate && psql "$SUPABASE_DB_URL" -c "SELECT count(*) FROM \"itemStockQuantities\" WHERE \"projectId\" <> '';"
# Expected: the migration succeeds, and the count is 0
pnpm --filter @carbon/database exec vitest run src/authz
# Expected: all tests pass
```

**Out of scope:** `broadcast_table_changes`. It needs no change.

---

## Task 4: Regenerate types and add the RLS rules

**Depends on:** 3
**Files:**
- Modify: `packages/database/src/authz/manifest.ts`
- Modify: `packages/database/src/seed-data.ts` — add the `projectStockTransfer` sequence (prefix `PST`, size 6)
- Modify: `packages/jobs/src/backups/id-refs.ts` — line 75: add `"projectId"` to the `itemStockQuantities` entry
- Modify: generated types

**Steps:**
1. Run `pnpm run generate:types`.
2. Add these rules in alphabetical order:

```ts
projectBorrow: company("projects", { create: false, update: false, delete: false }),
projectStockTransfer: company("projects"),
projectStockTransferLine: company("projects"),
```

3. Run `pnpm db:migrate`, then `pnpm --filter @carbon/database authz migration projects-2a-rls`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/database --filter=@carbon/jobs
# Expected: exit code 0
```

**Out of scope:** UI.

---

## Task 5: Make the planning readers read common stock only

**Depends on:** 4
**Files:**
- Modify: `packages/planning/src/mrp/mrp.ts` (lines 306–321)
- Modify: `packages/planning/src/mrp/planning-actions.ts` (lines 1192–1196, 1256–1264)
- Modify: `packages/planning/src/scheduling/quote-lead-time.ts` (lines 585–605)
- Modify: `packages/server-functions/src/get-method/index.ts` (lines 7803–7821, 8082–8095)
- Modify: `apps/erp/app/modules/items/items.service.ts` (line 1279)

**Steps:**
1. 🛑 These 3 readers keep one value per key with `Map.set`: `mrp.ts:315`, `planning-actions.ts:1259`, `quote-lead-time.ts:603`. After the key change, two rows per key would make the last row win. Fix them before any project stock exists.
2. In the 3 planning readers, add `.where("projectId", "=", "")` to the `itemStockQuantities` read. Phase 2b replaces this with segment keys.
3. In `get-method` (Consume First on-hand), filter to `projectId = ''` plus the job's own project when the job has `receiveToProjectStock` or `projectId`. Sum the rows.
4. In `getItemStockQuantitiesByLocation` (`items.service.ts:1279`), add `.order("projectId")` so paging has a total order. Keep summing.
5. Add a test in `planning-actions.test.ts`. Give one item and location two `itemStockQuantities` rows: `''` with 5 and `'prj_1'` with 3. Expect on-hand 5.

**Verify:**
```bash
pnpm --filter @carbon/planning test && pnpm --filter @carbon/server-functions test -- get-method
# Expected: all tests pass
```

**Out of scope:** segment netting (Phase 2b).

---

## Task 6: Add the stripe to `calculateCOGS` and the SQL FIFO

**Depends on:** 4
**Files:**
- Modify: `packages/server-functions/src/lib/calculate-cogs.ts` (lines 21–37, 69–93)
- Modify: `packages/server-functions/src/lib/calculate-cogs.test.ts`
- Create: `packages/database/supabase/migrations/<timestamp>_backflush-project-stripe.sql`

**Steps:**
1. Add `projectId?: string | null` to `calculateCOGS`'s argument object. Undefined means null (common).
2. After line 78, add `.where((eb) => (projectId ? eb("projectId", "=", projectId) : eb("projectId", "is", null)))`.
3. Leave `orderLayersForConsumption` unchanged.
4. Add 2 tests:
   1. With a common layer at 10.00 and a project layer at 12.00, `projectId: "prj_1"` draws 12.00.
   2. With the same layers, no `projectId` draws 10.00.
5. Run `pnpm db:migrate:new backflush-project-stripe`. Copy the latest `backflush_job_materials` (`20260805023439_company-timezone-sql-functions.sql`, line 31; search for a later definition first).
   1. Add a parallel array `v_bf_project_ids` next to `v_bf_item_ids` (lines 189–191). Fill it with the job's `projectId` when the job has `receiveToProjectStock` or `consumeToProject`, else NULL.
   2. Add `AND "projectId" IS NOT DISTINCT FROM v_bf_project_ids[i]` to the FIFO query (lines 308–324).
   3. Write `projectId` on the `itemLedger` insert (lines 175–182) and the `costLedger` rows.
   4. Keep `SECURITY INVOKER` (`20260925121735…sql:2761`).
6. Run `pnpm db:migrate`, then `pnpm run generate:types`.

**Verify:**
```bash
pnpm --filter @carbon/server-functions test -- calculate-cogs
# Expected: all tests pass, including 2 new ones
```

**Out of scope:** the callers (Tasks 9–14 pass the stripe).

---

## Task 7: Add the stripe to `bookAdjustment` and corrections

**Depends on:** 4
**Files:**
- Modify: `packages/server-functions/src/lib/post-adjustment.ts` (`bookAdjustment`, line 231; `valueMovement`, line 313)
- Modify: `packages/server-functions/src/correct-stock-movement/index.ts` (line 362)
- Modify: `packages/server-functions/src/post-inventory-adjustment/index.ts` (void at line 571)

**Steps:**
1. Add `projectId?: string | null` to `BookAdjustmentArgs.ledger`. Write it on the `itemLedger` row (line 238) and on every `costLedger` row `valueMovement` writes (lines 347, 368, 396). Pass it to `calculateCOGS`.
2. In `correct-stock-movement`, copy `projectId` from the corrected row (`correctionOfItemLedgerId`).
3. In the `post-inventory-adjustment` void, copy `projectId` from the voided row.
4. Every other `bookAdjustment` caller passes nothing (common). List them with `grep -rn "bookAdjustment(" packages/server-functions/src` to confirm none needs a stripe.

**Verify:**
```bash
pnpm --filter @carbon/server-functions test -- post-adjustment post-inventory-adjustment correct-stock-movement
# Expected: all tests pass
```

**Out of scope:** Issue to Project (Task 14).

---

## Task 8: Make the bin and lot pickers stripe-aware

**Depends on:** 4
**Files:**
- Modify: `packages/server-functions/src/lib/storage-units.ts` (lines 33–52)
- Create: `packages/server-functions/src/lib/stock-stripes.ts`
- Create: `packages/server-functions/src/lib/stock-stripes.test.ts`
- Create: `packages/database/supabase/migrations/<timestamp>_stock-pickers-project-stripe.sql`

**Steps:**
1. In `stock-stripes.ts`, export:
   - `type StockStripe = string | null` (null = common);
   - `stripesForDemand({ projectId, projectStock })`: `[projectId, null]` when the demand belongs to a project with project stock, else `[null]`;
   - `splitAcrossStripes(quantity, available: { stripe; quantity }[])`: takes quantity stripe by stripe in the given order, and returns `{ stripe, quantity }[]` plus `remaining`.
2. Write `stock-stripes.test.ts` with 3 cases:
   1. A project demand of 10 with 6 in the project and 8 in common gives 6 then 4.
   2. A common demand gives only common.
   3. A demand larger than both returns `remaining`.
3. Change `getStorageUnitWithHighestQuantity(trx, itemId, locationId)` to `(trx, { companyId, itemId, locationId, stripes })`.
   - Add `.where("companyId", "=", companyId)`.
   - Filter `projectId` to the stripes (`IS NULL` for null).
   - Group by `storageUnitId` and `projectId`.
   - Return `{ storageUnitId, projectId }` of the highest quantity, in stripe order.

   Update every caller (`grep -rn "getStorageUnitWithHighestQuantity" packages/server-functions/src`).
4. Run `pnpm db:migrate:new stock-pickers-project-stripe`. Redefine these RPCs from their latest definitions, each with a new last parameter `p_project_ids TEXT[] DEFAULT ARRAY[NULL]::TEXT[]` (common only by default):
   - `get_available_tracked_entities` (`20260709125411…sql:26–56`): filter the `bin_onhand` CTE by `"projectId" IS NOT DISTINCT FROM ANY(...)`, and add `projectId` to its output and grouping;
   - `get_item_quantities_by_tracking_id` (`20260925121735…sql:1614–1650`): add `projectId` to the output and the grouping, with no filter by default (it feeds 14 callers that need every stripe);
   - `get_picking_list_availability` (`20260730143512…sql:247`) and `get_picking_list_tracked_available`: filter by each line's `projectId`.

   Because each signature changes, write `DROP FUNCTION IF EXISTS <name>(<old args>);` first. Keep each function's `SECURITY` setting.
5. A filter of `IS NOT DISTINCT FROM ANY` does not work for NULL in Postgres. Use `("projectId" IS NULL AND NULL = ANY(...)) OR "projectId" = ANY(...)`, or `COALESCE("projectId", '') = ANY(COALESCE-mapped array)` with `''` for null.
6. Run `pnpm db:migrate`, then `pnpm run generate:types`. Fix every TypeScript caller of these RPCs (`grep -rn "get_available_tracked_entities\|get_item_quantities_by_tracking_id\|get_picking_list" apps packages`).

**Verify:**
```bash
pnpm --filter @carbon/server-functions test -- stock-stripes
# Expected: 3 passed
pnpm exec turbo run typecheck --filter=erp --filter=mes --filter=@carbon/server-functions
# Expected: exit code 0
```

**Out of scope:** the pick list generator (Task 12).

---

## Task 9: Stripe PO receipts and their voids

**Depends on:** 6, 7, 8
**Files:**
- Modify: `packages/server-functions/src/post-receipt/index.ts` (rows at 1778, 1798, 1846; insert at 2478; `costLedger` at 2216–2259; voids at 422, 979)
- Modify: `packages/server-functions/src/post-purchase-invoice/index.ts` (invoice-first `costLedger` at 539, 561, 598; void at 532)
- Modify: `packages/server-functions/src/post-receipt/project-receipt.test.ts`

**Steps:**
1. For a PO line with `projectId` whose project has `projectStock = true` and an inventory item:
   - Replace the Phase 1a "consume at receipt" branch.
   - Write the `Positive Adjmt.` row with `projectId` and the `costLedger` layer with `projectId`.
   - Debit inventory as for a common receipt.
   - Write no `projectLedger` row, unless the project has `chargeAtReceipt`. In that case, write a `Material` row as Phase 1a does.
2. Keep the Phase 1a consume-at-receipt branch for projects without project stock.
3. The receipt void (lines 422, 979) copies `projectId` from the reversed rows.
4. In `post-purchase-invoice`, the invoice-first `costLedger` rows and the void copy the PO line's stripe.
5. Add a `databaseTest`. Receive 10 of a Part on a PO line charged to a project with project stock. Expect 3 results:
   1. an `itemLedger` row of +10 with `projectId`;
   2. a `costLedger` layer with `projectId`;
   3. `itemStockQuantities` +10 under that `projectId`.

**Verify:**
```bash
pnpm --filter @carbon/server-functions test -- post-receipt post-purchase-invoice
# Expected: all tests pass
```

**Out of scope:** grouped receipts (Phase 3).

---

## Task 10: Stripe job output and the backflush

**Depends on:** 6, 8
**Files:**
- Create: `packages/database/supabase/migrations/<timestamp>_complete-job-project-stock.sql`
- Modify: `apps/erp/app/modules/production/production.models.ts` — `receiveToProjectStock` on `baseJobValidator`, with a refine: it needs `projectId`, a project with `projectStock`, and `consumeToProject` off
- Modify: `apps/erp/app/modules/production/ui/Jobs/JobForm.tsx`

**Steps:**
1. Copy the latest `complete_job_to_inventory` into a new migration (`pnpm db:migrate:new complete-job-project-stock`).
2. When the job has `receiveToProjectStock`, write `projectId` on the `itemLedger` inserts (lines 458, 497, 538, 554) and on the `costLedger` Output row (lines 990–999).
3. Run `pnpm db:migrate`, then `pnpm run generate:types`.
4. In `JobForm`, show **Receive to project stock** when the charge number's project has project stock. It is off when **Consume to project** is on.
5. Add a `databaseTest` in `packages/server-functions/src/issue/project-issue.test.ts`: completing a job with `receiveToProjectStock` writes the receipt rows with the project stripe.

**Verify:**
```bash
pnpm --filter @carbon/server-functions test -- project-issue
# Expected: all tests pass
```

**Out of scope:** job output split across projects (Phase 3).

---

## Task 11: Record the drawn stripe in `issue`

**Depends on:** 6, 7, 8
**Files:**
- Modify: `packages/server-functions/src/issue/index.ts` (`issueJobOperationMaterials` 115, bin choice 273–300, insert 370; `consumeTrackedEntitiesIntoOperation` 1361 and insert 1833; `partToOperation` 3002, bins 3111–3129, rows 3164–3193, inserts 3219, 3312; merge 4307; unconsume 4572; convert 4846; maintenance 4941, 5318, 5528, 5738, 5771)

**Steps:**
1. Load the job's `projectId` and its project's `projectStock` once per call. Compute `stripes = stripesForDemand(...)`.
2. **Untracked items:**
   1. Choose bins with the new `getStorageUnitWithHighestQuantity` and `stripes`.
   2. When one bin cannot cover the quantity, split with `splitAcrossStripes`.
   3. Write one `itemLedger` row per stripe drawn, with its `projectId`.
   4. Call `calculateCOGS` once per stripe.
3. **Tracked items:** read each entity's stripe from its on-hand rows (`get_item_quantities_by_tracking_id` now returns `projectId`). Refuse an entity whose stripe is not in `stripes`, with a message that names its project.
4. **Unconsume, merge and convert:** copy the source rows' `projectId`.
5. **Maintenance issues:** use `stripes = [null]`.
6. Add a `databaseTest`: a job charged to project P with 4 in P and 10 in common issues 6. Expect two `itemLedger` rows: −4 in P and −2 in common.

**Verify:**
```bash
pnpm --filter @carbon/server-functions test -- issue
# Expected: all tests pass
```

**Out of scope:** the lineside budget logic in `picked-consumption.ts`, beyond reading the picked stripe (Task 12).

---

## Task 12: Carry the stripe through picking and stock transfers

**Depends on:** 6, 8
**Files:**
- Modify: `apps/erp/app/modules/inventory/inventory.service.ts` — `generatePickingList` (line 3748; source bin 4190–4220; `getItemOnHandByStorageUnit` 3599; `resolveWarehouseSource` 3628)
- Modify: `packages/server-functions/src/post-picking/index.ts` (inserts 230, 304, 409, 655, 780, 1027, 1553, 1729)
- Modify: `packages/server-functions/src/post-stock-transfer/index.ts` (inserts 221, 297, 457, 707, 818, 1205)
- Modify: `packages/database/src/picked-consumption.ts` (`getPickedBudgets`, lines 289–330)
- Create: `packages/database/supabase/migrations/<timestamp>_picking-schedule-project-stripe.sql`

**Steps:**
1. In `generatePickingList`, restrict `onHandFor` to the job's stripes. Stamp `projectId` on each `pickingListLine` from the stripe it draws.
2. In `post-picking` and `post-stock-transfer`, write the source row's `projectId` on **both** legs of every Transfer pair. Pick lines use their own `projectId`.
3. In `getPickedBudgets`, carry each pick line's `projectId` into its budget, so consumption draws the same stripe.
4. Redefine `get_picking_schedule` (latest `20260908211552_picking-supersession-consume-first.sql:63`) so its stock checks (lines 160–205) use the job's stripes. Redefine `get_lineside_credit` the same way. Keep the function signatures.
5. Run `pnpm db:migrate`, then `pnpm run generate:types`.

**Verify:**
```bash
pnpm --filter @carbon/server-functions test -- post-picking post-stock-transfer && pnpm --filter @carbon/database test -- picked-consumption
# Expected: all tests pass
```

**Out of scope:** changing the supersession pick rules.

---

## Task 13: Carry the stripe through shipments, invoices, returns and counts

**Depends on:** 6, 7, 8
**Files:**
- Modify: `packages/server-functions/src/post-shipment/index.ts` (1192, 3539, 1964, 4062, 2340, 4158, 2917, 4461, 3840; `calculateCOGS` 1243, 2199, 2780; `costLedger` 1273, 2210, 2791, 4171, 4474)
- Modify: `packages/server-functions/src/post-sales-invoice/index.ts` (2126, 2948; `calculateCOGS` 1833; `costLedger` 1856)
- Modify: `packages/server-functions/src/post-receipt/index.ts` (sales return 3131, inbound transfer 3532)
- Modify: `apps/erp/app/modules/inventory/inventory.service.ts` — `generateInventoryCountLines` (line 2118)
- Modify: `packages/server-functions/src/post-inventory-count/index.ts`
- Modify: `apps/erp/app/modules/quality/quality-disposition.server.ts` (line 549)

**Steps:**
1. **Sales shipments** draw common stock only: pass `stripes = [null]` to the bin choice and `projectId: null` to `calculateCOGS`.
2. **Returns, transfers and voids** copy the source row's `projectId`:
   - outbound and inbound warehouse transfers (both legs);
   - sales return receipt and shipment;
   - purchase return shipment;
   - every void.
3. **Inventory counts:** `generateInventoryCountLines` snapshots on-hand per stripe, with one line per (item, bin, lot, stripe), and stamps `projectId`. `post-inventory-count` posts each variance to its line's stripe through `bookAdjustment`.
4. **Quality disposition** copies the source stripe.

**Verify:**
```bash
pnpm --filter @carbon/server-functions test -- post-shipment post-sales-invoice post-receipt post-inventory-count
# Expected: all tests pass
```

**Out of scope:** shipping project stock on a sales order. A project's stock reaches a customer only through a Transfer to common stock first.

---

## Task 14: Draw project stock in Issue to Project

**Depends on:** 6, 7, 8
**Files:**
- Modify: `packages/server-functions/src/post-project-issue/index.ts`
- Modify: `packages/server-functions/src/post-project-issue/post-project-issue.test.ts`

**Steps:**
1. When the project has project stock, draw from `stripesForDemand` (project, then common) with `splitAcrossStripes`. Book one adjustment per stripe through `bookAdjustment` with its `projectId`.
2. A Return goes back to the project's stripe when the project has project stock, else to common.
3. The `projectLedger` row carries the total cost of all stripes drawn.
4. Add a test. With 4 in the project and 10 in common, issue 6. Expect −4 in the project stripe and −2 in common, and one `projectLedger` row with the summed cost.

**Verify:**
```bash
pnpm --filter @carbon/server-functions test -- post-project-issue
# Expected: all tests pass
```

**Out of scope:** issuing another project's stock.

---

## Task 15: Stripe the inventory snapshot and the quantity and valuation RPCs

**Depends on:** 4
**Files:**
- Create: `packages/database/supabase/migrations/<timestamp>_inventory-rpcs-project-stripe.sql`
- Modify: `apps/erp/app/modules/inventory/inventory.service.ts` — `getInventoryItems` (lines 340–366), `getInventoryValuation` (399–409)
- Modify: `apps/erp/app/modules/items/items.service.ts` — `getItemQuantities` (line 1236)

**Steps:**
1. Recreate the `itemLedgerSnapshot` materialized view (latest `20260811123614_widen-ledger-amounts.sql:116–145`) grouped by `COALESCE("projectId", '')`. Change its unique index to `(itemId, companyId, locationId, projectId)`, which `REFRESH … CONCURRENTLY` needs. Drop the dependent functions first if Postgres requires it, and recreate them in this migration.
2. Redefine `get_inventory_quantities` (latest `20261006130001_demand-forecast-consumption.sql:869`) with a new last parameter `project_id TEXT DEFAULT NULL`:
   - NULL means all stripes (today's behavior);
   - `''` means common;
   - an id means that project.

   Filter all 3 arms (snapshot, tracked rows, untracked rows after `v_cutoff`) and the storage-unit CTE. Keep one row per item.
3. Redefine `get_inventory_valuation` (latest `20261010002941_valuation-child-rows.sql`, which Field Service Phase C Task 2 forked from `20260925121735…sql:1488–1612`; keep its child-row fix):
   1. Add `"projectId"` to its RETURNS TABLE. Because this is a signature change, `DROP FUNCTION` first.
   2. Add `"projectId"` to each arm and the GROUP BY.
   3. Group `carrying` by `(itemId, projectId)`.
   4. Join on `c."projectId" IS NOT DISTINCT FROM q."projectId"`.
4. Redefine `get_inventory_tie_out` (same file, line 1425), which calls it at line 1452, to sum across stripes as before.
5. Redefine `get_item_ledger_balance` (`20261002153931_item-ledger-running-balance.sql:30–90`) and `get_inventory_value_by_location` (`20260713235406…sql:454`) for the new snapshot shape. Each keeps its signature and sums across stripes.
6. Keep each function's `SECURITY` setting and its `assert_company_access` call.
7. Run `pnpm db:migrate`, then `pnpm run generate:types`.
8. Add `projectId?: string | null` to `getInventoryItems` and `getItemQuantities`, passed as `project_id`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exit code 0
psql "$SUPABASE_DB_URL" -c "SELECT count(*) FROM get_inventory_valuation('<a dataset company id>');"
# Expected: the same count as before the migration (no project stock exists yet)
```

**Out of scope:** a per-project valuation report page.

---

## Task 16: Add the `post-project-stock-transfer` server function

**Depends on:** 6, 8
**Files:**
- Create: `packages/server-functions/src/post-project-stock-transfer/index.ts`
- Create: `packages/server-functions/src/post-project-stock-transfer/plan.ts`
- Create: `packages/server-functions/src/post-project-stock-transfer/plan.test.ts`
- Create: `packages/server-functions/src/post-project-stock-transfer/post-project-stock-transfer.test.ts`
- Modify: `packages/server-functions/src/invoke.ts` — register it
- Copy from (precedent): `packages/server-functions/src/post-stock-transfer/index.ts` (lines 57–224)

**Steps:**
1. Input: `{ projectStockTransferId }`. Permissions: `{ update: "projects" }`.
2. In one transaction, lock the header with `FOR UPDATE`. If it is not `Approved`, refuse.
3. **Government-furnished guard:** if the from-project has `governmentFurnished`, refuse when the to-owner is common, or a project whose `customerId` differs.
4. For each line:
   1. **Draw** from the from-stripe with `calculateCOGS({ projectId: fromProjectId })`, which consumes the layers.
   2. Write an `itemLedger` Transfer pair at the same bin, `documentType: "Project Transfer"`: −qty in the from-stripe and +qty in the to-stripe.
   3. Stamp `unitCost` on the line.
5. **By type:**
   - **Transfer:** write the new layer in the to-stripe at the drawn cost. Move each consumed layer's adjustment children with it (see the child loop in `calculate-cogs.ts:131–160`). Post no journal, because both owners are inventory.
   - **Borrow:**
     1. Write the new layer in the borrower's stripe at the lender's cost, with `projectBorrowId`.
     2. Insert a `projectBorrow` row: quantity, `borrowedUnitCost`, due date, `Open`.
     3. Post no journal.
   - **Payback:**
     1. Draw from the borrower's stripe at the borrower's current FIFO cost.
     2. Write the new layer in the lender's stripe at that cost.
     3. Reduce the borrow FIFO-matched (oldest open borrow of the item first, starting from `settlesBorrowId`). Set `Paid Back` when it is fully paid.
     4. When the payback cost differs from the borrowed cost: post Dr/Cr `inventoryAdjustmentVarianceAccount` / Cr/Dr inventory for the difference, with the Project dimension of the borrower. Write a `Payback Variance` row in the borrower's `projectLedger`.
6. Put the pure rules in `plan.ts`: `planBorrowMatching(openBorrows, quantity)` and `paybackVariance(borrowedUnitCost, paybackUnitCost, quantity)`.
7. Write `plan.test.ts` with 3 cases:
   1. A payback of 7 against open borrows of 5 and 4 settles the first fully and 2 of the second.
   2. A payback at 11.00 against a borrow at 10.00 for 5 units gives a variance of 5.00 to the borrower.
   3. `planBorrowMatching` refuses a payback larger than the open borrows.
8. Write `post-project-stock-transfer.test.ts` with `databaseTest`:
   1. Transfer 3 from common to P moves `itemStockQuantities` between stripes and keeps the total value.
   2. Borrow then Payback records the variance.
9. Update the permissions snapshot (`-u`) and review it.

**Verify:**
```bash
pnpm --filter @carbon/server-functions test -- post-project-stock-transfer permissions-manifest
# Expected: all tests pass
```

**Out of scope:** tracked-entity batch splits during a partial transfer. A partial transfer of a lot leaves one entity in two stripes, which the ledger supports.

---

## Task 17: Add the project stock transfer pages

**Depends on:** 16
**Files:**
- Create: `apps/erp/app/routes/x+/projects+/transfers.tsx`, `transfers.new.tsx`
- Create: `apps/erp/app/routes/x+/project-stock-transfer+/$id.tsx`, `$id.lines.tsx`, `$id.status.tsx`
- Create: `apps/erp/app/modules/projects/ui/Transfers/*`
- Modify: `apps/erp/app/modules/projects/projects.models.ts`, `projects.service.ts`, `projects.server.ts`
- Modify: `apps/erp/app/modules/projects/ui/useProjectsSubmodules.tsx` — **Transfers**
- Copy from (precedent): `apps/erp/app/routes/x+/stock-transfer+/*`; `apps/erp/app/modules/inventory/inventory.service.ts` (`upsertStockTransfer`, lines 2337–2635)

**Steps:**
1. Models and services: `projectStockTransferValidator`, `projectStockTransferLineValidator`, `getProjectStockTransfers`, `getProjectStockTransfer`, `upsertProjectStockTransfer` (Draft only), `upsertProjectStockTransferLine`, `deleteProjectStockTransferLine`, and `getProjectBorrows(client, companyId, { projectId, status })`.
2. **New:** type, from (project or common), to (project or common), location, reason (required). A Borrow needs a payback due date. A Payback picks the open borrow it settles, and from/to are filled from the borrow.
3. **Lines:** item, quantity, storage unit and lot or serial. The available quantity shows from the from-stripe.
4. **Status actions:**
   - **Approve** needs `update: projects` and records `approvedBy` and `approvedAt`.
   - **Post** calls `post-project-stock-transfer`.
   - **Cancel** works from Draft or Approved.
5. Show the government-furnished refusal as a flash error.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exit code 0
```

**Out of scope:** approval rules from the approvals engine (projects stay community).

---

## Task 18: Add the project stock UI

**Depends on:** 15, 17
**Files:**
- Modify: `apps/erp/app/routes/x+/inventory+/quantities.tsx` (loader lines 40–80) — a `project` search param
- Modify: `apps/erp/app/modules/inventory/ui/Inventory/InventoryTable.tsx` — a **Stock owner** filter (All, Common, a project)
- Modify: `apps/erp/app/modules/inventory/ui/Inventory/InventoryStorageUnits.tsx` (lines 138–180) — a top grouping by owner
- Create: `apps/erp/app/routes/x+/project+/$projectId.stock.tsx`
- Create: `apps/erp/app/modules/projects/ui/Stock/ProjectStock.tsx`
- Modify: `apps/erp/app/modules/projects/ui/Project/useProjectNavigation.tsx` — **Stock** (projects with project stock)
- Modify: `apps/erp/app/modules/projects/ui/Projects/ProjectForm.tsx` — **Project stock** (editable while Draft only), **Charge at receipt**, **Government-furnished**

**Steps:**
1. The quantities page passes `project_id` to `getInventoryItems`.
2. The item's storage-unit view groups rows by owner (Common, then each project), then by bin. Its adjust actions pass the row's stripe to the adjustment.
3. The project **Stock** tab shows 3 parts:
   1. the project's on-hand by item, bin and lot (`get_inventory_quantities` with `project_id`);
   2. the open borrows, owed and lent, with due dates;
   3. **Transfer**, **Borrow** and **Payback** buttons. Each opens a prefilled Draft transfer.
4. Overdue borrows show in red.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exit code 0
```

**Out of scope:** MRP exceptions for overdue borrows (Phase 2b).

---

## Task 19: Extend the demo datasets

**Depends on:** 16
**Files:**
- Modify: `packages/database/src/datasets/types.ts`, `tiers/09-accounting.ts`, `tiers/03-inventory.ts`, `data/*/accounting.ts`, `coverage.ts`

**Steps:**
1. In the satellite dataset, set `projectStock` on the Contract project. Seed opening stock of 2 items in its stripe (`itemLedger` and `costLedger` with `projectId`), using the tier 03 opening stock pattern.
2. Seed one posted Transfer (common → project) with its ledger pair and layers.
3. Add `projectStockTransfer` to `COVERAGE_FLOORS` after measuring.
4. Run `pnpm db:check:datasets`.

**Verify:**
```bash
pnpm db:check:datasets
# Expected: all four datasets pass
```

**Out of scope:** borrows in the datasets.

---

## Task 20: Update the rules, AGENTS.md, docs and spec

**Depends on:** 1–19
**Files:**
- Modify: `.claude/rules/projects-system.md`, `.claude/rules/inventory-system.md`, `.claude/rules/traceability-model.md`, `.claude/rules/mrp-system.md` (the common-only on-hand filter until Phase 2b)
- Modify: `apps/erp/app/modules/projects/AGENTS.md`, `apps/erp/app/modules/inventory/AGENTS.md`
- Modify: `docs/content/docs/reference/projects.mdx`
- Modify: `.ai/specs/2026-10-03-projects.md`

**Steps:**
1. Document the stripe rule, the stripe set per demand, the handler and primary-key order, and the Transfer, Borrow and Payback costing.
2. In the spec, record these decisions:
   1. **Stripe location:** no `trackedEntity.projectId`.
   2. **Approval:** project stock transfers are approved by `update: projects`, not the approvals engine.
   3. **Shipments:** sales shipments draw common stock only.
   4. **Counts:** inventory counts count each stripe separately.
3. Run the STE-80 review pass on every `.ai/` file you changed.

**Verify:**
```bash
cd docs && pnpm typecheck
# Expected: exit code 0
```

**Out of scope:** the changelog entry.

---

## Task 21: Verify in the browser

**Depends on:** 1–20
**Files:**
- Create: `.ai/playbooks/projects-phase-2a.md` (written by `/test`)

**Steps:**
1. Run `/test` on a satellite dataset company.
2. Cover these spec acceptance criteria:
   1. **Stock rules.**
      - Receiving a Part PO line charged to P-101 (project stock on) raises P-101's stock, not common stock.
      - A job for P-102 cannot pick it.
      - A job for P-101 picks P-101 first, then common.
   2. **Borrow and payback.**
      - Borrow 5 from P-101 to P-102 (due date set): the stock moves, and the lender keeps the cost.
      - A Payback at a different unit cost charges the difference to P-102 as Payback Variance.
   3. **Government-furnished material:** Approve refuses a transfer from a government-furnished project to a commercial project.
   4. **Valuation:** the inventory valuation total is unchanged by a Transfer.
   5. **Planning:** before Phase 2b, MRP output for the company is the same as before Phase 2a.
3. Save the playbook to `.ai/playbooks/projects-phase-2a.md`.

**Verify:**
```bash
ls .ai/playbooks/projects-phase-2a.md
# Expected: the file exists, and the /test run reports every step passed
```

**Out of scope:** the Segmented MRP criterion (Phase 2b).

## Execution notes

- Task 1: the migration adds foreign keys the plan's SQL left out, so a backup restore into another company remaps them: `pickingListLine.projectId` and `inventoryCountLine.projectId` → `project`, `projectStockTransferLine.storageUnitId` → `storageUnit`, `projectBorrow.projectStockTransferLineId` → `projectStockTransferLine`, `projectStockTransfer.settlesBorrowId` and `costLedger.projectBorrowId` → `projectBorrow`. Every FK column has an index. `planningActionId` stays without an FK, because MRP replaces its planning actions on every run; Task 4 lists it in `ID_REF_COLUMNS`. The sequence insert uses `WHERE NOT EXISTS`, as `20261009153156_field-service-module.sql` does; the effect equals `ON CONFLICT DO NOTHING`.
- Task 1: `pnpm db:migrate` applied both migrations and regenerated the types and swagger. Then `authz sync` failed on the 3 new tables, which have no rule until Task 4 (as in Field Service Phase A Task 4). The commit carries the regenerated MCP digest and workflow catalog (`job.receiveToProjectStock` gains a label).
- Tasks 2 and 3: both were on disk before `pnpm db:migrate`. `authz migration item-stock-quantities-project-handler` wrote `20261010021110_item-stock-quantities-project-handler.sql`, directly after Task 2's `20261010021027_item-stock-quantities-project.sql`, with nothing between them. The primary key was named `itemStockQuantities_pkey`, as the plan assumed. The count of rows with a project is 0, and `vitest run src/authz` passes (35). A rolled-back smoke test inserted a common and a striped `itemLedger` row: the handler kept two rows for the key (common 5, striped 3), and `reconcile_item_stock_quantities()` left both unchanged. `authz sync` still fails on the 3 tables without a rule until Task 4. `db:check:backups` fails only on `supplierPartPrice.unitPrice`, so these commits skip it with `CARBON_SKIP_BACKUP_CHECK=1`; the new column has the default `''`.
- Task 4: `generate:types` changed nothing (Tasks 1 and 2 committed their types). The rules are the plan's. `authz migration projects-2a-rls` wrote `20261010021634_projects-2a-rls.sql` for the 3 tables, and a second `pnpm db:migrate` recorded it; `authz check` reports no drift and `vitest run src/authz` passes (35). `ID_REF_COLUMNS` gains `itemStockQuantities.projectId` and `projectStockTransfer.planningActionId` (Task 1 note).
- Task 4: the new `journalEntrySourceType` value `Project Transfer` made `POSTING_POLICY` (`packages/ee/src/accounting/core/models.ts`) fail to typecheck, because it is a `Record` over the enum. It gains a `Project Transfer` entry, off by default as the comment above `Revenue Recognition` asks of a new journal type, so `posting-policy.test.ts` keeps its default-enabled list. Task 16 posts these journals; Brad may want it on, as `Project Issue` is.
- Fix after Task 4 (`fix(projects)`): the `erp` typecheck failed on the new `Project Transfer` source type, because `journalEntrySourceTypes` (`accounting.models.ts`) is a hand-written list that `JournalEntrySourceTypeIcon` and the journal tables type against. It gains the value, with the `LuArrowLeftRight` icon that `Transfer Receipt` and `Asset Transfer` use.
- Task 5: `mrp.ts` and `quote-lead-time.ts` filter `projectId = ''` in place. In `planning-actions.ts` the read moved into the exported `loadCommonOnHand(db, companyId)`, which builds the same map, so the step 5 test can call it. That test lives in `planning-actions.test.ts` and gives a Kysely driver the two rows (`''` with 5, `prj_1` with 3). The driver answers equality predicates as Postgres would. It expects 5, and with the filter removed it got 3 (the last row wins), so the test proves the filter. The planning package has no database fixture, so this replaces a database test.
- Task 5: in `get-method`, the new `jobStockStripes(projectId)` gives `['']`, plus the job's project when the job has one (`receiveToProjectStock` needs a project, so the project covers both cases). `loadSupersessionRedirect` reads `job.projectId` (the `itemToJob` job read now selects it) and `settleConsumeFirstLines` takes `projectId` from its 4 callers. Both readers already summed per item. `getItemStockQuantitiesByLocation` adds `.order("projectId")` and keeps summing every stripe.
- Task 5: the other `itemStockQuantities` readers need no change. `mrp-companies.ts` looks for any negative row, `operations.ts` and the Item picker sum every row, and the quantities page only subscribes to realtime.
- Task 5 Verify: `pnpm --filter @carbon/planning test` passes (313), and `pnpm --filter @carbon/server-functions test -- get-method` ran the whole suite (483 passed). `@carbon/planning`, `@carbon/server-functions` and `erp` typecheck green. No project stock exists yet, so planning output does not change.
- Task 6: `calculateCOGS` takes `projectId` and relieves only the layers of that stripe (null or undefined is common). The children query stays as it was, because it reads by `appliesToCostLedgerId`. The 2 cases are in one `databaseTest` with 2 calls. The project layer is the older one, so the common call fails without the filter.
- Task 6 (deviation): the backflush fork is `20261010023707_backflush-project-stripe.sql`, from `20261010012609` (field service D), not from `20260805023439`. It keeps the consume-to-project, capital job and stamped layer rules. The stripe set follows the spec's issue rule, not the plan's step 5.1. A job charged to a project with project stock draws that project's stock, then common stock. Every other job draws common stock only. A consume-to-project job whose project has no project stock draws common stock, and a job charged to a stocked project draws its stock whether or not it consumes to the project. Step 5.1 would have drawn only the project's layers and never fallen back to common stock.
- Task 6: the backflush writes one `itemLedger` Consumption row per stripe it draws. A stripe before the last takes at most its untracked on-hand at the bin; the last stripe takes the rest, as the single row did. The fallback bin (highest quantity) and the lineside clamp count only the job's stripes. Each row relieves the layers of its own stripe, and its consumption `costLedger` row, journal lines and `projectLedger` row follow it. A job with one stripe reads no extra on-hand and writes the same rows as before.
- Task 6: the new pgTAP script `supabase/tests/backflush-project-stripe.test.sql` covers a project job (4 from the project at 12.00, then 2 from common at 10.00) and 2 common demands (a project without project stock, and no project). The backflush and job completion scripts pass, and the server-functions suite passes (484).
- Task 7: `buildItemLedgerRow` and `buildCostLedgerRow` (`plan-adjustment.ts`) take `projectId` and write it on every row, as null for common. So the bulk stock importer writes the column on every row too (the Kysely multi-row insert lesson). `bookAdjustment` passes `ledger.projectId` to its row and to `valueMovement`, whose 3 `costLedger` rows and `calculateCOGS` call use it. An increase still opens its layer at the item's current cost over every stripe's open layers.
- Task 7 (deviation): `post-inventory-adjustment` has no void. Its reversal is the tracked Unscrap, which links to the scrap movement through `correctionOfItemLedgerId`. The Unscrap now copies that movement's `projectId`. `correct-stock-movement` copies the corrected root's `projectId`.
- Task 7 audit of the other `bookAdjustment` callers:
  1. `post-asset-transfer` and `post-rental-agreement` move fixed assets and rental units, which are common stock. They pass nothing.
  2. `post-project-issue` is Task 14. `post-inventory-count` and `post-nonconformance` are Task 13. The maintenance paths of `issue` are Task 11 (common).
  3. The tracked paths of `post-inventory-adjustment` (scrap, storage unit transfer and adjustment of an entity) and the stock check of `correct-stock-movement` read `get_item_quantities_by_tracking_id`. Task 8 gives that RPC a `projectId` column, and Task 8 fixes those callers.
- Task 7: the fixture gains `enableProjectStock` and `addStripeStock` (an item ledger row and a cost layer in one stripe). The new `correct-stock-movement.test.ts` corrects a project stock movement from 4 to 3. The correction row and its relief carry the project, and the relief is 12.00 from the project's layer, not 10.00 from the older common layer. The server-functions suite passes (485; the known `post-charge-transaction` race passed alone).
- Task 8: `stock-stripes.ts` returns `{ draws, remaining }` from `splitAcrossStripes`. It also exports `stripeKey` (`''` for common), `itemLedgerInStripes` (a Kysely filter on `itemLedger`) and `loadDemandStripes(db, companyId, projectId)`, which reads `project.projectStock` once. Tasks 11–14 use them.
- Task 8: `getStorageUnitWithHighestQuantity` returns the bin of the first stripe that holds stock in any bin, and the bin with the most on-hand within it. Its 5 callers in `issue` pass `stripes: [null]` until Task 11. `getStorageUnitId` now takes an args object with `companyId` and optional `stripes` (common by default); its one caller is `get-method`.
- Task 8: migration `20261010024754_stock-pickers-project-stripe.sql`. Each filter compares `COALESCE("projectId", '')` with the stripe set mapped the same way (step 5). Each function keeps its `SECURITY` setting; `get_item_quantities_by_tracking_id` keeps `assert_company_access` and its `search_path`. A smoke query on the local data returns the same rows for the default set, and none for a set without common stock.
  1. `get_available_tracked_entities` returns one row per entity and stripe.
  2. `get_picking_list_availability` counts the stock of the line's own stripe (`IS NOT DISTINCT FROM pll."projectId"`).
  3. `get_picking_list_tracked_available` lists the entities of each stripe the list's lines draw, with `projectId`. The ERP and MES `getPickingListRecommendations` key their pools by item and stripe, so a line gets lots of its own stripe only.
- Task 8: the RPC callers that read `get_item_quantities_by_tracking_id` now match the stripe:
  1. `post-inventory-adjustment` books a tracked entity's movement in the stripe of its row with the most on-hand. It books a serial picked by readable id, or the one entity in a bin, in that row's stripe. Untracked lookups read common rows only, because an untracked adjustment has no stripe input until Task 18.
  2. `correct-stock-movement` checks the stock of the corrected root's stripe.
  3. `post-project-issue` reads common rows for an untracked issue until Task 14.
- Task 8: the ERP and MES `getAvailableTrackedEntities` take optional `projectIds`. No caller passes them yet, so the pickers list common stock. The MES issue picker for a job of a stocked project needs its job's stripes (follow-up, with Task 12).
- Task 8 Verify: `stock-stripes.test.ts` passes (3). `@carbon/server-functions`, `erp` and `mes` typecheck green. The server-functions suite passes (488), and the backflush and job completion scripts pass.
- Task 9: the receipt reads the project stock of its PO lines' projects with one query (`loadProjectStock`, `lib/stock-stripes.ts`). Outside processing orders never stock. A stocked item on a line charged to a project with project stock takes the project as its stripe:
  1. Its `Purchase Receipt` item ledger rows (untracked, batch and serial) and its cost layers carry the project. A negative receipt relieves the project's layers through `calculateCOGS`.
  2. It debits inventory, not the project account, and its debit carries no Project tag.
  3. It writes no Project Issue rows (the Phase 1a consume-at-receipt branch now needs a project without project stock).
  4. It writes a `projectLedger` row only when the project has `chargeAtReceipt`. That row has no asset (`fixedAssetId` null), because stock builds no CIP until it is issued.
- Task 9 (deviation): the stripe does not depend on the project's cost treatment. A Statistical project with project stock receives into its stock too, but it has no route, so it never gets a `projectLedger` row. The route check (`assertChargeable("commitment")`) still runs for the other treatments.
- Task 9: both receipt voids (Purchase Order and Sales Return Order) copy `projectId` from the rows they reverse.
- Task 9: `loadInvoiceProjectCharges` reads project stock for the invoice's charge numbers and gains `stockStripe(invoiceLineId)`. `chargedAtReceipt` returns null for a receipt into project stock (Charge at receipt), so its invoice adjusts the project's layers like any stocked receipt. Its variance writes up inventory and adds no Material Variance row. A direct invoice (no PO line) of a stocked item charged to a stocked project stripes its item ledger row and layer. A variance child takes its parent layer's stripe, and the legacy self-heal layer takes the line's stripe. The invoice void copies `projectId` on its item ledger, cost ledger, counter-child and self-heal mirror rows.
- Task 9 (known gap): with Charge at receipt, the project's `projectLedger` row keeps the receipt cost. The invoice's price variance reaches the layer but not the project. Phase 4 billing reads this row.
- Task 9: 2 new database cases. `project-receipt.test.ts` receives 10 into project stock (the 3 results of step 5, an inventory debit of 100.00, no `projectLedger` row) and voids it (−10 in the stripe, on-hand 0). `project-invoice.test.ts` invoices a Charge at receipt line at 12.00 against a receipt at 10.00: inventory +8.00 and a child of 8.00 in the project's stripe. The server-functions suite passes (490; the known `rows` race passed alone).
- Task 10: migration `20261010030228_complete-job-project-stock.sql` forks `complete_job_to_inventory` from `20261009105739`, the newest definition, and keeps SECURITY DEFINER. Its 4 Assembly Output inserts and the Output cost layer carry the project when the job has `receiveToProjectStock` and its project has `projectStock`. A flag on a project without project stock receives into common stock, so no stock lands in a stripe that no demand draws. The backflush needed no change here: Task 6 already draws the job's stripes.
- Task 10: `baseJobValidator` gains `receiveToProjectStock`. `jobValidator` refuses it without a charge number, with Consume to project, or with a Make to Asset target. `salesOrderToJobValidator` refuses it, because a sales order ships from common stock (Task 13). The zod refine cannot see the project, so `chargeNumberError` refuses it on a project without project stock.
- Task 10: `insertJob` and `updateJob` take the flag, and `job+/new.tsx` and `$jobId.details.tsx` save it. The inline charge number change (`job+/update.tsx`) clears it when the new project has no project stock. Linking a job that receives into project stock to a sales order line is refused there too.
- Task 10: `ChargeNumber` rows gain `projectStock` (read in `getChargeNumbers`). `JobForm` shows **Receive to project stock** when the charge number's project has project stock and the job completes to inventory. Turning it on turns Consume to project off, and the reverse. `getJobProjectCharge` reads the flag, and `JobHeader` shows a "Receives to project stock" badge. The new strings wait for the run's final `/translate` pass.
- Task 10: the new case in `project-issue.test.ts` completes a job of a stocked project with 2 in the project's stock at 12.00 and 10 in common stock at 10.00. The backflush writes −2 in the project's stripe and −1 in common. The Assembly Output row, the Output layer (34.00) and on-hand carry the project. The server-functions suite passes (491), the ERP production and projects tests pass (137), and `erp` typechecks.
- Task 11: `issue` reads the job's stripes once per call with `loadDemandStripes` (one `project` read when the job has a project). Untracked draws in `issueJobOperationMaterials` and `partToOperation` choose the bin within those stripes. `drawUntrackedAtBin` then writes one Consumption row per stripe drawn, each priced by `calculateCOGS` with its stripe. A stripe before the last takes at most its on-hand at the bin, and the last (common) stripe takes the rest, as the SQL backflush does (Task 6; `drawFromStripes`). A job with one stripe reads no on-hand and writes the row it wrote before.
- Task 11: a return in `partToOperation` (a positive adjustment) goes back to the job's first stripe, the project's when it has project stock, as Task 14 states for Issue to Project.
- Task 11: the lineside budget rows (`getPickedBudgets` takes) are written with `projectId: null` until Task 12 carries the picked stripe.
- Task 11: a tracked entity's stripe is the stripe of its rows with the most net on-hand (`trackedEntityStripe`, pure and tested). It comes from the ledger rows the paths already read, not from `get_item_quantities_by_tracking_id`. `consumeTrackedEntitiesIntoOperation` refuses an entity outside the job's stripes with `assertEntitiesInStripes` ("LOT-1 is in the stock of project TP. Transfer it first."). Its split rows, its Consumption row and its relief carry the entity's stripe.
- Task 11 (beyond the plan's list): the scrap of an Available entity (`scrapTrackedEntity`) books in the entity's stripe. A merge refuses lots of different stripes, and the merged lot keeps the one stripe. These follow the stripe rule for every row the task touches.
- Task 11: unconsume copies the stripe of the entity's Consumption row, and convert copies the stripe of its latest row. Maintenance draws common stock only: its bins already used `[null]` (Task 8), and a tracked maintenance issue now refuses an entity in project stock.
- Task 11: 2 new cases in `project-issue.test.ts`. A backflush for a job of project P with 4 in P at 12.00 and 10 in common at 10.00 issues 6: −4 in P (−48.00) and −2 in common (−20.00). A batch in P's stock is refused for a job with no project and consumed in P's stripe by a job of P. `stock-stripes.test.ts` gains `drawFromStripes` and `trackedEntityStripe` (5 tests). The server-functions suite passes (495; the known `rows` race passed alone), and the backflush and job completion scripts pass.
