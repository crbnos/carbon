ALTER TABLE "customField" ADD COLUMN "tags" TEXT[] DEFAULT ARRAY[]::TEXT[];

CREATE OR REPLACE VIEW "customFieldTables" WITH(SECURITY_INVOKER=true) AS
SELECT 
  cft.*, 
  c.id AS "companyId",
  COALESCE(cf.fields, '[]') as fields
FROM "customFieldTable" cft 
  CROSS JOIN "company" c 
  LEFT JOIN (
    SELECT 
      cf."table",
      cf."companyId",
      COALESCE(json_agg(
        json_build_object(
          'id', id, 
          'name', name,
          'sortOrder', "sortOrder",
          'dataTypeId', "dataTypeId",
          'listOptions', "listOptions",
          'active', active,
          'tags', tags
        )
      ), '[]') AS fields 
    FROM "customField" cf
    GROUP BY cf."table", cf."companyId"
  ) cf
    ON cf.table = cft.table AND cf."companyId" = c.id;


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
