CREATE OR REPLACE FUNCTION get_companies_with_any_role() RETURNS text[] LANGUAGE "plpgsql" SECURITY DEFINER
SET
  search_path = public AS $$
DECLARE
  user_companies text[];
  api_key_company text;
BEGIN
  api_key_company := get_company_id_from_api_key();

  -- If API key exists for a company, add it to results
  IF api_key_company IS NOT NULL THEN
    RETURN ARRAY[api_key_company];
  END IF;

  SELECT array_agg("companyId"::text)
  INTO user_companies
  FROM "userToCompany"
  WHERE "userId" = auth.uid()::text;

  RETURN user_companies;
END;
$$;

CREATE OR REPLACE FUNCTION get_companies_with_employee_role() RETURNS text[] LANGUAGE "plpgsql" SECURITY DEFINER
SET
  search_path = public AS $$
DECLARE
  user_companies text[];
  api_key_company text;
BEGIN
  api_key_company := get_company_id_from_api_key();

  -- If API key exists for a company, add it to results
  IF api_key_company IS NOT NULL THEN
    RETURN ARRAY[api_key_company];
  END IF;

  SELECT array_agg("companyId"::text)
  INTO user_companies
  FROM "userToCompany"
  WHERE "userId" = auth.uid()::text AND "role" = 'employee';

  RETURN user_companies;
END;
$$;


CREATE OR REPLACE FUNCTION get_companies_with_employee_permission (permission text) RETURNS text[] LANGUAGE "plpgsql" SECURITY DEFINER
SET
  search_path = public AS $$
DECLARE
  permission_companies text[];
  api_key_company text;
  employee_companies text[];
BEGIN
  api_key_company := get_company_id_from_api_key();

  -- If API key exists for a company, add it to results
  IF api_key_company IS NOT NULL THEN
    RETURN ARRAY[api_key_company];
  END IF;

  -- Get companies where user is an employee
  SELECT array_agg("companyId"::text)
  INTO employee_companies
  FROM "userToCompany" 
  WHERE "userId" = auth.uid()::text AND "role" = 'employee';

  -- Get companies from user permissions
  SELECT jsonb_to_text_array(COALESCE(permissions->permission, '[]')) 
  INTO permission_companies 
  FROM public."userPermission" 
  WHERE id::text = auth.uid()::text;

  -- Filter permission_companies to only include companies where user is employee
  IF permission_companies IS NOT NULL AND employee_companies IS NOT NULL THEN
    SELECT array_agg(company)
    INTO permission_companies
    FROM unnest(permission_companies) company
    WHERE company = ANY(employee_companies);
  ELSE
    permission_companies := '{}';
  END IF;

  -- Handle special case where user has global permission ('0')
  IF permission_companies IS NOT NULL AND '0'::text = ANY(permission_companies) THEN
    SELECT array_agg(id::text) 
    INTO permission_companies 
    FROM company
    WHERE id::text = ANY(employee_companies);
  END IF;

  RETURN permission_companies;
END;
$$;

CREATE OR REPLACE FUNCTION get_customer_ids_with_customer_permission (permission text) RETURNS text[] LANGUAGE "plpgsql" SECURITY DEFINER
SET
  search_path = public AS $$
DECLARE
  permission_companies text[];
  customer_company_ids text[];
  customer_ids text[];
BEGIN
  -- Get companies where user is a customer
  SELECT array_agg("companyId"::text)
  INTO customer_company_ids
  FROM "userToCompany" 
  WHERE "userId" = auth.uid()::text AND "role" = 'customer';

  -- Get companies from user permissions
  SELECT jsonb_to_text_array(COALESCE(permissions->permission, '[]')) 
  INTO permission_companies 
  FROM public."userPermission" up
  WHERE up.id::text = auth.uid()::text;

  -- Filter permission_companies to only include companies where user is customer
  IF permission_companies IS NOT NULL AND customer_company_ids IS NOT NULL THEN
    SELECT array_agg(company)
    INTO permission_companies
    FROM unnest(permission_companies) company
    WHERE company = ANY(customer_company_ids);
  ELSE
    permission_companies := '{}';
  END IF;

  -- Get customer IDs where company matches filtered permissions
  SELECT array_agg(c.id::text)
  INTO customer_ids
  FROM "customer" c
  WHERE c."companyId" = ANY(permission_companies);

  -- Get customer IDs from customer accounts
  SELECT array_agg(ca."customerId"::text)
  INTO customer_ids
  FROM "customerAccount" ca
  WHERE ca.id::uuid = auth.uid() AND ca."companyId" = ANY(customer_company_ids);

  RETURN customer_ids;
END;
$$;


-- ability

DROP POLICY IF EXISTS "Employees with resources_create can insert abilities" ON "public"."ability";
DROP POLICY IF EXISTS "Employees with resources_delete can delete abilities" ON "public"."ability";
DROP POLICY IF EXISTS "Employees with resources_update can update abilities" ON "public"."ability";
DROP POLICY IF EXISTS "Employees with resources_view can view abilities" ON "public"."ability";
DROP POLICY IF EXISTS "Requests with an API key can access abilities" ON "public"."ability";

CREATE POLICY "SELECT" ON "public"."ability"
FOR SELECT 
USING (
  "companyId" = ANY (
    SELECT DISTINCT unnest(ARRAY(
      SELECT unnest(get_companies_with_employee_permission('resources_view'))
      UNION
      SELECT unnest(get_companies_with_employee_permission('production_view'))
    ))
  )
);

CREATE POLICY "INSERT" ON "public"."ability"
FOR INSERT WITH CHECK (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('resources_create')
    )::text[]
  )
);

CREATE POLICY "UPDATE" ON "public"."ability"
FOR UPDATE USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('resources_update')
    )::text[]
  )
);

CREATE POLICY "DELETE" ON "public"."ability"
FOR DELETE USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('resources_delete')
    )::text[]
  )
);

-- account

DROP POLICY IF EXISTS "Certain employees can view accounts" ON "public"."account";
DROP POLICY IF EXISTS "Employees with accounting_create can insert accounts" ON "public"."account";
DROP POLICY IF EXISTS "Employees with accounting_delete can delete accounts" ON "public"."account";
DROP POLICY IF EXISTS "Employees with accounting_update can update accounts" ON "public"."account";
DROP POLICY IF EXISTS "Requests with an API key can access accounts" ON "public"."account";

CREATE POLICY "SELECT" ON "public"."account"
FOR SELECT 
USING (
  "companyId" = ANY (
    SELECT DISTINCT unnest(ARRAY(
      SELECT unnest(get_companies_with_employee_permission('resources_view'))
      UNION
      SELECT unnest(get_companies_with_employee_permission('production_view'))
      UNION
      SELECT unnest(get_companies_with_employee_permission('accounting_view'))
      UNION
      SELECT unnest(get_companies_with_employee_permission('parts_view'))
      UNION
      SELECT unnest(get_companies_with_employee_permission('sales_view'))
      UNION
      SELECT unnest(get_companies_with_employee_permission('purchasing_view'))
    ))
  )
);

CREATE POLICY "INSERT" ON "public"."account"
FOR INSERT WITH CHECK (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('accounting_create')
    )::text[]
  )
);

CREATE POLICY "UPDATE" ON "public"."account"
FOR UPDATE USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('accounting_update')
    )::text[]
  )
);

CREATE POLICY "DELETE" ON "public"."account"
FOR DELETE USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('accounting_delete')
    )::text[]
  )
);

-- account category

DROP POLICY IF EXISTS "Employees with accounting_create can insert account categories" ON "public"."accountCategory";
DROP POLICY IF EXISTS "Employees with accounting_delete can delete account categories" ON "public"."accountCategory";
DROP POLICY IF EXISTS "Employees with accounting_update can update account categories" ON "public"."accountCategory";
DROP POLICY IF EXISTS "Employees with accounting_view can view account categories" ON "public"."accountCategory";
DROP POLICY IF EXISTS "Requests with an API key can access account categories" ON "public"."accountCategory";

CREATE POLICY "SELECT" ON "public"."accountCategory"
FOR SELECT USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('accounting_view')
    )::text[]
  )
);

CREATE POLICY "INSERT" ON "public"."accountCategory"
FOR INSERT WITH CHECK (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('accounting_create')
    )::text[]
  )
);

CREATE POLICY "UPDATE" ON "public"."accountCategory"
FOR UPDATE USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('accounting_update')
    )::text[]
  )
);

CREATE POLICY "DELETE" ON "public"."accountCategory"
FOR DELETE USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('accounting_delete')
    )::text[]
  )
);

-- account default

DROP POLICY IF EXISTS "Employees with accounting_update can update account defaults" ON "public"."accountDefault";
DROP POLICY IF EXISTS "Employees with accounting_view can view account defaults" ON "public"."accountDefault";
DROP POLICY IF EXISTS "Requests with an API key can access account default" ON "public"."accountDefault";

CREATE POLICY "SELECT" ON "public"."accountDefault"
FOR SELECT USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('accounting_view')
    )::text[]
  )
);

CREATE POLICY "UPDATE" ON "public"."accountDefault"
FOR UPDATE USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('accounting_update')
    )::text[]
  )
);

-- account subcategory

DROP POLICY IF EXISTS "Employees with accounting_create can insert account subcategories" ON "public"."accountSubcategory";
DROP POLICY IF EXISTS "Employees with accounting_delete can delete account subcategories" ON "public"."accountSubcategory";
DROP POLICY IF EXISTS "Employees with accounting_update can update account subcategories" ON "public"."accountSubcategory";
DROP POLICY IF EXISTS "Employees with accounting_view can view account subcategories" ON "public"."accountSubcategory";
DROP POLICY IF EXISTS "Requests with an API can access account subcategories" ON "public"."accountSubcategory";

CREATE POLICY "SELECT" ON "public"."accountSubcategory"
FOR SELECT USING (
  get_company_id_from_foreign_key("accountCategoryId", 'accountCategory') = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('accounting_view')
    )::text[]
  )
);

CREATE POLICY "INSERT" ON "public"."accountSubcategory"
FOR INSERT WITH CHECK (
  get_company_id_from_foreign_key("accountCategoryId", 'accountCategory') = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('accounting_create')
    )::text[]
  )
);

CREATE POLICY "UPDATE" ON "public"."accountSubcategory"
FOR UPDATE USING (
  get_company_id_from_foreign_key("accountCategoryId", 'accountCategory') = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('accounting_update')
    )::text[]
  )
);

CREATE POLICY "DELETE" ON "public"."accountSubcategory"
FOR DELETE USING (
  get_company_id_from_foreign_key("accountCategoryId", 'accountCategory') = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('accounting_delete')
    )::text[]
  )
);

-- accounting period

DROP POLICY IF EXISTS "Employees with accounting_create can create accounting periods" ON "public"."accountingPeriod";
DROP POLICY IF EXISTS "Employees with accounting_delete can create accounting periods" ON "public"."accountingPeriod";
DROP POLICY IF EXISTS "Employees with accounting_update can create accounting periods" ON "public"."accountingPeriod";
DROP POLICY IF EXISTS "Employees with accounting_view can view accounting periods" ON "public"."accountingPeriod";
DROP POLICY IF EXISTS "Requests with an API key can access accounting periods" ON "public"."accountingPeriod";

CREATE POLICY "SELECT" ON "public"."accountingPeriod"
FOR SELECT USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('accounting_view')
    )::text[]
  )
);

CREATE POLICY "INSERT" ON "public"."accountingPeriod"
FOR INSERT WITH CHECK (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('accounting_create')
    )::text[]
  )
);

CREATE POLICY "UPDATE" ON "public"."accountingPeriod"
FOR UPDATE USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('accounting_update')
    )::text[]
  )
);

CREATE POLICY "DELETE" ON "public"."accountingPeriod"
FOR DELETE USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('accounting_delete')
    )::text[]
  )
);


-- address

DROP POLICY IF EXISTS "Employees with sales_create or purchasing_create can create addresses" ON "public"."address";
DROP POLICY IF EXISTS "Employees with sales_delete or purchasing_delete can delete addresses" ON "public"."address";
DROP POLICY IF EXISTS "Employees with sales_update or purchasing_update can update addresses" ON "public"."address";
DROP POLICY IF EXISTS "Employees with sales_view or purchasing_view can view addresses" ON "public"."address";
DROP POLICY IF EXISTS "Requests with an API key can access addresses" ON "public"."address";

CREATE POLICY "SELECT" ON "public"."address"
FOR SELECT  
USING (
  "companyId" = ANY (
    SELECT DISTINCT unnest(ARRAY(
      SELECT unnest(get_companies_with_employee_permission('sales_view'))
      UNION
      SELECT unnest(get_companies_with_employee_permission('purchasing_view'))
    ))
  ) 
);

CREATE POLICY "INSERT" ON "public"."address"
FOR INSERT  
WITH CHECK (
  "companyId" = ANY (
    SELECT DISTINCT unnest(ARRAY(
      SELECT unnest(get_companies_with_employee_permission('sales_create'))
      UNION
      SELECT unnest(get_companies_with_employee_permission('purchasing_create'))
    ))
  )
);

CREATE POLICY "UPDATE" ON "public"."address"
FOR UPDATE  
USING (
  "companyId" = ANY (
    SELECT DISTINCT unnest(ARRAY(
      SELECT unnest(get_companies_with_employee_permission('sales_update'))
      UNION
      SELECT unnest(get_companies_with_employee_permission('purchasing_update'))
    ))
  )
);

CREATE POLICY "DELETE" ON "public"."address"
FOR DELETE  
USING (
  "companyId" = ANY (
    SELECT DISTINCT unnest(ARRAY(
      SELECT unnest(get_companies_with_employee_permission('sales_delete'))
      UNION
      SELECT unnest(get_companies_with_employee_permission('purchasing_delete'))
    ))
  )
);

-- api key

DROP POLICY IF EXISTS "Employees with users_update can create/modify API keys" ON "public"."apiKey";

CREATE POLICY "ALL" ON "public"."apiKey"
FOR ALL 
USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('users_update')
    )::text[]
  )
);

-- batch number

DROP POLICY IF EXISTS "Anyone can view batch numbers" ON "public"."batchNumber";
DROP POLICY IF EXISTS "Employees with parts_create can insert batch numbers" ON "public"."batchNumber";
DROP POLICY IF EXISTS "Employees with parts_update can update batch numbers" ON "public"."batchNumber";
DROP POLICY IF EXISTS "Employees with parts_update can insert batch numbers" ON "public"."batchNumber";


CREATE POLICY "SELECT" ON "public"."batchNumber"
FOR SELECT  
USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_role()
    )::text[]
  )
);

CREATE POLICY "INSERT" ON "public"."batchNumber"
FOR INSERT 
WITH CHECK (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('inventory_create')
    )::text[]
  )
);

CREATE POLICY "UPDATE" ON "public"."batchNumber"
FOR UPDATE  
USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('inventory_update')
    )::text[]
  )
);


-- batch property

DROP POLICY IF EXISTS "Employees with inventory_create can insert batch parameters" ON "public"."batchProperty";
DROP POLICY IF EXISTS "Employees with inventory_delete can delete batch parameters" ON "public"."batchProperty";
DROP POLICY IF EXISTS "Employees with inventory_update can update batch parameters" ON "public"."batchProperty";
DROP POLICY IF EXISTS "Employees with inventory_view can view batch parameters" ON "public"."batchProperty";
DROP POLICY IF EXISTS "Requests with an API key can access batch parameters" ON "public"."batchProperty";

CREATE POLICY "SELECT" ON "public"."batchProperty" 
FOR SELECT  
USING (
  "companyId" = ANY (
    (
      SELECT DISTINCT
        unnest(
          ARRAY (
            SELECT
              unnest(
                get_companies_with_employee_permission ('parts_view')
              )
            UNION
            SELECT
              unnest(
                get_companies_with_employee_permission ('inventory_view')
              )
          )
        )
    )
  )
);

CREATE POLICY "INSERT" ON "public"."batchProperty" 
FOR INSERT
WITH CHECK (
  "companyId" = ANY (
    (
      SELECT DISTINCT
        unnest(
          ARRAY (
            SELECT
              unnest(
                get_companies_with_employee_permission ('parts_create')
              )
            UNION
            SELECT
              unnest(
                get_companies_with_employee_permission ('inventory_create')
              )
          )
        )
    )
  )
);

CREATE POLICY "UPDATE" ON "public"."batchProperty"
FOR UPDATE 
USING (
  "companyId" = ANY (
    (
      SELECT DISTINCT
        unnest(
          ARRAY (
            SELECT
              unnest(
                get_companies_with_employee_permission ('parts_update')
              )
            UNION
            SELECT
              unnest(
                get_companies_with_employee_permission ('inventory_update')
              )
          )
        )
    )
  )
);

CREATE POLICY "DELETE" ON "public"."batchProperty" 
FOR DELETE 
USING (
  "companyId" = ANY (
    (
      SELECT DISTINCT
        unnest(
          ARRAY (
            SELECT
              unnest(
                get_companies_with_employee_permission ('parts_delete')
              )
            UNION
            SELECT
              unnest(
                get_companies_with_employee_permission ('inventory_delete')
              )
          )
        )
    )
  )
);

-- company

DROP POLICY IF EXISTS "Anyone with settings_create can create company" ON "public"."company";
DROP POLICY IF EXISTS "Authenticated users can view company" ON "public"."company";
DROP POLICY IF EXISTS "Employees with settings_delete can delete company" ON "public"."company";
DROP POLICY IF EXISTS "Employees with settings_update can update company" ON "public"."company";
DROP POLICY IF EXISTS "Requests with an API key can access companies" ON "public"."company";

CREATE POLICY "SELECT" ON "public"."company"
FOR SELECT
USING (
  "id" = ANY (
    (
      SELECT get_companies_with_any_role()
    )::text[]
  )
);

CREATE POLICY "UPDATE" ON "public"."company"
FOR UPDATE  
USING (
  "id" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('settings_update')
    )::text[]
  )
);


-- companyIntegration

DROP POLICY IF EXISTS "Employees with settings_create can insert company integrations." ON "public"."companyIntegration";
DROP POLICY IF EXISTS "Employees with settings_update can insert company integrations." ON "public"."companyIntegration";
DROP POLICY IF EXISTS "Employees with settings_view can view company integrations." ON "public"."companyIntegration";
DROP POLICY IF EXISTS "Requests with an API key can access company integrations" ON "public"."companyIntegration";

CREATE POLICY "SELECT" ON "public"."companyIntegration"
FOR SELECT
USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('settings_view')
    )::text[]
  )
);

CREATE POLICY "INSERT" ON "public"."companyIntegration"
FOR INSERT
WITH CHECK (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('settings_create')
    )::text[]
  )
);

CREATE POLICY "UPDATE" ON "public"."companyIntegration"
FOR UPDATE
USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('settings_update')
    )::text[]
  )
);

CREATE POLICY "DELETE" ON "public"."companyIntegration"
FOR DELETE
USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('settings_delete')
    )::text[]
  )
);

-- company settings

DROP POLICY IF EXISTS "Authenticated users can view company settings" ON "public"."companySettings";
DROP POLICY IF EXISTS "Employees with settings_delete can delete company settings" ON "public"."companySettings";
DROP POLICY IF EXISTS "Employees with settings_update can update company settings" ON "public"."companySettings";


CREATE POLICY "SELECT" ON "public"."companySettings"
FOR SELECT
USING (
  "id" = ANY (
    (
      SELECT get_companies_with_employee_role()
    )::text[]
  )
);

CREATE POLICY "UPDATE" ON "public"."companySettings"
FOR UPDATE
USING (
  "id" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('settings_update')
    )::text[]
  )
);


-- configuration parameters
DROP POLICY IF EXISTS "Employees can view configuration options" ON "public"."configurationParameter";
DROP POLICY IF EXISTS "Employees with parts_create can insert configuration options" ON "public"."configurationParameter";
DROP POLICY IF EXISTS "Employees with parts_delete can delete configuration options" ON "public"."configurationParameter";
DROP POLICY IF EXISTS "Employees with parts_update can update configuration options" ON "public"."configurationParameter";
DROP POLICY IF EXISTS "Requests with an API key can access configuration options" ON "public"."configurationParameter";

CREATE POLICY "SELECT" ON "public"."configurationParameter"
FOR SELECT 
USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_any_role()
    )::text[]
  )
);

CREATE POLICY "INSERT" ON "public"."configurationParameter"
FOR INSERT WITH CHECK (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('parts_create')
    )::text[]
  )
);

CREATE POLICY "UPDATE" ON "public"."configurationParameter"
FOR UPDATE USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('parts_update')
    )::text[]
  )
);

CREATE POLICY "DELETE" ON "public"."configurationParameter"
FOR DELETE USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('parts_delete')
    )::text[]
  )
);

-- configuration parameter group

CREATE POLICY "SELECT" ON "public"."configurationParameterGroup"
FOR SELECT 
USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_any_role()
    )::text[]
  )
);

ALTER TABLE "public"."configurationParameterGroup" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Employees can view configuration groups" ON "public"."configurationParameterGroup";
DROP POLICY IF EXISTS "Employees with parts_create can insert configuration groups" ON "public"."configurationParameterGroup";
DROP POLICY IF EXISTS "Employees with parts_delete can delete configuration groups" ON "public"."configurationParameterGroup";
DROP POLICY IF EXISTS "Employees with parts_update can update configuration groups" ON "public"."configurationParameterGroup";
DROP POLICY IF EXISTS "Requests with an API key can access configuration groups" ON "public"."configurationParameterGroup";


CREATE POLICY "INSERT" ON "public"."configurationParameterGroup"
FOR INSERT WITH CHECK (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('parts_create')
    )::text[]
  )
);

CREATE POLICY "UPDATE" ON "public"."configurationParameterGroup"
FOR UPDATE USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('parts_update')
    )::text[]
  )
);

CREATE POLICY "DELETE" ON "public"."configurationParameterGroup"
FOR DELETE USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('parts_delete')
    )::text[]
  )
);

-- configuration rule

DROP POLICY IF EXISTS "Employees with parts_create can insert configuration rules" ON "public"."configurationRule";
DROP POLICY IF EXISTS "Employees with parts_delete can delete configuration rules" ON "public"."configurationRule";
DROP POLICY IF EXISTS "Employees with parts_update can update configuration rules" ON "public"."configurationRule";
DROP POLICY IF EXISTS "Employees with parts_view can view configuration rules" ON "public"."configurationRule";
DROP POLICY IF EXISTS "Requests with an API key can access configuration rules" ON "public"."configurationRule";

CREATE POLICY "SELECT" ON "public"."configurationRule"
FOR SELECT USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('parts_view')
    )::text[]
  )
);

CREATE POLICY "INSERT" ON "public"."configurationRule"
FOR INSERT WITH CHECK (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('parts_create')
    )::text[]
  )
);

CREATE POLICY "UPDATE" ON "public"."configurationRule"
FOR UPDATE USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('parts_update')
    )::text[]
  )
);

CREATE POLICY "DELETE" ON "public"."configurationRule"
FOR DELETE USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('parts_delete')
    )::text[]
  )
);


-- consumable

DROP POLICY IF EXISTS "Employees can view consumables" ON "public"."consumable";
DROP POLICY IF EXISTS "Employees with parts_create can insert consumables" ON "public"."consumable";
DROP POLICY IF EXISTS "Employees with parts_delete can delete consumables" ON "public"."consumable";
DROP POLICY IF EXISTS "Employees with parts_update can update consumables" ON "public"."consumable";
DROP POLICY IF EXISTS "Requests with an API key can access consumables" ON "public"."consumable";

CREATE POLICY "SELECT" ON "public"."consumable"
FOR SELECT USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_role()
    )::text[]
  )
);

CREATE POLICY "INSERT" ON "public"."consumable"
FOR INSERT WITH CHECK (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('parts_create')
    )::text[]
  )
);

CREATE POLICY "UPDATE" ON "public"."consumable"
FOR UPDATE USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('parts_update')
    )::text[]
  )
);

CREATE POLICY "DELETE" ON "public"."consumable"
FOR DELETE USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('parts_delete')
    )::text[]
  )
);


-- contact

DROP POLICY IF EXISTS "Customers with sales_create can create contacts from their orga" ON "public"."contact";
DROP POLICY IF EXISTS "Customers with sales_delete can delete contacts from their orga" ON "public"."contact";
DROP POLICY IF EXISTS "Customers with sales_update can update contacts from their orga" ON "public"."contact";
DROP POLICY IF EXISTS "Customers with sales_view can view contacts from their organiza" ON "public"."contact";
DROP POLICY IF EXISTS "Employees with purchasing_delete can delete supplier contacts" ON "public"."contact";
DROP POLICY IF EXISTS "Employees with purchasing_update can update supplier contacts" ON "public"."contact";
DROP POLICY IF EXISTS "Employees with purchasing_view can view contacts that are suppl" ON "public"."contact";
DROP POLICY IF EXISTS "Employees with sales_delete can delete customer contacts" ON "public"."contact";
DROP POLICY IF EXISTS "Employees with sales_update can update customer contacts" ON "public"."contact";
DROP POLICY IF EXISTS "Employees with sales_view can view contacts that are customer" ON "public"."contact";
DROP POLICY IF EXISTS "Many employees can create contacts" ON "public"."contact";
DROP POLICY IF EXISTS "Requests with an API key can view customer contacts" ON "public"."contact";
DROP POLICY IF EXISTS "Suppliers with purchasing_create can create contacts from their" ON "public"."contact";
DROP POLICY IF EXISTS "Suppliers with purchasing_delete can delete contacts from their" ON "public"."contact";
DROP POLICY IF EXISTS "Suppliers with purchasing_update can update contacts from their" ON "public"."contact";
DROP POLICY IF EXISTS "Suppliers with purchasing_view can view contacts from their org" ON "public"."contact";

CREATE POLICY "SELECT" ON "public"."contact"
FOR SELECT  
USING (
  "companyId" = ANY (
    SELECT DISTINCT unnest(ARRAY(
      SELECT unnest(get_companies_with_employee_permission('sales_view'))
      UNION
      SELECT unnest(get_companies_with_employee_permission('purchasing_view'))
    ))
  ) 
);

CREATE POLICY "INSERT" ON "public"."contact"
FOR INSERT  
WITH CHECK (
  "companyId" = ANY (
    SELECT DISTINCT unnest(ARRAY(
      SELECT unnest(get_companies_with_employee_permission('sales_create'))
      UNION
      SELECT unnest(get_companies_with_employee_permission('purchasing_create'))
    ))
  ) 
);

CREATE POLICY "UPDATE" ON "public"."contact"
FOR UPDATE  
USING (
  "companyId" = ANY (
    SELECT DISTINCT unnest(ARRAY(
      SELECT unnest(get_companies_with_employee_permission('sales_update'))
      UNION
      SELECT unnest(get_companies_with_employee_permission('purchasing_update'))
    ))
  )
);

CREATE POLICY "DELETE" ON "public"."contact"
FOR DELETE  
USING (
  "companyId" = ANY (
    SELECT DISTINCT unnest(ARRAY(
      SELECT unnest(get_companies_with_employee_permission('sales_delete'))
      UNION
      SELECT unnest(get_companies_with_employee_permission('purchasing_delete'))
    ))
  )
);

-- contractor

DROP POLICY IF EXISTS "Employees with resources_create can insert contractors" ON "public"."contractor";
DROP POLICY IF EXISTS "Employees with resources_delete can delete contractors" ON "public"."contractor";
DROP POLICY IF EXISTS "Employees with resources_update can update contractors" ON "public"."contractor";
DROP POLICY IF EXISTS "Employees with resources_view can view contractors" ON "public"."contractor";
DROP POLICY IF EXISTS "Requests with an API key can access contractors" ON "public"."contractor";

CREATE POLICY "SELECT" ON "public"."contractor"
FOR SELECT USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission('resources_view')
    )::text[]
  )
);

CREATE POLICY "INSERT" ON "public"."contractor"
FOR INSERT WITH CHECK (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission('resources_create')
    )::text[]
  )
);

CREATE POLICY "UPDATE" ON "public"."contractor"
FOR UPDATE USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission('resources_update')
    )::text[]
  )
);

CREATE POLICY "DELETE" ON "public"."contractor"
FOR DELETE USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission('resources_delete')
    )::text[]
  )
);

-- contractor ability

DROP POLICY IF EXISTS "Employees with resources_create can insert contractor abilities" ON "public"."contractorAbility";
DROP POLICY IF EXISTS "Employees with resources_delete can delete contractor abilities" ON "public"."contractorAbility";
DROP POLICY IF EXISTS "Employees with resources_update can update contractor abilities" ON "public"."contractorAbility";
DROP POLICY IF EXISTS "Employees with resources_view can view contractor abilities" ON "public"."contractorAbility";
DROP POLICY IF EXISTS "Requests with an API key can access contractor abilities" ON "public"."contractorAbility";

CREATE POLICY "SELECT" ON "public"."contractorAbility"
FOR SELECT USING (
  get_company_id_from_foreign_key("contractorId", 'contractor') = ANY (
    (
      SELECT
        get_companies_with_employee_permission('resources_view')
    )::text[]
  )
);

CREATE POLICY "INSERT" ON "public"."contractorAbility"
FOR INSERT WITH CHECK (
  get_company_id_from_foreign_key("contractorId", 'contractor') = ANY (
    (
      SELECT
        get_companies_with_employee_permission('resources_create')
    )::text[]
  )
);

CREATE POLICY "UPDATE" ON "public"."contractorAbility"
FOR UPDATE USING (
  get_company_id_from_foreign_key("contractorId", 'contractor') = ANY (
    (
      SELECT
        get_companies_with_employee_permission('resources_update')
    )::text[]
  )
);

CREATE POLICY "DELETE" ON "public"."contractorAbility"
FOR DELETE USING (
  get_company_id_from_foreign_key("contractorId", 'contractor') = ANY (
    (
      SELECT
        get_companies_with_employee_permission('resources_delete')
    )::text[]
  )
);

-- cost ledger

DROP POLICY IF EXISTS "Employees with accounting_view can view the value ledger" ON "public"."costLedger";
DROP POLICY IF EXISTS "Requests with an API key can access value ledger" ON "public"."costLedger";

CREATE POLICY "SELECT" ON "public"."costLedger"
FOR SELECT  
USING (
  "companyId" = ANY (
    SELECT DISTINCT unnest(ARRAY(
      SELECT unnest(get_companies_with_employee_permission('accounting_view'))
      UNION
      SELECT unnest(get_companies_with_employee_permission('parts_view'))
    ))
  )
);

-- currency

DROP POLICY IF EXISTS "Authenticated users can view currencies" ON "public"."currency";
DROP POLICY IF EXISTS "Employees with accounting_update can update currencies" ON "public"."currency";
DROP POLICY IF EXISTS "Employees with accounting_view can view currencies" ON "public"."currency";
DROP POLICY IF EXISTS "Requests with an API key can access currency" ON "public"."currency";

CREATE POLICY "SELECT" ON "public"."currency"
FOR SELECT USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_any_role()
    )::text[]
  )
);


CREATE POLICY "UPDATE" ON "public"."currency"
FOR UPDATE USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('accounting_update')
    )::text[]
  )
);

-- custom fields

DROP POLICY IF EXISTS "Employees can view custom fields" ON "public"."customField";
DROP POLICY IF EXISTS "Employees with settings_create can insert custom fields" ON "public"."customField";
DROP POLICY IF EXISTS "Employees with settings_delete can delete custom fields" ON "public"."customField";
DROP POLICY IF EXISTS "Employees with settings_update can update custom fields" ON "public"."customField";
DROP POLICY IF EXISTS "Requests with an API key can access custom fields" ON "public"."customField";

CREATE POLICY "SELECT" ON "public"."customField"
FOR SELECT USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_any_role()
    )::text[]
  )
);

CREATE POLICY "INSERT" ON "public"."customField"
FOR INSERT WITH CHECK (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('settings_create')
    )::text[]
  )
);

CREATE POLICY "UPDATE" ON "public"."customField"
FOR UPDATE USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('settings_update')
    )::text[]
  )
);

CREATE POLICY "DELETE" ON "public"."customField"
FOR DELETE USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('settings_delete')
    )::text[]
  )
);


-- customer

DROP POLICY IF EXISTS "Customers with sales_update can update their own organization" ON "public"."customer";
DROP POLICY IF EXISTS "Customers with sales_view can their own organization" ON "public"."customer";
DROP POLICY IF EXISTS "Employees with sales_create can create customers" ON "public"."customer";
DROP POLICY IF EXISTS "Employees with sales_delete can delete customers" ON "public"."customer";
DROP POLICY IF EXISTS "Employees with sales_update can update customers" ON "public"."customer";
DROP POLICY IF EXISTS "Employees with sales_view can view customer" ON "public"."customer";
DROP POLICY IF EXISTS "Requests with an API key can access customers" ON "public"."customer";


CREATE POLICY "SELECT" ON "public"."customer"
FOR SELECT USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('sales_view')
    )::text[]
  )
  OR "id" = ANY (
    (
      SELECT
        get_customer_ids_with_customer_permission ('sales_view')
    )::text[]
  )
);

CREATE POLICY "INSERT" ON "public"."customer"
FOR INSERT WITH CHECK (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('sales_create')
    )::text[]
  ) 
);

CREATE POLICY "UPDATE" ON "public"."customer"
FOR UPDATE USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('sales_update')
    )::text[]
  ) 
);

CREATE POLICY "DELETE" ON "public"."customer"
FOR DELETE USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('sales_delete')
    )::text[]
  ) 
);


-- customer account

DROP POLICY IF EXISTS "Employees with sales_create can create customer accounts" ON "public"."customerAccount";
DROP POLICY IF EXISTS "Employees with sales_delete can delete customer accounts" ON "public"."customerAccount";
DROP POLICY IF EXISTS "Employees with sales_update can update customer accounts" ON "public"."customerAccount";
DROP POLICY IF EXISTS "Employees with sales_view can view customer accounts" ON "public"."customerAccount";
DROP POLICY IF EXISTS "Requests with an API key can access customer accounts" ON "public"."customerAccount";

CREATE POLICY "SELECT" ON "public"."customerAccount"
FOR SELECT USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('sales_view')
    )::text[]
  )
  OR "customerId" = ANY (
    (
      SELECT
        get_customer_ids_with_customer_permission ('sales_view')
    )::text[]
  )
);

CREATE POLICY "INSERT" ON "public"."customerAccount"
FOR INSERT WITH CHECK (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('sales_create')
    )::text[]
  )
);

CREATE POLICY "UPDATE" ON "public"."customerAccount"
FOR UPDATE USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('sales_update')
    )::text[]
  )
);

CREATE POLICY "DELETE" ON "public"."customerAccount"
FOR DELETE USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('sales_delete')
    )::text[]
  )
);

DROP POLICY IF EXISTS "Customers with sales_create can create customer contacts" ON "public"."customerContact";
DROP POLICY IF EXISTS "Customers with sales_update can update their customer contacts" ON "public"."customerContact";
DROP POLICY IF EXISTS "Customers with sales_view can their own customer contacts" ON "public"."customerContact";
DROP POLICY IF EXISTS "Employees with sales_create can create customer contacts" ON "public"."customerContact";
DROP POLICY IF EXISTS "Employees with sales_delete can delete customer contacts" ON "public"."customerContact";
DROP POLICY IF EXISTS "Employees with sales_update can update customer contacts" ON "public"."customerContact";
DROP POLICY IF EXISTS "Employees with sales_view can view customer contact" ON "public"."customerContact";
DROP POLICY IF EXISTS "Requests with an API key can access customer contacts" ON "public"."customerContact";

CREATE POLICY "SELECT" ON "public"."customerContact"
FOR SELECT USING (
  get_company_id_from_foreign_key("customerId", 'customer') = ANY (
    (
      SELECT
        get_companies_with_employee_permission('sales_view')
    )::text[]
  )
  OR "customerId" = ANY (
    (
      SELECT
        get_customer_ids_with_customer_permission('sales_view')
    )::text[]
  )
);

CREATE POLICY "INSERT" ON "public"."customerContact"
FOR INSERT WITH CHECK (
  get_company_id_from_foreign_key("customerId", 'customer') = ANY (
    (
      SELECT
        get_companies_with_employee_permission('sales_create')
    )::text[]
  )
  OR "customerId" = ANY (
    (
      SELECT
        get_customer_ids_with_customer_permission('sales_create')
    )::text[]
  )
);

CREATE POLICY "UPDATE" ON "public"."customerContact"
FOR UPDATE USING (
  get_company_id_from_foreign_key("customerId", 'customer') = ANY (
    (
      SELECT
        get_companies_with_employee_permission('sales_update')
    )::text[]
  )
  OR "customerId" = ANY (
    (
      SELECT
        get_customer_ids_with_customer_permission('sales_update')
    )::text[]
  )
);

CREATE POLICY "DELETE" ON "public"."customerContact"
FOR DELETE USING (
  get_company_id_from_foreign_key("customerId", 'customer') = ANY (
    (
      SELECT
        get_companies_with_employee_permission('sales_delete')
    )::text[]
  )
  OR "customerId" = ANY (
    (
      SELECT
        get_customer_ids_with_customer_permission('sales_delete')
    )::text[]
  )
);

DROP POLICY IF EXISTS "Employees with sales_create can create customer locations" ON "public"."customerLocation";
DROP POLICY IF EXISTS "Employees with sales_delete can delete customer locations" ON "public"."customerLocation";
DROP POLICY IF EXISTS "Employees with sales_update can update customer locations" ON "public"."customerLocation";
DROP POLICY IF EXISTS "Employees with sales_view can view customer locations" ON "public"."customerLocation";
DROP POLICY IF EXISTS "Requests with an API key can access customer locations" ON "public"."customerLocation";

CREATE POLICY "SELECT" ON "public"."customerLocation"
FOR SELECT USING (
  get_company_id_from_foreign_key("customerId", 'customer') = ANY (
    (
      SELECT
        get_companies_with_employee_permission('sales_view')
    )::text[]
  )
  OR "customerId" = ANY (
    (
      SELECT
        get_customer_ids_with_customer_permission('sales_view')
    )::text[]
  )
);


CREATE POLICY "INSERT" ON "public"."customerLocation"
FOR INSERT WITH CHECK (
  get_company_id_from_foreign_key("customerId", 'customer') = ANY (
    (
      SELECT
        get_companies_with_employee_permission('sales_create')
    )::text[]
  )
  OR "customerId" = ANY (
    (
      SELECT
        get_customer_ids_with_customer_permission('sales_create')
    )::text[]
  )
);

CREATE POLICY "UPDATE" ON "public"."customerLocation"
FOR UPDATE USING (
  get_company_id_from_foreign_key("customerId", 'customer') = ANY (
    (
      SELECT
        get_companies_with_employee_permission('sales_update')
    )::text[]
  )
  OR "customerId" = ANY (
    (
      SELECT
        get_customer_ids_with_customer_permission('sales_update')
    )::text[]
  )
);

CREATE POLICY "DELETE" ON "public"."customerLocation"
FOR DELETE USING (
  get_company_id_from_foreign_key("customerId", 'customer') = ANY (
    (
      SELECT
        get_companies_with_employee_permission('sales_delete')
    )::text[]
  )
  OR "customerId" = ANY (
    (
      SELECT
        get_customer_ids_with_customer_permission('sales_delete')
    )::text[]
  )
);


-- Drop existing policies with descriptions
DROP POLICY IF EXISTS "Employees with sales_create or parts_create can insert customer part to item" ON "public"."customerPartToItem";
DROP POLICY IF EXISTS "Employees with sales_delete or parts_delete can delete customer part to item" ON "public"."customerPartToItem";
DROP POLICY IF EXISTS "Employees with sales_update or parts_update can update customer part to item" ON "public"."customerPartToItem";
DROP POLICY IF EXISTS "Employees with sales_view or parts_view can view customer part to item" ON "public"."customerPartToItem";
DROP POLICY IF EXISTS "Requests with an API key can access customer parts" ON "public"."customerPartToItem";

-- Create new policies
CREATE POLICY "INSERT" ON "public"."customerPartToItem"
FOR INSERT TO public WITH CHECK (
  "companyId" = ANY (
    SELECT DISTINCT unnest(ARRAY(
      SELECT unnest(get_companies_with_employee_permission('sales_create'))
      UNION
      SELECT unnest(get_companies_with_employee_permission('parts_create'))
    ))
  ) 
  OR "customerId" = ANY (
    SELECT DISTINCT unnest(ARRAY(
      SELECT unnest(get_customer_ids_with_customer_permission('sales_create'))
      UNION
      SELECT unnest(get_customer_ids_with_customer_permission('parts_create'))
    ))
  )
);

CREATE POLICY "DELETE" ON "public"."customerPartToItem"
FOR DELETE TO public USING (
  "companyId" = ANY (
    SELECT DISTINCT unnest(ARRAY(
      SELECT unnest(get_companies_with_employee_permission('sales_delete'))
      UNION
      SELECT unnest(get_companies_with_employee_permission('parts_delete'))
    ))
  ) 
  OR "customerId" = ANY (
    SELECT DISTINCT unnest(ARRAY(
      SELECT unnest(get_customer_ids_with_customer_permission('sales_delete'))
      UNION
      SELECT unnest(get_customer_ids_with_customer_permission('parts_delete'))
    ))
  )
);

CREATE POLICY "UPDATE" ON "public"."customerPartToItem"
FOR UPDATE TO public USING (
  "companyId" = ANY (
    SELECT DISTINCT unnest(ARRAY(
      SELECT unnest(get_companies_with_employee_permission('sales_update'))
      UNION
      SELECT unnest(get_companies_with_employee_permission('parts_update'))
    ))
  ) 
  OR "customerId" = ANY (
    SELECT DISTINCT unnest(ARRAY(
      SELECT unnest(get_customer_ids_with_customer_permission('sales_update'))
      UNION
      SELECT unnest(get_customer_ids_with_customer_permission('parts_update'))
    ))
  )
);

CREATE POLICY "SELECT" ON "public"."customerPartToItem"
FOR SELECT TO public USING (
  "companyId" = ANY (
    SELECT DISTINCT unnest(ARRAY(
      SELECT unnest(get_companies_with_employee_permission('sales_view'))
      UNION
      SELECT unnest(get_companies_with_employee_permission('parts_view'))
    ))
  ) 
  OR "customerId" = ANY (
    SELECT DISTINCT unnest(ARRAY(
      SELECT unnest(get_customer_ids_with_customer_permission('sales_view'))
      UNION
      SELECT unnest(get_customer_ids_with_customer_permission('parts_view'))
    ))
  )
);



-- customer payment

DROP POLICY IF EXISTS "Employees with sales_update can update customer payment" ON "public"."customerPayment";
DROP POLICY IF EXISTS "Employees with sales_view can view customer payment" ON "public"."customerPayment";
DROP POLICY IF EXISTS "Requests with an API key can access customer payments" ON "public"."customerPayment";


CREATE POLICY "SELECT" ON "public"."customerPayment"
FOR SELECT USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('sales_view')
    )::text[]
  )
);

CREATE POLICY "UPDATE" ON "public"."customerPayment"
FOR UPDATE USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('sales_update')
    )::text[]
  ) 
);


-- customer shipping

DROP POLICY IF EXISTS "Employees with purchasing_update can update customer shipping" ON "public"."customerShipping";
DROP POLICY IF EXISTS "Employees with purchasing_view can view customer shipping" ON "public"."customerShipping";
DROP POLICY IF EXISTS "Requests with an API key can access customer shipments" ON "public"."customerShipping";


CREATE POLICY "SELECT" ON "public"."customerShipping"
FOR SELECT USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('sales_view')
    )::text[]
  )
);

CREATE POLICY "UPDATE" ON "public"."customerShipping"
FOR UPDATE USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('sales_update')
    )::text[]
  ) 
);

-- customer status

DROP POLICY IF EXISTS "Employees with sales_create can create customer statuses" ON "public"."customerStatus";
DROP POLICY IF EXISTS "Employees with sales_delete can delete customer statuses" ON "public"."customerStatus";
DROP POLICY IF EXISTS "Employees with sales_update can update customer statuses" ON "public"."customerStatus";
DROP POLICY IF EXISTS "Employees with sales_view can view customer statuses" ON "public"."customerStatus";
DROP POLICY IF EXISTS "Requests with an API key can access customer statuses" ON "public"."customerStatus";


CREATE POLICY "SELECT" ON "public"."customerStatus"
FOR SELECT USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_any_role()
    )::text[]
  )
);

CREATE POLICY "INSERT" ON "public"."customerStatus"
FOR INSERT WITH CHECK (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('sales_create')
    )::text[]
  )
);

CREATE POLICY "UPDATE" ON "public"."customerStatus"
FOR UPDATE USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('sales_update')
    )::text[]
  )
);

CREATE POLICY "DELETE" ON "public"."customerStatus"
FOR DELETE USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('sales_delete')
    )::text[]
  )
);

-- customer type

DROP POLICY IF EXISTS "Employees with sales_create can create customer types" ON "public"."customerType";
DROP POLICY IF EXISTS "Employees with sales_delete can delete customer types" ON "public"."customerType";
DROP POLICY IF EXISTS "Employees with sales_update can update customer types" ON "public"."customerType";
DROP POLICY IF EXISTS "Employees with sales_view can view customer types" ON "public"."customerType";
DROP POLICY IF EXISTS "Requests with an API key can access customer types" ON "public"."customerType";

CREATE POLICY "SELECT" ON "public"."customerType"
FOR SELECT USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_any_role()
    )::text[]
  )
);

CREATE POLICY "INSERT" ON "public"."customerType"
FOR INSERT WITH CHECK (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('sales_create')
    )::text[]
  )
);

CREATE POLICY "UPDATE" ON "public"."customerType"
FOR UPDATE USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('sales_update')
    )::text[]
  )
);

CREATE POLICY "DELETE" ON "public"."customerType"
FOR DELETE USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('sales_delete')
    )::text[]
  )
);

-- department

DROP POLICY IF EXISTS "Employees can view departments" ON "public"."department";
DROP POLICY IF EXISTS "Employees with people_create can insert departments" ON "public"."department";
DROP POLICY IF EXISTS "Employees with people_delete can delete departments" ON "public"."department";
DROP POLICY IF EXISTS "Employees with people_update can update departments" ON "public"."department";
DROP POLICY IF EXISTS "Requests with an API key can access departments" ON "public"."department";

CREATE POLICY "SELECT" ON "public"."department"
FOR SELECT USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_role()
    )::text[]
  )
);

CREATE POLICY "INSERT" ON "public"."department"
FOR INSERT WITH CHECK (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('people_create')
    )::text[]
  )
);

CREATE POLICY "UPDATE" ON "public"."department"
FOR UPDATE USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('people_update')
    )::text[]
  )
);

CREATE POLICY "DELETE" ON "public"."department"
FOR DELETE USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('people_delete')
    )::text[]
  )
);

-- document


DROP POLICY IF EXISTS "Requests with an API key can access documents" ON "public"."document";
DROP POLICY IF EXISTS "Users with documents can view documents where they are in the r" ON "public"."document";
DROP POLICY IF EXISTS "Users with documents_create can create documents where they are" ON "public"."document";
DROP POLICY IF EXISTS "Users with documents_delete can delete documents where they are" ON "public"."document";
DROP POLICY IF EXISTS "Users with documents_update can update documents where they are" ON "public"."document";
DROP POLICY IF EXISTS "Users with purchasing_create can create documents that start wi" ON "public"."document";
DROP POLICY IF EXISTS "Users with purchasing_delete can delete documents that start wi" ON "public"."document";
DROP POLICY IF EXISTS "Users with purchasing_update can update documents that start wi" ON "public"."document";
DROP POLICY IF EXISTS "Users with purchasing_view can view documents that start with p" ON "public"."document";
DROP POLICY IF EXISTS "Users with sales_create can create documents that start with qu" ON "public"."document";
DROP POLICY IF EXISTS "Users with sales_delete can delete documents that start with qu" ON "public"."document";
DROP POLICY IF EXISTS "Users with sales_update can update documents that start with qu" ON "public"."document";
DROP POLICY IF EXISTS "Users with sales_view can view documents that start with quote" ON "public"."document";

CREATE POLICY "SELECT" ON "public"."document" 
  FOR SELECT USING (
    "companyId" = ANY (
      (
        SELECT
          get_companies_with_permission ('documents_view')
      )::text[]
    )
    AND (groups_for_user(auth.uid()::text) && "readGroups") = true
  );

CREATE POLICY "INSERT" ON "public"."document" 
  FOR INSERT WITH CHECK (
    "companyId" = ANY (
      (
        SELECT
          get_companies_with_permission ('documents_create')
      )::text[]
    )
    AND (groups_for_user(auth.uid()::text) && "writeGroups") = true
  );

CREATE POLICY "UPDATE" ON "public"."document"
  FOR UPDATE USING (
    "companyId" = ANY (
      (
        SELECT
          get_companies_with_permission ('documents_update')
      )::text[]
    )
    AND (groups_for_user(auth.uid()::text) && "writeGroups") = true
  );

CREATE POLICY "DELETE" ON "public"."document"
  FOR DELETE USING (
    "companyId" = ANY (
      (
        SELECT
          get_companies_with_permission ('documents_delete')
      )::text[]
    )
    AND (groups_for_user(auth.uid()::text) && "writeGroups") = true
  );