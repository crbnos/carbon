ALTER TABLE "receipt" ADD COLUMN "postedBy" TEXT REFERENCES "user"("id") ON DELETE CASCADE;

ALTER TYPE "itemTrackingType" ADD VALUE IF NOT EXISTS 'Serial';
ALTER TYPE "itemTrackingType" ADD VALUE IF NOT EXISTS 'Lot';

-- Add tracking method to item table
ALTER TABLE "item" ADD COLUMN "trackingMethod" TEXT CHECK ("trackingMethod" IN ('None', 'SerialNumber', 'BatchNumber'));

-- Create table for serial numbers
CREATE TABLE "serialNumber" (
  "number" TEXT NOT NULL,
  "itemId" TEXT NOT NULL,
  "supplierId" TEXT,
  "companyId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'Available' CHECK ("status" IN ('Available', 'Reserved', 'Consumed')),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  "expirationDate" DATE,
  
  CONSTRAINT "serialNumber_pkey" PRIMARY KEY ("number", "itemId"),
  CONSTRAINT "serialNumber_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "item"("id") ON DELETE CASCADE,
  CONSTRAINT "serialNumber_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE,
  CONSTRAINT "serialNumber_number_itemId_unique" UNIQUE ("number", "itemId")
);

-- Create table for lot/lot numbers
CREATE TABLE "lotNumber" (
  "number" TEXT NOT NULL,
  "itemId" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "supplierId" TEXT,
  "manufacturingDate" DATE,
  "expirationDate" DATE,
  "documentPath" TEXT,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  
  CONSTRAINT "lotNumber_pkey" PRIMARY KEY ("number", "itemId"),
  CONSTRAINT "lotNumber_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "item"("id") ON DELETE CASCADE,
  CONSTRAINT "lotNumber_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE,
  CONSTRAINT "lotNumber_number_itemId_unique" UNIQUE ("number", "itemId")
);

-- Add RLS policies for new tables
ALTER TABLE "serialNumber" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "lotNumber" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view serial numbers" ON "serialNumber"
  FOR SELECT
  USING (
    "companyId" = ANY(
        SELECT "companyId" from "userToCompany" where "userId" = (SELECT auth.uid())::text
    )
  );

CREATE POLICY "Anyone with parts_create can insert serial numbers" ON "serialNumber"
  FOR INSERT
  WITH CHECK (
    has_company_permission('parts_create', "companyId")
  );

CREATE POLICY "Anyone with parts_update can update serial numbers" ON "serialNumber"
  FOR UPDATE
  WITH CHECK (
    has_company_permission('parts_update', "companyId")
  );

CREATE POLICY "Anyone can view lot numbers" ON "lotNumber"
  FOR SELECT
  USING (
   "companyId" = ANY(
        SELECT "companyId" from "userToCompany" where "userId" = (SELECT auth.uid())::text
    )
  );

CREATE POLICY "Employees with parts_create can insert lot numbers" ON "lotNumber"
  FOR INSERT
  WITH CHECK (
    has_company_permission('parts_create', "companyId")
  );

CREATE POLICY "Employees with parts_update can insert lot numbers" ON "lotNumber"
  FOR UPDATE
  WITH CHECK (
    has_company_permission('parts_update', "companyId")
  );


-- Create indexes for performance
CREATE INDEX "serialNumber_itemId_idx" ON "serialNumber" ("itemId");
CREATE INDEX "serialNumber_companyId_idx" ON "serialNumber" ("companyId");
CREATE INDEX "lotNumber_itemId_idx" ON "lotNumber" ("itemId");
CREATE INDEX "lotNumber_companyId_idx" ON "lotNumber" ("companyId");

-- Modify itemLedger to include tracking references
ALTER TABLE "itemLedger" 
ADD COLUMN "serialNumber" TEXT,
ADD COLUMN "lotNumber" TEXT,
ADD CONSTRAINT "itemLedger_serialNumber_fkey" 
  FOREIGN KEY ("serialNumber", "itemId") 
  REFERENCES "serialNumber"("number", "itemId") 
  ON UPDATE CASCADE
  ON DELETE RESTRICT,
ADD CONSTRAINT "itemLedger_lotNumber_fkey" 
  FOREIGN KEY ("lotNumber", "itemId") 
  REFERENCES "lotNumber"("number", "itemId") 
  ON UPDATE CASCADE
  ON DELETE RESTRICT;


CREATE INDEX "itemLedger_serialNumber_idx" ON "itemLedger" ("serialNumber");
CREATE INDEX "itemLedger_lotNumber_idx" ON "itemLedger" ("lotNumber");

-- Add tracking info to receiptLine
ALTER TABLE "receiptLine" 
ADD COLUMN "requiresSerialTracking" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "requiresLotTracking" BOOLEAN NOT NULL DEFAULT false;

-- Create table to track serial/lot numbers from receipts
CREATE TABLE "receiptLineTracking" (
  "id" TEXT NOT NULL DEFAULT xid(),
  "receiptLineId" TEXT NOT NULL,
  "receiptId" TEXT NOT NULL,
  "itemId" TEXT NOT NULL,
  "serialNumber" TEXT,
  "lotNumber" TEXT,
  "quantity" NUMERIC(12, 4) NOT NULL DEFAULT 1,
  "companyId" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  
  CONSTRAINT "receiptLineTracking_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "receiptLineTracking_receiptLine_fkey" FOREIGN KEY ("receiptLineId") REFERENCES "receiptLine"("id") ON DELETE CASCADE,
  CONSTRAINT "receiptLineTracking_receipt_fkey" FOREIGN KEY ("receiptId") REFERENCES "receipt"("id") ON DELETE CASCADE,
  CONSTRAINT "receiptLineTracking_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "item"("id") ON DELETE CASCADE,
  CONSTRAINT "receiptLineTracking_serialNumber_fkey" FOREIGN KEY ("serialNumber", "itemId") REFERENCES "serialNumber"("number", "itemId") ON DELETE RESTRICT,
  CONSTRAINT "receiptLineTracking_lotNumber_fkey" FOREIGN KEY ("lotNumber", "itemId") REFERENCES "lotNumber"("number", "itemId") ON DELETE RESTRICT,
  CONSTRAINT "receiptLineTracking_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE,
  CONSTRAINT "receiptLineTracking_serial_quantity_check" CHECK (
    ("serialNumber" IS NULL AND "lotNumber" IS NOT NULL) OR ("serialNumber" IS NOT NULL AND "quantity" = 1)
  )
);

-- Create table to track serial/lot numbers used in job operations
CREATE TABLE "jobMaterialTracking" (
  "id" TEXT NOT NULL DEFAULT xid(),
  "jobMaterialId" TEXT NOT NULL,
  "jobOperationId" TEXT NOT NULL,
  "itemId" TEXT NOT NULL,
  "serialNumber" TEXT,
  "lotNumber" TEXT,
  "quantity" NUMERIC(12, 4) NOT NULL DEFAULT 1,
  "companyId" TEXT NOT NULL,
  "consumedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  
  CONSTRAINT "jobMaterialTracking_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "jobMaterialTracking_jobMaterial_fkey" FOREIGN KEY ("jobMaterialId") REFERENCES "jobMaterial"("id") ON DELETE CASCADE,
  CONSTRAINT "jobMaterialTracking_jobOperation_fkey" FOREIGN KEY ("jobOperationId") REFERENCES "jobOperation"("id") ON DELETE CASCADE,
  CONSTRAINT "jobMaterialTracking_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "item"("id") ON DELETE CASCADE,
  CONSTRAINT "jobMaterialTracking_serialNumber_fkey" FOREIGN KEY ("serialNumber", "itemId") REFERENCES "serialNumber"("number", "itemId") ON DELETE RESTRICT,
  CONSTRAINT "jobMaterialTracking_lotNumber_fkey" FOREIGN KEY ("lotNumber", "itemId") REFERENCES "lotNumber"("number", "itemId") ON DELETE RESTRICT,
  CONSTRAINT "jobMaterialTracking_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE
);

-- Add helpful indexes
CREATE INDEX "receiptLineTracking_receiptLine_idx" ON "receiptLineTracking" ("receiptLineId");
CREATE INDEX "receiptLineTracking_receipt_idx" ON "receiptLineTracking" ("receiptId");
CREATE INDEX "receiptLineTracking_serialNumber_idx" ON "receiptLineTracking" ("serialNumber");
CREATE INDEX "receiptLineTracking_lotNumber_idx" ON "receiptLineTracking" ("lotNumber");

CREATE INDEX "jobMaterialTracking_jobMaterial_idx" ON "jobMaterialTracking" ("jobMaterialId");
CREATE INDEX "jobMaterialTracking_jobOperation_idx" ON "jobMaterialTracking" ("jobOperationId");
CREATE INDEX "jobMaterialTracking_serialNumber_idx" ON "jobMaterialTracking" ("serialNumber");
CREATE INDEX "jobMaterialTracking_lotNumber_idx" ON "jobMaterialTracking" ("lotNumber");

-- Add RLS policies
ALTER TABLE "receiptLineTracking" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "jobMaterialTracking" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view receipt tracking" ON "receiptLineTracking"
  FOR SELECT USING (
    "companyId" = ANY(
      SELECT "companyId" from "userToCompany" where "userId" = (SELECT auth.uid())::text
    )
  );

CREATE POLICY "Users with inventory_create can insert receipt tracking" ON "receiptLineTracking"
  FOR INSERT WITH CHECK (
    has_company_permission('inventory_create', "companyId")
  );

CREATE POLICY "Users with inventory_update can update receipt tracking" ON "receiptLineTracking"
  FOR UPDATE WITH CHECK (
    has_company_permission('inventory_update', "companyId")
  );

CREATE POLICY "Users with inventory_delete can delete receipt tracking" ON "receiptLineTracking"
  FOR DELETE USING (
    has_company_permission('inventory_delete', "companyId")
  );

CREATE POLICY "Anyone can view job material tracking" ON "jobMaterialTracking"
  FOR SELECT USING (
    "companyId" = ANY(
      SELECT "companyId" from "userToCompany" where "userId" = (SELECT auth.uid())::text
    )
  );

CREATE POLICY "Users with production_create can insert job material tracking" ON "jobMaterialTracking"
  FOR INSERT WITH CHECK (
    has_company_permission('production_create', "companyId")
  );

CREATE POLICY "Users with production_update can update job material tracking" ON "jobMaterialTracking"
  FOR UPDATE WITH CHECK (
    has_company_permission('production_update', "companyId")
  );

CREATE POLICY "Users with production_delete can delete job material tracking" ON "jobMaterialTracking"
  FOR DELETE USING (
    has_company_permission('production_delete', "companyId")
  );
