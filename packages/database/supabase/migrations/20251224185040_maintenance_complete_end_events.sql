-- Trigger function to end all active maintenance events when dispatch is completed
CREATE OR REPLACE FUNCTION end_maintenance_events_on_complete()
RETURNS TRIGGER AS $$
BEGIN
  -- Only run when status changes to 'Completed'
  IF NEW.status = 'Completed' AND (OLD.status IS NULL OR OLD.status != 'Completed') THEN
    -- End all active events (those with null endTime) for this dispatch
    UPDATE "maintenanceDispatchEvent"
    SET
      "endTime" = COALESCE(NEW."completedAt", NOW()),
      "updatedBy" = NEW."updatedBy",
      "updatedAt" = NOW()
    WHERE
      "maintenanceDispatchId" = NEW.id
      AND "endTime" IS NULL;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create trigger on maintenanceDispatch table
DROP TRIGGER IF EXISTS end_maintenance_events_on_complete_trigger ON "maintenanceDispatch";

CREATE TRIGGER end_maintenance_events_on_complete_trigger
  AFTER UPDATE ON "maintenanceDispatch"
  FOR EACH ROW
  EXECUTE FUNCTION end_maintenance_events_on_complete();
