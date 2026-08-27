-- 'manual' = typed by a person and never recalculated; 'system' = derived, and
-- re-derived on every quote method mutation.
--
-- Deliberately NOT backfilled, unlike the sibling quoteLinePrice."priceSource"
-- (20260714180443). The overwrite this fixes has run on every save, so existing
-- bought-to-order rows already hold the supplier price; marking them 'manual'
-- would freeze a supplier-derived number forever.

ALTER TABLE "quoteMaterial"
  ADD COLUMN "unitCostSource" TEXT NOT NULL DEFAULT 'system';

-- NOT VALID skips the full-table scan under the ACCESS EXCLUSIVE lock.
ALTER TABLE "quoteMaterial"
  ADD CONSTRAINT "quoteMaterial_unitCostSource_check"
  CHECK ("unitCostSource" IN ('system', 'manual')) NOT VALID;

ALTER TABLE "quoteMaterial"
  VALIDATE CONSTRAINT "quoteMaterial_unitCostSource_check";

-- The view is SELECT qm.*, but a view's column list is frozen at creation and
-- CREATE OR REPLACE may only append, so it has to be dropped and recreated.

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

-- Both readers change their RETURNS TABLE, which CREATE OR REPLACE cannot do.

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
    "version" NUMERIC,
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
    "version" NUMERIC,
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
