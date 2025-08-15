
DROP VIEW IF EXISTS "parts";
CREATE OR REPLACE VIEW "parts" WITH (SECURITY_INVOKER=true) AS 
WITH latest_items AS (
  SELECT DISTINCT ON (i."readableId", i."companyId") 
    i.*,
    mu.id as "modelUploadId",
    
    mu."modelPath",
    mu."thumbnailPath" as "modelThumbnailPath",
    mu."name" as "modelName",
    mu."size" as "modelSize"
  FROM "item" i
  LEFT JOIN "modelUpload" mu ON mu.id = i."modelUploadId"
  ORDER BY i."readableId", i."companyId", i."createdAt" DESC NULLS LAST
),
item_revisions AS (
  SELECT 
    i."readableId",
    i."companyId",
    json_agg(
      json_build_object(
        'id', i.id,
        'revision', i."revision",
        'name', i."name",
        'description', i."description",
        'active', i."active",
        'createdAt', i."createdAt"
      ) ORDER BY i."createdAt"
      ) as "revisions"
  FROM "item" i
  GROUP BY i."readableId", i."companyId"
)
SELECT
  li."active",
  li."assignee",
  li."defaultMethodType",
  li."description",
  li."itemTrackingType",
  li."name",
  li."replenishmentSystem",
  li."unitOfMeasureCode",
  li."notes",
  li."revision",
  li."readableId",
  li."readableIdWithRevision",
  li."id",
  li."companyId",
  CASE
    WHEN li."thumbnailPath" IS NULL AND li."modelThumbnailPath" IS NOT NULL THEN li."modelThumbnailPath"
    ELSE li."thumbnailPath"
  END as "thumbnailPath",
  
  li."modelPath",
  li."modelName",
  li."modelSize",
  ps."supplierIds",
  uom.name as "unitOfMeasure",
  ir."revisions",
  p."customFields",
  p."tags",
  ic."itemPostingGroupId",
  li."createdBy",
  li."createdAt",
  li."updatedBy",
  li."updatedAt"
FROM "part" p
INNER JOIN latest_items li ON li."readableId" = p."id" AND li."companyId" = p."companyId"
LEFT JOIN item_revisions ir ON ir."readableId" = p."id" AND ir."companyId" = p."companyId"
LEFT JOIN (
  SELECT 
    "itemId",
    "companyId",
    string_agg(ps."supplierPartId", ',') AS "supplierIds"
  FROM "supplierPart" ps
  GROUP BY "itemId", "companyId"
) ps ON ps."itemId" = li."id" AND ps."companyId" = li."companyId"
LEFT JOIN "unitOfMeasure" uom ON uom.code = li."unitOfMeasureCode" AND uom."companyId" = li."companyId"
LEFT JOIN "itemCost" ic ON ic."itemId" = li."id";

DROP VIEW IF EXISTS "materials";
CREATE OR REPLACE VIEW "materials" WITH (SECURITY_INVOKER=true) AS 
WITH latest_items AS (
  SELECT DISTINCT ON (i."readableId", i."companyId") 
    i.*,
    
    mu."modelPath",
    mu."thumbnailPath" as "modelThumbnailPath",
    mu."name" as "modelName",
    mu."size" as "modelSize"
  FROM "item" i
  LEFT JOIN "modelUpload" mu ON mu.id = i."modelUploadId"
  ORDER BY i."readableId", i."companyId", i."createdAt" DESC NULLS LAST
),
item_revisions AS (
  SELECT 
    i."readableId",
    i."companyId",
    json_agg(
      json_build_object(
        'id', i.id,
        'revision', i."revision",
        'methodType', i."defaultMethodType",
        'type', i."type"
      ) ORDER BY i."createdAt"
      ) as "revisions"
  FROM "item" i
  GROUP BY i."readableId", i."companyId"
)
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
  i."revision",
  i."readableId",
  i."readableIdWithRevision",
  i."id",
  i."companyId",
  CASE
    WHEN i."thumbnailPath" IS NULL AND i."modelThumbnailPath" IS NOT NULL THEN i."modelThumbnailPath"
    ELSE i."thumbnailPath"
  END as "thumbnailPath",
  i."modelUploadId",
  
  i."modelPath",
  i."modelName",
  i."modelSize",
  ps."supplierIds",
  uom.name as "unitOfMeasure",
  ir."revisions",
  mf."name" AS "materialForm",
  ms."name" AS "materialSubstance",
  md."name" AS "dimensions",
  mfin."name" AS "finish",
  mg."name" AS "grade",
  mt."name" AS "materialType",
  m."materialSubstanceId",
  m."materialFormId",
  m."customFields",
  m."tags",
  ic."itemPostingGroupId",
  i."createdBy",
  i."createdAt",
  i."updatedBy",
  i."updatedAt"
FROM "material" m
  INNER JOIN latest_items i ON i."readableId" = m."id" AND i."companyId" = m."companyId"
  LEFT JOIN item_revisions ir ON ir."readableId" = m."id" AND ir."companyId" = i."companyId"
  LEFT JOIN (
    SELECT 
      ps."itemId",
      ps."companyId",
      string_agg(ps."supplierPartId", ',') AS "supplierIds"
    FROM "supplierPart" ps
    GROUP BY ps."itemId", ps."companyId"
  ) ps ON ps."itemId" = i."id" AND ps."companyId" = i."companyId"
  LEFT JOIN "modelUpload" mu ON mu.id = i."modelUploadId"
  LEFT JOIN "unitOfMeasure" uom ON uom.code = i."unitOfMeasureCode" AND uom."companyId" = i."companyId"
  LEFT JOIN "materialForm" mf ON mf."id" = m."materialFormId"
  LEFT JOIN "materialSubstance" ms ON ms."id" = m."materialSubstanceId"
  LEFT JOIN "materialDimension" md ON m."dimensionId" = md."id"
  LEFT JOIN "materialFinish" mfin ON m."finishId" = mfin."id"
  LEFT JOIN "materialGrade" mg ON m."gradeId" = mg."id"
  LEFT JOIN "materialType" mt ON m."materialTypeId" = mt."id"
  LEFT JOIN "itemCost" ic ON ic."itemId" = i."id";

DROP VIEW IF EXISTS "consumables";
CREATE OR REPLACE VIEW "consumables" WITH (SECURITY_INVOKER=true) AS 
WITH latest_items AS (
  SELECT DISTINCT ON (i."readableId", i."companyId") 
    i.*,
    mu."modelPath",
    mu."thumbnailPath" as "modelThumbnailPath",
    mu."name" as "modelName",
    mu."size" as "modelSize"
  FROM "item" i
  LEFT JOIN "modelUpload" mu ON mu.id = i."modelUploadId"
  ORDER BY i."readableId", i."companyId", i."createdAt" DESC NULLS LAST
),
item_revisions AS (
  SELECT 
    i."readableId",
    i."companyId",
    json_agg(
      json_build_object(
        'id', i.id,
        'revision', i."revision",
        'methodType', i."defaultMethodType",
        'type', i."type"
      ) ORDER BY i."createdAt"
      ) as "revisions"
  FROM "item" i
  GROUP BY i."readableId", i."companyId"
)
SELECT
  li."active",
  li."assignee",
  li."defaultMethodType",
  li."description",
  li."itemTrackingType",
  li."name",
  li."replenishmentSystem",
  li."unitOfMeasureCode",
  li."notes",
  li."revision",
  li."readableId",
  li."readableIdWithRevision",
  li."id",
  li."companyId",
  CASE
    WHEN li."thumbnailPath" IS NULL AND li."modelThumbnailPath" IS NOT NULL THEN li."modelThumbnailPath"
    ELSE li."thumbnailPath"
  END as "thumbnailPath",
  li."modelUploadId",
  li."modelPath",
  li."modelName",
  li."modelSize",
  ps."supplierIds",
  uom.name as "unitOfMeasure",
  ir."revisions",
  c."customFields",
  c."tags",
  ic."itemPostingGroupId",
  li."createdBy",
  li."createdAt",
  li."updatedBy",
  li."updatedAt"
FROM "consumable" c
  INNER JOIN latest_items li ON li."readableId" = c."id" AND li."companyId" = c."companyId"
LEFT JOIN item_revisions ir ON ir."readableId" = c."id" AND ir."companyId" = li."companyId"
LEFT JOIN (
  SELECT 
    "itemId",
    "companyId",
    string_agg(ps."supplierPartId", ',') AS "supplierIds"
  FROM "supplierPart" ps
  GROUP BY "itemId", "companyId"
) ps ON ps."itemId" = li."id" AND ps."companyId" = li."companyId"
LEFT JOIN "unitOfMeasure" uom ON uom.code = li."unitOfMeasureCode" AND uom."companyId" = li."companyId"
LEFT JOIN "itemCost" ic ON ic."itemId" = li."id";

DROP VIEW IF EXISTS "tools";
CREATE OR REPLACE VIEW "tools" WITH (SECURITY_INVOKER=true) AS 
WITH latest_items AS (
  SELECT DISTINCT ON (i."readableId", i."companyId") 
    i.*,
    mu.id as "modelUploadId",
    
    mu."modelPath",
    mu."thumbnailPath" as "modelThumbnailPath",
    mu."name" as "modelName",
    mu."size" as "modelSize"
  FROM "item" i
  LEFT JOIN "modelUpload" mu ON mu.id = i."modelUploadId"
  ORDER BY i."readableId", i."companyId", i."createdAt" DESC NULLS LAST
),
item_revisions AS (
  SELECT 
    i."readableId",
    i."companyId",
    json_agg(
      json_build_object(
        'id', i.id,
        'revision', i."revision",
        'methodType', i."defaultMethodType",
        'type', i."type"
      ) ORDER BY i."createdAt"
      ) as "revisions"
  FROM "item" i
  GROUP BY i."readableId", i."companyId"
)
SELECT
  li."active",
  li."assignee",
  li."defaultMethodType",
  li."description",
  li."itemTrackingType",
  li."name",
  li."replenishmentSystem",
  li."unitOfMeasureCode",
  li."notes",
  li."revision",
  li."readableId",
  li."readableIdWithRevision",
  li."id",
  li."companyId",
  CASE
    WHEN li."thumbnailPath" IS NULL AND li."modelThumbnailPath" IS NOT NULL THEN li."modelThumbnailPath"
    ELSE li."thumbnailPath"
  END as "thumbnailPath",
  
  li."modelPath",
  li."modelName",
  li."modelSize",
  ps."supplierIds",
  uom.name as "unitOfMeasure",
  ir."revisions",
  t."customFields",
  t."tags",
  ic."itemPostingGroupId",
  li."createdBy",
  li."createdAt",
  li."updatedBy",
  li."updatedAt"
FROM "tool" t
  INNER JOIN latest_items li ON li."readableId" = t."id" AND li."companyId" = t."companyId"
LEFT JOIN item_revisions ir ON ir."readableId" = t."id" AND ir."companyId" = li."companyId"
LEFT JOIN (
  SELECT 
    "itemId",
    "companyId",
    string_agg(ps."supplierPartId", ',') AS "supplierIds"
  FROM "supplierPart" ps
  GROUP BY "itemId", "companyId"
) ps ON ps."itemId" = li."id" AND ps."companyId" = li."companyId"
LEFT JOIN "unitOfMeasure" uom ON uom.code = li."unitOfMeasureCode" AND uom."companyId" = li."companyId"
LEFT JOIN "itemCost" ic ON ic."itemId" = li."id";
