DO $$
DECLARE
    company_record RECORD;
    scrap_reason TEXT;
BEGIN
    FOR company_record IN SELECT id FROM companies LOOP
        FOR scrap_reason IN SELECT unnest(ARRAY['Defective', 'Damaged', 'Quality Control']) LOOP
            INSERT INTO "scrapReason" ("companyId", "name", "createdBy")
            VALUES (company_record.id, scrap_reason, 'system');
        END LOOP;
    END LOOP;
END $$;


ALTER TABLE "scrapReason" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Employees can view scrap reasons" ON "scrapReason"
  FOR SELECT
  USING (
    has_role('employee', "companyId") AND
    "companyId" = ANY(
      select "companyId" from "userToCompany" where "userId" = auth.uid()::text
    )
  );

CREATE POLICY "Employees with production_create can insert scrap reasons" ON "scrapReason"
  FOR INSERT
  WITH CHECK (   
    has_role('employee', "companyId") AND
    has_company_permission('production_create', "companyId")
);

CREATE POLICY "Employees with production_update can update scrap reasons" ON "scrapReason"
  FOR UPDATE
  USING (
    has_role('employee', "companyId") AND
    has_company_permission('production_update', "companyId")
  );

CREATE POLICY "Employees with production_delete can delete scrap reasons" ON "scrapReason"
  FOR DELETE
  USING (
    has_role('employee', "companyId") AND
    has_company_permission('production_delete', "companyId")
  );