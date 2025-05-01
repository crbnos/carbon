DROP VIEW IF EXISTS "jobs";
CREATE OR REPLACE VIEW "jobs" WITH(SECURITY_INVOKER=true) AS
WITH job_model AS (
  SELECT
    j.id AS job_id,
    COALESCE(j."modelUploadId", i."modelUploadId") AS model_upload_id
  FROM "job" j
  INNER JOIN "item" i ON j."itemId" = i."id"
)
SELECT
  j.*,
   CASE 
    WHEN j.status = 'Completed' THEN 'Completed'
    WHEN j."status" = 'Cancelled' THEN 'Cancelled'
    WHEN j."dueDate" IS NOT NULL AND j."dueDate" < CURRENT_DATE THEN 'Overdue'
    WHEN j."dueDate" IS NOT NULL AND j."dueDate" = CURRENT_DATE THEN 'Due Today'
    ELSE j."status"
  END as "statusWithDueDate",
  i.name,
  i."readableId" as "itemReadableId",
  i.type as "itemType",
  i.name as "description",
  i."itemTrackingType",
  i.active,
  i."replenishmentSystem",
  mu.id as "modelId",
  mu."autodeskUrn",
  mu."modelPath",
  CASE
    WHEN i."thumbnailPath" IS NULL AND mu."thumbnailPath" IS NOT NULL THEN mu."thumbnailPath"
    ELSE i."thumbnailPath"
  END as "thumbnailPath",
  mu."name" as "modelName",
  mu."size" as "modelSize",
  so."salesOrderId" as "salesOrderReadableId",
  qo."quoteId" as "quoteReadableId"
FROM "job" j
INNER JOIN "item" i ON j."itemId" = i."id"
LEFT JOIN job_model jm ON j.id = jm.job_id
LEFT JOIN "modelUpload" mu ON mu.id = jm.model_upload_id
LEFT JOIN "salesOrder" so on j."salesOrderId" = so.id
LEFT JOIN "quote" qo ON j."quoteId" = qo.id;