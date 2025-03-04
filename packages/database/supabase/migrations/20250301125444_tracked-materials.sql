ALTER TABLE "jobMaterial" ADD COLUMN "requiresSerialTracking" BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE "jobMaterial" ADD COLUMN "requiresBatchTracking" BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE "jobMakeMethod" ADD COLUMN "trackedEntityId" TEXT;
ALTER TABLE "jobMakeMethod" ADD COLUMN "requiresSerialTracking" BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE "jobMakeMethod" ADD COLUMN "requiresBatchTracking" BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE "jobMakeMethod"
ADD FOREIGN KEY ("trackedEntityId") REFERENCES "trackedEntity"("id");

CREATE INDEX "jobMakeMethod_trackedEntityId_idx" ON "jobMakeMethod"("trackedEntityId");

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
        1::NUMERIC AS "quantity",
        0::NUMERIC AS "unitCost",
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
  item."itemTrackingType",
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
  item."itemTrackingType",
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
  item."itemTrackingType",
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

CREATE OR REPLACE FUNCTION insert_job_make_method()
RETURNS TRIGGER AS $$
DECLARE
  v_item_readable_id TEXT;
  v_item_tracking_type TEXT;
  v_tracked_entity_id TEXT;
BEGIN
  -- Get item details
  SELECT "readableId", "itemTrackingType" INTO v_item_readable_id, v_item_tracking_type
  FROM "item"
  WHERE "id" = NEW."itemId";
  
  -- Insert tracked entity
  INSERT INTO "trackedEntity" ("sourceDocument", "sourceDocumentId", "sourceDocumentReadableId", "quantity", "status", "companyId", "createdBy", "attributes")
  VALUES ('Item', NEW."itemId", v_item_readable_id, NEW."quantity", 'Reserved', NEW."companyId", NEW."createdBy", jsonb_build_object('Job', NEW."id"))
  RETURNING "id" INTO v_tracked_entity_id;
  
  -- Insert job make method with tracked entity ID
  INSERT INTO "jobMakeMethod" ("jobId", "itemId", "companyId", "createdBy", "trackedEntityId", 
                              "requiresSerialTracking", "requiresBatchTracking")
  VALUES (NEW."id", NEW."itemId", NEW."companyId", NEW."createdBy", v_tracked_entity_id,
          v_item_tracking_type = 'Serial', v_item_tracking_type = 'Batch');
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;


CREATE OR REPLACE FUNCTION insert_job_material_make_method()
RETURNS TRIGGER AS $$
DECLARE
  v_item_readable_id TEXT;
  v_item_tracking_type TEXT;
  v_tracked_entity_id TEXT;
BEGIN
  -- Get item details
  SELECT "readableId", "itemTrackingType" INTO v_item_readable_id, v_item_tracking_type
  FROM "item"
  WHERE "id" = NEW."itemId";
  
  -- Insert tracked entity
  INSERT INTO "trackedEntity" ("sourceDocument", "sourceDocumentId", "sourceDocumentReadableId", "quantity", "status", "companyId", "createdBy", "attributes")
  VALUES ('Item', NEW."itemId", v_item_readable_id, NEW."quantity", 'Reserved', NEW."companyId", NEW."createdBy", jsonb_build_object('Job', NEW."jobId"))
  RETURNING "id" INTO v_tracked_entity_id;
  
  -- Insert job make method with tracked entity ID
  INSERT INTO "jobMakeMethod" ("jobId", "parentMaterialId", "itemId", "companyId", "createdBy", 
                              "trackedEntityId", "requiresSerialTracking", "requiresBatchTracking")
  VALUES (NEW."jobId", NEW."id", NEW."itemId", NEW."companyId", NEW."createdBy", v_tracked_entity_id,
          v_item_tracking_type = 'Serial', v_item_tracking_type = 'Batch');
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION update_job_material_make_method_item_id()
  RETURNS TRIGGER AS $$
DECLARE
  v_item_readable_id TEXT;
  v_item_tracking_type TEXT;
  v_tracked_entity_id TEXT;
BEGIN
  -- Get item details
  SELECT "readableId", "itemTrackingType" INTO v_item_readable_id, v_item_tracking_type
  FROM "item"
  WHERE "id" = NEW."itemId";
  
  IF NOT EXISTS (
    SELECT 1 FROM "jobMakeMethod"
    WHERE "jobId" = NEW."jobId" AND "parentMaterialId" = NEW."id"
  ) THEN
    -- Insert tracked entity
    INSERT INTO "trackedEntity" ("sourceDocument", "sourceDocumentId", "sourceDocumentReadableId", "quantity", "status", "companyId", "createdBy", "attributes")
    VALUES ('Item', NEW."itemId", v_item_readable_id, NEW."quantity", 
    'Reserved', NEW."companyId", NEW."createdBy", jsonb_build_object('Job', NEW."jobId"))
    RETURNING "id" INTO v_tracked_entity_id;
    
    -- Insert job make method with tracked entity ID
    INSERT INTO "jobMakeMethod" ("jobId", "parentMaterialId", "itemId", "companyId", "createdBy", 
                                "trackedEntityId", "requiresSerialTracking", "requiresBatchTracking")
    VALUES (NEW."jobId", NEW."id", NEW."itemId", NEW."companyId", NEW."createdBy", v_tracked_entity_id,
            v_item_tracking_type = 'Serial', v_item_tracking_type = 'Batch');
  ELSE
    -- Insert tracked entity
    INSERT INTO "trackedEntity" ("sourceDocument", "sourceDocumentId", "sourceDocumentReadableId", "quantity", "status", "companyId", "createdBy", "attributes")
    VALUES ('Item', NEW."itemId", v_item_readable_id, NEW."quantity", 'Reserved', NEW."companyId", NEW."createdBy", jsonb_build_object('Job', NEW."jobId"))
    RETURNING "id" INTO v_tracked_entity_id;
    
    -- Update job make method with new item ID and tracked entity ID
    UPDATE "jobMakeMethod"
    SET "itemId" = NEW."itemId",
        "trackedEntityId" = v_tracked_entity_id,
        "requiresSerialTracking" = (v_item_tracking_type = 'Serial'),
        "requiresBatchTracking" = (v_item_tracking_type = 'Batch')
    WHERE "jobId" = NEW."jobId" AND "parentMaterialId" = NEW."id";
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
