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
    "parentMaterialId" TEXT,
    "order" DOUBLE PRECISION,
    "operationId" TEXT,
    "isRoot" BOOLEAN
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
        COALESCE("order", 1) AS "order"
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
        child."order"
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
  material."parentMaterialId",
  material."order",
  material."operationId",
  false AS "isRoot"
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
  NULL AS "parentMaterialId",
  CAST(1 AS DOUBLE PRECISION) AS "order",
  NULL AS "operationId",
  true AS "isRoot"

FROM "makeMethod" mm 
INNER JOIN item 
  ON mm."itemId" = item.id
INNER JOIN "itemCost" cost
  ON item.id = cost."itemId"
WHERE mm.id = uid
ORDER BY "order"
$$ LANGUAGE sql STABLE;