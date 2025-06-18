ALTER TABLE "companySettings" 
  ADD COLUMN "inventoryJobCompletedNotificationGroup" TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN "salesJobCompletedNotificationGroup" TEXT[] NOT NULL DEFAULT '{}';


CREATE OR REPLACE FUNCTION is_last_job_operation(operation_id TEXT)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN NOT EXISTS (
    SELECT 1
    FROM "jobOperationDependency"
    WHERE "dependsOnId" = operation_id
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

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

