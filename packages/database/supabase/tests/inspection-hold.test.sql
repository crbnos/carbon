-- Goods-in inspection hold (spec .ai/specs/2026-11-03-goods-in-inspection-hold.md):
-- the check_inspection_hold guard on itemLedger, inspection_held_quantity, and
-- the receipt."inspectionStatus" roll-up (sync_receipt_inspection_status).
-- Run from the repository root against an existing local database that has at
-- least one company with a user, a location and an untracked (Inventory) item:
-- pnpm exec tsx scripts/run-local-accounting-check.ts psql -X -v ON_ERROR_STOP=1 -f packages/database/supabase/tests/inspection-hold.test.sql
-- Every fixture row is confined to the rolled-back transaction.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL statement_timeout = '30s';

CREATE FUNCTION pg_temp.expect(label text, actual text, expected text)
RETURNS void LANGUAGE plpgsql AS $fn$
BEGIN
  IF actual IS DISTINCT FROM expected THEN
    RAISE EXCEPTION '%: expected %, got %', label, expected, actual;
  END IF;
END;
$fn$;

-- Inserts one ledger row and reports whether the guard refused it.
CREATE FUNCTION pg_temp.refused(
  p_company text, p_item text, p_location text, p_unit text,
  p_entity text, p_quantity numeric, p_user text
) RETURNS boolean LANGUAGE plpgsql AS $fn$
BEGIN
  BEGIN
    INSERT INTO "itemLedger" (
      "entryType", "documentType", "itemId", "locationId", "storageUnitId",
      "trackedEntityId", "quantity", "companyId", "createdBy"
    ) VALUES (
      'Negative Adjmt.', 'Direct Transfer', p_item, p_location, p_unit,
      p_entity, p_quantity, p_company, p_user
    );
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE '%held for inspection%' THEN
      RAISE;
    END IF;
    RETURN true;
  END;
  RETURN false;
END;
$fn$;

DO $proof$
DECLARE
  company text;
  location text;
  usr text;
  item text;
  unit text;
  rcpt text;
  rline text;
  lot text;
  entity text;
  transfer text;
BEGIN
  -- Reach the guard: the session may arrive with the sync flag on.
  PERFORM set_config('app.sync_in_progress', 'false', true);
  PERFORM set_config('app.inspection_release', '', true);

  SELECT l."companyId", l."id", uc."userId", i."id"
  INTO company, location, usr, item
  FROM "location" l
  JOIN "userToCompany" uc ON uc."companyId" = l."companyId"
  JOIN "item" i ON i."companyId" = l."companyId" AND i."itemTrackingType" = 'Inventory'
  ORDER BY l."companyId", l."id", uc."userId", i."id"
  LIMIT 1;
  IF item IS NULL THEN
    RAISE EXCEPTION 'test needs a seeded company with an Inventory item';
  END IF;

  INSERT INTO "storageUnit" ("name", "locationId", "companyId", "createdBy", "nettable")
  VALUES ('QC-HOLD-TEST-' || substr(md5(random()::text), 1, 8), location, company, usr, false)
  RETURNING "id" INTO unit;

  INSERT INTO "receipt" ("receiptId", "companyId", "createdBy", "locationId", "sourceDocument", "status")
  VALUES ('RE-HOLD-TEST', company, usr, location, 'Purchase Order', 'Posted')
  RETURNING "id" INTO rcpt;
  INSERT INTO "receiptLine" ("receiptId", "itemId", "locationId", "storageUnitId", "companyId", "createdBy", "requiresInspection", "orderQuantity", "unitOfMeasure", "unitPrice")
  VALUES (rcpt, item, location, unit, company, usr, true, 100, 'EA', 0)
  RETURNING "id" INTO rline;

  -- 120 on hand at the unit: 100 received under inspection, 20 unrelated.
  INSERT INTO "itemLedger" ("entryType", "documentType", "itemId", "locationId", "storageUnitId", "quantity", "companyId", "createdBy")
  VALUES ('Positive Adjmt.', 'Purchase Receipt', item, location, unit, 120, company, usr);

  PERFORM pg_temp.expect('no lot yet',
    (SELECT "inspectionStatus"::text FROM "receipt" WHERE "id" = rcpt), 'Not Required');

  INSERT INTO "inspection" (
    "inspectionId", "itemId", "lotSize", "samplingStandard", "samplingPlanType",
    "sampleSize", "acceptanceNumber", "rejectionNumber", "companyId", "createdBy",
    "sourceDocument", "sourceDocumentId", "sourceDocumentLineId", "storageUnitId", "status"
  ) VALUES (
    'INS-HOLD-TEST', item, 100, 'ANSI_Z1_4', 'All', 100, 0, 1, company, usr,
    'Receipt', rcpt, rline, unit, 'Pending'
  ) RETURNING "id" INTO lot;

  PERFORM pg_temp.expect('roll-up: pending lot',
    (SELECT "inspectionStatus"::text FROM "receipt" WHERE "id" = rcpt), 'Pending Inspection');
  PERFORM pg_temp.expect('held quantity of an open lot',
    public.inspection_held_quantity(company, item, unit)::text, '100');

  -- 1. Taking 30 would leave 90 < 100 held.
  PERFORM pg_temp.expect('a move into the held quantity is refused',
    pg_temp.refused(company, item, location, unit, NULL, -30, usr)::text, 'true');
  -- 2. The 20 unrelated units can move.
  PERFORM pg_temp.expect('free stock in the same unit moves',
    pg_temp.refused(company, item, location, unit, NULL, -20, usr)::text, 'false');
  -- 3. A release posting passes the guard.
  PERFORM set_config('app.inspection_release', 'on', true);
  PERFORM pg_temp.expect('a release posting passes',
    pg_temp.refused(company, item, location, unit, NULL, -1, usr)::text, 'false');
  PERFORM set_config('app.inspection_release', '', true);
  -- Put the released unit back so 100 sit at the unit again.
  INSERT INTO "itemLedger" ("entryType", "documentType", "itemId", "locationId", "storageUnitId", "quantity", "companyId", "createdBy")
  VALUES ('Positive Adjmt.', 'Direct Transfer', item, location, unit, 1, company, usr);

  -- 4. An On Hold unit cannot leave, whatever the bin.
  INSERT INTO "trackedEntity" ("quantity", "sourceDocument", "sourceDocumentId", "companyId", "createdBy", "status", "itemId")
  VALUES (1, 'Receipt', rcpt, company, usr, 'On Hold', item)
  RETURNING "id" INTO entity;
  PERFORM pg_temp.expect('an On Hold unit is refused',
    pg_temp.refused(company, item, location, NULL, entity, -1, usr)::text, 'true');
  UPDATE "trackedEntity" SET "status" = 'Available' WHERE "id" = entity;
  PERFORM pg_temp.expect('an Available unit moves',
    pg_temp.refused(company, item, location, NULL, entity, -1, usr)::text, 'false');

  -- The first recorded sample moves the receipt on.
  UPDATE "inspection" SET "status" = 'In Progress' WHERE "id" = lot;
  PERFORM pg_temp.expect('roll-up: in progress',
    (SELECT "inspectionStatus"::text FROM "receipt" WHERE "id" = rcpt), 'Inspection In Progress');

  -- 6. A Partial lot holds its rejected remainder while no NCR has closed.
  UPDATE "inspection" SET "status" = 'Partial', "acceptedQuantity" = 92 WHERE "id" = lot;
  PERFORM pg_temp.expect('a Partial lot holds its remainder',
    public.inspection_held_quantity(company, item, unit)::text, '8');
  PERFORM pg_temp.expect('roll-up: partial',
    (SELECT "inspectionStatus"::text FROM "receipt" WHERE "id" = rcpt), 'Partially Passed');
  PERFORM pg_temp.expect('the accepted quantity moves',
    pg_temp.refused(company, item, location, unit, NULL, -92, usr)::text, 'false');
  PERFORM pg_temp.expect('the remainder stays held',
    pg_temp.refused(company, item, location, unit, NULL, -1, usr)::text, 'true');
  INSERT INTO "itemLedger" ("entryType", "documentType", "itemId", "locationId", "storageUnitId", "quantity", "companyId", "createdBy")
  VALUES ('Positive Adjmt.', 'Direct Transfer', item, location, unit, 92, company, usr);

  -- 5. A Passed lot holds nothing.
  UPDATE "inspection" SET "status" = 'Passed', "acceptedQuantity" = NULL WHERE "id" = lot;
  PERFORM pg_temp.expect('a Passed lot holds nothing',
    public.inspection_held_quantity(company, item, unit)::text, '0');
  PERFORM pg_temp.expect('roll-up: passed',
    (SELECT "inspectionStatus"::text FROM "receipt" WHERE "id" = rcpt), 'Inspection Passed');
  PERFORM pg_temp.expect('a passed lot moves freely',
    pg_temp.refused(company, item, location, unit, NULL, -50, usr)::text, 'false');

  -- 7. A completed putaway transfer that covers the passed quantity.
  INSERT INTO "stockTransfer" ("stockTransferId", "locationId", "companyId", "createdBy", "status", "receiptId")
  VALUES ('ST-HOLD-TEST', location, company, usr, 'Released', rcpt)
  RETURNING "id" INTO transfer;
  INSERT INTO "stockTransferLine" ("stockTransferId", "itemId", "companyId", "createdBy", "quantity", "pickedQuantity", "receiptLineId", "fromStorageUnitId")
  VALUES (transfer, item, company, usr, 100, 100, rline, unit);
  UPDATE "stockTransfer" SET "status" = 'Completed' WHERE "id" = transfer AND "status" <> 'Completed';
  PERFORM pg_temp.expect('roll-up: put away',
    (SELECT "inspectionStatus"::text FROM "receipt" WHERE "id" = rcpt), 'Put Away');

  -- A cancelled lot is ignored by the roll-up and holds nothing.
  UPDATE "inspection" SET "status" = 'Cancelled' WHERE "id" = lot;
  PERFORM pg_temp.expect('roll-up: cancelled lot',
    (SELECT "inspectionStatus"::text FROM "receipt" WHERE "id" = rcpt), 'Not Required');

  RAISE NOTICE 'inspection-hold: all checks passed';
END;
$proof$;

ROLLBACK;
