-- Clear work centers left on Outside Processing operations.
--
-- Outside Processing runs at the supplier, so it has no work center: the
-- operation forms hide the field for that type. But the field was simply
-- omitted from the update, so a work center set while the operation was
-- in-house survived the switch to Outside Processing. The writers now clear it
-- (normalizeOperationSourceIds); this removes the ones already stored.
--
-- Method and quote operations are templates: a stale value there is copied
-- onto every job made from them, so all are cleared. Job operations are cleared
-- only while open — a finished one keeps the row as it was run (its production
-- events carry their own workCenterId either way) — and only outside a batch:
-- a batch member's workCenterId mirrors its batch header (batch-operations
-- keeps the two equal), so clearing the member alone would split them.

UPDATE "methodOperation"
SET "workCenterId" = NULL
WHERE "operationType" = 'Outside Processing'
  AND "workCenterId" IS NOT NULL;

UPDATE "quoteOperation"
SET "workCenterId" = NULL
WHERE "operationType" = 'Outside Processing'
  AND "workCenterId" IS NOT NULL;

UPDATE "jobOperation"
SET "workCenterId" = NULL
WHERE "operationType" = 'Outside Processing'
  AND "workCenterId" IS NOT NULL
  AND "status" NOT IN ('Done', 'Canceled')
  AND "jobOperationBatchId" IS NULL;
