CREATE TYPE "serviceType" AS ENUM (
  'Internal',
  'External'
);

CREATE TABLE "service" (
  "id" TEXT NOT NULL,
  "itemId" TEXT,
  "serviceType" "serviceType" NOT NULL,
  "approved" BOOLEAN NOT NULL DEFAULT false,
  "approvedBy" TEXT,
  "fromDate" DATE,
  "toDate" DATE,
  "assignee" TEXT,
  "customFields" JSONB,
  "companyId" TEXT NOT NULL,
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT,
  "updatedAt" TIMESTAMP WITH TIME ZONE,

  CONSTRAINT "service_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "service_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "item"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "service_assignee_fkey" FOREIGN KEY ("assignee") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "service_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id"),
  CONSTRAINT "service_approvedBy_fkey" FOREIGN KEY ("approvedBy") REFERENCES "user"("id"),
  CONSTRAINT "service_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user"("id"),
  CONSTRAINT "service_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "user"("id")
);

CREATE INDEX "service_companyId_idx" ON "service"("companyId");
CREATE INDEX "service_itemId_idx" ON "service"("itemId");
CREATE INDEX "service_serviceType_idx" ON "service"("serviceType", "companyId");

CREATE POLICY "Employees can view services" ON "service"
  FOR SELECT
  USING (
    has_role('employee') 
    AND "companyId" = ANY(
      select "companyId" from "userToCompany" where "userId" = auth.uid()::text
    )
  );

CREATE POLICY "Employees with parts_create can insert services" ON "service"
  FOR INSERT
  WITH CHECK (   
    has_role('employee') AND
    has_company_permission('parts_create', "companyId")
  );

CREATE POLICY "Employees with parts_update can update services" ON "service"
  FOR UPDATE
  USING (
    has_role('employee') AND
    has_company_permission('parts_update', "companyId")
  );

CREATE POLICY "Employees with parts_delete can delete services" ON "service"
  FOR DELETE
  USING (
    has_role('employee') AND
    has_company_permission('parts_delete', "companyId")
  );


CREATE TABLE "serviceSupplier" (
  "id" TEXT NOT NULL DEFAULT xid(),
  "serviceId" TEXT NOT NULL,
  "supplierId" TEXT NOT NULL,
  "supplierServiceId" TEXT,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "companyId" TEXT NOT NULL,
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT,
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  "customFields" JSONB,

  CONSTRAINT "serviceSupplier_id_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "serviceSupplier_serviceId_fkey" FOREIGN KEY ("serviceId", "companyId") REFERENCES "service"("id", "companyId") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "serviceSupplier_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "supplier"("id") ON DELETE CASCADE,
  CONSTRAINT "serviceSupplier_service_supplier_unique" UNIQUE ("serviceId", "supplierId"),
  CONSTRAINT "serviceSupplier_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id"),
  CONSTRAINT "serviceSupplier_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user"("id"),
  CONSTRAINT "serviceSupplier_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "user"("id")
);

CREATE INDEX "serviceSupplier_serviceId_idx" ON "serviceSupplier"("serviceId");

ALTER TABLE "serviceSupplier" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Employees with part/purchasing_view can view service suppliers" ON "serviceSupplier"
  FOR SELECT
  USING (
    has_role('employee') AND
    (
      has_company_permission('parts_create', "companyId") OR
      has_company_permission('purchase_view', "companyId")
    )
  );

CREATE POLICY "Employees with parts_update can update service suppliers" ON "serviceSupplier"
  FOR UPDATE
  USING (
    has_role('employee') AND
    has_company_permission('parts_update', "companyId")
  );

CREATE POLICY "Employees with parts_create can create service suppliers" ON "serviceSupplier"
  FOR INSERT
  WITH CHECK (
    has_role('employee') AND
    has_company_permission('parts_create', "companyId")
  );

CREATE POLICY "Employees with parts_delete can delete service suppliers" ON "serviceSupplier"
  FOR DELETE
  USING (
    has_role('employee') AND
    has_company_permission('parts_delete', "companyId")
  );

CREATE POLICY "Suppliers with parts_view can view their own part suppliers" ON "serviceSupplier"
  FOR SELECT
  USING (
    has_role('supplier') AND
    has_company_permission('parts_view', "companyId")
    AND "supplierId" IN (
      SELECT "supplierId" FROM "supplierAccount" WHERE id::uuid = auth.uid()
    )
  );

CREATE POLICY "Suppliers with parts_update can update their own part suppliers" ON "serviceSupplier"
  FOR UPDATE
  USING (
    has_role('supplier') AND
    has_company_permission('parts_update', "companyId")
    AND "supplierId" IN (
      SELECT "supplierId" FROM "supplierAccount" WHERE id::uuid = auth.uid()
    )
  );

CREATE OR REPLACE VIEW "services" WITH(SECURITY_INVOKER=true) AS
  SELECT
    s."id",
    s."itemId",
    i."name",
    i."description",
    i."blocked",
    i."partGroupId",
    s."serviceType",
    i."active",
    s."approved",
    s."approvedBy",
    s."fromDate",
    s."toDate",
    s."customFields",
    s."companyId",
    pg.name AS "partGroup",
    array_agg(ss."supplierId") AS "supplierIds"
  FROM "service" s
  INNER JOIN "item" i ON i."id" = s."itemId"
  LEFT JOIN "partGroup" pg ON pg.id = i."partGroupId"
  LEFT JOIN "serviceSupplier" ss ON ss."serviceId" = s.id
  GROUP BY 
    s."id",
    s."itemId",
    i."name",
    i."description",
    i."blocked",
    i."partGroupId",
    i."active",
    s."serviceType",
    s."approved",
    s."approvedBy",
    s."fromDate",
    s."toDate",
    s."customFields",
    s."companyId",
    pg.name;