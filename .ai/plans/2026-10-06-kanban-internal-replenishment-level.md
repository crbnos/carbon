# Kanban Internal Replenishment Level — implementation plan

**Spec:** .ai/specs/2026-10-06-kanban-internal-replenishment-level.md
**Research:** .ai/research/kanban-internal-replenishment-level.md
**Run record:** .ai/runs/2026-10-06-kanban-internal-replenishment-level.md
**Branch:** naveenkash/kanban-circuit-replenishment-spec

## Ground rules for the executor

- 🛑 Ask the user before each step that writes to the local database. These steps are marked **(DB write — ask first)**. This includes `pnpm db:migrate` and every live-database test.
- 🛑 Ask the user before each commit. Commit only through `/check-and-commit`. Never push.
- Start every new source file with its SPDX header. Run `pnpm --filter @carbon/checks license-headers` to write it. Do not type it by hand.
- Wrap every new UI string in Lingui `t` or `<Trans>`. `/check-and-commit` runs `/translate`.
- Never use JavaScript `Date`. Never use `Math.round` or `.toFixed` on a quantity.
- If a fact in this plan turns out false in the code, STOP and report. Do not improvise.
- Do not change the demo datasets (`packages/database/src/datasets/`). Their Transfer kanbans stay scan-only.

## Corrections to the spec found while planning

The spec is updated with each of these. The plan follows the updated spec.

| # | Spec said | Code says | Plan does |
|---|---|---|---|
| 1 | The `kanbans` view selects `k.*`, so the new column appears | Postgres expands `k.*` when it creates the view | Recreate the view in the migration |
| 2 | Scalar `get_kanban_projected_quantity(kanban_id, company_id)` | The kanbans list needs one query for the page | One set-returning function, `get_kanban_projected_quantities(company_id, kanban_ids)` |
| 3 | The sweep sends one event with no `companyId` | An Inngest concurrency key on a missing field is unsafe | `util.sweep_kanban_levels()` sends one event per company, with `kanbanIds` |
| 4 | Inngest function in `functions/inventory/` | That directory does not exist | `packages/jobs/src/inngest/functions/tasks/kanban-level-check.ts` |
| 5 | Statement handler in `event-system/functions/` | The only table statement handler, `apply_item_stock_quantities`, is in `handlers/` | Both new trigger bodies go in `event-system/handlers/` |
| 6 | The handler sends every armed kanban it touches | An event with no work still costs a function run | The handler and the interceptor send only kanbans below their level |
| 7 | A pgTAP test captures `send_inngest_event` | The DB tests are plain psql scripts; none captures a `net.http_post` call | Test the SQL selection (`util.kanban_level_breaches()`); prove the send path in the browser test |
| 8 | `getKanbanLevelStatus` | One concept, one name | `getKanbanProjectedQuantities` |
| 9 | The header loader reads the kanban's names for the badge | `getStockTransfer` selects `*`, so `kanbanId` arrives with no new read | The badge reads `kanbanId` only |
| 10 | A blank level on save clears the level | zod omits a blank optional field, so the UPDATE keeps the old value | `upsertKanban` writes `null` when the field is blank or the system is not Transfer |

## Progress

- [x] Task 1: Write the schema migration (verified, not committed)
- [x] Task 2: Add the two trigger bodies and ship them with `authz migration` (verified, not committed)
- [x] Task 3: Apply the migrations and regenerate types (DB write — ask first) (verified, not committed)
- [x] Task 4: Add the SQL test script (verified, not committed)
- [x] Task 5: Add the pure stock-transfer helpers in `@carbon/database` (verified, not committed)
- [x] Task 6: Switch `insertStockTransfer` to the shared helper (verified, not committed)
- [x] Task 7: Declare the `carbon/kanban.level-check` event (verified, not committed)
- [x] Task 8: Add the `kanban-replenish` server function (verified, not committed)
- [x] Task 9: Add the live-database test for `kanban-replenish` (verified, not committed)
- [x] Task 10: Add the Inngest function `kanbanLevelCheckFunction` (verified, not committed)
- [x] Task 11: Route the scan through `kanban-replenish` (verified, not committed)
- [x] Task 12: Extend `kanbanValidator` and `upsertKanban` (verified, not committed)
- [x] Task 13: Add the glossary term (verified, not committed)
- [x] Task 14: Add the Replenishment Level field to `KanbanForm` (verified, not committed)
- [x] Task 15: Show the level and projected quantity on the kanbans list (verified, not committed)
- [x] Task 16: Show the origin on stock transfers (verified, not committed)
- [x] Task 17: Print the level on the kanban label (verified, not committed)
- [x] Task 18: Update the docs, the kanban rule and the AGENTS files (verified, not committed)
- [x] Task 19: Run the final gates and the browser test (gates green; browser test passed 2026-10-09, playbook .ai/playbooks/kanban-replenishment-level.md)

## Dependencies

- Task 2 needs Task 1 (the trigger bodies call `get_kanban_projected_quantities`).
- Task 3 needs Tasks 1 and 2.
- Tasks 4, 5, 7, 12, 13 and 17 need Task 3 only. They are independent of each other.
- Task 6 needs Task 5.
- Task 8 needs Tasks 5 and 7.
- Tasks 9, 10 and 11 need Task 8. They are independent of each other.
- Task 14 needs Tasks 12 and 13.
- Tasks 15 and 16 need Task 3. They are independent of each other.
- Task 18 needs Tasks 8–17.
- Task 19 needs every other task.

---

## Task 1: Write the schema migration

**Depends on:** none
**Files:**
- Create: `packages/database/supabase/migrations/<timestamp>_kanban-replenishment-level.sql` (the command makes the name)
- Copy from (precedent): `packages/database/supabase/migrations/20260908143722_kanban-transfer.sql` (view), `packages/database/supabase/migrations/20261004183512_scheduled-jobs-from-database.sql:156-193` (sweep and cron)

**Steps:**
1. Run `pnpm db:migrate:new kanban-replenishment-level`.
2. Run this query against the local database. It is read-only.
   ```sql
   SELECT count(*) FROM "kanban"
   WHERE "replenishmentSystem" = 'Transfer' AND "fromStorageUnitId" = "storageUnitId";
   ```
3. If the count is above 0, STOP and report. The new CHECK would fail on those rows.
4. Write this SQL into the new file, exactly:

```sql
-- Kanban replenishment level: a Transfer kanban fires when the projected
-- quantity at its To storage unit is below this level.
-- Spec: .ai/specs/2026-10-06-kanban-internal-replenishment-level.md

-- 1. The level on the kanban
ALTER TABLE "kanban" ADD COLUMN IF NOT EXISTS "replenishmentLevel" NUMERIC;

ALTER TABLE "kanban" DROP CONSTRAINT IF EXISTS "kanban_replenishmentLevel_check";
ALTER TABLE "kanban"
  ADD CONSTRAINT "kanban_replenishmentLevel_check"
  CHECK ("replenishmentLevel" IS NULL OR "replenishmentLevel" >= 0);

COMMENT ON COLUMN "kanban"."replenishmentLevel" IS
  'Transfer kanbans only. When the projected quantity at the To storage unit is below this level, Carbon creates a Released stock transfer for "quantity". NULL = scan-only.';

-- A Transfer kanban must not feed itself. The zod refine exists; this stops API writes.
ALTER TABLE "kanban" DROP CONSTRAINT IF EXISTS "kanban_transfer_distinct_storage_units_check";
ALTER TABLE "kanban"
  ADD CONSTRAINT "kanban_transfer_distinct_storage_units_check"
  CHECK (
    "replenishmentSystem" <> 'Transfer'
    OR "fromStorageUnitId" IS NULL
    OR "storageUnitId" IS NULL
    OR "fromStorageUnitId" <> "storageUnitId"
  );

-- From a ledger row to its armed kanbans
CREATE INDEX IF NOT EXISTS "kanban_level_lookup_idx"
  ON "kanban" ("companyId", "itemId", "storageUnitId")
  WHERE "replenishmentSystem" = 'Transfer' AND "replenishmentLevel" IS NOT NULL;

-- 2. The kanbans view expands k.* at creation, so recreate it to expose the new column.
DROP VIEW IF EXISTS "kanbans";
CREATE VIEW "kanbans" WITH(SECURITY_INVOKER=true) AS
SELECT
  k.*,
  i.name,
  i."readableIdWithRevision",
  j."jobId" as "jobReadableId",
  l.name as "locationName",
  s.name as "storageUnitName",
  fs.name as "fromStorageUnitName",
  su.name as "supplierName",
  CASE
    WHEN i."thumbnailPath" IS NULL AND mu."thumbnailPath" IS NOT NULL THEN mu."thumbnailPath"
    ELSE i."thumbnailPath"
  END AS "thumbnailPath"
FROM "kanban" k
JOIN "item" i ON k."itemId" = i."id"
LEFT JOIN "modelUpload" mu ON mu.id = i."modelUploadId"
JOIN "location" l ON k."locationId" = l."id"
LEFT JOIN "storageUnit" s ON k."storageUnitId" = s."id"
LEFT JOIN "storageUnit" fs ON k."fromStorageUnitId" = fs."id"
LEFT JOIN "supplier" su ON k."supplierId" = su."id"
LEFT JOIN "job" j ON k."jobId" = j."id";

-- 3. The origin on the stock transfer
ALTER TABLE "stockTransfer" ADD COLUMN IF NOT EXISTS "kanbanId" TEXT;

ALTER TABLE "stockTransfer" DROP CONSTRAINT IF EXISTS "stockTransfer_kanbanId_fkey";
ALTER TABLE "stockTransfer"
  ADD CONSTRAINT "stockTransfer_kanbanId_fkey"
  FOREIGN KEY ("kanbanId", "companyId") REFERENCES "kanban" ("id", "companyId")
  ON DELETE SET NULL ("kanbanId");

CREATE INDEX IF NOT EXISTS "stockTransfer_kanbanId_idx"
  ON "stockTransfer" ("kanbanId") WHERE "kanbanId" IS NOT NULL;

-- 4. Projected quantity for the armed kanbans of one company.
-- kanban_ids NULL = every armed kanban of the company.
-- On-hand uses item_ledger_on_hand_contribution, the itemStockQuantities definition.
CREATE OR REPLACE FUNCTION get_kanban_projected_quantities(
  company_id TEXT,
  kanban_ids TEXT[] DEFAULT NULL
)
RETURNS TABLE ("kanbanId" TEXT, "replenishmentLevel" NUMERIC, "projectedQuantity" NUMERIC)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  SELECT
    k."id",
    k."replenishmentLevel",
    COALESCE(on_hand."quantity", 0) + COALESCE(inbound."quantity", 0)
  FROM "kanban" k
  LEFT JOIN LATERAL (
    SELECT SUM(item_ledger_on_hand_contribution(il."quantity", il."trackedEntityStatus")) AS "quantity"
    FROM "itemLedger" il
    WHERE il."companyId" = k."companyId"
      AND il."locationId" = k."locationId"
      AND il."itemId" = k."itemId"
      AND il."storageUnitId" = k."storageUnitId"
  ) on_hand ON true
  LEFT JOIN LATERAL (
    SELECT SUM(stl."outstandingQuantity") AS "quantity"
    FROM "stockTransferLine" stl
    JOIN "stockTransfer" st
      ON st."id" = stl."stockTransferId" AND st."companyId" = stl."companyId"
    WHERE stl."companyId" = k."companyId"
      AND st."status" IN ('Released', 'In Progress')
      AND stl."itemId" = k."itemId"
      AND stl."toStorageUnitId" = k."storageUnitId"
  ) inbound ON true
  WHERE k."companyId" = company_id
    AND (kanban_ids IS NULL OR k."id" = ANY (kanban_ids))
    AND k."replenishmentSystem" = 'Transfer'
    AND k."replenishmentLevel" IS NOT NULL
    AND k."fromStorageUnitId" IS NOT NULL
    AND k."storageUnitId" IS NOT NULL;
$$;

-- 5. Backstop sweep: every armed kanban below its level, one row per company.
CREATE OR REPLACE FUNCTION util.kanban_level_breaches()
RETURNS TABLE ("companyId" TEXT, "kanbanIds" TEXT[])
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT c."companyId", array_agg(p."kanbanId" ORDER BY p."kanbanId")
  FROM (
    SELECT DISTINCT "companyId" FROM "kanban"
    WHERE "replenishmentSystem" = 'Transfer' AND "replenishmentLevel" IS NOT NULL
  ) c
  CROSS JOIN LATERAL get_kanban_projected_quantities(c."companyId") p
  WHERE p."projectedQuantity" < p."replenishmentLevel"
  GROUP BY c."companyId";
$$;

CREATE OR REPLACE FUNCTION util.sweep_kanban_levels()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  breach RECORD;
BEGIN
  FOR breach IN SELECT * FROM util.kanban_level_breaches() LOOP
    PERFORM util.send_inngest_event(
      'carbon/kanban.level-check',
      jsonb_build_object('companyId', breach."companyId", 'kanbanIds', to_jsonb(breach."kanbanIds"))
    );
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION util.kanban_level_breaches() FROM PUBLIC;
REVOKE ALL ON FUNCTION util.sweep_kanban_levels() FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'kanban-level-sweeper') THEN
    PERFORM cron.unschedule('kanban-level-sweeper');
  END IF;
  PERFORM cron.schedule('kanban-level-sweeper', '7 * * * *', 'SELECT util.sweep_kanban_levels();');
END;
$$;
```

5. Do not add the `itemLedger` statement handler or the `kanban` interceptor here. Task 2 ships them.

**Verify:**
```bash
ls packages/database/supabase/migrations | grep kanban-replenishment-level
# Expected: one file, <timestamp>_kanban-replenishment-level.sql, newer than every other migration
pnpm --filter @carbon/checks test
# Expected: no failure that names the new migration
```

If `no-authz-ddl-in-migrations` flags `get_kanban_projected_quantities` or a `util.*` function, STOP and report.

**Out of scope:** the `kanbanReplenishmentSystem` enum (no rename to `Internal`); `kanban.quantity` (stays `INTEGER`); RLS policies (no new table).

---

## Task 2: Add the two trigger bodies and ship them with `authz migration`

**Depends on:** Task 1
**Files:**
- Create: `packages/database/src/event-system/handlers/queue_kanban_level_checks.sql`
- Create: `packages/database/src/event-system/handlers/sync_kanban_level_check.sql`
- Modify: `packages/database/src/event-system/attachments.ts` — the `itemLedger` entry and a new `kanban` entry
- Create: `packages/database/supabase/migrations/<timestamp>_kanban-level-check-triggers.sql` (generated)
- Copy from (precedent): `packages/database/src/event-system/handlers/apply_item_stock_quantities.sql` (statement handler), `packages/database/src/event-system/handlers/sync_job_complete_or_canceled.sql` (interceptor that calls `util.send_inngest_event`)

**Steps:**
1. Create `queue_kanban_level_checks.sql` with exactly this content:

```sql
CREATE OR REPLACE FUNCTION public.queue_kanban_level_checks()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  touched JSONB;
  target RECORD;
  below TEXT[];
BEGIN
  -- A seed, a restore or a test fixture loads ledger rows in bulk.
  -- The hourly sweep (util.sweep_kanban_levels) covers those.
  IF current_setting('app.sync_in_progress', true) = 'true' THEN
    RETURN NULL;
  END IF;

  -- Only batched_new exists on INSERT and only batched_old on DELETE.
  IF TG_OP = 'DELETE' THEN
    SELECT jsonb_agg(DISTINCT jsonb_build_object(
      'companyId', "companyId", 'itemId', "itemId", 'storageUnitId', "storageUnitId"))
    INTO touched
    FROM batched_old
    WHERE "storageUnitId" IS NOT NULL;
  ELSE
    SELECT jsonb_agg(DISTINCT jsonb_build_object(
      'companyId', "companyId", 'itemId', "itemId", 'storageUnitId', "storageUnitId"))
    INTO touched
    FROM batched_new
    WHERE "storageUnitId" IS NOT NULL;
  END IF;

  IF touched IS NULL THEN
    RETURN NULL;
  END IF;

  FOR target IN
    SELECT k."companyId", array_agg(DISTINCT k."id") AS "kanbanIds"
    FROM jsonb_to_recordset(touched) AS t("companyId" TEXT, "itemId" TEXT, "storageUnitId" TEXT)
    JOIN "kanban" k
      ON k."companyId" = t."companyId"
     AND k."itemId" = t."itemId"
     AND k."storageUnitId" = t."storageUnitId"
    WHERE k."replenishmentSystem" = 'Transfer'
      AND k."replenishmentLevel" IS NOT NULL
    GROUP BY k."companyId"
  LOOP
    SELECT array_agg(p."kanbanId" ORDER BY p."kanbanId")
    INTO below
    FROM get_kanban_projected_quantities(target."companyId", target."kanbanIds") p
    WHERE p."projectedQuantity" < p."replenishmentLevel";

    IF below IS NOT NULL THEN
      PERFORM util.send_inngest_event(
        'carbon/kanban.level-check',
        jsonb_build_object('companyId', target."companyId", 'kanbanIds', to_jsonb(below))
      );
    END IF;
  END LOOP;

  RETURN NULL;
END;
$function$;
```

2. Create `sync_kanban_level_check.sql` with exactly this content:

```sql
CREATE OR REPLACE FUNCTION public.sync_kanban_level_check(p_table text, p_operation text, p_new jsonb, p_old jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  is_below BOOLEAN;
BEGIN
  IF current_setting('app.sync_in_progress', true) = 'true' THEN
    RETURN;
  END IF;

  IF p_operation NOT IN ('INSERT', 'UPDATE') THEN
    RETURN;
  END IF;

  IF (p_new->>'replenishmentSystem') IS DISTINCT FROM 'Transfer'
    OR (p_new->>'replenishmentLevel') IS NULL
  THEN
    RETURN;
  END IF;

  -- An UPDATE that changes nothing the level check reads does not re-check.
  IF p_operation = 'UPDATE'
    AND (p_new->'replenishmentLevel') IS NOT DISTINCT FROM (p_old->'replenishmentLevel')
    AND (p_new->'replenishmentSystem') IS NOT DISTINCT FROM (p_old->'replenishmentSystem')
    AND (p_new->'quantity') IS NOT DISTINCT FROM (p_old->'quantity')
    AND (p_new->'itemId') IS NOT DISTINCT FROM (p_old->'itemId')
    AND (p_new->'locationId') IS NOT DISTINCT FROM (p_old->'locationId')
    AND (p_new->'storageUnitId') IS NOT DISTINCT FROM (p_old->'storageUnitId')
    AND (p_new->'fromStorageUnitId') IS NOT DISTINCT FROM (p_old->'fromStorageUnitId')
  THEN
    RETURN;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM get_kanban_projected_quantities(p_new->>'companyId', ARRAY[p_new->>'id']) p
    WHERE p."projectedQuantity" < p."replenishmentLevel"
  ) INTO is_below;

  IF is_below THEN
    PERFORM util.send_inngest_event(
      'carbon/kanban.level-check',
      jsonb_build_object('companyId', p_new->>'companyId', 'kanbanIds', jsonb_build_array(p_new->>'id'))
    );
  END IF;
END;
$function$;
```

3. In `attachments.ts`, replace the `itemLedger` entry (lines 112-114) with:
   ```ts
   itemLedger: {
     statement: [
       "apply_item_stock_quantities",
       "broadcast_table_changes",
       "queue_kanban_level_checks"
     ]
   },
   ```
4. Add a `kanban` entry between `jobOperationStepRecord` and `journal`:
   ```ts
   kanban: { after: ["sync_kanban_level_check"] },
   ```
5. Run `pnpm --filter @carbon/database authz migration kanban-level-check-triggers`.
6. Open the generated file. Confirm it holds both `CREATE OR REPLACE FUNCTION` bodies. Confirm it holds `set_event_triggers('itemLedger', …)` with all three statement functions. Confirm it holds `set_event_triggers('kanban', …)`.
7. Do not edit the generated file.

**Verify:**
```bash
pnpm --filter @carbon/database test
# Expected: pass; migration.test.ts reports no unshipped helper or attachment
```

If `authz migration` refuses because a new file would create an overload, STOP and report.

**Out of scope:** the `stockTransfer` and `stockTransferLine` attachments (no change); `util.send_inngest_event` (not managed).

---

## Task 3: Apply the migrations and regenerate types (DB write — ask first)

**Depends on:** Tasks 1, 2
**Files:**
- Modify (generated): `packages/database/src/types.ts`, swagger files written by `pnpm db:migrate`

**Steps:**
1. 🛑 Ask the user for permission to run `pnpm db:migrate` against the local database.
2. Run `pnpm db:migrate`. It applies both migrations, runs `authz sync`, and regenerates the types.
3. Run `pnpm run generate:types`.
4. Never edit `packages/database/src/types.ts` by hand.

**Verify:**
```bash
grep -n '"replenishmentLevel"' packages/database/src/types.ts | head -3
# Expected: at least one line (kanban Row and the kanbans view Row)
grep -n 'kanbanId: string | null' packages/database/src/types.ts | head -3
# Expected: at least one line (stockTransfer Row)
grep -n 'get_kanban_projected_quantities' packages/database/src/types.ts
# Expected: one Functions entry
pnpm --filter @carbon/database authz check
# Expected: 0 tables, 0 functions out of sync
```

**Out of scope:** `pnpm db:check:backups` (Task 19 runs it).

---

## Task 4: Add the SQL test script

**Depends on:** Task 3
**Files:**
- Create: `packages/database/supabase/tests/kanban-replenishment-level.test.sql`
- Copy from (precedent): `packages/database/supabase/tests/scheduled-job-sweeps.test.sql` (structure, `pg_temp.expect`, `BEGIN … ROLLBACK`)

**Steps:**
1. Start the file with the header comment and run command of the precedent, with this file's name.
2. Open with `\set ON_ERROR_STOP on`, `BEGIN;`, `SET LOCAL "app.sync_in_progress" = 'true';`, `SET LOCAL statement_timeout = '30s';`.
3. Copy `pg_temp.expect(label text, actual boolean, expected boolean)` from the precedent.
4. Borrow fixture rows in one `DO $proof$ … $proof$;` block:
   1. Select one pair of distinct `storageUnit` rows `a` and `b` with the same `companyId` and `locationId`.
   2. Select one `item` row of that company.
   3. If either select finds nothing, `RAISE EXCEPTION 'test needs a seeded company'`.
5. Insert a `kanban`: `replenishmentSystem = 'Transfer'`, From = `a`, To = `b`, `quantity = 5`, `replenishmentLevel = 10`, `createdBy = 'system'`.
6. Insert an `itemLedger` row: `entryType = 'Positive Adjmt.'`, `documentType = 'Inventory Receipt'`, at `b`, quantity 12.
7. Assert these, in order, with `pg_temp.expect`:
   1. `get_kanban_projected_quantities(companyId, ARRAY[kanbanId])` returns `projectedQuantity = 12`.
   2. `util.kanban_level_breaches()` has no row naming the kanban.
   3. Insert a ledger row of −3 at `b`. The breach set now names the kanban (projected 9).
   4. Insert a `stockTransfer` (`status = 'Released'`) with one `stockTransferLine` a → b, quantity 5. The breach set no longer names the kanban (projected 14).
   5. Set the line's `pickedQuantity = 5`. Insert ledger rows −5 at `a` and +5 at `b`. Projected stays 14.
   6. Set the transfer `status = 'Completed'`. Projected stays 14.
   7. Insert a second kanban with `replenishmentLevel = NULL`. The function returns no row for it.
   8. In a nested `BEGIN … EXCEPTION WHEN check_violation` block, update the first kanban to `fromStorageUnitId = storageUnitId`. Expect the exception.
   9. In a nested block, update the first kanban to `replenishmentLevel = -1`. Expect `check_violation`.
8. End the file with `ROLLBACK;`.

**Verify:** (DB write — ask first; the script rolls back)
```bash
pnpm exec tsx scripts/run-local-accounting-check.ts psql -X -v ON_ERROR_STOP=1 -f packages/database/supabase/tests/kanban-replenishment-level.test.sql
# Expected: exit 0, ROLLBACK, no ERROR line
```

If an insert fails on a missing NOT NULL column, read the table's `Insert` type in `packages/database/src/types.ts`. Add the column.

**Out of scope:** capturing `util.send_inngest_event` calls (no precedent; the browser test covers the send).

---

## Task 5: Add the pure stock-transfer helpers in `@carbon/database`

**Depends on:** Task 3
**Files:**
- Create: `packages/database/src/stock-transfer.ts`
- Create: `packages/database/src/stock-transfer.test.ts`
- Modify: `packages/database/package.json` — add the export `"./stock-transfer": "./src/stock-transfer.ts"` next to `"./sequence"`
- Copy from (precedent): `packages/database/src/supersession-pick.ts` and its test (pure module shape, relative `.ts` imports, `vitest`)

**Steps:**
1. Export this type and four values from `stock-transfer.ts`:
   ```ts
   export type StockTransferLineDraft = {
     itemId: string;
     fromStorageUnitId?: string | null;
     toStorageUnitId?: string | null;
     quantity?: number;
     requiresSerialTracking?: boolean;
     requiresBatchTracking?: boolean;
   };
   export function expandSerialTrackedLines<T extends StockTransferLineDraft>(lines: T[]): T[];
   export function isBelowReplenishmentLevel(projectedQuantity: number, replenishmentLevel: number): boolean;
   export const KANBAN_REPLENISHMENT_NOTE_PREFIX = "Kanban replenishment";
   export function kanbanReplenishmentNote(input: KanbanReplenishmentNoteInput): KanbanReplenishmentNote;
   ```
2. Copy the body of `expandSerialTrackedLines` from the `reduce` in `insertStockTransfer` (`apps/erp/app/modules/inventory/inventory.service.ts`, the `linesWithExpandedSerialTracking` block). Keep its behavior exactly:
   1. Drop a line whose `quantity` is set and not an integer.
   2. Split a serial-tracked line of quantity > 1 into that many lines of quantity 1.
   3. Keep every other line as it is.
3. Make `isBelowReplenishmentLevel` return `projectedQuantity < replenishmentLevel`. Strict, per spec Open Question 2.
4. Define the note input as a discriminated union on the signal:
   ```ts
   export type KanbanReplenishmentNoteInput = {
     itemReadableId: string;
     fromStorageUnitName: string;
     toStorageUnitName: string;
     quantity: number;
     unitOfMeasureCode: string | null;
     signal:
       | { type: "scan"; userName: string }
       | { type: "level"; replenishmentLevel: number; projectedQuantity: number };
   };
   ```
5. Return the Tiptap document `{ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] }`.
6. Build `text` in this form. Leave out the unit when `unitOfMeasureCode` is null.
   - Scan: `Kanban replenishment — MAT-KAPTON, A1-L3 → CleanRoom, 10 EA. Signal: scan by Jane Doe.`
   - Level: `Kanban replenishment — MAT-KAPTON, A1-L3 → CleanRoom, 10 EA. Signal: level 4 (projected 3).`
7. Write `String(n)` for each number. Do not round.
8. In the test file, cover these cases:
   1. Serial line of quantity 3 → 3 lines of quantity 1.
   2. Batch line of quantity 3 → 1 line of quantity 3.
   3. Untracked line of quantity 2.5 → dropped.
   4. `isBelowReplenishmentLevel(10, 10)` → false; `(9, 10)` → true.
   5. The scan note text and the level note text, each as one exact string.
   6. The note with `unitOfMeasureCode: null` has no trailing unit.

**Verify:**
```bash
pnpm --filter @carbon/database test -- stock-transfer
# Expected: all stock-transfer tests pass
pnpm exec turbo run typecheck --filter=@carbon/database
# Expected: 0 errors
```

**Out of scope:** formatting numbers by locale (the note is English free text, like the scan route's strings).

---

## Task 6: Switch `insertStockTransfer` to the shared helper

**Depends on:** Task 5
**Files:**
- Modify: `apps/erp/app/modules/inventory/inventory.service.ts` — `insertStockTransfer`

**Steps:**
1. Import `expandSerialTrackedLines` from `@carbon/database/stock-transfer`.
2. Replace the `linesWithExpandedSerialTracking` `reduce` with `const linesWithExpandedSerialTracking = expandSerialTrackedLines(lines);`.
3. Change nothing else in the function.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: 0 errors
```

**Out of scope:** moving `insertStockTransfer` into a server function (the wizard keeps its RLS path).

---

## Task 7: Declare the `carbon/kanban.level-check` event

**Depends on:** Task 3
**Files:**
- Modify: `packages/lib/src/events.ts` — the `Events` type
- Copy from (precedent): `packages/lib/src/events.ts:563-570` (events sent by Postgres)

**Steps:**
1. Add this entry next to `"carbon/workflow-run-retention.process"`:
   ```ts
   // Sent by the database (queue_kanban_level_checks, sync_kanban_level_check,
   // util.sweep_kanban_levels), never by app code. Every id is a Transfer
   // kanban whose projected quantity was below its replenishment level.
   "carbon/kanban.level-check": {
     data: { companyId: string; kanbanIds: string[] };
   };
   ```

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/lib
# Expected: 0 errors
```

**Out of scope:** `packages/lib/src/trigger.ts` (`taskToEvent`); no app code sends this event.

---

## Task 8: Add the `kanban-replenish` server function

**Depends on:** Tasks 5, 7
**Files:**
- Create: `packages/server-functions/src/kanban-replenish/index.ts`
- Modify: `packages/server-functions/src/invoke.ts` — add `"kanban-replenish": () => import("./kanban-replenish"),` in alphabetical order
- Modify (generated): `packages/server-functions/src/__snapshots__/permissions-manifest.test.ts.snap`
- Copy from (precedent): `packages/server-functions/src/seed-company/index.ts` (`permissions: "system"`), `packages/server-functions/src/issue/index.ts:802-819` (`getNextSequence` inside a transaction), `packages/server-functions/src/assign-serial-numbers/index.ts:85-99` (`.forUpdate()`)

**Steps:**
1. Declare the input schema:
   ```ts
   export const kanbanReplenishInput = z.discriminatedUnion("mode", [
     z.object({ mode: z.literal("scan"), kanbanId: z.string().min(1) }),
     z.object({ mode: z.literal("level"), kanbanIds: z.array(z.string().min(1)).optional() })
   ]);
   ```
2. Declare the reasons. The first three strings are the scan route's current error strings; keep them exact.
   ```ts
   export const KANBAN_REPLENISH_REASONS = {
     missingStorageUnit: "Kanban is missing a from or to storage unit",
     foreignStorageUnit: "Storage unit does not belong to the kanban location",
     missingItem: "Failed to get item",
     notTransfer: "Kanban is not a transfer kanban",
     notArmed: "Kanban has no replenishment level"
   } as const;
   ```
3. Declare the result type:
   ```ts
   export type KanbanReplenishOutcome =
     | { kanbanId: string; outcome: "created"; id: string; stockTransferId: string }
     | { kanbanId: string; outcome: "at-level"; projectedQuantity: number }
     | { kanbanId: string; outcome: "invalid"; reason: (typeof KANBAN_REPLENISH_REASONS)[keyof typeof KANBAN_REPLENISH_REASONS] };
   export type KanbanReplenishResult = { results: KanbanReplenishOutcome[] };
   ```
4. Define the function with `name: "kanban-replenish"`, `input: kanbanReplenishInput`, `permissions: "system"`. Add the comment: `// Both callers elevate: the scan route after requirePermissions, the job with no user.`
5. In `run(ctx, input)`, do the steps below in ONE `ctx.db.transaction().execute(async (trx) => { … })`. Read only on `trx`.
6. Lock the kanbans:
   1. Select `id, itemId, locationId, replenishmentSystem, replenishmentLevel, quantity, fromStorageUnitId, storageUnitId` from `kanban`.
   2. Filter `companyId = ctx.companyId`.
   3. In scan mode, filter `id = input.kanbanId`.
   4. In level mode with `kanbanIds`, filter `id in kanbanIds`. If `kanbanIds` is an empty array, return `{ results: [] }` before the query.
   5. In level mode with no `kanbanIds`, filter `replenishmentSystem = 'Transfer'` and `replenishmentLevel is not null`.
   6. Add `.orderBy("id").forUpdate()`. The order stops two calls from deadlocking.
7. If scan mode found no row, throw `NotFoundError("Kanban not found")`.
8. Classify each locked kanban. Stop at the first rule that matches:
   1. If `replenishmentSystem !== "Transfer"` → `invalid`, `notTransfer`.
   2. If either storage unit is null → `invalid`, `missingStorageUnit`.
   3. If level mode and `replenishmentLevel` is null → `invalid`, `notArmed`.
9. Read the storage units of the remaining kanbans in one query: `storageUnit` `id, name, locationId`, `companyId = ctx.companyId`, `id in [...]`.
10. If a kanban's From or To storage unit is absent, or its `locationId` differs from the kanban's, mark it `invalid`, `foreignStorageUnit`. This is the CWE-639 guard moved from the route.
11. In level mode, read projected quantity in one query:
    ```ts
    sql<{ kanbanId: string; replenishmentLevel: number; projectedQuantity: number }>`
      SELECT * FROM get_kanban_projected_quantities(${ctx.companyId}, ${ids}::text[])
    `.execute(trx)
    ```
12. For each remaining kanban, if `!isBelowReplenishmentLevel(projectedQuantity, replenishmentLevel)`, mark it `at-level`. Write nothing for it.
13. Read the items in one query: `item` `id, readableIdWithRevision, itemTrackingType, unitOfMeasureCode`, `companyId = ctx.companyId`, `id in [...]`. A missing item → `invalid`, `missingItem`.
14. In scan mode, read `user.fullName` for `ctx.userId`. Use `"unknown user"` if it is null.
15. For each kanban to replenish, in `id` order:
    1. Take `stockTransferId = await getNextSequence(trx, "stockTransfer", ctx.companyId)`.
    2. Build the note with `kanbanReplenishmentNote`. Use `readableIdWithRevision ?? itemId` for the item.
16. Insert every header in one statement into `stockTransfer`: `stockTransferId, locationId, status: "Released", companyId, kanbanId, notes, createdBy: ctx.userId`. Return `["id", "kanbanId", "stockTransferId"]`.
17. Build the lines with `expandSerialTrackedLines`, one draft per kanban:
    - `itemId`, `fromStorageUnitId`, `toStorageUnitId: storageUnitId`, `quantity`
    - `requiresSerialTracking: itemTrackingType === "Serial"`
    - `requiresBatchTracking: itemTrackingType === "Batch"`
18. Insert every line in one statement into `stockTransferLine`, with `stockTransferId` (the header `id`), `companyId` and `createdBy: ctx.userId`.
19. Return `{ results }` with one outcome per locked kanban, in `id` order.
20. Log each `created` outcome with `getLogger("server-functions", "kanban-replenish")`.
21. Export the function as the module default.
22. Run `pnpm --filter @carbon/server-functions exec vitest run -u src/permissions-manifest.test.ts`.
23. Review the snapshot diff. It must add only `"kanban-replenish": "system"`.

If Kysely refuses the Tiptap object for the `notes` JSON column, STOP and report.
If `getNextSequence` throws because the company has no `stockTransfer` sequence row, STOP and report.

**Verify:**
```bash
pnpm --filter @carbon/server-functions test
# Expected: pass, including permissions-manifest and invoke tests
pnpm exec turbo run typecheck --filter=@carbon/server-functions --concurrency=1
# Expected: 0 errors
```

**Out of scope:** storage-rule evaluation (spec Open Question 7); a shortage check on the From bin (Open Question 8); `n × quantity` catch-up (Open Question 3).

---

## Task 9: Add the live-database test for `kanban-replenish`

**Depends on:** Task 8
**Files:**
- Create: `packages/server-functions/src/kanban-replenish/kanban-test-fixture.ts`
- Create: `packages/server-functions/src/kanban-replenish/kanban-replenish.test.ts`
- Copy from (precedent): `packages/server-functions/src/post-payment/payment-test-fixture.ts` (scratch company, `cleanup()`), `packages/server-functions/src/post-memo/post-memo-transaction.test.ts` (`databaseTest`, `try … finally cleanup`)

**Steps:**
1. In the fixture, call `connectLocalTestDatabase()`.
2. Build a scratch company with a random prefix, as the precedent does.
3. Insert, in one transaction with `SET LOCAL "app.sync_in_progress" = 'true'`:
   1. `companyGroup` and `company` (copy from the precedent).
   2. One `location`.
   3. Two `storageUnit` rows at that location, `A` (From) and `B` (To).
   4. One untracked `item` with `readableId = "KB-TEST-ITEM"`.
   5. One `sequence` row for `stockTransfer`.
   6. One `kanban`: Transfer, A → B, `quantity = 5`, `replenishmentLevel = 10`.
4. Read every NOT NULL column without a default from the `Insert` types in `packages/database/src/types.ts`.
5. Return `{ db, companyId, kanbanId, fromId, toId, itemId, adjustToBin(delta), cleanup }`. `adjustToBin` inserts one `itemLedger` row of `delta` at `B`.
6. Copy `cleanup()` from the precedent: delete the company, the company group, and the per-company tables, then `db.destroy()`.
7. Call the function as the callers do: `serverFns.system({ db, companyId, userId: "system" }).invoke("kanban-replenish", …)`.
8. Write one `databaseTest` per case. Each one calls `cleanup()` in `finally`.
   1. `adjustToBin(12)`, level mode → `at-level`, no `stockTransfer` row.
   2. `adjustToBin(9)`, level mode → one `created`. Check the header: `kanbanId` set, `status = "Released"`, `createdBy = "system"`. Check the notes text starts `Kanban replenishment`. Check one line A → B for 5.
   3. Case 2, then level mode again → `at-level` (projected 14), still one header.
   4. Case 2, then set `pickedQuantity = 5` and post ledger rows −5 at A and +5 at B → level mode gives `at-level`.
   5. Case 4, then `adjustToBin(-6)` (projected 8) → one more `created`.
   6. `adjustToBin(12)`, scan mode → `created`; notes text contains `Signal: scan by`.
   7. Update the kanban to From = To → the update throws a check violation.
   8. A level-mode call with a `kanbanIds` entry from another company → no outcome for it.

**Verify:** (DB write — ask first; the fixture creates and deletes its own company)
```bash
pnpm --filter @carbon/server-functions test -- kanban-replenish
# Expected: 8 tests pass when SUPABASE_DB_URL is local; 8 skipped otherwise
```

**Out of scope:** two concurrent calls (the fixture has one connection; the `FOR UPDATE` lock is the guard).

---

## Task 10: Add the Inngest function `kanbanLevelCheckFunction`

**Depends on:** Task 8
**Files:**
- Create: `packages/jobs/src/inngest/functions/tasks/kanban-level-check.ts`
- Modify: `packages/jobs/src/inngest/functions/tasks/index.ts` — export it
- Modify: `packages/jobs/src/inngest/index.ts` — import it and add it to `functions` under `// Tasks`
- Copy from (precedent): `packages/jobs/src/inngest/functions/tasks/recalculate.ts`

**Steps:**
1. Write the function:
   ```ts
   export const kanbanLevelCheckFunction = inngest.createFunction(
     {
       id: "kanban-level-check",
       retries: 3,
       concurrency: { limit: 1, scope: "env", key: '"kanban-level:" + event.data.companyId' }
     },
     { event: "carbon/kanban.level-check" },
     async ({ event, step, logger }) => {
       const { companyId, kanbanIds } = event.data;
       const result = await step.run("replenish", () =>
         serverFns
           .system({ db: getJobDatabaseClient(), companyId, userId: "system" })
           .invokeOrThrow("kanban-replenish", { mode: "level", kanbanIds })
       );
       // log each created and each invalid outcome; return result
     }
   );
   ```
2. Do not add `debounce`. The local Inngest dev server cannot run it (`.ai/lessons.md:541`).
3. Log each `created` outcome with `logger.info`. Log each `invalid` outcome with `logger.warn`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/jobs
# Expected: 0 errors
pnpm --filter @carbon/jobs test
# Expected: pass
```

**Out of scope:** a cron trigger in Inngest (pg_cron owns the hourly sweep).

---

## Task 11: Route the scan through `kanban-replenish`

**Depends on:** Task 8
**Files:**
- Modify: `apps/erp/app/routes/api+/kanban.$id.tsx` — the `Transfer` branch (lines 351-428) and the imports

**Steps:**
1. Keep the `!kanban.data.itemId` guard and its error string.
2. Delete the storage-unit query, the item query and the `insertStockTransfer` call in this branch.
3. Call:
   ```ts
   const replenish = await serverFns
     .system({ db: getDatabaseClient(), companyId, userId })
     .invoke("kanban-replenish", { mode: "scan", kanbanId: id });
   ```
4. If `replenish.error` is set, log it and return `{ data: null, error: "Failed to create stock transfer" }`.
5. Read `const outcome = replenish.data.results[0]`.
6. If `outcome.outcome === "invalid"`, return `{ data: null, error: outcome.reason }`.
7. If `outcome.outcome === "created"`, return `{ data: path.to.stockTransfer(outcome.id), error: null }`.
8. Otherwise return `{ data: null, error: "Failed to create stock transfer" }`.
9. Remove `insertStockTransfer` from the `~/modules/inventory` import if nothing else in the file uses it.
10. Import `serverFns` from `@carbon/server-functions`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: 0 errors
```

**Out of scope:** the `Buy` and `Make` branches; the `role: "employee"` check in the loader.

---

## Task 12: Extend `kanbanValidator` and `upsertKanban`

**Depends on:** Task 3
**Files:**
- Modify: `apps/erp/app/modules/inventory/inventory.models.ts` — `kanbanValidator`
- Modify: `apps/erp/app/modules/inventory/inventory.service.ts` — `upsertKanban`
- Modify: `apps/erp/app/modules/inventory/inventory.models.test.ts`

**Steps:**
1. Add to the object: `replenishmentLevel: zfd.numeric(z.number().min(0, { message: "Replenishment level must be 0 or more" }).optional()),`.
2. Add one refine after the existing ones:
   ```ts
   .refine(
     (data) =>
       data.replenishmentSystem === "Transfer" || data.replenishmentLevel === undefined,
     {
       message: "Only a transfer kanban can have a replenishment level",
       path: ["replenishmentLevel"]
     }
   )
   ```
3. In `upsertKanban`, set the level on the row before the insert or update:
   ```ts
   const replenishmentLevel =
     row.replenishmentSystem === "Transfer" ? (row.replenishmentLevel ?? null) : null;
   ```
4. Spread `{ ...row, replenishmentLevel }` into both the `insert` and the `update`. A blank field then clears the level.
5. Add tests to `inventory.models.test.ts`:
   1. Transfer with level 10 → valid.
   2. Transfer with no level → valid.
   3. Buy with level 10 → error on `replenishmentLevel`.
   4. Transfer with level −1 → error on `replenishmentLevel`.

**Verify:**
```bash
pnpm --filter erp test -- inventory.models
# Expected: all tests pass
pnpm exec turbo run typecheck --filter=erp
# Expected: 0 errors
```

**Out of scope:** the `kanbans.new.tsx` and `kanbans.$id.tsx` actions (they pass the validated row through unchanged).

---

## Task 13: Add the glossary term

**Depends on:** Task 3
**Files:**
- Modify: `docs/content/src/glossary/terms.ts` — the `// ── Kanbans (KanbanForm) ──` block (around lines 916-935)
- Copy from (precedent): the `"kanban-auto-release"` entry in the same block

**Steps:**
1. Add:
   ```ts
   "kanban-replenishment-level": {
     term: msg`Replenishment Level`,
     definition: msg`On a transfer kanban, the minimum quantity for the To storage unit. When on-hand plus open inbound transfers drops below it, Carbon creates a Released stock transfer for the kanban quantity.`,
     href: "/docs/reference/kanban"
   },
   ```

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/content
# Expected: 0 errors
```

**Out of scope:** the `"replenishment-system"` term (Task 18 fixes its text).

---

## Task 14: Add the Replenishment Level field to `KanbanForm`

**Depends on:** Tasks 12, 13
**Files:**
- Modify: `apps/erp/app/modules/inventory/ui/Kanbans/KanbanForm.tsx`
- Copy from (precedent): the `Number` field with `termId` in `apps/erp/app/modules/accounting/ui/PaymentTerms/PaymentTermForm.tsx:127-133`

**Steps:**
1. Render the current Quantity field (lines 227-232) only when `!isTransfer`.
2. After the To Storage Unit field, when `isTransfer`, render:
   1. Quantity: `name="quantity"`, `minValue={1}`, helper text `The quantity moved from the From storage unit on each signal.`
   2. Replenishment Level: `Number`, `name="replenishmentLevel"`, `label={t\`Replenishment Level\`}`, `termId="kanban-replenishment-level"`, `minValue={0}`, helper text `When the projected quantity in the To storage unit drops below this level, a Released stock transfer for Quantity is created. Leave blank for scan-only.`
3. In `onItemChange` (lines 103-107), keep `Transfer` when the user already chose it:
   ```ts
   setSelectedReplenishmentSystem((current) =>
     current === "Transfer" ? current : item.data?.replenishmentSystem === "Make" ? "Make" : "Buy"
   );
   ```
4. Make sure `initialValues` carries `replenishmentLevel`. Check the two routes that render the form (`x+/inventory+/kanbans.new.tsx`, `kanbans.$id.tsx`). Pass `replenishmentLevel: kanban.replenishmentLevel ?? undefined` where the edit route builds `initialValues`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: 0 errors
pnpm run lint
# Expected: no new Biome errors
```

**Out of scope:** the field order of Buy and Make kanbans.

---

## Task 15: Show the level and projected quantity on the kanbans list

**Depends on:** Task 3
**Files:**
- Modify: `apps/erp/app/modules/inventory/inventory.service.ts` — add `getKanbanProjectedQuantities`
- Modify: `apps/erp/app/routes/x+/inventory+/kanbans.tsx` — the loader and the component
- Modify: `apps/erp/app/modules/inventory/ui/Kanbans/KanbansTable.tsx` — the props and two columns
- Copy from (precedent): the `quantity` column (`KanbansTable.tsx:388-405`), the `Status` pill in `apps/erp/app/modules/sales/ui/SalesRules/SalesRulesTable.tsx:114-126`, `useQuantityFormatter` from `~/hooks/useQuantityFormatter`

**Steps:**
1. Add the service function after `getKanban`:
   ```ts
   /** @mcp read */
   export async function getKanbanProjectedQuantities(
     client: SupabaseClient<Database>,
     companyId: string,
     kanbanIds: string[]
   ) {
     return client.rpc("get_kanban_projected_quantities", {
       company_id: companyId,
       kanban_ids: kanbanIds
     });
   }
   ```
2. In the loader, after `getKanbans`, collect the ids of rows with `replenishmentSystem === "Transfer"` and a non-null `replenishmentLevel`.
3. If the list is not empty, call `getKanbanProjectedQuantities` once.
4. If that call fails, log it and use an empty map. Do not fail the page.
5. Return `projectedQuantities: Record<string, number>` (kanban id → `projectedQuantity`).
6. Pass `projectedQuantities` to `KanbansTable` as a new prop.
7. Add a column after the `quantity` column: `accessorKey: "replenishmentLevel"`, header `t\`Replenishment Level\``, blank when null, `meta: { icon: <LuHash /> }`.
8. Add a column after it: `id: "projectedQuantity"`, header `t\`Projected (To)\``.
   1. If the row has no entry in `projectedQuantities`, render nothing.
   2. Otherwise render the number with `useQuantityFormatter`.
   3. If the number is below `replenishmentLevel`, also render `<Status color="red"><Trans>Below level</Trans></Status>`.
9. Run `pnpm run generate:mcp`. Keep the generated diff.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: 0 errors
git status --short | grep -i mcp
# Expected: the generated MCP metadata changed only by the new read tool
```

**Out of scope:** sorting or filtering on the projected column (it is not a table column).

---

## Task 16: Show the origin on stock transfers

**Depends on:** Task 3
**Files:**
- Modify: `apps/erp/app/modules/inventory/inventory.service.ts` — `getStockTransfers`
- Modify: `apps/erp/app/modules/inventory/ui/StockTransfers/StockTransfersTable.tsx` — a Source column
- Modify: `apps/erp/app/modules/inventory/ui/StockTransfers/StockTransferHeader.tsx` — a Kanban badge
- Copy from (precedent): `apps/erp/app/modules/workflows/workflows.service.ts:31-50` (derived filter), `apps/erp/app/modules/workflows/ui/WorkflowsTable.tsx:98-122` (derived column), `KanbansTable.tsx:141-158` (Badge around a Link)

**Steps:**
1. In `getStockTransfers`, split `args.filters` into `source` filters and column filters, as the precedent does.
2. For a `source` filter with value `Kanban`, add `query.not("kanbanId", "is", null)`.
3. For value `Manual`, add `query.is("kanbanId", null)`.
4. Pass only the column filters to `setGenericQueryFilters`.
5. Import `Filter` from `~/utils/query`.
6. In `StockTransfersTable`, add a column after `status`:
   - `id: "source"`, header `t\`Source\``
   - cell: `kanbanId` set → `<Badge variant="blue"><Trans>Kanban</Trans></Badge>`, else `<Badge variant="gray"><Trans>Manual</Trans></Badge>`
   - `meta.filter`: static options `Kanban` and `Manual`; `meta.filterHeader: t\`Source\``
   - `meta.exportValue`: `row.kanbanId ? "Kanban" : "Manual"`
7. In `StockTransferHeader`, after `<StockTransferStatus … />` (line 171), when `routeData?.stockTransfer?.kanbanId` is set, render:
   ```tsx
   <Badge variant="outline">
     <Link to={path.to.kanban(kanbanId)} className="flex flex-row items-center gap-1">
       <LuScanQrCode />
       <Trans>Kanban</Trans>
     </Link>
   </Badge>
   ```
8. Add `Link` to the `react-router` import. Import `LuScanQrCode` from `react-icons/lu`, the icon the Kanbans nav entry uses.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: 0 errors
```

**Out of scope:** `StockTransferNotes.tsx` (the note renders as any note); MES stock-transfer screens.

---

## Task 17: Print the level on the kanban label

**Depends on:** Task 3
**Files:**
- Modify: `packages/documents/src/pdf/KanbanLabelPDF.tsx` — `KanbanLabel` and the QTY block (lines 216-225)
- Modify: `apps/erp/app/routes/file+/kanban+/labels.$action[.]pdf.tsx` — the mapping (lines 93-106)
- Modify: `packages/jobs/src/inngest/functions/tasks/print-job/resolvers.ts` — `KanbanCardItem` (lines 10-23) and `resolveKanbanData` (lines 58-91)
- Modify: `packages/jobs/src/inngest/functions/tasks/print-job/renderers.tsx` — `renderKanbanCardPDF` (lines 220-240)

**Steps:**
1. Add `replenishmentLevel?: number | null;` to `KanbanLabel`.
2. If `label.replenishmentLevel` is not null, render a `<Text>` under the `QTY:` text. Use the same style.
3. Print `MIN: {label.replenishmentLevel}` plus the same unit suffix as `QTY:`.
4. In the label route mapping, add `replenishmentLevel: kanban.replenishmentLevel`.
5. In `KanbanCardItem`, add `replenishmentLevel: number | null;`.
6. In `resolveKanbanData`, map `replenishmentLevel: kanban.replenishmentLevel ?? null`.
7. In `renderKanbanCardPDF`, pass `replenishmentLevel: item.replenishmentLevel`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/documents --filter=@carbon/jobs --filter=erp
# Expected: 0 errors
```

**Out of scope:** the ZPL path (it throws for kanban cards today).

---

## Task 18: Update the docs, the kanban rule and the AGENTS files

**Depends on:** Tasks 8–17
**Files:**
- Modify: `docs/content/docs/reference/kanban.mdx`
- Modify: `docs/content/src/glossary/terms.ts` — the `"replenishment-system"` definition only if it names kanbans (leave it if it is about items only)
- Modify: `.claude/rules/kanban-system.md`
- Modify: `packages/server-functions/AGENTS.md` only if it lists functions by name
- Modify: `apps/erp/app/modules/inventory/AGENTS.md` — the kanban section, if it has one

**Steps:**
1. Load the `carbon-docs` skill before you edit `kanban.mdx`.
2. In `kanban.mdx`, fix the stale text:
   1. Line 3 description: name the stock transfer as the third outcome.
   2. Line 17: list `Buy`, `Make` and `Transfer`.
   3. Line 28 callout: delete the claim that the form offers only Buy and Make.
   4. The `StatusFlow` (lines 37-40): add `Transfer`.
3. Add fields: From storage unit, To storage unit, Replenishment level (`<Term>kanban replenishment level</Term>`).
4. Add one section, "Replenishment level", in at most 6 sentences. Cover these 5 facts:
   1. Projected quantity = on-hand + open inbound transfers.
   2. The signal fires strictly below the level.
   3. One signal creates one transfer of Quantity.
   4. Three paths wake the check: a stock movement, a kanban save, the hourly sweep.
   5. The transfer carries the "Kanban replenishment" note and shows Source `Kanban`.
5. State that the level path needs the Vault secret `inngest_event_url`, as every database-sent event does.
6. Add the label's `MIN:` line to the Output table row for Label.
7. Add the troubleshooting errors `"Kanban is missing a from or to storage unit"`, `"Storage unit does not belong to the kanban location"` and `"Only a transfer kanban can have a replenishment level"`.
8. In `.claude/rules/kanban-system.md`:
   1. Add `replenishmentLevel` to the data model and `kanban_transfer_distinct_storage_units_check` to its constraints.
   2. Add `stockTransfer.kanbanId`, `get_kanban_projected_quantities`, the two handlers and the sweep.
   3. Replace the Transfer scan bullet: the scan calls `kanban-replenish` with `mode: "scan"`.
   4. Add a "Level signal" section: the three wake paths, `kanbanLevelCheckFunction`, strict `<`, supply netting.
   5. Fix the stale `getKanban(client, kanbanId)` signature to `getKanban(client, kanbanId, companyId)`.
   6. Add the new files to the `paths:` frontmatter.
9. Do the STE-80 review pass on every changed `.ai/` file.

**Verify:**
```bash
pnpm --filter docs typecheck
# Expected: 0 errors
cd docs && for l in $(grep -oh "](/docs/[^)]*)" content/docs/reference/kanban.mdx | sed 's|](/docs/||;s|)||' | sort -u); do [ -f "content/docs/$l.mdx" ] || [ -f "content/docs/$l/index.mdx" ] || echo "MISSING $l"; done
# Expected: no MISSING line
```

**Out of scope:** a changelog entry (not requested); the MES docs.

---

## Task 19: Run the final gates and the browser test

**Depends on:** every other task
**Files:** none

**Steps:**
1. Run the scoped gates below.
2. 🛑 Ask the user before the browser test. Run it with `/test` only on a yes (memory: no browser unless asked).
3. Browser test, after `/auth`:
   1. Create a Transfer kanban: From bin A, To bin B, Quantity 5, Replenishment Level 10. Confirm the list shows the level and Projected (To).
   2. Post an inventory adjustment of +12 at B. Confirm no stock transfer appears.
   3. Post an adjustment of −3 at B. Within 1 minute, one Released stock transfer appears: Source `Kanban`, a note starting "Kanban replenishment", one line A → B for 5.
   4. Open it. Confirm the Kanban badge opens the kanban.
   5. Post a second −3 at B. Confirm no second transfer appears.
   6. Pick and post the line in full. Confirm no new transfer appears.
   7. Scan the kanban's order URL. Confirm a transfer appears with "Signal: scan by".
   8. Print the label. Confirm `MIN: 10` under `QTY: 5`.
4. If step 3.3 shows no transfer, check the Inngest dev server for `kanban-level-check`. If no event arrived, check the Vault secret `inngest_event_url`. Report; do not change code to work around it.
5. Run `/self-review` on the branch.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp --filter=@carbon/database --filter=@carbon/server-functions --filter=@carbon/jobs --filter=@carbon/documents --filter=@carbon/lib
# Expected: 0 errors
pnpm run lint
# Expected: 0 errors
pnpm --filter @carbon/database test && pnpm --filter @carbon/server-functions test && pnpm --filter @carbon/jobs test && pnpm --filter erp test
# Expected: all pass
pnpm --filter @carbon/checks test
# Expected: pass (spdx-license-header, no-authz-ddl-in-migrations, no-raw-rounding)
pnpm db:check:backups
# Expected: existing backups still restore (DB read — ask first)
```

**Out of scope:** pushing the branch; opening the PR; the demo datasets (their Transfer kanbans stay scan-only).
