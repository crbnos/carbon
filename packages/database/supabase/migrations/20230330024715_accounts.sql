CREATE TABLE "currency" (
  "id" TEXT NOT NULL DEFAULT xid(),
  "name" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "symbol" TEXT,
  "exchangeRate" NUMERIC(20,8) NOT NULL DEFAULT 1,
  "decimalPlaces" INTEGER NOT NULL DEFAULT 2,
  "isBaseCurrency" BOOLEAN NOT NULL DEFAULT false,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "companyId" TEXT NOT NULL,
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT,
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  "customFields" JSONB,

  CONSTRAINT "currency_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "currency_code_key" UNIQUE ("code", "companyId"),
  CONSTRAINT "currency_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "currency_exchangeRate_check" CHECK ("exchangeRate" > 0),
  CONSTRAINT "currency_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "user"("id")
);

CREATE INDEX "currency_code_idx" ON "currency" ("code");

ALTER TABLE "currency" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view currencies" ON "currency"
  FOR SELECT
  USING (
    auth.role() = 'authenticated' 
  );

CREATE POLICY "Employees with accounting_create can insert currencies" ON "currency"
  FOR INSERT
  WITH CHECK (   
    has_role('employee') AND
    has_company_permission('accounting_create', "companyId")
);

CREATE POLICY "Employees with accounting_update can update currencies" ON "currency"
  FOR UPDATE
  USING (
    has_role('employee') AND
    has_company_permission('accounting_update', "companyId")
  );

CREATE POLICY "Employees with accounting_delete can delete currencies" ON "currency"
  FOR DELETE
  USING (
    has_role('employee') AND
    has_company_permission('accounting_delete', "companyId")
  );


CREATE TYPE "glAccountCategory" AS ENUM (
  'Bank',
  'Accounts Receivable',
  'Inventory',
  'Other Current Asset',
  'Fixed Asset',
  'Accumulated Depreciation',
  'Other Asset',
  'Accounts Payable',
  'Other Current Liability',
  'Long Term Liability',
  'Equity - No Close',
  'Equity - Close',
  'Retained Earnings',
  'Income',
  'Cost of Goods Sold',
  'Expense',
  'Other Income',
  'Other Expense'
);

CREATE TYPE "glAccountClass" AS ENUM (
  'Asset',
  'Liability',
  'Equity',
  'Revenue',
  'Expense'
);

CREATE TYPE "glIncomeBalance" AS ENUM (
  'Balance Sheet',
  'Income Statement'
);

CREATE TYPE "glAccountType" AS ENUM (
  'Posting',
  'Total',
  'Begin Total',
  'End Total'
);

CREATE TABLE "accountCategory" (
  "id" TEXT NOT NULL DEFAULT xid(),
  "category" TEXT NOT NULL,
  "class" "glAccountClass" NOT NULL,
  "incomeBalance" "glIncomeBalance" NOT NULL,
  "companyId" TEXT NOT NULL,
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT,
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  "customFields" JSONB,

  CONSTRAINT "accountCategory_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "accountCategory_unique_category" UNIQUE ("category", "companyId"),
  CONSTRAINT "accountCategory_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "accountCategory_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user"("id"),
  CONSTRAINT "accountCategory_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "user"("id")
);

CREATE INDEX "accountCategory_companyId_idx" ON "accountCategory" ("companyId");

ALTER TABLE "accountCategory" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Employees with accounting_view can view account categories" ON "accountCategory"
  FOR SELECT
  USING (
    has_role('employee') AND
    has_company_permission('accounting_view', "companyId")
  );
  

CREATE POLICY "Employees with accounting_create can insert account categories" ON "accountCategory"
  FOR INSERT
  WITH CHECK (   
    has_role('employee') AND
    has_company_permission('accounting_create', "companyId")
);

CREATE POLICY "Employees with accounting_update can update account categories" ON "accountCategory"
  FOR UPDATE
  USING (
    has_role('employee') AND
    has_company_permission('accounting_update', "companyId")
  );

CREATE POLICY "Employees with accounting_delete can delete account categories" ON "accountCategory"
  FOR DELETE
  USING (
    has_role('employee') AND
    has_company_permission('accounting_delete', "companyId")
  );

CREATE TYPE "glConsolidatedRate" AS ENUM (
  'Average',
  'Current',
  'Historical'
);

CREATE TABLE "accountSubcategory" (
  "id" TEXT NOT NULL DEFAULT xid(),
  "name" TEXT NOT NULL,
  "accountCategoryId" TEXT NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT,
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  "customFields" JSONB,

  CONSTRAINT "accountSubcategory_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "accountSubcategory_name_key" UNIQUE ("name", "accountCategoryId"),
  CONSTRAINT "accountSubcategory_accountCategoryId_fkey" FOREIGN KEY ("accountCategoryId") REFERENCES "accountCategory"("id"),
  CONSTRAINT "accountSubcategory_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user"("id"),
  CONSTRAINT "accountSubcategory_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "user"("id")
);

CREATE INDEX "accountSubcategory_accountCategoryId_idx" ON "accountSubcategory" ("accountCategoryId");

ALTER TABLE "accountSubcategory" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Employees with accounting_view can view account subcategories" ON "accountSubcategory"
  FOR SELECT
  USING (
    has_role('employee')
    AND   (
      '0' = ANY(get_permission_companies('accounting_view'))
      OR (
        "accountCategoryId" IN (
          SELECT "id" FROM "accountCategory" WHERE "companyId" = ANY(
            get_permission_companies('accounting_view')
          )
        )
      )
    )
  );
  

CREATE POLICY "Employees with accounting_create can insert account subcategories" ON "accountSubcategory"
  FOR INSERT
  WITH CHECK (   
    has_role('employee')
    AND   (
      '0' = ANY(get_permission_companies('accounting_create'))
      OR (
        "accountCategoryId" IN (
          SELECT "id" FROM "accountCategory" WHERE "companyId" = ANY(
            get_permission_companies('accounting_create')
          )
        )
      )
    )
);

CREATE POLICY "Employees with accounting_update can update account subcategories" ON "accountSubcategory"
  FOR UPDATE
  USING (
    has_role('employee')
    AND   (
      '0' = ANY(get_permission_companies('accounting_update'))
      OR (
        "accountCategoryId" IN (
          SELECT "id" FROM "accountCategory" WHERE "companyId" = ANY(
            get_permission_companies('accounting_update')
          )
        )
      )
    )
  );

CREATE POLICY "Employees with accounting_delete can delete account subcategories" ON "accountSubcategory"
  FOR DELETE
  USING (
    has_role('employee')
    AND   (
      '0' = ANY(get_permission_companies('accounting_delete'))
      OR (
        "accountCategoryId" IN (
          SELECT "id" FROM "accountCategory" WHERE "companyId" = ANY(
            get_permission_companies('accounting_delete')
          )
        )
      )
    )
  );

CREATE TABLE "account" (
  "id" TEXT NOT NULL DEFAULT xid(),
  "number" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "type" "glAccountType" NOT NULL,
  "class" "glAccountClass",
  "accountCategoryId" TEXT,
  "accountSubcategoryId" TEXT,
  "incomeBalance" "glIncomeBalance" NOT NULL,
  "consolidatedRate" "glConsolidatedRate",
  "directPosting" BOOLEAN NOT NULL DEFAULT false,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "companyId" TEXT NOT NULL,
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT,
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  "customFields" JSONB,

  CONSTRAINT "account_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "account_number_key" UNIQUE ("number", "companyId"),
  CONSTRAINT "account_name_key" UNIQUE ("name", "companyId"),
  CONSTRAINT "account_accountCategoryId_fkey" FOREIGN KEY ("accountCategoryId") REFERENCES "accountCategory"("id"),
  CONSTRAINT "account_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id"),
  CONSTRAINT "account_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user"("id"),
  CONSTRAINT "account_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "user"("id")
);

CREATE INDEX "account_number_idx" ON "account" ("number", "companyId");
CREATE INDEX "account_type_idx" ON "account" ("type", "companyId");
CREATE INDEX "account_incomeBalance_idx" ON "account" ("incomeBalance", "companyId");
CREATE INDEX "account_accountCategoryId_idx" ON "account" ("accountCategoryId", "companyId");
CREATE INDEX "account_class_idx" ON "account" ("class", "companyId");

CREATE INDEX "account_companyId_idx" ON "account" ("companyId");

ALTER TABLE "account" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Certain employees can view accounts" ON "account"
  FOR SELECT
  USING (
    has_role('employee') AND
    (
      has_company_permission('accounting_view', "companyId") OR
      has_company_permission('parts_view', "companyId") OR
      has_company_permission('resources_view', "companyId") OR
      has_company_permission('sales_view', "companyId") OR
      has_company_permission('purchasing_view', "companyId")
    )
  );
  

CREATE POLICY "Employees with accounting_create can insert accounts" ON "account"
  FOR INSERT
  WITH CHECK (   
    has_role('employee') AND
    has_company_permission('accounting_create', "companyId")
);

CREATE POLICY "Employees with accounting_update can update accounts" ON "account"
  FOR UPDATE
  USING (
    has_role('employee') AND
    has_company_permission('accounting_update', "companyId")
  );

CREATE POLICY "Employees with accounting_delete can delete accounts" ON "account"
  FOR DELETE
  USING (
    has_role('employee') AND
    has_company_permission('accounting_delete', "companyId")
  );

CREATE OR REPLACE VIEW "accountCategories" AS
  SELECT
    "id",
    "category",
    "class",
    "incomeBalance",
    "companyId",
    "createdBy",
    "createdAt",
    "updatedBy",
    "updatedAt",
    "customFields",
    (SELECT count(*) FROM "accountSubcategory" WHERE "accountSubcategory"."accountCategoryId" = "accountCategory"."id" AND "accountSubcategory"."active" = true) AS "subCategoriesCount"
  FROM "accountCategory"
;

CREATE OR REPLACE VIEW "accounts" AS
  SELECT 
    "account".*,
    (SELECT "category" FROM "accountCategory" WHERE "accountCategory"."id" = "account"."accountCategoryId") AS "accountCategory",
    (SELECT "name" FROM "accountSubcategory" WHERE "accountSubcategory"."id" = "account"."accountSubcategoryId") AS "accountSubCategory"  
  FROM "account"
;