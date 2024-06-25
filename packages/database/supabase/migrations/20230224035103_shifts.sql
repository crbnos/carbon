CREATE TABLE "location" (
  "id" TEXT NOT NULL DEFAULT xid(),
  "name" TEXT NOT NULL,
  "addressLine1" TEXT NOT NULL,
  "addressLine2" TEXT,
  "city" TEXT NOT NULL,
  "state" TEXT NOT NULL,
  "postalCode" TEXT NOT NULL,
  "countryCode" TEXT,
  "timezone" TEXT NOT NULL,
  "latitude" NUMERIC,
  "longitude" NUMERIC,
  "companyId" TEXT NOT NULL,
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
  "updatedBy" TEXT,
  "updatedAt" TIMESTAMP,
  "customFields" JSONB,

  CONSTRAINT "location_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "location_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "location_name_unique" UNIQUE ("name", "companyId")
);

CREATE INDEX "location_name_idx" ON "location" ("name");
CREATE INDEX "location_companyId_idx" ON "location" ("companyId");

ALTER TABLE "location" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Employees can view locations for their companies" ON "location"
  FOR SELECT
  USING (
    has_role('employee', "companyId") 
    AND "companyId" = ANY(
      select "companyId" from "userToCompany" where "userId" = auth.uid()::text
    )
  );

CREATE POLICY "Employees with resources_create can insert locations" ON "location"
  FOR INSERT
  WITH CHECK (   
    has_company_permission('resources_create', "companyId")
    AND has_role('employee', "companyId")
);

CREATE POLICY "Employees with resources_update can update locations" ON "location"
  FOR UPDATE
  USING (
    has_company_permission('resources_update', "companyId")
    AND has_role('employee', "companyId")
  );

CREATE POLICY "Employees with resources_delete can delete locations" ON "location"
  FOR DELETE
  USING (
    has_company_permission('resources_delete', "companyId")
    AND has_role('employee', "companyId")
  );


CREATE TABLE "shift" (
  "id" TEXT NOT NULL DEFAULT xid(),
  "name" TEXT NOT NULL,
  "startTime" TIME NOT NULL,
  "endTime" TIME NOT NULL,
  "locationId" TEXT NOT NULL,
  "sunday" BOOLEAN NOT NULL DEFAULT false,
  "monday" BOOLEAN NOT NULL DEFAULT false,
  "tuesday" BOOLEAN NOT NULL DEFAULT false,
  "wednesday" BOOLEAN NOT NULL DEFAULT false,
  "thursday" BOOLEAN NOT NULL DEFAULT false,
  "friday" BOOLEAN NOT NULL DEFAULT false,
  "saturday" BOOLEAN NOT NULL DEFAULT false,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "companyId" TEXT NOT NULL,
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
  "updatedBy" TEXT,
  "updatedAt" TIMESTAMP,
  "customFields" JSONB,
  
  CONSTRAINT "shifts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "shifts_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "location"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "shifts_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "shifts_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "shifts_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "shift_companyId_idx" ON "shift" ("companyId");

ALTER TABLE "shift" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Employees can view shifts" ON "shift"
  FOR SELECT
  USING (
    has_role('employee', "companyId") AND
    "companyId" = ANY(
      select "companyId" from "userToCompany" where "userId" = auth.uid()::text
    )
  );

CREATE POLICY "Employees with resources_create can insert shifts" ON "shift"
  FOR INSERT
  WITH CHECK (   
    has_role('employee', "companyId") AND
    has_company_permission('resources_create', "companyId")
);

CREATE POLICY "Employees with resources_update can update shifts" ON "shift"
  FOR UPDATE
  USING (
    has_role('employee', "companyId") AND
    has_company_permission('resources_update', "companyId")
  );

CREATE POLICY "Employees with resources_delete can delete shifts" ON "shift"
  FOR DELETE
  USING (
    has_role('employee', "companyId") AND
    has_company_permission('resources_delete', "companyId")
  );


CREATE TABLE "employeeShift" (
  "id" TEXT NOT NULL DEFAULT xid(),
  "employeeId" TEXT NOT NULL,
  "shiftId" TEXT NOT NULL,

  CONSTRAINT "employeeShift_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "employeeShift_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "employeeShift_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "shift"("id") ON DELETE CASCADE ON UPDATE CASCADE,

  CONSTRAINT uq_employeeShift_employeeId_shiftId UNIQUE ( "employeeId", "shiftId")
);

ALTER TABLE "employeeShift" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Employees can view employee shifts" ON "employeeShift"
  FOR SELECT
  USING (
    has_role('employee', get_company_id_from_foreign_key("employeeId", 'employee')) AND
    has_company_permission('resources_view', get_company_id_from_foreign_key("employeeId", 'employee'))
  );

CREATE POLICY "Employees with resources_create can insert employee shifts" ON "employeeShift"
  FOR INSERT
  WITH CHECK (   
    has_role('employee', get_company_id_from_foreign_key("employeeId", 'employee')) AND
    has_company_permission('resources_create', get_company_id_from_foreign_key("employeeId", 'employee'))
);

CREATE POLICY "Employees with resources_update can update employee shifts" ON "employeeShift"
  FOR UPDATE
  USING (
    has_role('employee', get_company_id_from_foreign_key("employeeId", 'employee')) AND
    has_company_permission('resources_update', get_company_id_from_foreign_key("employeeId", 'employee'))
  );

CREATE POLICY "Employees with resources_delete can delete employee shifts" ON "employeeShift"
  FOR DELETE
  USING (
    has_role('employee', get_company_id_from_foreign_key("employeeId", 'employee')) AND
    has_company_permission('resources_delete', get_company_id_from_foreign_key("employeeId", 'employee'))
  );


CREATE TABLE "employeeJob" (
  "id" TEXT NOT NULL,
  "locationId" TEXT,
  "shiftId" TEXT,
  "managerId" TEXT,
  "title" TEXT,
  "startDate" DATE,
  "companyId" TEXT NOT NULL,
  "updatedAt" TIMESTAMP,
  "updatedBy" TEXT,
  "customFields" JSONB,

  CONSTRAINT "employeeJob_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "employeeJob_id_fkey" FOREIGN KEY ("id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "employeeJob_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "location"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "employeeJob_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "shift"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "employeeJob_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "employeeJob_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "employeeJob_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

ALTER TABLE "employeeJob" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Employees can view employee jobs" ON "employeeJob"
  FOR SELECT
  USING (
    has_role('employee', "companyId") AND 
    "companyId" = ANY(
        SELECT "companyId" from "userToCompany" where "userId" = auth.uid()::text
    )
  );

CREATE POLICY "Employees with resources_create can insert employee jobs" ON "employeeJob"
  FOR INSERT
  WITH CHECK (   
    has_role('employee', "companyId") AND
    has_company_permission('resources_create', "companyId")
);

CREATE POLICY "Employees with resources_update can update employee jobs" ON "employeeJob"
  FOR UPDATE
  USING (
    has_role('employee', "companyId") AND
    has_company_permission('resources_create', "companyId")
  );

CREATE POLICY "Employees with resources_delete can delete employee jobs" ON "employeeJob"
  FOR DELETE
  USING (
    has_role('employee', "companyId") AND
    has_company_permission('resources_delete', "companyId")
  );


  CREATE OR REPLACE VIEW "shifts" WITH(SECURITY_INVOKER=true) AS
    SELECT
      s.*, l."name" as "locationName"
    FROM "shift" s
    LEFT JOIN "location" l ON s."locationId" = l."id";