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
    SELECT "jobOperationId", MAX("endTime") as "lastActivity"
    FROM "productionEvent"
    WHERE "employeeId" = employee_id AND "companyId" = company_id
    GROUP BY "jobOperationId"
    ORDER BY MAX("endTime") DESC
    LIMIT 20
  ),
  recent_production_quantities AS (
    SELECT "jobOperationId", MAX("createdAt") as "lastActivity"
    FROM "productionQuantity"
    WHERE "createdBy" = employee_id AND "companyId" = company_id
    GROUP BY "jobOperationId"
    ORDER BY MAX("createdAt") DESC
    LIMIT 20
  ),
  combined_recent_activities AS (
    SELECT DISTINCT ON ("jobOperationId") "jobOperationId", "lastActivity"
    FROM (
      SELECT "jobOperationId", "lastActivity"
      FROM recent_production_events
      UNION ALL
      SELECT "jobOperationId", "lastActivity"
      FROM recent_production_quantities
    ) combined
    ORDER BY "jobOperationId", "lastActivity" DESC
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
  FROM combined_recent_activities cra
  JOIN "jobOperation" jo ON jo.id = cra."jobOperationId"
  JOIN "job" j ON j.id = jo."jobId"
  LEFT JOIN "salesOrderLine" sol ON sol."id" = j."salesOrderLineId"
  LEFT JOIN "salesOrder" so ON so."id" = sol."salesOrderId"
  LEFT JOIN "jobMakeMethod" jmm ON jo."jobMakeMethodId" = jmm.id
  LEFT JOIN "item" i ON jmm."itemId" = i.id
  LEFT JOIN "modelUpload" j_mu ON j_mu.id = j."modelUploadId"
  LEFT JOIN "modelUpload" i_mu ON i_mu.id = i."modelUploadId"
  ORDER BY cra."lastActivity" DESC
  LIMIT 20;
END;
$$ LANGUAGE plpgsql;