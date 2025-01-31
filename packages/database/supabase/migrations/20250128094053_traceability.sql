ALTER TABLE "receipt" ADD COLUMN "postedBy" TEXT REFERENCES "user"("id") ON DELETE CASCADE;

ALTER TYPE "itemTrackingType" ADD VALUE IF NOT EXISTS 'Serial';
ALTER TYPE "itemTrackingType" ADD VALUE IF NOT EXISTS 'Batch';

-- Add tracking method to item table
ALTER TABLE "item" ADD COLUMN "trackingMethod" TEXT CHECK ("trackingMethod" IN ('None', 'SerialNumber', 'BatchNumber'));

CREATE TYPE "trackingSource" AS ENUM (
  'Purchased',
  'Manufactured'
);

-- Create table for serial numbers
CREATE TABLE "serialNumber" (
  "id" TEXT NOT NULL DEFAULT xid(),
  "number" TEXT NOT NULL,
  "itemId" TEXT NOT NULL,
  "source" "trackingSource" NOT NULL DEFAULT 'Purchased',
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

-- Create table for batch/batch numbers
CREATE TABLE "batchNumber" (
  "id" TEXT NOT NULL DEFAULT xid(),
  "number" TEXT NOT NULL,
  "itemId" TEXT NOT NULL,
  "source" "trackingSource" NOT NULL DEFAULT 'Purchased',
  "companyId" TEXT NOT NULL,
  "supplierId" TEXT,
  "manufacturingDate" DATE,
  "expirationDate" DATE,
  "notes" JSON DEFAULT '{}',
  "properties" JSONB DEFAULT '{}',
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  "createdBy" TEXT REFERENCES "user"("id") ON DELETE CASCADE DEFAULT auth.uid(),
  
  CONSTRAINT "batchNumber_id_unique" UNIQUE ("id"),
  CONSTRAINT "batchNumber_pkey" PRIMARY KEY ("number", "itemId"),
  CONSTRAINT "batchNumber_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "item"("id") ON DELETE CASCADE,
  CONSTRAINT "batchNumber_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE
);

CREATE INDEX "batchNumber_id_idx" ON "batchNumber" ("id");


-- Add RLS policies for new tables
ALTER TABLE "serialNumber" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "batchNumber" ENABLE ROW LEVEL SECURITY;

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

DROP POLICY IF EXISTS "Anyone can view batch numbers" ON "batchNumber";
CREATE POLICY "Anyone can view batch numbers" ON "batchNumber"
  FOR SELECT
  USING (
   "companyId" = ANY(
        SELECT "companyId" from "userToCompany" where "userId" = (SELECT auth.uid())::text
    )
  );

DROP POLICY IF EXISTS "Employees with parts_create can insert batch numbers" ON "batchNumber";
CREATE POLICY "Employees with parts_create can insert batch numbers" ON "batchNumber"
  FOR INSERT
  WITH CHECK (
    has_company_permission('parts_create', "companyId")
  );

DROP POLICY IF EXISTS "Employees with parts_update can insert batch numbers" ON "batchNumber";
CREATE POLICY "Employees with parts_update can insert batch numbers" ON "batchNumber"
  FOR UPDATE
  USING (
    has_company_permission('parts_update', "companyId")
  );


-- Create indexes for performance
CREATE INDEX "serialNumber_itemId_idx" ON "serialNumber" ("itemId");
CREATE INDEX "serialNumber_companyId_idx" ON "serialNumber" ("companyId");
CREATE INDEX "batchNumber_itemId_idx" ON "batchNumber" ("itemId");
CREATE INDEX "batchNumber_companyId_idx" ON "batchNumber" ("companyId");

-- Modify itemLedger to include tracking references
ALTER TABLE "itemLedger" 
ADD COLUMN "serialNumber" TEXT,
ADD COLUMN "batchNumber" TEXT,
ADD CONSTRAINT "itemLedger_serialNumber_fkey" 
  FOREIGN KEY ("serialNumber", "itemId") 
  REFERENCES "serialNumber"("number", "itemId") 
  ON UPDATE CASCADE
  ON DELETE RESTRICT,
ADD CONSTRAINT "itemLedger_batchNumber_fkey" 
  FOREIGN KEY ("batchNumber", "itemId") 
  REFERENCES "batchNumber"("number", "itemId") 
  ON UPDATE CASCADE
  ON DELETE RESTRICT;


CREATE INDEX "itemLedger_serialNumber_idx" ON "itemLedger" ("serialNumber");
CREATE INDEX "itemLedger_batchNumber_idx" ON "itemLedger" ("batchNumber");

-- Add tracking info to receiptLine
ALTER TABLE "receiptLine" 
ADD COLUMN "requiresSerialTracking" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "requiresBatchTracking" BOOLEAN NOT NULL DEFAULT false;

-- Create table to track serial/batch numbers from receipts
CREATE TABLE "receiptLineTracking" (
  "id" TEXT NOT NULL DEFAULT xid(),
  "receiptLineId" TEXT NOT NULL,
  "receiptId" TEXT NOT NULL,
  "itemId" TEXT NOT NULL,
  "serialNumberId" TEXT,
  "batchNumberId" TEXT,
  "quantity" NUMERIC(12, 4) NOT NULL DEFAULT 1,
  "index" INTEGER NOT NULL DEFAULT 0,
  "posted" BOOLEAN NOT NULL DEFAULT false,
  "companyId" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  "createdBy" TEXT REFERENCES "user"("id") ON DELETE CASCADE DEFAULT auth.uid(),
  
  CONSTRAINT "receiptLineTracking_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "receiptLineTracking_receiptLine_fkey" FOREIGN KEY ("receiptLineId") REFERENCES "receiptLine"("id") ON DELETE CASCADE,
  CONSTRAINT "receiptLineTracking_receipt_fkey" FOREIGN KEY ("receiptId") REFERENCES "receipt"("id") ON DELETE CASCADE,
  CONSTRAINT "receiptLineTracking_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "item"("id") ON DELETE CASCADE,
  CONSTRAINT "receiptLineTracking_serialNumberId_fkey" FOREIGN KEY ("serialNumberId") REFERENCES "serialNumber"("id") ON DELETE RESTRICT,
  CONSTRAINT "receiptLineTracking_batchNumberId_fkey" FOREIGN KEY ("batchNumberId") REFERENCES "batchNumber"("id") ON DELETE RESTRICT,
  CONSTRAINT "receiptLineTracking_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE,
  CONSTRAINT "receiptLineTracking_serial_quantity_check" CHECK (
    ("serialNumberId" IS NULL AND "batchNumberId" IS NOT NULL) OR ("serialNumberId" IS NOT NULL AND "quantity" = 1)
  )
);

-- Create table to track serial/batch numbers from job operations
CREATE TABLE "jobMaterialTracking" (
  "id" TEXT NOT NULL DEFAULT xid(),
  "jobMaterialId" TEXT NOT NULL,
  "jobOperationId" TEXT NOT NULL,
  "itemId" TEXT NOT NULL,
  "serialNumberId" TEXT,
  "batchNumberId" TEXT,
  "quantity" NUMERIC(12, 4) NOT NULL DEFAULT 1,
  "companyId" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  "createdBy" TEXT REFERENCES "user"("id") ON DELETE CASCADE DEFAULT auth.uid(),
  
  CONSTRAINT "jobMaterialTracking_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "jobMaterialTracking_jobMaterial_fkey" FOREIGN KEY ("jobMaterialId") REFERENCES "jobMaterial"("id") ON DELETE CASCADE,
  CONSTRAINT "jobMaterialTracking_jobOperation_fkey" FOREIGN KEY ("jobOperationId") REFERENCES "jobOperation"("id") ON DELETE CASCADE,
  CONSTRAINT "jobMaterialTracking_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "item"("id") ON DELETE CASCADE,
  CONSTRAINT "jobMaterialTracking_serialNumberId_fkey" FOREIGN KEY ("serialNumberId") REFERENCES "serialNumber"("id") ON DELETE RESTRICT,
  CONSTRAINT "jobMaterialTracking_batchNumberId_fkey" FOREIGN KEY ("batchNumberId") REFERENCES "batchNumber"("id") ON DELETE RESTRICT,
  CONSTRAINT "jobMaterialTracking_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE,
  CONSTRAINT "jobMaterialTracking_serial_quantity_check" CHECK (
    ("serialNumberId" IS NULL AND "batchNumberId" IS NOT NULL) OR ("serialNumberId" IS NOT NULL AND "quantity" = 1)
  )
);

-- Create table to track serial/batch numbers produced in job operations
CREATE TABLE "jobProductionTracking" (
  "id" TEXT NOT NULL DEFAULT xid(),
  "jobId" TEXT NOT NULL,
  "itemId" TEXT NOT NULL,
  "serialNumberId" TEXT,
  "batchNumberId" TEXT,
  "quantity" NUMERIC(12, 4) NOT NULL DEFAULT 1,
  "companyId" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  "createdBy" TEXT REFERENCES "user"("id") ON DELETE CASCADE DEFAULT auth.uid(),
  
  CONSTRAINT "jobProductionTracking_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "jobProductionTracking_job_fkey" FOREIGN KEY ("jobId") REFERENCES "job"("id") ON DELETE CASCADE,
  CONSTRAINT "jobProductionTracking_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "item"("id") ON DELETE CASCADE,
  CONSTRAINT "jobProductionTracking_serialNumberId_fkey" FOREIGN KEY ("serialNumberId") REFERENCES "serialNumber"("id") ON DELETE RESTRICT,
  CONSTRAINT "jobProductionTracking_batchNumberId_fkey" FOREIGN KEY ("batchNumberId") REFERENCES "batchNumber"("id") ON DELETE RESTRICT,
  CONSTRAINT "jobProductionTracking_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE,
  CONSTRAINT "jobProductionTracking_serial_quantity_check" CHECK (
    ("serialNumberId" IS NULL AND "batchNumberId" IS NOT NULL) OR ("serialNumberId" IS NOT NULL AND "quantity" = 1)
  )
);

-- -- Create table to track serial/batch numbers for deliveries
-- CREATE TABLE "deliveryTracking" (
--   "id" TEXT NOT NULL DEFAULT xid(),
--   "deliveryId" TEXT NOT NULL,
--   "itemId" TEXT NOT NULL,
--   "serialNumberId" TEXT,
--   "batchNumberId" TEXT,
--   "quantity" NUMERIC(12, 4) NOT NULL DEFAULT 1,
--   "companyId" TEXT NOT NULL,
--   "deliveredAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  
--   CONSTRAINT "deliveryTracking_pkey" PRIMARY KEY ("id"),
--   CONSTRAINT "deliveryTracking_delivery_fkey" FOREIGN KEY ("deliveryId") REFERENCES "delivery"("id") ON DELETE CASCADE,
--   CONSTRAINT "deliveryTracking_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "item"("id") ON DELETE CASCADE,
--   CONSTRAINT "deliveryTracking_serialNumberId_fkey" FOREIGN KEY ("serialNumberId") REFERENCES "serialNumber"("id") ON DELETE RESTRICT,
--   CONSTRAINT "deliveryTracking_batchNumberId_fkey" FOREIGN KEY ("batchNumberId") REFERENCES "batchNumber"("id") ON DELETE RESTRICT,
--   CONSTRAINT "deliveryTracking_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE,
--   CONSTRAINT "deliveryTracking_serial_quantity_check" CHECK (
--     ("serialNumberId" IS NULL AND "batchNumberId" IS NOT NULL) OR ("serialNumberId" IS NOT NULL AND "quantity" = 1)
--   )
-- );

-- Add helpful indexes
CREATE INDEX "receiptLineTracking_receiptLine_idx" ON "receiptLineTracking" ("receiptLineId");
CREATE INDEX "receiptLineTracking_receipt_idx" ON "receiptLineTracking" ("receiptId");
CREATE INDEX "receiptLineTracking_serialNumberId_idx" ON "receiptLineTracking" ("serialNumberId");
CREATE INDEX "receiptLineTracking_batchNumberId_idx" ON "receiptLineTracking" ("batchNumberId");
CREATE INDEX "receiptLineTracking_posted_idx" ON "receiptLineTracking" ("posted");

CREATE INDEX "jobMaterialTracking_jobMaterial_idx" ON "jobMaterialTracking" ("jobMaterialId");
CREATE INDEX "jobMaterialTracking_jobOperation_idx" ON "jobMaterialTracking" ("jobOperationId");
CREATE INDEX "jobMaterialTracking_serialNumberId_idx" ON "jobMaterialTracking" ("serialNumberId");
CREATE INDEX "jobMaterialTracking_batchNumberId_idx" ON "jobMaterialTracking" ("batchNumberId");

CREATE INDEX "jobProductionTracking_jobOperation_idx" ON "jobProductionTracking" ("jobId");
CREATE INDEX "jobProductionTracking_serialNumberId_idx" ON "jobProductionTracking" ("serialNumberId");
CREATE INDEX "jobProductionTracking_batchNumberId_idx" ON "jobProductionTracking" ("batchNumberId");

-- CREATE INDEX "deliveryTracking_delivery_idx" ON "deliveryTracking" ("deliveryId");
-- CREATE INDEX "deliveryTracking_serialNumberId_idx" ON "deliveryTracking" ("serialNumberId");
-- CREATE INDEX "deliveryTracking_batchNumberId_idx" ON "deliveryTracking" ("batchNumberId");

-- Add RLS policies
ALTER TABLE "receiptLineTracking" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "jobMaterialTracking" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "jobProductionTracking" ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE "deliveryTracking" ENABLE ROW LEVEL SECURITY;

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
     "companyId" = ANY(
      SELECT "companyId" from "userToCompany" where "userId" = (SELECT auth.uid())::text
    )
  );

CREATE POLICY "Users with production_update can update job material tracking" ON "jobMaterialTracking"
  FOR UPDATE USING (
    has_company_permission('production_update', "companyId")
  );

CREATE POLICY "Users with production_delete can delete job material tracking" ON "jobMaterialTracking"
  FOR DELETE USING (
    has_company_permission('production_delete', "companyId")
  );

CREATE POLICY "Anyone can view job production tracking" ON "jobProductionTracking"
  FOR SELECT USING (
    "companyId" = ANY(
      SELECT "companyId" from "userToCompany" where "userId" = (SELECT auth.uid())::text
    )
  );

CREATE POLICY "Users with production_create can insert job production tracking" ON "jobProductionTracking"
  FOR INSERT WITH CHECK (
    has_company_permission('production_create', "companyId")
  );

CREATE POLICY "Users with production_update can update job production tracking" ON "jobProductionTracking"
  FOR UPDATE USING (
    has_company_permission('production_update', "companyId")
  );

CREATE POLICY "Users with production_delete can delete job production tracking" ON "jobProductionTracking"
  FOR DELETE USING (
    has_company_permission('production_delete', "companyId")
  );

-- CREATE POLICY "Anyone can view delivery tracking" ON "deliveryTracking"
--   FOR SELECT USING (
--     "companyId" = ANY(
--       SELECT "companyId" from "userToCompany" where "userId" = (SELECT auth.uid())::text
--     )
--   );

-- CREATE POLICY "Users with shipping_create can insert delivery tracking" ON "deliveryTracking"
--   FOR INSERT WITH CHECK (
--     has_company_permission('shipping_create', "companyId")
--   );

-- CREATE POLICY "Users with shipping_update can update delivery tracking" ON "deliveryTracking"
--   FOR UPDATE USING (
--     has_company_permission('shipping_update', "companyId")
--   );

-- CREATE POLICY "Users with shipping_delete can delete delivery tracking" ON "deliveryTracking"
--   FOR DELETE USING (
--     has_company_permission('shipping_delete', "companyId")
--   );

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

CREATE OR REPLACE FUNCTION update_receipt_line_batch_tracking(
  p_receipt_line_id TEXT,
  p_receipt_id TEXT,
  p_batch_number TEXT,
  p_batch_id TEXT,
  p_manufacturing_date DATE,
  p_expiration_date DATE,
  p_quantity NUMERIC,
  p_properties JSONB DEFAULT '{}'
) RETURNS void AS $$
BEGIN
  -- First upsert the batch number
  INSERT INTO "batchNumber" ("id", "number", "itemId", "companyId", "manufacturingDate", "expirationDate", "supplierId", "source", "properties")
  SELECT 
    p_batch_id,
    p_batch_number,
    rl."itemId",
    rl."companyId",
    p_manufacturing_date,
    p_expiration_date,
    r."supplierId",
    'Purchased',
    p_properties
  FROM "receiptLine" rl
  JOIN "receipt" r ON r.id = rl."receiptId"
  WHERE rl.id = p_receipt_line_id
  ON CONFLICT (id) DO UPDATE SET
    "manufacturingDate" = EXCLUDED."manufacturingDate",
    "expirationDate" = EXCLUDED."expirationDate",
    "properties" = EXCLUDED."properties";

  -- Delete any existing tracking records for this receipt line
  DELETE FROM "receiptLineTracking"
  WHERE "receiptLineId" = p_receipt_line_id;

  -- Insert the new tracking record
  INSERT INTO "receiptLineTracking" (
    "receiptLineId",
    "receiptId", 
    "itemId",
    "batchNumberId",
    "quantity",
    "companyId"
  )
  SELECT
    p_receipt_line_id,
    p_receipt_id,
    rl."itemId",
    p_batch_id,
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
    INSERT INTO "serialNumber" ("id", "number", "itemId", "companyId", "supplierId", "source")
    SELECT 
      xid(),
      p_serial_number,
      rl."itemId",
      rl."companyId",
      r."supplierId",
      'Purchased'
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

CREATE OR REPLACE FUNCTION get_item_quantities(location_id TEXT)
RETURNS TABLE (
  "itemId" TEXT,
  "companyId" TEXT,
  "locationId" TEXT,
  "quantityOnHand" NUMERIC,
  "quantityOnPurchaseOrder" NUMERIC,
  "quantityOnSalesOrder" NUMERIC,
  "quantityOnProdOrder" NUMERIC,
  "quantityAvailable" NUMERIC,
  "materialSubstanceId" TEXT,
  "materialFormId" TEXT,
  "grade" TEXT,
  "dimensions" TEXT,
  "finish" TEXT,
  "readableId" TEXT,
  "type" "itemType",
  "name" TEXT,
  "active" BOOLEAN,
  "itemTrackingType" "itemTrackingType",
  "thumbnailPath" TEXT,
  "locationName" TEXT,
  "unitOfMeasureCode" TEXT
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    i."id" AS "itemId",
    i."companyId",
    loc."id" AS "locationId",
    SUM(COALESCE(inv."quantityOnHand", 0)) AS "quantityOnHand",
    SUM(COALESCE(inv."quantityOnPurchase", 0)) AS "quantityOnPurchaseOrder",
    SUM(COALESCE(inv."quantityOnSalesOrder", 0)) AS "quantityOnSalesOrder",
    SUM(COALESCE(inv."quantityOnProductionOrder", 0)) AS "quantityOnProdOrder",
    SUM(COALESCE(inv."quantityOnHand", 0)) - 
      SUM(COALESCE(inv."quantityOnSalesOrder", 0)) - 
      SUM(COALESCE(inv."quantityOnProductionOrder", 0)) AS "quantityAvailable",
    mat."materialSubstanceId",
    mat."materialFormId",
    mat."grade",
    mat."dimensions",
    mat."finish",
    i."readableId",
    i."type",
    i."name",
    i."active",
    i."itemTrackingType",
    CASE
      WHEN i."thumbnailPath" IS NULL AND mu."thumbnailPath" IS NOT NULL THEN mu."thumbnailPath"
      ELSE i."thumbnailPath"
    END AS "thumbnailPath",
    loc."name" AS "locationName",
    i."unitOfMeasureCode"
  FROM "item" i
  INNER JOIN "location" loc ON loc.id = location_id
  LEFT JOIN "itemInventory" inv ON i."id" = inv."itemId" AND inv."locationId" = loc."id"
  LEFT JOIN "material" mat ON i."id" = mat."itemId"
  LEFT JOIN "modelUpload" mu ON mu.id = i."modelUploadId"
  WHERE i."itemTrackingType" IN ('Inventory', 'Serial', 'Batch')
    AND i."companyId" = loc."companyId"
    AND inv."locationId" = location_id
  GROUP BY 
    i."id",
    i."companyId",
    loc."id",
    mat."materialSubstanceId",
    mat."materialFormId",
    mat."grade",
    mat."dimensions",
    mat."finish",
    i."readableId",
    i."type",
    i."name",
    i."active",
    i."itemTrackingType",
    i."thumbnailPath",
    mu."thumbnailPath",
    loc."name",
    i."unitOfMeasureCode";
END;
$$ LANGUAGE plpgsql SECURITY INVOKER;


DROP VIEW IF EXISTS "batchNumbers";
CREATE OR REPLACE VIEW "batchNumbers" WITH(SECURITY_INVOKER=true) AS
  SELECT DISTINCT
    bn."id",
    bn."number", 
    bn."manufacturingDate",
    bn."expirationDate",
    bn."supplierId",
    bn."companyId",
    bn."itemId",
    bn."source",
    i."name" AS "itemName",
    i."readableId" AS "itemReadableId"
  FROM "batchNumber" bn
  JOIN "item" i ON i."id" = bn."itemId"
  WHERE EXISTS (
    SELECT 1 FROM "receiptLineTracking" rlt 
    WHERE rlt."batchNumberId" = bn."id" AND rlt."posted" = true
  ) OR EXISTS (
    SELECT 1 FROM "jobProductionTracking" jpt
    WHERE jpt."batchNumberId" = bn."id"
  )
  GROUP BY
    bn."id",
    bn."number",
    bn."manufacturingDate", 
    bn."expirationDate",
    bn."supplierId",
    bn."companyId",
    bn."itemId",
    bn."source",
    i."name",
    i."readableId";

CREATE TABLE IF NOT EXISTS "batchProperty" (
  "id" TEXT NOT NULL DEFAULT xid(),
  "itemId" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "dataType" "configurationParameterDataType" NOT NULL,
  "listOptions" TEXT[],
  "sortOrder" DOUBLE PRECISION NOT NULL DEFAULT 1,
  "companyId" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
  "createdBy" TEXT NOT NULL,
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  "updatedBy" TEXT,

  CONSTRAINT "batchProperty_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "batchProperty_itemId_key_unique" UNIQUE ("itemId", "key"),
  CONSTRAINT "batchProperty_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "item"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "batchProperty_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "batchProperty_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user"("id") ON UPDATE CASCADE,
  CONSTRAINT "batchProperty_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "user"("id") ON UPDATE CASCADE
);

CREATE INDEX "batchProperty_itemId_idx" ON "batchProperty" ("itemId");
CREATE INDEX "batchProperty_companyId_idx" ON "batchProperty" ("companyId");

ALTER TABLE "batchProperty" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Employees with inventory_view can view batch parameters" ON "batchProperty"
  FOR SELECT
  USING (
    has_role('employee', "companyId") AND 
    has_company_permission('inventory_view', "companyId")
  );

CREATE POLICY "Employees with inventory_create can insert batch parameters" ON "batchProperty"
  FOR INSERT
  WITH CHECK (   
    has_role('employee', "companyId") AND 
    has_company_permission('inventory_create', "companyId")
);

CREATE POLICY "Employees with inventory_update can update batch parameters" ON "batchProperty"
  FOR UPDATE
  USING (
    has_role('employee', "companyId") AND 
    has_company_permission('inventory_update', "companyId")
  );

CREATE POLICY "Employees with inventory_delete can delete batch parameters" ON "batchProperty"
  FOR DELETE
  USING (
    has_role('employee', "companyId") AND 
    has_company_permission('inventory_delete', "companyId")
  );

CREATE POLICY "Requests with an API key can access batch parameters" ON "batchProperty"
FOR ALL USING (
  has_valid_api_key_for_company("companyId")
);