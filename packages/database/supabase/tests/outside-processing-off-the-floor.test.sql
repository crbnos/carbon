-- Outside Processing runs at the supplier, never on the shop floor.
-- 1. The work centers board (get_active_job_operations_by_location — MES board,
--    ERP Priority board, API) never lists one, even one that carries a work
--    center. The board's columns are work centers, so an outside operation used
--    to stay off it only while its work center was null; a stale one (left over
--    from an in-house type) put it in that column for an operator to start.
-- 2. The batch builder (get_batchable_operations) never offers one: releasing a
--    batch stamps its work center onto every member.
-- Isolated fixture company; no existing business data is read or edited. Always rolls back.
-- Run: pnpm exec tsx scripts/run-local-accounting-check.ts psql -X -f packages/database/supabase/tests/outside-processing-off-the-floor.test.sql
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL statement_timeout = '60s';

CREATE FUNCTION pg_temp.add_operation(
  p_job_id text, p_company_id text, p_process_id text, p_work_center_id text,
  p_operation_type "operationType", p_order int
) RETURNS text LANGUAGE plpgsql AS $fn$
DECLARE v_operation text;
BEGIN
  INSERT INTO "jobOperation" ("jobId", "jobMakeMethodId", "processId", "workCenterId",
      "operationType", "operationQuantity", "targetQuantity", "order", status, "companyId", "createdBy")
    VALUES (p_job_id,
      (SELECT id FROM "jobMakeMethod" WHERE "jobId" = p_job_id AND "parentMaterialId" IS NULL),
      p_process_id, p_work_center_id, p_operation_type, 1, 1, p_order, 'Ready', p_company_id, 'system')
    RETURNING id INTO v_operation;
  RETURN v_operation;
END;
$fn$;

CREATE FUNCTION pg_temp.on_board(p_location_id text, p_operation_id text) RETURNS boolean
LANGUAGE sql AS $fn$
  SELECT EXISTS (
    SELECT 1 FROM get_active_job_operations_by_location(p_location_id, ARRAY[]::text[])
    WHERE id = p_operation_id
  );
$fn$;

DO $cases$
DECLARE
  v_group_id text; v_company_id text; v_location_id text; v_item text;
  v_process text; v_work_center text; v_job text; v_inside text; v_outside text;
BEGIN
  INSERT INTO "companyGroup" (name, "createdBy") VALUES ('Board outside processing test', 'system') RETURNING id INTO v_group_id;
  INSERT INTO company (name, "companyGroupId", "baseCurrencyCode", timezone)
    VALUES ('Board outside processing test', v_group_id, 'USD', 'UTC') RETURNING id INTO v_company_id;
  INSERT INTO location (name, "addressLine1", city, "postalCode", "companyId", "createdBy", timezone)
    VALUES ('Plant', '1 Test Way', 'Testville', '00000', v_company_id, 'system', 'UTC') RETURNING id INTO v_location_id;
  INSERT INTO "unitOfMeasure" (code, name, "companyId", "createdBy")
    VALUES ('EA', 'Each', v_company_id, 'system') ON CONFLICT DO NOTHING;
  INSERT INTO item ("readableId", name, type, "replenishmentSystem", "itemTrackingType", "unitOfMeasureCode", "companyId", "createdBy")
    VALUES ('T-BRACKET', 'Bracket', 'Part', 'Make', 'Inventory', 'EA', v_company_id, 'system') RETURNING id INTO v_item;
  INSERT INTO process (name, "processType", "defaultStandardFactor", "companyId", "createdBy")
    VALUES ('Plating', 'Process', 'Hours/Piece', v_company_id, 'system') RETURNING id INTO v_process;
  UPDATE process SET batchable = TRUE WHERE id = v_process;
  INSERT INTO "workCenter" (name, "locationId", "laborRate", "machineRate", "overheadRate", "defaultStandardFactor", "companyId", "createdBy")
    VALUES ('Plating line', v_location_id, 0, 0, 0, 'Hours/Piece', v_company_id, 'system') RETURNING id INTO v_work_center;

  INSERT INTO job ("jobId", "itemId", quantity, "locationId", "companyId", "createdBy", "unitOfMeasureCode")
    VALUES ('BOARD-1', v_item, 1, v_location_id, v_company_id, 'system', 'EA') RETURNING id INTO v_job;
  v_inside := pg_temp.add_operation(v_job, v_company_id, v_process, v_work_center, 'Process', 1);
  -- The stale shape: an outside operation still holding the work center it had in-house.
  v_outside := pg_temp.add_operation(v_job, v_company_id, v_process, v_work_center, 'Outside Processing', 2);
  UPDATE job SET status = 'Ready' WHERE id = v_job;

  ASSERT pg_temp.on_board(v_location_id, v_inside),
    'An in-house operation with a work center on a released job must be on the board';
  ASSERT NOT pg_temp.on_board(v_location_id, v_outside),
    'An Outside Processing operation must stay off the board even with a work center';

  -- Filtering the board to that work center must not bring it back either.
  ASSERT NOT EXISTS (
    SELECT 1 FROM get_active_job_operations_by_location(v_location_id, ARRAY[v_work_center])
    WHERE id = v_outside
  ), 'An Outside Processing operation must stay off a work-center-filtered board';

  -- The batch builder offers the in-house operation, never the outside one.
  ASSERT EXISTS (
    SELECT 1 FROM get_batchable_operations(v_location_id, v_process) WHERE id = v_inside
  ), 'An unstarted in-house operation on a batchable process must be a batch candidate';
  ASSERT NOT EXISTS (
    SELECT 1 FROM get_batchable_operations(v_location_id, v_process) WHERE id = v_outside
  ), 'An Outside Processing operation must never be a batch candidate';

  RAISE NOTICE 'ALL OUTSIDE-PROCESSING CASES PASSED (in-house listed, outside hidden, outside hidden under a work-center filter, outside never a batch candidate)';
END;
$cases$;

ROLLBACK;
