ALTER TABLE "jobMaterial" ADD COLUMN "requiresSerialTracking" BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE "jobMaterial" ADD COLUMN "requiresBatchTracking" BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE "jobMakeMethod" ADD COLUMN "trackedEntityId" TEXT;
ALTER TABLE "jobMakeMethod" ADD COLUMN "requiresSerialTracking" BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE "jobMakeMethod" ADD COLUMN "requiresBatchTracking" BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE "jobMakeMethod"
ADD FOREIGN KEY ("trackedEntityId") REFERENCES "trackedEntity"("id");

CREATE INDEX "jobMakeMethod_trackedEntityId_idx" ON "jobMakeMethod"("trackedEntityId");

ALTER TABLE "trackedActivityInput" DROP COLUMN "entityType";

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
  v_job_make_method_id TEXT;
BEGIN
  -- Get item details
  SELECT "readableId", "itemTrackingType" INTO v_item_readable_id, v_item_tracking_type
  FROM "item"
  WHERE "id" = NEW."itemId";
  
  -- Insert job make method first
  INSERT INTO "jobMakeMethod" ("jobId", "itemId", "companyId", "createdBy", 
                              "requiresSerialTracking", "requiresBatchTracking")
  VALUES (NEW."id", NEW."itemId", NEW."companyId", NEW."createdBy",
          v_item_tracking_type = 'Serial', v_item_tracking_type = 'Batch')
  RETURNING "id" INTO v_job_make_method_id;
  
  -- Insert tracked entity with job make method ID in attributes
  INSERT INTO "trackedEntity" ("sourceDocument", "sourceDocumentId", "sourceDocumentReadableId", 
                              "quantity", "status", "companyId", "createdBy", 
                              "attributes")
  VALUES ('Item', NEW."itemId", v_item_readable_id, NEW."quantity", 'Reserved', 
          NEW."companyId", NEW."createdBy", 
          jsonb_build_object('Job', NEW."id", 'Job Make Method', v_job_make_method_id));
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;


CREATE OR REPLACE FUNCTION insert_job_material_make_method()
RETURNS TRIGGER AS $$
DECLARE
  v_item_readable_id TEXT;
  v_item_tracking_type TEXT;
  v_job_make_method_id TEXT;
BEGIN
  -- Get item details
  SELECT "readableId", "itemTrackingType" INTO v_item_readable_id, v_item_tracking_type
  FROM "item"
  WHERE "id" = NEW."itemId";
  
  -- Insert job make method first
  INSERT INTO "jobMakeMethod" ("jobId", "parentMaterialId", "itemId", "companyId", "createdBy", 
                              "requiresSerialTracking", "requiresBatchTracking")
  VALUES (NEW."jobId", NEW."id", NEW."itemId", NEW."companyId", NEW."createdBy",
          v_item_tracking_type = 'Serial', v_item_tracking_type = 'Batch')
  RETURNING "id" INTO v_job_make_method_id;
  
  -- Insert tracked entity with job make method ID in attributes
  INSERT INTO "trackedEntity" ("sourceDocument", "sourceDocumentId", "sourceDocumentReadableId", 
                              "quantity", "status", "companyId", "createdBy", 
                              "attributes")
  VALUES ('Item', NEW."itemId", v_item_readable_id, NEW."quantity", 'Reserved', 
          NEW."companyId", NEW."createdBy", 
          jsonb_build_object('Job', NEW."jobId", 'Job Make Method', v_job_make_method_id, 'Job Material', NEW."id"));
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION update_job_material_make_method_item_id()
  RETURNS TRIGGER AS $$
DECLARE
  v_item_readable_id TEXT;
  v_item_tracking_type TEXT;
  v_job_make_method_id TEXT;
BEGIN
  -- Get item details
  SELECT "readableId", "itemTrackingType" INTO v_item_readable_id, v_item_tracking_type
  FROM "item"
  WHERE "id" = NEW."itemId";
  
  IF NOT EXISTS (
    SELECT 1 FROM "jobMakeMethod"
    WHERE "jobId" = NEW."jobId" AND "parentMaterialId" = NEW."id"
  ) THEN
    -- Insert job make method first
    INSERT INTO "jobMakeMethod" ("jobId", "parentMaterialId", "itemId", "companyId", "createdBy", 
                                "requiresSerialTracking", "requiresBatchTracking")
    VALUES (NEW."jobId", NEW."id", NEW."itemId", NEW."companyId", NEW."createdBy",
            v_item_tracking_type = 'Serial', v_item_tracking_type = 'Batch')
    RETURNING "id" INTO v_job_make_method_id;
    
    -- Insert tracked entity with job make method ID in attributes
    INSERT INTO "trackedEntity" ("sourceDocument", "sourceDocumentId", "sourceDocumentReadableId", 
                                "quantity", "status", "companyId", "createdBy", 
                                "attributes")
    VALUES ('Item', NEW."itemId", v_item_readable_id, NEW."quantity", 'Reserved', 
            NEW."companyId", NEW."createdBy", 
            jsonb_build_object('Job', NEW."jobId", 'Job Make Method', v_job_make_method_id, 'Job Material', NEW."id"));
  ELSE
    -- Update job make method first
    UPDATE "jobMakeMethod"
    SET "itemId" = NEW."itemId",
        "requiresSerialTracking" = (v_item_tracking_type = 'Serial'),
        "requiresBatchTracking" = (v_item_tracking_type = 'Batch')
    WHERE "jobId" = NEW."jobId" AND "parentMaterialId" = NEW."id"
    RETURNING "id" INTO v_job_make_method_id;
    
    -- Insert tracked entity with job make method ID in attributes
    INSERT INTO "trackedEntity" ("sourceDocument", "sourceDocumentId", "sourceDocumentReadableId", 
                                "quantity", "status", "companyId", "createdBy", 
                                "attributes")
    VALUES ('Item', NEW."itemId", v_item_readable_id, NEW."quantity", 'Reserved', 
            NEW."companyId", NEW."createdBy", 
            jsonb_build_object('Job', NEW."jobId", 'Job Make Method', v_job_make_method_id, 'Job Material', NEW."id"));
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;


CREATE OR REPLACE FUNCTION update_tracked_entity_on_job_make_method_update()
RETURNS TRIGGER AS $$
BEGIN
  -- Update tracked entities that reference this job make method ID in attributes
  -- Only update the 'Job Make Method' attribute while preserving all other attributes
  UPDATE "trackedEntity"
  SET "attributes" = jsonb_set(
    "attributes", 
    '{Job Make Method}', 
    to_jsonb(NEW."id")
  )
  WHERE "attributes"->>'Job Make Method' = OLD."id";
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_tracked_entity_on_job_make_method_update_trigger
AFTER UPDATE OF "id" ON "jobMakeMethod"
FOR EACH ROW
WHEN (OLD."id" IS DISTINCT FROM NEW."id")
EXECUTE FUNCTION update_tracked_entity_on_job_make_method_update();



CREATE OR REPLACE FUNCTION delete_tracked_entity_on_job_make_method_delete()
RETURNS TRIGGER AS $$
BEGIN
  -- Find and delete tracked entities with this job make method ID in attributes
  DELETE FROM "trackedEntity" 
  WHERE "attributes"->>'Job Make Method' = OLD."id";
  
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER delete_tracked_entity_on_job_make_method_delete_trigger
BEFORE DELETE ON "jobMakeMethod"
FOR EACH ROW
EXECUTE FUNCTION delete_tracked_entity_on_job_make_method_delete();


DROP FUNCTION IF EXISTS get_direct_descendants_of_tracked_entity;
CREATE OR REPLACE FUNCTION get_direct_descendants_of_tracked_entity(p_tracked_entity_id TEXT)
RETURNS TABLE (
    "trackedActivityId" TEXT,
    "id" TEXT,
    "quantity" NUMERIC,
    "status" "trackedEntityStatus",
    "sourceDocument" TEXT,
    "sourceDocumentId" TEXT,
    "sourceDocumentReadableId" TEXT,
    "activityAttributes" JSONB,
    "attributes" JSONB
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        ta."id" AS "trackedActivityId",
        te."id", 
        te."quantity", 
        te."status", 
        te."sourceDocument",
        te."sourceDocumentId",
        te."sourceDocumentReadableId",
        ta."attributes" AS "activityAttributes", 
        te."attributes" AS "attributes"
    FROM "trackedActivityInput" ai
    INNER JOIN "trackedEntity" te 
        ON ai."trackedEntityId" = te."id"
    INNER JOIN "trackedActivity" ta
        ON ai."trackedActivityId" = ta."id"
    JOIN "trackedActivityOutput" ao 
        ON ai."trackedActivityId" = ao."trackedActivityId"
    WHERE ao."trackedEntityId" = p_tracked_entity_id;
END;
$$ LANGUAGE plpgsql;

-- Function to get direct descendants with strict filtering
DROP FUNCTION IF EXISTS get_direct_descendants_of_tracked_entity_strict;
CREATE OR REPLACE FUNCTION get_direct_descendants_of_tracked_entity_strict(p_tracked_entity_id TEXT)
RETURNS TABLE (
    "trackedActivityId" TEXT,
    "id" TEXT,
    "quantity" NUMERIC,
    "status" "trackedEntityStatus",
    "sourceDocument" TEXT,
    "sourceDocumentId" TEXT,
    "sourceDocumentReadableId" TEXT,
    "activityAttributes" JSONB,
    "attributes" JSONB
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        ta."id" AS "trackedActivityId",
        te."id", 
        te."quantity", 
        te."status", 
        te."sourceDocument",
        te."sourceDocumentId",
        te."sourceDocumentReadableId",
        ta."attributes" AS "activityAttributes",
        te."attributes" AS "attributes"
    FROM "trackedActivityInput" tai
    INNER JOIN "trackedEntity" te 
        ON tai."trackedEntityId" = te."id"
    INNER JOIN "trackedActivity" ta
        ON tai."trackedActivityId" = ta."id"
    WHERE tai."trackedActivityId" IN (
        SELECT tao."trackedActivityId"
        FROM "trackedActivityOutput" tao
        LEFT JOIN "trackedActivityInput" tai2 
            ON tao."trackedActivityId" = tai2."trackedActivityId" 
            AND tai2."trackedEntityId" = p_tracked_entity_id
        WHERE tao."trackedEntityId" = p_tracked_entity_id 
            AND tai2."trackedEntityId" IS NULL
    );
END;
$$ LANGUAGE plpgsql;

-- Function to get direct ancestors of tracked entity
DROP FUNCTION IF EXISTS get_direct_ancestors_of_tracked_entity;
CREATE OR REPLACE FUNCTION get_direct_ancestors_of_tracked_entity(p_tracked_entity_id TEXT)
RETURNS TABLE (
    "trackedActivityId" TEXT,
    "id" TEXT,
    "quantity" NUMERIC,
    "status" "trackedEntityStatus",
    "sourceDocument" TEXT,
    "sourceDocumentId" TEXT,
    "sourceDocumentReadableId" TEXT,
    "activityAttributes" JSONB,
    "attributes" JSONB
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        ta."id" AS "trackedActivityId",
        te."id", 
        te."quantity", 
        te."status", 
        te."sourceDocument",
        te."sourceDocumentId",
        te."sourceDocumentReadableId",
        ta."attributes" AS "activityAttributes", 
        te."attributes" AS "attributes"
    FROM "trackedActivityOutput" ao
    INNER JOIN "trackedEntity" te 
        ON ao."trackedEntityId" = te."id"
    INNER JOIN "trackedActivity" ta
        ON ao."trackedActivityId" = ta."id"
    JOIN "trackedActivityInput" ai 
        ON ao."trackedActivityId" = ai."trackedActivityId"
    WHERE ai."trackedEntityId" = p_tracked_entity_id;
END;
$$ LANGUAGE plpgsql;

-- Function to get direct ancestors with strict filtering
DROP FUNCTION IF EXISTS get_direct_ancestors_of_tracked_entity_strict;
CREATE OR REPLACE FUNCTION get_direct_ancestors_of_tracked_entity_strict(p_tracked_entity_id TEXT)
RETURNS TABLE (
    "trackedActivityId" TEXT,
    "id" TEXT,
    "quantity" NUMERIC,
    "status" "trackedEntityStatus",
    "sourceDocument" TEXT,
    "sourceDocumentId" TEXT,
    "sourceDocumentReadableId" TEXT,
    "activityAttributes" JSONB,
    "attributes" JSONB
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        ta."id" AS "trackedActivityId",
        te."id", 
        te."quantity", 
        te."status", 
        te."sourceDocument",
        te."sourceDocumentId",
        te."sourceDocumentReadableId",
        ta."attributes" AS "activityAttributes",
        te."attributes" AS "attributes"
    FROM "trackedActivityOutput" tao
    INNER JOIN "trackedEntity" te 
        ON tao."trackedEntityId" = te."id"
    INNER JOIN "trackedActivity" ta
        ON tao."trackedActivityId" = ta."id"
    WHERE tao."trackedActivityId" IN (
        SELECT tai."trackedActivityId"
        FROM "trackedActivityInput" tai
        LEFT JOIN "trackedActivityOutput" tao2 
            ON tai."trackedActivityId" = tao2."trackedActivityId" 
            AND tao2."trackedEntityId" = p_tracked_entity_id
        WHERE tai."trackedEntityId" = p_tracked_entity_id 
            AND tao2."trackedEntityId" IS NULL
    );
END;
$$ LANGUAGE plpgsql;

CREATE INDEX "idx_trackedEntity_sourceDocumentReadableId" ON "trackedEntity"("sourceDocumentReadableId");
CREATE INDEX "idx_trackedEntity_status" ON "trackedEntity"("status");