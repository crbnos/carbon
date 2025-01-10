CREATE TABLE "noQuoteReason" (
    "id" TEXT NOT NULL DEFAULT xid(),
    "name" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "createdBy" TEXT NOT NULL,
    "updatedBy" TEXT,
    "updatedAt" TIMESTAMP WITH TIME ZONE,
    "customFields" JSONB,

    CONSTRAINT "noQuoteReason_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "noQuoteReason_name_unique" UNIQUE ("name", "companyId"),
    CONSTRAINT "noQuoteReason_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT "noQuoteReason_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user"("id") ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT "noQuoteReason_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "user"("id") ON UPDATE CASCADE ON DELETE SET NULL
);

CREATE INDEX "noQuoteReason_companyId_fkey" ON "noQuoteReason"("companyId");



ALTER TABLE "noQuoteReason" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Employees can view no quote reasons" ON "noQuoteReason"
  FOR SELECT
  USING (
    has_role('employee', "companyId") AND
    "companyId" = ANY(
      select "companyId" from "userToCompany" where "userId" = auth.uid()::text
    )
  );

CREATE POLICY "Employees with sales_create can insert no quote reasons" ON "noQuoteReason"
  FOR INSERT
  WITH CHECK (   
    has_role('employee', "companyId") AND
    has_company_permission('sales_create', "companyId")
);

CREATE POLICY "Employees with sales_update can update no quote reasons" ON "noQuoteReason"
  FOR UPDATE
  USING (
    has_role('employee', "companyId") AND
    has_company_permission('sales_update', "companyId")
  );

CREATE POLICY "Employees with sales_delete can delete no quote reasons" ON "noQuoteReason"
  FOR DELETE
  USING (
    has_role('employee', "companyId") AND
    has_company_permission('sales_delete', "companyId")
  );