-- A change to item."itemTrackingType" (sync_item_tracking_type_change, a
-- statement handler on item). The database refuses the change while stock is
-- held in a form the new type cannot use, or while a released job that is not
-- finished uses the item. Otherwise the Draft and Planned jobs that copied the
-- old type take the new one.
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
  p_company_id text, p_location_id text, p_item_id text, p_quantity numeric, p_tracked_entity_id text
) RETURNS void LANGUAGE sql AS $fn$
  INSERT INTO "itemLedger" ("entryType", "itemId", quantity, "locationId", "trackedEntityId", "postingDate", "companyId", "createdBy")
  VALUES (CASE WHEN p_quantity < 0 THEN 'Negative Adjmt.' ELSE 'Positive Adjmt.' END::"itemLedgerType",
    p_item_id, p_quantity, p_location_id, p_tracked_entity_id, '2026-01-01', p_company_id, 'system');
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
  v_lot text; v_job text; v_message text;
BEGIN
  INSERT INTO "companyGroup" (name, "createdBy") VALUES ('Tracking type test', 'system') RETURNING id INTO v_group_id;
  INSERT INTO company (name, "companyGroupId", "baseCurrencyCode", timezone)
    VALUES ('Tracking type test', v_group_id, 'USD', 'UTC') RETURNING id INTO v_company_id;
  INSERT INTO location (name, "addressLine1", city, "postalCode", "companyId", "createdBy", timezone)
    VALUES ('Plant', '1 Test Way', 'Testville', '00000', v_company_id, 'system', 'UTC') RETURNING id INTO v_location_id;
  INSERT INTO "unitOfMeasure" (code, name, "companyId", "createdBy")
    VALUES ('EA', 'Each', v_company_id, 'system') ON CONFLICT DO NOTHING;

  -- (a) A batch item with 12 in one lot cannot become Inventory: untracked
  -- draws would not see the lot.
  v_batch := pg_temp.item(v_company_id, 'TT-BATCH', 'Batch');
  INSERT INTO "trackedEntity" (quantity, "sourceDocument", "sourceDocumentId", "readableId", "itemId", "companyId", "createdBy")
    VALUES (12, 'Item', v_batch, 'LOT-1', v_batch, v_company_id, 'system') RETURNING id INTO v_lot;
  PERFORM pg_temp.stock(v_company_id, v_location_id, v_batch, 12, v_lot);
  v_message := pg_temp.refusal(format(
    $$UPDATE item SET "itemTrackingType" = 'Inventory' WHERE id = %L$$, v_batch));
  ASSERT v_message = 'TT-BATCH still has 12 on hand in 1 batch or serial numbers. Adjust that stock to zero before you change the tracking type to Inventory.',
    format('Batch stock must refuse the change to Inventory, got: %s', v_message);
  ASSERT (SELECT "itemTrackingType" FROM item WHERE id = v_batch) = 'Batch', 'The refused change must not be written';

  -- (b) Once the lot is adjusted to zero the change goes through.
  PERFORM pg_temp.stock(v_company_id, v_location_id, v_batch, -12, v_lot);
  ASSERT pg_temp.refusal(format(
    $$UPDATE item SET "itemTrackingType" = 'Inventory' WHERE id = %L$$, v_batch)) IS NULL,
    'A lot at zero must not block the change';

  -- (c) An Inventory item with 5 untracked cannot become Batch or Serial:
  -- batch and serial draws would not see it.
  v_plain := pg_temp.item(v_company_id, 'TT-PLAIN', 'Inventory');
  PERFORM pg_temp.stock(v_company_id, v_location_id, v_plain, 5, NULL);
  v_message := pg_temp.refusal(format(
    $$UPDATE item SET "itemTrackingType" = 'Batch' WHERE id = %L$$, v_plain));
  ASSERT v_message = 'TT-PLAIN still has 5 on hand without a batch or serial number. Adjust that stock to zero before you change the tracking type to Batch.',
    format('Untracked stock must refuse the change to Batch, got: %s', v_message);

  -- (d) A negative untracked balance blocks too: it is stock to correct first.
  v_empty := pg_temp.item(v_company_id, 'TT-NEG', 'Inventory');
  PERFORM pg_temp.stock(v_company_id, v_location_id, v_empty, -1, NULL);
  ASSERT pg_temp.refusal(format(
    $$UPDATE item SET "itemTrackingType" = 'Serial' WHERE id = %L$$, v_empty)) IS NOT NULL,
    'A negative untracked balance must refuse the change';

  -- (e) An edit that leaves the tracking type alone is never refused.
  ASSERT pg_temp.refusal(format(
    $$UPDATE item SET name = 'Renamed' WHERE id = %L$$, v_plain)) IS NULL,
    'An edit of another field must not be refused';

  -- (f) A restore or seed (app.sync_in_progress) loads items as they were.
  PERFORM set_config('app.sync_in_progress', 'true', true);
  ASSERT pg_temp.refusal(format(
    $$UPDATE item SET "itemTrackingType" = 'Batch' WHERE id = %L$$, v_plain)) IS NULL,
    'A sync must not be refused';
  PERFORM set_config('app.sync_in_progress', 'false', true);

  -- (g) A material of a job In Progress cannot change: the job's issues read
  -- the copy it made at release.
  v_assembly := pg_temp.item(v_company_id, 'TT-ASSY', 'Inventory');
  v_running := pg_temp.item(v_company_id, 'TT-RUN', 'Inventory');
  PERFORM pg_temp.job(v_company_id, v_location_id, v_assembly, v_running, 'TT-J1', 'In Progress');
  v_message := pg_temp.refusal(format(
    $$UPDATE item SET "itemTrackingType" = 'Batch' WHERE id = %L$$, v_running));
  ASSERT v_message = 'TT-RUN is on released jobs that are not finished: TT-J1. Complete or cancel them before you change the tracking type.',
    format('A running job must refuse the change, got: %s', v_message);

  -- (h) The item a running job makes cannot change either.
  ASSERT pg_temp.refusal(format(
    $$UPDATE item SET "itemTrackingType" = 'Serial' WHERE id = %L$$, v_assembly)) LIKE 'TT-ASSY is on released jobs%',
    'The item a running job makes must refuse the change';

  -- (i) One blocked item refuses the whole statement.
  v_draft_part := pg_temp.item(v_company_id, 'TT-DRAFT', 'Inventory');
  ASSERT pg_temp.refusal(format(
    $$UPDATE item SET "itemTrackingType" = 'Batch' WHERE id IN (%L, %L)$$, v_draft_part, v_running)) IS NOT NULL,
    'A bulk change with one blocked item must be refused';
  ASSERT (SELECT "itemTrackingType" FROM item WHERE id = v_draft_part) = 'Inventory',
    'The free item in a refused bulk change must not be written';

  -- (j) Completed and cancelled jobs do not block; a Draft job takes the new type.
  UPDATE job SET status = 'Completed' WHERE "jobId" = 'TT-J1' AND "companyId" = v_company_id;
  v_job := pg_temp.job(v_company_id, v_location_id, v_assembly, v_draft_part, 'TT-J2', 'Draft');
  ASSERT pg_temp.refusal(format(
    $$UPDATE item SET "itemTrackingType" = 'Batch' WHERE id IN (%L, %L)$$, v_draft_part, v_running)) IS NULL,
    'A completed job must not block the change';
  ASSERT (SELECT "requiresBatchTracking" AND NOT "requiresSerialTracking" FROM "jobMaterial"
          WHERE "jobId" = v_job AND "itemId" = v_draft_part),
    'A Draft job''s material must take the new tracking type';
  ASSERT (SELECT NOT "requiresBatchTracking" FROM "jobMaterial" jm JOIN job j ON j.id = jm."jobId"
          WHERE j."jobId" = 'TT-J1' AND j."companyId" = v_company_id AND jm."itemId" = v_running),
    'A completed job''s material must keep its copy';

  -- (k) The assembly a Draft job makes takes the new type on its make method.
  UPDATE job SET status = 'Cancelled' WHERE id = v_job;
  v_job := pg_temp.job(v_company_id, v_location_id, v_assembly, v_draft_part, 'TT-J3', 'Planned');
  ASSERT pg_temp.refusal(format(
    $$UPDATE item SET "itemTrackingType" = 'Serial' WHERE id = %L$$, v_assembly)) IS NULL,
    'Cancelled and Planned jobs must not block the change';
  ASSERT (SELECT "requiresSerialTracking" FROM "jobMakeMethod"
          WHERE "jobId" = v_job AND "itemId" = v_assembly AND "parentMaterialId" IS NULL),
    'A Planned job''s make method must take the new tracking type';
END;
$cases$;

ROLLBACK;
