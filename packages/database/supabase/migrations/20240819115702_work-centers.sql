CREATE TABLE "process" (
  "id" TEXT NOT NULL DEFAULT xid(),
  "name" TEXT NOT NULL,
  "defaultStandardFactor" factor NOT NULL,
  "companyId" TEXT NOT NULL,
  "customFields" JSONB,
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedBy" TEXT,
  "updatedAt" TIMESTAMPTZ,

  CONSTRAINT "process_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "process_name_companyId_key" UNIQUE ("name", "companyId"),
  CONSTRAINT "process_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company" ("id") ON DELETE CASCADE,
  CONSTRAINT "process_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user" ("id") ON DELETE RESTRICT,
  CONSTRAINT "process_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "user" ("id") ON DELETE SET NULL
);

ALTER TABLE "process" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Employees can view processes" ON "process"
  FOR SELECT
  USING (
    has_role('employee', "companyId") AND
    "companyId" = ANY(
      select "companyId" from "userToCompany" where "userId" = auth.uid()::text
    )
  );

CREATE POLICY "Employees with resources_create can insert processes" ON "process"
  FOR INSERT
  WITH CHECK (   
    has_role('employee', "companyId") AND
    has_company_permission('resources_create', "companyId")
);

CREATE POLICY "Employees with resources_update can update processes" ON "process"
  FOR UPDATE
  USING (
    has_role('employee', "companyId") AND
    has_company_permission('resources_update', "companyId")
  );

CREATE POLICY "Employees with resources_delete can delete processes" ON "process"
  FOR DELETE
  USING (
    has_role('employee', "companyId") AND
    has_company_permission('resources_delete', "companyId")
  );


CREATE TABLE "workCenter" (
  "id" TEXT NOT NULL DEFAULT xid(),
  "name" TEXT NOT NULL,
  "description" TEXT,
  "quotingRate" NUMERIC NOT NULL DEFAULT 0,
  "laborRate" NUMERIC NOT NULL DEFAULT 0,
  "overheadRate" NUMERIC GENERATED ALWAYS AS ("quotingRate" - "laborRate") STORED,
  "defaultStandardFactor" factor NOT NULL DEFAULT 'Minutes/Piece',
  "locationId" TEXT,
  "requiredAbilityId" TEXT,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "companyId" TEXT NOT NULL,
  "customFields" JSONB,
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedBy" TEXT,
  "updatedAt" TIMESTAMPTZ,

  CONSTRAINT "workCenter_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "workCenter_name_companyId_key" UNIQUE ("name", "companyId"),
  CONSTRAINT "workCenter_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "location" ("id") ON DELETE CASCADE,
  CONSTRAINT "workCenter_requiredAbilityId_fkey" FOREIGN KEY ("requiredAbilityId") REFERENCES "ability" ("id") ON DELETE CASCADE,
  CONSTRAINT "workCenter_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company" ("id") ON DELETE CASCADE,
  CONSTRAINT "workCenter_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user" ("id") ON DELETE RESTRICT,
  CONSTRAINT "workCenter_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "user" ("id") ON DELETE SET NULL
);

ALTER TABLE "workCenter" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Employees can view work centers" ON "workCenter"
  FOR SELECT
  USING (
    has_role('employee', "companyId") AND
    "companyId" = ANY(
      select "companyId" from "userToCompany" where "userId" = auth.uid()::text
    )
  );

CREATE POLICY "Employees with resources_create can insert work centers" ON "workCenter"
  FOR INSERT
  WITH CHECK (   
    has_role('employee', "companyId") AND
    has_company_permission('resources_create', "companyId")
);

CREATE POLICY "Employees with resources_update can update work centers" ON "workCenter"
  FOR UPDATE
  USING (
    has_role('employee', "companyId") AND
    has_company_permission('resources_update', "companyId")
  );

CREATE POLICY "Employees with resources_delete can delete work centers" ON "workCenter"
  FOR DELETE
  USING (
    has_role('employee', "companyId") AND
    has_company_permission('resources_delete', "companyId")
  );

-- work centers can have multiple processes
CREATE TABLE "workCenterProcess" (
  "workCenterId" TEXT NOT NULL,
  "processId" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedBy" TEXT,
  "updatedAt" TIMESTAMPTZ,

  CONSTRAINT "workCenterProcess_pkey" PRIMARY KEY ("workCenterId", "processId"),
  CONSTRAINT "workCenterProcess_workCenterId_fkey" FOREIGN KEY ("workCenterId") REFERENCES "workCenter" ("id") ON DELETE CASCADE,
  CONSTRAINT "workCenterProcess_processId_fkey" FOREIGN KEY ("processId") REFERENCES "process" ("id") ON DELETE CASCADE,
  CONSTRAINT "workCenterProcess_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company" ("id") ON DELETE CASCADE,
  CONSTRAINT "workCenterProcess_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user" ("id") ON DELETE RESTRICT,
  CONSTRAINT "workCenterProcess_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "user" ("id") ON DELETE SET NULL
);

ALTER TABLE "workCenterProcess" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Employees can view work center/processes" ON "workCenterProcess"  
  FOR SELECT
  USING (
    has_role('employee', "companyId") AND
    "companyId" = ANY(
      select "companyId" from "userToCompany" where "userId" = auth.uid()::text
    )
  );

CREATE POLICY "Employees with resources_create can insert work center/processes" ON "workCenterProcess"
  FOR INSERT
  WITH CHECK (   
    has_role('employee', "companyId") AND
    has_company_permission('resources_create', "companyId")
);

CREATE POLICY "Employees with resources_update can update work center/processes" ON "workCenterProcess"
  FOR UPDATE
  USING (
    has_role('employee', "companyId") AND
    has_company_permission('resources_update', "companyId")
  );

CREATE POLICY "Employees with resources_delete can delete work center/processes" ON "workCenterProcess"
  FOR DELETE
  USING (
    has_role('employee', "companyId") AND
    has_company_permission('resources_delete', "companyId")
  );

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
    wcp."workCenters"
  FROM "process" p
  LEFT JOIN (
    SELECT 
      "processId",
      jsonb_agg(jsonb_build_object('id', "workCenterId", 'name', wc.name)) as "workCenters"
    FROM "workCenterProcess" wcp
    INNER JOIN "workCenter" wc ON wcp."workCenterId" = wc.id
    GROUP BY "processId"
  ) wcp ON p.id = wcp."processId";
  
  

DELETE FROM "customFieldTable" WHERE "table" = 'workCell';
DELETE FROM "customFieldTable" WHERE "table" = 'workCellType';
DELETE FROM "customFieldTable" WHERE "table" = 'equipmentType';
DELETE FROM "customFieldTable" WHERE "table" = 'equipment';

INSERT INTO "customFieldTable" ("table", "name", "module")
VALUES 
('process', 'Process', 'Resources'),
('workCenter', 'Work Center', 'Resources');

ALTER TABLE "methodOperation" 
  DROP COLUMN "workCellTypeId",
  DROP COLUMN "equipmentTypeId",
  DROP COLUMN "setupHours",
  DROP COLUMN "standardFactor",
  DROP COLUMN "productionStandard";

DROP VIEW "quoteOperationsWithMakeMethods";

COMMIT;

ALTER TABLE "quoteOperation" 
  DROP COLUMN "workCellTypeId",
  DROP COLUMN "equipmentTypeId",
  DROP COLUMN "setupHours",
  DROP COLUMN "standardFactor",
  DROP COLUMN "productionStandard";

ALTER TABLE "employeeJob" DROP COLUMN "workCellId";

DROP TABLE "equipment";
DROP TABLE "equipmentType";
DROP TABLE "crewAbility";
DROP TABLE "crew";
DROP TABLE "workCell";
DROP TABLE "workCellType";

ALTER TABLE "methodOperation" 
  ADD COLUMN "processId" TEXT NOT NULL,
  ADD CONSTRAINT "methodOperation_processId_fkey" FOREIGN KEY ("processId") REFERENCES "process" ("id") ON DELETE RESTRICT,
  ADD COLUMN "workCenterId" TEXT,
  ADD CONSTRAINT "methodOperation_workCenterId_fkey" FOREIGN KEY ("workCenterId") REFERENCES "workCenter" ("id") ON DELETE RESTRICT,
  ADD COLUMN "setupTime" NUMERIC(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN "setupUnit" factor NOT NULL DEFAULT 'Total Hours',
  ADD COLUMN "laborTime" NUMERIC(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN "laborUnit" factor NOT NULL DEFAULT 'Hours/Piece',
  ADD COLUMN "machineTime" NUMERIC(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN "machineUnit" factor NOT NULL DEFAULT 'Hours/Piece';

ALTER TABLE "quoteOperation" 
  ADD COLUMN "processId" TEXT NOT NULL,
  ADD CONSTRAINT "quoteOperation_processId_fkey" FOREIGN KEY ("processId") REFERENCES "process" ("id") ON DELETE RESTRICT,
  ADD COLUMN "workCenterId" TEXT,
  ADD CONSTRAINT "quoteOperation_workCenterId_fkey" FOREIGN KEY ("workCenterId") REFERENCES "workCenter" ("id") ON DELETE RESTRICT,
  ADD COLUMN "setupTime" NUMERIC(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN "setupUnit" factor NOT NULL DEFAULT 'Total Hours',
  ADD COLUMN "laborTime" NUMERIC(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN "laborUnit" factor NOT NULL DEFAULT 'Hours/Piece',
  ADD COLUMN "machineTime" NUMERIC(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN "machineUnit" factor NOT NULL DEFAULT 'Hours/Piece';


CREATE OR REPLACE VIEW "quoteOperationsWithMakeMethods" WITH(SECURITY_INVOKER=true) AS
  SELECT 
    mm.id AS "makeMethodId",
    qo.*
  FROM "quoteOperation" qo
  INNER JOIN "quoteMakeMethod" qmm 
    ON qo."quoteMakeMethodId" = qmm.id
  LEFT JOIN "makeMethod" mm 
    ON qmm."itemId" = mm."itemId";