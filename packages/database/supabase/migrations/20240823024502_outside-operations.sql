
CREATE TYPE "operationType" AS ENUM (
  'Inside',
  'Outside'
);

DROP VIEW "workCenters";
DROP VIEW "processes";
DROP VIEW "quoteOperationsWithMakeMethods";

COMMIT;

ALTER TABLE "workCenter"
  DROP COLUMN "quotingRate" CASCADE,
  ADD COLUMN "machineRate" NUMERIC(10,4) NOT NULL DEFAULT 0,
  ADD COLUMN "overheadRate" NUMERIC(10,4) NOT NULL DEFAULT 0;


CREATE TABLE "supplierProcess" (
  "id" TEXT NOT NULL DEFAULT xid(),
  "supplierId" TEXT NOT NULL,
  "processId" TEXT NOT NULL,
  "minimumCost" NUMERIC(10,4) NOT NULL DEFAULT 0,
  "unitCost" NUMERIC(10,4) NOT NULL DEFAULT 0,
  "leadTime" NUMERIC(10,4) NOT NULL DEFAULT 0,
  "companyId" TEXT NOT NULL,
  "customFields" JSONB,
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedBy" TEXT,
  "updatedAt" TIMESTAMPTZ,

  CONSTRAINT "supplierProcess_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "supplierProcess_supplierId_processId_key" UNIQUE ("supplierId", "processId"),
  CONSTRAINT "supplierProcess_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "supplier" ("id") ON DELETE CASCADE,
  CONSTRAINT "supplierProcess_processId_fkey" FOREIGN KEY ("processId") REFERENCES "process" ("id") ON DELETE CASCADE,
  CONSTRAINT "supplierProcess_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company" ("id") ON DELETE CASCADE,
  CONSTRAINT "supplierProcess_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user" ("id") ON DELETE RESTRICT,
  CONSTRAINT "supplierProcess_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "user" ("id") ON DELETE SET NULL
);

ALTER TABLE "supplierProcess" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Employees with purchasing, resources, or sales can read supplier processes" 
  ON "supplierProcess" 
  FOR SELECT 
  USING (
    has_role('employee', "companyId") AND (
      has_company_permission('purchasing_view', "companyId") OR
      has_company_permission('resources_view', "companyId") OR
      has_company_permission('sales_view', "companyId")
    )
  );

CREATE POLICY "Employees with resources and purchasing can create supplier processes" 
  ON "supplierProcess" 
  FOR INSERT 
  WITH CHECK (
    has_role('employee', "companyId") AND (
      has_company_permission('purchasing_update', "companyId") OR
      has_company_permission('resources_update', "companyId")
    )
  );

CREATE POLICY "Employees with resources can update supplier processes"
  ON "supplierProcess" 
  FOR UPDATE 
  USING (
    has_role('employee', "companyId") AND has_company_permission('resources_update', "companyId")
  );

CREATE POLICY "Employees with resources or purchasing can delete supplier processes"
  ON "supplierProcess" 
  FOR DELETE 
  USING (
    has_role('employee', "companyId") AND (
      has_company_permission('purchasing_delete', "companyId") OR
      has_company_permission('resources_delete', "companyId")
    )
  );

INSERT INTO "customFieldTable" ("table", "name", "module") 
VALUES ('supplierProcess', 'Supplier Process', 'Purchasing');

CREATE VIEW "supplierProcesses" WITH(SECURITY_INVOKER=true) AS
  SELECT
    sp.*,
    p.name as "processName"
  FROM "supplierProcess" sp
  INNER JOIN "process" p ON sp."processId" = p.id;



ALTER TABLE "methodOperation"
  ADD COLUMN "operationType" "operationType" NOT NULL DEFAULT 'Inside',
  ADD COLUMN "operationSupplierProcessId" TEXT,
  ADD CONSTRAINT "quoteOperation_operationSupplierProcessId_fkey" FOREIGN KEY ("operationSupplierProcessId") REFERENCES "supplierProcess" ("id") ON DELETE SET NULL;;


ALTER TABLE "quoteOperation"
  ADD COLUMN "machineRate" NUMERIC(10,4),
  ADD COLUMN "operationType" "operationType" NOT NULL DEFAULT 'Inside',
  ADD COLUMN "operationMinimumCost" NUMERIC(10,4) NOT NULL DEFAULT 0,
  ADD COLUMN "operationLeadTime" NUMERIC(10,4) NOT NULL DEFAULT 0,
  ADD COLUMN "operationUnitCost" NUMERIC(10,4) NOT NULL DEFAULT 0,
  ADD COLUMN "operationSupplierProcessId" TEXT,
  ADD CONSTRAINT "quoteOperation_operationSupplierProcessId_fkey" FOREIGN KEY ("operationSupplierProcessId") REFERENCES "supplierProcess" ("id") ON DELETE SET NULL;


CREATE TYPE "processType" AS ENUM ('Inside', 'Outside', 'Inside and Outside');

ALTER TABLE "process"
  ADD COLUMN "processType" "processType" NOT NULL DEFAULT 'Inside';

CREATE OR REPLACE VIEW "workCenters" WITH(SECURITY_INVOKER=true) AS
  SELECT
     wc.*,
     l.name as "locationName",
     wcp.processes
  FROM "workCenter" wc
  LEFT JOIN location l 
  ON wc."locationId" = l.id
  LEFT JOIN (
    SELECT
      "workCenterId",
      jsonb_agg(jsonb_build_object('id', "processId", 'name', p.name)) as processes
    FROM "workCenterProcess" wcp
    INNER JOIN "process" p ON wcp."processId" = p.id
    GROUP BY "workCenterId"
  ) wcp ON wc.id = wcp."workCenterId";

CREATE OR REPLACE VIEW "processes" WITH(SECURITY_INVOKER=true) AS
  SELECT
    p.*,
    wcp."workCenters",
    sp."suppliers"
  FROM "process" p
  LEFT JOIN (
    SELECT 
      "processId",
      jsonb_agg(jsonb_build_object('id', "workCenterId", 'name', wc.name)) as "workCenters"
    FROM "workCenterProcess" wcp
    INNER JOIN "workCenter" wc ON wcp."workCenterId" = wc.id
    GROUP BY "processId"
  ) wcp ON p.id = wcp."processId"
  LEFT JOIN (
    SELECT 
      "processId",
      jsonb_agg(jsonb_build_object('id', sp."id", 'name', s.name)) as "suppliers"
    FROM "supplierProcess" sp
    INNER JOIN "supplier" s ON sp."supplierId" = s.id
    GROUP BY "processId"
  ) sp ON p.id = sp."processId";

CREATE OR REPLACE VIEW "quoteOperationsWithMakeMethods" WITH(SECURITY_INVOKER=true) AS
  SELECT 
    mm.id AS "makeMethodId",
    qo.*
  FROM "quoteOperation" qo
  INNER JOIN "quoteMakeMethod" qmm 
    ON qo."quoteMakeMethodId" = qmm.id
  LEFT JOIN "makeMethod" mm 
    ON qmm."itemId" = mm."itemId";


