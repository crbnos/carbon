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