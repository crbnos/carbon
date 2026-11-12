-- Sales order delivery date check (spec .ai/specs/2026-11-10-sales-order-delivery-date-check.md).

DO $$ BEGIN
  CREATE TYPE "deliveryDateControl" AS ENUM ('None', 'Lead Time', 'Stock', 'Capacity');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "deliveryDateConstraint" AS ENUM ('Lead Time', 'Stock', 'Capacity');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "deliveryDateStatus" AS ENUM ('Met', 'Missed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- The company's check level. 'None' keeps every existing company unchanged.
ALTER TABLE "companySettings"
  ADD COLUMN IF NOT EXISTS "deliveryDateControl" "deliveryDateControl" NOT NULL DEFAULT 'None';

-- An item's level at one location. NULL uses the company's level.
ALTER TABLE "itemPlanning"
  ADD COLUMN IF NOT EXISTS "deliveryDateControl" "deliveryDateControl";

-- The customer's wish, the last check's result, and who kept a date that
-- failed it. A NULL status means the line was not checked.
ALTER TABLE "salesOrderLine"
  ADD COLUMN IF NOT EXISTS "requestedDate" DATE,
  ADD COLUMN IF NOT EXISTS "deliveryDateStatus" "deliveryDateStatus",
  ADD COLUMN IF NOT EXISTS "deliveryDateConstraint" "deliveryDateConstraint",
  ADD COLUMN IF NOT EXISTS "earliestDeliveryDate" DATE,
  ADD COLUMN IF NOT EXISTS "deliveryDateCheckedAt" TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS "deliveryDateOverriddenBy" TEXT REFERENCES "user"("id"),
  ADD COLUMN IF NOT EXISTS "deliveryDateOverriddenAt" TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS "deliveryDateOverrideReason" TEXT;

CREATE INDEX IF NOT EXISTS "salesOrderLine_deliveryDateOverriddenBy_idx"
  ON "salesOrderLine" ("deliveryDateOverriddenBy");

-- salesOrderLines selects sl.* before aliased columns, so the new columns need a
-- DROP + CREATE (never CREATE OR REPLACE). Body copied verbatim from
-- 20261006220201_revenue-recognition-core.sql.
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
