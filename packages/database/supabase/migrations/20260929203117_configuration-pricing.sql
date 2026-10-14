-- Configuration pricing.
--
-- pricingRule.configurationPrices: per-parameter surcharges for a rule that
-- targets one configurable item. Each entry is { key, value, amount } where
-- `key` is the configurationParameter key, `value` is the list option / "true"
-- for a boolean (null for a numeric parameter, which is priced per unit), and
-- `amount` is a signed per-unit surcharge added to the base price before the
-- rule discounts and markups apply.
--
-- salesOrderLine.configuration: the configurator values chosen on a sales
-- order line, keyed by configurationParameter key (same shape as
-- quoteLine.configuration). Used to price the line and to configure the job
-- made for it.

ALTER TABLE "pricingRule" ADD COLUMN IF NOT EXISTS "configurationPrices" JSONB;
ALTER TABLE "salesOrderLine" ADD COLUMN IF NOT EXISTS "configuration" JSONB;

-- salesOrderLines selects sl.*, which Postgres expands at creation time, so it
-- is recreated (verbatim from 20260811123619) to expose the new column.
DROP VIEW IF EXISTS "salesOrderLines";
CREATE VIEW "salesOrderLines" WITH(SECURITY_INVOKER=true) AS (
  SELECT
    sl.*,
    i."readableIdWithRevision" as "itemReadableId",
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
    ic."unitCost" as "unitCost",
    cp."customerPartId",
    cp."customerPartRevision",
    so."orderDate",
    so."customerId",
    so."salesOrderId" as "salesOrderReadableId",
    fa."fixedAssetId" as "assetReadableId",
    fa."name" as "assetName"
  FROM "salesOrderLine" sl
  INNER JOIN "salesOrder" so ON so.id = sl."salesOrderId"
  LEFT JOIN "modelUpload" mu ON sl."modelUploadId" = mu."id"
  LEFT JOIN "item" i ON i.id = sl."itemId"
  LEFT JOIN "itemCost" ic ON ic."itemId" = i.id
  LEFT JOIN "modelUpload" imu ON imu.id = i."modelUploadId"
  LEFT JOIN "customerPartToItem" cp ON cp."customerId" = so."customerId" AND cp."itemId" = i.id
  LEFT JOIN "fixedAsset" fa ON fa.id = sl."assetId"
);
