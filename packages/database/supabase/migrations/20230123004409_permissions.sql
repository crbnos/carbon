
CREATE TYPE module AS ENUM (
  'Accounting',
  'Documents',
  'Invoicing',
  'Inventory',
  'Jobs',
  'Messaging',
  'Parts',
  'Purchasing',
  'Resources',
  'Sales',
  'Settings',
  'Scheduling',
  'Timecards',
  'Users'
);

CREATE VIEW "modules" AS
    SELECT unnest(enum_range(NULL::module)) AS name;


CREATE TABLE "employeeTypePermission" (
    "employeeTypeId" TEXT NOT NULL,
    "module" module NOT NULL,
    "create" TEXT[] NOT NULL DEFAULT '{}',
    "delete" TEXT[] NOT NULL DEFAULT '{}',
    "update" TEXT[] NOT NULL DEFAULT '{}',
    "view" TEXT[] NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "updatedAt" TIMESTAMP WITH TIME ZONE,

    CONSTRAINT "employeeTypePermission_pkey" PRIMARY KEY ("employeeTypeId", "module"),
    CONSTRAINT "employeeTypePermission_employeeTypeId_fkey" FOREIGN KEY ("employeeTypeId") REFERENCES "employeeType"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

ALTER TABLE "employeeTypePermission" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Employees with users_update can view/modify permissions for employee type permissions" ON "employeeTypePermission" FOR ALL USING (
  has_role('employee', get_company_id_from_foreign_key("employeeTypeId", 'employeeType')) AND
  has_company_permission('users_update', get_company_id_from_foreign_key("employeeTypeId", 'employeeType'))
);


