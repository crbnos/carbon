-- An open production event loads its operation onto the work center
-- (sync_load_work_center_operation); the operation going Done or Canceled
-- unloads it (sync_unload_work_center_operation), and so does deleting it or
-- moving it to another work center; a Pause does not. The open workCenterLoad
-- row is the load; closed rows are the history the OEE sync reads. A start
-- older than the newest load or unload never loads, and an event only loads its own company's operation onto its own
-- company's work center. The oee provider role may
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

-- The open load as operation@loadedAt, or none@none.
CREATE FUNCTION pg_temp.loaded(p_work_center_id text) RETURNS text LANGUAGE sql AS $fn$
  SELECT COALESCE(
    (SELECT "jobOperationId" || '@' || to_char("loadedAt" AT TIME ZONE 'UTC', 'HH24:MI')
     FROM "workCenterLoad"
     WHERE "workCenterId" = p_work_center_id AND "unloadedAt" IS NULL),
    'none@none');
$fn$;

-- The work center's load history: operation@loaded-unloaded, oldest first.
-- The test day is in the future, so an unload (at now()) clamps to the load.
CREATE FUNCTION pg_temp.history(p_work_center_id text) RETURNS text LANGUAGE sql AS $fn$
  SELECT COALESCE(string_agg(
    "jobOperationId" || '@' || to_char("loadedAt" AT TIME ZONE 'UTC', 'HH24:MI') || '-' ||
      CASE
        WHEN "unloadedAt" IS NULL THEN 'open'
        ELSE to_char("unloadedAt" AT TIME ZONE 'UTC', 'HH24:MI')
      END,
    ' ' ORDER BY "loadedAt"), 'none')
  FROM "workCenterLoad" WHERE "workCenterId" = p_work_center_id;
$fn$;

DO $cases$
DECLARE
  v_group_id text; v_company_id text; v_location_id text;
  v_item text; v_process text; v_work_center text;
  v_job text; v_a text; v_b text; v_c text; v_d text; v_e text; v_work_center_2 text;
  v_other_company text; v_other_location text; v_other_item text;
  v_other_process text; v_other_work_center text; v_other_job text; v_other_op text;
  -- Tomorrow: every start is later than now(), so an unload ends at its load.
  v_day date := (now() AT TIME ZONE 'UTC')::date + 1;
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
  v_state := pg_temp.history(v_work_center);
  ASSERT v_state = v_a || '@10:00-open', 'A opens a load: ' || v_state;

  -- 2. An event inserted with an endTime never loads.
  PERFORM pg_temp.add_event(v_b, v_work_center, 'Machine', v_day + time '09:00', v_day + time '09:30');
  v_state := pg_temp.loaded(v_work_center);
  ASSERT v_state = v_a || '@10:00', 'closed event does not load: ' || v_state;

  -- 3. An open event that started before the current load does not replace it.
  PERFORM pg_temp.add_event(v_b, v_work_center, 'Labor', v_day + time '09:50', NULL);
  v_state := pg_temp.loaded(v_work_center);
  ASSERT v_state = v_a || '@10:00', 'older open event does not load: ' || v_state;
  v_state := pg_temp.history(v_work_center);
  ASSERT v_state = v_a || '@10:00-open', 'no load for a closed or older event: ' || v_state;

  -- 4. A later open event loads B.
  PERFORM pg_temp.add_event(v_b, v_work_center, 'Labor', v_day + time '10:10', NULL);
  v_state := pg_temp.loaded(v_work_center);
  ASSERT v_state = v_b || '@10:10', 'later open event loads B: ' || v_state;
  v_state := pg_temp.history(v_work_center);
  ASSERT v_state = v_a || '@10:00-10:10 ' || v_b || '@10:10-open',
    'B''s load ends A''s where it starts: ' || v_state;

  -- A Pause keeps the load.
  UPDATE "jobOperation" SET status = 'Paused', "updatedBy" = 'system' WHERE id = v_b;
  v_state := pg_temp.loaded(v_work_center);
  ASSERT v_state = v_b || '@10:10', 'Paused keeps B loaded: ' || v_state;
  v_state := pg_temp.history(v_work_center);
  ASSERT v_state = v_a || '@10:00-10:10 ' || v_b || '@10:10-open',
    'Paused keeps B''s load open: ' || v_state;

  -- 5. B going Done unloads it.
  UPDATE "jobOperation" SET status = 'Done', "updatedBy" = 'system' WHERE id = v_b;
  v_state := pg_temp.loaded(v_work_center);
  ASSERT v_state = 'none@none', 'Done unloads B: ' || v_state;
  v_state := pg_temp.history(v_work_center);
  ASSERT v_state = v_a || '@10:00-10:10 ' || v_b || '@10:10-10:10',
    'Done ends B''s load: ' || v_state;

  -- A start older than the newest unload never loads: a late event cannot
  -- undo the unload that came after it.
  PERFORM pg_temp.add_event(v_a, v_work_center, 'Machine', v_day + time '10:05', NULL);
  v_state := pg_temp.loaded(v_work_center);
  ASSERT v_state = 'none@none', 'a start before the unload does not load: ' || v_state;

  -- Canceled unloads too.
  PERFORM pg_temp.add_event(v_c, v_work_center, 'Setup', v_day + time '11:00', NULL);
  ASSERT pg_temp.loaded(v_work_center) = v_c || '@11:00', 'C loads';
  UPDATE "jobOperation" SET status = 'Canceled', "updatedBy" = 'system' WHERE id = v_c;
  v_state := pg_temp.loaded(v_work_center);
  ASSERT v_state = 'none@none', 'Canceled unloads C: ' || v_state;
  v_state := pg_temp.history(v_work_center);
  ASSERT v_state LIKE '% ' || v_c || '@11:00-11:00', 'Canceled ends C''s load: ' || v_state;

  -- Deleting the loaded operation unloads it (the pointer has no FK).
  v_d := pg_temp.add_operation(v_job, v_company_id, v_process, v_work_center, 4);
  PERFORM pg_temp.add_event(v_d, v_work_center, 'Setup', v_day + time '12:00', NULL);
  ASSERT pg_temp.loaded(v_work_center) = v_d || '@12:00', 'D loads';
  DELETE FROM "productionEvent" WHERE "jobOperationId" = v_d;
  DELETE FROM "jobOperation" WHERE id = v_d;
  v_state := pg_temp.loaded(v_work_center);
  ASSERT v_state = 'none@none', 'deleting D unloads it: ' || v_state;
  v_state := pg_temp.history(v_work_center);
  ASSERT v_state LIKE '% ' || v_d || '@12:00-12:00', 'deleting D ends its load: ' || v_state;

  -- Moving the loaded operation to another work center unloads the old one.
  v_e := pg_temp.add_operation(v_job, v_company_id, v_process, v_work_center, 5);
  PERFORM pg_temp.add_event(v_e, v_work_center, 'Setup', v_day + time '12:30', NULL);
  ASSERT pg_temp.loaded(v_work_center) = v_e || '@12:30', 'E loads';
  INSERT INTO "workCenter" (name, "locationId", "laborRate", "machineRate", "overheadRate", "defaultStandardFactor", "companyId", "createdBy")
    VALUES ('Haas 3', v_location_id, 0, 0, 0, 'Hours/Piece', v_company_id, 'system') RETURNING id INTO v_work_center_2;
  UPDATE "jobOperation" SET "workCenterId" = v_work_center_2, "updatedBy" = 'system' WHERE id = v_e;
  v_state := pg_temp.loaded(v_work_center);
  ASSERT v_state = 'none@none', 'moving E unloads the old work center: ' || v_state;
  v_state := pg_temp.history(v_work_center);
  ASSERT v_state LIKE '% ' || v_e || '@12:30-12:30', 'moving E ends its load there: ' || v_state;

  -- Another company's event never loads onto this company's work center:
  -- its own operation on our work center, or our operation under its company.
  INSERT INTO company (name, "companyGroupId", "baseCurrencyCode", timezone)
    VALUES ('Loaded op other', v_group_id, 'USD', 'UTC') RETURNING id INTO v_other_company;
  INSERT INTO location (name, "addressLine1", city, "postalCode", "companyId", "createdBy", timezone)
    VALUES ('Other plant', '2 Test Way', 'Testville', '00000', v_other_company, 'system', 'UTC') RETURNING id INTO v_other_location;
  INSERT INTO "unitOfMeasure" (code, name, "companyId", "createdBy")
    VALUES ('EA', 'Each', v_other_company, 'system') ON CONFLICT DO NOTHING;
  INSERT INTO item ("readableId", name, type, "replenishmentSystem", "itemTrackingType", "unitOfMeasureCode", "companyId", "createdBy")
    VALUES ('T-OTHER', 'Other part', 'Part', 'Make', 'Inventory', 'EA', v_other_company, 'system') RETURNING id INTO v_other_item;
  INSERT INTO process (name, "processType", "defaultStandardFactor", "companyId", "createdBy")
    VALUES ('Milling', 'Process', 'Hours/Piece', v_other_company, 'system') RETURNING id INTO v_other_process;
  INSERT INTO "workCenter" (name, "locationId", "laborRate", "machineRate", "overheadRate", "defaultStandardFactor", "companyId", "createdBy")
    VALUES ('Other Haas', v_other_location, 0, 0, 0, 'Hours/Piece', v_other_company, 'system') RETURNING id INTO v_other_work_center;
  v_other_job := pg_temp.make_job(v_other_company, v_other_location, v_other_item, 'J-OTHER', 1);
  v_other_op := pg_temp.add_operation(v_other_job, v_other_company, v_other_process, v_other_work_center, 1);

  PERFORM pg_temp.add_event(v_other_op, v_work_center, 'Machine', v_day + time '13:00', NULL);
  v_state := pg_temp.loaded(v_work_center);
  ASSERT v_state = 'none@none', 'another company''s event does not load our work center: ' || v_state;

  INSERT INTO "productionEvent" ("jobOperationId", "workCenterId", type, "startTime", "companyId", "createdBy")
    VALUES (v_other_op, v_work_center, 'Machine', v_day + time '13:05', v_company_id, 'system');
  v_state := pg_temp.loaded(v_work_center);
  ASSERT v_state = 'none@none', 'another company''s operation does not load: ' || v_state;
  ASSERT (SELECT count(*) FROM "workCenterLoad" WHERE "jobOperationId" = v_other_op) = 0,
    'another company''s operation has no load';

  -- The history refuses an end before its start and a second open load.
  BEGIN
    INSERT INTO "workCenterLoad" ("companyId", "workCenterId", "jobOperationId", "loadedAt", "unloadedAt")
      VALUES (v_company_id, v_work_center, v_a, v_day + time '14:00', v_day + time '13:00');
    RAISE EXCEPTION 'FAIL: an end before the start was allowed';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  PERFORM pg_temp.add_event(v_a, v_work_center, 'Setup', v_day + time '14:00', NULL);
  BEGIN
    INSERT INTO "workCenterLoad" ("companyId", "workCenterId", "jobOperationId", "loadedAt")
      VALUES (v_company_id, v_work_center, v_c, v_day + time '14:30');
    RAISE EXCEPTION 'FAIL: a second open load was allowed';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;

  -- Retention: an unload older than 7 days goes, an open load stays.
  INSERT INTO "workCenterLoad" ("companyId", "workCenterId", "jobOperationId", "loadedAt", "unloadedAt")
    VALUES (v_company_id, v_work_center_2, v_a, now() - interval '9 days', now() - interval '8 days'),
           (v_company_id, v_work_center_2, v_c, now() - interval '3 days', now() - interval '2 days');
  PERFORM util.purge_work_center_loads();
  ASSERT (SELECT count(*) FROM "workCenterLoad" WHERE "workCenterId" = v_work_center_2 AND "jobOperationId" = v_a
            AND "loadedAt" < now() - interval '7 days') = 0, 'a load unloaded 8 days ago is purged';
  ASSERT (SELECT count(*) FROM "workCenterLoad" WHERE "workCenterId" = v_work_center_2 AND "jobOperationId" = v_c
            AND "loadedAt" < now()) = 1, 'a load unloaded 2 days ago stays';
  ASSERT pg_temp.loaded(v_work_center) = v_a || '@14:00', 'the open load is never purged';

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
