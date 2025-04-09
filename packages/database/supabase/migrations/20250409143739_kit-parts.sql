DROP VIEW IF EXISTS "quoteMaterialWithMakeMethodId";
DROP VIEW IF EXISTS "jobMaterialWithMakeMethodId";


ALTER TABLE "jobMaterial" ADD COLUMN "kit" BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE "methodMaterial" ADD COLUMN "kit" BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE "quoteMaterial" ADD COLUMN "kit" BOOLEAN NOT NULL DEFAULT FALSE;

CREATE OR REPLACE VIEW "quoteMaterialWithMakeMethodId" WITH(SECURITY_INVOKER=true) AS
  SELECT 
    qm.*, 
    qmm."id" AS "quoteMaterialMakeMethodId" 
  FROM "quoteMaterial" qm 
  LEFT JOIN "quoteMakeMethod" qmm 
    ON qmm."parentMaterialId" = qm."id";

CREATE OR REPLACE VIEW "jobMaterialWithMakeMethodId" WITH(SECURITY_INVOKER=true) AS
  SELECT 
    jm.*, 
    jmm."id" AS "jobMaterialMakeMethodId" 
  FROM "jobMaterial" jm 
  LEFT JOIN "jobMakeMethod" jmm 
    ON jmm."parentMaterialId" = jm."id";


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
    "kit" BOOLEAN
) AS $$
WITH RECURSIVE material AS (
    SELECT 
        "quoteId",
        "quoteLineId",
        "id", 
        "id" AS "quoteMakeMethodId",
        'Make'::"methodType" AS "methodType",
        "id" AS "quoteMaterialMakeMethodId",
        "itemId", 
        'Part' AS "itemType",
        1::NUMERIC AS "quantity",
        0::NUMERIC AS "unitCost",
        "parentMaterialId",
        CAST(1 AS DOUBLE PRECISION) AS "order",
        TRUE AS "isRoot",
        FALSE AS "kit"
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
        child."itemId", 
        child."itemType",
        child."quantity",
        child."unitCost",
        parent."id" AS "parentMaterialId",
        child."order",
        FALSE AS "isRoot",
        child."kit"
    FROM 
        "quoteMaterialWithMakeMethodId" child 
        INNER JOIN material parent ON parent."quoteMaterialMakeMethodId" = child."quoteMakeMethodId"
    WHERE parent."methodType" = 'Make'
) 
SELECT 
  material."quoteId",
  material."quoteLineId",
  material.id as "methodMaterialId", 
  material."quoteMakeMethodId",
  material."quoteMaterialMakeMethodId",
  material."itemId",
  item."readableId" AS "itemReadableId",
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
  material."kit"
FROM material 
INNER JOIN item ON material."itemId" = item.id
ORDER BY "order"
$$ LANGUAGE sql STABLE;


DROP FUNCTION get_method_tree;
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
    "kit" BOOLEAN
) AS $$
WITH RECURSIVE material AS (
    SELECT 
        "id", 
        "makeMethodId",
        "methodType",
        "materialMakeMethodId",
        "itemId", 
        "itemType",
        "quantity",
        "makeMethodId" AS "parentMaterialId",
        NULL AS "operationId",
        COALESCE("order", 1) AS "order",
        "kit"
    FROM 
        "methodMaterial" 
    WHERE 
        "makeMethodId" = uid
    UNION 
    SELECT 
        child."id", 
        child."makeMethodId",
        child."methodType",
        child."materialMakeMethodId",
        child."itemId", 
        child."itemType",
        child."quantity",
        parent."id" AS "parentMaterialId",
        child."methodOperationId" AS "operationId",
        child."order",
        child."kit"
    FROM 
        "methodMaterial" child 
        INNER JOIN material parent ON parent."materialMakeMethodId" = child."makeMethodId"
) 
SELECT 
  material.id as "methodMaterialId", 
  material."makeMethodId",
  material."materialMakeMethodId",
  material."itemId",
  item."readableId" AS "itemReadableId",
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
  material."kit"
FROM material 
INNER JOIN item 
  ON material."itemId" = item.id
INNER JOIN "itemCost" cost
  ON item.id = cost."itemId"
UNION
SELECT
  mm."id" AS "methodMaterialId",
  NULL AS "makeMethodId",
  mm.id AS "materialMakeMethodId",
  mm."itemId",
  item."readableId" AS "itemReadableId",
  item."type"::text,
  item."name" AS "description",
  item."unitOfMeasureCode",
  cost."unitCost",
  1 AS "quantity",
  'Make' AS "methodType",
  item."itemTrackingType",
  NULL AS "parentMaterialId",
  CAST(1 AS DOUBLE PRECISION) AS "order",
  NULL AS "operationId",
  true AS "isRoot",
  false AS "kit"
FROM "makeMethod" mm 
INNER JOIN item 
  ON mm."itemId" = item.id
INNER JOIN "itemCost" cost
  ON item.id = cost."itemId"
WHERE mm.id = uid
ORDER BY "order"
$$ LANGUAGE sql STABLE;
