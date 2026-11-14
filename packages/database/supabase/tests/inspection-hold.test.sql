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

CREATE FUNCTION pg_temp.refused_edit(p_statement text, p_like text)
RETURNS boolean LANGUAGE plpgsql AS $fn$
BEGIN
  BEGIN
    EXECUTE p_statement;
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE p_like THEN
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
  open_ncr text;
  spare_lot text;
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

  INSERT INTO "itemLedger" ("entryType", "documentType", "itemId", "locationId", "storageUnitId", "quantity", "companyId", "createdBy")
  VALUES ('Positive Adjmt.', 'Direct Transfer', item, location, unit, 10, company, usr);
  PERFORM pg_temp.expect('a multi-row move that reaches held stock is refused whole',
    pg_temp.refused_many(company, item, location, unit, ARRAY[-5, -10]::numeric[], usr)::text, 'true');
  PERFORM pg_temp.expect('the refused statement leaves on-hand as it was',
    (SELECT SUM("quantity") FROM "itemLedger" WHERE "storageUnitId" = unit AND "trackedEntityId" IS NULL)::text, '110');
  PERFORM pg_temp.expect('a multi-row move of free stock passes',
    pg_temp.refused_many(company, item, location, unit, ARRAY[-4, -6]::numeric[], usr)::text, 'false');

  PERFORM pg_temp.expect('a statement whose rows net to zero passes',
    pg_temp.refused_rows(company, item, location, ARRAY[unit, unit], ARRAY[-5, 5]::numeric[], usr)::text, 'false');
  PERFORM pg_temp.expect('a statement whose rows net into held stock is refused',
    pg_temp.refused_rows(company, item, location, ARRAY[unit, unit], ARRAY[5, -10]::numeric[], usr)::text, 'true');
  PERFORM pg_temp.expect('the netted statements leave on-hand at 100',
    (SELECT SUM("quantity") FROM "itemLedger" WHERE "storageUnitId" = unit AND "trackedEntityId" IS NULL)::text, '100');

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
  PERFORM pg_temp.expect('a held unit is not set Available directly',
    pg_temp.refused_edit(format('UPDATE "trackedEntity" SET "status" = %L WHERE "id" = %L', 'Available', entity),
      '%held for inspection%')::text, 'true');
  PERFORM pg_temp.expect('a held unit does not leave its receipt line directly',
    pg_temp.refused_edit(format('UPDATE "trackedEntity" SET "attributes" = %L::jsonb WHERE "id" = %L', '{}', entity),
      '%held for inspection%')::text, 'true');
  PERFORM pg_temp.expect('a held unit keeps any other edit',
    pg_temp.refused_edit(format('UPDATE "trackedEntity" SET "quantity" = 1 WHERE "id" = %L', entity),
      '%held for inspection%')::text, 'false');
  -- A unit On Hold for another reason (no open lot on its receipt line) moves.
  PERFORM set_config('app.inspection_release', 'on', true);
  UPDATE "trackedEntity" SET "attributes" = '{}'::jsonb WHERE "id" = entity;
  PERFORM set_config('app.inspection_release', '', true);
  PERFORM pg_temp.expect('an On Hold unit with no open lot moves',
    pg_temp.refused(company, item, location, NULL, entity, -1, usr)::text, 'false');
  UPDATE "trackedEntity" SET "status" = 'Available' WHERE "id" = entity;
  PERFORM pg_temp.expect('an Available unit moves',
    pg_temp.refused(company, item, location, NULL, entity, -1, usr)::text, 'false');

  UPDATE "inspection" SET "status" = 'In Progress' WHERE "id" = lot;
  PERFORM pg_temp.expect('roll-up: in progress',
    (SELECT "inspectionStatus"::text FROM "receipt" WHERE "id" = rcpt), 'Inspection In Progress');

  PERFORM pg_temp.expect('a lot is not set Passed directly',
    pg_temp.refused_edit(format('UPDATE "inspection" SET "status" = %L WHERE "id" = %L', 'Passed', lot),
      '%inspection decision%')::text, 'true');
  PERFORM pg_temp.expect('a lot does not leave its storage unit directly',
    pg_temp.refused_edit(format('UPDATE "inspection" SET "storageUnitId" = NULL WHERE "id" = %L', lot),
      '%inspection decision%')::text, 'true');
  PERFORM pg_temp.expect('a lot does not take an accepted quantity directly',
    pg_temp.refused_edit(format('UPDATE "inspection" SET "acceptedQuantity" = 99 WHERE "id" = %L', lot),
      '%inspection decision%')::text, 'true');
  PERFORM pg_temp.expect('a lot keeps its notes editable',
    pg_temp.refused_edit(format('UPDATE "inspection" SET "notes" = %L WHERE "id" = %L', 'checked', lot),
      '%inspection decision%')::text, 'false');
  PERFORM pg_temp.expect('the refused edits leave the lot holding 100',
    public.inspection_held_quantity(company, item, unit)::text, '100');

  PERFORM pg_temp.expect('a held lot is not deleted directly',
    pg_temp.refused_edit(format('DELETE FROM "inspection" WHERE "id" = %L', lot),
      '%holds stock%')::text, 'true');
  INSERT INTO "inspection" (
    "inspectionId", "itemId", "lotSize", "samplingStandard", "samplingPlanType",
    "sampleSize", "acceptanceNumber", "rejectionNumber", "companyId", "createdBy",
    "sourceDocument", "sourceDocumentId", "sourceDocumentLineId", "storageUnitId", "status"
  ) VALUES (
    'INS-HOLD-TEST-SPARE', item, 1, 'ANSI_Z1_4', 'All', 1, 0, 1, company, usr,
    'Receipt', rcpt, NULL, unit, 'Pending'
  ) RETURNING "id" INTO spare_lot;
  PERFORM set_config('app.inspection_release', 'on', true);
  PERFORM pg_temp.expect('a held lot is deleted under the release flag',
    pg_temp.refused_edit(format('DELETE FROM "inspection" WHERE "id" = %L', spare_lot),
      '%holds stock%')::text, 'false');
  PERFORM set_config('app.inspection_release', '', true);
  PERFORM pg_temp.expect('the deleted spare lot holds nothing',
    public.inspection_held_quantity(company, item, unit)::text, '100');

  PERFORM set_config('app.inspection_release', 'on', true);

  -- 6. A Partial lot holds its rejected remainder while no NCR has closed.
  UPDATE "inspection" SET "status" = 'Partial', "acceptedQuantity" = 92 WHERE "id" = lot;
  PERFORM set_config('app.inspection_release', '', true);
  PERFORM pg_temp.expect('a Partial lot holds its remainder',
    public.inspection_held_quantity(company, item, unit)::text, '8');
  PERFORM pg_temp.expect('roll-up: partial',
    (SELECT "inspectionStatus"::text FROM "receipt" WHERE "id" = rcpt), 'Partially Passed');
  PERFORM pg_temp.expect('the accepted quantity moves',
    pg_temp.refused(company, item, location, unit, NULL, -92, usr)::text, 'false');
  PERFORM pg_temp.expect('the remainder stays held',
    pg_temp.refused(company, item, location, unit, NULL, -1, usr)::text, 'true');
  INSERT INTO "nonConformanceType" ("name", "companyId", "createdBy")
  VALUES ('HOLD-TEST-' || substr(md5(random()::text), 1, 8), company, usr)
  RETURNING "id" INTO ncr_type;
  INSERT INTO "nonConformance" ("nonConformanceId", "name", "source", "locationId", "nonConformanceTypeId", "openDate", "companyId", "createdBy", "status")
  VALUES ('NCR-HOLD-TEST-OPEN', 'Hold test open', 'Internal', location, ncr_type, CURRENT_DATE, company, usr, 'In Progress')
  RETURNING "id" INTO open_ncr;
  INSERT INTO "nonConformanceInspection" ("nonConformanceId", "inspectionId", "companyId", "createdBy")
  VALUES (open_ncr, lot, company, usr);
  PERFORM pg_temp.expect('a Partial lot''s NCR is not closed directly',
    pg_temp.refused_edit(format('UPDATE "nonConformance" SET "status" = %L WHERE "id" = %L', 'Closed', open_ncr),
      '%holds the rejected part%')::text, 'true');
  PERFORM pg_temp.expect('an NCR edit that does not close it is kept',
    pg_temp.refused_edit(format('UPDATE "nonConformance" SET "name" = %L WHERE "id" = %L', 'Renamed', open_ncr),
      '%holds the rejected part%')::text, 'false');
  PERFORM pg_temp.expect('the refused close leaves the remainder held',
    public.inspection_held_quantity(company, item, unit)::text, '8');
  PERFORM set_config('app.inspection_release', 'on', true);
  UPDATE "nonConformance" SET "status" = 'Closed' WHERE "id" = open_ncr;
  PERFORM set_config('app.inspection_release', '', true);
  PERFORM pg_temp.expect('closing the NCR under the release flag releases the remainder',
    public.inspection_held_quantity(company, item, unit)::text, '0');
  PERFORM pg_temp.expect('the link of a lot its NCR released cannot be removed',
    pg_temp.refused_edit(format('DELETE FROM "nonConformanceInspection" WHERE "nonConformanceId" = %L', open_ncr),
      '%decided by this NCR%')::text, 'true');
  PERFORM set_config('app.inspection_release', 'on', true);
  DELETE FROM "nonConformanceInspection" WHERE "nonConformanceId" = open_ncr;
  PERFORM set_config('app.inspection_release', '', true);

  INSERT INTO "nonConformance" ("nonConformanceId", "name", "source", "locationId", "nonConformanceTypeId", "openDate", "companyId", "createdBy", "status")
  VALUES ('NCR-HOLD-TEST', 'Hold test', 'Internal', location, ncr_type, CURRENT_DATE, company, usr, 'Closed')
  RETURNING "id" INTO ncr;
  PERFORM set_config('app.inspection_release', 'on', true);
  INSERT INTO "nonConformanceInspection" ("nonConformanceId", "inspectionId", "companyId", "createdBy")
  VALUES (ncr, lot, company, usr);
  PERFORM set_config('app.inspection_release', '', true);
  PERFORM pg_temp.expect('a Partial lot whose NCR closed holds nothing',
    public.inspection_held_quantity(company, item, unit)::text, '0');
  PERFORM pg_temp.expect('its remainder moves once the NCR closed',
    pg_temp.refused(company, item, location, unit, NULL, -1, usr)::text, 'false');
  PERFORM set_config('app.inspection_release', 'on', true);
  DELETE FROM "nonConformanceInspection" WHERE "nonConformanceId" = ncr;
  PERFORM set_config('app.inspection_release', '', true);
  INSERT INTO "itemLedger" ("entryType", "documentType", "itemId", "locationId", "storageUnitId", "quantity", "companyId", "createdBy")
  VALUES ('Positive Adjmt.', 'Direct Transfer', item, location, unit, 1, company, usr);
  INSERT INTO "itemLedger" ("entryType", "documentType", "itemId", "locationId", "storageUnitId", "quantity", "companyId", "createdBy")
  VALUES ('Positive Adjmt.', 'Direct Transfer', item, location, unit, 92, company, usr);

  -- 5. A Passed lot holds nothing.
  PERFORM set_config('app.inspection_release', 'on', true);
  UPDATE "inspection" SET "status" = 'Passed', "acceptedQuantity" = NULL WHERE "id" = lot;
  PERFORM set_config('app.inspection_release', '', true);
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
  PERFORM set_config('app.inspection_release', 'on', true);
  UPDATE "inspection" SET "status" = 'Cancelled' WHERE "id" IN (lot, lot2);
  PERFORM set_config('app.inspection_release', '', true);
  PERFORM pg_temp.expect('roll-up: cancelled lot',
    (SELECT "inspectionStatus"::text FROM "receipt" WHERE "id" = rcpt), 'Not Required');

  -- A goods-in unit may be nettable: a lot that names a nettable unit counts
  -- in the roll-up like any other.
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
    (SELECT "inspectionStatus"::text FROM "receipt" WHERE "id" = rcpt3), 'Inspection Passed');

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

  DECLARE
    held_type text;
    typed_unit text;
    free_unit text;
  BEGIN
    PERFORM pg_temp.expect('the inspection unit may be made nettable',
      pg_temp.refused_edit(format('UPDATE "storageUnit" SET "nettable" = true WHERE "id" = %L', unit),
        '%goods-in storage unit of%')::text, 'false');
    UPDATE "storageUnit" SET "nettable" = false WHERE "id" = unit;
    INSERT INTO "storageType" ("name", "nettable", "companyId", "createdBy")
    VALUES ('HOLD-TEST-TYPE-' || substr(md5(random()::text), 1, 8), false, company, usr)
    RETURNING "id" INTO held_type;
    INSERT INTO "storageUnit" ("name", "locationId", "companyId", "createdBy", "storageTypeIds")
    VALUES ('MRB-HOLD-TEST-' || substr(md5(random()::text), 1, 8), location, company, usr, ARRAY[held_type])
    RETURNING "id" INTO typed_unit;
    PERFORM pg_temp.expect('a unit of a non-nettable type is non-nettable',
      (SELECT "effectiveNettable"::text FROM "storageUnit" WHERE "id" = typed_unit), 'false');
    UPDATE "location" l SET "rejectedStorageUnitId" = typed_unit WHERE l."id" = location;
    PERFORM pg_temp.expect('the rejected unit''s storage type may be made nettable',
      pg_temp.refused_edit(format('UPDATE "storageType" SET "nettable" = true WHERE "id" = %L', held_type),
        '%goods-in storage unit of%')::text, 'false');
    UPDATE "storageType" SET "nettable" = false WHERE "id" = held_type;
    PERFORM pg_temp.expect('a unit a lot holds stock in may be made nettable',
      pg_temp.refused_edit(format('UPDATE "storageUnit" SET "nettable" = true WHERE "id" = %L', unit2),
        '%holds stock of inspection lot%')::text, 'false');
    UPDATE "storageUnit" SET "nettable" = false WHERE "id" = unit2;
    PERFORM pg_temp.expect('the inspection unit is not deactivated',
      pg_temp.refused_edit(format('UPDATE "storageUnit" SET "active" = false WHERE "id" = %L', unit),
        '%goods-in storage unit of%')::text, 'true');
    PERFORM pg_temp.expect('a unit a lot holds stock in is not deactivated',
      pg_temp.refused_edit(format('UPDATE "storageUnit" SET "active" = false WHERE "id" = %L', unit2),
        '%holds stock of inspection lot%')::text, 'true');
    INSERT INTO "storageUnit" ("name", "locationId", "nettable", "companyId", "createdBy")
    VALUES ('FREE-HOLD-TEST-' || substr(md5(random()::text), 1, 8), location, false, company, usr)
    RETURNING "id" INTO free_unit;
    PERFORM pg_temp.expect('a unit no location names and no lot holds may be made nettable',
      pg_temp.refused_edit(format('UPDATE "storageUnit" SET "nettable" = true WHERE "id" = %L', free_unit),
        '%goods-in storage unit of%')::text, 'false');
    PERFORM pg_temp.expect('a unit no location names and no lot holds may be deactivated',
      pg_temp.refused_edit(format('UPDATE "storageUnit" SET "active" = false WHERE "id" = %L', free_unit),
        '%goods-in storage unit of%')::text, 'false');
  END;

  DECLARE
    inactive_unit text;
  BEGIN
    INSERT INTO "storageUnit" ("name", "locationId", "companyId", "createdBy", "nettable", "active")
    VALUES ('QC-INACTIVE-TEST-' || substr(md5(random()::text), 1, 8), location, company, usr, false, false)
    RETURNING "id" INTO inactive_unit;
    PERFORM pg_temp.expect('an inactive unit is not named a goods-in unit',
      pg_temp.refused_edit(format('UPDATE "location" SET "rejectedStorageUnitId" = %L WHERE "id" = %L', inactive_unit, location),
        '%must be active%')::text, 'true');
    PERFORM pg_temp.expect('a nettable unit may be named a goods-in unit',
      pg_temp.refused_edit(format('UPDATE "location" SET "inspectionStorageUnitId" = %L WHERE "id" = %L', bin, location),
        '%must be%')::text, 'false');
    UPDATE "location" SET "inspectionStorageUnitId" = unit WHERE "id" = location;
  END;

  DECLARE
    rline5 text;
    partial_lot text;
    held_ncr text;
    other_ncr text;
    closed_ncr text;
    held_before numeric;
  BEGIN
    INSERT INTO "receiptLine" ("receiptId", "itemId", "locationId", "storageUnitId", "companyId", "createdBy", "requiresInspection", "orderQuantity", "unitOfMeasure", "unitPrice")
    VALUES (rcpt, item, location, unit2, company, usr, true, 10, 'EA', 0)
    RETURNING "id" INTO rline5;
    PERFORM set_config('app.inspection_release', 'on', true);
    INSERT INTO "inspection" (
      "inspectionId", "itemId", "lotSize", "samplingStandard", "samplingPlanType",
      "sampleSize", "acceptanceNumber", "rejectionNumber", "companyId", "createdBy",
      "sourceDocument", "sourceDocumentId", "sourceDocumentLineId", "storageUnitId", "status", "acceptedQuantity"
    ) VALUES (
      'INS-HOLD-TEST-LINK', item, 10, 'ANSI_Z1_4', 'All', 10, 0, 1, company, usr,
      'Receipt', rcpt, rline5, unit2, 'Partial', 6
    ) RETURNING "id" INTO partial_lot;
    INSERT INTO "nonConformance" ("nonConformanceId", "name", "source", "locationId", "nonConformanceTypeId", "openDate", "companyId", "createdBy", "status")
    VALUES ('NCR-HOLD-TEST-CLOSED', 'Hold test closed', 'Internal', location, ncr_type, CURRENT_DATE, company, usr, 'Closed')
    RETURNING "id" INTO closed_ncr;
    PERFORM set_config('app.inspection_release', '', true);
    INSERT INTO "nonConformance" ("nonConformanceId", "name", "source", "locationId", "nonConformanceTypeId", "openDate", "companyId", "createdBy", "status")
    VALUES ('NCR-HOLD-TEST-HELD', 'Hold test held', 'Internal', location, ncr_type, CURRENT_DATE, company, usr, 'In Progress')
    RETURNING "id" INTO held_ncr;
    INSERT INTO "nonConformance" ("nonConformanceId", "name", "source", "locationId", "nonConformanceTypeId", "openDate", "companyId", "createdBy", "status")
    VALUES ('NCR-HOLD-TEST-OTHER', 'Hold test other', 'Internal', location, ncr_type, CURRENT_DATE, company, usr, 'In Progress')
    RETURNING "id" INTO other_ncr;
    held_before := public.inspection_held_quantity(company, item, unit2);

    PERFORM pg_temp.expect('a held remainder is not linked to a Closed NCR',
      pg_temp.refused_edit(format('INSERT INTO "nonConformanceInspection" ("nonConformanceId", "inspectionId", "companyId", "createdBy") VALUES (%L, %L, %L, %L)', closed_ncr, partial_lot, company, usr),
        '%holds its rejected part%')::text, 'true');
    PERFORM pg_temp.expect('a held remainder is linked to an open NCR',
      pg_temp.refused_edit(format('INSERT INTO "nonConformanceInspection" ("nonConformanceId", "inspectionId", "companyId", "createdBy") VALUES (%L, %L, %L, %L)', held_ncr, partial_lot, company, usr),
        '%holds its rejected part%')::text, 'false');
    PERFORM pg_temp.expect('the link is not re-pointed to a Closed NCR',
      pg_temp.refused_edit(format('UPDATE "nonConformanceInspection" SET "nonConformanceId" = %L WHERE "inspectionId" = %L', closed_ncr, partial_lot),
        '%decided by this NCR%')::text, 'true');
    PERFORM pg_temp.expect('the link is not re-pointed to another NCR',
      pg_temp.refused_edit(format('UPDATE "nonConformanceInspection" SET "nonConformanceId" = %L WHERE "inspectionId" = %L', other_ncr, partial_lot),
        '%decided by this NCR%')::text, 'true');
    PERFORM pg_temp.expect('the link is not removed',
      pg_temp.refused_edit(format('DELETE FROM "nonConformanceInspection" WHERE "inspectionId" = %L', partial_lot),
        '%decided by this NCR%')::text, 'true');
    PERFORM pg_temp.expect('the linked open NCR is not deleted',
      pg_temp.refused_edit(format('DELETE FROM "nonConformance" WHERE "id" = %L', held_ncr),
        '%holds the rejected part%')::text, 'true');
    PERFORM pg_temp.expect('an NCR with no held lot is deleted',
      pg_temp.refused_edit(format('DELETE FROM "nonConformance" WHERE "id" = %L', other_ncr),
        '%holds the rejected part%')::text, 'false');
    PERFORM pg_temp.expect('the refused edits leave the remainder held',
      public.inspection_held_quantity(company, item, unit2)::text, held_before::text);
    PERFORM set_config('app.inspection_release', 'on', true);
    PERFORM pg_temp.expect('the linked NCR is deleted under the release flag',
      pg_temp.refused_edit(format('DELETE FROM "nonConformance" WHERE "id" = %L', held_ncr),
        '%holds the rejected part%')::text, 'false');
    PERFORM set_config('app.inspection_release', '', true);
  END;

  DECLARE
    moved_to text;
  BEGIN
    INSERT INTO "location" ("name", "addressLine1", "city", "postalCode", "timezone", "companyId", "createdBy")
    VALUES ('HOLD-TEST-LOC2-' || substr(md5(random()::text), 1, 8), '1 Test St', 'Testville', '00000', 'UTC', company, usr)
    RETURNING "id" INTO moved_to;
    PERFORM pg_temp.expect('one unit is not both the inspection and the rejected unit',
      pg_temp.refused_edit(format('UPDATE "location" SET "rejectedStorageUnitId" = "inspectionStorageUnitId" WHERE "id" = %L', location),
        '%two different units%')::text, 'true');
    PERFORM pg_temp.expect('the inspection unit is not moved to another location',
      pg_temp.refused_edit(format('UPDATE "storageUnit" SET "locationId" = %L WHERE "id" = %L', moved_to, unit),
        '%goods-in storage unit of%')::text, 'true');
    PERFORM pg_temp.expect('a unit no location names may move',
      pg_temp.refused_edit(format('UPDATE "storageUnit" SET "locationId" = %L WHERE "id" = %L', moved_to, bin),
        '%goods-in storage unit of%')::text, 'false');
  END;

  DECLARE
    legacy_lot text;
  BEGIN
    INSERT INTO "inspection" (
      "inspectionId", "itemId", "lotSize", "samplingStandard", "samplingPlanType",
      "sampleSize", "acceptanceNumber", "rejectionNumber", "companyId", "createdBy",
      "sourceDocument", "sourceDocumentId", "sourceDocumentLineId", "storageUnitId", "status"
    ) VALUES (
      'INS-HOLD-TEST-LEGACY', item, 5, 'ANSI_Z1_4', 'All', 5, 0, 1, company, usr,
      'Receipt', rcpt, NULL, NULL, 'Pending'
    ) RETURNING "id" INTO legacy_lot;
    PERFORM pg_temp.expect('a legacy lot with no storage unit is deleted directly',
      pg_temp.refused_edit(format('DELETE FROM "inspection" WHERE "id" = %L', legacy_lot),
        '%holds stock%')::text, 'false');
  END;

  DECLARE
    co text;
    co_loc text;
    co_unit text;
    co_rejected text;
    co_item text;
    co_rcpt text;
    co_line text;
    co_lot text;
    co_type text;
    co_ncr text;
  BEGIN
    PERFORM set_config('app.sync_in_progress', 'true', true);
    INSERT INTO "company" ("name", "baseCurrencyCode", "companyGroupId")
    SELECT 'HOLD-TEST-CO-' || substr(md5(random()::text), 1, 8), 'USD', c."companyGroupId"
    FROM "company" c WHERE c."id" = company
    RETURNING "id" INTO co;
    INSERT INTO "location" ("name", "addressLine1", "city", "postalCode", "timezone", "companyId", "createdBy")
    VALUES ('HOLD-TEST-CO-LOC', '1 Test St', 'Testville', '00000', 'UTC', co, usr)
    RETURNING "id" INTO co_loc;
    INSERT INTO "storageUnit" ("name", "locationId", "companyId", "createdBy", "nettable")
    VALUES ('QC', co_loc, co, usr, false) RETURNING "id" INTO co_unit;
    INSERT INTO "storageUnit" ("name", "locationId", "companyId", "createdBy", "nettable")
    VALUES ('MRB', co_loc, co, usr, false) RETURNING "id" INTO co_rejected;
    UPDATE "location" SET "inspectionStorageUnitId" = co_unit, "rejectedStorageUnitId" = co_rejected WHERE "id" = co_loc;
    INSERT INTO "item" ("readableId", "name", "type", "itemTrackingType", "companyId", "createdBy")
    VALUES ('HOLD-TEST-CO-ITEM', 'held', 'Part', 'Inventory', co, usr) RETURNING "id" INTO co_item;
    INSERT INTO "receipt" ("receiptId", "companyId", "createdBy", "locationId", "sourceDocument", "status")
    VALUES ('RE-HOLD-CO', co, usr, co_loc, 'Purchase Order', 'Posted') RETURNING "id" INTO co_rcpt;
    INSERT INTO "receiptLine" ("receiptId", "itemId", "locationId", "storageUnitId", "companyId", "createdBy", "requiresInspection", "orderQuantity", "unitOfMeasure", "unitPrice")
    VALUES (co_rcpt, co_item, co_loc, co_unit, co, usr, true, 10, 'EA', 0) RETURNING "id" INTO co_line;
    INSERT INTO "itemLedger" ("entryType", "documentType", "itemId", "locationId", "storageUnitId", "quantity", "companyId", "createdBy")
    VALUES ('Positive Adjmt.', 'Purchase Receipt', co_item, co_loc, co_unit, 20, co, usr);
    INSERT INTO "inspection" (
      "inspectionId", "itemId", "lotSize", "samplingStandard", "samplingPlanType",
      "sampleSize", "acceptanceNumber", "rejectionNumber", "companyId", "createdBy",
      "sourceDocument", "sourceDocumentId", "sourceDocumentLineId", "storageUnitId", "status"
    ) VALUES (
      'INS-HOLD-CO-OPEN', co_item, 10, 'ANSI_Z1_4', 'All', 10, 0, 1, co, usr,
      'Receipt', co_rcpt, co_line, co_unit, 'Pending'
    );
    INSERT INTO "inspection" (
      "inspectionId", "itemId", "lotSize", "samplingStandard", "samplingPlanType",
      "sampleSize", "acceptanceNumber", "rejectionNumber", "companyId", "createdBy",
      "sourceDocument", "sourceDocumentId", "sourceDocumentLineId", "storageUnitId", "status", "acceptedQuantity"
    ) VALUES (
      'INS-HOLD-CO-PARTIAL', co_item, 10, 'ANSI_Z1_4', 'All', 10, 0, 1, co, usr,
      'Receipt', co_rcpt, NULL, co_unit, 'Partial', 6
    ) RETURNING "id" INTO co_lot;
    INSERT INTO "nonConformanceType" ("name", "companyId", "createdBy")
    VALUES ('HOLD-TEST-CO-TYPE', co, usr) RETURNING "id" INTO co_type;
    INSERT INTO "nonConformance" ("nonConformanceId", "name", "source", "locationId", "nonConformanceTypeId", "openDate", "companyId", "createdBy", "status")
    VALUES ('NCR-HOLD-CO', 'Hold test co', 'Internal', co_loc, co_type, CURRENT_DATE, co, usr, 'In Progress')
    RETURNING "id" INTO co_ncr;
    INSERT INTO "nonConformanceInspection" ("nonConformanceId", "inspectionId", "companyId", "createdBy")
    VALUES (co_ncr, co_lot, co, usr);
    PERFORM set_config('app.sync_in_progress', 'false', true);
    UPDATE "supplier" SET "intercompanyCompanyId" = NULL WHERE "intercompanyCompanyId" = co OR "companyId" = co;
    UPDATE "customer" SET "intercompanyCompanyId" = NULL WHERE "intercompanyCompanyId" = co OR "companyId" = co;
    PERFORM pg_temp.expect('the new company holds stock',
      public.inspection_held_quantity(co, co_item, co_unit)::text, '14');
    PERFORM pg_temp.expect('a company with held stock is deleted',
      pg_temp.refused_edit(format('DELETE FROM "company" WHERE "id" = %L', co), '%')::text, 'false');
    PERFORM pg_temp.expect('the deleted company left no lot',
      (SELECT count(*)::text FROM "inspection" WHERE "companyId" = co), '0');
  END;

  RAISE NOTICE 'inspection-hold: all checks passed';
END;
$proof$;

ROLLBACK;
