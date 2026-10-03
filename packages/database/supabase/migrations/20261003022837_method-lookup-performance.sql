-- Lookups that get-method, MRP and the item pages run constantly, measured on
-- production (pg_stat_statements) on 2026-10-03.

-- 1. activeMakeMethods ranked every company's make methods on any query that
--    filtered by companyId (49 ms, 18k rows ranked to return 5k): a filter can
--    only be pushed below the window when it is on a PARTITION BY column, and
--    that was "itemId" alone. MRP pages through it by companyId on every run.
--    An item belongs to one company, so partitioning by ("companyId", "itemId")
--    ranks exactly the same rows while letting either filter through. The
--    column list is spelled out: the view was created from "makeMethod".*,
--    which has since gained columns, and a replace may not reorder them.
CREATE INDEX IF NOT EXISTS "makeMethod_companyId_itemId_idx"
  ON "makeMethod" ("companyId", "itemId");

CREATE OR REPLACE VIEW "activeMakeMethods"
WITH (security_invoker = true)
AS
WITH ranked_make_methods AS (
  SELECT
    "id",
    "itemId",
    "companyId",
    "createdAt",
    "createdBy",
    "updatedAt",
    "updatedBy",
    "customFields",
    "tags",
    "version",
    "status",
    ROW_NUMBER() OVER (
      PARTITION BY "companyId", "itemId"
      ORDER BY
        CASE WHEN "status" = 'Active' THEN 1 ELSE 2 END,
        "version" DESC
    ) AS rn
  FROM "makeMethod"
  WHERE "status" != 'Archived'
)
SELECT * FROM ranked_make_methods WHERE rn = 1;

-- 2. get_method_tree: the planner cannot size a recursive CTE (it expected
--    95k rows for a 153-row tree), so it joined each level against every
--    methodMaterial row and hashed every tenant's item, itemCost and
--    makeMethod rows to annotate the result: 117 ms for the largest BOM.
--    Each lookup is now a correlated subquery on an index (OFFSET 0 keeps the
--    planner from flattening it back into that join): 12 ms, same rows
--    (compared on production for the 11 largest and a sample of nested BOMs).

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
        material parent
        CROSS JOIN LATERAL (
            SELECT * FROM "methodMaterial" c
            WHERE c."makeMethodId" = parent."materialMakeMethodId"
            OFFSET 0
        ) child
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
  item."unitCost",
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
CROSS JOIN LATERAL (
  SELECT item.id, item."readableIdWithRevision", item."name", item."unitOfMeasureCode",
    item."itemTrackingType", item."revision", item."replenishmentSystem", cost."unitCost"
  FROM item
  INNER JOIN "itemCost" cost ON item.id = cost."itemId"
  WHERE item.id = material."itemId"
  OFFSET 0
) item
CROSS JOIN LATERAL (
  SELECT mm.id FROM "makeMethod" mm WHERE mm.id = material."makeMethodId" OFFSET 0
) mm
LEFT JOIN LATERAL (
  SELECT mm2."version" FROM "makeMethod" mm2 WHERE mm2.id = material."materialMakeMethodId" OFFSET 0
) mm2 ON true
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


-- 3. Where-used lookups by item (230k-370k calls each, every one a scan of the
--    company's rows; jobMaterial took 10 ms for the largest company).
CREATE INDEX IF NOT EXISTS "jobMaterial_itemId_idx" ON "jobMaterial" ("itemId");
CREATE INDEX IF NOT EXISTS "methodMaterial_itemId_idx" ON "methodMaterial" ("itemId");
CREATE INDEX IF NOT EXISTS "quoteMaterial_itemId_idx" ON "quoteMaterial" ("itemId");
CREATE INDEX IF NOT EXISTS "purchaseOrderLine_itemId_idx" ON "purchaseOrderLine" ("itemId");
CREATE INDEX IF NOT EXISTS "receiptLine_itemId_idx" ON "receiptLine" ("itemId");
CREATE INDEX IF NOT EXISTS "shipmentLine_itemId_idx" ON "shipmentLine" ("itemId");

-- 4. Foreign keys checked on every delete of the row they point at. get-method
--    replaces a job's operations and a method's operations wholesale, and each
--    deleted row scanned these tables in full for references.
CREATE INDEX IF NOT EXISTS "methodMaterial_methodOperationId_idx" ON "methodMaterial" ("methodOperationId");
CREATE INDEX IF NOT EXISTS "methodMaterial_materialMakeMethodId_idx" ON "methodMaterial" ("materialMakeMethodId");
CREATE INDEX IF NOT EXISTS "purchaseOrderLine_jobOperationId_idx" ON "purchaseOrderLine" ("jobOperationId");
CREATE INDEX IF NOT EXISTS "purchaseOrderLine_jobId_idx" ON "purchaseOrderLine" ("jobId");
CREATE INDEX IF NOT EXISTS "purchaseInvoiceLine_jobOperationId_idx" ON "purchaseInvoiceLine" ("jobOperationId");

-- 5. Every jobOperationDependency insert set the operation's status twice.
--    20260410031811 moved set_initial_dependency_status onto the event system
--    as sync_set_initial_dependency_status but dropped the old trigger by the
--    wrong name (set_initial_dependency_status_trigger), so the original
--    set_initial_status_on_dependency kept firing too: the same check and the
--    same jobOperation UPDATE, with its whole trigger chain, a second time.
DROP TRIGGER IF EXISTS set_initial_status_on_dependency ON "jobOperationDependency";
DROP FUNCTION IF EXISTS set_initial_dependency_status();
