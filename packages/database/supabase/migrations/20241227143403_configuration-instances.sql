ALTER TABLE "quoteLine" ADD COLUMN "configuration" JSONB;
ALTER TABLE "job" ADD COLUMN "configuration" JSONB;

DROP POLICY "Employees with parts_view can view configuration options" ON "configurationParameter";
DROP POLICY "Employees with parts_view can view configuration groups" ON "configurationParameterGroup";

CREATE POLICY "Employees can view configuration options" ON "configurationParameter"
  FOR SELECT
  USING (
    has_role('employee', "companyId") 
  );

CREATE POLICY "Employees can view configuration groups" ON "configurationParameterGroup"
  FOR SELECT
  USING (
    has_role('employee', "companyId")
  );

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

-- Update quoteLines view
DROP VIEW IF EXISTS "quoteLines";
CREATE OR REPLACE VIEW "quoteLines" WITH(SECURITY_INVOKER=true) AS (
  SELECT
    ql.*,
    CASE
      WHEN i."thumbnailPath" IS NULL AND mu."thumbnailPath" IS NOT NULL THEN mu."thumbnailPath"
      WHEN i."thumbnailPath" IS NULL AND imu."thumbnailPath" IS NOT NULL THEN imu."thumbnailPath"
      ELSE i."thumbnailPath"
    END as "thumbnailPath",
    COALESCE(mu.id, imu.id) as "modelId",
    COALESCE(mu."autodeskUrn", imu."autodeskUrn") as "autodeskUrn",
    COALESCE(mu."modelPath", imu."modelPath") as "modelPath",
    COALESCE(mu."name", imu."name") as "modelName",
    COALESCE(mu."size", imu."size") as "modelSize",
    ic."unitCost" as "unitCost"
  FROM "quoteLine" ql
  LEFT JOIN "modelUpload" mu ON ql."modelUploadId" = mu."id"
  INNER JOIN "item" i ON i.id = ql."itemId"
  LEFT JOIN "itemCost" ic ON ic."itemId" = i.id
  LEFT JOIN "modelUpload" imu ON imu.id = i."modelUploadId"
);