DROP TABLE "employeeAbility";
CREATE TABLE "employeeAbility" (
  "id" TEXT NOT NULL DEFAULT xid(),
  "employeeId" TEXT NOT NULL,
  "abilityId" TEXT NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "lastTrainingDate" DATE,
  "trainingDays" NUMERIC NOT NULL DEFAULT 0,
  "trainingCompleted" BOOLEAN DEFAULT false,
  "companyId" TEXT NOT NULL REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,

  CONSTRAINT "employeeAbilities_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "employeeAbilities_employeeId_fkey" FOREIGN KEY ("employeeId", "companyId") REFERENCES "employee"("id", "companyId") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "employeeAbilities_abilityId_fkey" FOREIGN KEY ("abilityId") REFERENCES "ability"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "employeeAbilities_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,

  CONSTRAINT uq_employeeAbility_employeeId_abilityId UNIQUE ( "employeeId", "abilityId")
);

ALTER TABLE "employeeAbility" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Employees with resources_view can view employeeAbilities" ON "employeeAbility"
  FOR SELECT
  USING (
    has_role('employee', "companyId") AND
    has_company_permission('resources_view', "companyId")
  );

CREATE POLICY "Employees with resources_create can insert employeeAbilities" ON "employeeAbility"
  FOR INSERT
  WITH CHECK (   
    has_role('employee', "companyId") AND
    has_company_permission('resources_create', "companyId")
);

CREATE POLICY "Employees with resources_update can update employeeAbilities" ON "employeeAbility"
  FOR UPDATE
  USING (
    has_role('employee', "companyId") AND
    has_company_permission('resources_update', "companyId")
  );

CREATE POLICY "Employees with resources_delete can delete employeeAbilities" ON "employeeAbility"
  FOR DELETE
  USING (
    has_role('employee', "companyId") AND
    has_company_permission('resources_delete', "companyId")
  );
