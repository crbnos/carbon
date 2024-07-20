ALTER TABLE "modelUpload"
  ADD COLUMN "thumbnailPath" TEXT,
  DROP COLUMN "itemId", 
  DROP COLUMN "salesRfqLineId";

ALTER TABLE "item"
  ADD COLUMN "modelUploadId" TEXT,
  DROP COLUMN "thumbnailPath",
  DROP COLUMN "thumbnailUrl";

ALTER TABLE "salesRfqLine"
  ADD COLUMN "modelUploadId" TEXT;

ALTER TABLE "quoteLine"
  ADD COLUMN "modelUploadId" TEXT;

DROP VIEW "fixtures";
CREATE OR REPLACE VIEW "fixtures" WITH(SECURITY_INVOKER=true) AS 
  SELECT
    i.name,
    i.description,
    i."itemTrackingType",
    i.active,
    i."replenishmentSystem",
    i."defaultMethodType",
    i.assignee,
    f.*,
    mu.id as "modelId",
    mu."autodeskUrn",
    mu."modelPath",
    mu."thumbnailPath",
    mu."name" as "modelName",
    mu."size" as "modelSize",
    s."supplierIds",
    c.name as "customer"
  FROM "fixture" f
  INNER JOIN "item" i ON i.id = f."itemId"
  LEFT JOIN (
    SELECT 
      "itemId",
      array_agg(s."supplierId") AS "supplierIds"
    FROM "buyMethod" s
    GROUP BY "itemId"
  )  s ON s."itemId" = f."itemId"
  LEFT JOIN "modelUpload" mu ON mu.id = i."modelUploadId"
  LEFT JOIN "customer" c ON c.id = f."customerId";

DROP VIEW "parts";
CREATE OR REPLACE VIEW "parts" WITH(SECURITY_INVOKER=true) AS 
  SELECT
    i.name,
    i.description,
    i."itemTrackingType",
    i."unitOfMeasureCode",
    i.active,
    i."replenishmentSystem",
    i."defaultMethodType",
    i.assignee,
    mu.id as "modelId",
    mu."autodeskUrn",
    mu."modelPath",
    mu."thumbnailPath",
    mu."name" as "modelName",
    mu."size" as "modelSize",
    p.*,
    ps."supplierIds",
    uom.name as "unitOfMeasure"
  FROM "part" p
  INNER JOIN "item" i ON i.id = p."itemId"
  LEFT JOIN (
    SELECT 
      "itemId",
      array_agg(ps."supplierId") AS "supplierIds"
    FROM "buyMethod" ps
    GROUP BY "itemId"
  )  ps ON ps."itemId" = p."itemId"
  LEFT JOIN "modelUpload" mu ON mu.id = i."modelUploadId"
  LEFT JOIN "unitOfMeasure" uom ON uom.code = i."unitOfMeasureCode" AND uom."companyId" = i."companyId";


CREATE OR REPLACE VIEW "salesRfqLines" WITH(SECURITY_INVOKER=true) AS
  SELECT
    srl.*,
    mu.id as "modelId",
    mu."autodeskUrn",
    mu."modelPath",
    mu."thumbnailPath",
    mu."name" as "modelName",
    mu."size" as "modelSize",
    i.name as "itemName"
  FROM "salesRfqLine" srl
  LEFT JOIN "item" i ON i.id = srl."itemId"
  LEFT JOIN "modelUpload" mu ON mu.id = srl."modelUploadId";



CREATE OR REPLACE VIEW "quoteLines" WITH(SECURITY_INVOKER=true) AS (
  SELECT
    ql.*,
    qlp."quantity" AS "pricingQuantity",
    qlp."unitCost" AS "pricingUnitCost",
    qlp."leadTime" AS "pricingLeadTime",
    qlp."discountPercent" AS "pricingDiscountPercent",
    qlp."markupPercent" AS "pricingMarkupPercent",
    qlp."extendedPrice" AS "pricingExtendedPrice",
    COALESCE(mu.id, imu.id) as "modelId",
    COALESCE(mu."autodeskUrn", imu."autodeskUrn") as "autodeskUrn",
    COALESCE(mu."modelPath", imu."modelPath") as "modelPath",
    COALESCE(mu."thumbnailPath", imu."thumbnailPath") as "thumbnailPath",
    COALESCE(mu."name", imu."name") as "modelName",
    COALESCE(mu."size", imu."size") as "modelSize"
  FROM "quoteLine" ql
  LEFT JOIN "quoteLinePrice" qlp ON ql."id" = qlp."quoteLineId"
  LEFT JOIN "modelUpload" mu ON ql."modelUploadId" = mu."id"
  INNER JOIN "item" i ON i.id = ql."itemId"
  LEFT JOIN "modelUpload" imu ON imu.id = i."modelUploadId"
);