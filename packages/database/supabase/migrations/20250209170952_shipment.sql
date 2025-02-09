CREATE TYPE "shipmentSourceDocument" AS ENUM (
  'Sales Order',
  'Sales Invoice',
  'Sales Return Order',
  'Purchase Order',
  'Purchase Invoice',
  'Purchase Return Order',
  'Inbound Transfer',
  'Outbound Transfer'
);

CREATE TYPE "shipmentStatus" AS ENUM (
  'Draft',
  'Pending',
  'Posted'
);

INSERT INTO "customFieldTable" ("table", "name", "module") 
VALUES ('shipment', 'Shipment', 'Sales');

INSERT INTO "sequence" ("table", "name", "prefix", "suffix", "next", "size", "step", "companyId")
SELECT 
  'shipment',
  'Shipment',
  'SHP',
  NULL,
  0,
  6,
  1,
  "id"
FROM "company";

CREATE TABLE "shipment" (
  "id" TEXT NOT NULL DEFAULT xid(),
  "shipmentId" TEXT NOT NULL,
  "locationId" TEXT,
  "sourceDocument" "shipmentSourceDocument",
  "sourceDocumentId" TEXT,
  "sourceDocumentReadableId" TEXT,
  "externalDocumentId" TEXT,
  "customerId" TEXT,
  "status" "shipmentStatus" NOT NULL DEFAULT 'Draft',
  "postingDate" DATE,
  "postedBy" TEXT,
  "invoiced" BOOLEAN DEFAULT FALSE,
  "assignee" TEXT,
  "internalNotes" JSONB DEFAULT '{}'::JSONB,
  "externalNotes" JSONB DEFAULT '{}'::JSONB,
  "opportunityId" TEXT,
  "companyId" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "createdBy" TEXT NOT NULL,
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  "updatedBy" TEXT,
  "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "customFields" JSONB,

  CONSTRAINT "shipment_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "shipment_shipmentId_key" UNIQUE ("shipmentId", "companyId"),
  CONSTRAINT "shipment_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "location" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "shipment_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customer" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "shipment_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "opportunity" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "shipment_assignee_fkey" FOREIGN KEY ("assignee") REFERENCES "user" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "shipment_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "shipment_postedBy_fkey" FOREIGN KEY ("postedBy") REFERENCES "user" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "shipment_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "shipment_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "user" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "shipment_shipmentId_idx" ON "shipment" ("shipmentId", "companyId");
CREATE INDEX "shipment_status_idx" ON "shipment" ("status", "companyId");
CREATE INDEX "shipment_locationId_idx" ON "shipment" ("locationId", "companyId");
CREATE INDEX "shipment_sourceDocumentId_idx" ON "shipment" ("sourceDocumentId", "companyId");
CREATE INDEX "shipment_customerId_idx" ON "shipment" ("customerId", "companyId");
CREATE INDEX "shipment_companyId_idx" ON "shipment" ("companyId");

ALTER TABLE "shipment" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "SELECT" ON "shipment"
FOR SELECT USING (
  "companyId" = ANY (
      SELECT DISTINCT unnest(ARRAY(
        SELECT unnest(get_companies_with_employee_permission('inventory_view'))
        UNION
        SELECT unnest(get_companies_with_employee_permission('sales_view'))
      ))
    )
);

CREATE POLICY "INSERT" ON "shipment"
FOR INSERT WITH CHECK (
  "companyId" = ANY (
    SELECT DISTINCT unnest(ARRAY(
      SELECT unnest(get_companies_with_employee_permission('inventory_create'))
      UNION
      SELECT unnest(get_companies_with_employee_permission('sales_create'))
    ))
  )
);

CREATE POLICY "UPDATE" ON "shipment"
FOR UPDATE USING (
 "companyId" = ANY (
      (
        SELECT
          get_companies_with_employee_permission ('sales_update')
      )::text[]
    )
);

CREATE POLICY "DELETE" ON "shipment"
FOR DELETE USING (
  "companyId" = ANY (
      (
        SELECT
          get_companies_with_employee_permission ('sales_delete')
      )::text[]
    )
);

CREATE TABLE "shipmentLine" (
  "id" TEXT NOT NULL DEFAULT xid(),
  "shipmentId" TEXT NOT NULL,
  "lineId" TEXT,
  "itemId" TEXT NOT NULL,
  "itemReadableId" TEXT,
  "orderQuantity" NUMERIC NOT NULL DEFAULT 0,
  "outstandingQuantity" NUMERIC NOT NULL DEFAULT 0,
  "shippedQuantity" NUMERIC NOT NULL DEFAULT 0,
  "locationId" TEXT,
  "shelfId" TEXT,
  "unitOfMeasure" TEXT NOT NULL,
  "unitPrice" NUMERIC NOT NULL,
  "requiresSerialTracking" BOOLEAN NOT NULL DEFAULT false,
  "requiresBatchTracking" BOOLEAN NOT NULL DEFAULT false,
  "companyId" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "createdBy" TEXT NOT NULL,
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  "updatedBy" TEXT,

  CONSTRAINT "shipmentLine_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "shipmentLine_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "shipment" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "shipmentLine_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "item" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "shipmentLine_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "location" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "shipmentLine_shelfId_fkey" FOREIGN KEY ("shelfId") REFERENCES "shelf" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "shipmentLine_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "shipmentLine_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "user" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "shipmentLine_shipmentId_idx" ON "shipmentLine" ("shipmentId");
CREATE INDEX "shipmentLine_lineId_idx" ON "shipmentLine" ("lineId");
CREATE INDEX "shipmentLine_shipmentId_lineId_idx" ON "shipmentLine" ("shipmentId", "lineId");

ALTER TABLE "shipmentLine" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "SELECT" ON "shipmentLine"
FOR SELECT USING (
  "companyId" = ANY (
      SELECT DISTINCT unnest(ARRAY(
        SELECT unnest(get_companies_with_employee_permission('inventory_view'))
        UNION
        SELECT unnest(get_companies_with_employee_permission('sales_view'))
      ))
    )
);

CREATE POLICY "INSERT" ON "shipmentLine"
FOR INSERT WITH CHECK (
  "companyId" = ANY (
    SELECT DISTINCT unnest(ARRAY(
      SELECT unnest(get_companies_with_employee_permission('inventory_create'))
      UNION
      SELECT unnest(get_companies_with_employee_permission('sales_create'))
    ))
  )
);

CREATE POLICY "UPDATE" ON "shipmentLine"
FOR UPDATE USING (
 "companyId" = ANY (
      (
        SELECT
          get_companies_with_employee_permission ('sales_update')
      )::text[]
    )
);

CREATE POLICY "DELETE" ON "shipmentLine"
FOR DELETE USING (
  "companyId" = ANY (
      (
        SELECT
          get_companies_with_employee_permission ('sales_delete')
      )::text[]
    )
);

-- Create table to track serial/batch numbers from receipts
CREATE TABLE "shipmentLineTracking" (
  "id" TEXT NOT NULL DEFAULT xid(),
  "shipmentLineId" TEXT NOT NULL,
  "shipmentId" TEXT NOT NULL,
  "itemId" TEXT NOT NULL,
  "serialNumberId" TEXT,
  "batchNumberId" TEXT,
  "quantity" NUMERIC(12, 4) NOT NULL DEFAULT 1,
  "index" INTEGER NOT NULL DEFAULT 0,
  "posted" BOOLEAN NOT NULL DEFAULT false,
  "companyId" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  "createdBy" TEXT REFERENCES "user"("id") ON DELETE CASCADE DEFAULT auth.uid(),
  
  CONSTRAINT "shipmentLineTracking_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "shipmentLineTracking_shipmentLine_fkey" FOREIGN KEY ("shipmentLineId") REFERENCES "shipmentLine"("id") ON DELETE CASCADE,
  CONSTRAINT "shipmentLineTracking_shipment_fkey" FOREIGN KEY ("shipmentId") REFERENCES "shipment"("id") ON DELETE CASCADE,
  CONSTRAINT "shipmentLineTracking_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "item"("id") ON DELETE CASCADE,
  CONSTRAINT "shipmentLineTracking_serialNumberId_fkey" FOREIGN KEY ("serialNumberId") REFERENCES "serialNumber"("id") ON DELETE RESTRICT,
  CONSTRAINT "shipmentLineTracking_batchNumberId_fkey" FOREIGN KEY ("batchNumberId") REFERENCES "batchNumber"("id") ON DELETE RESTRICT,
  CONSTRAINT "shipmentLineTracking_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE,
  CONSTRAINT "shipmentLineTracking_serial_quantity_check" CHECK (
    ("serialNumberId" IS NULL AND "batchNumberId" IS NOT NULL) OR ("serialNumberId" IS NOT NULL AND "quantity" = 1)
  )
);

ALTER TABLE "shipmentLineTracking" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "SELECT" ON "shipmentLineTracking"
FOR SELECT USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_any_role()
    )::text[]
  )
);

CREATE POLICY "INSERT" ON "shipmentLineTracking"
FOR INSERT WITH CHECK (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission('inventory_create')
    )::text[]
  )
);

CREATE POLICY "UPDATE" ON "shipmentLineTracking"
FOR UPDATE USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission('inventory_update')
    )::text[]
  )
);

CREATE POLICY "DELETE" ON "shipmentLineTracking"
FOR DELETE USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission('inventory_delete')
    )::text[]
  )
);

DROP POLICY "Anyone can view receipt tracking" ON "receiptLineTracking";
DROP POLICY "Users with inventory_create can insert receipt tracking" ON "receiptLineTracking";
DROP POLICY "Users with inventory_update can update receipt tracking" ON "receiptLineTracking";
DROP POLICY "Users with inventory_delete can delete receipt tracking" ON "receiptLineTracking";

CREATE POLICY "SELECT" ON "receiptLineTracking"
FOR SELECT USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_any_role()
    )::text[]
  )
);

CREATE POLICY "INSERT" ON "receiptLineTracking"
FOR INSERT WITH CHECK (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission('inventory_create')
    )::text[]
  )
);

CREATE POLICY "UPDATE" ON "receiptLineTracking"
FOR UPDATE USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission('inventory_update')
    )::text[]
  )
);

CREATE POLICY "DELETE" ON "receiptLineTracking"
FOR DELETE USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission('inventory_delete')
    )::text[]
  )
);


DROP POLICY "Anyone can view job material tracking" ON "jobMaterialTracking";
DROP POLICY "Users with production_create can insert job material tracking" ON "jobMaterialTracking";
DROP POLICY "Users with production_update can update job material tracking" ON "jobMaterialTracking";
DROP POLICY "Users with production_delete can delete job material tracking" ON "jobMaterialTracking";

CREATE POLICY "SELECT" ON "jobMaterialTracking"
FOR SELECT USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_any_role()
    )::text[]
  )
);

CREATE POLICY "INSERT" ON "jobMaterialTracking"
FOR INSERT WITH CHECK (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission('production_create')
    )::text[]
  )
);

CREATE POLICY "UPDATE" ON "jobMaterialTracking"
FOR UPDATE USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission('production_update')
    )::text[]
  )
);

CREATE POLICY "DELETE" ON "jobMaterialTracking"
FOR DELETE USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission('production_delete')
    )::text[]
  )
);

DROP POLICY "Anyone can view job production tracking" ON "jobProductionTracking";
DROP POLICY "Users with production_create can insert job production tracking" ON "jobProductionTracking";
DROP POLICY "Users with production_update can update job production tracking" ON "jobProductionTracking";
DROP POLICY "Users with production_delete can delete job production tracking" ON "jobProductionTracking";

CREATE POLICY "SELECT" ON "jobProductionTracking"
FOR SELECT USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_any_role()
    )::text[]
  )
);

CREATE POLICY "INSERT" ON "jobProductionTracking"
FOR INSERT WITH CHECK (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission('production_create')
    )::text[]
  )
);

CREATE POLICY "UPDATE" ON "jobProductionTracking"
FOR UPDATE USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission('production_update')
    )::text[]
  )
);

CREATE POLICY "DELETE" ON "jobProductionTracking"
FOR DELETE USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission('production_delete')
    )::text[]
  )
);

ALTER publication supabase_realtime ADD TABLE "shipment";