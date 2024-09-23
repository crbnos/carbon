DROP VIEW "fixtures";
CREATE OR REPLACE VIEW "fixtures" WITH(SECURITY_INVOKER=true) AS 
  SELECT
    i.name,
    i.description,
    i."itemTrackingType",
    i."unitOfMeasureCode",
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