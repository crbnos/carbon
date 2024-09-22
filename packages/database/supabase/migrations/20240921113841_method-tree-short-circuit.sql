-- short circuit tree if it's not a make method:
CREATE OR REPLACE FUNCTION get_job_method(jid TEXT)
RETURNS TABLE (
    "jobId" TEXT,
    "methodMaterialId" TEXT,
    "jobMakeMethodId" TEXT,
    "jobMaterialMakeMethodId" TEXT,  
    "itemId" TEXT,
    "itemReadableId" TEXT,
    "itemType" TEXT,
    "quantity" NUMERIC,
    "unitCost" NUMERIC,
    "methodType" "methodType",
    "parentMaterialId" TEXT,
    "order" DOUBLE PRECISION,
    "isRoot" BOOLEAN
) AS $$
WITH RECURSIVE material AS (
    SELECT 
        "jobId",
        "id", 
        "id" AS "jobMakeMethodId",
        'Make'::"methodType" AS "methodType",
        "id" AS "jobMaterialMakeMethodId",
        "itemId", 
        'Part' AS "itemType",
        1::NUMERIC(10,4) AS "quantity",
        0::NUMERIC(10,4) AS "unitCost",
        "parentMaterialId",
        CAST(1 AS DOUBLE PRECISION) AS "order",
        TRUE AS "isRoot"
    FROM 
        "jobMakeMethod" 
    WHERE 
        "jobId" = jid
        AND "parentMaterialId" IS NULL
    UNION 
    SELECT 
        child."jobId",
        child."id", 
        child."jobMakeMethodId",
        child."methodType",
        child."jobMaterialMakeMethodId",
        child."itemId", 
        child."itemType",
        child."quantity",
        child."unitCost",
        parent."id" AS "parentMaterialId",
        child."order",
        FALSE AS "isRoot"
    FROM 
        "jobMaterialWithMakeMethodId" child 
        INNER JOIN material parent ON parent."jobMaterialMakeMethodId" = child."jobMakeMethodId"
    WHERE parent."methodType" = 'Make'
) 
SELECT 
  material."jobId",
  material.id as "methodMaterialId", 
  material."jobMakeMethodId",
  material."jobMaterialMakeMethodId",
  material."itemId",
  item."readableId" AS "itemReadableId",
  material."itemType",
  material."quantity",
  material."unitCost",
  material."methodType",
  material."parentMaterialId",
  material."order",
  material."isRoot"
FROM material 
INNER JOIN item ON material."itemId" = item.id
WHERE material."jobId" = jid
ORDER BY "order"
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION get_job_methods_by_method_id(mid TEXT)
RETURNS TABLE (
    "jobId" TEXT,
    "methodMaterialId" TEXT,
    "jobMakeMethodId" TEXT,
    "jobMaterialMakeMethodId" TEXT,  
    "itemId" TEXT,
    "itemReadableId" TEXT,
    "description" TEXT,
    "unitOfMeasureCode" TEXT,
    "itemType" TEXT,
    "quantity" NUMERIC,
    "unitCost" NUMERIC,
    "methodType" "methodType",
    "parentMaterialId" TEXT,
    "order" DOUBLE PRECISION,
    "isRoot" BOOLEAN
) AS $$
WITH RECURSIVE material AS (
    SELECT 
        "jobId",
        "id", 
        "id" AS "jobMakeMethodId",
        'Make'::"methodType" AS "methodType",
        "id" AS "jobMaterialMakeMethodId",
        "itemId", 
        'Part' AS "itemType",
        1::NUMERIC(10,4) AS "quantity",
        0::NUMERIC(10,4) AS "unitCost",
        "parentMaterialId",
        CAST(1 AS DOUBLE PRECISION) AS "order",
        TRUE AS "isRoot"
    FROM 
        "jobMakeMethod" 
    WHERE 
        "id" = mid
    UNION 
    SELECT 
        child."jobId",
        child."id", 
        child."jobMakeMethodId",
        child."methodType",
        child."jobMaterialMakeMethodId",
        child."itemId", 
        child."itemType",
        child."quantity",
        child."unitCost",
        parent."id" AS "parentMaterialId",
        child."order",
        FALSE AS "isRoot"
    FROM 
        "jobMaterialWithMakeMethodId" child 
        INNER JOIN material parent ON parent."jobMaterialMakeMethodId" = child."jobMakeMethodId"
    WHERE parent."methodType" = 'Make'
) 
SELECT 
  material."jobId",
  material.id as "methodMaterialId", 
  material."jobMakeMethodId",
  material."jobMaterialMakeMethodId",
  material."itemId",
  item."readableId" AS "itemReadableId",
  item."name" AS "description",
  item."unitOfMeasureCode",
  material."itemType",
  material."quantity",
  material."unitCost",
  material."methodType",
  material."parentMaterialId",
  material."order",
  material."isRoot"
FROM material 
INNER JOIN item ON material."itemId" = item.id
ORDER BY "order"
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION get_quote_methods(qid TEXT)
RETURNS TABLE (
    "quoteId" TEXT,
    "quoteLineId" TEXT,
    "methodMaterialId" TEXT,
    "quoteMakeMethodId" TEXT,
    "quoteMaterialMakeMethodId" TEXT,  
    "itemId" TEXT,
    "itemReadableId" TEXT,
    "itemType" TEXT,
    "quantity" NUMERIC,
    "unitCost" NUMERIC,
    "methodType" "methodType",
    "parentMaterialId" TEXT,
    "order" DOUBLE PRECISION,
    "isRoot" BOOLEAN
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
        1::NUMERIC(10,4) AS "quantity",
        0::NUMERIC(10,4) AS "unitCost",
        "parentMaterialId",
        CAST(1 AS DOUBLE PRECISION) AS "order",
        TRUE AS "isRoot"
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
        parent."id" AS "parentMaterialId",
        child."order",
        FALSE AS "isRoot"
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
  item."readableId" AS "itemReadableId",
  material."itemType",
  material."quantity",
  material."unitCost",
  material."methodType",
  material."parentMaterialId",
  material."order",
  material."isRoot"
FROM material 
INNER JOIN item ON material."itemId" = item.id
WHERE material."quoteId" = qid
ORDER BY "order"
$$ LANGUAGE sql STABLE;

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
    "quantity" NUMERIC,
    "unitCost" NUMERIC,
    "methodType" "methodType",
    "parentMaterialId" TEXT,
    "order" DOUBLE PRECISION,
    "isRoot" BOOLEAN
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
        1::NUMERIC(10,4) AS "quantity",
        0::NUMERIC(10,4) AS "unitCost",
        "parentMaterialId",
        CAST(1 AS DOUBLE PRECISION) AS "order",
        TRUE AS "isRoot"
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
        FALSE AS "isRoot"
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
  material."quantity",
  material."unitCost",
  material."methodType",
  material."parentMaterialId",
  material."order",
  material."isRoot"
FROM material 
INNER JOIN item ON material."itemId" = item.id
ORDER BY "order"
$$ LANGUAGE sql STABLE;