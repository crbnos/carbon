-- Marking a job complete completes its operations' quantities
-- (complete_job_to_inventory -> complete_job_remaining_quantities).
-- Isolated fixture company; no existing business data is read or edited. Always rolls back.
-- Run: pnpm exec tsx scripts/run-local-accounting-check.ts psql -X -f packages/database/supabase/tests/job-completion-operation-quantities.test.sql
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL statement_timeout = '60s';

-- A job for p_item_id with p_quantity units, consuming 2 of p_part_id per unit.
-- Serial items keep their placeholder split into numbered single units, as the
-- item serial sequence does at job creation.
CREATE FUNCTION pg_temp.make_job(
  p_company_id text, p_location_id text, p_item_id text, p_part_id text,
  p_readable_id text, p_quantity numeric
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

  RETURN v_job_id;
END;
$fn$;

-- Adds an operation to the job's top-level make method, or to a sub-assembly
-- make method when p_parent_material_id is given.
CREATE FUNCTION pg_temp.add_operation(
  p_job_id text, p_company_id text, p_process_id text, p_work_center_id text,
  p_quantity numeric, p_order int, p_make_method_id text DEFAULT NULL
) RETURNS text LANGUAGE plpgsql AS $fn$
DECLARE v_operation text; v_make_method text;
BEGIN
  v_make_method := COALESCE(p_make_method_id,
    (SELECT id FROM "jobMakeMethod" WHERE "jobId" = p_job_id AND "parentMaterialId" IS NULL));

  INSERT INTO "jobOperation" ("jobId", "jobMakeMethodId", "processId", "workCenterId",
      "operationQuantity", "targetQuantity", "order", status, "companyId", "createdBy")
    VALUES (p_job_id, v_make_method, p_process_id, p_work_center_id,
      p_quantity, p_quantity, p_order, 'Ready', p_company_id, 'system')
    RETURNING id INTO v_operation;

  RETURN v_operation;
END;
$fn$;

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

CREATE FUNCTION pg_temp.try_finish_operation(p_operation_id text) RETURNS text
LANGUAGE plpgsql AS $fn$
BEGIN
  UPDATE "jobOperation" SET status = 'Done', "updatedBy" = 'system' WHERE id = p_operation_id;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RETURN SQLERRM;
END;
$fn$;

-- "<status>:<quantityComplete>" per operation, in routing order.
CREATE FUNCTION pg_temp.ops(p_job_id text) RETURNS text LANGUAGE sql AS $fn$
  SELECT string_agg(jo.status || ':' || jo."quantityComplete"::numeric,
                    ',' ORDER BY jo."order", jo.id)
  FROM "jobOperation" jo
  JOIN "jobMakeMethod" m ON m.id = jo."jobMakeMethodId"
  WHERE jo."jobId" = p_job_id AND m."parentMaterialId" IS NULL;
$fn$;

-- Production quantity rows recorded against the job. A desk completion must
-- fabricate none: it is not shop-floor production.
CREATE FUNCTION pg_temp.production_rows(p_job_id text) RETURNS int LANGUAGE sql AS $fn$
  SELECT count(*)::int FROM "productionQuantity" pq
  JOIN "jobOperation" jo ON jo.id = pq."jobOperationId"
  WHERE jo."jobId" = p_job_id;
$fn$;

CREATE FUNCTION pg_temp.receipts(p_job_id text) RETURNS text LANGUAGE sql AS $fn$
  SELECT count(*)::text || ':' || COALESCE(sum(quantity), 0)::numeric::text
  FROM "itemLedger"
  WHERE "documentId" = p_job_id AND "documentType" = 'Job Receipt';
$fn$;

DO $cases$
DECLARE
  v_group_id text; v_company_id text; v_location_id text;
  v_serial_item text; v_stocked_item text; v_part text;
  v_job text; v_error text; v_row record;
  v_process text; v_work_center text; v_op1 text; v_op2 text; v_sub_op text;
  v_sub_method text; v_sub_material text;
BEGIN
  INSERT INTO "companyGroup" (name, "createdBy") VALUES ('Job op quantities test', 'system') RETURNING id INTO v_group_id;
  INSERT INTO company (name, "companyGroupId", "baseCurrencyCode", timezone)
    VALUES ('Job op quantities test', v_group_id, 'USD', 'UTC') RETURNING id INTO v_company_id;
  INSERT INTO location (name, "addressLine1", city, "postalCode", "companyId", "createdBy", timezone)
    VALUES ('Plant', '1 Test Way', 'Testville', '00000', v_company_id, 'system', 'UTC') RETURNING id INTO v_location_id;
  INSERT INTO "unitOfMeasure" (code, name, "companyId", "createdBy")
    VALUES ('EA', 'Each', v_company_id, 'system') ON CONFLICT DO NOTHING;
  INSERT INTO item ("readableId", name, type, "replenishmentSystem", "itemTrackingType", "unitOfMeasureCode", "companyId", "createdBy")
    VALUES ('T-STOCKED', 'Stocked assembly', 'Part', 'Make', 'Inventory', 'EA', v_company_id, 'system') RETURNING id INTO v_stocked_item;
  INSERT INTO item ("readableId", name, type, "replenishmentSystem", "itemTrackingType", "unitOfMeasureCode", "companyId", "createdBy")
    VALUES ('T-SERIAL', 'Serial machine', 'Part', 'Make', 'Serial', 'EA', v_company_id, 'system') RETURNING id INTO v_serial_item;
  INSERT INTO item ("readableId", name, type, "replenishmentSystem", "itemTrackingType", "unitOfMeasureCode", "companyId", "createdBy")
    VALUES ('T-PART', 'Stocked part', 'Part', 'Buy', 'Inventory', 'EA', v_company_id, 'system') RETURNING id INTO v_part;

  INSERT INTO process (name, "processType", "defaultStandardFactor", "companyId", "createdBy")
    VALUES ('Assembly', 'Process', 'Hours/Piece', v_company_id, 'system') RETURNING id INTO v_process;
  INSERT INTO "workCenter" (name, "locationId", "laborRate", "machineRate", "overheadRate", "defaultStandardFactor", "companyId", "createdBy")
    VALUES ('Bench', v_location_id, 0, 0, 0, 'Hours/Piece', v_company_id, 'system') RETURNING id INTO v_work_center;

  -- THE BUG: completing a job left every operation at 0, so the routing stayed
  -- open behind a Completed status.
  v_job := pg_temp.make_job(v_company_id, v_location_id, v_stocked_item, v_part, 'QJ', 2);
  v_op1 := pg_temp.add_operation(v_job, v_company_id, v_process, v_work_center, 2, 1);
  v_op2 := pg_temp.add_operation(v_job, v_company_id, v_process, v_work_center, 2, 2);

  ASSERT pg_temp.ops(v_job) = 'Ready:0,Ready:0',
    'Operations did not start open: ' || pg_temp.ops(v_job);

  v_error := pg_temp.try_complete(v_job, 2);
  ASSERT v_error IS NULL, 'Completing the job failed: ' || COALESCE(v_error, '');

  SELECT status, "quantityComplete" INTO v_row FROM job WHERE id = v_job;
  ASSERT v_row.status = 'Completed' AND v_row."quantityComplete" = 2,
    'Job header wrong after completion: ' || v_row.status || ' @ ' || v_row."quantityComplete";
  ASSERT pg_temp.ops(v_job) = 'Done:2,Done:2',
    'Operations did not complete with the job: ' || pg_temp.ops(v_job);
  ASSERT pg_temp.receipts(v_job) = '1:2',
    'Expected one receipt of 2: ' || pg_temp.receipts(v_job);
  ASSERT pg_temp.production_rows(v_job) = 0,
    'A desk completion must not fabricate production history';

  -- Re-completing at the same cumulative quantity changes nothing.
  v_error := pg_temp.try_complete(v_job, 2);
  ASSERT v_error IS NULL, 'Re-completion failed: ' || COALESCE(v_error, '');
  ASSERT pg_temp.receipts(v_job) = '1:2',
    'Re-completion received again: ' || pg_temp.receipts(v_job);
  ASSERT pg_temp.ops(v_job) = 'Done:2,Done:2',
    'Re-completion disturbed the operations: ' || pg_temp.ops(v_job);

  -- An operation the floor already reported past the completed quantity keeps
  -- its own higher count; the backfill only ever raises a shortfall.
  v_job := pg_temp.make_job(v_company_id, v_location_id, v_stocked_item, v_part, 'PJ', 2);
  v_op1 := pg_temp.add_operation(v_job, v_company_id, v_process, v_work_center, 2, 1);
  v_op2 := pg_temp.add_operation(v_job, v_company_id, v_process, v_work_center, 2, 2);
  UPDATE "jobOperation" SET "quantityComplete" = 5 WHERE id = v_op1;

  v_error := pg_temp.try_complete(v_job, 2);
  ASSERT v_error IS NULL, 'Completing with an over-reported operation failed: ' || COALESCE(v_error, '');
  -- Its higher reported quantity is preserved, but it still closes: an
  -- operation that meets its target is Done by the same rule the interceptor
  -- applies, so leaving it Ready on a Completed job would be inconsistent.
  ASSERT pg_temp.ops(v_job) = 'Done:5,Done:2',
    'A satisfied operation must close without losing its quantity: ' || pg_temp.ops(v_job);

  -- Reworked units already count as reported, so closing must not stack the
  -- full target on top of them and report more units than were ever produced.
  v_job := pg_temp.make_job(v_company_id, v_location_id, v_stocked_item, v_part, 'RWJ', 3);
  v_op1 := pg_temp.add_operation(v_job, v_company_id, v_process, v_work_center, 3, 1);
  UPDATE "jobOperation" SET "quantityComplete" = 1, "quantityReworked" = 1 WHERE id = v_op1;

  v_error := pg_temp.try_complete(v_job, 3);
  ASSERT v_error IS NULL, 'Completing with a reworked unit failed: ' || COALESCE(v_error, '');
  SELECT "quantityComplete", "quantityReworked" INTO v_row FROM "jobOperation" WHERE id = v_op1;
  ASSERT v_row."quantityComplete" + v_row."quantityReworked" = 3,
    'Reported units must equal the completed quantity, got '
      || v_row."quantityComplete" || ' complete + ' || v_row."quantityReworked" || ' reworked';

  -- Sub-assembly operations are NOT completed: they build a different item, and
  -- ticking them would claim work that may never have happened.
  v_job := pg_temp.make_job(v_company_id, v_location_id, v_stocked_item, v_part, 'SUBJ', 1);
  v_op1 := pg_temp.add_operation(v_job, v_company_id, v_process, v_work_center, 1, 1);

  INSERT INTO "jobMaterial" ("jobId", "jobMakeMethodId", "itemId", description, "methodType",
      "itemType", quantity, "estimatedQuantity", "companyId", "createdBy")
    SELECT v_job, m.id, v_part, 'Made sub-assembly', 'Make to Order', 'Part', 1, 1, v_company_id, 'system'
    FROM "jobMakeMethod" m WHERE m."jobId" = v_job AND m."parentMaterialId" IS NULL
    RETURNING id INTO v_sub_material;
  INSERT INTO "jobMakeMethod" ("jobId", "parentMaterialId", "itemId", "quantityPerParent", "companyId", "createdBy")
    VALUES (v_job, v_sub_material, v_part, 1, v_company_id, 'system')
    RETURNING id INTO v_sub_method;
  v_sub_op := pg_temp.add_operation(v_job, v_company_id, v_process, v_work_center, 1, 1, v_sub_method);

  v_error := pg_temp.try_complete(v_job, 1);
  ASSERT v_error IS NULL, 'Completing a job with a sub-assembly failed: ' || COALESCE(v_error, '');
  SELECT status, "quantityComplete" INTO v_row FROM "jobOperation" WHERE id = v_sub_op;
  ASSERT v_row.status <> 'Done' AND v_row."quantityComplete" = 0,
    'A sub-assembly operation must not be completed by the job: ' || v_row.status || ' @ ' || v_row."quantityComplete";

  -- Serial job with units still outstanding is refused, and nothing is applied.
  v_job := pg_temp.make_job(v_company_id, v_location_id, v_serial_item, v_part, 'SJ', 3);
  v_op1 := pg_temp.add_operation(v_job, v_company_id, v_process, v_work_center, 3, 1);

  v_error := pg_temp.try_complete(v_job, 3);
  ASSERT v_error LIKE '%serial number is required%',
    'Serial job with outstanding units was not refused: ' || COALESCE(v_error, '<succeeded>');
  SELECT status INTO v_row FROM job WHERE id = v_job;
  ASSERT v_row.status <> 'Completed', 'A refused serial completion still completed the job';
  ASSERT pg_temp.ops(v_job) = 'Ready:0',
    'A refused serial completion still wrote quantities: ' || pg_temp.ops(v_job);

  -- The same serial job completes once the floor has reported every unit.
  UPDATE "jobOperation" SET "quantityComplete" = 3 WHERE id = v_op1;
  v_error := pg_temp.try_complete(v_job, 3);
  ASSERT v_error IS NULL, 'Serial job finished in MES failed to complete: ' || COALESCE(v_error, '');
  SELECT status, "quantityComplete" INTO v_row FROM job WHERE id = v_job;
  ASSERT v_row.status = 'Completed' AND v_row."quantityComplete" = 3,
    'Serial job did not complete after MES reported every unit';

  -- MES path: finishing the last operation completes the job through the
  -- sync_finish_job_operation interceptor. The backfill must stay out of it —
  -- writing a sibling jobOperation row from that BEFORE trigger is impossible.
  v_job := pg_temp.make_job(v_company_id, v_location_id, v_stocked_item, v_part, 'MJ', 2);
  v_op1 := pg_temp.add_operation(v_job, v_company_id, v_process, v_work_center, 2, 1);
  v_op2 := pg_temp.add_operation(v_job, v_company_id, v_process, v_work_center, 2, 2);
  UPDATE job SET status = 'In Progress' WHERE id = v_job;

  v_error := pg_temp.try_finish_operation(v_op1);
  ASSERT v_error IS NULL, 'Finishing the first operation failed: ' || COALESCE(v_error, '');
  v_error := pg_temp.try_finish_operation(v_op2);
  ASSERT v_error IS NULL, 'Finishing the last operation failed: ' || COALESCE(v_error, '');

  SELECT status INTO v_row FROM job WHERE id = v_job;
  ASSERT v_row.status = 'Completed', 'MES completion did not complete the job: ' || v_row.status;
  ASSERT pg_temp.receipts(v_job) = '1:2',
    'MES completion did not receive exactly once: ' || pg_temp.receipts(v_job);

  RAISE NOTICE 'ALL OPERATION-QUANTITY CASES PASSED (backfill, idempotent re-completion, no lowering, sub-assemblies untouched, serial refusal and release, no fabricated production history, MES trigger path)';
END;
$cases$;

ROLLBACK;
