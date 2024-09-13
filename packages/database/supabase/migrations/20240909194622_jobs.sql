DROP VIEW IF EXISTS "modules";
DROP VIEW IF EXISTS "customFieldTables";
COMMIT;

-- Remove existing values from module type
DROP TYPE IF EXISTS module_old;
ALTER TYPE module RENAME TO module_old;

-- Create new module type with updated values
CREATE TYPE module AS ENUM (
  'Accounting',
  'Documents',
  'Invoicing',
  'Inventory',
  'Items',
  'Messaging',
  'Parts',
  'People',
  'Production',
  'Purchasing',
  'Resources',
  'Sales',
  'Settings',
  'Users'
);

-- Create a new table for employeeTypePermission
CREATE TABLE "employeeTypePermission_new" (
  "employeeTypeId" TEXT NOT NULL,
  "module" "module" NOT NULL,  
  "create" TEXT[] NOT NULL DEFAULT '{}',
  "delete" TEXT[] NOT NULL DEFAULT '{}',
  "update" TEXT[] NOT NULL DEFAULT '{}',
  "view" TEXT[] NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMP WITH TIME ZONE,

  CONSTRAINT "employeeTypePermission_new_pkey" PRIMARY KEY ("employeeTypeId", "module"),
  CONSTRAINT "employeeTypePermission_new_employeeTypeId_fkey" FOREIGN KEY ("employeeTypeId") REFERENCES "employeeType"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- Copy data from the old table to the new table, transforming the module values
INSERT INTO "employeeTypePermission_new" ("employeeTypeId", "module", "create", "delete", "update", "view")
SELECT DISTINCT "employeeTypeId", 
  CASE 
    WHEN "module"::text = 'Jobs' THEN 'Production'::module
    WHEN "module"::text = 'Scheduling' THEN 'Production'::module
    WHEN "module"::text = 'Timecards' THEN 'Production'::module
    ELSE "module"::text::module
  END,
  "create",
  "delete",
  "update",
  "view"
FROM "employeeTypePermission"
ON CONFLICT DO NOTHING;

-- Drop the old table
DROP TABLE "employeeTypePermission";

-- Rename the new table to the original name
ALTER TABLE "employeeTypePermission_new" RENAME TO "employeeTypePermission";


ALTER TABLE "customFieldTable"
  ALTER COLUMN "module" TYPE module USING (
    CASE 
      WHEN "module"::text = 'Jobs' THEN 'Production'::module
      WHEN "module"::text = 'Scheduling' THEN 'Production'::module
      WHEN "module"::text = 'Timecards' THEN 'Production'::module
      ELSE "module"::text::module
    END
  );


-- Drop the old type
DROP TYPE module_old;

CREATE VIEW "modules" AS
    SELECT unnest(enum_range(NULL::module)) AS name;

CREATE OR REPLACE VIEW "customFieldTables" WITH(SECURITY_INVOKER=true) AS
SELECT 
  cft.*, 
  c.id AS "companyId",
  COALESCE(cf.fields, '[]') as fields
FROM "customFieldTable" cft 
  CROSS JOIN "company" c 
  LEFT JOIN (
    SELECT 
      cf."table",
      cf."companyId",
      COALESCE(json_agg(
        json_build_object(
          'id', id, 
          'name', name,
          'sortOrder', "sortOrder",
          'dataTypeId', "dataTypeId",
          'listOptions', "listOptions",
          'active', active
        )
      ), '[]') AS fields 
    FROM "customField" cf
    GROUP BY cf."table", cf."companyId"
  ) cf
    ON cf.table = cft.table AND cf."companyId" = c.id;

-- Create jobStatus type
CREATE TYPE "public"."jobStatus" AS ENUM (
  'Draft',
  'Ready',
  'In Progress',
  'Paused',
  'Completed',
  'Cancelled'
);

-- Create deadlineType type
CREATE TYPE "public"."deadlineType" AS ENUM (
  'No Deadline',
  'ASAP',
  'Soft Deadline',
  'Hard Deadline'
);

-- Create job table
CREATE TABLE "public"."job" (
  "id" TEXT NOT NULL DEFAULT xid(),
  "jobId" TEXT NOT NULL,
  "itemId" TEXT NOT NULL,
  "unitOfMeasureCode" TEXT NOT NULL,
  "customerId" TEXT,
  "locationId" TEXT NOT NULL,
  "status" "jobStatus" NOT NULL DEFAULT 'Draft',
  "dueDate" DATE,
  "deadlineType" "deadlineType" NOT NULL DEFAULT 'No Deadline',
  "quantity" NUMERIC(10, 4) NOT NULL DEFAULT 0,
  "scrapQuantity" NUMERIC(10, 4) NOT NULL DEFAULT 0,
  "productionQuantity" NUMERIC(10, 4) GENERATED ALWAYS AS ("quantity" + "scrapQuantity") STORED,
  "quantityComplete" NUMERIC(10, 4) NOT NULL DEFAULT 0,
  "quantityShipped" NUMERIC(10, 4) NOT NULL DEFAULT 0,
  "quantityReceivedToInventory" NUMERIC(10, 4) NOT NULL DEFAULT 0,
  "salesOrderId" TEXT,
  "salesOrderLineId" TEXT,
  "quoteId" TEXT,
  "quoteLineId" TEXT,
  "modelUploadId" TEXT,
  "notes" JSONB DEFAULT '{}'::jsonb,
  "assignee" TEXT,
  "customFields" JSONB,
  "companyId" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "createdBy" TEXT NOT NULL,
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  "updatedBy" TEXT,

  CONSTRAINT "job_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "job_jobId_key" UNIQUE ("jobId", "companyId"),
  CONSTRAINT "job_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "item" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "job_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customer" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "job_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "location" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "job_unitOfMeasureCode_fkey" FOREIGN KEY ("unitOfMeasureCode", "companyId") REFERENCES "unitOfMeasure" ("code", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "job_salesOrderId_fkey" FOREIGN KEY ("salesOrderId") REFERENCES "salesOrder" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "job_salesOrderLineId_fkey" FOREIGN KEY ("salesOrderLineId") REFERENCES "salesOrderLine" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "job_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "quote" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "job_quoteLineId_fkey" FOREIGN KEY ("quoteLineId") REFERENCES "quoteLine" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "job_assignee_fkey" FOREIGN KEY ("assignee") REFERENCES "user" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "job_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "job_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "job_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "user" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);


-- Create index for faster lookups
CREATE INDEX "idx_job_companyId" ON "public"."job" ("companyId");
CREATE INDEX "idx_job_customerId" ON "public"."job" ("customerId");
CREATE INDEX "idx_job_status" ON "public"."job" ("status");
CREATE INDEX "idx_job_salesOrderLineId" ON "public"."job" ("salesOrderLineId");

-- Create jobMaterial table
CREATE TABLE "public"."jobMaterial" (
  "id" TEXT NOT NULL DEFAULT xid(),
  "jobId" TEXT NOT NULL,
  "itemId" TEXT NOT NULL,
  "itemReadableId" TEXT NOT NULL,
  "itemType" TEXT NOT NULL DEFAULT 'Part',
  "methodType" "methodType" NOT NULL DEFAULT 'Make',
  "order" DOUBLE PRECISION NOT NULL DEFAULT 1,
  "description" TEXT NOT NULL,
  "quantity" NUMERIC(10, 4) NOT NULL DEFAULT 0,
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

CREATE INDEX "jobMaterial_jobId_idx" ON "public"."jobMaterial" ("jobId");

-- Create jobOperation table
CREATE TABLE "public"."jobOperation" (
  "id" TEXT NOT NULL DEFAULT xid(),
  "jobId" TEXT NOT NULL,
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
  "quotingRate" NUMERIC(10,4) NOT NULL DEFAULT 0,
  "laborRate" NUMERIC(10,4) NOT NULL DEFAULT 0,
  "overheadRate" NUMERIC(10,4) NOT NULL DEFAULT 0,
  "companyId" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "createdBy" TEXT NOT NULL,
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  "updatedBy" TEXT,
  "customFields" JSONB,

  CONSTRAINT "jobOperation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "jobOperation_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "job" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "jobOperation_processId_fkey" FOREIGN KEY ("processId") REFERENCES "process" ("id") ON DELETE RESTRICT,
  CONSTRAINT "jobOperation_workCenterId_fkey" FOREIGN KEY ("workCenterId") REFERENCES "workCenter" ("id") ON DELETE RESTRICT,
  CONSTRAINT "jobOperation_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "jobOperation_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "jobOperation_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "user" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "jobOperation_jobId_idx" ON "public"."jobOperation" ("jobId");

-- Add jobOperationId to jobMaterial table
ALTER TABLE "public"."jobMaterial" ADD COLUMN "jobOperationId" TEXT,
  ADD CONSTRAINT "jobMaterial_jobOperationId_fkey" FOREIGN KEY ("jobOperationId") REFERENCES "jobOperation" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "jobMaterial_jobOperationId_idx" ON "public"."jobMaterial" ("jobOperationId");

-- Add comments for the new tables
COMMENT ON TABLE "public"."jobMaterial" IS 'Stores information about materials used in jobs';
COMMENT ON TABLE "public"."jobOperation" IS 'Stores information about operations performed in jobs';

-- Create jobOperationWorkInstruction table
CREATE TABLE "public"."jobOperationWorkInstruction" (
  "jobOperationId" TEXT NOT NULL,
  "content" JSON DEFAULT '{}'::json,
  "companyId" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  "createdBy" TEXT NOT NULL,
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  "updatedBy" TEXT,

  CONSTRAINT "jobOperationWorkInstruction_pkey" PRIMARY KEY ("jobOperationId"),
  CONSTRAINT "jobOperationWorkInstruction_jobOperationId_fkey" FOREIGN KEY ("jobOperationId") REFERENCES "jobOperation" ("id") ON DELETE CASCADE,
  CONSTRAINT "jobOperationWorkInstruction_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "user"("id") ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT "jobOperationWorkInstruction_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user"("id") ON UPDATE CASCADE ON DELETE RESTRICT
);

CREATE FUNCTION public.create_job_operation_work_instruction()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public."jobOperationWorkInstruction"("jobOperationId", "createdBy", "companyId")
  VALUES (new."id", new."createdBy", new."companyId");
  
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER create_job_operation_related_records
  AFTER INSERT on public."jobOperation"
  FOR EACH ROW EXECUTE PROCEDURE public.create_job_operation_work_instruction();

-- Update the "userPermission" table to change jobs-related permissions to production-related permissions
-- and remove scheduling-related permissions
UPDATE "userPermission"
SET "permissions" = (
  SELECT jsonb_object_agg(
    CASE
      WHEN key = 'jobs_view' THEN 'production_view'
      WHEN key = 'jobs_update' THEN 'production_update'
      WHEN key = 'jobs_create' THEN 'production_create'
      WHEN key = 'jobs_delete' THEN 'production_delete'
      ELSE key
    END,
    value
  )
  FROM jsonb_each("userPermission"."permissions") AS p(key, value)
  WHERE key NOT IN ('scheduling_view', 'scheduling_update', 'scheduling_create', 'scheduling_delete')
)
WHERE "permissions" ? 'jobs_view'
   OR "permissions" ? 'jobs_update'
   OR "permissions" ? 'jobs_create'
   OR "permissions" ? 'jobs_delete'
   OR "permissions" ? 'scheduling_view'
   OR "permissions" ? 'scheduling_update'
   OR "permissions" ? 'scheduling_create'
   OR "permissions" ? 'scheduling_delete';

CREATE OR REPLACE VIEW "jobs" WITH(SECURITY_INVOKER=true) AS
WITH job_model AS (
  SELECT
    j.id AS job_id,
    COALESCE(j."modelUploadId", i."modelUploadId") AS model_upload_id
  FROM "job" j
  INNER JOIN "item" i ON j."itemId" = i."id"
)
SELECT
  j.*,
  i.name,
  i."readableId" as "itemReadableId",
  i.type as "itemType",
  i.name as "description",
  i."itemTrackingType",
  i.active,
  i."replenishmentSystem",
  mu.id as "modelId",
  mu."autodeskUrn",
  mu."modelPath",
  mu."thumbnailPath",
  mu."name" as "modelName",
  mu."size" as "modelSize",
  so."salesOrderId" as "salesOrderReadableId",
  qo."quoteId" as "quoteReadableId"
FROM "job" j
INNER JOIN "item" i ON j."itemId" = i."id"
LEFT JOIN job_model jm ON j.id = jm.job_id
LEFT JOIN "modelUpload" mu ON mu.id = jm.model_upload_id
LEFT JOIN "salesOrder" so on j."salesOrderId" = so.id
LEFT JOIN "quote" qo ON j."quoteId" = qo.id;


INSERT INTO "customFieldTable" ("table", "name", "module") 
VALUES ('job', 'Job', 'Production');

-- job sequence for existing companies
INSERT INTO "sequence" (
  "table", 
  "name", 
  "prefix", 
  "suffix", 
  "next", 
  "size", 
  "step", 
  "companyId"
) 
SELECT 
  'job',
  'Job',
  'WO',
  null,
  0,
  6,
  1,
  id
FROM "company" 
ON CONFLICT DO NOTHING;

ALTER TABLE "itemReplenishment" 
  ADD COLUMN "scrapPercentage" NUMERIC(5, 2) DEFAULT 0 NOT NULL;

ALTER TABLE "methodMaterial"
  ADD COLUMN "scrapQuantity" NUMERIC(10, 4) NOT NULL DEFAULT 0,
  ADD COLUMN "productionQuantity" NUMERIC(10, 4) GENERATED ALWAYS AS ("quantity" + "scrapQuantity") STORED;

ALTER TABLE "quoteMaterial"
  ADD COLUMN "scrapQuantity" NUMERIC(10, 4) NOT NULL DEFAULT 0,
  ADD COLUMN "productionQuantity" NUMERIC(10, 4) GENERATED ALWAYS AS ("quantity" + "scrapQuantity") STORED;


ALTER TABLE "job" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Employees can view jobs" ON "job"
  FOR SELECT
  USING (
    has_role('employee', "companyId")
    AND "companyId" = ANY(
        SELECT "companyId" from "userToCompany" where "userId" = auth.uid()::text
    )
  );

CREATE POLICY "Employees with production_create can insert jobs" ON "job"
  FOR INSERT
  WITH CHECK (
    has_role('employee', "companyId")
    AND has_company_permission('production_create', "companyId")
  );

CREATE POLICY "Employees with production_update can update jobs" ON "job"
  FOR UPDATE
  USING (
    has_role('employee', "companyId")
    AND has_company_permission('production_update', "companyId")
  );

CREATE POLICY "Employees with production_delete can delete jobs" ON "job"
  FOR DELETE
  USING (
    has_role('employee', "companyId")
    AND has_company_permission('production_delete', "companyId")
  );

CREATE POLICY "Customers with production_view can view their own jobs" ON "job"
  FOR SELECT
  USING (
    has_role('customer', "companyId") AND
    has_company_permission('production_view', "companyId") AND
    "customerId" IN (
      SELECT "customerId" FROM "customerAccount" WHERE id::uuid = auth.uid()
    )
  );

-- Search

CREATE FUNCTION public.create_job_search_result()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.search(name, entity, uuid, link, "companyId")
  VALUES (new."jobId", 'Job', new.id, '/x/job/' || new.id, new."companyId");
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER create_job_search_result
  AFTER INSERT on public."job"
  FOR EACH ROW EXECUTE PROCEDURE public.create_job_search_result();

CREATE FUNCTION public.update_job_search_result()
RETURNS TRIGGER AS $$
BEGIN
  IF (old."jobId" <> new."jobId") THEN
    UPDATE public.search SET name = new."jobId"
    WHERE entity = 'Job' AND uuid = new.id AND "companyId" = new."companyId";
  END IF;
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER update_job_search_result
  AFTER UPDATE on public."job"
  FOR EACH ROW EXECUTE PROCEDURE public.update_job_search_result();

CREATE FUNCTION public.delete_job_search_result()
RETURNS TRIGGER AS $$
BEGIN
  DELETE FROM public.search WHERE entity = 'Job' AND uuid = old.id AND "companyId" = old."companyId";
  RETURN old;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER delete_job_search_result
  AFTER DELETE on public."job"
  FOR EACH ROW EXECUTE PROCEDURE public.delete_job_search_result();

CREATE POLICY "Employees with production_view can search for jobs" ON "search"
  FOR SELECT
  USING (
    has_role('employee', "companyId") AND
    has_company_permission('production_view', "companyId") AND
    entity = 'Job'
  );

CREATE POLICY "Customers with production_view can search for their own jobs" ON "search"
  FOR SELECT
  USING (
    has_role('customer', "companyId") AND
    has_company_permission('production_view', "companyId") AND
    entity = 'Job' AND
    uuid IN (
      SELECT id FROM "job" WHERE "customerId" IN (
        SELECT "customerId" FROM "customerAccount" WHERE id::uuid = auth.uid()
      )
    )
  );


CREATE POLICY "Job documents view requires production_view" ON storage.objects 
FOR SELECT USING (
    bucket_id = 'private'
    AND has_role('employee', (storage.foldername(name))[1])
    AND has_company_permission('production_view', (storage.foldername(name))[1])
    AND (storage.foldername(name))[2] = 'job'
);

CREATE POLICY "Job documents insert requires production_create" ON storage.objects 
FOR INSERT WITH CHECK (
    bucket_id = 'private'
    AND has_role('employee', (storage.foldername(name))[1])
    AND has_company_permission('production_create', (storage.foldername(name))[1])
    AND (storage.foldername(name))[2] = 'job'
);

CREATE POLICY "Job documents update requires production_update" ON storage.objects 
FOR UPDATE USING (
    bucket_id = 'private'
    AND has_role('employee', (storage.foldername(name))[1])
    AND has_company_permission('production_update', (storage.foldername(name))[1])
    AND (storage.foldername(name))[2] = 'job'
);

CREATE POLICY "Job documents delete requires production_delete" ON storage.objects 
FOR DELETE USING (
    bucket_id = 'private'
    AND has_role('employee', (storage.foldername(name))[1])
    AND has_company_permission('production_delete', (storage.foldername(name))[1])
    AND (storage.foldername(name))[2] = 'job'
);
