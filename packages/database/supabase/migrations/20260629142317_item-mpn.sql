-- Manufacturer Part Number (MPN) on items.
--
-- MPN is the manufacturer's catalog number for a purchased ("Buy") item. It is
-- promoted to an item-level property (alongside name/description) so it can be
-- edited in the item's Properties sidebar (buy items only) and surfaced as a
-- column in the item list tables.
--
-- This adds the column to "item" and threads it through:
--   * the Part/Tool/Material/Consumable detail RPCs (Properties sidebar data)
--   * the parts/materials/tools/consumables list views (table column + filter)

ALTER TABLE "item"
  ADD COLUMN "mpn" TEXT;


-- =============================================================================
-- get_part_details (recreated to expose "mpn")
-- Body unchanged from 20260615143722 aside from the new column.
-- DROP first: adding a column to the RETURNS TABLE changes the function's
-- result row type, which CREATE OR REPLACE cannot do (SQLSTATE 42P13).
-- =============================================================================
DROP FUNCTION IF EXISTS get_part_details(TEXT);
CREATE OR REPLACE FUNCTION get_part_details(item_id TEXT)
RETURNS TABLE (
    "active" BOOLEAN,
    "assignee" TEXT,
    "defaultMethodType" "methodType",
    "sourcingType" "sourcingType",
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
    "updatedAt" TIMESTAMP WITH TIME ZONE,
    "mpn" TEXT
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
    i."sourcingType",
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
    i."updatedAt",
    i."mpn"
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
-- get_tool_details (recreated to expose "mpn")
-- Body unchanged from 20260615143722 aside from the new column.
-- =============================================================================
DROP FUNCTION IF EXISTS get_tool_details(TEXT);
CREATE OR REPLACE FUNCTION get_tool_details(item_id TEXT)
RETURNS TABLE (
    "active" BOOLEAN,
    "assignee" TEXT,
    "defaultMethodType" "methodType",
    "sourcingType" "sourcingType",
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
    "updatedAt" TIMESTAMP WITH TIME ZONE,
    "mpn" TEXT
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
    i."sourcingType",
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
    i."updatedAt",
    i."mpn"
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
-- get_material_details (recreated to expose "mpn")
-- Body unchanged from 20260515120000 aside from the new column.
-- =============================================================================
DROP FUNCTION IF EXISTS get_material_details(TEXT);
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
    "updatedAt" TIMESTAMP WITH TIME ZONE,
    "mpn" TEXT
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
    i."updatedAt",
    i."mpn"
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
-- get_consumable_details (recreated to expose "mpn")
-- Body unchanged from 20260515120000 aside from the new column.
-- =============================================================================
DROP FUNCTION IF EXISTS get_consumable_details(TEXT);
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
    "updatedAt" TIMESTAMP WITH TIME ZONE,
    "mpn" TEXT
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
    i."updatedAt",
    i."mpn"
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


-- =============================================================================
-- List views — append "mpn" so it can render as a table column and be filtered.
-- CREATE OR REPLACE appends the column at the end, preserving existing column
-- order/names (required by CREATE OR REPLACE VIEW). Bodies are otherwise the
-- verbatim newest definitions (parts: 20260618171234; materials/tools/
-- consumables: 20260624151847).
-- =============================================================================

-- parts view (latest_items selects i.*, so "mpn" is already available as li."mpn")
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
  WHERE i."type" = 'Part'
  ORDER BY i."readableId", i."companyId",
    CASE WHEN i."revision" = '0' OR i."revision" = '' OR i."revision" IS NULL THEN 0 ELSE 1 END DESC,
    i."createdAt" DESC NULLS LAST
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
      ) ORDER BY
        CASE WHEN i."revision" = '0' OR i."revision" = '' OR i."revision" IS NULL THEN 0 ELSE 1 END,
        i."createdAt"
      ) as "revisions"
  FROM "item" i
  WHERE i."type" = 'Part'
  GROUP BY i."readableId", i."companyId"
)
SELECT
  li."active",
  li."assignee",
  li."defaultMethodType",
  li."sourcingType",
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
  (
    SELECT COALESCE(
      jsonb_object_agg(
        eim."integration",
        CASE
          WHEN eim."metadata" IS NOT NULL THEN eim."metadata"
          ELSE to_jsonb(eim."externalId")
        END
      ) FILTER (WHERE eim."externalId" IS NOT NULL OR eim."metadata" IS NOT NULL),
      '{}'::jsonb
    )
    FROM "externalIntegrationMapping" eim
    WHERE eim."entityType" = 'item' AND eim."entityId" = li.id
  ) AS "externalId",
  li."createdBy",
  li."createdAt",
  li."updatedBy",
  li."updatedAt",
  ss."supersessionMode",
  li."mpn"
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
LEFT JOIN "itemCost" ic ON ic."itemId" = li.id
LEFT JOIN "itemSupersession" ss ON ss."itemId" = li.id AND ss."companyId" = li."companyId";


-- materials view (latest_items uses an explicit column list — append i_1."mpn")
CREATE OR REPLACE VIEW "materials" WITH (security_invoker = true) AS
 WITH latest_items AS (
         SELECT DISTINCT ON (i_1."readableId", i_1."companyId") i_1.id,
            i_1."readableId",
            i_1.name,
            i_1.description,
            i_1.type,
            i_1."replenishmentSystem",
            i_1."defaultMethodType",
            i_1."itemTrackingType",
            i_1."unitOfMeasureCode",
            i_1.active,
            i_1."companyId",
            i_1."createdBy",
            i_1."createdAt",
            i_1."updatedBy",
            i_1."updatedAt",
            i_1.assignee,
            i_1."modelUploadId",
            i_1."thumbnailPath",
            i_1.notes,
            i_1."trackingMethod",
            i_1.embedding,
            i_1.revision,
            i_1."readableIdWithRevision",
            i_1."requiresInspection",
            i_1."mpn",
            mu_1."modelPath",
            mu_1."thumbnailPath" AS "modelThumbnailPath",
            mu_1.name AS "modelName",
            mu_1.size AS "modelSize"
           FROM item i_1
             LEFT JOIN "modelUpload" mu_1 ON mu_1.id = i_1."modelUploadId"
          WHERE i_1.type = 'Material'::"itemType"
          ORDER BY i_1."readableId", i_1."companyId", (
                CASE
                    WHEN i_1.revision = '0'::text OR i_1.revision = ''::text OR i_1.revision IS NULL THEN 0
                    ELSE 1
                END) DESC, i_1."createdAt" DESC NULLS LAST
        ), item_revisions AS (
         SELECT i_1."readableId",
            i_1."companyId",
            json_agg(json_build_object('id', i_1.id, 'revision', i_1.revision, 'methodType', i_1."defaultMethodType", 'type', i_1.type) ORDER BY (
                CASE
                    WHEN i_1.revision = '0'::text OR i_1.revision = ''::text OR i_1.revision IS NULL THEN 0
                    ELSE 1
                END), i_1."createdAt") AS revisions
           FROM item i_1
          WHERE i_1.type = 'Material'::"itemType"
          GROUP BY i_1."readableId", i_1."companyId"
        )
 SELECT i.active,
    i.assignee,
    i."defaultMethodType",
    i.description,
    i."itemTrackingType",
    i.name,
    i."replenishmentSystem",
    i."unitOfMeasureCode",
    i.notes,
    i.revision,
    i."readableId",
    i."readableIdWithRevision",
    i.id,
    i."companyId",
        CASE
            WHEN i."thumbnailPath" IS NULL AND i."modelThumbnailPath" IS NOT NULL THEN i."modelThumbnailPath"
            ELSE i."thumbnailPath"
        END AS "thumbnailPath",
    i."modelUploadId",
    i."modelPath",
    i."modelName",
    i."modelSize",
    ps."supplierIds",
    uom.name AS "unitOfMeasure",
    ir.revisions,
    mf.name AS "materialForm",
    ms.name AS "materialSubstance",
    md.name AS dimensions,
    mfin.name AS finish,
    mg.name AS grade,
    mt.name AS "materialType",
    m."materialSubstanceId",
    m."materialFormId",
    m."customFields",
    m.tags,
    ic."itemPostingGroupId",
    ( SELECT COALESCE(jsonb_object_agg(eim.integration,
                CASE
                    WHEN eim.metadata IS NOT NULL THEN eim.metadata
                    ELSE to_jsonb(eim."externalId")
                END) FILTER (WHERE eim."externalId" IS NOT NULL OR eim.metadata IS NOT NULL), '{}'::jsonb) AS "coalesce"
           FROM "externalIntegrationMapping" eim
          WHERE eim."entityType" = 'item'::text AND eim."entityId" = i.id) AS "externalId",
    i."createdBy",
    i."createdAt",
    i."updatedBy",
    i."updatedAt",
    ss."supersessionMode",
    i."mpn"
   FROM material m
     JOIN latest_items i ON i."readableId" = m.id AND i."companyId" = m."companyId"
     LEFT JOIN item_revisions ir ON ir."readableId" = m.id AND ir."companyId" = i."companyId"
     LEFT JOIN ( SELECT ps_1."itemId",
            ps_1."companyId",
            string_agg(ps_1."supplierPartId", ','::text) AS "supplierIds"
           FROM "supplierPart" ps_1
          GROUP BY ps_1."itemId", ps_1."companyId") ps ON ps."itemId" = i.id AND ps."companyId" = i."companyId"
     LEFT JOIN "modelUpload" mu ON mu.id = i."modelUploadId"
     LEFT JOIN "unitOfMeasure" uom ON uom.code = i."unitOfMeasureCode" AND uom."companyId" = i."companyId"
     LEFT JOIN "materialForm" mf ON mf.id = m."materialFormId"
     LEFT JOIN "materialSubstance" ms ON ms.id = m."materialSubstanceId"
     LEFT JOIN "materialDimension" md ON m."dimensionId" = md.id
     LEFT JOIN "materialFinish" mfin ON m."finishId" = mfin.id
     LEFT JOIN "materialGrade" mg ON m."gradeId" = mg.id
     LEFT JOIN "materialType" mt ON m."materialTypeId" = mt.id
     LEFT JOIN "itemCost" ic ON ic."itemId" = i.id
     LEFT JOIN "itemSupersession" ss ON ss."itemId" = i.id AND ss."companyId" = i."companyId";


-- tools view (latest_items + positional alias list — append "mpn" to both)
CREATE OR REPLACE VIEW "tools" WITH (security_invoker = true) AS
 WITH latest_items AS (
         SELECT DISTINCT ON (i."readableId", i."companyId") i.id,
            i."readableId",
            i.name,
            i.description,
            i.type,
            i."replenishmentSystem",
            i."defaultMethodType",
            i."itemTrackingType",
            i."unitOfMeasureCode",
            i.active,
            i."companyId",
            i."createdBy",
            i."createdAt",
            i."updatedBy",
            i."updatedAt",
            i.assignee,
            i."modelUploadId",
            i."thumbnailPath",
            i.notes,
            i."trackingMethod",
            i.embedding,
            i.revision,
            i."readableIdWithRevision",
            i."requiresInspection",
            i."sourcingType",
            mu.id AS "modelUploadId",
            mu."modelPath",
            mu."thumbnailPath" AS "modelThumbnailPath",
            mu.name AS "modelName",
            mu.size AS "modelSize",
            i."mpn"
           FROM item i
             LEFT JOIN "modelUpload" mu ON mu.id = i."modelUploadId"
          WHERE i.type = 'Tool'::"itemType"
          ORDER BY i."readableId", i."companyId", (
                CASE
                    WHEN i.revision = '0'::text OR i.revision = ''::text OR i.revision IS NULL THEN 0
                    ELSE 1
                END) DESC, i."createdAt" DESC NULLS LAST
        ), item_revisions AS (
         SELECT i."readableId",
            i."companyId",
            json_agg(json_build_object('id', i.id, 'revision', i.revision, 'methodType', i."defaultMethodType", 'type', i.type) ORDER BY (
                CASE
                    WHEN i.revision = '0'::text OR i.revision = ''::text OR i.revision IS NULL THEN 0
                    ELSE 1
                END), i."createdAt") AS revisions
           FROM item i
          WHERE i.type = 'Tool'::"itemType"
          GROUP BY i."readableId", i."companyId"
        )
 SELECT li.active,
    li.assignee,
    li."defaultMethodType",
    li."sourcingType",
    li.description,
    li."itemTrackingType",
    li.name,
    li."replenishmentSystem",
    li."unitOfMeasureCode",
    li.notes,
    li.revision,
    li."readableId",
    li."readableIdWithRevision",
    li.id,
    li."companyId",
        CASE
            WHEN li."thumbnailPath" IS NULL AND li."modelThumbnailPath" IS NOT NULL THEN li."modelThumbnailPath"
            ELSE li."thumbnailPath"
        END AS "thumbnailPath",
    li."modelPath",
    li."modelName",
    li."modelSize",
    ps."supplierIds",
    uom.name AS "unitOfMeasure",
    ir.revisions,
    t."customFields",
    t.tags,
    ic."itemPostingGroupId",
    ( SELECT COALESCE(jsonb_object_agg(eim.integration,
                CASE
                    WHEN eim.metadata IS NOT NULL THEN eim.metadata
                    ELSE to_jsonb(eim."externalId")
                END) FILTER (WHERE eim."externalId" IS NOT NULL OR eim.metadata IS NOT NULL), '{}'::jsonb) AS "coalesce"
           FROM "externalIntegrationMapping" eim
          WHERE eim."entityType" = 'item'::text AND eim."entityId" = li.id) AS "externalId",
    li."createdBy",
    li."createdAt",
    li."updatedBy",
    li."updatedAt",
    ss."supersessionMode",
    li."mpn"
   FROM tool t
     JOIN latest_items li(id, "readableId", name, description, type, "replenishmentSystem", "defaultMethodType", "itemTrackingType", "unitOfMeasureCode", active, "companyId", "createdBy", "createdAt", "updatedBy", "updatedAt", assignee, "modelUploadId", "thumbnailPath", notes, "trackingMethod", embedding, revision, "readableIdWithRevision", "requiresInspection", "sourcingType", "modelUploadId_1", "modelPath", "modelThumbnailPath", "modelName", "modelSize", "mpn") ON li."readableId" = t.id AND li."companyId" = t."companyId"
     LEFT JOIN item_revisions ir ON ir."readableId" = t.id AND ir."companyId" = li."companyId"
     LEFT JOIN ( SELECT ps_1."itemId",
            ps_1."companyId",
            string_agg(ps_1."supplierPartId", ','::text) AS "supplierIds"
           FROM "supplierPart" ps_1
          GROUP BY ps_1."itemId", ps_1."companyId") ps ON ps."itemId" = li.id AND ps."companyId" = li."companyId"
     LEFT JOIN "unitOfMeasure" uom ON uom.code = li."unitOfMeasureCode" AND uom."companyId" = li."companyId"
     LEFT JOIN "itemCost" ic ON ic."itemId" = li.id
     LEFT JOIN "itemSupersession" ss ON ss."itemId" = li.id AND ss."companyId" = li."companyId";


-- consumables view (latest_items uses an explicit column list — append i."mpn")
CREATE OR REPLACE VIEW "consumables" WITH (security_invoker = true) AS
 WITH latest_items AS (
         SELECT DISTINCT ON (i."readableId", i."companyId") i.id,
            i."readableId",
            i.name,
            i.description,
            i.type,
            i."replenishmentSystem",
            i."defaultMethodType",
            i."itemTrackingType",
            i."unitOfMeasureCode",
            i.active,
            i."companyId",
            i."createdBy",
            i."createdAt",
            i."updatedBy",
            i."updatedAt",
            i.assignee,
            i."modelUploadId",
            i."thumbnailPath",
            i.notes,
            i."trackingMethod",
            i.embedding,
            i.revision,
            i."readableIdWithRevision",
            i."requiresInspection",
            i."mpn",
            mu."modelPath",
            mu."thumbnailPath" AS "modelThumbnailPath",
            mu.name AS "modelName",
            mu.size AS "modelSize"
           FROM item i
             LEFT JOIN "modelUpload" mu ON mu.id = i."modelUploadId"
          WHERE i.type = 'Consumable'::"itemType"
          ORDER BY i."readableId", i."companyId", (
                CASE
                    WHEN i.revision = '0'::text OR i.revision = ''::text OR i.revision IS NULL THEN 0
                    ELSE 1
                END) DESC, i."createdAt" DESC NULLS LAST
        ), item_revisions AS (
         SELECT i."readableId",
            i."companyId",
            json_agg(json_build_object('id', i.id, 'revision', i.revision, 'methodType', i."defaultMethodType", 'type', i.type) ORDER BY (
                CASE
                    WHEN i.revision = '0'::text OR i.revision = ''::text OR i.revision IS NULL THEN 0
                    ELSE 1
                END), i."createdAt") AS revisions
           FROM item i
          WHERE i.type = 'Consumable'::"itemType"
          GROUP BY i."readableId", i."companyId"
        )
 SELECT li.active,
    li.assignee,
    li."defaultMethodType",
    li.description,
    li."itemTrackingType",
    li.name,
    li."replenishmentSystem",
    li."unitOfMeasureCode",
    li.notes,
    li.revision,
    li."readableId",
    li."readableIdWithRevision",
    li.id,
    li."companyId",
        CASE
            WHEN li."thumbnailPath" IS NULL AND li."modelThumbnailPath" IS NOT NULL THEN li."modelThumbnailPath"
            ELSE li."thumbnailPath"
        END AS "thumbnailPath",
    li."modelUploadId",
    li."modelPath",
    li."modelName",
    li."modelSize",
    ps."supplierIds",
    uom.name AS "unitOfMeasure",
    ir.revisions,
    c."customFields",
    c.tags,
    ic."itemPostingGroupId",
    ( SELECT COALESCE(jsonb_object_agg(eim.integration,
                CASE
                    WHEN eim.metadata IS NOT NULL THEN eim.metadata
                    ELSE to_jsonb(eim."externalId")
                END) FILTER (WHERE eim."externalId" IS NOT NULL OR eim.metadata IS NOT NULL), '{}'::jsonb) AS "coalesce"
           FROM "externalIntegrationMapping" eim
          WHERE eim."entityType" = 'item'::text AND eim."entityId" = li.id) AS "externalId",
    li."createdBy",
    li."createdAt",
    li."updatedBy",
    li."updatedAt",
    ss."supersessionMode",
    li."mpn"
   FROM consumable c
     JOIN latest_items li ON li."readableId" = c.id AND li."companyId" = c."companyId"
     LEFT JOIN item_revisions ir ON ir."readableId" = c.id AND ir."companyId" = li."companyId"
     LEFT JOIN ( SELECT ps_1."itemId",
            ps_1."companyId",
            string_agg(ps_1."supplierPartId", ','::text) AS "supplierIds"
           FROM "supplierPart" ps_1
          GROUP BY ps_1."itemId", ps_1."companyId") ps ON ps."itemId" = li.id AND ps."companyId" = li."companyId"
     LEFT JOIN "unitOfMeasure" uom ON uom.code = li."unitOfMeasureCode" AND uom."companyId" = li."companyId"
     LEFT JOIN "itemCost" ic ON ic."itemId" = li.id
     LEFT JOIN "itemSupersession" ss ON ss."itemId" = li.id AND ss."companyId" = li."companyId";
