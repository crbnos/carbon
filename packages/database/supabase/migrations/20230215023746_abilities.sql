CREATE TABLE "ability" (
  "id" TEXT NOT NULL DEFAULT xid(),
  "name" TEXT NOT NULL,
  "curve" JSONB NOT NULL DEFAULT '{"data":[{"id":0,"week":0,"value":50},{"id":1,"week":1,"value":80},{"id":2,"week":2,"value":90},{"id":3,"week":3,"value":100}]}'::jsonb,
  "shadowWeeks" NUMERIC NOT NULL DEFAULT 0,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "companyId" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  "createdBy" TEXT NOT NULL,
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  "updatedBy" TEXT,

  CONSTRAINT "abilities_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "abilities_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "abilities_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "abilities_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "ability_companyId_idx" ON "ability" ("companyId");

ALTER TABLE "ability" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Employees with resources_view can view abilities" ON "ability"
  FOR SELECT
  USING (
    has_role('employee', "companyId") AND 
    has_company_permission('resources_view', "companyId")
  );

CREATE POLICY "Employees with resources_create can insert abilities" ON "ability"
  FOR INSERT
  WITH CHECK (   
    has_role('employee', "companyId") AND 
    has_company_permission('resources_create', "companyId")
);

CREATE POLICY "Employees with resources_update can update abilities" ON "ability"
  FOR UPDATE
  USING (
    has_role('employee', "companyId") AND 
    has_company_permission('resources_update', "companyId")
  );

CREATE POLICY "Employees with resources_delete can delete abilities" ON "ability"
  FOR DELETE
  USING (
    has_role('employee', "companyId") AND 
    has_company_permission('resources_delete', "companyId")
  );

CREATE TABLE "employeeAbility" (
  "id" TEXT NOT NULL DEFAULT xid(),
  "employeeId" TEXT NOT NULL,
  "abilityId" TEXT NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "lastTrainingDate" DATE,
  "trainingDays" NUMERIC NOT NULL DEFAULT 0,
  "trainingCompleted" BOOLEAN DEFAULT false,

  CONSTRAINT "employeeAbilities_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "employeeAbilities_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "employeeAbilities_abilityId_fkey" FOREIGN KEY ("abilityId") REFERENCES "ability"("id") ON DELETE CASCADE ON UPDATE CASCADE,

  CONSTRAINT uq_employeeAbility_employeeId_abilityId UNIQUE ( "employeeId", "abilityId")
);

ALTER TABLE "employeeAbility" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Employees with resources_view can view employeeAbilities" ON "employeeAbility"
  FOR SELECT
  USING (
    has_role('employee', get_company_id_from_foreign_key("employeeId", 'employee')) AND
    has_company_permission('resources_view', get_company_id_from_foreign_key("employeeId", 'employee'))
  );

CREATE POLICY "Employees with resources_create can insert employeeAbilities" ON "employeeAbility"
  FOR INSERT
  WITH CHECK (   
    has_role('employee', get_company_id_from_foreign_key("employeeId", 'employee')) AND
    has_company_permission('resources_create', get_company_id_from_foreign_key("employeeId", 'employee'))
);

CREATE POLICY "Employees with resources_update can update employeeAbilities" ON "employeeAbility"
  FOR UPDATE
  USING (
    has_role('employee', get_company_id_from_foreign_key("employeeId", 'employee')) AND
    has_company_permission('resources_update', get_company_id_from_foreign_key("employeeId", 'employee'))
  );

CREATE POLICY "Employees with resources_delete can delete employeeAbilities" ON "employeeAbility"
  FOR DELETE
  USING (
    has_role('employee', get_company_id_from_foreign_key("employeeId", 'employee')) AND
    has_company_permission('resources_delete', get_company_id_from_foreign_key("employeeId", 'employee'))
  );
