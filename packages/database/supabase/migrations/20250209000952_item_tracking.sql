-- Create type for source document types
CREATE TYPE "itemTrackingSourceDocument" AS ENUM (
  'Receipt',
  'Job Production',
  'Job Material',
  'Shipment'
);

-- Create the new itemTracking table
CREATE TABLE "itemTracking" (
  "id" TEXT NOT NULL DEFAULT xid(),
  "sourceDocument" "itemTrackingSourceDocument" NOT NULL,
  "sourceDocumentId" TEXT NOT NULL,
  "sourceDocumentLineId" TEXT,
  "sourceDocumentReadableId" TEXT,
  "itemId" TEXT NOT NULL,
  "serialNumberId" TEXT,
  "batchNumberId" TEXT,
  "quantity" NUMERIC(12, 4) NOT NULL DEFAULT 1,
  "index" INTEGER NOT NULL DEFAULT 0,
  "posted" BOOLEAN NOT NULL DEFAULT false,
  "companyId" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  "createdBy" TEXT REFERENCES "user"("id") ON DELETE CASCADE DEFAULT auth.uid(),
  
  CONSTRAINT "itemTracking_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "itemTracking_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "item"("id") ON DELETE CASCADE,
  CONSTRAINT "itemTracking_serialNumberId_fkey" FOREIGN KEY ("serialNumberId") REFERENCES "serialNumber"("id") ON DELETE RESTRICT,
  CONSTRAINT "itemTracking_batchNumberId_fkey" FOREIGN KEY ("batchNumberId") REFERENCES "batchNumber"("id") ON DELETE RESTRICT,
  CONSTRAINT "itemTracking_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE,
  CONSTRAINT "itemTracking_serial_quantity_check" CHECK (
    ("serialNumberId" IS NULL AND "batchNumberId" IS NOT NULL) OR 
    ("serialNumberId" IS NOT NULL AND "quantity" = 1)
  )
);

-- Create helpful indexes
CREATE INDEX "itemTracking_sourceDocument_idx" ON "itemTracking" ("sourceDocument");
CREATE INDEX "itemTracking_sourceDocumentId_idx" ON "itemTracking" ("sourceDocumentId");
CREATE INDEX "itemTracking_sourceDocumentLineId_idx" ON "itemTracking" ("sourceDocumentLineId");
CREATE INDEX "itemTracking_sourceDocumentReadableId_idx" ON "itemTracking" ("sourceDocumentReadableId");
CREATE INDEX "itemTracking_serialNumberId_idx" ON "itemTracking" ("serialNumberId");
CREATE INDEX "itemTracking_batchNumberId_idx" ON "itemTracking" ("batchNumberId");
CREATE INDEX "itemTracking_posted_idx" ON "itemTracking" ("posted");
CREATE INDEX "itemTracking_companyId_idx" ON "itemTracking" ("companyId");

-- Enable RLS
ALTER TABLE "itemTracking" ENABLE ROW LEVEL SECURITY;

-- Add RLS policies
CREATE POLICY "SELECT" ON "itemTracking"
FOR SELECT USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_role()
    )::text[]
  )
);

CREATE POLICY "INSERT" ON "itemTracking"
FOR INSERT WITH CHECK (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission('inventory_create')
    )::text[]
  )
);

CREATE POLICY "UPDATE" ON "itemTracking"
FOR UPDATE USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission('inventory_update')
    )::text[]
  )
);

CREATE POLICY "DELETE" ON "itemTracking"
FOR DELETE USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission('inventory_delete')
    )::text[]
  )
);

-- Update the serialNumbers view to use the new itemTracking table
DROP VIEW IF EXISTS "serialNumbers";
CREATE OR REPLACE VIEW "serialNumbers" WITH(SECURITY_INVOKER=true) AS
  SELECT DISTINCT
    sn."id",
    sn."number", 
    sn."status",
    sn."supplierId",
    sn."companyId",
    sn."itemId",
    sn."source",
    i."name" AS "itemName",
    i."readableId" AS "itemReadableId"
  FROM "serialNumber" sn
  JOIN "item" i ON i."id" = sn."itemId"
  WHERE EXISTS (
    SELECT 1 FROM "itemTracking" it 
    WHERE it."serialNumberId" = sn."id" AND it."posted" = true
  )
  GROUP BY
    sn."id",
    sn."number",
    sn."status",
    sn."supplierId",
    sn."companyId",
    sn."itemId",
    sn."source",
    i."name",
    i."readableId";

-- Update the batchNumbers view to use the new itemTracking table
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
    SELECT 1 FROM "itemTracking" it 
    WHERE it."batchNumberId" = bn."id" AND it."posted" = true
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

-- Migrate data from existing tracking tables to the new itemTracking table
INSERT INTO "itemTracking" (
  "sourceDocument",
  "sourceDocumentId",
  "sourceDocumentLineId",
  "sourceDocumentReadableId",
  "itemId",
  "serialNumberId",
  "batchNumberId",
  "quantity",
  "index",
  "posted",
  "companyId",
  "createdAt",
  "createdBy"
)
SELECT 
  'Receipt'::"itemTrackingSourceDocument",
  rt."receiptId",
  rt."receiptLineId",
  r."receiptId",
  rt."itemId",
  rt."serialNumberId",
  rt."batchNumberId",
  rt."quantity",
  rt."index",
  rt."posted",
  rt."companyId",
  rt."createdAt",
  rt."createdBy"
FROM "receiptLineTracking" rt
JOIN "receipt" r ON r.id = rt."receiptId";

INSERT INTO "itemTracking" (
  "sourceDocument",
  "sourceDocumentId",
  "sourceDocumentLineId",
  "itemId",
  "serialNumberId",
  "batchNumberId",
  "quantity",
  "companyId",
  "createdAt",
  "createdBy"
)
SELECT 
  'Job Material'::"itemTrackingSourceDocument",
  jmt."jobOperationId",
  jmt."jobMaterialId",
  jmt."itemId",
  jmt."serialNumberId",
  jmt."batchNumberId",
  jmt."quantity",
  jmt."companyId",
  jmt."createdAt",
  jmt."createdBy"
FROM "jobMaterialTracking" jmt;

INSERT INTO "itemTracking" (
  "sourceDocument",
  "sourceDocumentId",
  "itemId",
  "serialNumberId",
  "batchNumberId",
  "quantity",
  "companyId",
  "createdAt",
  "createdBy"
)
SELECT 
  'Job Production'::"itemTrackingSourceDocument",
  jpt."jobId",
  jpt."itemId",
  jpt."serialNumberId",
  jpt."batchNumberId",
  jpt."quantity",
  jpt."companyId",
  jpt."createdAt",
  jpt."createdBy"
FROM "jobProductionTracking" jpt;

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
  DELETE FROM "itemTracking"
  WHERE "sourceDocument" = 'Receipt'
  AND "sourceDocumentId" = p_receipt_id
  AND "sourceDocumentLineId" = p_receipt_line_id;

  -- Insert the new tracking record
  INSERT INTO "itemTracking" (
    "sourceDocument",
    "sourceDocumentReadableId",
    "sourceDocumentId", 
    "sourceDocumentLineId",
    "itemId",
    "batchNumberId",
    "quantity",
    "companyId"
  )
  SELECT
    'Receipt',
    r."receiptId",
    p_receipt_id,
    p_receipt_line_id,
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
  DELETE FROM "itemTracking"
  WHERE "sourceDocument" = 'Receipt'
  AND "sourceDocumentId" = p_receipt_id
  AND "sourceDocumentLineId" = p_receipt_line_id
  AND "index" = p_index;

  -- Insert the tracking record
  INSERT INTO "itemTracking" (
    "sourceDocument",
    "sourceDocumentReadableId",
    "sourceDocumentId", 
    "sourceDocumentLineId",
    "itemId",
    "serialNumberId",
    "quantity",
    "index",
      "companyId"
    )
    SELECT
      'Receipt',
      r."receiptId",
      p_receipt_id,
      p_receipt_line_id,
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

-- Drop the old tracking tables
DROP TABLE "receiptLineTracking";
DROP TABLE "jobMaterialTracking";
DROP TABLE "jobProductionTracking"; 

