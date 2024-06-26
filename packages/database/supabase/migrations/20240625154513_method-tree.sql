CREATE OR REPLACE FUNCTION get_method_tree(uid TEXT)
RETURNS TABLE (
    "methodMaterialId" TEXT,
    "makeMethodId" TEXT,
    "materialMakeMethodId" TEXT,  
    "itemId" TEXT,
    "itemReadableId" TEXT,
    "itemType" TEXT,
    "quantity" NUMERIC,
    "methodType" "methodType",
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
        "quantity" 
    FROM 
        "methodMaterial" 
    WHERE 
        "makeMethodId" = uid
    UNION 
    SELECT 
        children."id", 
        children."makeMethodId",
        children."methodType",
        children."materialMakeMethodId",
        children."itemId", 
        children."itemType",
        children."quantity" 
    FROM 
        "methodMaterial" children 
        INNER JOIN material b ON b."materialMakeMethodId" = children."makeMethodId"
) 
SELECT 
  material.id as "methodMaterialId", 
  material."makeMethodId",
  material."materialMakeMethodId",
  material."itemId",
  item."readableId" AS "itemReadableId",
  material."itemType",
  material."quantity",
  material."methodType",
  false AS "isRoot"
FROM material INNER JOIN item ON material."itemId" = item.id
UNION
SELECT
  mm."id" AS "methodMaterialId",
  NULL AS "makeMethodId",
  mm.id AS "materialMakeMethodId",
  mm."itemId",
  i."readableId" AS "itemReadableId",
  i."type"::text,
  1 AS "quantity",
  'Make' AS "methodType",
  true AS "isRoot"

FROM "makeMethod" mm INNER JOIN item i ON mm."itemId" = i.id
WHERE mm.id = uid
$$ LANGUAGE sql STABLE;