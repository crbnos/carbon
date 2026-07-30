-- Recreate get_quote_methods_by_method_id (verbatim from
-- 20260417000300_storage-unit-recreate-dependents.sql) with ONE added output
-- column "materialTrackingType" = quoteMaterial."itemTrackingType" (the
-- per-line snapshot added in 20260723084405), resolved via a PK join so the
-- "quoteMaterialWithMakeMethodId" view (whose qm.* column list was frozen
-- before the column existed) does not need recreating. NULL for the root row
-- and legacy quote lines -> consumers fall back to the item's live value.
-- Mirrors get_method_tree's materialTrackingType (20260722101327).

DROP FUNCTION IF EXISTS get_quote_methods_by_method_id;
CREATE OR REPLACE FUNCTION get_quote_methods_by_method_id(mid TEXT)
RETURNS TABLE (
    "quoteId" TEXT,
    "quoteLineId" TEXT,
    "methodMaterialId" TEXT,
    "quoteMakeMethodId" TEXT,
    "quoteMaterialMakeMethodId" TEXT,
    "itemId" TEXT,
    "itemReadableId" TEXT,
    "description" TEXT,
    "unitOfMeasureCode" TEXT,
    "itemType" TEXT,
    "itemTrackingType" TEXT,
    "quantity" NUMERIC,
    "unitCost" NUMERIC,
    "methodType" "methodType",
    "parentMaterialId" TEXT,
    "order" DOUBLE PRECISION,
    "isRoot" BOOLEAN,
    "kit" BOOLEAN,
    "revision" TEXT,
    "externalId" JSONB,
    "version" NUMERIC,
    "storageUnitId" TEXT,
    "materialTrackingType" "itemTrackingType"
) AS $$
WITH RECURSIVE material AS (
    SELECT
        "quoteId",
        "quoteLineId",
        "id",
        "id" AS "quoteMakeMethodId",
        'Make to Order'::"methodType" AS "methodType",
        "id" AS "quoteMaterialMakeMethodId",
        "version",
        "itemId",
        'Part' AS "itemType",
        1::NUMERIC AS "quantity",
        0::NUMERIC AS "unitCost",
        "parentMaterialId",
        CAST(1 AS DOUBLE PRECISION) AS "order",
        TRUE AS "isRoot",
        FALSE AS "kit",
        NULL::TEXT AS "storageUnitId"
    FROM
        "quoteMakeMethod"
    WHERE
        "id" = mid
    UNION
    SELECT
        child."quoteId",
        child."quoteLineId",
        child."id",
        child."quoteMakeMethodId",
        child."methodType",
        child."quoteMaterialMakeMethodId",
        child."version",
        child."itemId",
        child."itemType",
        child."quantity",
        child."unitCost",
        parent."id" AS "parentMaterialId",
        child."order",
        FALSE AS "isRoot",
        child."kit",
        child."storageUnitId"
    FROM
        "quoteMaterialWithMakeMethodId" child
        INNER JOIN material parent ON parent."quoteMaterialMakeMethodId" = child."quoteMakeMethodId"
    WHERE parent."methodType" = 'Make to Order'
)
SELECT
  material."quoteId",
  material."quoteLineId",
  material.id as "methodMaterialId",
  material."quoteMakeMethodId",
  material."quoteMaterialMakeMethodId",
  material."itemId",
  item."readableIdWithRevision" AS "itemReadableId",
  item."name" AS "description",
  item."unitOfMeasureCode",
  material."itemType",
  item."itemTrackingType",
  material."quantity",
  material."unitCost",
  material."methodType",
  material."parentMaterialId",
  material."order",
  material."isRoot",
  material."kit",
  item."revision",
  (
    SELECT COALESCE(
      jsonb_object_agg(
        eim."integration",
        CASE
          WHEN eim."metadata" IS NOT NULL THEN eim."metadata"
          ELSE to_jsonb(eim."externalId")
        END
      ) FILTER (WHERE eim."externalId" IS NOT NULL),
      '{}'::jsonb
    )
    FROM "externalIntegrationMapping" eim
    WHERE eim."entityType" = 'item' AND eim."entityId" = item.id
  ) AS "externalId",
  material."version",
  material."storageUnitId",
  qm."itemTrackingType" AS "materialTrackingType"
FROM material
INNER JOIN item ON material."itemId" = item.id
LEFT JOIN "quoteMaterial" qm
  ON qm."id" = material."id" AND qm."companyId" = item."companyId"
ORDER BY "order"
$$ LANGUAGE sql STABLE;
