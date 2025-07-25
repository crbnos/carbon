ALTER TABLE "item" ALTER COLUMN "companyId" DROP NOT NULL;

ALTER POLICY "Employees can view items" ON "item"
  USING (
    has_role('employee', "companyId") 
    AND (
      "companyId" IS NULL OR
      "companyId" = ANY(
        select "companyId" from "userToCompany" where "userId" = auth.uid()::text
      )
    )
  );

CREATE TABLE "materialForm" (
  "id" TEXT NOT NULL DEFAULT xid(),
  "name" TEXT NOT NULL,
  "companyId" TEXT,
  "customFields" JSONB,
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT,
  "updatedAt" TIMESTAMP WITH TIME ZONE,

  CONSTRAINT "materialForm_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "materialForm_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "materialForm_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "materialForm_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "materialForm_companyId_idx" ON "materialForm"("companyId");

ALTER TABLE "materialForm" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view global material forms" ON "materialForm"
  FOR SELECT
  USING (
    auth.role() = 'authenticated' AND
    "companyId" IS NULL
  );

CREATE POLICY "Employees can view material forms" ON "materialForm"
  FOR SELECT
  USING (
    has_role('employee', "companyId") 
    AND (
      "companyId" IS NULL OR
      "companyId" = ANY(
        select "companyId" from "userToCompany" where "userId" = auth.uid()::text
      )
    )
  );

CREATE POLICY "Employees with parts_create can insert material forms" ON "materialForm"
  FOR INSERT
  WITH CHECK (   
    has_role('employee', "companyId") AND
    has_company_permission('parts_create', "companyId")
  );

CREATE POLICY "Employees with parts_update can update material forms" ON "materialForm"
  FOR UPDATE
  USING (
    has_role('employee', "companyId") AND
    has_company_permission('parts_update', "companyId")
  );

CREATE POLICY "Employees with parts_delete can delete material forms" ON "materialForm"
  FOR DELETE
  USING (
    has_role('employee', "companyId") AND
    has_company_permission('parts_delete', "companyId")
  );

INSERT INTO "customFieldTable" ("table", "name", "module") 
VALUES ('materialForm', 'Material Form', 'Items');

CREATE TABLE "materialSubstance" (
  "id" TEXT NOT NULL DEFAULT xid(),
  "name" TEXT NOT NULL,
  "companyId" TEXT,
  "customFields" JSONB,
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT,
  "updatedAt" TIMESTAMP WITH TIME ZONE,

  CONSTRAINT "materialSubstance_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "materialSubstance_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "materialSubstance_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "materialSubstance_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);


CREATE INDEX "materialSubstance_companyId_idx" ON "materialSubstance"("companyId");

ALTER TABLE "materialSubstance" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Employees can view material substances" ON "materialSubstance"
  FOR SELECT
  USING (
    has_role('employee', "companyId") 
    AND (
      "companyId" IS NULL OR
      "companyId" = ANY(
        select "companyId" from "userToCompany" where "userId" = auth.uid()::text
      )
    )
  );

CREATE POLICY "Authenticated users can view global material substances" ON "materialSubstance"
  FOR SELECT
  USING (
    auth.role() = 'authenticated' AND
    "companyId" IS NULL
  );

CREATE POLICY "Employees with parts_create can insert material substances" ON "materialSubstance"
  FOR INSERT
  WITH CHECK (   
    has_role('employee', "companyId") AND
    has_company_permission('parts_create', "companyId")
  );

CREATE POLICY "Employees with parts_update can update material substances" ON "materialSubstance"
  FOR UPDATE
  USING (
    has_role('employee', "companyId") AND
    has_company_permission('parts_update', "companyId")
  );

CREATE POLICY "Employees with parts_delete can delete material substances" ON "materialSubstance"
  FOR DELETE
  USING (
    has_role('employee', "companyId") AND
    has_company_permission('parts_delete', "companyId")
  );

INSERT INTO "customFieldTable" ("table", "name", "module") 
VALUES ('materialSubstance', 'Material Substance', 'Items');

CREATE TABLE "material" (
  "id" TEXT NOT NULL,
  "itemId" TEXT,
  "materialFormId" TEXT NOT NULL,
  "materialSubstanceId" TEXT NOT NULL,
  "grade" TEXT,
  "dimensions" TEXT,
  "finish" TEXT,
  "approved" BOOLEAN NOT NULL DEFAULT false,
  "approvedBy" TEXT,
  "customFields" JSONB,
  "companyId" TEXT, -- nullable because we share certain materials across companies
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT,
  "updatedAt" TIMESTAMP WITH TIME ZONE,

  CONSTRAINT "material_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "material_materialFormId_fkey" FOREIGN KEY ("materialFormId") REFERENCES "materialForm"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "material_materialSubstanceId_fkey" FOREIGN KEY ("materialSubstanceId") REFERENCES "materialSubstance"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "material_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "item"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  -- unique index on itemId, materialFormId, materialSubstanceId, grade, dimensions, finish
  CONSTRAINT "material_unique" UNIQUE ("itemId", "materialFormId", "materialSubstanceId", "grade", "dimensions", "finish", "companyId"),
  CONSTRAINT "material_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id"),
  CONSTRAINT "material_approvedBy_fkey" FOREIGN KEY ("approvedBy") REFERENCES "user"("id"),
  CONSTRAINT "material_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user"("id"),
  CONSTRAINT "material_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "user"("id")
);



CREATE INDEX "material_companyId_idx" ON "material"("companyId");
CREATE INDEX "material_itemId_idx" ON "material"("itemId");

ALTER TABLE "material" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Employees can view materials" ON "material"
  FOR SELECT
  USING (
    has_role('employee', "companyId") 
    AND (
      "companyId" IS NULL OR
      "companyId" = ANY(
        select "companyId" from "userToCompany" where "userId" = auth.uid()::text
      )
    )
  );

CREATE POLICY "Employees with parts_create can insert materials" ON "material"
  FOR INSERT
  WITH CHECK (   
    has_role('employee', "companyId") AND
    has_company_permission('parts_create', "companyId")
  );

CREATE POLICY "Employees with parts_update can update materials" ON "material"
  FOR UPDATE
  USING (
    has_role('employee', "companyId") AND
    has_company_permission('parts_update', "companyId")
  );

CREATE POLICY "Employees with parts_delete can delete materials" ON "material"
  FOR DELETE
  USING (
    has_role('employee', "companyId") AND
    has_company_permission('parts_delete', "companyId")
  );

INSERT INTO "customFieldTable" ("table", "name", "module") 
VALUES ('material', 'Material', 'Items');

CREATE OR REPLACE VIEW "materials" WITH(SECURITY_INVOKER=true) AS 
  SELECT
    i.name,
    i.description,
    i."itemTrackingType",
    i."unitOfMeasureCode",
    i.active,
    i.blocked,
    i.assignee,
    m.*,
    mf."name" AS "materialForm",
    ms."name" AS "materialSubstance",
    s."supplierIds",
    uom.name as "unitOfMeasure"
  FROM "material" m
  INNER JOIN "item" i ON i.id = m."itemId"
  LEFT JOIN (
    SELECT 
      "itemId",
      array_agg(s."supplierId") AS "supplierIds"
    FROM "buyMethod" s
    GROUP BY "itemId"
  )  s ON s."itemId" = m."itemId"
  LEFT JOIN "materialForm" mf ON mf.id = m."materialFormId"
  LEFT JOIN "materialSubstance" ms ON ms.id = m."materialSubstanceId"
  LEFT JOIN "unitOfMeasure" uom ON uom.code = i."unitOfMeasureCode" AND uom."companyId" = i."companyId";


INSERT INTO "materialSubstance" ("name", "createdBy")
VALUES 
  ('Aluminum', 'system'), 
  ('Steel', 'system'), 
  ('Stainless Steel', 'system'),
  ('Titanium', 'system'),
  ('Brass', 'system'),
  ('Copper', 'system');

INSERT INTO "materialForm" ("name", "createdBy")
VALUES 
  ('Angle', 'system'),
  ('Channel', 'system'),
  ('Beam', 'system'),
  ('Flat Bar', 'system'),
  ('Round Bar', 'system'),
  ('Square Bar', 'system'),
  ('Pipe', 'system'),
  ('Square Tube', 'system'),
  ('Rectangle Tube', 'system'),
  ('Diamond Plate', 'system'),
  ('Plate', 'system'),
  ('Sheet', 'system');
