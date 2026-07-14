-- Fix: NOT NULL violation on itemLedger."createdBy" when a job auto-completes.
--
-- Recording a production quantity fires sync_update_job_operation_quantities,
-- whose auto-Done UPDATE on "jobOperation" did not set "updatedBy". When that
-- status flip cascaded to sync_finish_job_operation, it passed
-- p_new->>'updatedBy' (NULL for operations never touched by a user-level
-- update) as p_user_id to complete_job_to_inventory / backflush_job_materials,
-- whose itemLedger inserts then violated the createdBy NOT NULL constraint and
-- rolled back the entire production-quantity insert.
--
-- Both functions are forked from 20260531084723_rework-serial-flow.sql:
--   1. sync_update_job_operation_quantities: the auto-Done UPDATE now stamps
--      "updatedBy" (from the productionQuantity row's user) and "updatedAt".
--   2. sync_finish_job_operation: p_user_id falls back to the operation's
--      "createdBy" (NOT NULL) when "updatedBy" is null.

DROP FUNCTION IF EXISTS sync_update_job_operation_quantities(TEXT, TEXT, JSONB, JSONB);

CREATE OR REPLACE FUNCTION sync_update_job_operation_quantities(
  p_table TEXT,
  p_operation TEXT,
  p_new JSONB,
  p_old JSONB
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job_operation_id TEXT;
  v_job_id TEXT;
  v_user_id TEXT;
  v_is_last_top_level_operation BOOLEAN := FALSE;
BEGIN
  v_user_id := COALESCE(
    p_new->>'updatedBy', p_new->>'createdBy',
    p_old->>'updatedBy', p_old->>'createdBy'
  );

  IF p_operation = 'INSERT' THEN
    v_job_operation_id := p_new->>'jobOperationId';

    UPDATE "jobOperation"
    SET
      "quantityComplete" = "quantityComplete" +
        CASE WHEN (p_new->>'type') = 'Production' THEN (p_new->>'quantity')::numeric ELSE 0 END,
      "quantityReworked" = "quantityReworked" +
        CASE WHEN (p_new->>'type') = 'Rework' THEN (p_new->>'quantity')::numeric ELSE 0 END,
      "quantityScrapped" = "quantityScrapped" +
        CASE WHEN (p_new->>'type') = 'Scrap' THEN (p_new->>'quantity')::numeric ELSE 0 END
    WHERE id = v_job_operation_id;

  ELSIF p_operation = 'UPDATE' THEN
    v_job_operation_id := p_new->>'jobOperationId';

    UPDATE "jobOperation"
    SET
      "quantityComplete" = "quantityComplete"
        - CASE WHEN (p_old->>'type') = 'Production' THEN (p_old->>'quantity')::numeric ELSE 0 END
        + CASE WHEN (p_new->>'type') = 'Production' THEN (p_new->>'quantity')::numeric ELSE 0 END,
      "quantityReworked" = "quantityReworked"
        - CASE WHEN (p_old->>'type') = 'Rework' THEN (p_old->>'quantity')::numeric ELSE 0 END
        + CASE WHEN (p_new->>'type') = 'Rework' THEN (p_new->>'quantity')::numeric ELSE 0 END,
      "quantityScrapped" = "quantityScrapped"
        - CASE WHEN (p_old->>'type') = 'Scrap' THEN (p_old->>'quantity')::numeric ELSE 0 END
        + CASE WHEN (p_new->>'type') = 'Scrap' THEN (p_new->>'quantity')::numeric ELSE 0 END
    WHERE id = v_job_operation_id;

  ELSIF p_operation = 'DELETE' THEN
    v_job_operation_id := p_old->>'jobOperationId';

    UPDATE "jobOperation"
    SET
      "quantityComplete" = "quantityComplete" -
        CASE WHEN (p_old->>'type') = 'Production' THEN (p_old->>'quantity')::numeric ELSE 0 END,
      "quantityReworked" = "quantityReworked" -
        CASE WHEN (p_old->>'type') = 'Rework' THEN (p_old->>'quantity')::numeric ELSE 0 END,
      "quantityScrapped" = "quantityScrapped" -
        CASE WHEN (p_old->>'type') = 'Scrap' THEN (p_old->>'quantity')::numeric ELSE 0 END
    WHERE id = v_job_operation_id;
  END IF;

  UPDATE "jobOperation"
  SET "status" = 'Done',
      "updatedBy" = COALESCE(v_user_id, "updatedBy", "createdBy"),
      "updatedAt" = NOW()
  WHERE id = v_job_operation_id
    AND "status" NOT IN ('Done', 'Canceled')
    AND "targetQuantity" > 0
    AND ("quantityComplete" + "quantityReworked" + "quantityScrapped") >= "targetQuantity";

  SELECT jo."jobId" INTO v_job_id
  FROM "jobOperation" jo
  WHERE jo.id = v_job_operation_id;

  SELECT EXISTS (
    SELECT 1
    FROM "jobOperation" jo
    INNER JOIN "jobMakeMethod" jmm ON jmm.id = jo."jobMakeMethodId"
    WHERE jo.id = v_job_operation_id
      AND jmm."parentMaterialId" IS NULL
      AND NOT EXISTS (
        SELECT 1
        FROM "jobOperationDependency" dep
        INNER JOIN "jobOperation" child_jo ON child_jo.id = dep."operationId"
        INNER JOIN "jobMakeMethod" child_jmm ON child_jmm.id = child_jo."jobMakeMethodId"
        WHERE dep."dependsOnId" = jo.id
          AND child_jmm."parentMaterialId" IS NULL
      )
  ) INTO v_is_last_top_level_operation;

  IF v_job_id IS NOT NULL AND v_is_last_top_level_operation THEN
    UPDATE "job"
    SET "quantityComplete" = (
      SELECT COALESCE(SUM(terminal_jo."quantityComplete"), 0)
      FROM "jobOperation" terminal_jo
      INNER JOIN "jobMakeMethod" terminal_jmm ON terminal_jmm.id = terminal_jo."jobMakeMethodId"
      WHERE terminal_jo."jobId" = v_job_id
        AND terminal_jmm."parentMaterialId" IS NULL
        AND NOT EXISTS (
          SELECT 1
          FROM "jobOperationDependency" dep
          INNER JOIN "jobOperation" child_jo ON child_jo.id = dep."operationId"
          INNER JOIN "jobMakeMethod" child_jmm ON child_jmm.id = child_jo."jobMakeMethodId"
          WHERE dep."dependsOnId" = terminal_jo.id
            AND child_jmm."parentMaterialId" IS NULL
        )
    )
    WHERE id = v_job_id
      AND status NOT IN ('Completed', 'Cancelled');
  END IF;
END;
$$;

DROP FUNCTION IF EXISTS sync_finish_job_operation(TEXT, TEXT, JSONB, JSONB);

CREATE OR REPLACE FUNCTION sync_finish_job_operation(
  p_table TEXT,
  p_operation TEXT,
  p_new JSONB,
  p_old JSONB
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job_location_id TEXT;
  v_job_storage_unit_id TEXT;
  v_job_quantity NUMERIC;
  v_sales_order_id TEXT;
  v_quantity_complete NUMERIC;
  v_job_status TEXT;
BEGIN
  IF p_operation != 'UPDATE' THEN RETURN; END IF;
  IF (p_new->>'status') != 'Done' OR (p_old->>'status') = 'Done' THEN RETURN; END IF;

  UPDATE "productionEvent"
  SET "endTime" = NOW()
  WHERE "jobOperationId" = p_new->>'id'
    AND "endTime" IS NULL;

  UPDATE "jobOperation" op
  SET status = 'Ready'
  WHERE EXISTS (
    SELECT 1
    FROM "jobOperationDependency" dep
    WHERE dep."operationId" = op.id
      AND dep."dependsOnId" = p_new->>'id'
      AND op.status = 'Waiting'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM "jobOperationDependency" dep2
    JOIN "jobOperation" jo2 ON jo2.id = dep2."dependsOnId"
    WHERE dep2."operationId" = op.id
      AND jo2.status != 'Done'
      AND jo2.id != p_new->>'id'
  );

  SELECT status INTO v_job_status FROM "job" WHERE id = p_new->>'jobId';
  IF v_job_status NOT IN ('Ready', 'In Progress', 'Paused') THEN
    RETURN;
  END IF;

  IF is_last_job_operation(p_new->>'id') THEN
    SELECT "locationId", "storageUnitId", quantity, "salesOrderId"
    INTO v_job_location_id, v_job_storage_unit_id, v_job_quantity, v_sales_order_id
    FROM "job"
    WHERE id = p_new->>'jobId';

    v_quantity_complete := (
      SELECT COALESCE(SUM(terminal_jo."quantityComplete"), 0)
      FROM "jobOperation" terminal_jo
      INNER JOIN "jobMakeMethod" terminal_jmm ON terminal_jmm.id = terminal_jo."jobMakeMethodId"
      WHERE terminal_jo."jobId" = p_new->>'jobId'
        AND terminal_jmm."parentMaterialId" IS NULL
        AND NOT EXISTS (
          SELECT 1
          FROM "jobOperationDependency" dep
          INNER JOIN "jobOperation" child_jo ON child_jo.id = dep."operationId"
          INNER JOIN "jobMakeMethod" child_jmm ON child_jmm.id = child_jo."jobMakeMethodId"
          WHERE dep."dependsOnId" = terminal_jo.id
            AND child_jmm."parentMaterialId" IS NULL
        )
    );

    IF COALESCE(v_quantity_complete, 0) = 0 THEN
      v_quantity_complete := v_job_quantity;
    END IF;

    PERFORM complete_job_to_inventory(
      p_job_id := p_new->>'jobId',
      p_quantity_complete := v_quantity_complete,
      p_storage_unit_id := v_job_storage_unit_id,
      p_location_id := v_job_location_id,
      p_company_id := p_new->>'companyId',
      p_user_id := COALESCE(p_new->>'updatedBy', p_new->>'createdBy')
    );
  END IF;
END;
$$;
