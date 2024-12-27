ALTER TABLE "quoteLine" ADD COLUMN "configuration" JSONB;
ALTER TABLE "job" ADD COLUMN "configuration" JSONB;

DROP POLICY "Employees with parts_view can view configuration options" ON "configurationParameter";
DROP POLICY "Employees with parts_view can view configuration groups" ON "configurationParameterGroup";

CREATE POLICY "Employees can view configuration options" ON "configurationParameter"
  FOR SELECT
  USING (
    has_role('employee', "companyId") 
  );

CREATE POLICY "Employees can view configuration groups" ON "configurationParameterGroup"
  FOR SELECT
  USING (
    has_role('employee', "companyId")
  );