-- Auto-Done predicate: scrap no longer counts toward targetQuantity.
--
-- targetQuantity is the GOOD quantity to produce before scrap
-- (20260119120000); operationQuantity carries the planned-scrap allowance.
-- The old predicate (complete + reworked + scrapped >= target) let scrapped
-- units consume good-target capacity, auto-Done-ing operations short — even
-- within planned scrap. Spec: .ai/specs/2026-08-06-scrap-unscrap-flow.md
-- (Brad, 2026-08-07).
--
-- Forked verbatim from the newest definition
-- (20260706181125_fix-auto-complete-null-user.sql); the ONLY change is the
-- auto-Done predicate line (quantityScrapped removed from the sum).
--
-- NOTE (verified 2026-08-07): get_inventory_quantities /
-- get_available_tracked_entities / get_picking_list_tracked_available need NO
-- 'Scrapped' handling — scrap paths write negative ledger movements and
-- itemLedger.trackedEntityStatus is status-synced (20260420112047), so
-- Scrapped stock nets to zero; the availability RPCs already filter
-- status = 'Available'.

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
    AND ("quantityComplete" + "quantityReworked") >= "targetQuantity";

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

