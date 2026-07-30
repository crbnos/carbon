-- =============================================================================
-- Service as a first-class item type.
--
-- The legacy "service" table (20230412120726) predates the modern per-type
-- table pattern (typeTable.id = item.readableId, see 20250519122022). The app
-- now derives Buy/Make from itemReplenishment.replenishmentSystem, so the
-- legacy "serviceType" column is defaulted and no longer written.
-- =============================================================================

-- The column is NOT NULL with no default; the app stops writing it.
ALTER TABLE "service" ALTER COLUMN "serviceType" SET DEFAULT 'External';

-- Vestigial linkage: part/material/tool/consumable dropped "itemId" in
-- 20250519122022, but "service" was skipped. The current "services" view
-- (20260419130000) joins item."readableId" = service."id" and never reads it.
ALTER TABLE "service" DROP COLUMN IF EXISTS "itemId";


-- =============================================================================
-- get_service_details
-- Body copied from get_tool_details (20260629142317) with tool -> service.
-- =============================================================================
DROP FUNCTION IF EXISTS get_service_details(TEXT);
CREATE OR REPLACE FUNCTION get_service_details(item_id TEXT)
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
    AND i."type" = 'Service'
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
    s."customFields",
    s."tags",
    ic."itemPostingGroupId",
    i."createdBy",
    i."createdAt",
    i."updatedBy",
    i."updatedAt",
    i."mpn"
  FROM "service" s
  LEFT JOIN "item" i ON i."readableId" = s."id" AND i."companyId" = s."companyId"
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
-- Make services get a makeMethod like Parts and Tools.
-- Body unchanged from 20260410031802 aside from adding 'Service'.
-- The event trigger already calls this function by name; no re-attach needed.
-- =============================================================================
CREATE OR REPLACE FUNCTION sync_create_make_method_related_records(
  p_table TEXT,
  p_operation TEXT,
  p_new JSONB,
  p_old JSONB
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF p_operation != 'INSERT' THEN RETURN; END IF;

  IF (p_new->>'type') IN ('Part', 'Tool', 'Service') THEN
    INSERT INTO "makeMethod"("itemId", "createdBy", "companyId")
    VALUES (p_new->>'id', p_new->>'createdBy', p_new->>'companyId');
  END IF;
END;
$$;
