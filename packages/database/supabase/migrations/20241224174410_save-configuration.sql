CREATE POLICY "Employees with parts_view can view configuration groups" ON "configurationParameterGroup"
  FOR SELECT
  USING (
    has_role('employee', "companyId") AND 
    has_company_permission('parts_view', "companyId")
  );

CREATE POLICY "Employees with parts_create can insert configuration groups" ON "configurationParameterGroup"
  FOR INSERT
  WITH CHECK (   
    has_role('employee', "companyId") AND 
    has_company_permission('parts_create', "companyId")
);

CREATE POLICY "Employees with parts_update can update configuration groups" ON "configurationParameterGroup"
  FOR UPDATE
  USING (
    has_role('employee', "companyId") AND 
    has_company_permission('parts_update', "companyId")
  );

CREATE POLICY "Employees with parts_delete can delete configuration groups" ON "configurationParameterGroup"
  FOR DELETE
  USING (
    has_role('employee', "companyId") AND 
    has_company_permission('parts_delete', "companyId")
  );

CREATE POLICY "Requests with an API key can access configuration groups" ON "configurationParameterGroup"
FOR ALL USING (
  has_valid_api_key_for_company("companyId")
);

CREATE TABLE "configurationRule" (
  "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
  "itemId" TEXT NOT NULL,
  "field" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  "createdBy" TEXT NOT NULL,
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  "updatedBy" TEXT,

  CONSTRAINT "configurationRule_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "configurationRule_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "item"("id") ON DELETE CASCADE,
  CONSTRAINT "configurationRule_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE,
  CONSTRAINT "configurationRule_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user"("id") ON DELETE CASCADE,
  CONSTRAINT "configurationRule_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "user"("id") ON DELETE CASCADE
);

CREATE INDEX "configurationRule_itemId_idx" ON "configurationRule" ("itemId");
CREATE INDEX "configurationRule_companyId_idx" ON "configurationRule" ("companyId");

ALTER TABLE "configurationRule" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Employees with parts_view can view configuration rules" ON "configurationRule"
  FOR SELECT
  USING (
    has_role('employee', "companyId") AND 
    has_company_permission('parts_view', "companyId")
  );

CREATE POLICY "Employees with parts_create can insert configuration rules" ON "configurationRule"
  FOR INSERT
  WITH CHECK (   
    has_role('employee', "companyId") AND 
    has_company_permission('parts_create', "companyId")
  );


CREATE POLICY "Employees with parts_update can update configuration rules" ON "configurationRule"
  FOR UPDATE
  USING (
    has_role('employee', "companyId") AND 
    has_company_permission('parts_update', "companyId")
  );


CREATE POLICY "Employees with parts_delete can delete configuration rules" ON "configurationRule"
  FOR DELETE
  USING (
    has_role('employee', "companyId") AND 
    has_company_permission('parts_delete', "companyId")
  );

CREATE POLICY "Requests with an API key can access configuration rules" ON "configurationRule"
FOR ALL USING (
  has_valid_api_key_for_company("companyId")
);