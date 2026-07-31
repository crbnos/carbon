-- Normalize assembly* SELECT policies from the `production_view` permission to
-- get_companies_with_employee_role(), so any employee of the company can read
-- assembly instructions. This matches the `procedure` table and the feature's
-- own newer MES step/slide tables (which already SELECT via employee role).
-- INSERT/UPDATE/DELETE stay on production_create/update/delete (unchanged).
-- Idempotent: DROP POLICY IF EXISTS before each CREATE.

DROP POLICY IF EXISTS "SELECT" ON "public"."assemblyPlanJob";
CREATE POLICY "SELECT" ON "public"."assemblyPlanJob"
  FOR SELECT USING (
    "companyId" = ANY ((SELECT get_companies_with_employee_role())::text[])
  );

DROP POLICY IF EXISTS "SELECT" ON "public"."assemblyInstruction";
CREATE POLICY "SELECT" ON "public"."assemblyInstruction"
  FOR SELECT USING (
    "companyId" = ANY ((SELECT get_companies_with_employee_role())::text[])
  );

DROP POLICY IF EXISTS "SELECT" ON "public"."assemblyInstructionStep";
CREATE POLICY "SELECT" ON "public"."assemblyInstructionStep"
  FOR SELECT USING (
    "companyId" = ANY ((SELECT get_companies_with_employee_role())::text[])
  );

DROP POLICY IF EXISTS "SELECT" ON "public"."assemblyInstructionStepRequirement";
CREATE POLICY "SELECT" ON "public"."assemblyInstructionStepRequirement"
  FOR SELECT USING (
    "companyId" = ANY ((SELECT get_companies_with_employee_role())::text[])
  );

DROP POLICY IF EXISTS "SELECT" ON "public"."assemblyStandardNote";
CREATE POLICY "SELECT" ON "public"."assemblyStandardNote"
  FOR SELECT USING (
    "companyId" = ANY ((SELECT get_companies_with_employee_role())::text[])
  );

DROP POLICY IF EXISTS "SELECT" ON "public"."assemblyInstructionStepMaterial";
CREATE POLICY "SELECT" ON "public"."assemblyInstructionStepMaterial"
  FOR SELECT USING (
    "companyId" = ANY ((SELECT get_companies_with_employee_role())::text[])
  );

DROP POLICY IF EXISTS "SELECT" ON "public"."assemblyUnit";
CREATE POLICY "SELECT" ON "public"."assemblyUnit"
  FOR SELECT USING (
    "companyId" = ANY ((SELECT get_companies_with_employee_role())::text[])
  );

DROP POLICY IF EXISTS "SELECT" ON "public"."assemblyComponentMapping";
CREATE POLICY "SELECT" ON "public"."assemblyComponentMapping"
  FOR SELECT USING (
    "companyId" = ANY ((SELECT get_companies_with_employee_role())::text[])
  );
