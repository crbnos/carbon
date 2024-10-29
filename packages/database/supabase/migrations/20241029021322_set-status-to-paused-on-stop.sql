CREATE OR REPLACE FUNCTION update_job_operation_status_on_production_event_update()
RETURNS TRIGGER AS $$
BEGIN
  -- Check if there are any active production events for this job operation
  IF NOT EXISTS (
    SELECT 1 
    FROM "productionEvent"
    WHERE "jobOperationId" = NEW."jobOperationId" 
    AND "endTime" IS NULL
  ) THEN
    -- If no active events, set the status to 'Paused'
    UPDATE "jobOperation"
    SET "status" = 'Paused'
    WHERE id = NEW."jobOperationId";
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;