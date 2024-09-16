DROP TABLE "jobMaterial";
DROP TABLE "jobOperation";

CREATE TABLE "jobMaterial" (
  "id" TEXT NOT NULL DEFAULT xid(),
  "jobId" TEXT NOT NULL,
  "itemId" TEXT NOT NULL,
  "itemReadableId" TEXT NOT NULL,
  "itemType" TEXT NOT NULL DEFAULT 'Part',
  "methodType" "methodType" NOT NULL DEFAULT 'Make',
  "order" DOUBLE PRECISION NOT NULL DEFAULT 1,
  "description" TEXT NOT NULL,
  "quantity" NUMERIC(10, 4) NOT NULL DEFAULT 0,
  "scrapQuantity" NUMERIC(10, 4) NOT NULL DEFAULT 0,
  "productionQuantity" NUMERIC(10, 4) GENERATED ALWAYS AS ("quantity" + "scrapQuantity") STORED,
  "unitOfMeasureCode" TEXT,
  "unitCost" NUMERIC(10, 4) NOT NULL DEFAULT 0,
  "companyId" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "createdBy" TEXT NOT NULL,
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  "updatedBy" TEXT,
  "customFields" JSONB,

  CONSTRAINT "jobMaterial_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "jobMaterial_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "job" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "jobMaterial_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "item" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "jobMaterial_unitOfMeasureCode_fkey" FOREIGN KEY ("unitOfMeasureCode", "companyId") REFERENCES "unitOfMeasure" ("code", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "jobMaterial_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "jobMaterial_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "jobMaterial_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "user" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "jobMaterial_jobId_idx" ON "jobMaterial" ("jobId");

CREATE TABLE "jobMakeMethod" (
  "id" TEXT NOT NULL DEFAULT xid(),
  "jobId" TEXT NOT NULL,
  "parentMaterialId" TEXT,
  "itemId" TEXT NOT NULL,
  "quantityPerParent" NUMERIC(10, 4) NOT NULL DEFAULT 1,
  "companyId" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "createdBy" TEXT NOT NULL,
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  "updatedBy" TEXT,
  "customFields" JSONB,

  CONSTRAINT "jobMakeMethod_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "jobMakeMethod_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "job" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "jobMakeMethod_parentMaterialId_fkey" FOREIGN KEY ("parentMaterialId") REFERENCES "jobMaterial" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "jobMakeMethod_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "item" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "jobMakeMethod_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "jobMakeMethod_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "jobMakeMethod_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "user" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE OR REPLACE FUNCTION insert_job_make_method()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO "jobMakeMethod" ("jobId", "itemId", "companyId", "createdBy")
  VALUES (NEW."id", NEW."itemId", NEW."companyId", NEW."createdBy");
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER insert_job_make_method_trigger
AFTER INSERT ON "job"
FOR EACH ROW
EXECUTE FUNCTION insert_job_make_method();

CREATE INDEX "jobMakeMethod_jobId_idx" ON "jobMakeMethod" ("jobId");
CREATE INDEX "jobMakeMethod_parentMaterialId_idx" ON "jobMakeMethod" ("parentMaterialId");

ALTER TABLE "jobMaterial" ADD COLUMN "jobMakeMethodId" TEXT NOT NULL,
  ADD CONSTRAINT "jobMaterial_jobMakeMethodId_fkey" FOREIGN KEY ("jobMakeMethodId") REFERENCES "jobMakeMethod" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION insert_job_material_make_method()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO "jobMakeMethod" ("jobId", "parentMaterialId", "itemId", "companyId", "createdBy")
  VALUES (NEW."jobId", NEW."id", NEW."itemId", NEW."companyId", NEW."createdBy");
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER insert_job_material_make_method_trigger
  AFTER INSERT ON "jobMaterial"
  FOR EACH ROW
  WHEN (NEW."methodType" = 'Make')
  EXECUTE FUNCTION insert_job_material_make_method();

CREATE OR REPLACE FUNCTION update_job_material_make_method_item_id()
  RETURNS TRIGGER AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "jobMakeMethod"
    WHERE "jobId" = NEW."jobId" AND "parentMaterialId" = NEW."id"
  ) THEN
    INSERT INTO "jobMakeMethod" ("jobId", "parentMaterialId", "itemId", "companyId", "createdBy")
    VALUES (NEW."jobId", NEW."id", NEW."itemId", NEW."companyId", NEW."createdBy");
  ELSE
    UPDATE "jobMakeMethod"
    SET "itemId" = NEW."itemId"
    WHERE "jobId" = NEW."jobId" AND "parentMaterialId" = NEW."id";
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_job_material_make_method_item_id_trigger
  AFTER UPDATE OF "itemId", "methodType" ON "jobMaterial"
  FOR EACH ROW
  WHEN (
    (OLD."methodType" = 'Make' AND OLD."itemId" IS DISTINCT FROM NEW."itemId") OR 
    (NEW."methodType" = 'Make' AND OLD."methodType" <> 'Make')
  )
  EXECUTE FUNCTION update_job_material_make_method_item_id();

CREATE TABLE "jobOperation" (
  "id" TEXT NOT NULL DEFAULT xid(),
  "jobId" TEXT NOT NULL,
  "jobMakeMethodId" TEXT,
  "order" DOUBLE PRECISION NOT NULL DEFAULT 1,
  "processId" TEXT NOT NULL,
  "workCenterId" TEXT,
  "description" TEXT,
  "setupTime" NUMERIC(10,2) NOT NULL DEFAULT 0,
  "setupUnit" factor NOT NULL DEFAULT 'Total Hours',
  "laborTime" NUMERIC(10,2) NOT NULL DEFAULT 0,
  "laborUnit" factor NOT NULL DEFAULT 'Hours/Piece',
  "machineTime" NUMERIC(10,2) NOT NULL DEFAULT 0,
  "machineUnit" factor NOT NULL DEFAULT 'Hours/Piece',
  "operationOrder" "methodOperationOrder" NOT NULL DEFAULT 'After Previous',
  "laborRate" NUMERIC(10,4) NOT NULL DEFAULT 0,
  "overheadRate" NUMERIC(10,4) NOT NULL DEFAULT 0,
  "machineRate" NUMERIC(10,4) DEFAULT 0,
  "operationType" "operationType" NOT NULL DEFAULT 'Inside',
  "operationMinimumCost" NUMERIC(10,4) NOT NULL DEFAULT 0,
  "operationLeadTime" NUMERIC(10,4) NOT NULL DEFAULT 0,
  "operationUnitCost" NUMERIC(10,4) NOT NULL DEFAULT 0,
  "operationSupplierProcessId" TEXT,
  "workInstruction" JSON NOT NULL DEFAULT '{}',
  "companyId" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "createdBy" TEXT NOT NULL,
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  "updatedBy" TEXT,
  "customFields" JSONB,

  CONSTRAINT "jobOperation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "jobOperation_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "job" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "jobOperation_jobMakeMethodId_fkey" FOREIGN KEY ("jobMakeMethodId") REFERENCES "jobMakeMethod" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "jobOperation_processId_fkey" FOREIGN KEY ("processId") REFERENCES "process" ("id") ON DELETE RESTRICT,
  CONSTRAINT "jobOperation_workCenterId_fkey" FOREIGN KEY ("workCenterId") REFERENCES "workCenter" ("id") ON DELETE RESTRICT,
  CONSTRAINT "jobOperation_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "jobOperation_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "jobOperation_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "user" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "jobOperation_jobId_idx" ON "jobOperation" ("jobId");
CREATE INDEX "jobOperation_jobMakeMethodId_idx" ON "jobOperation" ("jobMakeMethodId");

ALTER TABLE "jobMaterial" ADD COLUMN "jobOperationId" TEXT,
  ADD CONSTRAINT "jobMaterial_jobOperationId_fkey" FOREIGN KEY ("jobOperationId") REFERENCES "jobOperation" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

COMMIT;
CREATE INDEX "jobMaterial_jobOperationId_idx" ON "jobMaterial" ("jobOperationId");

CREATE TABLE "jobFavorite" (
  "jobId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,

  CONSTRAINT "jobFavorites_pkey" PRIMARY KEY ("jobId", "userId"),
  CONSTRAINT "jobFavorites_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "job"("id") ON DELETE CASCADE,
  CONSTRAINT "jobFavorites_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE
);

CREATE INDEX "jobFavorites_userId_idx" ON "jobFavorite" ("userId");
CREATE INDEX "jobFavorites_jobId_idx" ON "jobFavorite" ("jobId");

ALTER TABLE "jobFavorite" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own job favorites" ON "jobFavorite" 
  FOR SELECT USING (
    auth.uid()::text = "userId"
  );

CREATE POLICY "Users can create their own job favorites" ON "jobFavorite" 
  FOR INSERT WITH CHECK (
    auth.uid()::text = "userId"
  );

CREATE POLICY "Users can delete their own job favorites" ON "jobFavorite"
  FOR DELETE USING (
    auth.uid()::text = "userId"
  );

CREATE OR REPLACE VIEW "jobMaterialWithMakeMethodId" WITH(SECURITY_INVOKER=true) AS
  SELECT 
    jm.*, 
    jmm."id" AS "jobMaterialMakeMethodId" 
  FROM "jobMaterial" jm 
  LEFT JOIN "jobMakeMethod" jmm 
    ON jmm."parentMaterialId" = jm."id";

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

ALTER TABLE "jobMaterial" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "jobOperation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "jobMakeMethod" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Requests with an API key can access jobs" ON "jobMaterial"
FOR ALL USING (
  has_valid_api_key_for_company("companyId")
);

CREATE POLICY "Requests with an API key can access jobs" ON "jobOperation"
FOR ALL USING (
  has_valid_api_key_for_company("companyId")
);

CREATE POLICY "Requests with an API key can access jobs" ON "jobMakeMethod"
FOR ALL USING (
  has_valid_api_key_for_company("companyId")
);

-- Policies for jobMaterial
CREATE POLICY "Employees can view job materials" ON "jobMaterial"
  FOR SELECT
  USING (
    has_role('employee', "companyId")
    AND "companyId" = ANY(
        SELECT "companyId" from "userToCompany" where "userId" = auth.uid()::text
    )
  );

CREATE POLICY "Employees with production_create can insert job materials" ON "jobMaterial"
  FOR INSERT
  WITH CHECK (
    has_role('employee', "companyId")
    AND has_company_permission('production_create', "companyId")
  );

CREATE POLICY "Employees with production_update can update job materials" ON "jobMaterial"
  FOR UPDATE
  USING (
    has_role('employee', "companyId")
    AND has_company_permission('production_update', "companyId")
  );

CREATE POLICY "Employees with production_delete can delete job materials" ON "jobMaterial"
  FOR DELETE
  USING (
    has_role('employee', "companyId")
    AND has_company_permission('production_delete', "companyId")
  );

CREATE POLICY "Customers with production_view can view their own job materials" ON "jobMaterial"
  FOR SELECT
  USING (
    has_role('customer', "companyId") AND
    has_company_permission('production_view', "companyId") AND
    "jobId" IN (
      SELECT "id" FROM "job" WHERE "customerId" IN (
        SELECT "customerId" FROM "customerAccount" WHERE id::uuid = auth.uid()
      )
    )
  );

-- Policies for jobOperation
CREATE POLICY "Employees can view job operations" ON "jobOperation"
  FOR SELECT
  USING (
    has_role('employee', "companyId")
    AND "companyId" = ANY(
        SELECT "companyId" from "userToCompany" where "userId" = auth.uid()::text
    )
  );

CREATE POLICY "Employees with production_create can insert job operations" ON "jobOperation"
  FOR INSERT
  WITH CHECK (
    has_role('employee', "companyId")
    AND has_company_permission('production_create', "companyId")
  );

CREATE POLICY "Employees with production_update can update job operations" ON "jobOperation"
  FOR UPDATE
  USING (
    has_role('employee', "companyId")
    AND has_company_permission('production_update', "companyId")
  );

CREATE POLICY "Employees with production_delete can delete job operations" ON "jobOperation"
  FOR DELETE
  USING (
    has_role('employee', "companyId")
    AND has_company_permission('production_delete', "companyId")
  );

CREATE POLICY "Customers with production_view can view their own job operations" ON "jobOperation"
  FOR SELECT
  USING (
    has_role('customer', "companyId") AND
    has_company_permission('production_view', "companyId") AND
    "jobId" IN (
      SELECT "id" FROM "job" WHERE "customerId" IN (
        SELECT "customerId" FROM "customerAccount" WHERE id::uuid = auth.uid()
      )
    )
  );

CREATE POLICY "Employees can view job make methods" ON "jobMakeMethod"
  FOR SELECT
  USING (
    has_role('employee', "companyId")
    AND "companyId" = ANY(
        SELECT "companyId" from "userToCompany" where "userId" = auth.uid()::text
    )
  );

CREATE POLICY "Employees with production_create can insert job make methods" ON "jobMakeMethod"
  FOR INSERT
  WITH CHECK (
    has_role('employee', "companyId")
    AND has_company_permission('production_create', "companyId")
  );

CREATE POLICY "Employees with production_update can update job make methods" ON "jobMakeMethod"
  FOR UPDATE
  USING (
    has_role('employee', "companyId")
    AND has_company_permission('production_update', "companyId")
  );

CREATE POLICY "Employees with production_delete can delete job make methods" ON "jobMakeMethod"
  FOR DELETE
  USING (
    has_role('employee', "companyId")
    AND has_company_permission('production_delete', "companyId")
  );

CREATE POLICY "Customers with production_view can view their own job make methods" ON "jobMakeMethod"
  FOR SELECT
  USING (
    has_role('customer', "companyId") AND
    has_company_permission('production_view', "companyId") AND
    "jobId" IN (
      SELECT "id" FROM "job" WHERE "customerId" IN (
        SELECT "customerId" FROM "customerAccount" WHERE id::uuid = auth.uid()
      )
    )
  );
