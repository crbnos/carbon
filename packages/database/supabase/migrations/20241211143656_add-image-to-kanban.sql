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
      COALESCE(j."modelUploadId", i."modelUploadId") AS model_upload_id
    FROM "job" j
    INNER JOIN "item" i ON j."itemId" = i."id"
    LEFT JOIN "salesOrderLine" sol ON sol."id" = j."salesOrderLineId"
    LEFT JOIN "salesOrder" so ON so."id" = sol."salesOrderId"
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
    CASE
      WHEN rj."status" = 'Paused' THEN 'Paused'
      ELSE jo."status"
    END AS "operationStatus",
    jo."operationQuantity",
    jo."quantityComplete",
    jo."quantityScrapped",
    CASE
      WHEN i."thumbnailPath" IS NULL AND mu."thumbnailPath" IS NOT NULL THEN mu."thumbnailPath"
      ELSE i."thumbnailPath"
    END as "thumbnailPath"
  FROM "jobOperation" jo
  JOIN relevant_jobs rj ON rj.id = jo."jobId"
  LEFT JOIN "jobMakeMethod" jmm ON jo."jobMakeMethodId" = jmm.id
  LEFT JOIN "item" i ON jmm."itemId" = i.id
  LEFT JOIN "modelUpload" mu ON mu.id = rj.model_upload_id
  WHERE CASE
    WHEN array_length(work_center_ids, 1) > 0 THEN 
      jo."workCenterId" = ANY(work_center_ids) AND jo."status" != 'Done' AND jo."status" != 'Canceled'
    ELSE jo."status" != 'Done' AND jo."status" != 'Canceled'
  END
  ORDER BY jo."priority";
END;
$$ LANGUAGE plpgsql;