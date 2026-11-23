-- "purchaseOrderLines" opened with SELECT DISTINCT ON (pl.id). Postgres pushes a
-- filter into a DISTINCT ON subquery only when it is on the DISTINCT ON column,
-- so a read by "purchaseOrderId" (every purchase order page) joined and sorted
-- every purchase order line of every company before keeping one order's lines:
-- 167 ms for 69 rows out of 10,144 in production.
--
-- The DISTINCT ON only guarded the joins that could repeat a line. "supplierPart"
-- is unique on ("itemId", "supplierId", "companyId"), so it also matches the
-- order's company; "itemCost" has no unique key
-- on "itemId", so it is read through LIMIT 1, newest first. Same columns in the same order, so
-- CREATE OR REPLACE keeps every dependent object.
CREATE OR REPLACE VIEW "purchaseOrderLines" WITH(SECURITY_INVOKER=true) AS (
  SELECT
    pl.*,
    sp."supplierPartId" as "supplierPartIdFromSupplier",
    CASE
      WHEN i."thumbnailPath" IS NULL AND mu."thumbnailPath" IS NOT NULL THEN mu."thumbnailPath"
      WHEN i."thumbnailPath" IS NULL AND imu."thumbnailPath" IS NOT NULL THEN imu."thumbnailPath"
      ELSE i."thumbnailPath"
    END as "thumbnailPath",
    i.name as "itemName",
    i."readableIdWithRevision" as "itemReadableId",
    i.description as "itemDescription",
    COALESCE(mu.id, imu.id) as "modelId",
    COALESCE(mu."autodeskUrn", imu."autodeskUrn") as "autodeskUrn",
    COALESCE(mu."modelPath", imu."modelPath") as "modelPath",
    COALESCE(mu."name", imu."name") as "modelName",
    COALESCE(mu."size", imu."size") as "modelSize",
    ic."unitCost" as "unitCost",
    jo."description" as "jobOperationDescription",
    a."name" as "accountName",
    fa."fixedAssetId" as "assetReadableId",
    fa."name" as "assetName"
  FROM "purchaseOrderLine" pl
  INNER JOIN "purchaseOrder" so ON so.id = pl."purchaseOrderId"
  LEFT JOIN "modelUpload" mu ON pl."modelUploadId" = mu."id"
  LEFT JOIN "item" i ON i.id = pl."itemId"
  LEFT JOIN LATERAL (
    SELECT c."unitCost" FROM "itemCost" c WHERE c."itemId" = i.id
    ORDER BY c."updatedAt" DESC NULLS LAST, c."createdAt" DESC
    LIMIT 1
  ) ic ON true
  LEFT JOIN "modelUpload" imu ON imu.id = i."modelUploadId"
  LEFT JOIN "jobOperation" jo ON jo."id" = pl."jobOperationId"
  LEFT JOIN "account" a ON a.id = pl."accountId"
  LEFT JOIN "fixedAsset" fa ON fa.id = pl."assetId"
  LEFT JOIN "supplierPart" sp
    ON sp."supplierId" = so."supplierId" AND sp."itemId" = i.id AND sp."companyId" = so."companyId"
);
