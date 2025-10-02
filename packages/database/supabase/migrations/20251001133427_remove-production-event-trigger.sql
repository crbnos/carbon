DROP TRIGGER IF EXISTS update_job_operation_status_trigger ON "productionEvent";
CREATE INDEX IF NOT EXISTS "kanban_jobId_idx" ON "kanban" ("jobId");


CREATE OR REPLACE FUNCTION finish_job_operation()
RETURNS TRIGGER AS $$
BEGIN
  -- Set endTime for all open production events
  UPDATE "productionEvent"
  SET "endTime" = NOW()
  WHERE "jobOperationId" = NEW.id AND "endTime" IS NULL;

  -- Find all operations that depend on this one and might be ready
  UPDATE "jobOperation" op
  SET status = 'Ready'
  WHERE EXISTS (
    SELECT 1 
    FROM "jobOperationDependency" dep
    WHERE dep."operationId" = op.id
      AND dep."dependsOnId" = NEW.id
      AND op.status = 'Waiting'
  )
  AND NOT EXISTS (
    -- Check no other dependencies are incomplete
    SELECT 1
    FROM "jobOperationDependency" dep2
    JOIN "jobOperation" jo2 ON jo2.id = dep2."dependsOnId"
    WHERE dep2."operationId" = op.id
      AND jo2.status != 'Done'
      AND jo2.id != NEW.id
  );

  -- Set the job operation status to Done
  NEW.status = 'Done';

  -- If this is the last operation, mark the job as Done
  IF is_last_job_operation(NEW.id) THEN
    DECLARE
      request_id TEXT;
      notify_url TEXT;
      api_url TEXT;
      anon_key TEXT;
      group_ids TEXT[];
      assigned_to TEXT;
      sales_order_id TEXT;
    BEGIN
      -- Get job details
      DECLARE
        job_item_id TEXT;
        job_quantity_to_produce INTEGER;
        job_location_id TEXT;
        job_shelf_id TEXT;
        
      BEGIN
        

        SELECT "locationId", "shelfId"
        INTO job_location_id, job_shelf_id
        FROM "job" 
        WHERE "id" = NEW."jobId";

        

        -- Get sales order info
        SELECT "salesOrderId" INTO sales_order_id FROM "job" WHERE "id" = NEW."jobId";
        
        IF sales_order_id IS NOT NULL THEN
          -- Make-to-order: just update job status with quantityComplete
          UPDATE "job" 
          SET status = 'Completed',
              "completedDate" = NOW(),
              "quantityComplete" = NEW."quantityComplete",
              "updatedAt" = NOW(),
              "updatedBy" = NEW."updatedBy"
          WHERE id = NEW."jobId";
        ELSE
          -- Make-to-stock: update job status to Done and invoke edge function for inventory
          UPDATE "job" 
          SET status = 'Completed',
              "completedDate" = NOW(),
              "updatedAt" = NOW(),
              "updatedBy" = NEW."updatedBy"
          WHERE id = NEW."jobId";

          -- Invoke the issue edge function to handle inventory
          PERFORM util.invoke_edge_function(
            name => 'issue',
            body => CASE 
              WHEN job_shelf_id IS NOT NULL THEN
                jsonb_build_object(
                  'type', 'jobCompleteInventory',
                  'jobId', NEW."jobId",
                  'companyId', NEW."companyId",
                  'userId', NEW."updatedBy",
                  'quantityComplete', NEW."quantityComplete",
                  'locationId', job_location_id,
                  'shelfId', job_shelf_id
                )
              ELSE
                jsonb_build_object(
                  'type', 'jobCompleteInventory',
                  'jobId', NEW."jobId",
                  'companyId', NEW."companyId",
                  'userId', NEW."updatedBy",
                  'quantityComplete', NEW."quantityComplete",
                  'locationId', job_location_id
                )
            END
          );
        END IF;
      END;
      
      SELECT "apiUrl", "anonKey" INTO api_url, anon_key FROM "config" LIMIT 1;
      notify_url := api_url || '/functions/v1/trigger';

      SELECT "assignee", "salesOrderId" INTO assigned_to, sales_order_id FROM "job" WHERE "id" = NEW."jobId";

      IF sales_order_id IS NULL THEN
        SELECT "inventoryJobCompletedNotificationGroup" INTO group_ids FROM "companySettings" WHERE "id" = NEW."companyId";
      ELSE
        SELECT "salesJobCompletedNotificationGroup" INTO group_ids FROM "companySettings" WHERE "id" = NEW."companyId";
      END IF;

      IF assigned_to IS NOT NULL THEN
        SELECT array_append(group_ids, assigned_to) INTO group_ids;
      END IF;

      IF array_length(group_ids, 1) > 0 THEN
        SELECT net.http_post(
          notify_url,
          jsonb_build_object(
            'type', 'notify',
            'event', 'job-completed', 
            'documentId', NEW."jobId",
            'companyId', NEW."companyId",
            'recipient', jsonb_build_object(
              'type', 'group',
              'groupIds', group_ids
            )
          )::jsonb,
          '{}'::jsonb,
          jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || anon_key)
        ) INTO request_id;
      END IF;

    END;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;



-- Trigger to clear kanban jobId when job is completed or canceled
CREATE OR REPLACE FUNCTION job_complete_or_canceled()
RETURNS TRIGGER AS $$
BEGIN
  -- Check if status changed to 'Completed' or 'Canceled'
  IF (OLD."status" != NEW."status" AND (NEW."status" = 'Completed' OR NEW."status" = 'Cancelled')) THEN
    UPDATE "kanban" 
    SET "jobId" = NULL 
    WHERE "jobId" = NEW."id";
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE TRIGGER "job_completed_or_canceled_trigger"
AFTER UPDATE ON "job"
FOR EACH ROW EXECUTE FUNCTION job_complete_or_canceled();
