DROP VIEW IF EXISTS "receiptLines";
CREATE OR REPLACE VIEW "receiptLines" WITH(SECURITY_INVOKER=true) AS
  SELECT
    rl.*,
    CASE
      WHEN i."thumbnailPath" IS NULL AND mu."thumbnailPath" IS NOT NULL THEN mu."thumbnailPath"
      ELSE i."thumbnailPath"
    END AS "thumbnailPath",
    i."name" as "description"
  FROM "receiptLine" rl
  INNER JOIN "item" i ON i."id" = rl."itemId"
  LEFT JOIN "modelUpload" mu ON mu.id = i."modelUploadId";