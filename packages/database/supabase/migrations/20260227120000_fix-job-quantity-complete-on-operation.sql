-- Fix: Remove broken job.quantityComplete update from update_job_operation_quantities()
--
-- Bug: The previous version called is_last_job_operation(NEW.id), but NEW refers to a
-- productionQuantity row, not a jobOperation row. Passing a productionQuantity.id to
-- is_last_job_operation() caused the inner JOIN to return no rows, leaving v_job_id = NULL.
-- The subsequent count query (WHERE "jobId" = NULL) matched nothing, so the function
-- always returned TRUE -- meaning job.quantityComplete was set on EVERY production
-- quantity insert, not just when the last operation completed.
--
-- The job-level quantityComplete is already correctly set by finish_job_operation()
-- (migration 20251214180817) which fires when a jobOperation status changes to 'Done'
-- and calls is_last_job_operation() with the correct jobOperation.id.

CREATE OR REPLACE FUNCTION update_job_operation_quantities()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- Increment quantities on insert
    UPDATE "jobOperation"
    SET 
      "quantityComplete" = "quantityComplete" + 
        CASE WHEN NEW."type" = 'Production' THEN NEW.quantity ELSE 0 END,
      "quantityReworked" = "quantityReworked" + 
        CASE WHEN NEW."type" = 'Rework' THEN NEW.quantity ELSE 0 END,
      "quantityScrapped" = "quantityScrapped" + 
        CASE WHEN NEW."type" = 'Scrap' THEN NEW.quantity ELSE 0 END
    WHERE id = NEW."jobOperationId";

  ELSIF TG_OP = 'UPDATE' THEN
    -- Adjust quantities on update by removing old values and adding new values
    UPDATE "jobOperation"
    SET 
      "quantityComplete" = "quantityComplete" 
        - CASE WHEN OLD."type" = 'Production' THEN OLD.quantity ELSE 0 END
        + CASE WHEN NEW."type" = 'Production' THEN NEW.quantity ELSE 0 END,
      "quantityReworked" = "quantityReworked" 
        - CASE WHEN OLD."type" = 'Rework' THEN OLD.quantity ELSE 0 END
        + CASE WHEN NEW."type" = 'Rework' THEN NEW.quantity ELSE 0 END,
      "quantityScrapped" = "quantityScrapped" 
        - CASE WHEN OLD."type" = 'Scrap' THEN OLD.quantity ELSE 0 END
        + CASE WHEN NEW."type" = 'Scrap' THEN NEW.quantity ELSE 0 END
    WHERE id = NEW."jobOperationId";

  ELSIF TG_OP = 'DELETE' THEN
    -- Decrement quantities on delete
    UPDATE "jobOperation"
    SET 
      "quantityComplete" = "quantityComplete" - 
        CASE WHEN OLD."type" = 'Production' THEN OLD.quantity ELSE 0 END,
      "quantityReworked" = "quantityReworked" - 
        CASE WHEN OLD."type" = 'Rework' THEN OLD.quantity ELSE 0 END,
      "quantityScrapped" = "quantityScrapped" - 
        CASE WHEN OLD."type" = 'Scrap' THEN OLD.quantity ELSE 0 END
    WHERE id = OLD."jobOperationId";
  END IF;

  RETURN NULL;
END;
$$;
