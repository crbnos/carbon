CREATE TABLE "fixture" (
  "id" TEXT NOT NULL,
  "itemId" TEXT,
  "customerId" TEXT,
  "approved" BOOLEAN NOT NULL DEFAULT false,
  "approvedBy" TEXT,
  "customFields" JSONB,
  "companyId" TEXT NOT NULL,
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT,
  "updatedAt" TIMESTAMP WITH TIME ZONE,

  CONSTRAINT "fixture_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "fixture_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "item"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "fixture_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customer"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "fixture_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id"),
  CONSTRAINT "fixture_approvedBy_fkey" FOREIGN KEY ("approvedBy") REFERENCES "user"("id"),
  CONSTRAINT "fixture_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user"("id"),
  CONSTRAINT "fixture_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "user"("id")
);

CREATE INDEX "fixture_companyId_idx" ON "fixture"("companyId");
CREATE INDEX "fixture_itemId_idx" ON "fixture"("itemId");

CREATE POLICY "Employees can view fixtures" ON "fixture"
  FOR SELECT
  USING (
    has_role('employee') 
    AND "companyId" = ANY(
      select "companyId" from "userToCompany" where "userId" = auth.uid()::text
    )
  );

CREATE POLICY "Employees with parts_create can insert fixtures" ON "fixture"
  FOR INSERT
  WITH CHECK (   
    has_role('employee') AND
    has_company_permission('parts_create', "companyId")
  );

CREATE POLICY "Employees with parts_update can update fixtures" ON "fixture"
  FOR UPDATE
  USING (
    has_role('employee') AND
    has_company_permission('parts_update', "companyId")
  );

CREATE POLICY "Employees with parts_delete can delete fixtures" ON "fixture"
  FOR DELETE
  USING (
    has_role('employee') AND
    has_company_permission('parts_delete', "companyId")
  );

INSERT INTO "customFieldTable" ("table", "name", "module") 
VALUES ('fixture', 'Fixture', 'Items');

CREATE OR REPLACE VIEW "fixtures" WITH(SECURITY_INVOKER=true) AS 
  SELECT
    i.name,
    i.description,
    i."itemGroupId",
    i."itemInventoryType",
    i.active,
    i.blocked,
    i.assignee,
    f.*,
    ig.name AS "itemGroup",
    s."supplierIds",
    c.name as "customer"
  FROM "fixture" f
  INNER JOIN "item" i ON i.id = f."itemId"
  LEFT JOIN "itemGroup" ig ON ig.id = i."itemGroupId"
  LEFT JOIN (
    SELECT 
      "itemId",
      array_agg(s."supplierId") AS "supplierIds"
    FROM "itemSupplier" s
    GROUP BY "itemId"
  )  s ON s."itemId" = f."itemId"
  LEFT JOIN "customer" c ON c.id = f."customerId";
