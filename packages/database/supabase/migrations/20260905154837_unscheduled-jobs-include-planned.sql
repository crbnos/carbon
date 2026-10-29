-- Include Planned jobs in the priorities Dates board (week/month) Unscheduled column.
-- Previously Planned jobs with no due date appeared nowhere on the board: the dated
-- columns (get_jobs_by_date_range) already include every status except Cancelled, but
-- the Unscheduled column (get_unscheduled_jobs) dropped Draft/Planned/Completed. Planned
-- work belongs on the schedule, so it is no longer excluded here. Draft (not yet firm)
-- and Completed stay out. The Work Centers board (get_active_job_operations_by_location)
-- is deliberately unchanged — it only shows released work.

DROP FUNCTION IF EXISTS get_unscheduled_jobs(TEXT);
CREATE OR REPLACE FUNCTION get_unscheduled_jobs(
  location_id TEXT
)
RETURNS TABLE (
  "id" TEXT,
  "jobId" TEXT,
  "status" "jobStatus",
  "dueDate" DATE,
  "completedDate" TIMESTAMP WITH TIME ZONE,
  "deadlineType" "deadlineType",
  "customerId" TEXT,
  "customerName" TEXT,
  "salesOrderReadableId" TEXT,
  "salesOrderId" TEXT,
  "salesOrderLineId" TEXT,
  "itemId" TEXT,
  "itemReadableId" TEXT,
  "itemDescription" TEXT,
  "quantity" NUMERIC,
  "quantityComplete" NUMERIC,
  "quantityShipped" NUMERIC,
  "priority" DOUBLE PRECISION,
  "assignee" TEXT,
  "tags" TEXT[],
  "thumbnailPath" TEXT,
  "operationCount" INTEGER,
  "completedOperationCount" INTEGER,
  "hasConflict" BOOLEAN,
  "jobMakeMethodId" TEXT
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
      j."completedDate",
      j."deadlineType",
      j."customerId",
      j."salesOrderLineId",
      j."quantity",
      j."quantityShipped",
      j."priority",
      j."assignee",
      j."tags",
      mu."thumbnailPath"
    FROM "job" j
    LEFT JOIN "modelUpload" mu ON mu.id = j."modelUploadId"
    WHERE j."locationId" = location_id
    AND j."dueDate" IS NULL
    AND j."status" NOT IN ('Cancelled', 'Draft', 'Completed')
  ),
  job_items AS (
    SELECT DISTINCT ON (jmm."jobId")
      jmm."jobId",
      jmm."id" AS "jobMakeMethodId",
      jmm."itemId",
      i."readableId" AS "itemReadableId",
      i."name" AS "itemDescription",
      i."thumbnailPath" AS "itemThumbnailPath",
      imu."thumbnailPath" AS "itemModelThumbnailPath"
    FROM "jobMakeMethod" jmm
    LEFT JOIN "item" i ON i.id = jmm."itemId"
    LEFT JOIN "modelUpload" imu ON imu.id = i."modelUploadId"
    WHERE jmm."parentMaterialId" IS NULL
    ORDER BY jmm."jobId", jmm."createdAt"
  ),
  -- Only count operations from the parent make method (not subassemblies)
  operation_stats AS (
    SELECT
      jo."jobId",
      COUNT(*)::INTEGER AS "operationCount",
      COUNT(*) FILTER (WHERE jo."status" = 'Done')::INTEGER AS "completedOperationCount",
      BOOL_OR(COALESCE(jo."hasConflict", FALSE)) AS "hasConflict"
    FROM "jobOperation" jo
    INNER JOIN "jobMakeMethod" jmm ON jo."jobMakeMethodId" = jmm.id
    WHERE jmm."parentMaterialId" IS NULL
    GROUP BY jo."jobId"
  ),
  -- Get quantity complete from only the parent make method operations
  -- Use the MAX to get the highest quantity completed across all root-level operations
  parent_quantity_complete AS (
    SELECT
      jo."jobId",
      MAX(jo."quantityComplete") AS "quantityComplete"
    FROM "jobOperation" jo
    INNER JOIN "jobMakeMethod" jmm ON jo."jobMakeMethodId" = jmm.id
    WHERE jmm."parentMaterialId" IS NULL
    GROUP BY jo."jobId"
  )
  SELECT
    rj."id",
    rj."jobId",
    rj."status",
    rj."dueDate",
    rj."completedDate",
    rj."deadlineType",
    rj."customerId",
    c."name" AS "customerName",
    so."salesOrderId" AS "salesOrderReadableId",
    so."id" AS "salesOrderId",
    rj."salesOrderLineId",
    ji."itemId",
    ji."itemReadableId",
    ji."itemDescription",
    rj."quantity",
    COALESCE(pqc."quantityComplete", 0) AS "quantityComplete",
    rj."quantityShipped",
    rj."priority",
    rj."assignee",
    rj."tags",
    COALESCE(ji."itemThumbnailPath", ji."itemModelThumbnailPath", rj."thumbnailPath") AS "thumbnailPath",
    COALESCE(os."operationCount", 0) AS "operationCount",
    COALESCE(os."completedOperationCount", 0) AS "completedOperationCount",
    COALESCE(os."hasConflict", FALSE) AS "hasConflict",
    ji."jobMakeMethodId"
  FROM relevant_jobs rj
  LEFT JOIN "salesOrderLine" sol ON sol."id" = rj."salesOrderLineId"
  LEFT JOIN "salesOrder" so ON so."id" = sol."salesOrderId"
  LEFT JOIN "customer" c ON c."id" = rj."customerId"
  LEFT JOIN job_items ji ON ji."jobId" = rj."id"
  LEFT JOIN operation_stats os ON os."jobId" = rj."id"
  LEFT JOIN parent_quantity_complete pqc ON pqc."jobId" = rj."id"
  ORDER BY rj."priority" DESC;
END;
$$ LANGUAGE plpgsql;
