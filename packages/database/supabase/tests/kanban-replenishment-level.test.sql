-- The kanban replenishment level (20261009142613_kanban-replenishment-level.sql):
-- the projected quantity at a Transfer kanban's To storage unit, the backstop
-- breach set, and the two CHECK constraints on the kanban.
-- Run from the repository root against an existing local database that has at
-- least one company with two storage units at one location and one item:
-- pnpm exec tsx scripts/run-local-accounting-check.ts psql -X -v ON_ERROR_STOP=1 -f packages/database/supabase/tests/kanban-replenishment-level.test.sql
-- Every fixture row is confined to the rolled-back transaction.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL "app.sync_in_progress" = 'true';
SET LOCAL statement_timeout = '30s';

CREATE FUNCTION pg_temp.expect(label text, actual boolean, expected boolean)
RETURNS void LANGUAGE plpgsql AS $fn$
BEGIN
  IF actual IS DISTINCT FROM expected THEN
    RAISE EXCEPTION '%: expected %, got %', label, expected, actual;
  END IF;
END;
$fn$;

DO $proof$
DECLARE
  company text;
  location text;
  a text;
  b text;
  item text;
  kanban_id text;
  scan_only_id text;
  transfer_id text;
  line_id text;
  raised boolean;
BEGIN
  -- Fixture: two storage units at one location, and an item with no stock
  -- and no inbound transfer at the To unit, so the projection starts at 0.
  SELECT sa."companyId", sa."locationId", sa."id", sb."id", i."id"
  INTO company, location, a, b, item
  FROM "storageUnit" sa
  JOIN "storageUnit" sb
    ON sb."companyId" = sa."companyId"
   AND sb."locationId" = sa."locationId"
   AND sb."id" <> sa."id"
  JOIN "item" i ON i."companyId" = sa."companyId"
  WHERE NOT EXISTS (
      SELECT 1 FROM "itemLedger" il
      WHERE il."itemId" = i."id" AND il."storageUnitId" = sb."id"
    )
    AND NOT EXISTS (
      SELECT 1 FROM "stockTransferLine" stl
      WHERE stl."itemId" = i."id" AND stl."toStorageUnitId" = sb."id"
    )
  ORDER BY sa."companyId", sa."id", sb."id", i."id"
  LIMIT 1;

  IF a IS NULL OR b IS NULL OR item IS NULL THEN
    RAISE EXCEPTION 'test needs a seeded company';
  END IF;

  INSERT INTO "kanban"
    ("itemId", "replenishmentSystem", "quantity", "locationId", "storageUnitId",
     "fromStorageUnitId", "replenishmentLevel", "companyId", "createdBy")
  VALUES (item, 'Transfer', 5, location, b, a, 10, company, 'system')
  RETURNING "id" INTO kanban_id;

  INSERT INTO "itemLedger"
    ("entryType", "documentType", "itemId", "locationId", "storageUnitId", "quantity", "companyId", "createdBy")
  VALUES ('Positive Adjmt.', 'Inventory Receipt', item, location, b, 12, company, 'system');

  -- 1. On-hand 12, nothing inbound.
  PERFORM pg_temp.expect('projected: 12 on hand',
    (SELECT "projectedQuantity" = 12
     FROM get_kanban_projected_quantities(company, ARRAY[kanban_id])), true);

  -- 2. 12 is not below 10.
  PERFORM pg_temp.expect('breaches: not below the level',
    EXISTS (SELECT 1 FROM util.kanban_level_breaches() br
            WHERE kanban_id = ANY (br."kanbanIds")), false);

  -- 3. Consume 3: projected 9 is below 10.
  INSERT INTO "itemLedger"
    ("entryType", "documentType", "itemId", "locationId", "storageUnitId", "quantity", "companyId", "createdBy")
  VALUES ('Negative Adjmt.', 'Inventory Receipt', item, location, b, -3, company, 'system');

  PERFORM pg_temp.expect('breaches: projected 9 is below 10',
    EXISTS (SELECT 1 FROM util.kanban_level_breaches() br
            WHERE kanban_id = ANY (br."kanbanIds")), true);

  -- 4. A Released transfer of 5 to b: projected 14.
  INSERT INTO "stockTransfer"
    ("stockTransferId", "locationId", "status", "companyId", "createdBy", "kanbanId")
  VALUES ('KB-TEST-1', location, 'Released', company, 'system', kanban_id)
  RETURNING "id" INTO transfer_id;

  INSERT INTO "stockTransferLine"
    ("stockTransferId", "itemId", "fromStorageUnitId", "toStorageUnitId", "quantity", "companyId", "createdBy")
  VALUES (transfer_id, item, a, b, 5, company, 'system')
  RETURNING "id" INTO line_id;

  PERFORM pg_temp.expect('projected: 9 on hand + 5 inbound',
    (SELECT "projectedQuantity" = 14
     FROM get_kanban_projected_quantities(company, ARRAY[kanban_id])), true);
  PERFORM pg_temp.expect('breaches: inbound transfer covers the level',
    EXISTS (SELECT 1 FROM util.kanban_level_breaches() br
            WHERE kanban_id = ANY (br."kanbanIds")), false);

  -- 5. Pick the line: the 5 move from inbound to on-hand.
  UPDATE "stockTransferLine" SET "pickedQuantity" = 5 WHERE "id" = line_id;
  INSERT INTO "itemLedger"
    ("entryType", "documentType", "itemId", "locationId", "storageUnitId", "quantity", "companyId", "createdBy")
  VALUES
    ('Transfer', 'Direct Transfer', item, location, a, -5, company, 'system'),
    ('Transfer', 'Direct Transfer', item, location, b, 5, company, 'system');

  PERFORM pg_temp.expect('projected: picked line counts once',
    (SELECT "projectedQuantity" = 14
     FROM get_kanban_projected_quantities(company, ARRAY[kanban_id])), true);

  -- 6. Completing the transfer changes nothing.
  UPDATE "stockTransfer" SET "status" = 'Completed' WHERE "id" = transfer_id;

  PERFORM pg_temp.expect('projected: completed transfer',
    (SELECT "projectedQuantity" = 14
     FROM get_kanban_projected_quantities(company, ARRAY[kanban_id])), true);

  -- 7. A scan-only kanban (no level) is not projected.
  INSERT INTO "kanban"
    ("itemId", "replenishmentSystem", "quantity", "locationId", "storageUnitId",
     "fromStorageUnitId", "replenishmentLevel", "companyId", "createdBy")
  VALUES (item, 'Transfer', 5, location, b, a, NULL, company, 'system')
  RETURNING "id" INTO scan_only_id;

  PERFORM pg_temp.expect('projected: scan-only kanban has no row',
    EXISTS (SELECT 1 FROM get_kanban_projected_quantities(company, ARRAY[scan_only_id])), false);

  -- 8. A Transfer kanban must not feed itself.
  raised := false;
  BEGIN
    UPDATE "kanban" SET "fromStorageUnitId" = "storageUnitId" WHERE "id" = kanban_id;
  EXCEPTION WHEN check_violation THEN
    raised := true;
  END;
  PERFORM pg_temp.expect('check: from = to is refused', raised, true);

  -- 9. The level cannot be negative.
  raised := false;
  BEGIN
    UPDATE "kanban" SET "replenishmentLevel" = -1 WHERE "id" = kanban_id;
  EXCEPTION WHEN check_violation THEN
    raised := true;
  END;
  PERFORM pg_temp.expect('check: negative level is refused', raised, true);
END;
$proof$;

ROLLBACK;
