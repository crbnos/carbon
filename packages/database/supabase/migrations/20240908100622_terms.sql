CREATE TABLE "terms" (
  "id" TEXT NOT NULL DEFAULT xid(),
  "purchasingTerms" JSON DEFAULT '{}',
  "salesTerms" JSON DEFAULT '{}',
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  "updatedBy" TEXT,

  CONSTRAINT "terms_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "terms_id_fkey" FOREIGN KEY ("id") REFERENCES "company"("id") ON DELETE CASCADE,
  CONSTRAINT "terms_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "user"("id") ON DELETE SET NULL
);

-- Create a function to insert a row into the terms table
CREATE OR REPLACE FUNCTION insert_terms_for_new_company()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO "terms" ("id")
  VALUES (NEW.id);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create a trigger that calls the function after an insert into the company table
CREATE TRIGGER create_terms_after_company_insert
AFTER INSERT ON "company"
FOR EACH ROW
EXECUTE FUNCTION insert_terms_for_new_company();

-- Insert terms for all existing companies
INSERT INTO "terms" ("id")
SELECT "id" FROM "company"
WHERE "id" NOT IN (SELECT "id" FROM "terms");

ALTER TABLE "terms" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Employees with purchasing_view or sales_view or settings_view can view terms" ON "terms"
  FOR SELECT
  USING (
    has_role('employee', "id") AND (
      has_company_permission('purchasing_view', "id") OR
      has_company_permission('sales_view', "id") OR
      has_company_permission('settings_view', "id")
    )
  );

CREATE POLICY "Employees with settings_update can update terms" ON "terms"
  FOR UPDATE
  USING (
    has_role('employee', "id") AND
    has_company_permission('settings_update', "id")
  );

