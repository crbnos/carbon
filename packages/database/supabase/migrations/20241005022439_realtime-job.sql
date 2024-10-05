-- Add job table to realtime publication
ALTER PUBLICATION supabase_realtime ADD TABLE job;

CREATE POLICY "Employees can insert production events for their company's job operations" ON "productionEvent"
FOR INSERT WITH CHECK (
  has_role('employee', "companyId") AND
  auth.uid()::text = "employeeId" AND
  "jobOperationId" IN (
    SELECT "id" FROM "jobOperation" WHERE "companyId" = ANY(
      SELECT "companyId" from "userToCompany" where "userId" = auth.uid()::text
    )
  )
);

CREATE POLICY "Employees can update production events for their company's job operations" ON "productionEvent"
FOR UPDATE USING (
  auth.uid()::text = "employeeId"
);

CREATE POLICY "Employees can insert production quantities for their company's job operations" ON "productionQuantity"
FOR INSERT WITH CHECK (
  has_role('employee', "companyId") AND
  "jobOperationId" IN (
    SELECT "id" FROM "jobOperation" WHERE "companyId" = ANY(
      SELECT "companyId" from "userToCompany" where "userId" = auth.uid()::text
    )
  )
);

-- Rewrite triggers to use SECURITY DEFINER

-- Drop existing triggers
DROP TRIGGER IF EXISTS insert_production_quantity_trigger ON "productionQuantity";
DROP TRIGGER IF EXISTS update_production_quantity_trigger ON "productionQuantity";
DROP TRIGGER IF EXISTS delete_production_quantity_trigger ON "productionQuantity";
DROP TRIGGER IF EXISTS set_job_operation_in_progress_trigger ON "productionEvent";
DROP TRIGGER IF EXISTS update_job_operation_status_trigger ON "productionEvent";
DROP TRIGGER IF EXISTS finish_job_operation_trigger ON "jobOperation";

-- Modify the function to use SECURITY DEFINER
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
    -- Adjust quantities on update
    UPDATE "jobOperation"
    SET 
      "quantityComplete" = "quantityComplete" + 
        CASE 
          WHEN NEW."type" = 'Production' THEN NEW.quantity
          WHEN OLD."type" = 'Production' THEN -OLD.quantity
          ELSE 0 
        END,
      "quantityReworked" = "quantityReworked" + 
        CASE 
          WHEN NEW."type" = 'Rework' THEN NEW.quantity
          WHEN OLD."type" = 'Rework' THEN -OLD.quantity
          ELSE 0 
        END,
      "quantityScrapped" = "quantityScrapped" + 
        CASE 
          WHEN NEW."type" = 'Scrap' THEN NEW.quantity
          WHEN OLD."type" = 'Scrap' THEN -OLD.quantity
          ELSE 0 
        END
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



-- Recreate triggers with SECURITY DEFINER
CREATE TRIGGER insert_production_quantity_trigger
AFTER INSERT ON "productionQuantity"
FOR EACH ROW
EXECUTE FUNCTION update_job_operation_quantities();

CREATE TRIGGER update_production_quantity_trigger
AFTER UPDATE ON "productionQuantity"
FOR EACH ROW
EXECUTE FUNCTION update_job_operation_quantities();

CREATE TRIGGER delete_production_quantity_trigger
AFTER DELETE ON "productionQuantity"
FOR EACH ROW
EXECUTE FUNCTION update_job_operation_quantities();

-- Drop existing triggers if they exist


-- Function to update job operation status when a production event is inserted
CREATE OR REPLACE FUNCTION update_job_operation_status_on_production_event()
RETURNS TRIGGER AS $$
BEGIN
  -- Update job operation status
  UPDATE "jobOperation"
  SET "status" = CASE WHEN NEW."endTime" IS NULL THEN 'In Progress' ELSE "status" END
  WHERE id = NEW."jobOperationId";

  -- Update job status
  UPDATE "job"
  SET "status" = 'In Progress'
  WHERE id = (SELECT "jobId" FROM "jobOperation" WHERE id = NEW."jobOperationId")
    AND "status" = 'Ready';

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create trigger for INSERT on productionEvent
CREATE TRIGGER set_job_operation_in_progress_trigger
AFTER INSERT ON "productionEvent"
FOR EACH ROW
EXECUTE FUNCTION update_job_operation_status_on_production_event();


-- Function to update job operation status when a production event is updated
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
    SET "status" = 'Waiting'
    WHERE id = NEW."jobOperationId";
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create trigger for UPDATE on productionEvent
CREATE TRIGGER update_job_operation_status_trigger
AFTER UPDATE ON "productionEvent"
FOR EACH ROW
EXECUTE FUNCTION update_job_operation_status_on_production_event_update();


-- Function to update production events and set job operation status to Done
CREATE OR REPLACE FUNCTION finish_job_operation()
RETURNS TRIGGER AS $$
BEGIN
  -- Set endTime for all open production events
  UPDATE "productionEvent"
  SET "endTime" = NOW()
  WHERE "jobOperationId" = NEW.id AND "endTime" IS NULL;

  -- Set the job operation status to Done
  NEW.status = 'Done';

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create trigger for UPDATE on jobOperation
CREATE TRIGGER finish_job_operation_trigger
BEFORE UPDATE ON "jobOperation"
FOR EACH ROW
WHEN (NEW.status = 'Done' AND OLD.status != 'Done')
EXECUTE FUNCTION finish_job_operation();
