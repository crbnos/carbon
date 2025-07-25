

-- Update the materials view if it exists
DROP VIEW IF EXISTS "materials";

-- Drop the old text columns
ALTER TABLE "material" 
  DROP COLUMN "dimensions",
  DROP COLUMN "finish",
  DROP COLUMN "grade";

-- Add materialTypeId column
ALTER TABLE "material" 
  ADD COLUMN "materialTypeId" TEXT;

-- Add foreign key constraint for materialTypeId
ALTER TABLE "material"
  ADD CONSTRAINT "material_materialTypeId_fkey" FOREIGN KEY ("materialTypeId") REFERENCES "materialType"("id");

-- Create index for better performance
CREATE INDEX "material_materialTypeId_idx" ON "material"("materialTypeId");


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
  LEFT JOIN "materialType" mt ON m."materialTypeId" = mt."id";


-- Update get_material_details function to use new ID-based relationships
DROP FUNCTION IF EXISTS get_material_details;
CREATE OR REPLACE FUNCTION get_material_details(item_id TEXT)
RETURNS TABLE (
    "active" BOOLEAN,
    "assignee" TEXT,
    "defaultMethodType" "methodType",
    "description" TEXT,
    "itemTrackingType" "itemTrackingType",
    "name" TEXT,
    "replenishmentSystem" "itemReplenishmentSystem",
    "unitOfMeasureCode" TEXT,
    "notes" JSONB,
    "thumbnailPath" TEXT,
    "modelUploadId" TEXT,
    "modelPath" TEXT,
    "modelName" TEXT,
    "modelSize" BIGINT,
    "id" TEXT,
    "companyId" TEXT,
    "readableId" TEXT,
    "revision" TEXT,
    "readableIdWithRevision" TEXT,
    "supplierIds" TEXT,
    "unitOfMeasure" TEXT,
    "revisions" JSON,
    "materialForm" TEXT,
    "materialSubstance" TEXT,
    "finish" TEXT,
    "grade" TEXT,
    "dimensions" TEXT,
    "materialType" TEXT,
    "materialSubstanceId" TEXT,
    "materialFormId" TEXT,
    "materialTypeId" TEXT,
    "dimensionId" TEXT,
    "gradeId" TEXT,
    "finishId" TEXT,
    "customFields" JSONB,
    "tags" TEXT[],
    "createdBy" TEXT,
    "createdAt" TIMESTAMP WITH TIME ZONE,
    "updatedBy" TEXT,
    "updatedAt" TIMESTAMP WITH TIME ZONE
) AS $$
DECLARE
  v_readable_id TEXT;
  v_company_id TEXT;
BEGIN
  -- First get the readableId and companyId for the item
  SELECT i."readableId", i."companyId" INTO v_readable_id, v_company_id
  FROM "item" i
  WHERE i.id = item_id;

  RETURN QUERY
  WITH item_revisions AS (
    SELECT 
      json_agg(
        json_build_object(
          'id', i.id,
          'revision', i."revision",
          'methodType', i."defaultMethodType",
          'type', i."type"
        ) ORDER BY 
          i."createdAt"
      ) as "revisions"
    FROM "item" i
    WHERE i."readableId" = v_readable_id 
    AND i."companyId" = v_company_id
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
    CASE
      WHEN i."thumbnailPath" IS NULL AND mu."thumbnailPath" IS NOT NULL THEN mu."thumbnailPath"
      ELSE i."thumbnailPath"
    END as "thumbnailPath",
    mu.id as "modelUploadId",
    mu."modelPath",
    mu."name" as "modelName",
    mu."size" as "modelSize",
    i."id",
    i."companyId",
    i."readableId",
    i."revision",
    i."readableIdWithRevision",
    ps."supplierIds",
    uom.name as "unitOfMeasure",
    ir."revisions",
    mf."name" AS "materialForm",
    ms."name" AS "materialSubstance",
    mfin."name" AS "finish",
    mg."name" AS "grade", 
    md."name" AS "dimensions",
    mt."name" AS "materialType",
    m."materialSubstanceId",
    m."materialFormId",
    m."materialTypeId",
    m."dimensionId",
    m."gradeId",
    m."finishId",
    m."customFields",
    m."tags",
    i."createdBy",
    i."createdAt",
    i."updatedBy",
    i."updatedAt"
  FROM "material" m
    LEFT JOIN "item" i ON i."readableId" = m."id" AND i."companyId" = m."companyId"
    LEFT JOIN item_revisions ir ON true
    LEFT JOIN (
      SELECT 
        ps."itemId",
        string_agg(ps."supplierPartId", ',') AS "supplierIds"
      FROM "supplierPart" ps
      GROUP BY ps."itemId"
    ) ps ON ps."itemId" = i.id
    LEFT JOIN "modelUpload" mu ON mu.id = i."modelUploadId"
    LEFT JOIN "unitOfMeasure" uom ON uom.code = i."unitOfMeasureCode" AND uom."companyId" = i."companyId"
    LEFT JOIN "materialForm" mf ON mf."id" = m."materialFormId"
    LEFT JOIN "materialSubstance" ms ON ms."id" = m."materialSubstanceId"
    LEFT JOIN "materialDimension" md ON m."dimensionId" = md."id"
    LEFT JOIN "materialFinish" mfin ON m."finishId" = mfin."id"
    LEFT JOIN "materialGrade" mg ON m."gradeId" = mg."id"
    LEFT JOIN "materialType" mt ON m."materialTypeId" = mt."id"
    WHERE i."id" = item_id;
END;
$$ LANGUAGE plpgsql STABLE;

