DROP FUNCTION IF EXISTS get_assigned_job_operations;
CREATE OR REPLACE FUNCTION get_assigned_job_operations(
  user_id TEXT,
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
  "jobCustomerId" TEXT,
  "salesOrderReadableId" TEXT,
  "salesOrderId" TEXT,
  "salesOrderLineId" TEXT,
  "parentMaterialId" TEXT,
  "itemReadableId" TEXT,
  "itemDescription" TEXT,
  "operationStatus" "jobOperationStatus",
  "operationQuantity" NUMERIC(10,2),
  "quantityComplete" NUMERIC(10,2),
  "quantityScrapped" NUMERIC(10,2),
  "thumbnailPath" TEXT,
  "assignee" TEXT,
  "tags" TEXT[]
)
SECURITY INVOKER
AS $$
BEGIN
  RETURN QUERY
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
    j."customerId" AS "jobCustomerId",
    so."salesOrderId" AS "salesOrderReadableId",
    so."id" AS "salesOrderId",
    j."salesOrderLineId",
    jmm."parentMaterialId",
    i."readableId" as "itemReadableId",
    i."name" as "itemDescription",
    CASE
      WHEN j."status" = 'Paused' THEN 'Paused'
      ELSE jo."status"
    END AS "operationStatus",
    jo."operationQuantity",
    jo."quantityComplete",
    jo."quantityScrapped",
    CASE
      WHEN jmm."parentMaterialId" IS NULL THEN COALESCE(i."thumbnailPath", j_mu."thumbnailPath", i_mu."thumbnailPath")
      ELSE COALESCE(i."thumbnailPath", i_mu."thumbnailPath")
    END as "thumbnailPath",
    jo."assignee",
    jo."tags"
  FROM "jobOperation" jo
  JOIN "job" j ON j.id = jo."jobId"
  LEFT JOIN "salesOrderLine" sol ON sol."id" = j."salesOrderLineId"
  LEFT JOIN "salesOrder" so ON so."id" = sol."salesOrderId"
  LEFT JOIN "jobMakeMethod" jmm ON jo."jobMakeMethodId" = jmm.id
  LEFT JOIN "item" i ON jmm."itemId" = i.id
  LEFT JOIN "modelUpload" j_mu ON j_mu.id = j."modelUploadId"
  LEFT JOIN "modelUpload" i_mu ON i_mu.id = i."modelUploadId"
  WHERE jo."assignee" = user_id
  AND jo."status" IN ('Todo', 'Ready', 'Waiting', 'In Progress', 'Paused')
  AND j."status" IN ('Ready', 'In Progress', 'Paused')
  AND j."companyId" = company_id
  ORDER BY jo."priority";
END;
$$ LANGUAGE plpgsql;

DROP FUNCTION IF EXISTS get_recent_job_operations_by_employee;
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
  "jobCustomerId" TEXT,
  "salesOrderReadableId" TEXT,
  "salesOrderId" TEXT,
  "salesOrderLineId" TEXT,
  "parentMaterialId" TEXT,
  "itemReadableId" TEXT,
  "itemDescription" TEXT,
  "operationStatus" "jobOperationStatus",
  "operationQuantity" NUMERIC(10,2),
  "quantityComplete" NUMERIC(10,2),
  "quantityScrapped" NUMERIC(10,2),
  "thumbnailPath" TEXT,
  "assignee" TEXT,
  "tags" TEXT[]
)
SECURITY INVOKER
AS $$
BEGIN
  RETURN QUERY
  WITH recent_production_events AS (
    SELECT "jobOperationId", MAX("endTime") as "endTime"
    FROM "productionEvent"
    WHERE "employeeId" = employee_id AND "companyId" = company_id
    GROUP BY "jobOperationId"
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
    j."customerId" AS "jobCustomerId",
    so."salesOrderId" AS "salesOrderReadableId",
    so."id" AS "salesOrderId",
    j."salesOrderLineId",
    jmm."parentMaterialId",
    i."readableId" as "itemReadableId",
    i."name" as "itemDescription",
    jo."status" AS "operationStatus",
    jo."operationQuantity",
    jo."quantityComplete",
    jo."quantityScrapped",
    CASE
      WHEN jmm."parentMaterialId" IS NULL THEN COALESCE(i."thumbnailPath", j_mu."thumbnailPath", i_mu."thumbnailPath")
      ELSE COALESCE(i."thumbnailPath", i_mu."thumbnailPath")
    END as "thumbnailPath",
    jo."assignee",
    jo."tags"
  FROM recent_production_events rpe
  JOIN "jobOperation" jo ON jo.id = rpe."jobOperationId"
  JOIN "job" j ON j.id = jo."jobId"
  LEFT JOIN "salesOrderLine" sol ON sol."id" = j."salesOrderLineId"
  LEFT JOIN "salesOrder" so ON so."id" = sol."salesOrderId"
  LEFT JOIN "jobMakeMethod" jmm ON jo."jobMakeMethodId" = jmm.id
  LEFT JOIN "item" i ON jmm."itemId" = i.id
  LEFT JOIN "modelUpload" j_mu ON j_mu.id = j."modelUploadId"
  LEFT JOIN "modelUpload" i_mu ON i_mu.id = i."modelUploadId"
  ORDER BY rpe."endTime" DESC
  LIMIT 20;
END;
$$ LANGUAGE plpgsql;


DROP FUNCTION IF EXISTS get_active_job_operations_by_employee;
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
  "jobCustomerId" TEXT,
  "salesOrderReadableId" TEXT,
  "salesOrderId" TEXT,
  "salesOrderLineId" TEXT,
  "parentMaterialId" TEXT,
  "itemReadableId" TEXT,
  "itemDescription" TEXT,
  "operationStatus" "jobOperationStatus",
  "operationQuantity" NUMERIC(10,2),
  "quantityComplete" NUMERIC(10,2),
  "quantityScrapped" NUMERIC(10,2),
  "thumbnailPath" TEXT,
  "assignee" TEXT,
  "tags" TEXT[]
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
    j."customerId" AS "jobCustomerId",
    so."salesOrderId" AS "salesOrderReadableId",
    so."id" AS "salesOrderId",
    j."salesOrderLineId",
    jmm."parentMaterialId",
    i."readableId" as "itemReadableId",
    i."name" as "itemDescription",
    jo."status" AS "operationStatus",
    jo."operationQuantity",
    jo."quantityComplete",
    jo."quantityScrapped",
    CASE
      WHEN jmm."parentMaterialId" IS NULL THEN COALESCE(i."thumbnailPath", j_mu."thumbnailPath", i_mu."thumbnailPath")
      ELSE COALESCE(i."thumbnailPath", i_mu."thumbnailPath")
    END as "thumbnailPath",
    jo."assignee",
    jo."tags"
  FROM "jobOperation" jo
  JOIN "job" j ON j.id = jo."jobId"
  LEFT JOIN "salesOrderLine" sol ON sol."id" = j."salesOrderLineId"
  LEFT JOIN "salesOrder" so ON so."id" = sol."salesOrderId"
  LEFT JOIN "jobMakeMethod" jmm ON jo."jobMakeMethodId" = jmm.id
  LEFT JOIN "item" i ON jmm."itemId" = i.id
  LEFT JOIN "modelUpload" j_mu ON j_mu.id = j."modelUploadId"
  LEFT JOIN "modelUpload" i_mu ON i_mu.id = i."modelUploadId"
  JOIN active_production_events ape ON ape."jobOperationId" = jo.id;
END;
$$ LANGUAGE plpgsql;


DROP FUNCTION IF EXISTS get_active_job_operations_by_location;
CREATE OR REPLACE FUNCTION get_active_job_operations_by_location(
  location_id TEXT,
  work_center_ids TEXT[]
)
RETURNS TABLE (
  "id" TEXT,
  "jobId" TEXT,
  "operationOrder" DOUBLE PRECISION,
  "priority" DOUBLE PRECISION,
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
  "jobMakeMethodId" TEXT,
  "assignee" TEXT,
  "tags" TEXT[],
  "jobReadableId" TEXT,
  "jobStatus" "jobStatus",
  "jobDueDate" DATE,
  "jobDeadlineType" "deadlineType",
  "jobCustomerId" TEXT,
  "salesOrderReadableId" TEXT,
  "salesOrderId" TEXT,
  "salesOrderLineId" TEXT,
  "parentMaterialId" TEXT,
  "itemReadableId" TEXT,
  "itemDescription" TEXT,
  "operationStatus" "jobOperationStatus",
  "operationQuantity" NUMERIC(10,2),
  "quantityComplete" NUMERIC(10,2),
  "quantityScrapped" NUMERIC(10,2),
  "thumbnailPath" TEXT
)
SECURITY INVOKER
AS $$
BEGIN
  RETURN QUERY
  WITH relevant_jobs AS (
    SELECT
      j."id",
      j."jobId",
      j."status",
      j."dueDate",
      j."deadlineType",
      j."customerId",
      so."salesOrderId" AS "salesOrderReadableId",
      so."id" AS "salesOrderId",
      j."salesOrderLineId",
      mu."thumbnailPath"
    FROM "job" j
    LEFT JOIN "salesOrderLine" sol ON sol."id" = j."salesOrderLineId"
    LEFT JOIN "salesOrder" so ON so."id" = sol."salesOrderId"
    LEFT JOIN "modelUpload" mu ON mu.id = j."modelUploadId"
    WHERE j."locationId" = location_id
    AND (j."status" = 'Ready' OR j."status" = 'In Progress' OR j."status" = 'Paused')
  )
  SELECT
    jo."id",
    jo."jobId",
    jo."order" AS "operationOrder",
    jo."priority",
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
    jo."jobMakeMethodId",
    jo."assignee",
    jo."tags",
    rj."jobId" AS "jobReadableId",
    rj."status" AS "jobStatus",
    rj."dueDate" AS "jobDueDate",
    rj."deadlineType" AS "jobDeadlineType",
    rj."customerId" AS "jobCustomerId",
    rj."salesOrderReadableId",
    rj."salesOrderId",
    rj."salesOrderLineId",
    jmm."parentMaterialId",
    i."readableId" as "itemReadableId",
    i."name" as "itemDescription",
    CASE
      WHEN rj."status" = 'Paused' THEN 'Paused'
      ELSE jo."status"
    END AS "operationStatus",
    jo."operationQuantity",
    jo."quantityComplete",
    jo."quantityScrapped",
    CASE
      WHEN jmm."parentMaterialId" IS NULL THEN COALESCE(i."thumbnailPath", rj."thumbnailPath", mu."thumbnailPath")
      ELSE COALESCE(i."thumbnailPath", mu."thumbnailPath")
    END as "thumbnailPath"
  FROM "jobOperation" jo
  JOIN relevant_jobs rj ON rj.id = jo."jobId"
  LEFT JOIN "jobMakeMethod" jmm ON jo."jobMakeMethodId" = jmm.id
  LEFT JOIN "item" i ON jmm."itemId" = i.id
  LEFT JOIN "modelUpload" mu ON mu.id = i."modelUploadId"
  WHERE CASE
    WHEN array_length(work_center_ids, 1) > 0 THEN 
      jo."workCenterId" = ANY(work_center_ids) AND jo."status" != 'Done' AND jo."status" != 'Canceled'
    ELSE jo."status" != 'Done' AND jo."status" != 'Canceled'
  END
  ORDER BY jo."priority";
END;
$$ LANGUAGE plpgsql;