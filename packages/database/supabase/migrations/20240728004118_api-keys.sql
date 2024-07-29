CREATE TABLE "apiKey" (
  "id" TEXT NOT NULL DEFAULT xid(),
  "name" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),

  CONSTRAINT "apiKey_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "apiKey_key_key" UNIQUE ("key"),
  CONSTRAINT "apiKey_name_companyId_key" UNIQUE ("name", "companyId"),
  CONSTRAINT "apiKey_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE,
  CONSTRAINT "apiKey_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user"("id") ON DELETE CASCADE
);

ALTER TABLE "apiKey" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Employees with users_update can create/modify API keys" ON "apiKey"
FOR ALL USING (
  has_role('employee', "companyId") AND 
  has_company_permission('users_update', "companyId")
);

CREATE OR REPLACE FUNCTION has_valid_api_key_for_company(company TEXT) RETURNS "bool"
  LANGUAGE "plpgsql" SECURITY DEFINER
  AS $$
  DECLARE
    has_valid_key boolean;
  BEGIN
    SELECT EXISTS(SELECT 1 FROM "apiKey" WHERE "key" = ((current_setting('request.headers'::text, true))::json ->> 'api-key'::text) AND "companyId" = company) INTO has_valid_key;
    RETURN has_valid_key;
  END;
$$;

CREATE OR REPLACE FUNCTION get_company_id_from_api_key() RETURNS TEXT
  LANGUAGE "plpgsql" SECURITY DEFINER
  AS $$
  DECLARE
      company_id TEXT;
  BEGIN
      SELECT "companyId" INTO company_id FROM "apiKey" WHERE "key" = ((current_setting('request.headers'::text, true))::json ->> 'api-key'::text);
      RETURN company_id;
  END;
$$;

NOTIFY pgrst, 'reload schema';

CREATE POLICY "Requests with an API key can access abilities" ON "ability"
FOR ALL USING (
  has_valid_api_key_for_company("companyId")
);

CREATE POLICY "Requests with an API key can access accounts" ON "account"
FOR ALL USING (
  has_valid_api_key_for_company("companyId")
);

CREATE POLICY "Requests with an API key can access account categories" ON "accountCategory"
FOR ALL USING (
  has_valid_api_key_for_company("companyId")
);


CREATE POLICY "Requests with an API key can access account default" ON "accountDefault"
FOR ALL USING (
  has_valid_api_key_for_company("companyId")
);

CREATE POLICY "Requests with an API can access account subcategories" ON "accountSubcategory"
FOR ALL USING (
  has_valid_api_key_for_company(get_company_id_from_foreign_key("accountCategoryId", 'accountCategory'))
);

-- Forgot to add these earlier
ALTER TABLE "accountingPeriod" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Employees with accounting_view can view accounting periods" ON "accountingPeriod"
FOR SELECT USING (
  has_role('employee', "companyId") AND 
  has_company_permission('accounting_view', "companyId")
);

CREATE POLICY "Employees with accounting_create can create accounting periods" ON "accountingPeriod"
FOR INSERT WITH CHECK (
  has_role('employee', "companyId") AND 
  has_company_permission('accounting_create', "companyId")
);

CREATE POLICY "Employees with accounting_update can create accounting periods" ON "accountingPeriod"
FOR UPDATE USING (
  has_role('employee', "companyId") AND 
  has_company_permission('accounting_update', "companyId")
);

CREATE POLICY "Employees with accounting_delete can create accounting periods" ON "accountingPeriod"
FOR DELETE USING (
  has_role('employee', "companyId") AND 
  has_company_permission('accounting_delete', "companyId")
);

CREATE POLICY "Requests with an API key can access accounting periods" ON "accountingPeriod"
FOR ALL USING (
  has_valid_api_key_for_company("companyId")
);

CREATE POLICY "Requests with an API key can access buy methods" ON "buyMethod"
FOR ALL USING (
  has_valid_api_key_for_company("companyId")
);

CREATE POLICY "Requests with an API key can access companies" ON "company"
FOR ALL USING (
  has_valid_api_key_for_company("id")
);

CREATE POLICY "Requests with an API key can access company integrations" ON "companyIntegration"
FOR ALL USING (
  has_valid_api_key_for_company("companyId")
);

CREATE POLICY "Requests with an API key can access consumables" ON "consumable"
FOR ALL USING (
  has_valid_api_key_for_company("companyId")
);

CREATE POLICY "Requests with an API key can view customer contacts" ON "contact"
FOR ALL USING (
  has_valid_api_key_for_company("companyId")
);