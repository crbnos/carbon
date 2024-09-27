CREATE OR REPLACE FUNCTION get_job_operations_by_work_center(
  work_center_id TEXT,
  location_id TEXT
)
RETURNS TABLE (
  "jobOperationId" TEXT,
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
  "jobNumber" TEXT,
  "jobStatus" "jobStatus",
  "jobPriority" INTEGER,
  "jobDueDate" DATE,
  "parentMaterialId" TEXT,
  "parentMaterialReadableId" TEXT
)
SECURITY INVOKER
AS $$
BEGIN
  RETURN QUERY
  WITH relevant_job_operations AS (
    SELECT jo.*
    FROM "jobOperation" jo
    WHERE jo."workCenterId" = work_center_id
  )
  SELECT
    rjo."id" AS "jobOperationId",
    rjo."jobId",
    rjo."order" AS "operationOrder",
    rjo."processId",
    rjo."workCenterId",
    rjo."description",
    rjo."setupTime",
    rjo."setupUnit",
    rjo."laborTime",
    rjo."laborUnit",
    rjo."machineTime",
    rjo."machineUnit",
    rjo."operationOrder" AS "operationOrderType",
    j."jobId" AS "jobNumber",
    j."status" AS "jobStatus",
    j."priority" AS "jobPriority",
    j."dueDate" AS "jobDueDate",
    jmm."parentMaterialId",
    i."readableId" AS "parentMaterialReadableId"
  FROM relevant_job_operations rjo
  JOIN "job" j ON j."id" = rjo."jobId"
  LEFT JOIN "jobMakeMethod" jmm ON j."id" = jmm."jobId"
  LEFT JOIN "item" i ON jmm."parentMaterialId" = i."id"
  WHERE j."locationId" = location_id;
END;
$$ LANGUAGE plpgsql;
