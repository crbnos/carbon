DROP TRIGGER IF EXISTS end_maintenance_events_on_complete_trigger ON "maintenanceDispatch";
DROP FUNCTION IF EXISTS end_maintenance_events_on_complete();

-- Trigger function to end all active maintenance events when dispatch is completed
CREATE OR REPLACE FUNCTION on_maintenance_dispatch_complete()
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


    -- Set actualEndTime to NOW() if it's not already set
    IF NEW."actualEndTime" IS NULL THEN
      UPDATE "maintenanceDispatch"
      SET
        "actualEndTime" = NOW(),
        "updatedBy" = NEW."updatedBy",
        "updatedAt" = NOW()
      WHERE id = NEW.id;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create trigger on maintenanceDispatch table
DROP TRIGGER IF EXISTS end_maintenance_events_on_complete_trigger ON "maintenanceDispatch";

CREATE TRIGGER on_maintenance_dispatch_complete_trigger
  AFTER UPDATE ON "maintenanceDispatch"
  FOR EACH ROW
  EXECUTE FUNCTION on_maintenance_dispatch_complete();
