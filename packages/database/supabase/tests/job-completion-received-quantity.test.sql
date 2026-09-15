-- Job completion receives exactly the completed quantity (complete_job_to_inventory).
-- Isolated fixture company; no existing business data is read or edited. Always rolls back.
-- Run: pnpm exec tsx scripts/run-local-accounting-check.ts psql -X -f packages/database/supabase/tests/job-completion-received-quantity.test.sql
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL statement_timeout = '60s';

-- A job for p_item_id with p_quantity units. For a serial item, p_split splits
-- the job's serial placeholder into numbered single units (<job>-01, -02, ...),
-- as the item serial sequence does at job creation; otherwise the placeholder is
-- left as created. Every job consumes 2 of p_part_id per unit, pulled from
-- inventory.
CREATE FUNCTION pg_temp.make_job(
  p_company_id text, p_location_id text, p_item_id text, p_part_id text,
  p_readable_id text, p_quantity numeric, p_split boolean DEFAULT true
) RETURNS text LANGUAGE plpgsql AS $fn$
DECLARE
  v_job_id text;
  v_make_method_id text;
  v_seed record;
BEGIN
  INSERT INTO job ("jobId", "itemId", quantity, "locationId", "companyId", "createdBy", "unitOfMeasureCode")
    VALUES (p_readable_id, p_item_id, p_quantity, p_location_id, p_company_id, 'system', 'EA')
    RETURNING id INTO v_job_id;

  SELECT id INTO STRICT v_make_method_id
  FROM "jobMakeMethod" WHERE "jobId" = v_job_id AND "parentMaterialId" IS NULL;

  INSERT INTO "jobMaterial" ("jobId", "jobMakeMethodId", "itemId", description, "methodType",
      "itemType", quantity, "estimatedQuantity", "companyId", "createdBy")
    VALUES (v_job_id, v_make_method_id, p_part_id, 'Stocked part', 'Pull from Inventory',
      'Part', 2, 2 * p_quantity, p_company_id, 'system');

  SELECT * INTO v_seed FROM "trackedEntity" WHERE attributes->>'Job Make Method' = v_make_method_id;
  IF v_seed.id IS NOT NULL AND p_split THEN
    UPDATE "trackedEntity" SET quantity = 1, "readableId" = p_readable_id || '-01' WHERE id = v_seed.id;
    FOR n IN 2..p_quantity::int LOOP
      INSERT INTO "trackedEntity" ("sourceDocument", "sourceDocumentId", "sourceDocumentReadableId",
          quantity, status, "companyId", "createdBy", attributes, "itemId", "readableId")
        VALUES (v_seed."sourceDocument", v_seed."sourceDocumentId", v_seed."sourceDocumentReadableId",
          1, 'Reserved', p_company_id, 'system', v_seed.attributes, v_seed."itemId",
          p_readable_id || '-' || lpad(n::text, 2, '0'));
    END LOOP;
  END IF;

  RETURN v_job_id;
END;
$fn$;

-- Completes the job; returns the error message, or NULL when it succeeded.
-- The exception block rolls a refused completion back, so state is unchanged.
CREATE FUNCTION pg_temp.try_complete(p_job_id text, p_quantity numeric) RETURNS text
LANGUAGE plpgsql AS $fn$
DECLARE v_job record;
BEGIN
  SELECT * INTO STRICT v_job FROM job WHERE id = p_job_id;
  PERFORM complete_job_to_inventory(p_job_id, p_quantity, NULL, v_job."locationId", v_job."companyId", 'system');
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RETURN SQLERRM;
END;
$fn$;

-- "<serial>:<status>:<units received>" for every serial on the job, by serial number.
CREATE FUNCTION pg_temp.serials(p_job_id text) RETURNS text LANGUAGE sql AS $fn$
  SELECT string_agg(COALESCE(te."readableId", 'unnumbered') || ':' || te.status || ':' ||
      COALESCE((SELECT sum(il.quantity) FROM "itemLedger" il
        WHERE il."trackedEntityId" = te.id AND il."documentType" = 'Job Receipt'
          AND il."documentId" = p_job_id), 0)::int,
    ',' ORDER BY te."readableId")
  FROM "trackedEntity" te
  JOIN "jobMakeMethod" m ON m.id = te.attributes->>'Job Make Method' AND m."parentMaterialId" IS NULL
  WHERE m."jobId" = p_job_id;
$fn$;

-- Rounded to the internal quantity scale: backflush prorates by a ratio such as
-- 2/3, which leaves float noise far below it.
CREATE FUNCTION pg_temp.issued(p_job_id text) RETURNS numeric LANGUAGE sql AS $fn$
  SELECT round(sum("quantityIssued"), 5) FROM "jobMaterial" WHERE "jobId" = p_job_id;
$fn$;

-- Marks a job operation Done; returns the error message, or NULL when it
-- succeeded. The Done update runs the sync_finish_job_operation interceptor.
CREATE FUNCTION pg_temp.try_finish_operation(p_operation_id text) RETURNS text
LANGUAGE plpgsql AS $fn$
BEGIN
  UPDATE "jobOperation" SET status = 'Done' WHERE id = p_operation_id;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RETURN SQLERRM;
END;
$fn$;

-- Net WIP posted against a job.
CREATE FUNCTION pg_temp.wip(p_job_id text, p_wip_account text) RETURNS numeric LANGUAGE sql AS $fn$
  SELECT round(COALESCE(sum(amount), 0), 5) FROM "journalLine"
  WHERE "documentId" = p_job_id AND "accountId" = p_wip_account;
$fn$;

DO $cases$
DECLARE
  v_group_id text; v_company_id text; v_location_id text;
  v_serial_item text; v_stocked_item text; v_service_item text; v_part text;
  v_job text; v_error text; v_row record;
  v_process text; v_work_center text; v_operation text; v_defaults jsonb;
  v_wip_account text; v_finished_account text; v_labor_account text; v_other_account text;
  v_receipt_journals int; v_cost_layers int;
BEGIN
  INSERT INTO "companyGroup" (name, "createdBy") VALUES ('Job completion test', 'system') RETURNING id INTO v_group_id;
  INSERT INTO company (name, "companyGroupId", "baseCurrencyCode", timezone)
    VALUES ('Job completion test', v_group_id, 'USD', 'UTC') RETURNING id INTO v_company_id;
  INSERT INTO location (name, "addressLine1", city, "postalCode", "companyId", "createdBy", timezone)
    VALUES ('Plant', '1 Test Way', 'Testville', '00000', v_company_id, 'system', 'UTC') RETURNING id INTO v_location_id;
  INSERT INTO "unitOfMeasure" (code, name, "companyId", "createdBy")
    VALUES ('EA', 'Each', v_company_id, 'system') ON CONFLICT DO NOTHING;
  INSERT INTO item ("readableId", name, type, "replenishmentSystem", "itemTrackingType", "unitOfMeasureCode", "companyId", "createdBy")
    VALUES ('T-SERIAL', 'Serial machine', 'Part', 'Make', 'Serial', 'EA', v_company_id, 'system') RETURNING id INTO v_serial_item;
  INSERT INTO item ("readableId", name, type, "replenishmentSystem", "itemTrackingType", "unitOfMeasureCode", "companyId", "createdBy")
    VALUES ('T-STOCKED', 'Stocked assembly', 'Part', 'Make', 'Inventory', 'EA', v_company_id, 'system') RETURNING id INTO v_stocked_item;
  INSERT INTO item ("readableId", name, type, "replenishmentSystem", "itemTrackingType", "unitOfMeasureCode", "companyId", "createdBy")
    VALUES ('T-SERVICE', 'Service', 'Part', 'Make', 'Non-Inventory', 'EA', v_company_id, 'system') RETURNING id INTO v_service_item;
  INSERT INTO item ("readableId", name, type, "replenishmentSystem", "itemTrackingType", "unitOfMeasureCode", "companyId", "createdBy")
    VALUES ('T-PART', 'Stocked part', 'Part', 'Buy', 'Inventory', 'EA', v_company_id, 'system') RETURNING id INTO v_part;

  -- Serial job: refusals leave the job untouched.
  v_job := pg_temp.make_job(v_company_id, v_location_id, v_serial_item, v_part, 'SJ', 3);
  v_error := pg_temp.try_complete(v_job, 0);
  ASSERT v_error LIKE 'Quantity completed must be greater than 0%', 'Serial job at 0 must be refused, got: ' || COALESCE(v_error, 'success');
  v_error := pg_temp.try_complete(v_job, 1.5);
  ASSERT v_error LIKE 'Quantity completed must be a whole number%', 'Serial job at 1.5 must be refused, got: ' || COALESCE(v_error, 'success');
  ASSERT pg_temp.serials(v_job) = 'SJ-01:Reserved:0,SJ-02:Reserved:0,SJ-03:Reserved:0', 'Refusals must not receive units: ' || pg_temp.serials(v_job);
  ASSERT (SELECT status FROM job WHERE id = v_job) <> 'Completed', 'Refusals must not complete the job';

  -- Completing 2 of 3 receives exactly 2 units and consumes for 2 units.
  v_error := pg_temp.try_complete(v_job, 2);
  ASSERT v_error IS NULL, 'Serial job at 2 failed: ' || COALESCE(v_error, '');
  ASSERT pg_temp.serials(v_job) = 'SJ-01:Available:1,SJ-02:Available:1,SJ-03:Reserved:0', 'Completing 2 must receive exactly 2 units: ' || pg_temp.serials(v_job);
  SELECT status, "quantityComplete", "quantityReceivedToInventory" INTO v_row FROM job WHERE id = v_job;
  ASSERT v_row.status = 'Completed' AND v_row."quantityComplete" = 2 AND v_row."quantityReceivedToInventory" = 2, 'Job must record 2 completed and received';
  ASSERT pg_temp.issued(v_job) = 4, 'Backflush must consume for 2 units: ' || pg_temp.issued(v_job);

  -- Completing the rest receives only the remaining unit.
  v_error := pg_temp.try_complete(v_job, 3);
  ASSERT v_error IS NULL, 'Serial job at 3 failed: ' || COALESCE(v_error, '');
  ASSERT pg_temp.serials(v_job) = 'SJ-01:Available:1,SJ-02:Available:1,SJ-03:Available:1', 'Completing 3 must receive the third unit once: ' || pg_temp.serials(v_job);
  ASSERT pg_temp.issued(v_job) = 6, 'Backflush must consume for 3 units: ' || pg_temp.issued(v_job);

  -- Completing again at the same quantity receives and consumes nothing more.
  v_error := pg_temp.try_complete(v_job, 3);
  ASSERT v_error IS NULL, 'Re-completion failed: ' || COALESCE(v_error, '');
  ASSERT pg_temp.serials(v_job) = 'SJ-01:Available:1,SJ-02:Available:1,SJ-03:Available:1', 'Re-completion must not receive a unit twice: ' || pg_temp.serials(v_job);
  ASSERT pg_temp.issued(v_job) = 6, 'Re-completion must not consume again: ' || pg_temp.issued(v_job);

  -- The quantity is cumulative: it cannot drop below what was already received.
  v_error := pg_temp.try_complete(v_job, 2);
  ASSERT v_error LIKE 'Quantity completed cannot be lower than the 3 already received%', 'Lowering a serial job below its receipts must be refused, got: ' || COALESCE(v_error, 'success');
  SELECT "quantityComplete", "quantityReceivedToInventory" INTO v_row FROM job WHERE id = v_job;
  ASSERT v_row."quantityComplete" = 3 AND v_row."quantityReceivedToInventory" = 3, 'A refused lower quantity must leave the job at 3';

  -- A unit finished on the shop floor is received ahead of lower serial numbers.
  v_job := pg_temp.make_job(v_company_id, v_location_id, v_serial_item, v_part, 'MJ', 3);
  UPDATE "trackedEntity" SET status = 'Available' WHERE "readableId" = 'MJ-03' AND "companyId" = v_company_id;
  v_error := pg_temp.try_complete(v_job, 1);
  ASSERT v_error IS NULL, 'Mixed job at 1 failed: ' || COALESCE(v_error, '');
  ASSERT pg_temp.serials(v_job) = 'MJ-01:Reserved:0,MJ-02:Reserved:0,MJ-03:Available:1', 'The shop-floor unit must be received first: ' || pg_temp.serials(v_job);

  -- A scrapped unit is never received, and completing more units than are left
  -- is refused rather than recording units the ledger never received.
  v_job := pg_temp.make_job(v_company_id, v_location_id, v_serial_item, v_part, 'XJ', 2);
  UPDATE "trackedEntity" SET status = 'Scrapped' WHERE "readableId" = 'XJ-01' AND "companyId" = v_company_id;
  v_error := pg_temp.try_complete(v_job, 2);
  ASSERT v_error LIKE 'Job XJ has 1 serial unit(s) left to receive, fewer than the 2 being completed%', 'Completing more units than are left must be refused, got: ' || COALESCE(v_error, 'success');
  ASSERT pg_temp.serials(v_job) = 'XJ-01:Scrapped:0,XJ-02:Reserved:0', 'A refused completion must not receive units: ' || pg_temp.serials(v_job);
  v_error := pg_temp.try_complete(v_job, 1);
  ASSERT v_error IS NULL, 'Scrap job at 1 failed: ' || COALESCE(v_error, '');
  ASSERT pg_temp.serials(v_job) = 'XJ-01:Scrapped:0,XJ-02:Available:1', 'A scrapped unit must not be received: ' || pg_temp.serials(v_job);

  -- An item with no serial sequence keeps one seed entity covering every unit.
  -- It is received as a whole, so marking the last operation Done never raises
  -- out of sync_finish_job_operation's BEFORE trigger.
  v_job := pg_temp.make_job(v_company_id, v_location_id, v_serial_item, v_part, 'UJ', 2, false);
  v_error := pg_temp.try_complete(v_job, 1);
  ASSERT v_error IS NULL, 'Unsplit seed job at 1 failed: ' || COALESCE(v_error, '');
  ASSERT (SELECT sum(quantity) FROM "itemLedger" WHERE "documentId" = v_job AND "documentType" = 'Job Receipt') = 1,
    'The seed entity must receive exactly 1';
  ASSERT pg_temp.issued(v_job) = 2, 'Backflush must consume for 1 unit: ' || pg_temp.issued(v_job);
  v_error := pg_temp.try_complete(v_job, 2);
  ASSERT v_error IS NULL, 'Unsplit seed job at 2 failed: ' || COALESCE(v_error, '');
  ASSERT (SELECT sum(quantity) FROM "itemLedger" WHERE "documentId" = v_job AND "documentType" = 'Job Receipt') = 2,
    'The second completion must receive only the delta';
  ASSERT pg_temp.issued(v_job) = 4, 'Backflush must consume for 2 units: ' || pg_temp.issued(v_job);

  -- A single-unit job without a serial sequence still completes (e.g. every
  -- operation marked Done), receiving its one unnumbered unit.
  v_job := pg_temp.make_job(v_company_id, v_location_id, v_serial_item, v_part, 'OJ', 1, false);
  v_error := pg_temp.try_complete(v_job, 1);
  ASSERT v_error IS NULL, 'Single-unit unsplit job at 1 failed: ' || COALESCE(v_error, '');
  ASSERT pg_temp.serials(v_job) = 'unnumbered:Available:1', 'The single unnumbered unit must be received once: ' || pg_temp.serials(v_job);

  -- Inventory-tracked job: fractions are allowed, zero is refused.
  v_job := pg_temp.make_job(v_company_id, v_location_id, v_stocked_item, v_part, 'IJ', 2);
  v_error := pg_temp.try_complete(v_job, 0);
  ASSERT v_error LIKE 'Quantity completed must be greater than 0%', 'Inventory job at 0 must be refused, got: ' || COALESCE(v_error, 'success');
  v_error := pg_temp.try_complete(v_job, 1.5);
  ASSERT v_error IS NULL, 'Inventory job at 1.5 failed: ' || COALESCE(v_error, '');
  ASSERT (SELECT sum(quantity) FROM "itemLedger" WHERE "documentId" = v_job AND "documentType" = 'Job Receipt') = 1.5, 'Inventory job must receive 1.5';
  ASSERT pg_temp.issued(v_job) = 3, 'Inventory job must consume for 1.5 units: ' || pg_temp.issued(v_job);

  -- Every stocked job, not only serial: the cumulative quantity cannot drop below
  -- what was received, and re-completing at it posts no zero-quantity receipt.
  v_error := pg_temp.try_complete(v_job, 1);
  ASSERT v_error LIKE 'Quantity completed cannot be lower than the 1.5 already received%', 'Lowering an inventory job below its receipts must be refused, got: ' || COALESCE(v_error, 'success');
  v_error := pg_temp.try_complete(v_job, 1.5);
  ASSERT v_error IS NULL, 'Inventory re-completion failed: ' || COALESCE(v_error, '');
  ASSERT (SELECT count(*) FROM "itemLedger" WHERE "documentId" = v_job AND "documentType" = 'Job Receipt') = 1, 'Re-completion must not post another receipt';

  -- Reopened job: marking its last operation Done with fewer completions than
  -- were received completes it at the received quantity instead of being refused.
  INSERT INTO process (name, "processType", "defaultStandardFactor", "companyId", "createdBy")
    VALUES ('Assembly', 'Process', 'Hours/Piece', v_company_id, 'system') RETURNING id INTO v_process;
  INSERT INTO "workCenter" (name, "locationId", "laborRate", "machineRate", "overheadRate", "defaultStandardFactor", "companyId", "createdBy")
    VALUES ('Bench', v_location_id, 50, 0, 0, 'Hours/Piece', v_company_id, 'system') RETURNING id INTO v_work_center;
  UPDATE job SET status = 'In Progress' WHERE id = v_job;
  INSERT INTO "jobOperation" ("jobId", "jobMakeMethodId", "processId", "workCenterId", "operationQuantity", "quantityComplete", status, "companyId", "createdBy")
    SELECT v_job, m.id, v_process, v_work_center, 2, 1, 'In Progress', v_company_id, 'system'
    FROM "jobMakeMethod" m WHERE m."jobId" = v_job AND m."parentMaterialId" IS NULL
    RETURNING id INTO v_operation;
  v_error := pg_temp.try_finish_operation(v_operation);
  ASSERT v_error IS NULL, 'Finishing the last operation of a reopened job failed: ' || COALESCE(v_error, '');
  SELECT status, "quantityComplete", "quantityReceivedToInventory" INTO v_row FROM job WHERE id = v_job;
  ASSERT v_row.status = 'Completed' AND v_row."quantityComplete" = 1.5 AND v_row."quantityReceivedToInventory" = 1.5, 'The reopened job must complete at the 1.5 already received';
  ASSERT (SELECT sum(quantity) FROM "itemLedger" WHERE "documentId" = v_job AND "documentType" = 'Job Receipt') = 1.5, 'Finishing the reopened job must not change its receipts';

  -- Non-Inventory (service) job may still complete at zero.
  v_job := pg_temp.make_job(v_company_id, v_location_id, v_service_item, v_part, 'NJ', 1);
  v_error := pg_temp.try_complete(v_job, 0);
  ASSERT v_error IS NULL, 'Non-Inventory job at 0 must be allowed, got: ' || COALESCE(v_error, '');
  ASSERT (SELECT status FROM job WHERE id = v_job) = 'Completed', 'Non-Inventory job must complete';

  -- Accounting enabled: labor logged after a completion stays in WIP when the job
  -- is re-completed at the received quantity, and is discharged with the next
  -- receipt. Before, the zero-quantity re-completion divided that WIP by zero.
  UPDATE "companySettings" SET "accountingEnabled" = true WHERE id = v_company_id;
  IF NOT FOUND THEN
    INSERT INTO "companySettings" (id, "accountingEnabled") VALUES (v_company_id, true);
  END IF;
  INSERT INTO "sequence" ("table", name, prefix, "companyId", "updatedBy")
    VALUES ('journalEntry', 'Journal entries', 'JE-', v_company_id, 'system') ON CONFLICT DO NOTHING;
  INSERT INTO account (name, class, "accountType", "incomeBalance", "companyGroupId", "createdBy")
    VALUES ('WIP', 'Asset', 'Bank', 'Balance Sheet', v_group_id, 'system') RETURNING id INTO v_wip_account;
  INSERT INTO account (name, class, "accountType", "incomeBalance", "companyGroupId", "createdBy")
    VALUES ('Finished goods', 'Asset', 'Bank', 'Balance Sheet', v_group_id, 'system') RETURNING id INTO v_finished_account;
  INSERT INTO account (name, class, "accountType", "incomeBalance", "companyGroupId", "createdBy")
    VALUES ('Labor absorption', 'Expense', 'Expense', 'Income Statement', v_group_id, 'system') RETURNING id INTO v_labor_account;
  INSERT INTO account (name, class, "accountType", "incomeBalance", "companyGroupId", "createdBy")
    VALUES ('Other', 'Expense', 'Expense', 'Income Statement', v_group_id, 'system') RETURNING id INTO v_other_account;
  SELECT jsonb_object_agg(attname, to_jsonb(v_other_account)) INTO v_defaults
    FROM pg_attribute WHERE attrelid = '"accountDefault"'::regclass AND attnum > 0 AND NOT attisdropped AND attnotnull AND attname <> 'companyId';
  INSERT INTO "accountDefault" SELECT (jsonb_populate_record(NULL::"accountDefault", v_defaults || jsonb_build_object(
    'companyId', v_company_id, 'workInProgressAccount', v_wip_account, 'finishedGoodsAccount', v_finished_account,
    'laborAbsorptionAccount', v_labor_account))).*;

  v_job := pg_temp.make_job(v_company_id, v_location_id, v_stocked_item, v_part, 'AJ', 2);
  INSERT INTO "jobOperation" ("jobId", "jobMakeMethodId", "processId", "workCenterId", "operationQuantity", status, "companyId", "createdBy")
    SELECT v_job, m.id, v_process, v_work_center, 2, 'In Progress', v_company_id, 'system'
    FROM "jobMakeMethod" m WHERE m."jobId" = v_job AND m."parentMaterialId" IS NULL
    RETURNING id INTO v_operation;
  v_error := pg_temp.try_complete(v_job, 2);
  ASSERT v_error IS NULL, 'Accounting job at 2 failed: ' || COALESCE(v_error, '');
  ASSERT pg_temp.wip(v_job, v_wip_account) = 0, 'No WIP before labor is logged: ' || pg_temp.wip(v_job, v_wip_account);

  -- One hour of labor at 50, logged after the completion and not yet posted.
  INSERT INTO "productionEvent" ("jobOperationId", "workCenterId", type, "startTime", "endTime", "companyId", "createdBy")
    VALUES (v_operation, v_work_center, 'Labor', now() - interval '1 hour', now(), v_company_id, 'system');
  SELECT count(*) INTO v_receipt_journals FROM journal WHERE "companyId" = v_company_id AND "sourceType" = 'Job Receipt';
  SELECT count(*) INTO v_cost_layers FROM "costLedger" WHERE "documentId" = v_job;

  v_error := pg_temp.try_complete(v_job, 2);
  ASSERT v_error IS NULL, 'Zero-delta re-completion with catch-up WIP failed: ' || COALESCE(v_error, '');
  ASSERT NOT EXISTS (SELECT 1 FROM "productionEvent" WHERE "jobOperationId" = v_operation AND "postedToGL" = false), 'The catch-up labor must be posted';
  ASSERT pg_temp.wip(v_job, v_wip_account) = 50, 'The catch-up labor must stay in WIP: ' || pg_temp.wip(v_job, v_wip_account);
  ASSERT (SELECT count(*) FROM journal WHERE "companyId" = v_company_id AND "sourceType" = 'Job Receipt') = v_receipt_journals, 'A zero-delta re-completion must not post a receipt journal';
  ASSERT (SELECT count(*) FROM "costLedger" WHERE "documentId" = v_job) = v_cost_layers, 'A zero-delta re-completion must not add a cost layer';

  v_error := pg_temp.try_complete(v_job, 1);
  ASSERT v_error LIKE 'Quantity completed cannot be lower than the 2 already received%', 'Lowering an accounting job must be refused, got: ' || COALESCE(v_error, 'success');
  ASSERT pg_temp.wip(v_job, v_wip_account) = 50, 'A refused completion must not move WIP';

  v_error := pg_temp.try_complete(v_job, 3);
  ASSERT v_error IS NULL, 'Accounting job at 3 failed: ' || COALESCE(v_error, '');
  ASSERT pg_temp.wip(v_job, v_wip_account) = 0, 'The next receipt must discharge the WIP: ' || pg_temp.wip(v_job, v_wip_account);
  ASSERT (SELECT count(*) FROM "costLedger" WHERE "documentId" = v_job AND quantity = 1 AND cost = 50) = 1, 'The next receipt must carry the WIP into one cost layer';

  RAISE NOTICE 'ALL JOB COMPLETION CASES PASSED (zero/fraction/lower refusal, partial and full serial receipt, re-completion, shop-floor-first, scrapped, too few units, unsplit placeholders, inventory lower/re-completion, reopened last operation, non-inventory, accounting zero-delta with catch-up WIP)';
END;
$cases$;
ROLLBACK;
