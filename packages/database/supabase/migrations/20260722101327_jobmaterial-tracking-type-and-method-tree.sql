-- Carry the per-line tracking-type override (methodMaterial.itemTrackingType,
-- added in 20260722101224) down to job materials so job consumption (the issue
-- edge function) can decide per line whether to write a stock ledger entry.
--
-- 1. jobMaterial gets a nullable "itemTrackingType" snapshot. It is populated by
--    the get-method edge function from the method tree's new
--    "materialTrackingType" field. NULL on legacy rows -> consumers fall back to
--    the live item.itemTrackingType, preserving today's behavior.
-- 2. get_method_tree is recreated (verbatim from 20260714084035) with ONE added
--    output column "materialTrackingType" = methodMaterial.itemTrackingType (the
--    effective, per-line-overridable value). The existing "itemTrackingType"
--    (from item) is kept unchanged so Serial/Batch derivation on jobMaterial is
--    untouched.

ALTER TABLE "jobMaterial"
  ADD COLUMN IF NOT EXISTS "itemTrackingType" "itemTrackingType";

DROP FUNCTION IF EXISTS get_method_tree;
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
    "isRoot" BOOLEAN,
    "kit" BOOLEAN,
    "revision" TEXT,
    "externalId" JSONB,
    "version" NUMERIC,
    "storageUnitIds" JSONB,
    "isPickDescendant" BOOLEAN,
    "replenishmentSystem" "itemReplenishmentSystem",
    "materialTrackingType" "itemTrackingType"
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
        NULL AS "operationId",
        COALESCE("order", 1) AS "order",
        "kit",
        "storageUnitIds",
        "itemTrackingType" AS "materialTrackingType",
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
        child."itemTrackingType" AS "materialTrackingType",
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
  item."replenishmentSystem",
  material."materialTrackingType"
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
  item."replenishmentSystem",
  item."itemTrackingType" AS "materialTrackingType"
FROM "makeMethod" mm
INNER JOIN item
  ON mm."itemId" = item.id
INNER JOIN "itemCost" cost
  ON item.id = cost."itemId"
WHERE mm.id = uid
ORDER BY "order"
$$ LANGUAGE sql STABLE;
