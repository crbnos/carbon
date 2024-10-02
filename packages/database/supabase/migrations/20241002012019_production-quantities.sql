CREATE TYPE "productionQuantityType" AS ENUM (
  'Rework',
  'Scrap',
  'Production'
);

CREATE TABLE "productionQuantity" (
  "id" TEXT NOT NULL DEFAULT xid(),
  "jobOperationId" TEXT NOT NULL,
  "type" "productionQuantityType" NOT NULL DEFAULT 'Production',
  "quantity" INTEGER NOT NULL,
  "setupProductionEventId" TEXT,
  "laborProductionEventId" TEXT,
  "machineProductionEventId" TEXT,
  "scrapReason" TEXT,
  "companyId" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "createdBy" TEXT NOT NULL,
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  "updatedBy" TEXT,

  CONSTRAINT "productionQuantity_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "productionQuantity_jobOperationId_fkey" FOREIGN KEY ("jobOperationId") REFERENCES "jobOperation" ("id"),
  CONSTRAINT "productionQuantity_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company" ("id"),
  CONSTRAINT "productionQuantity_setupProductionEventId_fkey" FOREIGN KEY ("setupProductionEventId") REFERENCES "productionEvent" ("id"),
  CONSTRAINT "productionQuantity_laborProductionEventId_fkey" FOREIGN KEY ("laborProductionEventId") REFERENCES "productionEvent" ("id"),
  CONSTRAINT "productionQuantity_machineProductionEventId_fkey" FOREIGN KEY ("machineProductionEventId") REFERENCES "productionEvent" ("id")
);

CREATE INDEX "productionQuantity_jobOperationId_idx" ON "productionQuantity" ("jobOperationId");
CREATE INDEX "productionQuantity_companyId_idx" ON "productionQuantity" ("companyId");
CREATE INDEX "productionQuantity_setupProductionEventId_idx" ON "productionQuantity" ("setupProductionEventId");
CREATE INDEX "productionQuantity_laborProductionEventId_idx" ON "productionQuantity" ("laborProductionEventId");
CREATE INDEX "productionQuantity_machineProductionEventId_idx" ON "productionQuantity" ("machineProductionEventId");

-- Enable Row Level Security for productionQuantity
ALTER TABLE "productionQuantity" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Employees can view production quantities" ON "productionQuantity"
  FOR SELECT
  USING (
    has_role('employee', "companyId")
    AND "companyId" = ANY(
        SELECT "companyId" from "userToCompany" where "userId" = auth.uid()::text
    )
  );

CREATE POLICY "Employees can insert production quantities" ON "productionQuantity"
  FOR INSERT
  WITH CHECK (   
    has_role('employee', "companyId")
    AND "companyId" = ANY(
        SELECT "companyId" from "userToCompany" where "userId" = auth.uid()::text
    )  
);

CREATE POLICY "Employees can update production quantities" ON "productionQuantity"
  FOR UPDATE
  USING (
    has_role('employee', "companyId")
    AND has_company_permission('production_update', "companyId")
  );

CREATE POLICY "Employees can delete production quantities" ON "productionQuantity"
  FOR DELETE
  USING (
    has_role('employee', "companyId")
    AND "companyId" = ANY(
        SELECT "companyId" from "userToCompany" where "userId" = auth.uid()::text
    )
  );