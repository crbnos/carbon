ALTER TABLE "receipt" ADD COLUMN "postedBy" TEXT REFERENCES "user"("id") ON DELETE CASCADE;

ALTER TYPE "itemTrackingType" ADD VALUE IF NOT EXISTS 'Serial';
ALTER TYPE "itemTrackingType" ADD VALUE IF NOT EXISTS 'Lot';

-- Add tracking method to item table
ALTER TABLE "item" ADD COLUMN "trackingMethod" TEXT CHECK ("trackingMethod" IN ('None', 'SerialNumber', 'BatchNumber'));

-- Create table for serial numbers
CREATE TABLE "serialNumber" (
  "id" TEXT NOT NULL DEFAULT xid(),
  "number" TEXT NOT NULL,
  "itemId" TEXT NOT NULL,
  "supplierId" TEXT,
  "companyId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'Available' CHECK ("status" IN ('Available', 'Reserved', 'Consumed')),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  "expirationDate" DATE,
  
  CONSTRAINT "serialNumber_id_unique" UNIQUE ("id"),
  CONSTRAINT "serialNumber_pkey" PRIMARY KEY ("number", "itemId"),
  CONSTRAINT "serialNumber_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "item"("id") ON DELETE CASCADE,
  CONSTRAINT "serialNumber_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE,
  CONSTRAINT "serialNumber_number_itemId_unique" UNIQUE ("number", "itemId")
);

CREATE INDEX "serialNumber_id_idx" ON "serialNumber" ("id");

-- Create table for lot/lot numbers
CREATE TABLE "lotNumber" (
  "id" TEXT NOT NULL DEFAULT xid(),
  "number" TEXT NOT NULL,
  "itemId" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "supplierId" TEXT,
  "manufacturingDate" DATE,
  "expirationDate" DATE,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  
  CONSTRAINT "lotNumber_id_unique" UNIQUE ("id"),
  CONSTRAINT "lotNumber_pkey" PRIMARY KEY ("number", "itemId"),
  CONSTRAINT "lotNumber_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "item"("id") ON DELETE CASCADE,
  CONSTRAINT "lotNumber_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE
);

CREATE INDEX "lotNumber_id_idx" ON "lotNumber" ("id");


-- Add RLS policies for new tables
ALTER TABLE "serialNumber" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "lotNumber" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can view serial numbers" ON "serialNumber";
CREATE POLICY "Anyone can view serial numbers" ON "serialNumber"
  FOR SELECT
  USING (
    "companyId" = ANY(
        SELECT "companyId" from "userToCompany" where "userId" = (SELECT auth.uid())::text
    )
  );

DROP POLICY IF EXISTS "Anyone with parts_create can insert serial numbers" ON "serialNumber";
CREATE POLICY "Anyone with parts_create can insert serial numbers" ON "serialNumber"
  FOR INSERT
  WITH CHECK (
    has_company_permission('parts_create', "companyId")
  );

DROP POLICY IF EXISTS "Anyone with parts_update can update serial numbers" ON "serialNumber";
CREATE POLICY "Anyone with parts_update can update serial numbers" ON "serialNumber"
  FOR UPDATE
  USING (
    has_company_permission('parts_update', "companyId")
  );

DROP POLICY IF EXISTS "Anyone can view lot numbers" ON "lotNumber";
CREATE POLICY "Anyone can view lot numbers" ON "lotNumber"
  FOR SELECT
  USING (
   "companyId" = ANY(
        SELECT "companyId" from "userToCompany" where "userId" = (SELECT auth.uid())::text
    )
  );

DROP POLICY IF EXISTS "Employees with parts_create can insert lot numbers" ON "lotNumber";
CREATE POLICY "Employees with parts_create can insert lot numbers" ON "lotNumber"
  FOR INSERT
  WITH CHECK (
    has_company_permission('parts_create', "companyId")
  );

DROP POLICY IF EXISTS "Employees with parts_update can insert lot numbers" ON "lotNumber";
CREATE POLICY "Employees with parts_update can insert lot numbers" ON "lotNumber"
  FOR UPDATE
  USING (
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
  "serialNumberId" TEXT,
  "lotNumberId" TEXT,
  "quantity" NUMERIC(12, 4) NOT NULL DEFAULT 1,
  "index" INTEGER NOT NULL DEFAULT 0,
  "posted" BOOLEAN NOT NULL DEFAULT false,
  "companyId" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  
  CONSTRAINT "receiptLineTracking_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "receiptLineTracking_receiptLine_fkey" FOREIGN KEY ("receiptLineId") REFERENCES "receiptLine"("id") ON DELETE CASCADE,
  CONSTRAINT "receiptLineTracking_receipt_fkey" FOREIGN KEY ("receiptId") REFERENCES "receipt"("id") ON DELETE CASCADE,
  CONSTRAINT "receiptLineTracking_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "item"("id") ON DELETE CASCADE,
  CONSTRAINT "receiptLineTracking_serialNumberId_fkey" FOREIGN KEY ("serialNumberId") REFERENCES "serialNumber"("id") ON DELETE RESTRICT,
  CONSTRAINT "receiptLineTracking_lotNumberId_fkey" FOREIGN KEY ("lotNumberId") REFERENCES "lotNumber"("id") ON DELETE RESTRICT,
  CONSTRAINT "receiptLineTracking_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE,
  CONSTRAINT "receiptLineTracking_serial_quantity_check" CHECK (
    ("serialNumberId" IS NULL AND "lotNumberId" IS NOT NULL) OR ("serialNumberId" IS NOT NULL AND "quantity" = 1)
  )
);



-- Create table to track serial/lot numbers used in job operations
CREATE TABLE "jobMaterialTracking" (
  "id" TEXT NOT NULL DEFAULT xid(),
  "jobMaterialId" TEXT NOT NULL,
  "jobOperationId" TEXT NOT NULL,
  "itemId" TEXT NOT NULL,
  "serialNumberId" TEXT,
  "lotNumberId" TEXT,
  "quantity" NUMERIC(12, 4) NOT NULL DEFAULT 1,
  "companyId" TEXT NOT NULL,
  "consumedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  
  CONSTRAINT "jobMaterialTracking_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "jobMaterialTracking_jobMaterial_fkey" FOREIGN KEY ("jobMaterialId") REFERENCES "jobMaterial"("id") ON DELETE CASCADE,
  CONSTRAINT "jobMaterialTracking_jobOperation_fkey" FOREIGN KEY ("jobOperationId") REFERENCES "jobOperation"("id") ON DELETE CASCADE,
  CONSTRAINT "jobMaterialTracking_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "item"("id") ON DELETE CASCADE,
  CONSTRAINT "jobMaterialTracking_serialNumberId_fkey" FOREIGN KEY ("serialNumberId") REFERENCES "serialNumber"("id") ON DELETE RESTRICT,
  CONSTRAINT "jobMaterialTracking_lotNumberId_fkey" FOREIGN KEY ("lotNumberId") REFERENCES "lotNumber"("id") ON DELETE RESTRICT,
  CONSTRAINT "jobMaterialTracking_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE,
  CONSTRAINT "jobMaterialTracking_serial_quantity_check" CHECK (
    ("serialNumberId" IS NULL AND "lotNumberId" IS NOT NULL) OR ("serialNumberId" IS NOT NULL AND "quantity" = 1)
  )
);

-- Add helpful indexes
CREATE INDEX "receiptLineTracking_receiptLine_idx" ON "receiptLineTracking" ("receiptLineId");
CREATE INDEX "receiptLineTracking_receipt_idx" ON "receiptLineTracking" ("receiptId");
CREATE INDEX "receiptLineTracking_serialNumberId_idx" ON "receiptLineTracking" ("serialNumberId");
CREATE INDEX "receiptLineTracking_lotNumberId_idx" ON "receiptLineTracking" ("lotNumberId");
CREATE INDEX "receiptLineTracking_posted_idx" ON "receiptLineTracking" ("posted");

CREATE INDEX "jobMaterialTracking_jobMaterial_idx" ON "jobMaterialTracking" ("jobMaterialId");
CREATE INDEX "jobMaterialTracking_jobOperation_idx" ON "jobMaterialTracking" ("jobOperationId");
CREATE INDEX "jobMaterialTracking_serialNumberId_idx" ON "jobMaterialTracking" ("serialNumberId");
CREATE INDEX "jobMaterialTracking_lotNumberId_idx" ON "jobMaterialTracking" ("lotNumberId");

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
  FOR UPDATE USING (
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
  FOR UPDATE USING (
    has_company_permission('production_update', "companyId")
  );

CREATE POLICY "Users with production_delete can delete job material tracking" ON "jobMaterialTracking"
  FOR DELETE USING (
    has_company_permission('production_delete', "companyId")
  );


CREATE POLICY "Inventory document view requires inventory_view" ON storage.objects USING (
  bucket_id = 'private'
  AND (storage.foldername(name))[1] = ANY (
    (
      SELECT
        get_companies_with_permission('inventory_view')
    )::text[]
  )
  AND (storage.foldername(name))[2] = 'inventory'
);

CREATE POLICY "Inventory document insert requires inventory_create" ON storage.objects
WITH CHECK (
  bucket_id = 'private'
  AND (storage.foldername(name))[1] = ANY (
    (
      SELECT
        get_companies_with_permission('inventory_create')
    )::text[]
  )
  AND (storage.foldername(name))[2] = 'inventory'
);

CREATE POLICY "Inventory document update requires inventory_update" ON storage.objects USING (
  bucket_id = 'private'
  AND (storage.foldername(name))[1] = ANY (
    (
      SELECT
        get_companies_with_permission('inventory_update')
    )::text[]
  )
  AND (storage.foldername(name))[2] = 'inventory'
);

CREATE POLICY "Inventory document delete requires inventory_delete" ON storage.objects USING (
  bucket_id = 'private'
  AND (storage.foldername(name))[1] = ANY (
    (
      SELECT
        get_companies_with_permission('inventory_delete')
    )::text[]
  )
  AND (storage.foldername(name))[2] = 'inventory'
);

CREATE OR REPLACE FUNCTION update_receipt_line_lot_tracking(
  p_receipt_line_id TEXT,
  p_receipt_id TEXT,
  p_lot_number TEXT,
  p_lot_id TEXT,
  p_manufacturing_date DATE,
  p_expiration_date DATE,
  p_quantity NUMERIC
) RETURNS void AS $$
BEGIN
  -- First upsert the lot number
  INSERT INTO "lotNumber" ("id", "number", "itemId", "companyId", "manufacturingDate", "expirationDate", "supplierId")
  SELECT 
    p_lot_id,
    p_lot_number,
    rl."itemId",
    rl."companyId",
    p_manufacturing_date,
    p_expiration_date,
    r."supplierId"
  FROM "receiptLine" rl
  JOIN "receipt" r ON r.id = rl."receiptId"
  WHERE rl.id = p_receipt_line_id
  ON CONFLICT (id) DO UPDATE SET
    "manufacturingDate" = EXCLUDED."manufacturingDate",
    "expirationDate" = EXCLUDED."expirationDate";

  -- Delete any existing tracking records for this receipt line
  DELETE FROM "receiptLineTracking"
  WHERE "receiptLineId" = p_receipt_line_id;

  -- Insert the new tracking record
  INSERT INTO "receiptLineTracking" (
    "receiptLineId",
    "receiptId", 
    "itemId",
    "lotNumberId",
    "quantity",
    "companyId"
  )
  SELECT
    p_receipt_line_id,
    p_receipt_id,
    rl."itemId",
    p_lot_id,
    p_quantity,
    rl."companyId"
  FROM "receiptLine" rl
  JOIN "receipt" r ON r.id = rl."receiptId"
  WHERE rl.id = p_receipt_line_id;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION update_receipt_line_serial_tracking(
  p_receipt_line_id TEXT,
  p_receipt_id TEXT,
  p_serial_number TEXT,
  p_index INTEGER
) RETURNS void AS $$
DECLARE
  v_serial_id TEXT;
BEGIN
  -- First upsert the serial number
  INSERT INTO "serialNumber" ("id", "number", "itemId", "companyId", "supplierId")
  SELECT 
    xid(),
    p_serial_number,
    rl."itemId",
    rl."companyId",
    r."supplierId"
  FROM "receiptLine" rl
  JOIN "receipt" r ON r.id = rl."receiptId"
  WHERE rl.id = p_receipt_line_id
  ON CONFLICT ("number", "itemId") DO UPDATE SET
    "supplierId" = EXCLUDED."supplierId"
  RETURNING id INTO v_serial_id;

  -- Delete any existing tracking record for this index
  DELETE FROM "receiptLineTracking"
  WHERE "receiptLineId" = p_receipt_line_id
  AND "index" = p_index;

  -- Insert the tracking record
  INSERT INTO "receiptLineTracking" (
    "receiptLineId",
    "receiptId", 
    "itemId",
    "serialNumberId",
    "quantity",
    "index",
    "companyId"
  )
  SELECT
    p_receipt_line_id,
    p_receipt_id,
    rl."itemId",
    v_serial_id,
    1,
    p_index,
    rl."companyId"
  FROM "receiptLine" rl
  JOIN "receipt" r ON r.id = rl."receiptId"
  WHERE rl.id = p_receipt_line_id;
END;
$$ LANGUAGE plpgsql;
