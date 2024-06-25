
CREATE TYPE factor AS ENUM (
  'Hours/Piece',
  'Hours/100 Pieces', 
  'Hours/1000 Pieces',
  'Minutes/Piece',
  'Minutes/100 Pieces',
  'Minutes/1000 Pieces',
  'Pieces/Hour',
  'Pieces/Minute',
  'Seconds/Piece',
  'Total Hours',
  'Total Minutes'
);

CREATE TABLE "department" (
  "id" TEXT NOT NULL DEFAULT xid(),
  "name" TEXT NOT NULL UNIQUE,
  "parentDepartmentId" TEXT,
  "companyId" TEXT NOT NULL,
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
  "updatedBy" TEXT,
  "updatedAt" TIMESTAMP,
  "customFields" JSONB,

  CONSTRAINT "department_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "department_parentDepartmentId_fkey" FOREIGN KEY ("parentDepartmentId") REFERENCES "department"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "department_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "department_companyId_idx" ON "department" ("companyId");

ALTER TABLE "department" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Employees can view departments" ON "department"
  FOR SELECT
  USING (
    has_role('employee', "companyId") AND
    "companyId" = ANY(
      select "companyId" from "userToCompany" where "userId" = auth.uid()::text
    )
  );

CREATE POLICY "Employees with resources_create can insert departments" ON "department"
  FOR INSERT
  WITH CHECK (   
    has_role('employee', "companyId") AND
    has_company_permission('resources_create', "companyId")
);

CREATE POLICY "Employees with resources_update can update departments" ON "department"
  FOR UPDATE
  USING (
    has_role('employee', "companyId") AND
    has_company_permission('resources_update', "companyId")
  );

CREATE POLICY "Employees with resources_delete can delete departments" ON "department"
  FOR DELETE
  USING (
    has_role('employee', "companyId") AND
    has_company_permission('resources_delete', "companyId")
  );

CREATE TABLE "workCellType" (
  "id" TEXT NOT NULL DEFAULT xid(),
  "name" TEXT NOT NULL UNIQUE,
  "description" TEXT,
  "requiredAbility" TEXT,
  "quotingRate" NUMERIC NOT NULL DEFAULT 0,
  "laborRate" NUMERIC NOT NULL DEFAULT 0,
  "overheadRate" NUMERIC NOT NULL DEFAULT 0,
  "defaultStandardFactor" factor NOT NULL DEFAULT 'Total Hours',
  "active" BOOLEAN NOT NULL DEFAULT true,
  "companyId" TEXT NOT NULL,
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
  "updatedBy" TEXT,
  "updatedAt" TIMESTAMP,
  "customFields" JSONB,

  CONSTRAINT "workCellType_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "workCellType_requiredAbility_fkey" FOREIGN KEY ("requiredAbility") REFERENCES "ability"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "workCellType_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "workCellType_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "workCellType_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "workCellType_companyId_idx" ON "workCellType" ("companyId");

ALTER TABLE "workCellType" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Employees can view work cell types" ON "workCellType"
  FOR SELECT
  USING (
    has_role('employee', "companyId") AND
    "companyId" = ANY(
      select "companyId" from "userToCompany" where "userId" = auth.uid()::text
    )
  );

CREATE POLICY "Employees with resources_create can insert work cell types" ON "workCellType"
  FOR INSERT
  WITH CHECK (   
    has_role('employee', "companyId") AND
    has_company_permission('resources_create', "companyId")
);

CREATE POLICY "Employees with resources_update can update work cell types" ON "workCellType"
  FOR UPDATE
  USING (
    has_role('employee', "companyId") AND
    has_company_permission('resources_update', "companyId")
  );

CREATE POLICY "Employees with resources_delete can delete work cell types" ON "workCellType"
  FOR DELETE
  USING (
    has_role('employee', "companyId") AND
    has_company_permission('resources_delete', "companyId")
  );

CREATE TABLE "workCell" (
  "id" TEXT NOT NULL DEFAULT xid(),
  "name" TEXT NOT NULL,
  "description" TEXT,
  "defaultStandardFactor" factor NOT NULL DEFAULT 'Hours/Piece',
  "departmentId" TEXT NOT NULL,
  "locationId" TEXT,
  "workCellTypeId" TEXT NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "companyId" TEXT NOT NULL,
  "activeDate" DATE,
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
  "updatedBy" TEXT,
  "updatedAt" TIMESTAMP,
  "customFields" JSONB,

  CONSTRAINT "workCell_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "workCell_workCellTypeId_fkey" FOREIGN KEY ("workCellTypeId") REFERENCES "workCellType"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "workCell_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "location"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "workCell_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "department"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "workCell_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "uq_workCell_name_departmentId" UNIQUE ("name", "departmentId"),
  CONSTRAINT "workCell_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "workCell_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "workCell_companyId_idx" ON "workCell" ("companyId");

ALTER TABLE "workCell" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Employees can view work cells" ON "workCell"
  FOR SELECT
  USING (
    has_role('employee', "companyId") AND
    "companyId" = ANY(
      select "companyId" from "userToCompany" where "userId" = auth.uid()::text
    )
  );

CREATE POLICY "Employees with resources_create can insert work cells" ON "workCell"
  FOR INSERT
  WITH CHECK (   
    has_role('employee', "companyId") AND
    has_company_permission('resources_create', "companyId")
);

CREATE POLICY "Employees with resources_update can update work cells" ON "workCell"
  FOR UPDATE
  USING (
    has_role('employee', "companyId") AND
    has_company_permission('resources_update', "companyId")
  );

CREATE POLICY "Employees with resources_delete can delete work cells" ON "workCell"
  FOR DELETE
  USING (
    has_role('employee', "companyId") AND
    has_company_permission('resources_delete', "companyId")
  );

ALTER TABLE "employeeJob"
  ADD COLUMN "departmentId" TEXT REFERENCES "department"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD COLUMN "workCellId" TEXT REFERENCES "workCell"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "crew" (
  "id" TEXT NOT NULL DEFAULT xid(),
  "name" TEXT NOT NULL UNIQUE,
  "description" TEXT,
  "crewLeaderId" TEXT,
  "groupId" TEXT NOT NULL,
  "workCellId" TEXT,
  "companyId" TEXT NOT NULL,
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
  "updatedBy" TEXT,
  "updatedAt" TIMESTAMP,

  CONSTRAINT "crew_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "crew_crewLeaderId_fkey" FOREIGN KEY ("crewLeaderId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "crew_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "group"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "crew_workCellId_fkey" FOREIGN KEY ("workCellId") REFERENCES "workCell"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "crew_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "crew_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

ALTER TABLE "crew" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "Employees can view crews" ON "crew"
  FOR SELECT
  USING (
    has_role('employee', "companyId") AND
    "companyId" = ANY(
      select "companyId" from "userToCompany" where "userId" = auth.uid()::text
    )
  );

CREATE POLICY "Employees with resources_create can insert crews" ON "crew"
  FOR INSERT
  WITH CHECK (   
    has_role('employee', "companyId") AND
    has_company_permission('resources_create', "companyId")
);

CREATE POLICY "Employees with resources_update can update crews" ON "crew"
  FOR UPDATE
  USING (
    has_role('employee', "companyId") AND
    has_company_permission('resources_update', "companyId")
  );

CREATE POLICY "Employees with resources_delete can delete crews" ON "crew"
  FOR DELETE
  USING (
    has_role('employee', "companyId") AND
    has_company_permission('resources_delete', "companyId")
  );

CREATE TABLE "crewAbility" (
  "id" TEXT NOT NULL DEFAULT xid(),
  "crewId" TEXT NOT NULL,
  "abilityId" TEXT NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,

  CONSTRAINT "crewAbility_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "crewAbility_crewId_fkey" FOREIGN KEY ("crewId") REFERENCES "crew"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "crewAbility_abilityId_fkey" FOREIGN KEY ("abilityId") REFERENCES "ability"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

ALTER TABLE "crewAbility" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Employees with resources_view can view crew abilities" ON "crewAbility"
  FOR SELECT
  USING (
    has_role('employee', get_company_id_from_foreign_key("crewId", 'crew')) AND 
    has_company_permission('resources_view', get_company_id_from_foreign_key("crewId", 'crew'))  
  );

CREATE POLICY "Employees with resources_create can insert crew abilities" ON "crewAbility"
  FOR INSERT
  WITH CHECK (   
    has_role('employee', get_company_id_from_foreign_key("crewId", 'crew')) AND 
    has_company_permission('resources_create', get_company_id_from_foreign_key("crewId", 'crew')) 
);

CREATE POLICY "Employees with resources_update can update crew abilities" ON "crewAbility"
  FOR UPDATE
  USING (
    has_role('employee', get_company_id_from_foreign_key("crewId", 'crew')) AND 
    has_company_permission('resources_update', get_company_id_from_foreign_key("crewId", 'crew')) 
  );

CREATE POLICY "Employees with resources_delete can delete crew abilities" ON "crewAbility"
  FOR DELETE
  USING (
    has_role('employee', get_company_id_from_foreign_key("crewId", 'crew')) AND 
    has_company_permission('resources_delete', get_company_id_from_foreign_key("crewId", 'crew')) 
  );

CREATE TABLE "equipmentType" (
  "id" TEXT NOT NULL DEFAULT xid(),
  "name" TEXT NOT NULL UNIQUE,
  "description" TEXT,
  "requiredAbility" TEXT,
  "setupHours" NUMERIC NOT NULL DEFAULT 0,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "companyId" TEXT NOT NULL,
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
  "updatedBy" TEXT,
  "updatedAt" TIMESTAMP,
  "customFields" JSONB,

  CONSTRAINT "equipmentType_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "equipmentType_requiredAbility_fkey" FOREIGN KEY ("requiredAbility") REFERENCES "ability"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "equipmentType_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "equipmentType_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "equipmentType_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "equipmentType_companyId_idx" ON "equipmentType" ("companyId");

ALTER TABLE "equipmentType" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Employees can view equipment types" ON "equipmentType"
  FOR SELECT
  USING (
    has_role('employee', "companyId") AND
    "companyId" = ANY(
      select "companyId" from "userToCompany" where "userId" = auth.uid()::text
    )
  );

CREATE POLICY "Employees with resources_create can insert equipment types" ON "equipmentType"
  FOR INSERT
  WITH CHECK (   
    has_role('employee', "companyId") AND
    has_company_permission('resources_create', "companyId")
);

CREATE POLICY "Employees with resources_update can update equipment types" ON "equipmentType"
  FOR UPDATE
  USING (
    has_role('employee', "companyId") AND
    has_company_permission('resources_update', "companyId")
  );

CREATE POLICY "Employees with resources_delete can delete equipment types" ON "equipmentType"
  FOR DELETE
  USING (
    has_role('employee', "companyId") AND
    has_company_permission('resources_update', "companyId")
  );

CREATE TABLE "equipment" (
  "id" TEXT NOT NULL DEFAULT xid(),
  "name" TEXT NOT NULL UNIQUE,
  "description" TEXT,
  "equipmentTypeId" TEXT NOT NULL,
  "operatorsRequired" NUMERIC NOT NULL DEFAULT 1,
  "setupHours" NUMERIC NOT NULL DEFAULT 0,
  "locationId" TEXT NOT NULL,
  "workCellId" TEXT,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "activeDate" DATE DEFAULT CURRENT_DATE,
  "companyId" TEXT NOT NULL,
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
  "updatedBy" TEXT,
  "updatedAt" TIMESTAMP,
  "customFields" JSONB,

  CONSTRAINT "equipment_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "equipment_equipmentTypeId_fkey" FOREIGN KEY ("equipmentTypeId") REFERENCES "equipmentType"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "equipment_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "location"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "equipment_workCellId_fkey" FOREIGN KEY ("workCellId") REFERENCES "workCell"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "equipment_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "equipment_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "equipment_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "equipment_companyId_idx" ON "equipment" ("companyId");

ALTER TABLE "equipment" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Employees can view equipment" ON "equipment"
  FOR SELECT
  USING (
    has_role('employee', "companyId") AND
    "companyId" = ANY(
      select "companyId" from "userToCompany" where "userId" = auth.uid()::text
    )
  );

CREATE POLICY "Employees with resources_create can insert equipment" ON "equipment"
  FOR INSERT
  WITH CHECK (   
    has_role('employee', "companyId") AND
    has_company_permission('resources_create', "companyId")
);

CREATE POLICY "Employees with resources_update can update equipment" ON "equipment"
  FOR UPDATE
  USING (
    has_role('employee', "companyId") AND
    has_company_permission('resources_update', "companyId")
  );

CREATE POLICY "Employees with resources_delete can delete equipment" ON "equipment"
  FOR DELETE
  USING (
    has_role('employee', "companyId") AND
    has_company_permission('resources_update', "companyId")
  );

CREATE FUNCTION public.create_equipment_search_result()
RETURNS TRIGGER AS $$
DECLARE
  equipment_type TEXT;
BEGIN
  equipment_type := (SELECT et."name" FROM public."equipmentType" et WHERE et.id = new."equipmentTypeId");
  INSERT INTO public.search(name, description, entity, uuid, link, "companyId")
  VALUES (new.name, COALESCE(new.description, '') || ' ' || equipment_type, 'Resource', new.id, '/x/resources/equipment/list/' || new."equipmentTypeId" || '/' || new.id, new."companyId");
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER create_equipment_search_result
  AFTER INSERT on public.equipment
  FOR EACH ROW EXECUTE PROCEDURE public.create_equipment_search_result();

CREATE FUNCTION public.update_equipment_search_result()
RETURNS TRIGGER AS $$
DECLARE
  equipment_type TEXT;
BEGIN
  IF (old.name <> new.name OR old.description <> new.description OR old."equipmentTypeId" <> new."equipmentTypeId") THEN
    equipment_type := (SELECT et."name" FROM public."equipmentType" et WHERE et.id = new."equipmentTypeId");
    UPDATE public.search SET name = new.name, description = COALESCE(new.description, '') || ' ' || equipment_type
    WHERE entity = 'Resource' AND uuid = new.id;
  END IF;
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER update_equipment_search_result
  AFTER UPDATE on public.equipment
  FOR EACH ROW EXECUTE PROCEDURE public.update_equipment_search_result();


