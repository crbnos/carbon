

CREATE TYPE "jobOperationStatus" AS ENUM (
  'Canceled',
  'Done',
  'In Progress',
  'Paused',
  'Ready',
  'Todo',
  'Waiting'
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
