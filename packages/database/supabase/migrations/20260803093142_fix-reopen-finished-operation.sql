-- Fix: starting a production event on a Done/Canceled operation reopened it.
--
-- sync_set_job_operation_in_progress (productionEvent INSERT interceptor) set
-- jobOperation.status = 'In Progress' with no status guard, so recording a new
-- open production event against a finished (or canceled) operation silently
-- flipped it back to 'In Progress' — reachable from both the MES and the ERP
-- job Events tab. The UPDATE now skips operations already in a terminal status.
--
-- Forked verbatim from 20260410031809_production-interceptors.sql (the only
-- prior definition); the only change is the "status" NOT IN guard on the
-- jobOperation UPDATE. The parent-job update is unchanged. No trigger
-- re-attach is needed — interceptors are resolved by name.

DROP FUNCTION IF EXISTS sync_set_job_operation_in_progress(TEXT, TEXT, JSONB, JSONB);

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
    WHERE id = p_new->>'jobOperationId'
      AND "status" NOT IN ('Done', 'Canceled');
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
