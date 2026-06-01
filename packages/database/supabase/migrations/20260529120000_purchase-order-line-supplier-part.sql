-- Make the purchase order line's supplier part number a real, line-level value.
--
-- Previously the `purchaseOrderLines` view derived `supplierPartId` by joining the
-- `supplierPart` master on (purchaseOrder.supplierId, item.id). That made the value
-- read-only, un-clearable, and impossible to override per line. We now store it on
-- the line itself, backfill from the old derivation so existing PDFs don't regress,
-- and rebuild the view to read the stored column instead of the join.

----------------------------------------------------------------------------
-- 1. Add the column
----------------------------------------------------------------------------
ALTER TABLE "purchaseOrderLine" ADD COLUMN "supplierPartId" TEXT;

----------------------------------------------------------------------------
-- 2. Backfill from the previously-derived supplier part (supplier + item)
----------------------------------------------------------------------------
UPDATE "purchaseOrderLine" pol
SET "supplierPartId" = sp."supplierPartId"
FROM "purchaseOrder" po
JOIN "supplierPart" sp
  ON sp."supplierId" = po."supplierId"
WHERE pol."purchaseOrderId" = po."id"
  AND pol."itemId" IS NOT NULL
  AND sp."itemId" = pol."itemId";

----------------------------------------------------------------------------
-- 3. Rebuild the view to expose BOTH the stored and the derived value.
--    `pl.*` now emits `supplierPartId` (the line-level stored value). The
--    catalog-derived value is kept under a distinct alias
--    `supplierPartIdFromSupplier` (so there is no duplicate column). Readers
--    pick the line value first, then fall back to the supplier-derived value.
----------------------------------------------------------------------------
DROP VIEW IF EXISTS "purchaseOrderLines";
CREATE OR REPLACE VIEW "purchaseOrderLines" WITH(SECURITY_INVOKER=true) AS (
  SELECT DISTINCT ON (pl.id)
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
  LEFT JOIN "itemCost" ic ON ic."itemId" = i.id
  LEFT JOIN "modelUpload" imu ON imu.id = i."modelUploadId"
  LEFT JOIN "jobOperation" jo ON jo."id" = pl."jobOperationId"
  LEFT JOIN "account" a ON a.id = pl."accountId"
  LEFT JOIN "fixedAsset" fa ON fa.id = pl."assetId"
  LEFT JOIN "supplierPart" sp ON sp."supplierId" = so."supplierId" AND sp."itemId" = i.id
);
