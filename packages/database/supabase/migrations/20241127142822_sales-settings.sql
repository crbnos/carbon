CREATE TABLE "companySettings" (
  "id" TEXT NOT NULL,
  "digitalQuoteEnabled" BOOLEAN NOT NULL DEFAULT FALSE,
  "digitalQuoteNotificationGroup" TEXT[] NOT NULL DEFAULT '{}',
  "digitalQuoteIncludesPurchaseOrders" BOOLEAN NOT NULL DEFAULT TRUE,

  CONSTRAINT "companySettings_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "companySettings_companyId_fkey" FOREIGN KEY ("id") REFERENCES "company"("id")
);

-- Drop the old function and trigger
DROP TRIGGER IF EXISTS create_terms_after_company_insert ON "company";
DROP FUNCTION IF EXISTS insert_terms_for_new_company();

-- Create new function to insert both terms and settings
CREATE OR REPLACE FUNCTION insert_company_related_records()
RETURNS TRIGGER AS $$
BEGIN
  -- Insert terms record
  INSERT INTO "terms" ("id")
  VALUES (NEW.id);
  
  -- Insert company settings record
  INSERT INTO "companySettings" ("id") 
  VALUES (NEW.id);
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create a trigger that calls the function after an insert into the company table
CREATE TRIGGER create_company_related_records_after_insert
AFTER INSERT ON "company"
FOR EACH ROW
EXECUTE FUNCTION insert_company_related_records();


-- Insert records for existing companies
INSERT INTO "companySettings" ("id", "digitalQuoteEnabled", "digitalQuoteNotificationGroup")
SELECT 
  id,
  "digitalQuoteEnabled",
  "digitalQuoteNotificationGroup"
FROM "company"
ON CONFLICT ("id") DO UPDATE SET
  "digitalQuoteEnabled" = EXCLUDED."digitalQuoteEnabled",
  "digitalQuoteNotificationGroup" = EXCLUDED."digitalQuoteNotificationGroup";



ALTER TABLE "companySettings" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Employees with settings_update can update company settings" ON "companySettings"
  FOR UPDATE
  USING (
    has_role('employee', "id") AND
    has_company_permission('settings_update', "id")
  );

CREATE POLICY "Employees with settings_delete can delete company settings" ON "companySettings"
  FOR DELETE
  USING (
    has_role('employee', "id") AND
    has_company_permission('settings_delete', "id")
  );


CREATE POLICY "Authenticated users can view company settings" ON "companySettings"
  FOR SELECT
  USING (
    auth.role() = 'authenticated' AND "id" IN (
      SELECT "companyId" FROM "userToCompany" WHERE "userId" = auth.uid()::text
    )
  );

DROP VIEW IF EXISTS "companies";
COMMIT;

-- Drop the columns from company table now that they're migrated
ALTER TABLE "company" 
DROP COLUMN IF EXISTS "digitalQuoteEnabled",
DROP COLUMN IF EXISTS "digitalQuoteNotificationGroup";

CREATE OR REPLACE VIEW "companies" WITH(SECURITY_INVOKER=true) AS
  SELECT DISTINCT
    c.*,
    uc.*,
    et.name AS "employeeType"
    FROM "userToCompany" uc
    INNER JOIN "company" c
      ON c.id = uc."companyId"
    LEFT JOIN "employee" e
      ON e.id = uc."userId" AND e."companyId" = uc."companyId"
    LEFT JOIN "employeeType" et
      ON et.id = e."employeeTypeId";