-- =============================================================================
-- Convert production-related triggers to event system interceptors.
--
-- Converts 5 legacy triggers:
--   - update_job_operation_quantities (INSERT/UPDATE/DELETE on productionQuantity)
--   - update_job_operation_status_on_production_event (INSERT on productionEvent)
--   - finish_job_operation (UPDATE on jobOperation WHEN status = 'Done')
--
-- productionQuantity and productionEvent are newly attached to the event system.
-- jobOperation was already on the event system (for audit logging).
-- =============================================================================


-- =============================================================================
-- PART 1: Create Interceptor Functions
-- =============================================================================

-- 1-3. productionQuantity INSERT/UPDATE/DELETE -> adjusts jobOperation quantities
--      (BEFORE interceptor -- UPDATEs parent jobOperation, no FK to productionQuantity)
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
BEGIN
  IF p_operation = 'INSERT' THEN
    UPDATE "jobOperation"
    SET
      "quantityComplete" = "quantityComplete" +
        CASE WHEN (p_new->>'type') = 'Production' THEN (p_new->>'quantity')::numeric ELSE 0 END,
      "quantityReworked" = "quantityReworked" +
        CASE WHEN (p_new->>'type') = 'Rework' THEN (p_new->>'quantity')::numeric ELSE 0 END,
      "quantityScrapped" = "quantityScrapped" +
        CASE WHEN (p_new->>'type') = 'Scrap' THEN (p_new->>'quantity')::numeric ELSE 0 END
    WHERE id = p_new->>'jobOperationId';

  ELSIF p_operation = 'UPDATE' THEN
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
    WHERE id = p_new->>'jobOperationId';

  ELSIF p_operation = 'DELETE' THEN
    UPDATE "jobOperation"
    SET
      "quantityComplete" = "quantityComplete" -
        CASE WHEN (p_old->>'type') = 'Production' THEN (p_old->>'quantity')::numeric ELSE 0 END,
      "quantityReworked" = "quantityReworked" -
        CASE WHEN (p_old->>'type') = 'Rework' THEN (p_old->>'quantity')::numeric ELSE 0 END,
      "quantityScrapped" = "quantityScrapped" -
        CASE WHEN (p_old->>'type') = 'Scrap' THEN (p_old->>'quantity')::numeric ELSE 0 END
    WHERE id = p_old->>'jobOperationId';
  END IF;
END;
$$;


-- 4. productionEvent AFTER INSERT -> sets jobOperation and job to 'In Progress'
--    (BEFORE interceptor -- UPDATEs parent records, no FK to productionEvent)
CREATE OR REPLACE FUNCTION sync_set_job_operation_in_progress(
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
BEGIN
  IF p_operation != 'INSERT' THEN RETURN; END IF;

  -- Only set to In Progress if endTime is NULL (event is starting, not already ended)
  IF (p_new->>'endTime') IS NULL THEN
    UPDATE "jobOperation"
    SET "status" = 'In Progress'
    WHERE id = p_new->>'jobOperationId';
  END IF;

  -- Set parent job to In Progress if it is still Ready
  UPDATE "job"
  SET "status" = 'In Progress'
  WHERE id = (
    SELECT "jobId" FROM "jobOperation" WHERE id = p_new->>'jobOperationId'
  )
  AND "status" = 'Ready';
END;
$$;


-- 5. jobOperation AFTER UPDATE (status -> 'Done') -> finishes production events,
--    unlocks dependent operations
--    (BEFORE interceptor -- UPDATEs other records)
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
BEGIN
  -- Only fire when status transitions to 'Done'
  IF p_operation != 'UPDATE' THEN RETURN; END IF;
  IF (p_new->>'status') != 'Done' OR (p_old->>'status') = 'Done' THEN RETURN; END IF;

  -- Close all open production events for this operation
  UPDATE "productionEvent"
  SET "endTime" = NOW()
  WHERE "jobOperationId" = p_new->>'id'
    AND "endTime" IS NULL;

  -- Unlock dependent operations whose dependencies are now all done
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
END;
$$;


-- =============================================================================
-- PART 2: Drop Legacy Triggers
-- =============================================================================

DROP TRIGGER IF EXISTS insert_production_quantity_trigger ON "productionQuantity";
DROP TRIGGER IF EXISTS update_production_quantity_trigger ON "productionQuantity";
DROP TRIGGER IF EXISTS delete_production_quantity_trigger ON "productionQuantity";
DROP TRIGGER IF EXISTS set_job_operation_in_progress_trigger ON "productionEvent";
DROP TRIGGER IF EXISTS finish_job_operation_trigger ON "jobOperation";


-- =============================================================================
-- PART 3: Attach Event Triggers
-- =============================================================================

-- productionQuantity: quantity adjustments run as BEFORE interceptor
SELECT attach_event_trigger(
  'productionQuantity',
  ARRAY['sync_update_job_operation_quantities']::TEXT[],
  ARRAY[]::TEXT[]
);

-- productionEvent: set-in-progress runs as BEFORE interceptor
SELECT attach_event_trigger(
  'productionEvent',
  ARRAY['sync_set_job_operation_in_progress']::TEXT[],
  ARRAY[]::TEXT[]
);

-- jobOperation: already on event system; re-attach with finish interceptor as BEFORE
SELECT attach_event_trigger(
  'jobOperation',
  ARRAY['sync_finish_job_operation']::TEXT[],
  ARRAY[]::TEXT[]
);
