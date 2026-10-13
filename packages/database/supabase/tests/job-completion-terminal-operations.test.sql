-- Finishing the last operation on the floor receives the units that came out of
-- the routing's final operations (sync_finish_job_operation) — once, however the
-- routing ends.
-- Isolated fixture company; no existing business data is read or edited. Always rolls back.
-- Run: pnpm exec tsx scripts/run-local-accounting-check.ts psql -X -f packages/database/supabase/tests/job-completion-terminal-operations.test.sql
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

-- An operation on the job's top-level make method that runs after p_depends_on.
CREATE FUNCTION pg_temp.add_operation(
  p_job_id text, p_company_id text, p_process_id text, p_work_center_id text,
  p_quantity numeric, p_order numeric, p_depends_on text DEFAULT NULL, p_rework_id text DEFAULT NULL
) RETURNS text LANGUAGE plpgsql AS $fn$
DECLARE v_operation text;
BEGIN
  INSERT INTO "jobOperation" ("jobId", "jobMakeMethodId", "processId", "workCenterId",
      "operationQuantity", "targetQuantity", "order", status, "reworkId", "companyId", "createdBy")
    SELECT p_job_id, m.id, p_process_id, p_work_center_id,
      p_quantity, p_quantity, p_order, 'Ready', p_rework_id, p_company_id, 'system'
    FROM "jobMakeMethod" m WHERE m."jobId" = p_job_id AND m."parentMaterialId" IS NULL
    RETURNING id INTO v_operation;

  IF p_depends_on IS NOT NULL THEN
    INSERT INTO "jobOperationDependency" ("operationId", "dependsOnId", "jobId", "companyId")
      VALUES (v_operation, p_depends_on, p_job_id, p_company_id);
  END IF;

  RETURN v_operation;
END;
$fn$;

-- What the MES writes when an operator reports units on an operation.
CREATE FUNCTION pg_temp.try_report(p_operation_id text, p_type text, p_quantity numeric) RETURNS text
LANGUAGE plpgsql AS $fn$
BEGIN
  INSERT INTO "productionQuantity" ("jobOperationId", type, quantity, "companyId", "createdBy")
    SELECT p_operation_id, p_type::"productionQuantityType", p_quantity, "companyId", 'system'
    FROM "jobOperation" WHERE id = p_operation_id;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RETURN SQLERRM;
END;
$fn$;

-- The MES Finish button: Done with no quantity reported.
CREATE FUNCTION pg_temp.try_finish(p_operation_id text) RETURNS text
LANGUAGE plpgsql AS $fn$
BEGIN
  UPDATE "jobOperation" SET status = 'Done', "updatedBy" = 'system' WHERE id = p_operation_id;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RETURN SQLERRM;
END;
$fn$;

CREATE FUNCTION pg_temp.receipts(p_job_id text) RETURNS text LANGUAGE sql AS $fn$
  SELECT count(*)::text || ':' || COALESCE(sum(quantity), 0)::numeric::text
  FROM "itemLedger"
  WHERE "documentId" = p_job_id AND "documentType" = 'Job Receipt';
$fn$;

CREATE FUNCTION pg_temp.header(p_job_id text) RETURNS text LANGUAGE sql AS $fn$
  SELECT status || '@' || "quantityComplete"::numeric::text FROM job WHERE id = p_job_id;
$fn$;

DO $cases$
DECLARE
  v_group_id text; v_company_id text; v_location_id text;
  v_serial_item text; v_stocked_item text;
  v_process text; v_work_center text;
  v_job text; v_error text; v_rework text; v_account text; v_defaults jsonb;
  v_first text; v_left text; v_right text; v_last text;
BEGIN
  INSERT INTO "companyGroup" (name, "createdBy") VALUES ('Terminal ops test', 'system') RETURNING id INTO v_group_id;
  INSERT INTO company (name, "companyGroupId", "baseCurrencyCode", timezone)
    VALUES ('Terminal ops test', v_group_id, 'USD', 'UTC') RETURNING id INTO v_company_id;
  INSERT INTO location (name, "addressLine1", city, "postalCode", "companyId", "createdBy", timezone)
    VALUES ('Plant', '1 Test Way', 'Testville', '00000', v_company_id, 'system', 'UTC') RETURNING id INTO v_location_id;
  INSERT INTO "unitOfMeasure" (code, name, "companyId", "createdBy")
    VALUES ('EA', 'Each', v_company_id, 'system') ON CONFLICT DO NOTHING;
  -- Every completion journals (Provisional before a cutover): the settings row
  -- the posting reads, the journal sequence, an account and the defaults.
  INSERT INTO "companySettings" (id) VALUES (v_company_id) ON CONFLICT (id) DO NOTHING;
  INSERT INTO "sequence" ("table", name, prefix, "companyId", "updatedBy")
    VALUES ('journalEntry', 'Journal entries', 'JE-', v_company_id, 'system') ON CONFLICT DO NOTHING;
  INSERT INTO account (name, class, "accountType", "incomeBalance", "companyGroupId", "createdBy")
    VALUES ('Any', 'Asset', 'Bank', 'Balance Sheet', v_group_id, 'system') RETURNING id INTO v_account;
  SELECT jsonb_object_agg(attname, to_jsonb(v_account)) INTO v_defaults
    FROM pg_attribute WHERE attrelid = '"accountDefault"'::regclass AND attnum > 0 AND NOT attisdropped AND attnotnull AND attname <> 'companyId';
  INSERT INTO "accountDefault"
    SELECT (jsonb_populate_record(NULL::"accountDefault", v_defaults || jsonb_build_object('companyId', v_company_id))).*;
  INSERT INTO item ("readableId", name, type, "replenishmentSystem", "itemTrackingType", "unitOfMeasureCode", "companyId", "createdBy")
    VALUES ('T-STOCKED', 'Stocked assembly', 'Part', 'Make', 'Inventory', 'EA', v_company_id, 'system') RETURNING id INTO v_stocked_item;
  INSERT INTO item ("readableId", name, type, "replenishmentSystem", "itemTrackingType", "unitOfMeasureCode", "companyId", "createdBy")
    VALUES ('T-SERIAL', 'Serial machine', 'Part', 'Make', 'Serial', 'EA', v_company_id, 'system') RETURNING id INTO v_serial_item;
  INSERT INTO process (name, "processType", "defaultStandardFactor", "companyId", "createdBy")
    VALUES ('Assembly', 'Process', 'Hours/Piece', v_company_id, 'system') RETURNING id INTO v_process;
  INSERT INTO "workCenter" (name, "locationId", "laborRate", "machineRate", "overheadRate", "defaultStandardFactor", "companyId", "createdBy")
    VALUES ('Bench', v_location_id, 0, 0, 0, 'Hours/Piece', v_company_id, 'system') RETURNING id INTO v_work_center;

  -- THE BUG: a routing that ends in two parallel operations ("With Previous")
  -- has two final operations, and each reports every unit. Summing them
  -- completed the job at twice its quantity: a serial job then had too few
  -- units to receive and the last unit could never be completed in the MES.
  v_job := pg_temp.make_job(v_company_id, v_location_id, v_serial_item, 'PAR-SERIAL', 3);
  v_first := pg_temp.add_operation(v_job, v_company_id, v_process, v_work_center, 3, 1);
  v_left := pg_temp.add_operation(v_job, v_company_id, v_process, v_work_center, 3, 2, v_first);
  v_right := pg_temp.add_operation(v_job, v_company_id, v_process, v_work_center, 3, 3, v_first);

  v_error := COALESCE(pg_temp.try_report(v_first, 'Production', 3), pg_temp.try_report(v_left, 'Production', 3));
  ASSERT v_error IS NULL, 'Reporting the first operations failed: ' || COALESCE(v_error, '');
  v_error := pg_temp.try_report(v_right, 'Production', 3);
  ASSERT v_error IS NULL, 'Completing the last parallel operation failed: ' || COALESCE(v_error, '');
  ASSERT pg_temp.header(v_job) = 'Completed@3',
    'Serial job with parallel final operations completed wrong: ' || pg_temp.header(v_job);
  ASSERT pg_temp.receipts(v_job) = '3:3',
    'Serial job with parallel final operations received wrong: ' || pg_temp.receipts(v_job);

  -- The same routing on an untracked item has no units to run short of, so
  -- the double count was silent: it received twice the stock that was made.
  v_job := pg_temp.make_job(v_company_id, v_location_id, v_stocked_item, 'PAR-STOCKED', 2);
  v_first := pg_temp.add_operation(v_job, v_company_id, v_process, v_work_center, 2, 1);
  v_left := pg_temp.add_operation(v_job, v_company_id, v_process, v_work_center, 2, 2, v_first);
  v_right := pg_temp.add_operation(v_job, v_company_id, v_process, v_work_center, 2, 3, v_first);

  v_error := COALESCE(pg_temp.try_report(v_first, 'Production', 2), pg_temp.try_report(v_left, 'Production', 2),
                      pg_temp.try_report(v_right, 'Production', 2));
  ASSERT v_error IS NULL, 'Completing the stocked parallel routing failed: ' || COALESCE(v_error, '');
  ASSERT pg_temp.header(v_job) = 'Completed@2',
    'Stocked job with parallel final operations completed wrong: ' || pg_temp.header(v_job);
  ASSERT pg_temp.receipts(v_job) = '1:2',
    'Stocked job with parallel final operations received wrong: ' || pg_temp.receipts(v_job);

  -- A parallel final operation over-reported by one: only the units that came
  -- through BOTH final operations are finished, never more than the job made.
  v_job := pg_temp.make_job(v_company_id, v_location_id, v_serial_item, 'PAR-OVER', 3);
  v_first := pg_temp.add_operation(v_job, v_company_id, v_process, v_work_center, 3, 1);
  v_left := pg_temp.add_operation(v_job, v_company_id, v_process, v_work_center, 3, 2, v_first);
  v_right := pg_temp.add_operation(v_job, v_company_id, v_process, v_work_center, 3, 3, v_first);

  v_error := COALESCE(pg_temp.try_report(v_first, 'Production', 3), pg_temp.try_report(v_left, 'Production', 4),
                      pg_temp.try_report(v_right, 'Production', 3));
  ASSERT v_error IS NULL, 'Completing an over-reported parallel routing failed: ' || COALESCE(v_error, '');
  ASSERT pg_temp.receipts(v_job) = '3:3',
    'An over-reported parallel operation changed the receipt: ' || pg_temp.receipts(v_job);

  -- A parallel final operation closed with Finish and no quantity says nothing
  -- about how many units were made; the operation that did report decides.
  v_job := pg_temp.make_job(v_company_id, v_location_id, v_stocked_item, 'PAR-FINISH', 2);
  v_first := pg_temp.add_operation(v_job, v_company_id, v_process, v_work_center, 2, 1);
  v_left := pg_temp.add_operation(v_job, v_company_id, v_process, v_work_center, 2, 2, v_first);
  v_right := pg_temp.add_operation(v_job, v_company_id, v_process, v_work_center, 2, 3, v_first);

  v_error := COALESCE(pg_temp.try_report(v_first, 'Production', 2), pg_temp.try_report(v_left, 'Production', 2),
                      pg_temp.try_finish(v_right));
  ASSERT v_error IS NULL, 'Finishing a parallel operation without a quantity failed: ' || COALESCE(v_error, '');
  ASSERT pg_temp.receipts(v_job) = '1:2',
    'A quantity-less parallel Finish changed the receipt: ' || pg_temp.receipts(v_job);

  -- Rework triggered at the final operation is a separate final BRANCH that
  -- carries only the reworked units (trigger-rework): the original operation
  -- reports 2 complete + 1 reworked, the branch completes the 1. Those add up.
  v_job := pg_temp.make_job(v_company_id, v_location_id, v_stocked_item, 'REWORK', 3);
  v_first := pg_temp.add_operation(v_job, v_company_id, v_process, v_work_center, 3, 1);
  v_last := pg_temp.add_operation(v_job, v_company_id, v_process, v_work_center, 3, 2, v_first);
  INSERT INTO rework ("jobId", "triggeredAtJobOperationId", "targetJobOperationId", reason, quantity, "requestedById", "companyId")
    VALUES (v_job, v_last, v_last, 'Out of tolerance', 1, 'system', v_company_id) RETURNING id INTO v_rework;
  v_right := pg_temp.add_operation(v_job, v_company_id, v_process, v_work_center, 1, 2.5, NULL, v_rework);

  v_error := COALESCE(pg_temp.try_report(v_first, 'Production', 3), pg_temp.try_report(v_last, 'Production', 2),
                      pg_temp.try_report(v_last, 'Rework', 1));
  ASSERT v_error IS NULL, 'Reporting the reworked routing failed: ' || COALESCE(v_error, '');
  v_error := pg_temp.try_report(v_right, 'Production', 1);
  ASSERT v_error IS NULL, 'Completing the rework branch failed: ' || COALESCE(v_error, '');
  ASSERT pg_temp.header(v_job) = 'Completed@3',
    'Rework branch completed wrong: ' || pg_temp.header(v_job);
  ASSERT pg_temp.receipts(v_job) = '1:3',
    'Rework branch received wrong: ' || pg_temp.receipts(v_job);

  -- A plain single-path routing is unchanged.
  v_job := pg_temp.make_job(v_company_id, v_location_id, v_serial_item, 'LINE', 2);
  v_first := pg_temp.add_operation(v_job, v_company_id, v_process, v_work_center, 2, 1);
  v_last := pg_temp.add_operation(v_job, v_company_id, v_process, v_work_center, 2, 2, v_first);
  v_error := COALESCE(pg_temp.try_report(v_first, 'Production', 2), pg_temp.try_report(v_last, 'Production', 1),
                      pg_temp.try_report(v_last, 'Production', 1));
  ASSERT v_error IS NULL, 'Completing a single-path routing failed: ' || COALESCE(v_error, '');
  ASSERT pg_temp.header(v_job) = 'Completed@2' AND pg_temp.receipts(v_job) = '2:2',
    'Single-path routing completed wrong: ' || pg_temp.header(v_job) || ' / ' || pg_temp.receipts(v_job);

  RAISE NOTICE 'ALL TERMINAL-OPERATION CASES PASSED (parallel serial, parallel stocked, over-reported, quantity-less finish, rework branch, single path)';
END;
$cases$;

ROLLBACK;
