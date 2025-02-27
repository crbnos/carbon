-- Drop tables with CASCADE to ensure all dependent objects are also removed
DROP TABLE IF EXISTS "itemTracking" CASCADE;
DROP TABLE IF EXISTS "serialNumber" CASCADE;
DROP TABLE IF EXISTS "batchNumber" CASCADE;

ALTER TABLE "itemLedger" DROP COLUMN "serialNumber";
ALTER TABLE "itemLedger" DROP COLUMN "batchNumber";

DROP FUNCTION IF EXISTS update_receipt_line_batch_tracking;
DROP FUNCTION IF EXISTS update_receipt_line_serial_tracking;
DROP FUNCTION IF EXISTS update_shipment_line_batch_tracking;
DROP FUNCTION IF EXISTS update_shipment_line_serial_tracking;
DROP VIEW IF EXISTS "batchNumbers";
DROP VIEW IF EXISTS "serialNumbers";

DROP TYPE IF EXISTS "serialStatus";
CREATE TYPE "trackedEntityStatus" AS ENUM('Available', 'Reserved', 'On Hold', 'Consumed');

ALTER TYPE "configurationParameterDataType" ADD VALUE 'date';

-- Create tracked entity table
CREATE TABLE "trackedEntity" (
  "id" TEXT NOT NULL DEFAULT xid(),
  "quantity" NUMERIC NOT NULL,
  "status" "trackedEntityStatus" NOT NULL DEFAULT 'Available',
  "sourceDocument" TEXT NOT NULL,
  "sourceDocumentId" TEXT NOT NULL,
  "sourceDocumentReadableId" TEXT,
  "attributes" JSONB NOT NULL DEFAULT '{}',
  "companyId" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "createdBy" TEXT NOT NULL,
  
  CONSTRAINT "trackedEntity_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "trackedEntity_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "trackedEntity_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user"("id") ON UPDATE CASCADE
);

ALTER TABLE "itemLedger" ADD COLUMN "trackedEntityId" TEXT;
ALTER TABLE "itemLedger" ADD CONSTRAINT "itemLedger_trackedEntityId_fkey" FOREIGN KEY ("trackedEntityId") REFERENCES "trackedEntity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Create trackedActivity table
CREATE TABLE "trackedActivity" (
  "id" TEXT NOT NULL DEFAULT xid(),
  "type" TEXT NOT NULL,
  "sourceDocument" TEXT,
  "sourceDocumentId" TEXT,
  "sourceDocumentReadableId" TEXT,
  "attributes" JSONB NOT NULL DEFAULT '{}',
  "companyId" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "createdBy" TEXT NOT NULL,
  
  CONSTRAINT "trackedActivity_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "trackedActivity_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "trackedActivity_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user"("id") ON UPDATE CASCADE
);

-- Create trackedActivity input table
CREATE TABLE "trackedActivityInput" (
  "trackedActivityId" TEXT NOT NULL,
  "trackedEntityId" TEXT NOT NULL,
  "quantity" NUMERIC NOT NULL,
  "entityType" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "createdBy" TEXT NOT NULL,
  
  CONSTRAINT "trackedActivityInput_pkey" PRIMARY KEY ("trackedActivityId", "trackedEntityId"),
  CONSTRAINT "trackedActivityInput_trackedActivityId_fkey" FOREIGN KEY ("trackedActivityId") REFERENCES "trackedActivity"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "trackedActivityInput_trackedEntityId_fkey" FOREIGN KEY ("trackedEntityId") REFERENCES "trackedEntity"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "trackedActivityInput_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "trackedActivityInput_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user"("id") ON UPDATE CASCADE
);

-- Create trackedActivity output table
CREATE TABLE "trackedActivityOutput" (
  "trackedActivityId" TEXT NOT NULL,
  "trackedEntityId" TEXT NOT NULL,
  "quantity" NUMERIC NOT NULL,
  "companyId" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "createdBy" TEXT NOT NULL,
  
  CONSTRAINT "trackedActivityOutput_pkey" PRIMARY KEY ("trackedActivityId", "trackedEntityId"),
  CONSTRAINT "trackedActivityOutput_trackedActivityId_fkey" FOREIGN KEY ("trackedActivityId") REFERENCES "trackedActivity"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "trackedActivityOutput_trackedEntityId_fkey" FOREIGN KEY ("trackedEntityId") REFERENCES "trackedEntity"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "trackedActivityOutput_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "trackedActivityOutput_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user"("id") ON UPDATE CASCADE
);

-- Create indexes for performance
CREATE INDEX "idx_trackedEntity_sourceDocument_sourceDocumentId" ON "trackedEntity"("sourceDocument", "sourceDocumentId");
CREATE INDEX "idx_trackedEntity_companyId" ON "trackedEntity"("companyId");
CREATE INDEX "idx_trackedEntity_attributes" ON "trackedEntity" USING GIN ("attributes");
CREATE INDEX "idx_trackedActivity_type" ON "trackedActivity"("type");
CREATE INDEX "idx_trackedActivity_sourceDocument_sourceDocumentId" ON "trackedActivity"("sourceDocument", "sourceDocumentId");
CREATE INDEX "idx_trackedActivity_companyId" ON "trackedActivity"("companyId");
CREATE INDEX "idx_trackedActivity_attributes" ON "trackedActivity" USING GIN ("attributes");
CREATE INDEX "idx_trackedActivityInput_trackedEntityId" ON "trackedActivityInput"("trackedEntityId");
CREATE INDEX "idx_trackedActivityInput_companyId" ON "trackedActivityInput"("companyId");
CREATE INDEX "idx_trackedActivityOutput_trackedEntityId" ON "trackedActivityOutput"("trackedEntityId");
CREATE INDEX "idx_trackedActivityOutput_companyId" ON "trackedActivityOutput"("companyId");

-- Add RLS policies
ALTER TABLE "trackedEntity" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "trackedActivity" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "trackedActivityInput" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "trackedActivityOutput" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "SELECT" ON "public"."trackedEntity"
FOR SELECT USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_role()
    )::text[]
  )
);

CREATE POLICY "SELECT" ON "public"."trackedActivity"
FOR SELECT USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_role()
    )::text[]
  )
);

CREATE POLICY "SELECT" ON "public"."trackedActivityInput"
FOR SELECT USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_role()
    )::text[]
  )
);

CREATE POLICY "SELECT" ON "public"."trackedActivityOutput"
FOR SELECT USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_role()
    )::text[]
  )
);

CREATE POLICY "INSERT" ON "public"."trackedEntity"
FOR INSERT WITH CHECK (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_role()
    )::text[]
  )
);

CREATE POLICY "INSERT" ON "public"."trackedActivity"
FOR INSERT WITH CHECK (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_role()
    )::text[]
  )
);

CREATE POLICY "INSERT" ON "public"."trackedActivityInput"
FOR INSERT WITH CHECK (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_role()
    )::text[]
  )
);

CREATE POLICY "INSERT" ON "public"."trackedActivityOutput"
FOR INSERT WITH CHECK (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_role()
    )::text[]
  )
);



DROP FUNCTION IF EXISTS get_item_quantities_by_shelf_batch_serial;
DROP FUNCTION IF EXISTS get_item_quantities_by_tracking_id;
CREATE OR REPLACE FUNCTION get_item_quantities_by_tracking_id (item_id TEXT, company_id TEXT, location_id TEXT) RETURNS TABLE (
  "itemId" TEXT,
  "shelfId" TEXT,
  "shelfName" TEXT,
  "trackedEntityId" TEXT,
  quantity NUMERIC
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    il."itemId",
    il."shelfId",
    s."name" AS "shelfName",
    il."trackedEntityId",
    SUM(il."quantity") AS "quantity"
  FROM
    "itemLedger" il
  LEFT JOIN
    "shelf" s ON il."shelfId" = s."id"
  WHERE
    il."itemId" = item_id
    AND il."companyId" = company_id
    AND il."locationId" = location_id
  GROUP BY
    il."itemId",
    il."shelfId",
    s."name",
    il."trackedEntityId";
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP FUNCTION IF EXISTS update_receipt_line_batch_tracking;
CREATE OR REPLACE FUNCTION update_receipt_line_batch_tracking(
  p_receipt_line_id TEXT,
  p_receipt_id TEXT,
  p_batch_number TEXT,
  p_quantity NUMERIC,
  p_tracked_entity_id TEXT DEFAULT NULL,
  p_properties JSONB DEFAULT '{}'
) RETURNS void AS $$
DECLARE
  v_tracked_entity_id TEXT;
  v_item_id TEXT;
  v_item_readable_id TEXT;
  v_company_id TEXT;
  v_created_by TEXT;
  v_supplier_id TEXT;
  v_attributes JSONB;
BEGIN
  v_tracked_entity_id := COALESCE(p_tracked_entity_id, xid());
  -- Get receipt line details
  SELECT 
    rl."itemId",  
    rl."itemReadableId",
    rl."companyId",
    rl."createdBy",
    r."supplierId"
  INTO
    v_item_id,
    v_item_readable_id,
    v_company_id,
    v_created_by,
    v_supplier_id
  FROM "receiptLine" rl
  JOIN "receipt" r ON r.id = rl."receiptId"
  WHERE rl.id = p_receipt_line_id;

  -- Build attributes JSONB
  v_attributes := jsonb_build_object(
    'Batch Number', p_batch_number,
    'Receipt Line', p_receipt_line_id,
    'Receipt', p_receipt_id
  );
  
  -- Add supplier if available
  IF v_supplier_id IS NOT NULL THEN
    v_attributes := v_attributes || jsonb_build_object('Supplier', v_supplier_id);
  END IF;
  
  -- Merge any additional properties
  v_attributes := v_attributes || p_properties;

  -- Upsert the tracked entity with attributes
  INSERT INTO "trackedEntity" (
    "id", 
    "quantity", 
    "status",
    "sourceDocument", 
    "sourceDocumentId", 
    "sourceDocumentReadableId", 
    "attributes",
    "companyId", 
    "createdBy"
  )
  VALUES (
    v_tracked_entity_id,
    p_quantity,
    'On Hold',
    'Item',
    v_item_id,
    v_item_readable_id,
    v_attributes,
    v_company_id,
    v_created_by
  )
  ON CONFLICT (id) DO UPDATE SET
    "quantity" = EXCLUDED."quantity",
    "attributes" = EXCLUDED."attributes";
    
END;
$$ LANGUAGE plpgsql;

DROP FUNCTION IF EXISTS update_receipt_line_serial_tracking;
CREATE OR REPLACE FUNCTION update_receipt_line_serial_tracking(
  p_receipt_line_id TEXT,
  p_receipt_id TEXT,
  p_serial_number TEXT,
  p_index INTEGER,
  p_tracked_entity_id TEXT DEFAULT NULL
) RETURNS void AS $$
DECLARE
  v_item_id TEXT;
  v_item_readable_id TEXT;
  v_serial_id TEXT;
  v_company_id TEXT;
  v_created_by TEXT;
  v_supplier_id TEXT;
  v_attributes JSONB;
BEGIN
  -- Get receipt line details
  SELECT 
    rl."itemId",
    rl."itemReadableId",
    rl."companyId",
    rl."createdBy",
    r."supplierId"
  INTO
    v_item_id,
    v_item_readable_id,
    v_company_id,
    v_created_by,
    v_supplier_id
  FROM "receiptLine" rl
  JOIN "receipt" r ON r.id = rl."receiptId"
  WHERE rl.id = p_receipt_line_id;

  -- First create the tracked entity for this serial number
  v_serial_id := COALESCE(p_tracked_entity_id, xid());
  
  -- Build attributes JSONB
  v_attributes := jsonb_build_object(
    'Serial Number', p_serial_number,
    'Receipt Line', p_receipt_line_id,
    'Receipt', p_receipt_id,
    'Index', p_index
  );
  
  -- Add supplier if available
  IF v_supplier_id IS NOT NULL THEN
    v_attributes := v_attributes || jsonb_build_object('Supplier', v_supplier_id);
  END IF;
  
  INSERT INTO "trackedEntity" (
    "id", 
    "quantity", 
    "status",
    "sourceDocument", 
    "sourceDocumentId", 
    "sourceDocumentReadableId", 
    "attributes",
    "companyId", 
    "createdBy"
  )
  VALUES (
    v_serial_id,
    1,
    'On Hold',
    'Item',
    v_item_id,
    v_item_readable_id,
    v_attributes,
    v_company_id,
    v_created_by
  )
  ON CONFLICT (id) DO UPDATE SET
    "quantity" = EXCLUDED."quantity",
    "attributes" = EXCLUDED."attributes";

END;
$$ LANGUAGE plpgsql;