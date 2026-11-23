-- A serial unit finished on the shop floor can be issued into another job
-- (MES Issue Material) before its own job is received. The receipt at the last
-- operation must still receive it, or the job can never complete.
-- Also pins that every company posts the receipt (always-post): a company
-- without companySettings."accountingEnabled" still gets the WIP journal and
-- the output cost layer.
-- Isolated fixture company; no existing business data is read or edited. Always rolls back.
-- Run: pnpm exec tsx scripts/run-local-accounting-check.ts psql -X -f packages/database/supabase/tests/job-completion-issued-serial-units.test.sql
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL statement_timeout = '60s';

-- A released job for p_item_id with p_quantity units. Serial items keep their
-- placeholder split into numbered single units, as the item serial sequence
-- does at job creation.
CREATE FUNCTION pg_temp.make_job(
  p_company_id text, p_location_id text, p_item_id text, p_readable_id text, p_quantity numeric
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

  SELECT * INTO v_seed FROM "trackedEntity" WHERE attributes->>'Job Make Method' = v_make_method_id;
  IF v_seed.id IS NOT NULL THEN
    UPDATE "trackedEntity" SET quantity = 1, "readableId" = p_readable_id || '-01' WHERE id = v_seed.id;
    FOR n IN 2..p_quantity::int LOOP
      INSERT INTO "trackedEntity" ("sourceDocument", "sourceDocumentId", "sourceDocumentReadableId",
          quantity, status, "companyId", "createdBy", attributes, "itemId", "readableId")
        VALUES (v_seed."sourceDocument", v_seed."sourceDocumentId", v_seed."sourceDocumentReadableId",
          1, 'Reserved', p_company_id, 'system', v_seed.attributes, v_seed."itemId",
          p_readable_id || '-' || lpad(n::text, 2, '0'));
    END LOOP;
  END IF;

  UPDATE job SET status = 'In Progress' WHERE id = v_job_id;
  RETURN v_job_id;
END;
$fn$;

-- The job's single operation.
CREATE FUNCTION pg_temp.add_operation(
  p_job_id text, p_company_id text, p_process_id text, p_work_center_id text, p_quantity numeric
) RETURNS text LANGUAGE plpgsql AS $fn$
DECLARE v_operation text;
BEGIN
  INSERT INTO "jobOperation" ("jobId", "jobMakeMethodId", "processId", "workCenterId",
      "operationQuantity", "targetQuantity", "order", status, "companyId", "createdBy")
    SELECT p_job_id, m.id, p_process_id, p_work_center_id,
      p_quantity, p_quantity, 1, 'Ready', p_company_id, 'system'
    FROM "jobMakeMethod" m WHERE m."jobId" = p_job_id AND m."parentMaterialId" IS NULL
    RETURNING id INTO v_operation;
  -- An hour of finished labor, so the job carries WIP cost and its receipt
  -- books an output cost layer.
  INSERT INTO "productionEvent" ("jobOperationId", type, "startTime", "endTime", "workCenterId", "companyId", "createdBy")
    VALUES (v_operation, 'Labor', now() - interval '1 hour', now(), p_work_center_id, p_company_id, 'system');
  RETURN v_operation;
END;
$fn$;

-- What the MES writes when an operator completes ONE serial unit
-- (issue/jobOperationSerialComplete): the Production row first, then the unit
-- goes to Available with quantity 1.
CREATE FUNCTION pg_temp.try_complete_unit(p_operation_id text, p_unit_id text) RETURNS text
LANGUAGE plpgsql AS $fn$
BEGIN
  INSERT INTO "productionQuantity" ("jobOperationId", type, quantity, "companyId", "createdBy")
    SELECT p_operation_id, 'Production', 1, "companyId", 'system' FROM "jobOperation" WHERE id = p_operation_id;
  UPDATE "trackedEntity" SET status = 'Available', quantity = 1 WHERE id = p_unit_id;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RETURN SQLERRM;
END;
$fn$;

-- What leaves stock with the unit: an issue into another job
-- (issue/consumeTrackedEntitiesIntoOperation) or a scrap from the MES
-- (issue/scrapTrackedEntity) — the status, then a -1 ledger row.
CREATE FUNCTION pg_temp.take_unit(
  p_unit_id text, p_status text, p_entry_type text, p_document_type text, p_document_id text,
  p_storage_unit_id text
) RETURNS void LANGUAGE sql AS $fn$
  UPDATE "trackedEntity" SET status = p_status::"trackedEntityStatus" WHERE id = p_unit_id;
  INSERT INTO "itemLedger" ("entryType", "documentType", "documentId", "companyId", "itemId",
      quantity, "locationId", "storageUnitId", "trackedEntityId", "createdBy")
    SELECT p_entry_type::"itemLedgerType", p_document_type::"itemLedgerDocumentType", p_document_id,
      te."companyId", te."itemId", -1, j."locationId", p_storage_unit_id, te.id, 'system'
    FROM "trackedEntity" te, job j WHERE te.id = p_unit_id AND j.id = p_document_id;
$fn$;

CREATE FUNCTION pg_temp.units(p_job_id text) RETURNS text[] LANGUAGE sql AS $fn$
  SELECT array_agg(te.id ORDER BY te."readableId")
  FROM "trackedEntity" te JOIN "jobMakeMethod" m ON te.attributes->>'Job Make Method' = m.id
  WHERE m."jobId" = p_job_id AND m."parentMaterialId" IS NULL;
$fn$;

CREATE FUNCTION pg_temp.receipts(p_job_id text) RETURNS text LANGUAGE sql AS $fn$
  SELECT count(*)::text || ':' || COALESCE(sum(quantity), 0)::numeric::text
  FROM "itemLedger"
  WHERE "documentId" = p_job_id AND "documentType" = 'Job Receipt';
$fn$;

CREATE FUNCTION pg_temp.header(p_job_id text) RETURNS text LANGUAGE sql AS $fn$
  SELECT status || '@' || "quantityComplete"::numeric::text FROM job WHERE id = p_job_id;
$fn$;

-- The job's output cost layer: units booked / units still open to consume.
-- Journal lines the job's receipt posted (the WIP discharge).
CREATE FUNCTION pg_temp.receipt_journal_lines(p_job_id text) RETURNS bigint LANGUAGE sql AS $fn$
  SELECT count(*) FROM "journalLine" WHERE "documentId" = p_job_id AND "documentType" = 'Job Receipt';
$fn$;

CREATE FUNCTION pg_temp.layer(p_job_id text) RETURNS text LANGUAGE sql AS $fn$
  SELECT COALESCE(string_agg(quantity::numeric::text || '/' || "remainingQuantity"::numeric::text, ','), 'none')
  FROM "costLedger"
  WHERE "documentId" = p_job_id AND "documentType" = 'Job Receipt';
$fn$;

-- One unit's net on-hand per (location, bin): every movement of it, summed.
CREATE FUNCTION pg_temp.unit_balances(p_unit_id text) RETURNS text LANGUAGE sql AS $fn$
  SELECT COALESCE(string_agg(n::numeric::text, ',' ORDER BY n), 'none') FROM (
    SELECT sum(quantity) AS n FROM "itemLedger" WHERE "trackedEntityId" = p_unit_id
    GROUP BY "locationId", "storageUnitId"
  ) b;
$fn$;

DO $cases$
DECLARE
  v_group_id text; v_company_id text; v_location_id text; v_serial_item text;
  v_process text; v_work_center text; v_account text; v_defaults jsonb; v_line_bin text;
  v_job text; v_parent text; v_op text; v_units text[]; v_error text;
BEGIN
  INSERT INTO "companyGroup" (name, "createdBy") VALUES ('Issued serial units test', 'system') RETURNING id INTO v_group_id;
  INSERT INTO company (name, "companyGroupId", "baseCurrencyCode", timezone)
    VALUES ('Issued serial units test', v_group_id, 'USD', 'UTC') RETURNING id INTO v_company_id;
  INSERT INTO location (name, "addressLine1", city, "postalCode", "companyId", "createdBy", timezone)
    VALUES ('Plant', '1 Test Way', 'Testville', '00000', v_company_id, 'system', 'UTC') RETURNING id INTO v_location_id;
  INSERT INTO "unitOfMeasure" (code, name, "companyId", "createdBy")
    VALUES ('EA', 'Each', v_company_id, 'system') ON CONFLICT DO NOTHING;
  -- Every completion journals (Provisional before a cutover): the settings row
  -- the posting reads, the journal sequence, an account and the defaults —
  -- every default account, so labor is absorbed into WIP.
  INSERT INTO "companySettings" (id) VALUES (v_company_id) ON CONFLICT (id) DO NOTHING;
  -- The legacy flag is off: since the accounting cutover every company posts,
  -- and nothing may skip the receipt's journal or cost layer for it.
  UPDATE "companySettings" SET "accountingEnabled" = false WHERE id = v_company_id;
  INSERT INTO "sequence" ("table", name, prefix, "companyId", "updatedBy")
    VALUES ('journalEntry', 'Journal entries', 'JE-', v_company_id, 'system') ON CONFLICT DO NOTHING;
  INSERT INTO account (name, class, "accountType", "incomeBalance", "companyGroupId", "createdBy")
    VALUES ('Any', 'Asset', 'Bank', 'Balance Sheet', v_group_id, 'system') RETURNING id INTO v_account;
  SELECT jsonb_object_agg(attname, to_jsonb(v_account)) INTO v_defaults
    FROM pg_attribute WHERE attrelid = '"accountDefault"'::regclass AND attnum > 0 AND NOT attisdropped AND (attnotnull OR attname LIKE '%Account') AND attname <> 'companyId';
  INSERT INTO "accountDefault"
    SELECT (jsonb_populate_record(NULL::"accountDefault", v_defaults || jsonb_build_object('companyId', v_company_id))).*;
  -- WIP on its own account: on the shared one, the labor posting's debit and
  -- credit would cancel and the job would carry no cost.
  INSERT INTO account (name, class, "accountType", "incomeBalance", "companyGroupId", "createdBy")
    VALUES ('WIP', 'Asset', 'Inventory', 'Balance Sheet', v_group_id, 'system') RETURNING id INTO v_account;
  UPDATE "accountDefault" SET "workInProgressAccount" = v_account WHERE "companyId" = v_company_id;
  INSERT INTO item ("readableId", name, type, "replenishmentSystem", "itemTrackingType", "unitOfMeasureCode", "companyId", "createdBy")
    VALUES ('T-SERIAL', 'Serial sub-assembly', 'Part', 'Make', 'Serial', 'EA', v_company_id, 'system') RETURNING id INTO v_serial_item;
  INSERT INTO process (name, "processType", "defaultStandardFactor", "companyId", "createdBy")
    VALUES ('Assembly', 'Process', 'Hours/Piece', v_company_id, 'system') RETURNING id INTO v_process;
  INSERT INTO "workCenter" (name, "locationId", "laborRate", "machineRate", "overheadRate", "defaultStandardFactor", "companyId", "createdBy")
    VALUES ('Bench', v_location_id, 30, 0, 0, 'Hours/Piece', v_company_id, 'system') RETURNING id INTO v_work_center;

  INSERT INTO "storageUnit" (name, "locationId", "companyId", "createdBy")
    VALUES ('Lineside', v_location_id, v_company_id, 'system') RETURNING id INTO v_line_bin;
  v_parent := pg_temp.make_job(v_company_id, v_location_id, v_serial_item, 'PARENT', 1);

  -- No unit leaves early: every unit is received, and stays open in the layer.
  v_job := pg_temp.make_job(v_company_id, v_location_id, v_serial_item, 'ALL-HERE', 3);
  v_op := pg_temp.add_operation(v_job, v_company_id, v_process, v_work_center, 3);
  v_units := pg_temp.units(v_job);
  v_error := COALESCE(pg_temp.try_complete_unit(v_op, v_units[1]), pg_temp.try_complete_unit(v_op, v_units[2]),
                      pg_temp.try_complete_unit(v_op, v_units[3]));
  ASSERT v_error IS NULL, 'Completing a job with every unit in hand failed: ' || COALESCE(v_error, '');
  ASSERT pg_temp.header(v_job) = 'Completed@3' AND pg_temp.receipts(v_job) = '3:3',
    'Job with every unit in hand completed wrong: ' || pg_temp.header(v_job) || ' / ' || pg_temp.receipts(v_job);
  ASSERT pg_temp.layer(v_job) = '3/3', 'Its cost layer is wrong: ' || pg_temp.layer(v_job);
  ASSERT pg_temp.receipt_journal_lines(v_job) > 0,
    'The receipt posted no journal for a company without accountingEnabled';

  -- THE BUG: after 2 units are finished, an operator issues unit 1 into the
  -- parent job. The last unit then could never be completed: the receipt
  -- skipped the issued unit and found 2 units for 3.
  v_job := pg_temp.make_job(v_company_id, v_location_id, v_serial_item, 'ISSUED', 3);
  v_op := pg_temp.add_operation(v_job, v_company_id, v_process, v_work_center, 3);
  v_units := pg_temp.units(v_job);
  v_error := COALESCE(pg_temp.try_complete_unit(v_op, v_units[1]), pg_temp.try_complete_unit(v_op, v_units[2]));
  ASSERT v_error IS NULL, 'Completing the first two units failed: ' || COALESCE(v_error, '');
  PERFORM pg_temp.take_unit(v_units[1], 'Consumed', 'Consumption', 'Job Consumption', v_parent, v_line_bin);

  v_error := pg_temp.try_complete_unit(v_op, v_units[3]);
  ASSERT v_error IS NULL, 'Completing the last unit after one was issued failed: ' || COALESCE(v_error, '');
  ASSERT pg_temp.header(v_job) = 'Completed@3' AND pg_temp.receipts(v_job) = '3:3',
    'Job with an issued unit completed wrong: ' || pg_temp.header(v_job) || ' / ' || pg_temp.receipts(v_job);
  -- The issued unit stays where it went; the receipt lands in the bin it left
  -- from, so its own movements net to nothing there.
  ASSERT (SELECT status FROM "trackedEntity" WHERE id = v_units[1]) = 'Consumed',
    'The issued unit was brought back to Available';
  ASSERT pg_temp.unit_balances(v_units[1]) = '0',
    'The issued unit does not net to zero per bin: ' || pg_temp.unit_balances(v_units[1]);
  ASSERT (SELECT bool_and(status = 'Available') FROM "trackedEntity" WHERE id = ANY(v_units[2:3])),
    'The units still in hand were not received to Available';
  -- Only the 2 units still in stock stay open to be consumed.
  ASSERT pg_temp.layer(v_job) = '3/2', 'The cost layer still counts the issued unit: ' || pg_temp.layer(v_job);

  -- A scrapped unit is a loss, not an issue: it is still never received, so a
  -- count that includes it is still refused.
  v_job := pg_temp.make_job(v_company_id, v_location_id, v_serial_item, 'SCRAPPED', 2);
  v_op := pg_temp.add_operation(v_job, v_company_id, v_process, v_work_center, 2);
  v_units := pg_temp.units(v_job);
  v_error := pg_temp.try_complete_unit(v_op, v_units[1]);
  ASSERT v_error IS NULL, 'Completing the first unit failed: ' || COALESCE(v_error, '');
  PERFORM pg_temp.take_unit(v_units[1], 'Scrapped', 'Negative Adjmt.', 'Scrap', v_parent, NULL);
  v_error := pg_temp.try_complete_unit(v_op, v_units[2]);
  ASSERT v_error LIKE 'Job SCRAPPED has 1 serial unit(s) left to receive, fewer than the 2 being completed%',
    'A scrapped unit must still not be received, got: ' || COALESCE(v_error, 'success');

  RAISE NOTICE 'ALL ISSUED-SERIAL-UNIT CASES PASSED (all in hand + always-post, one issued, one scrapped)';
END;
$cases$;

ROLLBACK;
