
-- Update fixtures view
DROP VIEW IF EXISTS "fixtures";
CREATE OR REPLACE VIEW "fixtures" WITH (SECURITY_INVOKER=true) AS 
SELECT
  i."active",
  i."assignee",
  i."defaultMethodType",
  i."description",
  i."itemTrackingType",
  i."name",
  i."replenishmentSystem",
  i."unitOfMeasureCode",
  CASE
    WHEN i."thumbnailPath" IS NULL AND mu."thumbnailPath" IS NOT NULL THEN mu."thumbnailPath"
    ELSE i."thumbnailPath"
  END as "thumbnailPath",
  f.*,
  mu.id as "modelId",
  mu."autodeskUrn",
  mu."modelPath",
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

-- Update parts view
DROP VIEW IF EXISTS "parts";
CREATE OR REPLACE VIEW "parts" WITH (SECURITY_INVOKER=true) AS 
SELECT
  i."active",
  i."assignee",
  i."defaultMethodType",
  i."description",
  i."itemTrackingType",
  i."name",
  i."replenishmentSystem",
  i."unitOfMeasureCode",
  CASE
    WHEN i."thumbnailPath" IS NULL AND mu."thumbnailPath" IS NOT NULL THEN mu."thumbnailPath"
    ELSE i."thumbnailPath"
  END as "thumbnailPath",
  mu.id as "modelId",
  mu."autodeskUrn",
  mu."modelPath",
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

DROP VIEW IF EXISTS "materials";
CREATE OR REPLACE VIEW "materials" WITH(SECURITY_INVOKER=true) AS 
  SELECT
    i."active",
    i."assignee",
    i."defaultMethodType",
    i."description",
    i."itemTrackingType",
    i."name",
    i."replenishmentSystem",
    i."thumbnailPath",
    i."unitOfMeasureCode",
    m.*,
    mf."name" AS "materialForm",
    ms."name" AS "materialSubstance",
    s."supplierIds",
    uom.name as "unitOfMeasure"
  FROM "material" m
  INNER JOIN "item" i ON i.id = m."itemId"
  LEFT JOIN (
    SELECT 
      "itemId",
      array_agg(s."supplierId") AS "supplierIds"
    FROM "buyMethod" s
    GROUP BY "itemId"
  )  s ON s."itemId" = m."itemId"
  LEFT JOIN "materialForm" mf ON mf.id = m."materialFormId"
  LEFT JOIN "materialSubstance" ms ON ms.id = m."materialSubstanceId"
  LEFT JOIN "unitOfMeasure" uom ON uom.code = i."unitOfMeasureCode" AND uom."companyId" = i."companyId";


DROP VIEW IF EXISTS "tools";
CREATE OR REPLACE VIEW "tools" WITH(SECURITY_INVOKER=true) AS 
  SELECT
    i."active",
    i."assignee",
    i."defaultMethodType",
    i."description",
    i."itemTrackingType",
    i."name",
    i."replenishmentSystem",
    i."thumbnailPath",
    i."unitOfMeasureCode",
    t.*,
    s."supplierIds",
    uom.name as "unitOfMeasure"
  FROM "tool" t
  INNER JOIN "item" i ON i.id = t."itemId"
  LEFT JOIN (
    SELECT 
      "itemId",
      array_agg(s."supplierId") AS "supplierIds"
    FROM "buyMethod" s
    GROUP BY "itemId"
  )  s ON s."itemId" = t."itemId"
  LEFT JOIN "unitOfMeasure" uom ON uom.code = i."unitOfMeasureCode" AND uom."companyId" = i."companyId";

DROP VIEW IF EXISTS "consumables";
CREATE OR REPLACE VIEW "consumables" WITH(SECURITY_INVOKER=true) AS 
  SELECT
    i."active",
    i."assignee",
    i."defaultMethodType",
    i."description",
    i."itemTrackingType",
    i."name",
    i."replenishmentSystem",
    i."thumbnailPath",
    i."unitOfMeasureCode",
    c.*,
    s."supplierIds",
    uom.name as "unitOfMeasure"
  FROM "consumable" c
  INNER JOIN "item" i ON i.id = c."itemId"
  LEFT JOIN (
    SELECT 
      "itemId",
      array_agg(s."supplierId") AS "supplierIds"
    FROM "buyMethod" s
    GROUP BY "itemId"
  )  s ON s."itemId" = c."itemId"
  LEFT JOIN "unitOfMeasure" uom ON uom.code = i."unitOfMeasureCode" AND uom."companyId" = i."companyId";


-- Update salesRfqLines view
DROP VIEW IF EXISTS "salesRfqLines";
CREATE OR REPLACE VIEW "salesRfqLines" WITH(SECURITY_INVOKER=true) AS
  SELECT
    srl.*,
    mu.id as "modelId",
    mu."autodeskUrn",
    mu."modelPath",
    mu."name" as "modelName",
    mu."size" as "modelSize",
    CASE
      WHEN i."thumbnailPath" IS NULL AND mu."thumbnailPath" IS NOT NULL THEN mu."thumbnailPath"
      ELSE i."thumbnailPath"
    END as "thumbnailPath",
    i."name" as "itemName",
    i."defaultMethodType" AS "methodType",
    i."readableId" AS "itemReadableId",
    i."type" AS "itemType"
  FROM "salesRfqLine" srl
  LEFT JOIN "item" i ON i.id = srl."itemId"
  LEFT JOIN "modelUpload" mu ON mu.id = srl."modelUploadId";

-- Update quoteLines view
DROP VIEW IF EXISTS "quoteLines";
CREATE OR REPLACE VIEW "quoteLines" WITH(SECURITY_INVOKER=true) AS (
  SELECT
    ql.*,
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
    ic."unitCost" as "unitCost"
  FROM "quoteLine" ql
  LEFT JOIN "modelUpload" mu ON ql."modelUploadId" = mu."id"
  INNER JOIN "item" i ON i.id = ql."itemId"
  LEFT JOIN "itemCost" ic ON ic."itemId" = i.id
  LEFT JOIN "modelUpload" imu ON imu.id = i."modelUploadId"
);

DROP VIEW IF EXISTS "salesOrderLines";
CREATE OR REPLACE VIEW "salesOrderLines" WITH(SECURITY_INVOKER=true) AS (
  SELECT
    sl.*,
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
    cp."customerPartRevision"
  FROM "salesOrderLine" sl
  INNER JOIN "salesOrder" so ON so.id = sl."salesOrderId"
  LEFT JOIN "modelUpload" mu ON sl."modelUploadId" = mu."id"
  INNER JOIN "item" i ON i.id = sl."itemId"
  LEFT JOIN "itemCost" ic ON ic."itemId" = i.id
  LEFT JOIN "modelUpload" imu ON imu.id = i."modelUploadId"
  LEFT JOIN "customerPartToItem" cp ON cp."customerId" = so."customerId" AND cp."itemId" = i.id
);

CREATE OR REPLACE FUNCTION get_item_quantities(location_id TEXT)
RETURNS TABLE (
  "itemId" TEXT,
  "companyId" TEXT,
  "locationId" TEXT,
  "quantityOnHand" NUMERIC,
  "quantityOnPurchaseOrder" NUMERIC,
  "quantityOnSalesOrder" NUMERIC,
  "quantityOnProdOrder" NUMERIC,
  "quantityAvailable" NUMERIC,
  "materialSubstanceId" TEXT,
  "materialFormId" TEXT,
  "grade" TEXT,
  "dimensions" TEXT,
  "finish" TEXT,
  "readableId" TEXT,
  "type" "itemType",
  "name" TEXT,
  "active" BOOLEAN,
  "itemTrackingType" "itemTrackingType",
  "thumbnailPath" TEXT,
  "locationName" TEXT,
  "unitOfMeasureCode" TEXT
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    i."id" AS "itemId",
    i."companyId",
    loc."id" AS "locationId",
    SUM(COALESCE(inv."quantityOnHand", 0)) AS "quantityOnHand",
    SUM(COALESCE(inv."quantityOnPurchase", 0)) AS "quantityOnPurchaseOrder",
    SUM(COALESCE(inv."quantityOnSalesOrder", 0)) AS "quantityOnSalesOrder",
    SUM(COALESCE(inv."quantityOnProductionOrder", 0)) AS "quantityOnProdOrder",
    SUM(COALESCE(inv."quantityOnHand", 0)) - 
      SUM(COALESCE(inv."quantityOnSalesOrder", 0)) - 
      SUM(COALESCE(inv."quantityOnProductionOrder", 0)) AS "quantityAvailable",
    mat."materialSubstanceId",
    mat."materialFormId",
    mat."grade",
    mat."dimensions",
    mat."finish",
    i."readableId",
    i."type",
    i."name",
    i."active",
    i."itemTrackingType",
    CASE
      WHEN i."thumbnailPath" IS NULL AND mu."thumbnailPath" IS NOT NULL THEN mu."thumbnailPath"
      ELSE i."thumbnailPath"
    END AS "thumbnailPath",
    loc."name" AS "locationName",
    i."unitOfMeasureCode"
  FROM "item" i
  CROSS JOIN (SELECT * FROM "location" WHERE "id" = location_id) loc
  LEFT JOIN "itemInventory" inv ON i."id" = inv."itemId" AND loc."id" = inv."locationId"
  LEFT JOIN "material" mat ON i."id" = mat."itemId"
  LEFT JOIN "modelUpload" mu ON mu.id = i."modelUploadId"
  WHERE i."itemTrackingType" = 'Inventory'
    AND i."companyId" = loc."companyId"
  GROUP BY 
    i."id",
    i."companyId",
    loc."id",
    mat."materialSubstanceId",
    mat."materialFormId",
    mat."grade",
    mat."dimensions",
    mat."finish",
    i."readableId",
    i."type",
    i."name",
    i."active",
    i."itemTrackingType",
    i."thumbnailPath",
    mu."thumbnailPath",
    loc."name",
    i."unitOfMeasureCode";
END;
$$ LANGUAGE plpgsql SECURITY INVOKER;

DROP VIEW IF EXISTS "jobs";
CREATE OR REPLACE VIEW "jobs" WITH(SECURITY_INVOKER=true) AS
WITH job_model AS (
  SELECT
    j.id AS job_id,
    COALESCE(j."modelUploadId", i."modelUploadId") AS model_upload_id
  FROM "job" j
  INNER JOIN "item" i ON j."itemId" = i."id"
)
SELECT
  j.*,
  i.name,
  i."readableId" as "itemReadableId",
  i.type as "itemType",
  i.name as "description",
  i."itemTrackingType",
  i.active,
  i."replenishmentSystem",
  mu.id as "modelId",
  mu."autodeskUrn",
  mu."modelPath",
  CASE
    WHEN i."thumbnailPath" IS NULL AND mu."thumbnailPath" IS NOT NULL THEN mu."thumbnailPath"
    ELSE i."thumbnailPath"
  END as "thumbnailPath",
  mu."name" as "modelName",
  mu."size" as "modelSize",
  so."salesOrderId" as "salesOrderReadableId",
  qo."quoteId" as "quoteReadableId"
FROM "job" j
INNER JOIN "item" i ON j."itemId" = i."id"
LEFT JOIN job_model jm ON j.id = jm.job_id
LEFT JOIN "modelUpload" mu ON mu.id = jm.model_upload_id
LEFT JOIN "salesOrder" so on j."salesOrderId" = so.id
LEFT JOIN "quote" qo ON j."quoteId" = qo.id;
