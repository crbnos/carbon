CREATE TABLE IF NOT EXISTS "configurationOptionGroup" (
  "id" TEXT NOT NULL DEFAULT xid(),
  "itemId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  CONSTRAINT "configurationOptionGroup_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "configurationOptionGroup_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "item"("id"),
  CONSTRAINT "configurationOptionGroup_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id")
);

CREATE TYPE "configurationOptionDataType" AS ENUM ('text', 'numeric', 'boolean', 'list');
CREATE TABLE IF NOT EXISTS "configurationOption" (
  "itemId" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "dataType" "configurationOptionDataType" NOT NULL,
  "listOptions" TEXT[],
  "configurationOptionGroupId" TEXT NOT NULL,
  "sortOrder" INTEGER NOT NULL DEFAULT 1,
  "companyId" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
  "createdBy" TEXT NOT NULL,
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  "updatedBy" TEXT,

  CONSTRAINT "configurationOption_pkey" PRIMARY KEY ("itemId", "key"),
  CONSTRAINT "configurationOption_itemId_label_key" UNIQUE ("itemId", "label"),
  CONSTRAINT "configurationOption_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "item"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "configurationOption_configurationOptionGroupId_fkey" FOREIGN KEY ("configurationOptionGroupId") REFERENCES "configurationOptionGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "configurationOption_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "configurationOption_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user"("id") ON UPDATE CASCADE,
  CONSTRAINT "configurationOption_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "user"("id") ON UPDATE CASCADE
);

CREATE INDEX "configurationOption_itemId_idx" ON "configurationOption" ("itemId");
CREATE INDEX "configurationOption_companyId_idx" ON "configurationOption" ("companyId");

ALTER TABLE "configurationOption" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Employees with parts_view can view configuration options" ON "configurationOption"
  FOR SELECT
  USING (
    has_role('employee', "companyId") AND 
    has_company_permission('parts_view', "companyId")
  );

CREATE POLICY "Employees with parts_create can insert configuration options" ON "configurationOption"
  FOR INSERT
  WITH CHECK (   
    has_role('employee', "companyId") AND 
    has_company_permission('parts_create', "companyId")
);

CREATE POLICY "Employees with parts_update can update configuration options" ON "configurationOption"
  FOR UPDATE
  USING (
    has_role('employee', "companyId") AND 
    has_company_permission('parts_update', "companyId")
  );

CREATE POLICY "Employees with parts_delete can delete configuration options" ON "configurationOption"
  FOR DELETE
  USING (
    has_role('employee', "companyId") AND 
    has_company_permission('parts_delete', "companyId")
  );

CREATE POLICY "Requests with an API key can access configuration options" ON "configurationOption"
FOR ALL USING (
  has_valid_api_key_for_company("companyId")
);

