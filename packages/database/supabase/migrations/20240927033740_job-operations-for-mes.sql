
ALTER TABLE "jobOperation" 
  ADD COLUMN "quantityReworked" NUMERIC(10,2) DEFAULT 0;

CREATE TYPE "jobOperationStatus" AS ENUM (
  'Canceled',
  'Done',
  'In Progress',
  'Paused',
  'Ready',
  'Todo',
  'Waiting'
);

CREATE TYPE "productionEventType" AS ENUM (
  'Setup',
  'Labor',
  'Machine'
);

CREATE TABLE "productionEvent" (
  "id" TEXT NOT NULL DEFAULT xid(),
  "jobOperationId" TEXT NOT NULL,
  "type" "productionEventType",
  "startTime" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "endTime" TIMESTAMP WITH TIME ZONE,
  "duration" INTEGER GENERATED ALWAYS AS (
    CASE
      WHEN "endTime" IS NULL THEN 0
      ELSE EXTRACT(EPOCH FROM ("endTime" - "startTime"))::INTEGER
    END
  ) STORED,
  "employeeId" TEXT,
  "workCenterId" TEXT,
  "companyId" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "createdBy" TEXT NOT NULL,
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  "updatedBy" TEXT,

  CONSTRAINT "productionEvent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "productionEvent_jobOperationId_fkey" FOREIGN KEY ("jobOperationId") REFERENCES "jobOperation"("id") ON DELETE CASCADE,
  CONSTRAINT "productionEvent_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "user"("id") ON DELETE SET NULL,
  CONSTRAINT "productionEvent_workCenterId_fkey" FOREIGN KEY ("workCenterId") REFERENCES "workCenter"("id") ON DELETE SET NULL,
  CONSTRAINT "productionEvent_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE,
  CONSTRAINT "productionEvent_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user"("id") ON DELETE RESTRICT,
  CONSTRAINT "productionEvent_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "user"("id") ON DELETE RESTRICT
);

-- Create separate indexes on companyId, jobOperationId, and employeeId
CREATE INDEX "idx_productionEvent_companyId" ON "productionEvent" ("companyId");
CREATE INDEX "idx_productionEvent_jobOperationId" ON "productionEvent" ("jobOperationId");
CREATE INDEX "idx_productionEvent_employeeId" ON "productionEvent" ("employeeId", "companyId");


ALTER TABLE "productionEvent" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Requests with an API key can access production events" ON "productionEvent"
FOR ALL USING (
  has_valid_api_key_for_company("companyId")
);

-- Policy for employees to view their own production events
CREATE POLICY "Employees can view their own production events" ON "productionEvent"
FOR SELECT USING (
  auth.uid()::text = "employeeId"
);

-- Policy for users with production_view to see all production events related to the company
CREATE POLICY "Users with production_view can see all production events" ON "productionEvent"
FOR SELECT USING (
  has_role('employee', "companyId") AND
  has_company_permission('production_view', "companyId")
);

-- Policy for users with production_create to insert production events
CREATE POLICY "Users with production_create can insert production events" ON "productionEvent"
FOR INSERT WITH CHECK (
  has_role('employee', "companyId") AND
  has_company_permission('production_create', "companyId")
);

-- Policy for users with production_update to update production events
CREATE POLICY "Users with production_update can update production events" ON "productionEvent"
FOR UPDATE USING (
  has_role('employee', "companyId") AND
  has_company_permission('production_update', "companyId")
);

-- Policy for users with production_delete to delete production events
CREATE POLICY "Users with production_delete can delete production events" ON "productionEvent"
FOR DELETE USING (
  has_role('employee', "companyId") AND
  has_company_permission('production_delete', "companyId")
);


ALTER TABLE "jobOperation"
ADD COLUMN "status" "jobOperationStatus" NOT NULL DEFAULT 'Todo';

CREATE OR REPLACE VIEW "jobOperationsWithMakeMethods" WITH(SECURITY_INVOKER=true) AS
  SELECT 
    mm.id AS "makeMethodId",
    jo.*
  FROM "jobOperation" jo
  INNER JOIN "jobMakeMethod" jmm 
    ON jo."jobMakeMethodId" = jmm.id
  LEFT JOIN "makeMethod" mm 
    ON jmm."itemId" = mm."itemId";

CREATE INDEX idx_job_status_location ON "job" ("status", "locationId");

CREATE OR REPLACE FUNCTION get_job_operations_by_work_center(
  work_center_id TEXT,
  location_id TEXT
)
RETURNS TABLE (
  "id" TEXT,
  "jobId" TEXT,
  "operationOrder" DOUBLE PRECISION,
  "processId" TEXT,
  "workCenterId" TEXT,
  "description" TEXT,
  "setupTime" NUMERIC(10,2),
  "setupUnit" factor,
  "laborTime" NUMERIC(10,2),
  "laborUnit" factor,
  "machineTime" NUMERIC(10,2),
  "machineUnit" factor,
  "operationOrderType" "methodOperationOrder",
  "jobReadableId" TEXT,
  "jobStatus" "jobStatus",
  "jobDueDate" DATE,
  "jobDeadlineType" "deadlineType",
  "parentMaterialId" TEXT,
  "itemReadableId" TEXT,
  "operationStatus" "jobOperationStatus",
  "operationQuantity" NUMERIC(10,2),
  "quantityComplete" NUMERIC(10,2),
  "quantityScrapped" NUMERIC(10,2)
)
SECURITY INVOKER
AS $$
BEGIN
  RETURN QUERY
  WITH relevant_jobs AS (
    SELECT *
    FROM "job"
    WHERE "locationId" = location_id
    AND ("status" = 'Ready' OR "status" = 'In Progress' OR "status" = 'Paused')
  )
  SELECT
    jo."id",
    jo."jobId",
    jo."order" AS "operationOrder",
    jo."processId",
    jo."workCenterId",
    jo."description",
    jo."setupTime",
    jo."setupUnit",
    jo."laborTime",
    jo."laborUnit",
    jo."machineTime",
    jo."machineUnit",
    jo."operationOrder" AS "operationOrderType",
    rj."jobId" AS "jobReadableId",
    rj."status" AS "jobStatus",
    rj."dueDate" AS "jobDueDate",
    rj."deadlineType" AS "jobDeadlineType",
    jmm."parentMaterialId",
    i."readableId" as "itemReadableId",
    CASE
      WHEN rj."status" = 'Paused' THEN 'Paused'
      ELSE jo."status"
    END AS "operationStatus",
    jo."operationQuantity",
    jo."quantityComplete",
    jo."quantityScrapped"
  FROM "jobOperation" jo
  JOIN relevant_jobs rj ON rj.id = jo."jobId"
  LEFT JOIN "jobMakeMethod" jmm ON jo."jobMakeMethodId" = jmm.id
  LEFT JOIN "item" i ON jmm."itemId" = i.id
  WHERE jo."workCenterId" = work_center_id;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION get_active_job_operations_by_employee(
  employee_id TEXT, 
  company_id TEXT
)
RETURNS TABLE (
  "id" TEXT,
  "jobId" TEXT,
  "operationOrder" DOUBLE PRECISION,
  "processId" TEXT,
  "workCenterId" TEXT,
  "description" TEXT,
  "setupTime" NUMERIC(10,2),
  "setupUnit" factor,
  "laborTime" NUMERIC(10,2),
  "laborUnit" factor,
  "machineTime" NUMERIC(10,2),
  "machineUnit" factor,
  "operationOrderType" "methodOperationOrder",
  "jobReadableId" TEXT,
  "jobStatus" "jobStatus",
  "jobDueDate" DATE,
  "jobDeadlineType" "deadlineType",
  "parentMaterialId" TEXT,
  "itemReadableId" TEXT,
  "operationStatus" "jobOperationStatus",
  "operationQuantity" NUMERIC(10,2),
  "quantityComplete" NUMERIC(10,2),
  "quantityScrapped" NUMERIC(10,2)
)
SECURITY INVOKER
AS $$
BEGIN
  RETURN QUERY
  WITH active_production_events AS (
    SELECT DISTINCT "jobOperationId"
    FROM "productionEvent"
    WHERE "employeeId" = employee_id AND "endTime" IS NULL AND "companyId" = company_id
  )
  SELECT
    jo."id",
    jo."jobId",
    jo."order" AS "operationOrder",
    jo."processId",
    jo."workCenterId",
    jo."description",
    jo."setupTime",
    jo."setupUnit",
    jo."laborTime",
    jo."laborUnit",
    jo."machineTime",
    jo."machineUnit",
    jo."operationOrder" AS "operationOrderType",
    j."jobId" AS "jobReadableId",
    j."status" AS "jobStatus",
    j."dueDate" AS "jobDueDate",
    j."deadlineType" AS "jobDeadlineType",
    jmm."parentMaterialId",
    i."readableId" as "itemReadableId",
    jo."status" AS "operationStatus",
    jo."operationQuantity",
    jo."quantityComplete",
    jo."quantityScrapped"
  FROM "jobOperation" jo
  JOIN "job" j ON j.id = jo."jobId"
  LEFT JOIN "jobMakeMethod" jmm ON jo."jobMakeMethodId" = jmm.id
  LEFT JOIN "item" i ON jmm."itemId" = i.id
  JOIN active_production_events ape ON ape."jobOperationId" = jo.id;
END;
$$ LANGUAGE plpgsql;


CREATE OR REPLACE FUNCTION get_active_job_count(employee_id TEXT, company_id TEXT)
RETURNS INTEGER
SECURITY INVOKER
AS $$
DECLARE
  active_count INTEGER;
BEGIN
  SELECT COUNT(DISTINCT "jobOperationId")
  INTO active_count
  FROM "productionEvent"
  WHERE "employeeId" = employee_id
    AND "companyId" = company_id
    AND "endTime" IS NULL;

  RETURN active_count;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION get_recent_job_operations_by_employee(
  employee_id TEXT, 
  company_id TEXT
)
RETURNS TABLE (
  "id" TEXT,
  "jobId" TEXT,
  "operationOrder" DOUBLE PRECISION,
  "processId" TEXT,
  "workCenterId" TEXT,
  "description" TEXT,
  "setupTime" NUMERIC(10,2),
  "setupUnit" factor,
  "laborTime" NUMERIC(10,2),
  "laborUnit" factor,
  "machineTime" NUMERIC(10,2),
  "machineUnit" factor,
  "operationOrderType" "methodOperationOrder",
  "jobReadableId" TEXT,
  "jobStatus" "jobStatus",
  "jobDueDate" DATE,
  "jobDeadlineType" "deadlineType",
  "parentMaterialId" TEXT,
  "itemReadableId" TEXT,
  "operationStatus" "jobOperationStatus",
  "operationQuantity" NUMERIC(10,2),
  "quantityComplete" NUMERIC(10,2),
  "quantityScrapped" NUMERIC(10,2)
)
SECURITY INVOKER
AS $$
BEGIN
  RETURN QUERY
  WITH recent_production_events AS (
    SELECT DISTINCT ON ("jobOperationId") "jobOperationId", "startTime"
    FROM "productionEvent"
    WHERE "employeeId" = employee_id AND "companyId" = company_id
    ORDER BY "jobOperationId", "startTime" DESC
  )
  SELECT DISTINCT ON (jo."id")
    jo."id",
    jo."jobId",
    jo."order" AS "operationOrder",
    jo."processId",
    jo."workCenterId",
    jo."description",
    jo."setupTime",
    jo."setupUnit",
    jo."laborTime",
    jo."laborUnit",
    jo."machineTime",
    jo."machineUnit",
    jo."operationOrder" AS "operationOrderType",
    j."jobId" AS "jobReadableId",
    j."status" AS "jobStatus",
    j."dueDate" AS "jobDueDate",
    j."deadlineType" AS "jobDeadlineType",
    jmm."parentMaterialId",
    i."readableId" as "itemReadableId",
    jo."status" AS "operationStatus",
    jo."operationQuantity",
    jo."quantityComplete",
    jo."quantityScrapped"
  FROM "jobOperation" jo
  JOIN "job" j ON j.id = jo."jobId"
  LEFT JOIN "jobMakeMethod" jmm ON jo."jobMakeMethodId" = jmm.id
  LEFT JOIN "item" i ON jmm."itemId" = i.id
  JOIN recent_production_events rpe ON rpe."jobOperationId" = jo.id
  ORDER BY jo."id", rpe."startTime" DESC
  LIMIT 20;
END;
$$ LANGUAGE plpgsql;


CREATE OR REPLACE FUNCTION get_job_operation_by_id(operation_id TEXT)
RETURNS TABLE (
  id TEXT,
  "jobId" TEXT,
  "jobMakeMethodId" TEXT,
  "operationOrder" DOUBLE PRECISION,
  "processId" TEXT,
  "workCenterId" TEXT,
  description TEXT,
  "setupTime" NUMERIC,
  "setupUnit" factor,
  "laborTime" NUMERIC,
  "laborUnit" factor,
  "machineTime" NUMERIC,
  "machineUnit" factor,
  "operationOrderType" "methodOperationOrder",
  "jobReadableId" TEXT,
  "jobStatus" "jobStatus",
  "jobDueDate" DATE,
  "jobDeadlineType" "deadlineType",
  "parentMaterialId" TEXT,
  "itemReadableId" TEXT,
  "itemDescription" TEXT,
  "itemUnitOfMeasure" TEXT,
  "itemAutodeskUrn" TEXT,
  "operationStatus" "jobOperationStatus",
  "operationQuantity" NUMERIC,
  "quantityComplete" NUMERIC,
  "quantityReworked" NUMERIC,
  "quantityScrapped" NUMERIC,
  "workInstruction" JSON
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    jo."id",
    jo."jobId",
    jo."jobMakeMethodId",
    jo."order" AS "operationOrder",
    jo."processId",
    jo."workCenterId",
    jo."description",
    jo."setupTime",
    jo."setupUnit",
    jo."laborTime",
    jo."laborUnit",
    jo."machineTime",
    jo."machineUnit",
    jo."operationOrder" AS "operationOrderType",
    j."jobId" AS "jobReadableId",
    j."status" AS "jobStatus",
    j."dueDate"::DATE AS "jobDueDate",
    j."deadlineType" AS "jobDeadlineType",
    jmm."parentMaterialId",
    i."readableId" as "itemReadableId",
    i."name" as "itemDescription",
    uom."name" as "itemUnitOfMeasure",
    m."autodeskUrn" as "itemAutodeskUrn",
    jo."status" AS "operationStatus",
    jo."operationQuantity",
    jo."quantityComplete",
    jo."quantityReworked",
    jo."quantityScrapped",
    jo."workInstruction"
  FROM "jobOperation" jo
  JOIN "job" j ON j.id = jo."jobId"
  LEFT JOIN "jobMakeMethod" jmm ON jo."jobMakeMethodId" = jmm.id
  LEFT JOIN "item" i ON jmm."itemId" = i.id
  LEFT JOIN "unitOfMeasure" uom ON i."unitOfMeasureCode" = uom."code" AND i."companyId" = uom."companyId"
  LEFT JOIN "modelUpload" m ON i."modelUploadId" = m.id
  WHERE jo.id = operation_id 
  LIMIT 1;
END;
$$ LANGUAGE plpgsql;
