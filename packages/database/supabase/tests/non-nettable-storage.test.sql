-- Non-nettable storage (20261029090412_non-nettable-storage.sql and the
-- storage unit / storage type interceptors): which units are non-nettable, and
-- itemStockQuantities."quantityNonNettable" as stock moves and flags change.
-- Run from the repository root against an existing local database that has at
-- least one company with a user, a location and an item:
-- pnpm exec tsx scripts/run-local-accounting-check.ts psql -X -v ON_ERROR_STOP=1 -f packages/database/supabase/tests/non-nettable-storage.test.sql
-- Every fixture row is confined to the rolled-back transaction.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL statement_timeout = '30s';

CREATE FUNCTION pg_temp.expect(label text, actual numeric, expected numeric)
RETURNS void LANGUAGE plpgsql AS $fn$
BEGIN
  IF actual IS DISTINCT FROM expected THEN
    RAISE EXCEPTION '%: expected %, got %', label, expected, actual;
  END IF;
END;
$fn$;

CREATE FUNCTION pg_temp.expect_bool(label text, actual boolean, expected boolean)
RETURNS void LANGUAGE plpgsql AS $fn$
BEGIN
  IF actual IS DISTINCT FROM expected THEN
    RAISE EXCEPTION '%: expected %, got %', label, expected, actual;
  END IF;
END;
$fn$;

CREATE FUNCTION pg_temp.check(
  label text, on_hand numeric, non_nettable numeric,
  p_item text, p_location text, p_base_on_hand numeric, p_base_non_nettable numeric
) RETURNS void LANGUAGE plpgsql AS $fn$
DECLARE
  actual_on_hand numeric;
  actual_non_nettable numeric;
BEGIN
  SELECT isq."quantityOnHand", isq."quantityNonNettable"
  INTO actual_on_hand, actual_non_nettable
  FROM "itemStockQuantities" isq
  WHERE isq."itemId" = p_item AND isq."locationId" = p_location;
  PERFORM pg_temp.expect(label || ' (on hand)', actual_on_hand - p_base_on_hand, on_hand);
  PERFORM pg_temp.expect(label || ' (non-nettable)', actual_non_nettable - p_base_non_nettable, non_nettable);
END;
$fn$;

DO $proof$
DECLARE
  company text;
  location text;
  usr text;
  item text;
  base_on_hand numeric;
  base_non_nettable numeric;
  t text;
  a text;
  b text;
  c text;
  e text;
BEGIN
  SELECT l."companyId", l."id", uc."userId", i."id"
  INTO company, location, usr, item
  FROM "location" l
  JOIN "userToCompany" uc ON uc."companyId" = l."companyId"
  JOIN "item" i ON i."companyId" = l."companyId"
  ORDER BY l."companyId", l."id", uc."userId", i."id"
  LIMIT 1;

  IF item IS NULL THEN
    RAISE EXCEPTION 'test needs a seeded company';
  END IF;

  -- The item may already have stock at the location; every check is relative.
  SELECT COALESCE(isq."quantityOnHand", 0), COALESCE(isq."quantityNonNettable", 0)
  INTO base_on_hand, base_non_nettable
  FROM (SELECT 1) one
  LEFT JOIN "itemStockQuantities" isq
    ON isq."itemId" = item AND isq."locationId" = location;


  INSERT INTO "storageType" ("name", "companyId", "createdBy")
  VALUES ('Non-nettable test', company, usr)
  RETURNING "id" INTO t;

  INSERT INTO "storageUnit" ("name", "locationId", "companyId", "createdBy")
  VALUES ('NN-TEST-A', location, company, usr) RETURNING "id" INTO a;
  INSERT INTO "storageUnit" ("name", "locationId", "companyId", "createdBy", "parentId")
  VALUES ('NN-TEST-B', location, company, usr, a) RETURNING "id" INTO b;
  INSERT INTO "storageUnit" ("name", "locationId", "companyId", "createdBy", "storageTypeIds")
  VALUES ('NN-TEST-C', location, company, usr, ARRAY[t]) RETURNING "id" INTO c;

  INSERT INTO "itemLedger"
    ("entryType", "documentType", "itemId", "locationId", "storageUnitId", "quantity", "companyId", "createdBy")
  VALUES
    ('Positive Adjmt.', 'Inventory Receipt', item, location, a, 10, company, usr),
    ('Positive Adjmt.', 'Inventory Receipt', item, location, b, 5, company, usr),
    ('Positive Adjmt.', 'Inventory Receipt', item, location, c, 3, company, usr);

  PERFORM pg_temp.check('1. every unit nettable', 18, 0, item, location, base_on_hand, base_non_nettable);

  -- 2. A parent's flag reaches its child.
  UPDATE "storageUnit" SET "nettable" = false WHERE "id" = a;
  PERFORM pg_temp.expect_bool('2. child inherits', (SELECT "effectiveNettable" FROM "storageUnit" WHERE "id" = b), false);
  PERFORM pg_temp.check('2. parent off', 18, 15, item, location, base_on_hand, base_non_nettable);

  -- 3. Stock received into a non-nettable unit is non-nettable.
  INSERT INTO "itemLedger"
    ("entryType", "documentType", "itemId", "locationId", "storageUnitId", "quantity", "companyId", "createdBy")
  VALUES ('Positive Adjmt.', 'Inventory Receipt', item, location, b, 4, company, usr);
  PERFORM pg_temp.check('3. receipt into the child', 22, 19, item, location, base_on_hand, base_non_nettable);

  -- 4. A storage type's flag reaches its units.
  UPDATE "storageType" SET "nettable" = false WHERE "id" = t;
  PERFORM pg_temp.check('4. type off', 22, 22, item, location, base_on_hand, base_non_nettable);

  -- 4b. A unit inserted with a non-nettable type is non-nettable at once.
  INSERT INTO "storageUnit" ("name", "locationId", "companyId", "createdBy", "storageTypeIds")
  VALUES ('NN-TEST-D', location, company, usr, ARRAY[t]) RETURNING "id" INTO e;
  PERFORM pg_temp.expect_bool('4b. inserted with a non-nettable type',
    (SELECT "effectiveNettable" FROM "storageUnit" WHERE "id" = e), false);

  -- 5. Back on.
  UPDATE "storageUnit" SET "nettable" = true WHERE "id" = a;
  PERFORM pg_temp.check('5. parent on', 22, 3, item, location, base_on_hand, base_non_nettable);

  -- 6. Moving a unit under a non-nettable parent.
  UPDATE "storageUnit" SET "parentId" = c WHERE "id" = b;
  PERFORM pg_temp.check('6. moved under C', 22, 12, item, location, base_on_hand, base_non_nettable);

  -- 7. Deleting a non-nettable unit releases its stock (it becomes unassigned).
  DELETE FROM "storageUnit" WHERE "id" = b;
  PERFORM pg_temp.check('7. unit deleted', 22, 3, item, location, base_on_hand, base_non_nettable);

  -- 8. Taking the type off a unit, and deleting the type.
  UPDATE "storageUnit" SET "storageTypeIds" = ARRAY[]::TEXT[] WHERE "id" = c;
  PERFORM pg_temp.check('8. type removed from C', 22, 0, item, location, base_on_hand, base_non_nettable);
  UPDATE "storageUnit" SET "storageTypeIds" = ARRAY[t] WHERE "id" = c;
  PERFORM pg_temp.check('8. type added back', 22, 3, item, location, base_on_hand, base_non_nettable);
  DELETE FROM "storageType" WHERE "id" = t;
  PERFORM pg_temp.check('8. type deleted', 22, 0, item, location, base_on_hand, base_non_nettable);

  -- 9. A direct write of the derived flag is recomputed back.
  UPDATE "storageUnit" SET "effectiveNettable" = false WHERE "id" = a;
  PERFORM pg_temp.expect_bool('9. tampered flag corrected', (SELECT "effectiveNettable" FROM "storageUnit" WHERE "id" = a), true);
  PERFORM pg_temp.check('9. tampered flag', 22, 0, item, location, base_on_hand, base_non_nettable);

  -- 10. A flip recomputes the total, so an earlier drift is repaired.
  UPDATE "itemStockQuantities" SET "quantityNonNettable" = 999
  WHERE "itemId" = item AND "locationId" = location;
  UPDATE "storageUnit" SET "nettable" = false WHERE "id" = a;
  PERFORM pg_temp.check('10. drift repaired by a flip', 22, 10, item, location, base_on_hand, base_non_nettable);

  -- 11. A child inserted under a non-nettable unit is non-nettable.
  INSERT INTO "storageUnit" ("name", "locationId", "companyId", "createdBy", "parentId")
  VALUES ('NN-TEST-E', location, company, usr, a) RETURNING "id" INTO e;
  PERFORM pg_temp.expect_bool('11. inserted child', (SELECT "effectiveNettable" FROM "storageUnit" WHERE "id" = e), false);

  -- 12. Picking sources and the nightly reconcile agree.
  PERFORM pg_temp.expect_bool('12. a non-nettable unit is not a pick source',
    EXISTS (SELECT 1 FROM get_warehouse_storage_unit_ids(ARRAY[a, c]) w WHERE w."storageUnitId" = a), false);
  PERFORM pg_temp.expect_bool('12. a nettable unit is a pick source',
    EXISTS (SELECT 1 FROM get_warehouse_storage_unit_ids(ARRAY[a, c]) w WHERE w."storageUnitId" = c),
    get_effective_work_center_id(c) IS NULL);
  PERFORM pg_temp.expect_bool('12. no unit is nettable', storage_unit_is_nettable(NULL), true);
END;
$proof$;

ROLLBACK;
