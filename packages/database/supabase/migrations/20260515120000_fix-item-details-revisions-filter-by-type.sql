-- Fix cross-type leakage in get_part_details / get_tool_details /
-- get_material_details / get_consumable_details.
--
-- These RPCs power the detail page loaders for each item type. Their
-- item_revisions CTE pulled every "item" row sharing the same
-- (readableId, companyId) regardless of type. Since the item uniqueness
-- constraint is (readableId, revision, companyId, type), a Part and a
-- Consumable can legitimately share a readableId — so the revisions list
-- on the Part detail page ended up showing Consumable rows as if they
-- were sibling revisions, which was reported as "2 versions
-- of the same part in the item master."
--
-- Fix: add `AND i."type" = '<Type>'` to each CTE so revisions are scoped
-- to the matching type. The bodies are otherwise unchanged from
-- 20260419094132_inbound-inspections.sql.


-- =============================================================================
-- get_part_details
-- =============================================================================
CREATE OR REPLACE FUNCTION get_part_details(item_id TEXT)
RETURNS TABLE (
    "active" BOOLEAN,
    "assignee" TEXT,
    "defaultMethodType" "methodType",
    "description" TEXT,
    "itemTrackingType" "itemTrackingType",
    "requiresInspection" BOOLEAN,
    "name" TEXT,
    "replenishmentSystem" "itemReplenishmentSystem",
    "unitOfMeasureCode" TEXT,
    "notes" JSONB,
    "thumbnailPath" TEXT,
    "modelId" TEXT,
    "modelPath" TEXT,
    "modelName" TEXT,
    "modelSize" BIGINT,
    "id" TEXT,
    "companyId" TEXT,
    "unitOfMeasure" TEXT,
    "readableId" TEXT,
    "revision" TEXT,
    "readableIdWithRevision" TEXT,
    "revisions" JSON,
    "customFields" JSONB,
    "tags" TEXT[],
    "itemPostingGroupId" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP WITH TIME ZONE,
    "updatedBy" TEXT,
    "updatedAt" TIMESTAMP WITH TIME ZONE
) AS $$
DECLARE
  v_readable_id TEXT;
  v_company_id TEXT;
BEGIN
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
          i."createdAt" DESC
      ) as "revisions"
    FROM "item" i
    WHERE i."readableId" = v_readable_id
    AND i."companyId" = v_company_id
    AND i."type" = 'Part'
  )
  SELECT
    i."active",
    i."assignee",
    i."defaultMethodType",
    i."description",
    i."itemTrackingType",
    i."requiresInspection",
    i."name",
    i."replenishmentSystem",
    i."unitOfMeasureCode",
    i."notes",
    CASE
      WHEN i."thumbnailPath" IS NULL AND mu."thumbnailPath" IS NOT NULL THEN mu."thumbnailPath"
      ELSE i."thumbnailPath"
    END as "thumbnailPath",
    mu.id as "modelId",
    mu."modelPath",
    mu."name" as "modelName",
    mu."size" as "modelSize",
    i."id",
    i."companyId",
    uom.name as "unitOfMeasure",
    i."readableId",
    i."revision",
    i."readableIdWithRevision",
    ir."revisions",
    p."customFields",
    p."tags",
    ic."itemPostingGroupId",
    i."createdBy",
    i."createdAt",
    i."updatedBy",
    i."updatedAt"
  FROM "part" p
  LEFT JOIN "item" i ON i."readableId" = p."id" AND i."companyId" = p."companyId"
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
  LEFT JOIN "itemCost" ic ON ic."itemId" = i.id
  WHERE i."id" = item_id;
END;
$$ LANGUAGE plpgsql;


-- =============================================================================
-- get_tool_details
-- =============================================================================
CREATE OR REPLACE FUNCTION get_tool_details(item_id TEXT)
RETURNS TABLE (
    "active" BOOLEAN,
    "assignee" TEXT,
    "defaultMethodType" "methodType",
    "description" TEXT,
    "itemTrackingType" "itemTrackingType",
    "requiresInspection" BOOLEAN,
    "name" TEXT,
    "replenishmentSystem" "itemReplenishmentSystem",
    "unitOfMeasureCode" TEXT,
    "notes" JSONB,
    "thumbnailPath" TEXT,
    "modelId" TEXT,
    "modelPath" TEXT,
    "modelName" TEXT,
    "modelSize" BIGINT,
    "id" TEXT,
    "companyId" TEXT,
    "unitOfMeasure" TEXT,
    "readableId" TEXT,
    "revision" TEXT,
    "readableIdWithRevision" TEXT,
    "revisions" JSON,
    "customFields" JSONB,
    "tags" TEXT[],
    "itemPostingGroupId" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP WITH TIME ZONE,
    "updatedBy" TEXT,
    "updatedAt" TIMESTAMP WITH TIME ZONE
) AS $$
DECLARE
  v_readable_id TEXT;
  v_company_id TEXT;
BEGIN
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
          i."createdAt" DESC
      ) as "revisions"
    FROM "item" i
    WHERE i."readableId" = v_readable_id
    AND i."companyId" = v_company_id
    AND i."type" = 'Tool'
  )
  SELECT
    i."active",
    i."assignee",
    i."defaultMethodType",
    i."description",
    i."itemTrackingType",
    i."requiresInspection",
    i."name",
    i."replenishmentSystem",
    i."unitOfMeasureCode",
    i."notes",
    CASE
      WHEN i."thumbnailPath" IS NULL AND mu."thumbnailPath" IS NOT NULL THEN mu."thumbnailPath"
      ELSE i."thumbnailPath"
    END as "thumbnailPath",
    mu.id as "modelId",
    mu."modelPath",
    mu."name" as "modelName",
    mu."size" as "modelSize",
    i."id",
    i."companyId",
    uom.name as "unitOfMeasure",
    i."readableId",
    i."revision",
    i."readableIdWithRevision",
    ir."revisions",
    t."customFields",
    t."tags",
    ic."itemPostingGroupId",
    i."createdBy",
    i."createdAt",
    i."updatedBy",
    i."updatedAt"
  FROM "tool" t
  LEFT JOIN "item" i ON i."readableId" = t."id" AND i."companyId" = t."companyId"
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
  LEFT JOIN "itemCost" ic ON ic."itemId" = i.id
  WHERE i."id" = item_id;
END;
$$ LANGUAGE plpgsql;


-- =============================================================================
-- get_material_details
-- =============================================================================
CREATE OR REPLACE FUNCTION get_material_details(item_id TEXT)
RETURNS TABLE (
    "active" BOOLEAN,
    "assignee" TEXT,
    "defaultMethodType" "methodType",
    "description" TEXT,
    "itemTrackingType" "itemTrackingType",
    "requiresInspection" BOOLEAN,
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
    "itemPostingGroupId" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP WITH TIME ZONE,
    "updatedBy" TEXT,
    "updatedAt" TIMESTAMP WITH TIME ZONE
) AS $$
DECLARE
  v_readable_id TEXT;
  v_company_id TEXT;
BEGIN
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
    AND i."type" = 'Material'
  )
  SELECT
    i."active",
    i."assignee",
    i."defaultMethodType",
    i."description",
    i."itemTrackingType",
    i."requiresInspection",
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
    ic."itemPostingGroupId",
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
    LEFT JOIN "itemCost" ic ON ic."itemId" = i.id
    WHERE i."id" = item_id;
END;
$$ LANGUAGE plpgsql STABLE;


-- =============================================================================
-- get_consumable_details
-- =============================================================================
CREATE OR REPLACE FUNCTION get_consumable_details(item_id TEXT)
RETURNS TABLE (
    "active" BOOLEAN,
    "assignee" TEXT,
    "defaultMethodType" "methodType",
    "description" TEXT,
    "itemTrackingType" "itemTrackingType",
    "requiresInspection" BOOLEAN,
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
    "customFields" JSONB,
    "tags" TEXT[],
    "itemPostingGroupId" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP WITH TIME ZONE,
    "updatedBy" TEXT,
    "updatedAt" TIMESTAMP WITH TIME ZONE
) AS $$
DECLARE
  v_readable_id TEXT;
  v_company_id TEXT;
BEGIN
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
    AND i."type" = 'Consumable'
  )
  SELECT
    i."active",
    i."assignee",
    i."defaultMethodType",
    i."description",
    i."itemTrackingType",
    i."requiresInspection",
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
    c."customFields",
    c."tags",
    ic."itemPostingGroupId",
    i."createdBy",
    i."createdAt",
    i."updatedBy",
    i."updatedAt"
  FROM "consumable" c
    LEFT JOIN "item" i ON i."readableId" = c."id" AND i."companyId" = c."companyId"
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
    LEFT JOIN "itemCost" ic ON ic."itemId" = i.id
    WHERE i."id" = item_id;
END;
$$ LANGUAGE plpgsql STABLE;
