-- A change to item."itemTrackingType" (sync_item_tracking_type_change, a
-- statement handler on item). The database refuses the change while stock is
-- held in a form the new type cannot use (Inventory: lots; Serial: untracked
-- stock or a lot of more than one unit; Non-Inventory: any stock), or while a
-- released job that is not finished uses the item. Batch takes any stock.
-- Otherwise the Draft and Planned jobs that copied the old type take the new one.
-- Isolated fixture company; no existing business data is read or edited. Always rolls back.
-- Run: pnpm exec tsx scripts/run-local-accounting-check.ts psql -X -f packages/database/supabase/tests/item-tracking-type-change.test.sql
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL statement_timeout = '60s';

-- The message the statement raised, or NULL when it ran.
CREATE FUNCTION pg_temp.refusal(p_statement text) RETURNS text LANGUAGE plpgsql AS $fn$
BEGIN
  EXECUTE p_statement;
  RETURN NULL;
EXCEPTION WHEN check_violation THEN
  RETURN SQLERRM;
END;
$fn$;

CREATE FUNCTION pg_temp.item(p_company_id text, p_readable_id text, p_tracking text) RETURNS text LANGUAGE sql AS $fn$
  INSERT INTO item ("readableId", name, type, "replenishmentSystem", "itemTrackingType", "unitOfMeasureCode", "companyId", "createdBy")
  VALUES (p_readable_id, p_readable_id, 'Part', 'Buy', p_tracking::"itemTrackingType", 'EA', p_company_id, 'system')
  RETURNING id;
$fn$;

CREATE FUNCTION pg_temp.stock(
  p_company_id text, p_location_id text, p_item_id text, p_quantity numeric, p_tracked_entity_id text,
  p_storage_unit_id text DEFAULT NULL
) RETURNS void LANGUAGE sql AS $fn$
  INSERT INTO "itemLedger" ("entryType", "itemId", quantity, "locationId", "storageUnitId", "trackedEntityId", "postingDate", "companyId", "createdBy")
  VALUES (CASE WHEN p_quantity < 0 THEN 'Negative Adjmt.' ELSE 'Positive Adjmt.' END::"itemLedgerType",
    p_item_id, p_quantity, p_location_id, p_storage_unit_id, p_tracked_entity_id, '2026-01-01', p_company_id, 'system');
$fn$;

-- A lot of p_quantity for p_item_id, in stock. Returns the tracked entity id.
CREATE FUNCTION pg_temp.lot(
  p_company_id text, p_location_id text, p_item_id text, p_readable_id text, p_quantity numeric
) RETURNS text LANGUAGE plpgsql AS $fn$
DECLARE
  v_lot text;
BEGIN
  INSERT INTO "trackedEntity" (quantity, "sourceDocument", "sourceDocumentId", "readableId", "itemId", "companyId", "createdBy")
    VALUES (p_quantity, 'Item', p_item_id, p_readable_id, p_item_id, p_company_id, 'system') RETURNING id INTO v_lot;
  PERFORM pg_temp.stock(p_company_id, p_location_id, p_item_id, p_quantity, v_lot);
  RETURN v_lot;
END;
$fn$;

-- A job of 1 for p_assembly with one material of p_part. Returns the job id.
CREATE FUNCTION pg_temp.job(
  p_company_id text, p_location_id text, p_assembly text, p_part text, p_readable_id text, p_status text
) RETURNS text LANGUAGE plpgsql AS $fn$
DECLARE
  v_job_id text;
  v_make_method_id text;
BEGIN
  INSERT INTO job ("jobId", "itemId", quantity, "locationId", "companyId", "createdBy", "unitOfMeasureCode")
    VALUES (p_readable_id, p_assembly, 1, p_location_id, p_company_id, 'system', 'EA')
    RETURNING id INTO v_job_id;
  SELECT id INTO STRICT v_make_method_id
  FROM "jobMakeMethod" WHERE "jobId" = v_job_id AND "parentMaterialId" IS NULL;
  INSERT INTO "jobMaterial" ("jobId", "jobMakeMethodId", "itemId", description, "methodType",
      "itemType", quantity, "estimatedQuantity", "companyId", "createdBy")
    VALUES (v_job_id, v_make_method_id, p_part, 'Material', 'Pull from Inventory',
      'Part', 1, 1, p_company_id, 'system');
  UPDATE job SET status = p_status::"jobStatus" WHERE id = v_job_id;
  RETURN v_job_id;
END;
$fn$;

DO $cases$
DECLARE
  v_group_id text; v_company_id text; v_location_id text;
  v_batch text; v_plain text; v_empty text; v_running text; v_draft_part text; v_assembly text;
  v_stranded text; v_split text; v_units text; v_service text; v_bin text;
  v_moved text; v_received text; v_receipt text; v_line text; v_unit text; v_returned text;
  v_pair text; v_shipped text; v_shipment text; v_ship_line text; v_chosen text;
  v_lot text; v_job text; v_message text;
BEGIN
  INSERT INTO "companyGroup" (name, "createdBy") VALUES ('Tracking type test', 'system') RETURNING id INTO v_group_id;
  INSERT INTO company (name, "companyGroupId", "baseCurrencyCode", timezone)
    VALUES ('Tracking type test', v_group_id, 'USD', 'UTC') RETURNING id INTO v_company_id;
  INSERT INTO location (name, "addressLine1", city, "postalCode", "companyId", "createdBy", timezone)
    VALUES ('Plant', '1 Test Way', 'Testville', '00000', v_company_id, 'system', 'UTC') RETURNING id INTO v_location_id;
  INSERT INTO "unitOfMeasure" (code, name, "companyId", "createdBy")
    VALUES ('EA', 'Each', v_company_id, 'system') ON CONFLICT DO NOTHING;

  INSERT INTO "storageUnit" (name, "locationId", "companyId", "createdBy")
    VALUES ('A-1', v_location_id, v_company_id, 'system') RETURNING id INTO v_bin;

  -- (a) A batch item with 12 in one lot cannot become Inventory: untracked
  -- draws would not see the lot.
  v_batch := pg_temp.item(v_company_id, 'TT-BATCH', 'Batch');
  v_lot := pg_temp.lot(v_company_id, v_location_id, v_batch, 'LOT-1', 12);
  v_message := pg_temp.refusal(format(
    $$UPDATE item SET "itemTrackingType" = 'Inventory' WHERE id = %L$$, v_batch));
  ASSERT v_message = 'TT-BATCH still has stock in 1 batch or serial numbers (12 in total). Adjust each to zero before you change the tracking type to Inventory.',
    format('Batch stock must refuse the change to Inventory, got: %s', v_message);
  ASSERT (SELECT "itemTrackingType" FROM item WHERE id = v_batch) = 'Batch', 'The refused change must not be written';

  -- (b) A lot of 12 cannot become a serial number either.
  v_message := pg_temp.refusal(format(
    $$UPDATE item SET "itemTrackingType" = 'Serial' WHERE id = %L$$, v_batch));
  ASSERT v_message = 'TT-BATCH has 12 on hand in batch LOT-1. A serial number holds one unit: adjust that stock before you change the tracking type to Serial.',
    format('A lot of 12 must refuse the change to Serial, got: %s', v_message);

  -- (b2) The message names the first lot that cannot be a serial number and
  -- that lot's own balance: A-LOT with 2, not Z-LOT's 5.
  v_pair := pg_temp.item(v_company_id, 'TT-PAIR', 'Batch');
  PERFORM pg_temp.lot(v_company_id, v_location_id, v_pair, 'Z-LOT', 5);
  PERFORM pg_temp.lot(v_company_id, v_location_id, v_pair, 'A-LOT', 2);
  v_message := pg_temp.refusal(format(
    $$UPDATE item SET "itemTrackingType" = 'Serial' WHERE id = %L$$, v_pair));
  ASSERT v_message = 'TT-PAIR has 2 on hand in batch A-LOT. A serial number holds one unit: adjust that stock before you change the tracking type to Serial.',
    format('The message must pair the lot with its own balance, got: %s', v_message);

  -- (c) Once the lot is adjusted to zero the change goes through.
  PERFORM pg_temp.stock(v_company_id, v_location_id, v_batch, -12, v_lot);
  ASSERT pg_temp.refusal(format(
    $$UPDATE item SET "itemTrackingType" = 'Inventory' WHERE id = %L$$, v_batch)) IS NULL,
    'A lot at zero must not block the change';

  -- (d) An Inventory item with 5 untracked can become Batch: the 5 become stock
  -- with no batch number, which assignBatchToUnnumberedStock numbers in place.
  -- It cannot become Serial: nothing numbers untracked stock as serials.
  v_plain := pg_temp.item(v_company_id, 'TT-PLAIN', 'Inventory');
  PERFORM pg_temp.stock(v_company_id, v_location_id, v_plain, 5, NULL);
  v_message := pg_temp.refusal(format(
    $$UPDATE item SET "itemTrackingType" = 'Serial' WHERE id = %L$$, v_plain));
  ASSERT v_message = 'TT-PLAIN still has stock with no serial number in 1 storage units (5 in total). Adjust each to zero before you change the tracking type to Serial.',
    format('Untracked stock must refuse the change to Serial, got: %s', v_message);
  ASSERT pg_temp.refusal(format(
    $$UPDATE item SET "itemTrackingType" = 'Batch' WHERE id = %L$$, v_plain)) IS NULL,
    'Untracked stock must not block the change to Batch';

  -- (e) Lots left on an item changed to Inventory before this rule are
  -- batches again when it goes back to Batch: that is how the item is repaired.
  v_stranded := pg_temp.item(v_company_id, 'TT-STRANDED', 'Inventory');
  PERFORM pg_temp.lot(v_company_id, v_location_id, v_stranded, 'LOT-OLD', 7);
  ASSERT pg_temp.refusal(format(
    $$UPDATE item SET "itemTrackingType" = 'Batch' WHERE id = %L$$, v_stranded)) IS NULL,
    'Lots on an Inventory item must not block the change back to Batch';

  -- (f) Untracked stock that nets to zero across bins (-1 with no storage unit,
  -- +1 in A-1) is still stock in two places, and the message says so.
  v_split := pg_temp.item(v_company_id, 'TT-SPLIT', 'Inventory');
  PERFORM pg_temp.stock(v_company_id, v_location_id, v_split, -1, NULL);
  PERFORM pg_temp.stock(v_company_id, v_location_id, v_split, 1, NULL, v_bin);
  v_message := pg_temp.refusal(format(
    $$UPDATE item SET "itemTrackingType" = 'Serial' WHERE id = %L$$, v_split));
  ASSERT v_message = 'TT-SPLIT still has stock with no serial number in 2 storage units (0 in total). Adjust each to zero before you change the tracking type to Serial.',
    format('Offsetting bins must refuse the change to Serial, got: %s', v_message);

  -- (f2) A lot at +5 in A-1 and -5 with no storage unit nets to zero but is
  -- stock in two places: the change to Inventory is still refused.
  v_moved := pg_temp.item(v_company_id, 'TT-MOVED', 'Batch');
  v_lot := pg_temp.lot(v_company_id, v_location_id, v_moved, 'LOT-MOVED', 0);
  PERFORM pg_temp.stock(v_company_id, v_location_id, v_moved, 5, v_lot, v_bin);
  PERFORM pg_temp.stock(v_company_id, v_location_id, v_moved, -5, v_lot);
  v_message := pg_temp.refusal(format(
    $$UPDATE item SET "itemTrackingType" = 'Inventory' WHERE id = %L$$, v_moved));
  ASSERT v_message = 'TT-MOVED still has stock in 1 batch or serial numbers (0 in total). Adjust each to zero before you change the tracking type to Inventory.',
    format('A lot split across places must refuse the change to Inventory, got: %s', v_message);

  -- (g) Lots of one unit each can become serial numbers.
  v_units := pg_temp.item(v_company_id, 'TT-UNITS', 'Batch');
  PERFORM pg_temp.lot(v_company_id, v_location_id, v_units, 'U-1', 1);
  PERFORM pg_temp.lot(v_company_id, v_location_id, v_units, 'U-2', 1);
  ASSERT pg_temp.refusal(format(
    $$UPDATE item SET "itemTrackingType" = 'Serial' WHERE id = %L$$, v_units)) IS NULL,
    'Lots of one unit must not block the change to Serial';

  -- (h) Non-Inventory holds no stock, untracked or tracked.
  v_service := pg_temp.item(v_company_id, 'TT-SERVICE', 'Inventory');
  PERFORM pg_temp.stock(v_company_id, v_location_id, v_service, 2, NULL);
  v_message := pg_temp.refusal(format(
    $$UPDATE item SET "itemTrackingType" = 'Non-Inventory' WHERE id = %L$$, v_service));
  ASSERT v_message = 'TT-SERVICE still has stock in 1 storage units or batch or serial numbers (2 in total). Adjust each to zero before you change the tracking type to Non-Inventory.',
    format('Stock must refuse the change to Non-Inventory, got: %s', v_message);

  -- (i) A negative untracked balance blocks too: it is stock to correct first.
  v_empty := pg_temp.item(v_company_id, 'TT-NEG', 'Inventory');
  PERFORM pg_temp.stock(v_company_id, v_location_id, v_empty, -1, NULL);
  ASSERT pg_temp.refusal(format(
    $$UPDATE item SET "itemTrackingType" = 'Serial' WHERE id = %L$$, v_empty)) IS NOT NULL,
    'A negative untracked balance must refuse the change';

  -- (j) An edit that leaves the tracking type alone is never refused.
  ASSERT pg_temp.refusal(format(
    $$UPDATE item SET name = 'Renamed' WHERE id = %L$$, v_empty)) IS NULL,
    'An edit of another field must not be refused';

  -- (k) A restore or seed (app.sync_in_progress) loads items as they were.
  PERFORM set_config('app.sync_in_progress', 'true', true);
  ASSERT pg_temp.refusal(format(
    $$UPDATE item SET "itemTrackingType" = 'Serial' WHERE id = %L$$, v_empty)) IS NULL,
    'A sync must not be refused';
  PERFORM set_config('app.sync_in_progress', 'false', true);

  -- (l) A material of a job In Progress cannot change: the job's issues read
  -- the copy it made at release.
  v_assembly := pg_temp.item(v_company_id, 'TT-ASSY', 'Inventory');
  v_running := pg_temp.item(v_company_id, 'TT-RUN', 'Inventory');
  PERFORM pg_temp.job(v_company_id, v_location_id, v_assembly, v_running, 'TT-J1', 'In Progress');
  v_message := pg_temp.refusal(format(
    $$UPDATE item SET "itemTrackingType" = 'Batch' WHERE id = %L$$, v_running));
  ASSERT v_message = 'TT-RUN is on released jobs that are not finished: TT-J1. Complete or cancel them before you change the tracking type.',
    format('A running job must refuse the change, got: %s', v_message);

  -- (m) The item a running job makes cannot change either.
  ASSERT pg_temp.refusal(format(
    $$UPDATE item SET "itemTrackingType" = 'Serial' WHERE id = %L$$, v_assembly)) LIKE 'TT-ASSY is on released jobs%',
    'The item a running job makes must refuse the change';

  -- (n) One blocked item refuses the whole statement.
  v_draft_part := pg_temp.item(v_company_id, 'TT-DRAFT', 'Inventory');
  ASSERT pg_temp.refusal(format(
    $$UPDATE item SET "itemTrackingType" = 'Batch' WHERE id IN (%L, %L)$$, v_draft_part, v_running)) IS NOT NULL,
    'A bulk change with one blocked item must be refused';
  ASSERT (SELECT "itemTrackingType" FROM item WHERE id = v_draft_part) = 'Inventory',
    'The free item in a refused bulk change must not be written';

  -- (o) Completed and cancelled jobs do not block; they and a Draft job take the new type.
  UPDATE job SET status = 'Completed' WHERE "jobId" = 'TT-J1' AND "companyId" = v_company_id;
  v_job := pg_temp.job(v_company_id, v_location_id, v_assembly, v_draft_part, 'TT-J2', 'Draft');
  ASSERT pg_temp.refusal(format(
    $$UPDATE item SET "itemTrackingType" = 'Batch' WHERE id IN (%L, %L)$$, v_draft_part, v_running)) IS NULL,
    'A completed job must not block the change';
  ASSERT (SELECT "requiresBatchTracking" AND NOT "requiresSerialTracking" FROM "jobMaterial"
          WHERE "jobId" = v_job AND "itemId" = v_draft_part),
    'A Draft job''s material must take the new tracking type';
  ASSERT (SELECT "requiresBatchTracking" FROM "jobMaterial" jm JOIN job j ON j.id = jm."jobId"
          WHERE j."jobId" = 'TT-J1' AND j."companyId" = v_company_id AND jm."itemId" = v_running),
    'A completed job''s material must take the new type: a reopened job issues by it';

  -- (p) The assembly a Draft job makes takes the new type on its make method.
  UPDATE job SET status = 'Cancelled' WHERE id = v_job;
  v_job := pg_temp.job(v_company_id, v_location_id, v_assembly, v_draft_part, 'TT-J3', 'Planned');
  ASSERT pg_temp.refusal(format(
    $$UPDATE item SET "itemTrackingType" = 'Serial' WHERE id = %L$$, v_assembly)) IS NULL,
    'Cancelled and Planned jobs must not block the change';
  ASSERT (SELECT "requiresSerialTracking" FROM "jobMakeMethod"
          WHERE "jobId" = v_job AND "itemId" = v_assembly AND "parentMaterialId" IS NULL),
    'A Planned job''s make method must take the new tracking type';

  -- (q) A Draft receipt's serial records were made for Serial. A change to
  -- Inventory releases them: one with no ledger history is deleted, one with
  -- history (a returned unit) only loses its receipt link.
  v_received := pg_temp.item(v_company_id, 'TT-RECEIVED', 'Serial');
  INSERT INTO receipt ("receiptId", status, "companyId", "createdBy")
    VALUES ('TT-R1', 'Draft', v_company_id, 'system') RETURNING id INTO v_receipt;
  INSERT INTO "receiptLine" ("receiptId", "itemId", "orderQuantity", "receivedQuantity", "unitOfMeasure", "unitPrice", "requiresSerialTracking", "companyId", "createdBy")
    VALUES (v_receipt, v_received, 2, 2, 'EA', 0, true, v_company_id, 'system') RETURNING id INTO v_line;
  INSERT INTO "trackedEntity" (quantity, status, "sourceDocument", "sourceDocumentId", "readableId", "itemId", attributes, "companyId", "createdBy")
    VALUES (1, 'On Hold', 'Item', v_received, 'SN-1', v_received,
      jsonb_build_object('Receipt', v_receipt, 'Receipt Line', v_line, 'Receipt Line Index', 0), v_company_id, 'system')
    RETURNING id INTO v_unit;
  INSERT INTO "trackedEntity" (quantity, status, "sourceDocument", "sourceDocumentId", "readableId", "itemId", attributes, "companyId", "createdBy")
    VALUES (1, 'On Hold', 'Item', v_received, 'SN-2', v_received,
      jsonb_build_object('Receipt', v_receipt, 'Receipt Line', v_line, 'Receipt Line Index', 1, 'Shipment', 'SHP-OLD'), v_company_id, 'system')
    RETURNING id INTO v_returned;
  -- SN-2 went out and came back: it has ledger history, netting to zero.
  PERFORM pg_temp.stock(v_company_id, v_location_id, v_received, 1, v_returned);
  PERFORM pg_temp.stock(v_company_id, v_location_id, v_received, -1, v_returned);
  ASSERT pg_temp.refusal(format(
    $$UPDATE item SET "itemTrackingType" = 'Inventory' WHERE id = %L$$, v_received)) IS NULL,
    'Receipt serials with no stock must not block the change';
  ASSERT NOT EXISTS (SELECT 1 FROM "trackedEntity" WHERE id = v_unit),
    'A receipt serial with no ledger history must be deleted';
  ASSERT (SELECT attributes FROM "trackedEntity" WHERE id = v_returned) = jsonb_build_object('Shipment', 'SHP-OLD'),
    'A receipt serial with history must keep its other attributes and lose its receipt link';
  ASSERT (SELECT NOT "requiresSerialTracking" FROM "receiptLine" WHERE id = v_line),
    'The Draft receipt line must take the new type';

  -- (r) A Draft shipment line's chosen serial was chosen for Serial. A change
  -- to Inventory (the unit holds no stock: it was scrapped) clears the choice
  -- and keeps the unit's other attributes.
  v_shipped := pg_temp.item(v_company_id, 'TT-SHIPPED', 'Serial');
  INSERT INTO shipment ("shipmentId", status, "companyId", "createdBy")
    VALUES ('TT-S1', 'Draft', v_company_id, 'system') RETURNING id INTO v_shipment;
  INSERT INTO "shipmentLine" ("shipmentId", "itemId", "shippedQuantity", "unitOfMeasure", "unitPrice", "requiresSerialTracking", "companyId", "createdBy")
    VALUES (v_shipment, v_shipped, 1, 'EA', 0, true, v_company_id, 'system') RETURNING id INTO v_ship_line;
  INSERT INTO "trackedEntity" (quantity, status, "sourceDocument", "sourceDocumentId", "readableId", "itemId", attributes, "companyId", "createdBy")
    VALUES (1, 'Scrapped', 'Item', v_shipped, 'SN-S1', v_shipped,
      jsonb_build_object('Shipment', v_shipment, 'Shipment Line', v_ship_line, 'Shipment Line Index', 0, 'Job', 'JOB-OLD'), v_company_id, 'system')
    RETURNING id INTO v_chosen;
  PERFORM pg_temp.stock(v_company_id, v_location_id, v_shipped, 1, v_chosen);
  PERFORM pg_temp.stock(v_company_id, v_location_id, v_shipped, -1, v_chosen);
  ASSERT pg_temp.refusal(format(
    $$UPDATE item SET "itemTrackingType" = 'Inventory' WHERE id = %L$$, v_shipped)) IS NULL,
    'A unit with no stock must not block the change';
  ASSERT (SELECT attributes FROM "trackedEntity" WHERE id = v_chosen) = jsonb_build_object('Job', 'JOB-OLD'),
    'The Draft shipment''s choice must be cleared and the other attributes kept';
END;
$cases$;

ROLLBACK;
