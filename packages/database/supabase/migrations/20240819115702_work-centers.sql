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
  "companyId" TEXT NOT NULL,
  "customFields" JSONB,
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedBy" TEXT,
  "updatedAt" TIMESTAMPTZ,

  CONSTRAINT "workCenter_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "workCenter_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "location" ("id") ON DELETE CASCADE,
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