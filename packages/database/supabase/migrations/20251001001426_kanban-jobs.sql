ALTER TABLE "kanban" ADD COLUMN "autoStartJob" BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE "kanban" ADD COLUMN "completedBarcodeOverride" TEXT;
ALTER TABLE "kanban" ADD COLUMN "jobId" TEXT;
ALTER TABLE "kanban" ADD CONSTRAINT "kanban_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "job"("id") ON DELETE SET NULL ON UPDATE CASCADE;

DROP VIEW IF EXISTS "kanbans";
CREATE VIEW "kanbans" WITH(SECURITY_INVOKER=true) AS
SELECT
  k.*,
  i.name,
  i."readableIdWithRevision",
  j."jobId" as "jobReadableId",
  l.name as "locationName",
  s.name as "shelfName",
  su.name as "supplierName",
  CASE
    WHEN i."thumbnailPath" IS NULL AND mu."thumbnailPath" IS NOT NULL THEN mu."thumbnailPath"
    ELSE i."thumbnailPath"
  END AS "thumbnailPath"
FROM "kanban" k
JOIN "item" i ON k."itemId" = i."id"
LEFT JOIN "modelUpload" mu ON mu.id = i."modelUploadId"
JOIN "location" l ON k."locationId" = l."id"
LEFT JOIN "shelf" s ON k."shelfId" = s."id"
LEFT JOIN "supplier" su ON k."supplierId" = su."id"
LEFT JOIN "job" j ON k."jobId" = j."id";