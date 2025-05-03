ALTER TABLE "jobOperationDependency" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Employees can view job operation dependencies" ON "jobOperationDependency"
  FOR SELECT
  USING (
    has_role('employee', "companyId") AND
    "companyId" = ANY(
      select "companyId" from "userToCompany" where "userId" = auth.uid()::text
    )
  );