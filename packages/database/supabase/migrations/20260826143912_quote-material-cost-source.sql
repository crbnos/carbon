-- Record whether a quote BOM material's unit cost was typed by a person or
-- worked out by Carbon.
--
-- 'system' = Carbon derived it (average item cost, or supplier price breaks).
--            Recalculations keep re-deriving it, which is what keeps a quote
--            tracking supplier prices.
-- 'manual' = a person typed it in the BOM editor. No recalculation may change it.
--
-- Without this, `buildCostEffects` (and its twins in the quote configurator and
-- the edge runtime) re-derived every "Purchase to Order" material's cost from
-- supplierPart price breaks on EVERY quote method mutation, so a hand-entered
-- cost was written and then immediately overwritten in the same request. It only
-- reproduced where the item had a supplierPart row, which is why dev never saw it.
--
-- Deliberately NOT backfilled, and this is the opposite call the sibling
-- quoteLinePrice."priceSource" migration (20260714180443) made. There, freezing
-- an un-overwritten customer-facing price was the safe default. Here the
-- overwrite has been running on every save, so every existing bought-to-order
-- row ALREADY holds the supplier price -- anything typed was destroyed long ago.
-- Marking those 'manual' would freeze a supplier-derived number and stop it
-- updating forever. Materials that are not "Purchase to Order" were never
-- touched by the loop, so the column is inert for them.

ALTER TABLE "quoteMaterial"
  ADD COLUMN "unitCostSource" TEXT NOT NULL DEFAULT 'system';

-- NOT VALID skips the full-table scan under the ACCESS EXCLUSIVE lock; the
-- constraint is validated separately under a weaker lock.
ALTER TABLE "quoteMaterial"
  ADD CONSTRAINT "quoteMaterial_unitCostSource_check"
  CHECK ("unitCostSource" IN ('system', 'manual')) NOT VALID;

ALTER TABLE "quoteMaterial"
  VALIDATE CONSTRAINT "quoteMaterial_unitCostSource_check";

-- "quoteMaterialWithMakeMethodId" is SELECT qm.*, but a view's column list is
-- frozen when it is created -- the new column does not appear until the view is
-- recreated. CREATE OR REPLACE cannot do it either (the column lands mid-list,
-- and OR REPLACE may only append), so drop and recreate. Nothing else depends
-- on the view: the two functions below are string-bodied SQL, and app reads go
-- through PostgREST.

DROP VIEW "quoteMaterialWithMakeMethodId";

-- Source: 20260417000300_storage-unit-recreate-dependents.sql (latest body)
CREATE VIEW "quoteMaterialWithMakeMethodId" WITH(SECURITY_INVOKER=true) AS
  SELECT
    qm.*,
    qmm."id" AS "quoteMaterialMakeMethodId",
    qmm.version AS "version"
  FROM "quoteMaterial" qm
  LEFT JOIN "quoteMakeMethod" qmm
    ON qmm."parentMaterialId" = qm."id";

-- The two method-tree readers have to carry the new column or the browser's cost
-- panel, which does its own supplier-price lookup, would keep ignoring a typed
-- cost even though the database now keeps it. Both change their RETURNS TABLE,
-- so they must be dropped first -- CREATE OR REPLACE cannot change a return type.

DROP FUNCTION IF EXISTS get_quote_methods_by_method_id(TEXT);
DROP FUNCTION IF EXISTS get_quote_methods(TEXT);

-- Source: 20260417000300_storage-unit-recreate-dependents.sql (latest body)
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
    "unitCostSource" TEXT,
    "methodType" "methodType",
    "parentMaterialId" TEXT,
    "order" DOUBLE PRECISION,
    "isRoot" BOOLEAN,
    "kit" BOOLEAN,
    "revision" TEXT,
    "externalId" JSONB,
    "version" NUMERIC(10,2),
    "storageUnitId" TEXT
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
        'system'::TEXT AS "unitCostSource",
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
        child."unitCostSource",
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
  material."unitCostSource",
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
  material."storageUnitId"
FROM material
INNER JOIN item ON material."itemId" = item.id
ORDER BY "order"
$$ LANGUAGE sql STABLE;


-- Source: 20260417000300_storage-unit-recreate-dependents.sql (latest body)
CREATE OR REPLACE FUNCTION get_quote_methods(qid TEXT)
RETURNS TABLE (
    "quoteId" TEXT,
    "quoteLineId" TEXT,
    "methodMaterialId" TEXT,
    "quoteMakeMethodId" TEXT,
    "quoteMaterialMakeMethodId" TEXT,
    "itemId" TEXT,
    "itemReadableId" TEXT,
    "description" TEXT,
    "itemType" TEXT,
    "quantity" NUMERIC,
    "unitCost" NUMERIC,
    "unitCostSource" TEXT,
    "methodType" "methodType",
    "parentMaterialId" TEXT,
    "order" DOUBLE PRECISION,
    "isRoot" BOOLEAN,
    "kit" BOOLEAN,
    "revision" TEXT,
    "externalId" JSONB,
    "version" NUMERIC(10,2),
    "storageUnitId" TEXT
) AS $$
WITH RECURSIVE material AS (
    SELECT
        "quoteId",
        "quoteLineId",
        "id",
        "id" AS "quoteMakeMethodId",
        'Make to Order'::"methodType" AS "methodType",
        "id" AS "quoteMaterialMakeMethodId",
        "itemId",
        'Part' AS "itemType",
        1::NUMERIC AS "quantity",
        0::NUMERIC AS "unitCost",
        'system'::TEXT AS "unitCostSource",
        "parentMaterialId",
        CAST(1 AS DOUBLE PRECISION) AS "order",
        TRUE AS "isRoot",
        FALSE AS "kit",
        "version",
        NULL::TEXT AS "storageUnitId"
    FROM
        "quoteMakeMethod"
    WHERE
        "quoteId" = qid
        AND "parentMaterialId" IS NULL
    UNION
    SELECT
        child."quoteId",
        child."quoteLineId",
        child."id",
        child."quoteMakeMethodId",
        child."methodType",
        child."quoteMaterialMakeMethodId",
        child."itemId",
        child."itemType",
        child."quantity",
        child."unitCost",
        child."unitCostSource",
        parent."id" AS "parentMaterialId",
        child."order",
        FALSE AS "isRoot",
        child."kit",
        child."version",
        child."storageUnitId"
    FROM
        "quoteMaterialWithMakeMethodId" child
        INNER JOIN material parent ON parent."quoteMaterialMakeMethodId" = child."quoteMakeMethodId"
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
  material."itemType",
  material."quantity",
  material."unitCost",
  material."unitCostSource",
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
  material."storageUnitId"
FROM material
INNER JOIN item ON material."itemId" = item.id
WHERE material."quoteId" = qid
ORDER BY "order"
$$ LANGUAGE sql STABLE;
