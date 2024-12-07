ALTER TABLE "methodOperationTool" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "quoteOperationTool" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "jobOperationTool" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Employees with production_create can create job operation tools" ON "jobOperationTool";

CREATE POLICY "Employees can view job operation tools" ON "jobOperationTool"
FOR SELECT USING (
    has_role('employee', "companyId") 
    AND "companyId" = ANY(
      select "companyId" from "userToCompany" where "userId" = auth.uid()::text
    )
);

CREATE POLICY "Requests with an API key can access job operation tools" ON "jobOperationTool"
  FOR ALL USING (
    has_valid_api_key_for_company("companyId")
  );

CREATE POLICY "Requests with an API key can access method operation tools" ON "methodOperationTool"
  FOR ALL USING (
    has_valid_api_key_for_company("companyId")
  );

CREATE POLICY "Requests with an API key can access quote operation tools" ON "quoteOperationTool"
  FOR ALL USING (
    has_valid_api_key_for_company("companyId")
  );