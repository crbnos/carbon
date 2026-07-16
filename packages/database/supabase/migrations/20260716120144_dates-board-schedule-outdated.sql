-- Expose the reactive-replanning stale reason on the schedule dates board.
-- Definition = live get_jobs_by_date_range + scheduleOutdatedReason carried
-- through relevant_jobs and appended as the last output column.
DROP FUNCTION IF EXISTS get_jobs_by_date_range(TEXT, DATE, DATE);
CREATE OR REPLACE FUNCTION public.get_jobs_by_date_range(location_id text, start_date date, end_date date)
 RETURNS TABLE(id text, "jobId" text, status "jobStatus", "dueDate" date, "completedDate" timestamp with time zone, "deadlineType" "deadlineType", "customerId" text, "customerName" text, "salesOrderReadableId" text, "salesOrderId" text, "salesOrderLineId" text, "itemId" text, "itemReadableId" text, "itemDescription" text, quantity numeric, "quantityComplete" numeric, "quantityShipped" numeric, priority double precision, assignee text, tags text[], "thumbnailPath" text, "operationCount" integer, "completedOperationCount" integer, "hasConflict" boolean, "jobMakeMethodId" text, "scheduleOutdatedReason" text)
 LANGUAGE plpgsql
AS $function$
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
      mu."thumbnailPath",
      j."scheduleOutdatedReason"
    FROM "job" j
    LEFT JOIN "modelUpload" mu ON mu.id = j."modelUploadId"
    WHERE j."locationId" = location_id
    AND j."dueDate" IS NOT NULL
    AND j."dueDate" >= start_date
    AND j."dueDate" <= end_date
    AND j."status" != 'Cancelled'
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
    ji."jobMakeMethodId",
    rj."scheduleOutdatedReason"
  FROM relevant_jobs rj
  LEFT JOIN "salesOrderLine" sol ON sol."id" = rj."salesOrderLineId"
  LEFT JOIN "salesOrder" so ON so."id" = sol."salesOrderId"
  LEFT JOIN "customer" c ON c."id" = rj."customerId"
  LEFT JOIN job_items ji ON ji."jobId" = rj."id"
  LEFT JOIN operation_stats os ON os."jobId" = rj."id"
  LEFT JOIN parent_quantity_complete pqc ON pqc."jobId" = rj."id"
  ORDER BY rj."dueDate";
END;
$function$


