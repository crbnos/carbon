-- Create a dedicated table for operation dependencies
CREATE TABLE "jobOperationDependency" (
  "operationId" TEXT NOT NULL,
  "dependsOnId" TEXT NOT NULL,
  "jobId" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  
  CONSTRAINT "jobOperationDependency_pk" PRIMARY KEY ("operationId", "dependsOnId"),
  CONSTRAINT "jobOperationDependency_operationId_fk" FOREIGN KEY ("operationId") REFERENCES "jobOperation"("id") ON DELETE CASCADE,
  CONSTRAINT "jobOperationDependency_dependsOnId_fk" FOREIGN KEY ("dependsOnId") REFERENCES "jobOperation"("id") ON DELETE CASCADE,
  CONSTRAINT "jobOperationDependency_jobId_fk" FOREIGN KEY ("jobId") REFERENCES "job"("id") ON DELETE CASCADE,
  CONSTRAINT "jobOperationDependency_companyId_fk" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE,

  CONSTRAINT "jobOperationDependency_no_self_dependency" CHECK ("operationId" != "dependsOnId")
);

CREATE VIEW "jobOperationsWithDependencies" AS
SELECT 
  jo.*,
  COALESCE(
    (
      SELECT array_agg(jod."dependsOnId")
      FROM "jobOperationDependency" jod
      WHERE jod."operationId" = jo.id
    ),
    '{}'::text[]
  ) AS "dependencies"
FROM "jobOperation" jo;

CREATE INDEX "idx_jobOperationDependency_operationId" ON "jobOperationDependency" ("operationId");
CREATE INDEX "idx_jobOperationDependency_jobId" ON "jobOperationDependency" ("jobId");

-- Function to check if all dependencies are complete 
CREATE OR REPLACE FUNCTION check_operation_dependencies(operation_id TEXT)
RETURNS BOOLEAN
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  incomplete_deps INTEGER;
BEGIN
  SELECT COUNT(*)
  INTO incomplete_deps
  FROM "jobOperationDependency" dep
  JOIN "jobOperation" jo ON jo.id = dep."dependsOnId"
  WHERE dep."operationId" = operation_id
    AND jo.status != 'Done';

  RETURN incomplete_deps = 0;
END;
$$;

-- Function to update production events and set job operation status to Done
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

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to set initial status when dependencies are added
CREATE OR REPLACE FUNCTION set_initial_dependency_status()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
BEGIN
  -- Don't update if operation is already Done or In Progress
  IF EXISTS (
    SELECT 1
    FROM "jobOperation"
    WHERE id = NEW."operationId"
      AND status IN ('Done', 'In Progress', 'Canceled')
  ) THEN
    RETURN NEW;
  END IF;

  -- Check if there are any incomplete dependencies
  IF EXISTS (
    SELECT 1
    FROM "jobOperationDependency" dep
    JOIN "jobOperation" jo ON jo.id = dep."dependsOnId"
    WHERE dep."operationId" = NEW."operationId"
      AND jo.status != 'Done'
  ) THEN
    -- Set status to Waiting if there are incomplete dependencies
    UPDATE "jobOperation"
    SET status = 'Waiting'
    WHERE id = NEW."operationId";
  ELSE
    -- Set status to Ready if all dependencies are done or there are no dependencies
    UPDATE "jobOperation"
    SET status = 'Ready'
    WHERE id = NEW."operationId";
  END IF;

  RETURN NEW;
END;
$$;

-- Create trigger for new dependencies
CREATE OR REPLACE TRIGGER set_initial_status_on_dependency
AFTER INSERT ON "jobOperationDependency"
FOR EACH ROW
EXECUTE FUNCTION set_initial_dependency_status();