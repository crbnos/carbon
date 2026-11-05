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

-- One INSERT of several untracked rows, refused or kept as a whole.
CREATE FUNCTION pg_temp.refused_many(
  p_company text, p_item text, p_location text, p_unit text,
  p_quantities numeric[], p_user text
) RETURNS boolean LANGUAGE plpgsql AS $fn$
BEGIN
  BEGIN
    INSERT INTO "itemLedger" (
      "entryType", "documentType", "itemId", "locationId", "storageUnitId",
      "quantity", "companyId", "createdBy"
    )
    SELECT 'Negative Adjmt.', 'Direct Transfer', p_item, p_location, p_unit,
      q, p_company, p_user
    FROM unnest(p_quantities) AS q;
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE '%held for inspection%' THEN
      RAISE;
    END IF;
    RETURN true;
  END;
  RETURN false;
END;
$fn$;

-- One INSERT of untracked rows at several units, refused or kept as a whole.
CREATE FUNCTION pg_temp.refused_rows(
  p_company text, p_item text, p_location text, p_units text[],
  p_quantities numeric[], p_user text
) RETURNS boolean LANGUAGE plpgsql AS $fn$
BEGIN
  BEGIN
    INSERT INTO "itemLedger" (
      "entryType", "documentType", "itemId", "locationId", "storageUnitId",
      "quantity", "companyId", "createdBy"
    )
    SELECT
      CASE WHEN r.q < 0 THEN 'Negative Adjmt.' ELSE 'Positive Adjmt.' END::"itemLedgerType",
      'Direct Transfer', p_item, p_location, r.u, r.q, p_company, p_user
    FROM unnest(p_units, p_quantities) WITH ORDINALITY AS r(u, q, n)
    ORDER BY r.n;
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
  rline2 text;
  lot2 text;
  tracked text;
  bin text;
  rcpt3 text;
  rline3 text;
  ncr_type text;
  ncr text;
  unit2 text;
  rcpt2 text;
  rline4 text;
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

  -- A statement is judged on all its rows: 10 free units, then -5 and -10
  -- together reach into the held 100, so neither row is kept.
  INSERT INTO "itemLedger" ("entryType", "documentType", "itemId", "locationId", "storageUnitId", "quantity", "companyId", "createdBy")
  VALUES ('Positive Adjmt.', 'Direct Transfer', item, location, unit, 10, company, usr);
  PERFORM pg_temp.expect('a multi-row move that reaches held stock is refused whole',
    pg_temp.refused_many(company, item, location, unit, ARRAY[-5, -10]::numeric[], usr)::text, 'true');
  PERFORM pg_temp.expect('the refused statement leaves on-hand as it was',
    (SELECT SUM("quantity") FROM "itemLedger" WHERE "storageUnitId" = unit AND "trackedEntityId" IS NULL)::text, '110');
  PERFORM pg_temp.expect('a multi-row move of free stock passes',
    pg_temp.refused_many(company, item, location, unit, ARRAY[-4, -6]::numeric[], usr)::text, 'false');

  -- 100 on hand, 100 held. One statement nets its rows at a unit: a move out
  -- with an equal move in passes whatever their order; a net move out does not.
  PERFORM pg_temp.expect('a statement whose rows net to zero passes',
    pg_temp.refused_rows(company, item, location, ARRAY[unit, unit], ARRAY[-5, 5]::numeric[], usr)::text, 'false');
  PERFORM pg_temp.expect('a statement whose rows net into held stock is refused',
    pg_temp.refused_rows(company, item, location, ARRAY[unit, unit], ARRAY[5, -10]::numeric[], usr)::text, 'true');
  PERFORM pg_temp.expect('the netted statements leave on-hand at 100',
    (SELECT SUM("quantity") FROM "itemLedger" WHERE "storageUnitId" = unit AND "trackedEntityId" IS NULL)::text, '100');

  -- A second held unit: 10 on hand, a lot of 5. A statement that breaks the
  -- hold at one unit is refused whole, the move at the other unit included.
  INSERT INTO "storageUnit" ("name", "locationId", "companyId", "createdBy", "nettable")
  VALUES ('QC-HOLD-TEST-2-' || substr(md5(random()::text), 1, 8), location, company, usr, false)
  RETURNING "id" INTO unit2;
  INSERT INTO "receipt" ("receiptId", "companyId", "createdBy", "locationId", "sourceDocument", "status")
  VALUES ('RE-HOLD-TEST-2', company, usr, location, 'Purchase Order', 'Posted')
  RETURNING "id" INTO rcpt2;
  INSERT INTO "receiptLine" ("receiptId", "itemId", "locationId", "storageUnitId", "companyId", "createdBy", "requiresInspection", "orderQuantity", "unitOfMeasure", "unitPrice")
  VALUES (rcpt2, item, location, unit2, company, usr, true, 5, 'EA', 0)
  RETURNING "id" INTO rline4;
  INSERT INTO "itemLedger" ("entryType", "documentType", "itemId", "locationId", "storageUnitId", "quantity", "companyId", "createdBy")
  VALUES ('Positive Adjmt.', 'Purchase Receipt', item, location, unit2, 10, company, usr);
  INSERT INTO "inspection" (
    "inspectionId", "itemId", "lotSize", "samplingStandard", "samplingPlanType",
    "sampleSize", "acceptanceNumber", "rejectionNumber", "companyId", "createdBy",
    "sourceDocument", "sourceDocumentId", "sourceDocumentLineId", "storageUnitId", "status"
  ) VALUES (
    'INS-HOLD-TEST-4', item, 5, 'ANSI_Z1_4', 'All', 5, 0, 1, company, usr,
    'Receipt', rcpt2, rline4, unit2, 'Pending'
  );
  PERFORM pg_temp.expect('a statement that breaks the hold at one of two units is refused',
    pg_temp.refused_rows(company, item, location, ARRAY[unit2, unit], ARRAY[-3, -1]::numeric[], usr)::text, 'true');
  PERFORM pg_temp.expect('the refused statement keeps no row at the other unit',
    (SELECT SUM("quantity") FROM "itemLedger" WHERE "storageUnitId" = unit2)::text, '10');
  PERFORM pg_temp.expect('a statement within the hold at both units passes',
    pg_temp.refused_rows(company, item, location, ARRAY[unit2, unit, unit], ARRAY[-5, 1, -1]::numeric[], usr)::text, 'false');

  -- Only a new ledger row moves stock: an UPDATE or DELETE is never refused,
  -- even one that leaves less than the held quantity on the books.
  BEGIN
    UPDATE "itemLedger" SET "quantity" = 0 WHERE "storageUnitId" = unit AND "quantity" = 120;
    DELETE FROM "itemLedger" WHERE "storageUnitId" = unit2;
    RAISE SQLSTATE 'HT001';
  EXCEPTION
    WHEN raise_exception THEN
      RAISE EXCEPTION 'an UPDATE or DELETE on itemLedger was refused: %', SQLERRM;
    WHEN SQLSTATE 'HT001' THEN
      NULL;
  END;
  PERFORM pg_temp.expect('the UPDATE and DELETE are rolled back',
    (SELECT SUM("quantity") FROM "itemLedger" WHERE "storageUnitId" = unit AND "trackedEntityId" IS NULL)::text, '100');

  -- Serial or batch stock in the same unit is not untracked on-hand: an item
  -- that changed tracking type keeps its tracked rows, and they must not let
  -- an untracked move into the held quantity.
  INSERT INTO "trackedEntity" ("quantity", "sourceDocument", "sourceDocumentId", "companyId", "createdBy", "status", "itemId", "attributes")
  VALUES (50, 'Receipt', rcpt, company, usr, 'Available', item, '{}'::jsonb)
  RETURNING "id" INTO tracked;
  INSERT INTO "itemLedger" ("entryType", "documentType", "itemId", "locationId", "storageUnitId", "trackedEntityId", "quantity", "companyId", "createdBy")
  VALUES ('Positive Adjmt.', 'Direct Transfer', item, location, unit, tracked, 50, company, usr);
  PERFORM pg_temp.expect('tracked stock does not cover an untracked move',
    pg_temp.refused(company, item, location, unit, NULL, -1, usr)::text, 'true');

  -- 4. An On Hold unit cannot leave, whatever the bin.
  INSERT INTO "trackedEntity" ("quantity", "sourceDocument", "sourceDocumentId", "companyId", "createdBy", "status", "itemId", "attributes")
  VALUES (1, 'Receipt', rcpt, company, usr, 'On Hold', item, jsonb_build_object('Receipt Line', rline))
  RETURNING "id" INTO entity;
  PERFORM pg_temp.expect('an On Hold unit is refused',
    pg_temp.refused(company, item, location, NULL, entity, -1, usr)::text, 'true');
  -- A unit On Hold for another reason (no open lot on its receipt line) moves.
  UPDATE "trackedEntity" SET "attributes" = '{}'::jsonb WHERE "id" = entity;
  PERFORM pg_temp.expect('an On Hold unit with no open lot moves',
    pg_temp.refused(company, item, location, NULL, entity, -1, usr)::text, 'false');
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
  -- Closing the lot's NCR releases the remainder.
  INSERT INTO "nonConformanceType" ("name", "companyId", "createdBy")
  VALUES ('HOLD-TEST-' || substr(md5(random()::text), 1, 8), company, usr)
  RETURNING "id" INTO ncr_type;
  INSERT INTO "nonConformance" ("nonConformanceId", "name", "source", "locationId", "nonConformanceTypeId", "openDate", "companyId", "createdBy", "status")
  VALUES ('NCR-HOLD-TEST', 'Hold test', 'Internal', location, ncr_type, CURRENT_DATE, company, usr, 'Closed')
  RETURNING "id" INTO ncr;
  INSERT INTO "nonConformanceInspection" ("nonConformanceId", "inspectionId", "companyId", "createdBy")
  VALUES (ncr, lot, company, usr);
  PERFORM pg_temp.expect('a Partial lot whose NCR closed holds nothing',
    public.inspection_held_quantity(company, item, unit)::text, '0');
  PERFORM pg_temp.expect('its remainder moves once the NCR closed',
    pg_temp.refused(company, item, location, unit, NULL, -1, usr)::text, 'false');
  DELETE FROM "nonConformanceInspection" WHERE "nonConformanceId" = ncr;
  INSERT INTO "itemLedger" ("entryType", "documentType", "itemId", "locationId", "storageUnitId", "quantity", "companyId", "createdBy")
  VALUES ('Positive Adjmt.', 'Direct Transfer', item, location, unit, 1, company, usr);
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

  -- Put Away is judged per line: a second passed line with nothing put away
  -- keeps the receipt waiting, even when the first line was over-picked.
  INSERT INTO "receiptLine" ("receiptId", "itemId", "locationId", "storageUnitId", "companyId", "createdBy", "requiresInspection", "orderQuantity", "unitOfMeasure", "unitPrice")
  VALUES (rcpt, item, location, unit, company, usr, true, 50, 'EA', 0)
  RETURNING "id" INTO rline2;
  INSERT INTO "inspection" (
    "inspectionId", "itemId", "lotSize", "samplingStandard", "samplingPlanType",
    "sampleSize", "acceptanceNumber", "rejectionNumber", "companyId", "createdBy",
    "sourceDocument", "sourceDocumentId", "sourceDocumentLineId", "storageUnitId", "status"
  ) VALUES (
    'INS-HOLD-TEST-2', item, 50, 'ANSI_Z1_4', 'All', 50, 0, 1, company, usr,
    'Receipt', rcpt, rline2, unit, 'Passed'
  ) RETURNING "id" INTO lot2;
  UPDATE "stockTransferLine" SET "pickedQuantity" = 150 WHERE "stockTransferId" = transfer;
  UPDATE "stockTransfer" SET "status" = 'Released' WHERE "id" = transfer;
  UPDATE "stockTransfer" SET "status" = 'Completed' WHERE "id" = transfer;
  PERFORM pg_temp.expect('roll-up: one line over-picked does not cover another',
    (SELECT "inspectionStatus"::text FROM "receipt" WHERE "id" = rcpt), 'Inspection Passed');

  -- A cancelled lot is ignored by the roll-up and holds nothing.
  UPDATE "inspection" SET "status" = 'Cancelled' WHERE "id" IN (lot, lot2);
  PERFORM pg_temp.expect('roll-up: cancelled lot',
    (SELECT "inspectionStatus"::text FROM "receipt" WHERE "id" = rcpt), 'Not Required');

  -- A lot in a nettable unit never held its stock (lots from before the
  -- hold): the roll-up leaves its receipt Not Required, so it is never
  -- offered for putaway.
  INSERT INTO "storageUnit" ("name", "locationId", "companyId", "createdBy")
  VALUES ('BIN-HOLD-TEST-' || substr(md5(random()::text), 1, 8), location, company, usr)
  RETURNING "id" INTO bin;
  INSERT INTO "receipt" ("receiptId", "companyId", "createdBy", "locationId", "sourceDocument", "status")
  VALUES ('RE-HOLD-TEST-3', company, usr, location, 'Purchase Order', 'Posted')
  RETURNING "id" INTO rcpt3;
  INSERT INTO "receiptLine" ("receiptId", "itemId", "locationId", "storageUnitId", "companyId", "createdBy", "requiresInspection", "orderQuantity", "unitOfMeasure", "unitPrice")
  VALUES (rcpt3, item, location, bin, company, usr, true, 10, 'EA', 0)
  RETURNING "id" INTO rline3;
  INSERT INTO "inspection" (
    "inspectionId", "itemId", "lotSize", "samplingStandard", "samplingPlanType",
    "sampleSize", "acceptanceNumber", "rejectionNumber", "companyId", "createdBy",
    "sourceDocument", "sourceDocumentId", "sourceDocumentLineId", "storageUnitId", "status"
  ) VALUES (
    'INS-HOLD-TEST-3', item, 10, 'ANSI_Z1_4', 'All', 10, 0, 1, company, usr,
    'Receipt', rcpt3, rline3, bin, 'Passed'
  );
  PERFORM pg_temp.expect('roll-up: a lot in a nettable unit',
    (SELECT "inspectionStatus"::text FROM "receipt" WHERE "id" = rcpt3), 'Not Required');

  -- A location's goods-in units must be its own (check_location_goods_in_storage_units).
  DECLARE
    other_location text;
    foreign_unit text;
  BEGIN
    INSERT INTO "location" ("name", "addressLine1", "city", "postalCode", "timezone", "companyId", "createdBy")
    VALUES ('HOLD-TEST-LOC-' || substr(md5(random()::text), 1, 8), '1 Test St', 'Testville', '00000', 'UTC', company, usr)
    RETURNING "id" INTO other_location;
    INSERT INTO "storageUnit" ("name", "locationId", "companyId", "createdBy", "nettable")
    VALUES ('QC-OTHER-TEST', other_location, company, usr, false)
    RETURNING "id" INTO foreign_unit;
    BEGIN
      UPDATE "location" l SET "inspectionStorageUnitId" = foreign_unit WHERE l."id" = location;
      RAISE EXCEPTION 'a unit of another location was accepted as the inspection unit';
    EXCEPTION WHEN raise_exception THEN
      IF SQLERRM NOT LIKE '%must belong to this location%' THEN RAISE; END IF;
    END;
    UPDATE "location" l SET "inspectionStorageUnitId" = unit WHERE l."id" = location;
  END;

  RAISE NOTICE 'inspection-hold: all checks passed';
END;
$proof$;

ROLLBACK;
