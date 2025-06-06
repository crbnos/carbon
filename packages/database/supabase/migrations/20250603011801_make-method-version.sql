CREATE TYPE "makeMethodStatus" AS ENUM ('Draft', 'Active', 'Archived');

ALTER TABLE "makeMethod" DROP CONSTRAINT "makeMethod_unique_itemId";
ALTER TABLE "makeMethod" ADD COLUMN "version" NUMERIC(10, 2) NOT NULL DEFAULT 1;
ALTER TABLE "makeMethod" ADD COLUMN "status" "makeMethodStatus" NOT NULL DEFAULT 'Draft';
ALTER TABLE "makeMethod" ADD CONSTRAINT "makeMethod_unique_itemId_version" UNIQUE ("itemId", "version");

CREATE OR REPLACE VIEW "activeMakeMethods" AS
WITH ranked_make_methods AS (
  SELECT 
    *,
    ROW_NUMBER() OVER (PARTITION BY "itemId" ORDER BY 
      CASE 
        WHEN "status" = 'Active' THEN 1
        ELSE 2
      END,
      "version" DESC
    ) as rn
  FROM "makeMethod"
  WHERE "status" != 'Archived'
)
SELECT * FROM ranked_make_methods WHERE rn = 1;


ALTER TABLE "quoteMakeMethod" ADD COLUMN "version" NUMERIC(10, 2) NOT NULL DEFAULT 1;
ALTER TABLE "jobMakeMethod" ADD COLUMN "version" NUMERIC(10, 2) NOT NULL DEFAULT 1;


CREATE OR REPLACE FUNCTION insert_job_make_method()
RETURNS TRIGGER AS $$
DECLARE
  v_item_readable_id TEXT;
  v_item_tracking_type TEXT;
  v_job_make_method_id TEXT;
  v_version NUMERIC(10, 2);
BEGIN
  -- Get item details
  SELECT "readableId", "itemTrackingType" INTO v_item_readable_id, v_item_tracking_type
  FROM "item"
  WHERE "id" = NEW."itemId";

  SELECT "version" INTO v_version FROM "activeMakeMethods" WHERE "itemId" = NEW."itemId";
  
  -- Insert job make method first
  INSERT INTO "jobMakeMethod" ("jobId", "itemId", "companyId", "createdBy", 
                              "requiresSerialTracking", "requiresBatchTracking", "version")
  VALUES (NEW."id", NEW."itemId", NEW."companyId", NEW."createdBy",
          v_item_tracking_type = 'Serial', v_item_tracking_type = 'Batch', v_version)
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
  v_version NUMERIC(10, 2);
BEGIN
  -- Get item details
  SELECT "readableIdWithRevision", "itemTrackingType" INTO v_item_readable_id, v_item_tracking_type
  FROM "item"
  WHERE "id" = NEW."itemId";

  SELECT "version" INTO v_version FROM "activeMakeMethods" WHERE "itemId" = NEW."itemId";
  
  -- Insert job make method first
  INSERT INTO "jobMakeMethod" ("jobId", "parentMaterialId", "itemId", "companyId", "createdBy", 
                              "requiresSerialTracking", "requiresBatchTracking", "version")
  VALUES (NEW."jobId", NEW."id", NEW."itemId", NEW."companyId", NEW."createdBy",
          v_item_tracking_type = 'Serial', v_item_tracking_type = 'Batch', v_version)
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
  v_version NUMERIC(10, 2);
BEGIN
  -- Get item details
  SELECT "readableIdWithRevision", "itemTrackingType" INTO v_item_readable_id, v_item_tracking_type
  FROM "item"
  WHERE "id" = NEW."itemId";
  
  SELECT "version" INTO v_version FROM "activeMakeMethods" WHERE "itemId" = NEW."itemId";
  IF NOT EXISTS (
    SELECT 1 FROM "jobMakeMethod"
    WHERE "jobId" = NEW."jobId" AND "parentMaterialId" = NEW."id"
  ) THEN
    -- Insert job make method first
    INSERT INTO "jobMakeMethod" ("jobId", "parentMaterialId", "itemId", "companyId", "createdBy", 
                                "requiresSerialTracking", "requiresBatchTracking", "version")
    VALUES (NEW."jobId", NEW."id", NEW."itemId", NEW."companyId", NEW."createdBy",
            v_item_tracking_type = 'Serial', v_item_tracking_type = 'Batch', v_version)
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
        "requiresBatchTracking" = (v_item_tracking_type = 'Batch'),
        "version" = v_version
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


DROP VIEW IF EXISTS "quoteMaterialWithMakeMethodId";
CREATE OR REPLACE VIEW "quoteMaterialWithMakeMethodId" WITH(SECURITY_INVOKER=true) AS
  SELECT 
    qm.*, 
    qmm."id" AS "quoteMaterialMakeMethodId",
    qmm.version AS "version"
  FROM "quoteMaterial" qm 
  LEFT JOIN "quoteMakeMethod" qmm 
    ON qmm."parentMaterialId" = qm."id";

DROP VIEW IF EXISTS "jobMaterialWithMakeMethodId";
CREATE OR REPLACE VIEW "jobMaterialWithMakeMethodId" WITH(SECURITY_INVOKER=true) AS
  SELECT 
    jm.*, 
    jmm."id" AS "jobMaterialMakeMethodId",
    jmm.version AS "version"
  FROM "jobMaterial" jm 
  LEFT JOIN "jobMakeMethod" jmm 
    ON jmm."parentMaterialId" = jm."id";

CREATE OR REPLACE VIEW "jobOperationsWithMakeMethods" WITH(SECURITY_INVOKER=true) AS
  SELECT 
    mm.id AS "makeMethodId",
    jo.*
  FROM "jobOperation" jo
  INNER JOIN "jobMakeMethod" jmm 
    ON jo."jobMakeMethodId" = jmm.id
  LEFT JOIN "makeMethod" mm 
    ON jmm."itemId" = mm."itemId" AND jmm."version" = mm."version";



DROP VIEW IF EXISTS "quoteOperationsWithMakeMethods";
COMMIT; 
CREATE OR REPLACE VIEW "quoteOperationsWithMakeMethods" WITH(SECURITY_INVOKER=true) AS
  SELECT 
    mm.id AS "makeMethodId",
    qo.*
  FROM "quoteOperation" qo
  INNER JOIN "quoteMakeMethod" qmm 
    ON qo."quoteMakeMethodId" = qmm.id
  LEFT JOIN "makeMethod" mm 
    ON qmm."itemId" = mm."itemId" AND qmm."version" = mm."version";

DROP VIEW IF EXISTS "quoteMaterialWithMakeMethodId";
CREATE OR REPLACE VIEW "quoteMaterialWithMakeMethodId" WITH(SECURITY_INVOKER=true) AS
  SELECT 
    qm.*, 
    qmm."id" AS "quoteMaterialMakeMethodId",
    qmm.version AS "version"
  FROM "quoteMaterial" qm 
  LEFT JOIN "quoteMakeMethod" qmm 
    ON qmm."parentMaterialId" = qm."id";

DROP VIEW IF EXISTS "jobMaterialWithMakeMethodId";
CREATE OR REPLACE VIEW "jobMaterialWithMakeMethodId" WITH(SECURITY_INVOKER=true) AS
  SELECT 
    jm.*, 
    jmm."id" AS "jobMaterialMakeMethodId",
    jmm.version AS "version"
  FROM "jobMaterial" jm 
  LEFT JOIN "jobMakeMethod" jmm 
    ON jmm."parentMaterialId" = jm."id";

CREATE OR REPLACE FUNCTION insert_quote_line_make_method()
RETURNS TRIGGER AS $$
DECLARE
  v_version NUMERIC(10, 2);
BEGIN
  SELECT "version" INTO v_version FROM "activeMakeMethods" WHERE "itemId" = NEW."itemId";
  INSERT INTO "quoteMakeMethod" (
    "quoteId", "quoteLineId", "itemId", "companyId", "createdAt", "createdBy", "version"
  )
  VALUES (
    NEW."quoteId", NEW."id", NEW."itemId", NEW."companyId", NOW(), NEW."createdBy", v_version
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION insert_quote_material_make_method()
RETURNS TRIGGER AS $$
DECLARE
  v_version NUMERIC(10, 2);
BEGIN
  SELECT "version" INTO v_version FROM "activeMakeMethods" WHERE "itemId" = NEW."itemId";
  INSERT INTO "quoteMakeMethod" (
    "quoteId", "quoteLineId", "parentMaterialId", "itemId", "companyId", "createdAt", "createdBy", "version"
  )
  VALUES (
    NEW."quoteId", NEW."quoteLineId", NEW."id", NEW."itemId", NEW."companyId", NOW(), NEW."createdBy", v_version
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION update_quote_line_make_method_item_id()
RETURNS TRIGGER AS $$
DECLARE
  v_version NUMERIC(10, 2);
BEGIN
  SELECT "version" INTO v_version FROM "activeMakeMethods" WHERE "itemId" = NEW."itemId";
  IF NOT EXISTS (
    SELECT 1 FROM "quoteMakeMethod"
    WHERE "quoteLineId" = NEW."id" AND "parentMaterialId" IS NULL
  ) THEN
    INSERT INTO "quoteMakeMethod" (
      "quoteId", "quoteLineId", "itemId", "companyId", "createdAt", "createdBy", "version"
    )
    VALUES (
      NEW."quoteId", NEW."id", NEW."itemId", NEW."companyId", NOW(), NEW."createdBy", v_version
    );
  ELSE
    UPDATE "quoteMakeMethod"
    SET "itemId" = NEW."itemId",
        "version" = v_version
    WHERE "quoteLineId" = NEW."id" AND "parentMaterialId" IS NULL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION update_quote_material_make_method_item_id()
RETURNS TRIGGER AS $$
DECLARE
  v_version NUMERIC(10, 2);
BEGIN
  SELECT "version" INTO v_version FROM "activeMakeMethods" WHERE "itemId" = NEW."itemId";
  IF NOT EXISTS (
    SELECT 1 FROM "quoteMakeMethod"
    WHERE "quoteLineId" = NEW."quoteLineId" AND "parentMaterialId" = NEW."id"
  ) THEN
    INSERT INTO "quoteMakeMethod" (
      "quoteId", "quoteLineId", "parentMaterialId", "itemId", "companyId", "createdAt", "createdBy", "version"
    )
    VALUES (
      NEW."quoteId", NEW."quoteLineId", NEW."id", NEW."itemId", NEW."companyId", NOW(), NEW."createdBy", v_version
    );
  ELSE
    UPDATE "quoteMakeMethod"
    SET "itemId" = NEW."itemId",
        "version" = v_version
    WHERE "quoteLineId" = NEW."quoteLineId" AND "parentMaterialId" = NEW."id";
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;


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
    "kit" BOOLEAN,
    "revision" TEXT,
    "externalId" JSONB,
    "version" NUMERIC(10,2)
) AS $$
WITH RECURSIVE material AS (
    SELECT 
        "quoteId",
        "quoteLineId",
        "id", 
        "id" AS "quoteMakeMethodId",
        'Make'::"methodType" AS "methodType",
        "id" AS "quoteMaterialMakeMethodId",
        "version",
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
        child."version",
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
  item."readableIdWithRevision" AS "itemReadableId",
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
  material."kit",
  item."revision",
  item."externalId",
  material."version"
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
    "kit" BOOLEAN,
    "revision" TEXT,
    "externalId" JSONB,
    "version" NUMERIC(10,2)
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
  item."externalId",
  mm2."version"
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
  'Make' AS "methodType",
  item."itemTrackingType",
  NULL AS "parentMaterialId",
  CAST(1 AS DOUBLE PRECISION) AS "order",
  NULL AS "operationId",
  true AS "isRoot",
  false AS "kit",
  item."revision",
  item."externalId",
  mm."version"
FROM "makeMethod" mm 
INNER JOIN item 
  ON mm."itemId" = item.id
INNER JOIN "itemCost" cost
  ON item.id = cost."itemId"
WHERE mm.id = uid
ORDER BY "order"
$$ LANGUAGE sql STABLE;


DROP FUNCTION IF EXISTS get_quote_methods;
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
    "methodType" "methodType",
    "parentMaterialId" TEXT,
    "order" DOUBLE PRECISION,
    "isRoot" BOOLEAN,
    "kit" BOOLEAN,
    "revision" TEXT,
    "externalId" JSONB,
    "version" NUMERIC(10,2)
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
        FALSE AS "kit",
        "version"
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
        FALSE AS "isRoot",
        child."kit",
        child."version"
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
  material."methodType",
  material."parentMaterialId",
  material."order",
  material."isRoot",
  material."kit",
  item."revision",
  item."externalId",
  material."version"
FROM material 
INNER JOIN item ON material."itemId" = item.id
WHERE material."quoteId" = qid
ORDER BY "order"
$$ LANGUAGE sql STABLE;

DROP FUNCTION IF EXISTS get_job_method;
CREATE OR REPLACE FUNCTION get_job_method(jid TEXT)
RETURNS TABLE (
    "jobId" TEXT,
    "methodMaterialId" TEXT,
    "jobMakeMethodId" TEXT,
    "jobMaterialMakeMethodId" TEXT,  
    "itemId" TEXT,
    "itemReadableId" TEXT,
    "description" TEXT,
    "itemType" TEXT,
    "quantity" NUMERIC,
    "unitCost" NUMERIC,
    "methodType" "methodType",
    "parentMaterialId" TEXT,
    "order" DOUBLE PRECISION,
    "isRoot" BOOLEAN,
    "kit" BOOLEAN,
    "revision" TEXT,
    "version" NUMERIC(10,2)
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
        1::NUMERIC AS "quantity",
        0::NUMERIC AS "unitCost",
        "parentMaterialId",
        CAST(1 AS DOUBLE PRECISION) AS "order",
        TRUE AS "isRoot",
        FALSE AS "kit",
        "version"
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
        FALSE AS "isRoot",
        child."kit",
        child."version"
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
  item."readableIdWithRevision" AS "itemReadableId",
  item."name" AS "description",
  material."itemType",
  material."quantity",
  material."unitCost",
  material."methodType",
  material."parentMaterialId",
  material."order",
  material."isRoot",
  material."kit",
  item."revision",
  material."version"
FROM material 
INNER JOIN item ON material."itemId" = item.id
WHERE material."jobId" = jid
ORDER BY "order"
$$ LANGUAGE sql STABLE;