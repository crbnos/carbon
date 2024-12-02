UPDATE "customFieldTable" SET "table" = 'supplierPart' WHERE "table" = 'buyMethod';

DROP VIEW IF EXISTS "consumables";
DROP VIEW IF EXISTS "fixtures";
DROP VIEW IF EXISTS "materials";
DROP VIEW IF EXISTS "parts";
DROP VIEW IF EXISTS "purchaseOrderLines";
DROP VIEW IF EXISTS "services";
DROP VIEW IF EXISTS "suppliers";
DROP VIEW IF EXISTS "tools";

ALTER TABLE "buyMethod" RENAME TO "supplierPart";

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
  i."notes",
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
    string_agg(ps."supplierPartId", ',') AS "supplierIds"
  FROM "supplierPart" ps
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
    i."notes",
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
    FROM "supplierPart" s
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
    i."notes",
    t.*,
    s."supplierIds",
    uom.name as "unitOfMeasure"
  FROM "tool" t
  INNER JOIN "item" i ON i.id = t."itemId"
  LEFT JOIN (
    SELECT 
      "itemId",
      string_agg(s."supplierPartId", ',') AS "supplierIds"
    FROM "supplierPart" s
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
    i."notes",
    c.*,
    s."supplierIds",
    uom.name as "unitOfMeasure"
  FROM "consumable" c
  INNER JOIN "item" i ON i.id = c."itemId"
  LEFT JOIN (
    SELECT 
      "itemId",
      string_agg(s."supplierPartId", ',') AS "supplierIds"
    FROM "supplierPart" s
    GROUP BY "itemId"
  )  s ON s."itemId" = c."itemId"
  LEFT JOIN "unitOfMeasure" uom ON uom.code = i."unitOfMeasureCode" AND uom."companyId" = i."companyId";

DROP VIEW IF EXISTS "purchaseOrderLines";
CREATE OR REPLACE VIEW "purchaseOrderLines" WITH(SECURITY_INVOKER=true) AS
  SELECT 
    pol.*,
    po."supplierId" ,
    i.name as "itemName",
    i.description as "itemDescription",
    ps."supplierPartId"
  FROM "purchaseOrderLine" pol
    INNER JOIN "purchaseOrder" po 
      ON po.id = pol."purchaseOrderId"
    -- TODO: this is an unnecessary join, we should remove it after replacing PO line with item instead of part
    LEFT JOIN "item" i
      ON i.id = pol."itemId"
    LEFT JOIN "supplierPart" ps 
      ON i.id = ps."itemId" AND po."supplierId" = ps."supplierId";

DROP VIEW IF EXISTS "suppliers";
CREATE OR REPLACE VIEW "suppliers" WITH(SECURITY_INVOKER=true) AS 
  SELECT 
    s.*,
    st.name AS "type",    
    ss.name AS "status",
    po.count AS "orderCount",
    p.count AS "partCount"
  FROM "supplier" s
  LEFT JOIN "supplierType" st ON st.id = s."supplierTypeId"
  LEFT JOIN "supplierStatus" ss ON ss.id = s."supplierStatusId"
  LEFT JOIN (
    SELECT 
      "supplierId",
      COUNT(*) AS "count"
    FROM "purchaseOrder"
    GROUP BY "supplierId"
  ) po ON po."supplierId" = s.id
  LEFT JOIN (
    SELECT 
      "supplierId",
      COUNT(*) AS "count"
    FROM "supplierPart"
    GROUP BY "supplierId"
  ) p ON p."supplierId" = s.id;