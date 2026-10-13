-- The root make method's own BOM lines lost their operation assignment:
-- get_method_tree's anchor member selected NULL AS "operationId" while the
-- recursive member (sub-assembly lines) selected "methodOperationId". The NULL
-- was a placeholder from when "operationId" was first added (4faa220c44), the
-- twin of the anchor's hardcoded "order" that the tree-order fix later
-- corrected. get-method maps this column onto jobMaterial.jobOperationId /
-- quoteMaterial.quoteOperationId (itemToJob, itemToJobMakeMethod,
-- itemToQuoteLine, itemToQuoteMakeMethod), so jobs and quotes created from an
-- item never carried the operation a top-level line was assigned to. No other
-- caller reads the column. Same signature and return type, so no DROP needed.

CREATE OR REPLACE FUNCTION get_method_tree(uid TEXT)
RETURNS TABLE (
    "methodMaterialId" TEXT,
    "makeMethodId" TEXT,
    "materialMakeMethodId" TEXT,
    "itemId" TEXT,
    "itemReadableId" TEXT,
    "itemType" TEXT,
    "description" TEXT,
    "unitOfMeasureCode" TEXT,
    "unitCost" NUMERIC,
    "quantity" NUMERIC,
    "methodType" "methodType",
    "itemTrackingType" TEXT,
    "parentMaterialId" TEXT,
    "order" DOUBLE PRECISION,
    "operationId" TEXT,
    "methodOperationStepIds" JSONB,
    "isRoot" BOOLEAN,
    "kit" BOOLEAN,
    "revision" TEXT,
    "externalId" JSONB,
    "version" NUMERIC,
    "storageUnitIds" JSONB,
    "isPickDescendant" BOOLEAN,
    "replenishmentSystem" "itemReplenishmentSystem"
) AS $$
WITH RECURSIVE material AS (
    SELECT
        "id",
        "makeMethodId",
        "methodType",
        COALESCE(
            "materialMakeMethodId",
            CASE WHEN "methodType" = 'Pull from Inventory' THEN (
                SELECT amm.id FROM "activeMakeMethods" amm WHERE amm."itemId" = "methodMaterial"."itemId" LIMIT 1
            ) END
        ) AS "materialMakeMethodId",
        "itemId",
        "itemType",
        "quantity",
        "makeMethodId" AS "parentMaterialId",
        "methodOperationId" AS "operationId",
        COALESCE("order", 1) AS "order",
        "kit",
        "storageUnitIds",
        false AS "isPickDescendant"
    FROM
        "methodMaterial"
    WHERE
        "makeMethodId" = uid
    UNION
    SELECT
        child."id",
        child."makeMethodId",
        child."methodType",
        COALESCE(
            child."materialMakeMethodId",
            CASE WHEN child."methodType" = 'Pull from Inventory' THEN (
                SELECT amm.id FROM "activeMakeMethods" amm WHERE amm."itemId" = child."itemId" LIMIT 1
            ) END
        ) AS "materialMakeMethodId",
        child."itemId",
        child."itemType",
        child."quantity",
        parent."id" AS "parentMaterialId",
        child."methodOperationId" AS "operationId",
        child."order",
        child."kit",
        child."storageUnitIds",
        (parent."methodType" = 'Pull from Inventory' OR parent."isPickDescendant") AS "isPickDescendant"
    FROM
        "methodMaterial" child
        INNER JOIN material parent ON parent."materialMakeMethodId" = child."makeMethodId"
)
SELECT
  material.id as "methodMaterialId",
  material."makeMethodId",
  material."materialMakeMethodId",
  material."itemId",
  item."readableIdWithRevision" AS "itemReadableId",
  material."itemType",
  item."name" AS "description",
  item."unitOfMeasureCode",
  cost."unitCost",
  material."quantity",
  material."methodType",
  item."itemTrackingType",
  material."parentMaterialId",
  material."order",
  material."operationId",
  (
    SELECT COALESCE(jsonb_agg(jsonb_build_object('id', mms."methodOperationStepId", 'quantity', mms."quantity")), '[]'::jsonb)
    FROM "methodMaterialStep" mms
    WHERE mms."methodMaterialId" = material.id
  ) AS "methodOperationStepIds",
  false AS "isRoot",
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
  mm2."version",
  material."storageUnitIds",
  material."isPickDescendant",
  item."replenishmentSystem"
FROM material
INNER JOIN item
  ON material."itemId" = item.id
INNER JOIN "itemCost" cost
  ON item.id = cost."itemId"
INNER JOIN "makeMethod" mm
  ON material."makeMethodId" = mm.id
LEFT JOIN "makeMethod" mm2
  ON material."materialMakeMethodId" = mm2.id
UNION
SELECT
  mm."id" AS "methodMaterialId",
  NULL AS "makeMethodId",
  mm.id AS "materialMakeMethodId",
  mm."itemId",
  item."readableIdWithRevision" AS "itemReadableId",
  item."type"::text,
  item."name" AS "description",
  item."unitOfMeasureCode",
  cost."unitCost",
  1 AS "quantity",
  'Make to Order' AS "methodType",
  item."itemTrackingType",
  NULL AS "parentMaterialId",
  CAST(1 AS DOUBLE PRECISION) AS "order",
  NULL AS "operationId",
  '[]'::jsonb AS "methodOperationStepIds",
  true AS "isRoot",
  false AS "kit",
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
  mm."version",
  '{}'::JSONB AS "storageUnitIds",
  false AS "isPickDescendant",
  item."replenishmentSystem"
FROM "makeMethod" mm
INNER JOIN item
  ON mm."itemId" = item.id
INNER JOIN "itemCost" cost
  ON item.id = cost."itemId"
WHERE mm.id = uid
ORDER BY "order"
$$ LANGUAGE sql STABLE;
