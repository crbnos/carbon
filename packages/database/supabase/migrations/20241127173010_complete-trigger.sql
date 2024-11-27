-- Drop existing trigger
DROP TRIGGER IF EXISTS finish_job_operation_trigger ON "jobOperation";

-- Function to update production events when job operation is marked as Done
CREATE OR REPLACE FUNCTION finish_job_operation()
RETURNS TRIGGER AS $$
DECLARE
  affected_rows integer;
BEGIN
  -- Set endTime for all open production events
  WITH updated_events AS (
    UPDATE "productionEvent"
    SET "endTime" = NOW()
    WHERE "jobOperationId" = NEW.id AND "endTime" IS NULL
    RETURNING id
  )
  SELECT COUNT(*) INTO affected_rows FROM updated_events;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create AFTER trigger for UPDATE on jobOperation
CREATE TRIGGER finish_job_operation_trigger
AFTER UPDATE ON "jobOperation"
FOR EACH ROW
WHEN (NEW.status = 'Done' AND OLD.status != 'Done')
EXECUTE FUNCTION finish_job_operation();
