CREATE TABLE "jobOperationNote" (
  "id" TEXT NOT NULL DEFAULT xid(),
  "jobOperationId" TEXT NOT NULL,
  "note" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "createdBy" TEXT NOT NULL,
  "updatedBy" TEXT,
  "updatedAt" TIMESTAMP WITH TIME ZONE,

  CONSTRAINT "jobOperationNote_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "jobOperationNote_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT "jobOperationNote_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user"("id") ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT "jobOperationNote_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "user"("id") ON UPDATE CASCADE ON DELETE SET NULL
);

CREATE INDEX "jobOperationNote_companyId_fkey" ON "jobOperationNote"("companyId", "jobOperationId");

ALTER TABLE "jobOperationNote" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Employees can view job operation notes" ON "jobOperationNote"
  FOR SELECT
  USING (
    has_role('employee', "companyId")
  );

CREATE POLICY "Employees can insert job operation notes" ON "jobOperationNote"
  FOR INSERT
  WITH CHECK (
    has_role('employee', "companyId")
  );

CREATE POLICY "Employees with production_update can update job operation notes" ON "jobOperationNote"
  FOR UPDATE
  USING (
    has_role('employee', "companyId") AND
    has_company_permission('production_update', "companyId")
  );

CREATE POLICY "Employees with production_delete can delete job operation notes" ON "jobOperationNote"
  FOR DELETE
  USING (
    has_role('employee', "companyId") AND
    has_company_permission('production_delete', "companyId")
  );

ALTER TABLE "jobOperationNote" ADD COLUMN "productionQuantityId" TEXT;

ALTER TABLE "jobOperationNote" ADD CONSTRAINT "jobOperationNote_productionQuantityId_fkey" FOREIGN KEY ("productionQuantityId") REFERENCES "productionQuantity"("id") ON UPDATE CASCADE ON DELETE CASCADE;

CREATE INDEX "jobOperationNote_productionQuantityId_fkey" ON "jobOperationNote"("productionQuantityId");

ALTER PUBLICATION supabase_realtime ADD TABLE "jobOperationNote";
