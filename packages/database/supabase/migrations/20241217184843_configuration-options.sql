CREATE TABLE IF NOT EXISTS "configurationParameterGroup" (
  "id" TEXT NOT NULL DEFAULT xid(),
  "itemId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "sortOrder" DOUBLE PRECISION NOT NULL DEFAULT 1,
  "companyId" TEXT NOT NULL,
  CONSTRAINT "configurationParameterGroup_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "configurationParameterGroup_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "item"("id"),
  CONSTRAINT "configurationParameterGroup_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id")
);

CREATE TYPE "configurationParameterDataType" AS ENUM ('text', 'numeric', 'boolean', 'list');
CREATE TABLE IF NOT EXISTS "configurationParameter" (
  "id" TEXT NOT NULL DEFAULT xid(),
  "itemId" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "dataType" "configurationParameterDataType" NOT NULL,
  "listOptions" TEXT[],
  "configurationParameterGroupId" TEXT,
  "sortOrder" DOUBLE PRECISION NOT NULL DEFAULT 1,
  "companyId" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
  "createdBy" TEXT NOT NULL,
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  "updatedBy" TEXT,

  CONSTRAINT "configurationParameter_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "configurationParameter_itemId_key_unique" UNIQUE ("itemId", "key"),
  CONSTRAINT "configurationParameter_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "item"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "configurationParameter_configurationParameterGroupId_fkey" FOREIGN KEY ("configurationParameterGroupId") REFERENCES "configurationParameterGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "configurationParameter_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "configurationParameter_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user"("id") ON UPDATE CASCADE,
  CONSTRAINT "configurationParameter_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "user"("id") ON UPDATE CASCADE
);

CREATE INDEX "configurationParameter_itemId_idx" ON "configurationParameter" ("itemId");
CREATE INDEX "configurationParameter_companyId_idx" ON "configurationParameter" ("companyId");

ALTER TABLE "configurationParameter" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Employees with parts_view can view configuration options" ON "configurationParameter"
  FOR SELECT
  USING (
    has_role('employee', "companyId") AND 
    has_company_permission('parts_view', "companyId")
  );

CREATE POLICY "Employees with parts_create can insert configuration options" ON "configurationParameter"
  FOR INSERT
  WITH CHECK (   
    has_role('employee', "companyId") AND 
    has_company_permission('parts_create', "companyId")
);

CREATE POLICY "Employees with parts_update can update configuration options" ON "configurationParameter"
  FOR UPDATE
  USING (
    has_role('employee', "companyId") AND 
    has_company_permission('parts_update', "companyId")
  );

CREATE POLICY "Employees with parts_delete can delete configuration options" ON "configurationParameter"
  FOR DELETE
  USING (
    has_role('employee', "companyId") AND 
    has_company_permission('parts_delete', "companyId")
  );

CREATE POLICY "Requests with an API key can access configuration options" ON "configurationParameter"
FOR ALL USING (
  has_valid_api_key_for_company("companyId")
);

-- Find duplicate makeMethodId and description combinations
-- SELECT c."name", i."readableId"
-- FROM item i 
-- INNER JOIN "makeMethod" mm ON i.id = mm."itemId"
-- INNER JOIN 
-- (
-- SELECT "makeMethodId", "description", COUNT(*) 
-- FROM "methodOperation"
-- GROUP BY "makeMethodId", "description"
-- HAVING COUNT(*) > 1
-- ) dups ON dups."makeMethodId" = mm."id"
-- INNER JOIN "company" c ON c.id = i."companyId"


DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'methodOperation_makeMethodId_description_unique'
  ) THEN
    ALTER TABLE "methodOperation" 
    ADD CONSTRAINT "methodOperation_makeMethodId_description_unique" UNIQUE ("makeMethodId", "description");
  END IF;
END $$;
