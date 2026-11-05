-- Lets main's 20261104063431_purchase-order-lines-filter-pushdown apply on a
-- database that already has the projects branch, in either order.
--
-- That migration re-creates "purchaseOrderLines" with CREATE OR REPLACE and
-- `pl.*`. The projects branch added columns to "purchaseOrderLine" that the view
-- does not list yet, so `pl.*` shifts every later column and Postgres refuses to
-- rename one. Rebuilding the view here, with the same definition, gives it those
-- columns: main's CREATE OR REPLACE then changes nothing. Where main's migration
-- ran first, this one runs later and leaves the same view.

DROP VIEW IF EXISTS "purchaseOrderLines";
CREATE VIEW "purchaseOrderLines" WITH(SECURITY_INVOKER=true) AS (
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
