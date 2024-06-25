
CREATE TABLE "customFieldTable" (
  "table" TEXT NOT NULL,
  "module" module NOT NULL,
  "name" TEXT NOT NULL,

  CONSTRAINT "customFieldTable_pkey" PRIMARY KEY ("table"),
  CONSTRAINT "customFieldTable_name_key" UNIQUE ("name")
);

CREATE INDEX "customFieldTable_module_idx" ON "customFieldTable" ("module");

ALTER TABLE "customFieldTable" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view custom field tables" ON "customFieldTable"
  FOR SELECT
  USING (
    auth.role() = 'authenticated'
  );

CREATE TABLE "customField" (
  "id" TEXT NOT NULL DEFAULT xid(),
  "name" TEXT NOT NULL,
  "sortOrder" INTEGER NOT NULL DEFAULT 1,
  "table" TEXT NOT NULL,
  "dataTypeId" INTEGER NOT NULL,
  "listOptions" TEXT ARRAY,
  "active" BOOLEAN DEFAULT TRUE,
  "companyId" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
  "createdBy" TEXT NOT NULL,
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  "updatedBy" TEXT,

  CONSTRAINT "customField_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "customField_customFieldTable_name_key" UNIQUE ("table", "name", "companyId"),
  CONSTRAINT "customField_customFieldTable_fkey" FOREIGN KEY ("table") REFERENCES "customFieldTable"("table") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "customField_dataTypeId_fkey" FOREIGN KEY ("dataTypeId") REFERENCES "attributeDataType"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "customField_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "customField_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user"("id") ON UPDATE CASCADE,
  CONSTRAINT "customField_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "user"("id") ON UPDATE CASCADE
);

ALTER TABLE "customField" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Employees can view custom fields" ON "customField"
  FOR SELECT
  USING (
    has_role('employee', "companyId")
  );

CREATE POLICY "Employees with settings_create can insert custom fields" ON "customField"
  FOR INSERT
  WITH CHECK (   
    has_role('employee', "companyId") AND
    has_company_permission('settings_create', "companyId")
  );

CREATE POLICY "Employees with settings_update can update custom fields" ON "customField"
  FOR UPDATE
  USING (
    has_role('employee', "companyId") AND
    has_company_permission('settings_update', "companyId")
  );

CREATE POLICY "Employees with settings_delete can delete custom fields" ON "customField"
  FOR DELETE
  USING (
    has_role('employee', "companyId") AND
    has_company_permission('settings_delete', "companyId")
  );

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