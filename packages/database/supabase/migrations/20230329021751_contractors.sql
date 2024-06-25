CREATE TABLE "contractor" (
  "id" TEXT NOT NULL,
  "hoursPerWeek" INTEGER NOT NULL DEFAULT 0,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "companyId" TEXT NOT NULL,
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT,
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  "customFields" JSONB,

  CONSTRAINT "contractor_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "contractor_id_fkey" FOREIGN KEY ("id") REFERENCES "supplierContact"("id"),
  CONSTRAINT "contractor_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "contractor_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user"("id"),
  CONSTRAINT "contractor_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "user"("id")
);

CREATE INDEX "contractor_companyId_idx" ON "contractor" ("companyId");

ALTER TABLE "contractor" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Employees with resources_view can view contractors" ON "contractor"
  FOR SELECT
  USING (
    has_role('employee', "companyId") AND
    has_company_permission('resources_view', "companyId")
  );

CREATE POLICY "Employees with resources_create can insert contractors" ON "contractor"
  FOR INSERT
  WITH CHECK (   
    has_role('employee', "companyId") AND
    has_company_permission('resources_create', "companyId")
);

CREATE POLICY "Employees with resources_update can update contractors" ON "contractor"
  FOR UPDATE
  USING (
    has_role('employee', "companyId") AND
    has_company_permission('resources_update', "companyId")
  );

CREATE POLICY "Employees with resources_delete can delete contractors" ON "contractor"
  FOR DELETE
  USING (
    has_role('employee', "companyId") AND
    has_company_permission('resources_delete', "companyId")
  );


CREATE TABLE "contractorAbility" (
  "contractorId" TEXT NOT NULL,
  "abilityId" TEXT NOT NULL,
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),

  CONSTRAINT "contractorAbility_pkey" PRIMARY KEY ("contractorId", "abilityId"),
  CONSTRAINT "contractorAbility_contractorId_fkey" FOREIGN KEY ("contractorId") REFERENCES "contractor"("id") ON DELETE CASCADE,
  CONSTRAINT "contractorAbility_abilityId_fkey" FOREIGN KEY ("abilityId") REFERENCES "ability"("id") ON DELETE CASCADE,
  CONSTRAINT "contractorAbility_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user"("id")
);

ALTER TABLE "contractorAbility" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Employees with resources_view can view contractor abilities" ON "contractorAbility"
  FOR SELECT
  USING (
    has_role('employee', get_company_id_from_foreign_key("contractorId", 'contractor')) AND
    has_company_permission('resources_view', get_company_id_from_foreign_key("contractorId", 'contractor'))
  );

CREATE POLICY "Employees with resources_create can insert contractor abilities" ON "contractorAbility"
  FOR INSERT
  WITH CHECK (   
    has_role('employee', get_company_id_from_foreign_key("contractorId", 'contractor')) AND
    has_company_permission('resources_create', get_company_id_from_foreign_key("contractorId", 'contractor'))
);

CREATE POLICY "Employees with resources_update can update contractor abilities" ON "contractorAbility"
  FOR UPDATE
  USING (
    has_role('employee', get_company_id_from_foreign_key("contractorId", 'contractor')) AND
    has_company_permission('resources_update', get_company_id_from_foreign_key("contractorId", 'contractor'))
  );

CREATE POLICY "Employees with resources_delete can delete contractor abilities" ON "contractorAbility"
  FOR DELETE
  USING (
    has_role('employee', get_company_id_from_foreign_key("contractorId", 'contractor')) AND
    has_company_permission('resources_delete', get_company_id_from_foreign_key("contractorId", 'contractor'))
  );


CREATE OR REPLACE VIEW "contractors" AS
  SELECT 
    p.id AS "supplierContactId", 
    p."active", 
    p."hoursPerWeek", 
    p."companyId",
    p."customFields",
    s.id AS "supplierId", 
    s.name AS "supplierName", 
    c."firstName",
    c."lastName",
    c."email",
    array_agg(pa."abilityId") AS "abilityIds"
  FROM "contractor" p 
    INNER JOIN "supplierContact" sc 
      ON sc.id = p.id
    INNER JOIN "supplier" s
      ON s.id = sc."supplierId"
    INNER JOIN "contact" c 
      ON c.id = sc."contactId"
    LEFT JOIN "contractorAbility" pa
      ON pa."contractorId" = p.id
  WHERE p."active" = true
  GROUP BY p.id, p.active, p."hoursPerWeek", p."customFields", p."companyId", s.id, c.id, s.name, c."firstName", c."lastName", c."email";