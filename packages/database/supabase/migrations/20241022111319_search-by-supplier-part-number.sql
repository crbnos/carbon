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
  COALESCE(i."thumbnailPath", mu."thumbnailPath") as "thumbnailPath",
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
    string_agg(ps."supplierPartId", ',') AS "supplierIds"
  FROM "buyMethod" ps
  GROUP BY "itemId"
)  ps ON ps."itemId" = p."itemId"
LEFT JOIN "modelUpload" mu ON mu.id = i."modelUploadId"
LEFT JOIN "unitOfMeasure" uom ON uom.code = i."unitOfMeasureCode" AND uom."companyId" = i."companyId";

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
  COALESCE(i."thumbnailPath", mu."thumbnailPath") as "thumbnailPath",
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
    string_agg(s."supplierPartId", ',') AS "supplierIds"
  FROM "buyMethod" s
  GROUP BY "itemId"
)  s ON s."itemId" = f."itemId"
LEFT JOIN "modelUpload" mu ON mu.id = i."modelUploadId"
LEFT JOIN "customer" c ON c.id = f."customerId";

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
      string_agg(s."supplierPartId", ',') AS "supplierIds"
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
      string_agg(s."supplierPartId", ',') AS "supplierIds"
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
      string_agg(s."supplierPartId", ',') AS "supplierIds"
    FROM "buyMethod" s
    GROUP BY "itemId"
  )  s ON s."itemId" = c."itemId"
  LEFT JOIN "unitOfMeasure" uom ON uom.code = i."unitOfMeasureCode" AND uom."companyId" = i."companyId";
