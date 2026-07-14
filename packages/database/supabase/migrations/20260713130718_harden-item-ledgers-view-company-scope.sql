-- Defense-in-depth: scope the tenant-owned joins in the itemLedgers view by
-- companyId so reused/colliding ids can never attach another tenant's metadata.
-- `item` was already scoped; add the same to location, storageUnit, and
-- trackedEntity. (`modelUpload` is reached through `item.modelUploadId`, i.e.
-- already company-scoped via the item join, so it stays as-is.)
-- Column list/order is unchanged, so CREATE OR REPLACE is valid here.
CREATE OR REPLACE VIEW "itemLedgers" WITH (security_invoker = true) AS
SELECT
  il.*,
  (il."correctionOfItemLedgerId" IS NOT NULL) AS "isCorrection",
  i."readableIdWithRevision" AS "itemReadableId",
  i."name"                   AS "itemDescription",
  i."type"                   AS "itemType",
  l."name"                   AS "locationName",
  su."name"                  AS "storageUnitName",
  te."readableId"            AS "trackedEntityReadableId",
  CASE
    WHEN i."thumbnailPath" IS NULL AND mu."thumbnailPath" IS NOT NULL
      THEN mu."thumbnailPath"
    ELSE i."thumbnailPath"
  END                        AS "thumbnailPath"
FROM "itemLedger" il
INNER JOIN "item" i ON i."id" = il."itemId" AND i."companyId" = il."companyId"
LEFT JOIN "modelUpload" mu ON mu."id" = i."modelUploadId"
LEFT JOIN "location" l ON l."id" = il."locationId" AND l."companyId" = il."companyId"
LEFT JOIN "storageUnit" su ON su."id" = il."storageUnitId" AND su."companyId" = il."companyId"
LEFT JOIN "trackedEntity" te ON te."id" = il."trackedEntityId" AND te."companyId" = il."companyId";
