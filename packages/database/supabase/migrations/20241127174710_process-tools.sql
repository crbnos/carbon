ALTER TABLE "part" ADD CONSTRAINT "part_itemId_unique" UNIQUE ("itemId");
ALTER TABLE "tool" ADD CONSTRAINT "tool_itemId_unique" UNIQUE ("itemId"); 
ALTER TABLE "consumable" ADD CONSTRAINT "consumable_itemId_unique" UNIQUE ("itemId");
ALTER TABLE "material" ADD CONSTRAINT "material_itemId_unique" UNIQUE ("itemId");

CREATE TABLE "methodOperationTool" (
  "id" TEXT NOT NULL DEFAULT xid(),
  "operationId" TEXT NOT NULL,
  "toolId" TEXT NOT NULL,
  "quantity" INTEGER NOT NULL DEFAULT 1,
  "companyId" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "createdBy" TEXT NOT NULL,
  "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT,

  CONSTRAINT "methodOperationTool_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "methodOperationTool_operationId_fkey" FOREIGN KEY ("operationId") REFERENCES "methodOperation"("id") ON DELETE CASCADE,
  CONSTRAINT "methodOperationTool_toolId_fkey" FOREIGN KEY ("toolId") REFERENCES "tool"("itemId") ON DELETE CASCADE,
  CONSTRAINT "methodOperationTool_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id"),
  CONSTRAINT "methodOperationTool_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user"("id") ON DELETE RESTRICT,
  CONSTRAINT "methodOperationTool_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "user"("id") ON DELETE RESTRICT
);

CREATE INDEX "methodOperationTool_operationId_idx" ON "methodOperationTool" ("operationId");
CREATE INDEX "methodOperationTool_toolId_idx" ON "methodOperationTool" ("toolId");

CREATE POLICY "Employees with parts_view can view method operation tools" ON "methodOperationTool"
  FOR SELECT
  USING (
    has_role('employee', "companyId") AND
    has_company_permission('parts_view', "companyId")
  );

CREATE POLICY "Employees with parts_create can create method operation tools" ON "methodOperationTool"
  FOR INSERT
  WITH CHECK (
    has_role('employee', "companyId") AND
    has_company_permission('parts_create', "companyId")
  );

CREATE POLICY "Employees with parts_update can update method operation tools" ON "methodOperationTool"
  FOR UPDATE
  USING (
    has_role('employee', "companyId") AND
    has_company_permission('parts_update', "companyId")
  );

CREATE POLICY "Employees with parts_delete can delete method operation tools" ON "methodOperationTool"
  FOR DELETE
  USING (
    has_role('employee', "companyId") AND
    has_company_permission('parts_delete', "companyId")
  );


CREATE TABLE "quoteOperationTool" (
  "id" TEXT NOT NULL DEFAULT xid(),
  "operationId" TEXT NOT NULL,
  "toolId" TEXT NOT NULL,
  "quantity" INTEGER NOT NULL DEFAULT 1,
  "companyId" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "createdBy" TEXT NOT NULL,
  "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT,

  CONSTRAINT "quoteOperationTool_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "quoteOperationTool_operationId_fkey" FOREIGN KEY ("operationId") REFERENCES "quoteOperation"("id") ON DELETE CASCADE,
  CONSTRAINT "quoteOperationTool_toolId_fkey" FOREIGN KEY ("toolId") REFERENCES "tool"("itemId") ON DELETE CASCADE,
  CONSTRAINT "quoteOperationTool_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id"),
  CONSTRAINT "quoteOperationTool_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user"("id") ON DELETE RESTRICT,
  CONSTRAINT "quoteOperationTool_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "user"("id") ON DELETE RESTRICT
);

CREATE INDEX "quoteOperationTool_operationId_idx" ON "quoteOperationTool" ("operationId");
CREATE INDEX "quoteOperationTool_toolId_idx" ON "quoteOperationTool" ("toolId");

CREATE POLICY "Employees with sales_view can view quote operation tools" ON "quoteOperationTool"
  FOR SELECT
  USING (
    has_role('employee', "companyId") AND
    has_company_permission('sales_view', "companyId")
  );

CREATE POLICY "Employees with sales_create can create quote operation tools" ON "quoteOperationTool"
  FOR INSERT
  WITH CHECK (
    has_role('employee', "companyId") AND
    has_company_permission('sales_create', "companyId")
  );

CREATE POLICY "Employees with sales_update can update quote operation tools" ON "quoteOperationTool"
  FOR UPDATE
  USING (
    has_role('employee', "companyId") AND
    has_company_permission('sales_update', "companyId")
  );

CREATE POLICY "Employees with sales_delete can delete quote operation tools" ON "quoteOperationTool"
  FOR DELETE
  USING (
    has_role('employee', "companyId") AND
    has_company_permission('sales_delete', "companyId")
  );

CREATE TABLE "jobOperationTool" (
  "id" TEXT NOT NULL DEFAULT xid(),
  "operationId" TEXT NOT NULL,
  "toolId" TEXT NOT NULL,
  "quantity" INTEGER NOT NULL DEFAULT 1,
  "companyId" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "createdBy" TEXT NOT NULL,
  "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT,

  CONSTRAINT "jobOperationTool_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "jobOperationTool_operationId_fkey" FOREIGN KEY ("operationId") REFERENCES "jobOperation"("id") ON DELETE CASCADE,
  CONSTRAINT "jobOperationTool_toolId_fkey" FOREIGN KEY ("toolId") REFERENCES "tool"("itemId") ON DELETE CASCADE,
  CONSTRAINT "jobOperationTool_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id"),
  CONSTRAINT "jobOperationTool_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user"("id") ON DELETE RESTRICT,
  CONSTRAINT "jobOperationTool_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "user"("id") ON DELETE RESTRICT
);

CREATE INDEX "jobOperationTool_operationId_idx" ON "jobOperationTool" ("operationId");
CREATE INDEX "jobOperationTool_toolId_idx" ON "jobOperationTool" ("toolId");

CREATE POLICY "Employees with production_view can view job operation tools" ON "jobOperationTool"
  FOR SELECT
  USING (
    has_role('employee', "companyId") AND
    has_company_permission('production_view', "companyId")
  );

CREATE POLICY "Employees with production_create can create job operation tools" ON "jobOperationTool"
  FOR INSERT
  WITH CHECK (
    has_role('employee', "companyId") AND
    has_company_permission('production_create', "companyId")
  );

CREATE POLICY "Employees with production_update can update job operation tools" ON "jobOperationTool"
  FOR UPDATE
  USING (
    has_role('employee', "companyId") AND
    has_company_permission('production_update', "companyId")
  );

CREATE POLICY "Employees with production_delete can delete job operation tools" ON "jobOperationTool"
  FOR DELETE
  USING (
    has_role('employee', "companyId") AND
    has_company_permission('production_delete', "companyId")
  );
