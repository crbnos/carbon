-- An open production event loads its operation onto the work center
-- (sync_load_work_center_operation); the operation going Done or Canceled
-- unloads it (sync_unload_work_center_operation). The oee provider role may
-- have several active integrations; the other roles still allow one.
-- Isolated fixture company; no existing business data is read or edited. Always rolls back.
-- Run: pnpm exec tsx scripts/run-local-accounting-check.ts psql -X -f packages/database/supabase/tests/work-center-loaded-operation.test.sql
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL statement_timeout = '60s';

-- A released job for p_item_id with p_quantity units (from
-- job-completion-terminal-operations.test.sql).
CREATE FUNCTION pg_temp.make_job(
  p_company_id text, p_location_id text, p_item_id text, p_readable_id text, p_quantity numeric
) RETURNS text LANGUAGE plpgsql AS $fn$
DECLARE
  v_job_id text;
BEGIN
  INSERT INTO job ("jobId", "itemId", quantity, "locationId", "companyId", "createdBy", "unitOfMeasureCode")
    VALUES (p_readable_id, p_item_id, p_quantity, p_location_id, p_company_id, 'system', 'EA')
    RETURNING id INTO v_job_id;
  UPDATE job SET status = 'In Progress' WHERE id = v_job_id;
  RETURN v_job_id;
END;
$fn$;

-- An operation on the job's top-level make method.
CREATE FUNCTION pg_temp.add_operation(
  p_job_id text, p_company_id text, p_process_id text, p_work_center_id text, p_order numeric
) RETURNS text LANGUAGE plpgsql AS $fn$
DECLARE v_operation text;
BEGIN
  INSERT INTO "jobOperation" ("jobId", "jobMakeMethodId", "processId", "workCenterId",
      "operationQuantity", "targetQuantity", "order", status, "companyId", "createdBy")
    SELECT p_job_id, m.id, p_process_id, p_work_center_id,
      1, 1, p_order, 'Ready', p_company_id, 'system'
    FROM "jobMakeMethod" m WHERE m."jobId" = p_job_id AND m."parentMaterialId" IS NULL
    RETURNING id INTO v_operation;
  RETURN v_operation;
END;
$fn$;

CREATE FUNCTION pg_temp.add_event(
  p_operation_id text, p_work_center_id text, p_type text, p_start timestamptz, p_end timestamptz
) RETURNS void LANGUAGE sql AS $fn$
  INSERT INTO "productionEvent" ("jobOperationId", "workCenterId", type, "startTime", "endTime", "companyId", "createdBy")
    SELECT p_operation_id, p_work_center_id, p_type::"productionEventType", p_start, p_end, "companyId", 'system'
    FROM "jobOperation" WHERE id = p_operation_id;
$fn$;

CREATE FUNCTION pg_temp.loaded(p_work_center_id text) RETURNS text LANGUAGE sql AS $fn$
  SELECT COALESCE("loadedJobOperationId", 'none') || '@' || COALESCE(to_char("loadedAt" AT TIME ZONE 'UTC', 'HH24:MI'), 'none')
  FROM "workCenter" WHERE id = p_work_center_id;
$fn$;

DO $cases$
DECLARE
  v_group_id text; v_company_id text; v_location_id text;
  v_item text; v_process text; v_work_center text;
  v_job text; v_a text; v_b text; v_c text;
  v_day date := '2026-10-12';
  v_state text;
BEGIN
  INSERT INTO "companyGroup" (name, "createdBy") VALUES ('Loaded op test', 'system') RETURNING id INTO v_group_id;
  INSERT INTO company (name, "companyGroupId", "baseCurrencyCode", timezone)
    VALUES ('Loaded op test', v_group_id, 'USD', 'UTC') RETURNING id INTO v_company_id;
  INSERT INTO location (name, "addressLine1", city, "postalCode", "companyId", "createdBy", timezone)
    VALUES ('Plant', '1 Test Way', 'Testville', '00000', v_company_id, 'system', 'UTC') RETURNING id INTO v_location_id;
  INSERT INTO "unitOfMeasure" (code, name, "companyId", "createdBy")
    VALUES ('EA', 'Each', v_company_id, 'system') ON CONFLICT DO NOTHING;
  INSERT INTO item ("readableId", name, type, "replenishmentSystem", "itemTrackingType", "unitOfMeasureCode", "companyId", "createdBy")
    VALUES ('T-PART', 'Part', 'Part', 'Make', 'Inventory', 'EA', v_company_id, 'system') RETURNING id INTO v_item;
  INSERT INTO process (name, "processType", "defaultStandardFactor", "companyId", "createdBy")
    VALUES ('Milling', 'Process', 'Hours/Piece', v_company_id, 'system') RETURNING id INTO v_process;
  INSERT INTO "workCenter" (name, "locationId", "laborRate", "machineRate", "overheadRate", "defaultStandardFactor", "companyId", "createdBy")
    VALUES ('Haas 2', v_location_id, 0, 0, 0, 'Hours/Piece', v_company_id, 'system') RETURNING id INTO v_work_center;

  v_job := pg_temp.make_job(v_company_id, v_location_id, v_item, 'J-LOAD', 1);
  v_a := pg_temp.add_operation(v_job, v_company_id, v_process, v_work_center, 1);
  v_b := pg_temp.add_operation(v_job, v_company_id, v_process, v_work_center, 2);
  -- A third operation keeps B's completion from finishing the job.
  v_c := pg_temp.add_operation(v_job, v_company_id, v_process, v_work_center, 3);

  -- 1. An open Setup event loads A.
  PERFORM pg_temp.add_event(v_a, v_work_center, 'Setup', v_day + time '10:00', NULL);
  v_state := pg_temp.loaded(v_work_center);
  ASSERT v_state = v_a || '@10:00', 'open event loads A: ' || v_state;

  -- 2. An event inserted with an endTime never loads.
  PERFORM pg_temp.add_event(v_b, v_work_center, 'Machine', v_day + time '09:00', v_day + time '09:30');
  v_state := pg_temp.loaded(v_work_center);
  ASSERT v_state = v_a || '@10:00', 'closed event does not load: ' || v_state;

  -- 3. An open event that started before the current load does not replace it.
  PERFORM pg_temp.add_event(v_b, v_work_center, 'Labor', v_day + time '09:50', NULL);
  v_state := pg_temp.loaded(v_work_center);
  ASSERT v_state = v_a || '@10:00', 'older open event does not load: ' || v_state;

  -- 4. A later open event loads B.
  PERFORM pg_temp.add_event(v_b, v_work_center, 'Labor', v_day + time '10:10', NULL);
  v_state := pg_temp.loaded(v_work_center);
  ASSERT v_state = v_b || '@10:10', 'later open event loads B: ' || v_state;

  -- 5. B going Done unloads it.
  UPDATE "jobOperation" SET status = 'Done', "updatedBy" = 'system' WHERE id = v_b;
  v_state := pg_temp.loaded(v_work_center);
  ASSERT v_state = 'none@none', 'Done unloads B: ' || v_state;

  -- Canceled unloads too.
  PERFORM pg_temp.add_event(v_c, v_work_center, 'Setup', v_day + time '11:00', NULL);
  ASSERT pg_temp.loaded(v_work_center) = v_c || '@11:00', 'C loads';
  UPDATE "jobOperation" SET status = 'Canceled', "updatedBy" = 'system' WHERE id = v_c;
  v_state := pg_temp.loaded(v_work_center);
  ASSERT v_state = 'none@none', 'Canceled unloads C: ' || v_state;

  -- 6. Several active integrations of the oee role are allowed.
  INSERT INTO "integration" (id, jsonschema, "providerRole")
    VALUES ('oee-test', '{"type": "object", "properties": {}}'::json, 'oee');
  INSERT INTO "companyIntegration" (id, "companyId", metadata, active, "updatedBy")
    VALUES ('sense', v_company_id, '{}'::json, true, 'system');
  INSERT INTO "companyIntegration" (id, "companyId", metadata, active, "updatedBy")
    VALUES ('oee-test', v_company_id, '{}'::json, true, 'system');
  ASSERT (SELECT count(*) FROM "companyIntegration" WHERE "companyId" = v_company_id AND active) = 2,
    'two active oee integrations';

  -- 7. The accounting role still allows one.
  INSERT INTO "companyIntegration" (id, "companyId", metadata, active, "updatedBy")
    VALUES ('xero', v_company_id, '{}'::json, true, 'system');
  BEGIN
    INSERT INTO "companyIntegration" (id, "companyId", metadata, active, "updatedBy")
      VALUES ('quickbooks', v_company_id, '{}'::json, true, 'system');
    RAISE EXCEPTION 'FAIL: a second active accounting integration was allowed';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;

  RAISE NOTICE 'ALL work-center-loaded-operation TESTS PASSED';
END;
$cases$;

ROLLBACK;
