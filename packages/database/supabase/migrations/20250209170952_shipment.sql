ALTER TABLE "salesOrderLine" ADD COLUMN "sentDate" DATE;
ALTER TABLE "salesOrder" ADD COLUMN "sentCompleteDate" DATE;

ALTER TABLE "serialNumber" ADD COLUMN "batchNumberId" TEXT;
ALTER TABLE "serialNumber" ADD CONSTRAINT "serialNumber_batchNumberId_fkey" FOREIGN KEY ("batchNumberId") REFERENCES "batchNumber"("id") ON DELETE RESTRICT;

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
VALUES ('shipment', 'Shipment', 'Inventory');

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
  "shippingMethodId" TEXT,
  "trackingNumber" TEXT,
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
  CONSTRAINT "shipment_shippingMethodId_fkey" FOREIGN KEY ("shippingMethodId") REFERENCES "shippingMethod" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
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


ALTER publication supabase_realtime ADD TABLE "shipment";

ALTER TYPE "salesOrderStatus" ADD VALUE 'To Ship and Invoice';
ALTER TYPE "salesOrderStatus" ADD VALUE 'To Ship';
ALTER TYPE "salesOrderStatus" ADD VALUE 'To Invoice';

CREATE OR REPLACE FUNCTION update_shipment_line_batch_tracking(
  p_shipment_line_id TEXT,
  p_shipment_id TEXT,
  p_batch_number TEXT,
  p_batch_id TEXT,
  p_manufacturing_date DATE,
  p_expiration_date DATE,
  p_quantity NUMERIC,
  p_properties JSONB DEFAULT '{}'
) RETURNS void AS $$
BEGIN
  -- First upsert the batch number
  INSERT INTO "batchNumber" ("id", "number", "itemId", "companyId", "manufacturingDate", "expirationDate", "source", "properties")
  SELECT 
    p_batch_id,
    p_batch_number,
    sl."itemId",
    sl."companyId",
    p_manufacturing_date,
    p_expiration_date,
    'Purchased',
    p_properties
  FROM "shipmentLine" sl
  JOIN "shipment" s ON s.id = sl."shipmentId"
  WHERE sl.id = p_shipment_line_id
  ON CONFLICT (id) DO UPDATE SET
    "manufacturingDate" = EXCLUDED."manufacturingDate",
    "expirationDate" = EXCLUDED."expirationDate",
    "properties" = EXCLUDED."properties";

  -- Delete any existing tracking records for this shipment line
  DELETE FROM "itemTracking"
  WHERE "sourceDocument" = 'Shipment'
  AND "sourceDocumentId" = p_shipment_id
  AND "sourceDocumentLineId" = p_shipment_line_id;

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
    'Shipment',
    s."shipmentId",
    p_shipment_id,
    p_shipment_line_id,
    sl."itemId",
    p_batch_id,
    p_quantity,
    sl."companyId"
  FROM "shipmentLine" sl
  JOIN "shipment" s ON s.id = sl."shipmentId"
  WHERE sl.id = p_shipment_line_id;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION update_shipment_line_serial_tracking(
  p_shipment_line_id TEXT,
  p_shipment_id TEXT,
  p_serial_number_id TEXT,
  p_index INTEGER
) RETURNS void AS $$
BEGIN

  -- Delete any existing tracking record for this index
  DELETE FROM "itemTracking"
  WHERE "sourceDocument" = 'Shipment'
  AND "sourceDocumentId" = p_shipment_id
  AND "sourceDocumentLineId" = p_shipment_line_id
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
      'Shipment',
      s."shipmentId",
      p_shipment_id,
      p_shipment_line_id,
      sl."itemId",
      p_serial_number_id,
      1,
      p_index,
      sl."companyId"
    FROM "shipmentLine" sl
    JOIN "shipment" s ON s.id = sl."shipmentId"
    WHERE sl.id = p_shipment_line_id;
END;
$$ LANGUAGE plpgsql;


DROP VIEW IF EXISTS "serialNumbers";

CREATE TYPE "serialStatus" AS ENUM('Available', 'Reserved', 'Consumed');

ALTER TABLE "serialNumber"
DROP COLUMN "status";
COMMIT;
ALTER TABLE "serialNumber"
ADD COLUMN "status" "serialStatus" NOT NULL DEFAULT 'Available';
COMMIT;


CREATE INDEX "serialNumber_status_idx" ON "serialNumber" ("status");

DROP VIEW IF EXISTS "serialNumbers";

CREATE OR REPLACE VIEW
  "serialNumbers"
WITH
  (SECURITY_INVOKER = true) AS
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
FROM
  "serialNumber" sn
  JOIN "item" i ON i."id" = sn."itemId"
WHERE
  EXISTS (
    SELECT
      1
    FROM
      "itemTracking" it
    WHERE
      it."serialNumberId" = sn."id"
      AND it."posted" = true
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

  -- Drop trigger and function for purchaseOrderLine
  DROP TRIGGER IF EXISTS update_inventory_quantity_on_purchase_order_line_trigger ON "purchaseOrderLine";
  DROP FUNCTION IF EXISTS update_inventory_quantity_on_purchase_order_line;

  -- Drop trigger and function for purchaseOrder
  DROP TRIGGER IF EXISTS update_inventory_quantity_on_purchase_order_trigger ON "purchaseOrder";
  DROP FUNCTION IF EXISTS update_inventory_quantity_on_purchase_order;

  -- Drop trigger and function for salesOrderLine
  DROP TRIGGER IF EXISTS update_inventory_quantity_on_sales_order_line_trigger ON "salesOrderLine";
  DROP FUNCTION IF EXISTS update_inventory_quantity_on_sales_order_line;

  -- Drop trigger and function for salesOrder
  DROP TRIGGER IF EXISTS update_inventory_quantity_on_sales_order_trigger ON "salesOrder";
  DROP FUNCTION IF EXISTS update_inventory_quantity_on_sales_order;

-- Drop trigger and function for itemLedger
DROP TRIGGER IF EXISTS update_item_inventory_from_item_ledger_trigger ON "itemLedger";
DROP FUNCTION IF EXISTS update_item_inventory_from_item_ledger;


DROP FUNCTION IF EXISTS get_inventory_quantities;
CREATE OR REPLACE FUNCTION get_inventory_quantities(company_id TEXT, location_id TEXT)
  RETURNS TABLE (
    "id" TEXT,
    "readableId" TEXT,
    "name" TEXT,
    "active" BOOLEAN,
    "type" "itemType",
    "itemTrackingType" "itemTrackingType",
    "replenishmentSystem" "itemReplenishmentSystem",
    "materialSubstanceId" TEXT,
    "materialFormId" TEXT,
    "thumbnailPath" TEXT,
    "unitOfMeasureCode" TEXT,
    "quantityOnHand" NUMERIC,
    "quantityOnSalesOrder" NUMERIC,
    "quantityOnPurchaseOrder" NUMERIC,
    "quantityOnProductionOrder" NUMERIC
  ) AS $$
  BEGIN
    RETURN QUERY
    
WITH
  open_purchase_orders AS (
    SELECT
      pol."itemId",
      SUM(pol."quantityToReceive" * pol."conversionFactor") AS "quantityOnPurchaseOrder" 
    FROM
      "purchaseOrder" po
      INNER JOIN "purchaseOrderLine" pol
        ON pol."purchaseOrderId" = po."id"
    WHERE
      po."status" IN (
        'To Receive',
        'To Receive and Invoice'
      )
      AND po."companyId" = company_id
      AND pol."locationId" = location_id
    GROUP BY pol."itemId"
  ),
  open_sales_orders AS (
    SELECT
      sol."itemId",
      SUM(sol."quantityToSend") AS "quantityOnSalesOrder" 
    FROM
      "salesOrder" so
      INNER JOIN "salesOrderLine" sol
        ON sol."salesOrderId" = so."id"
    WHERE
      so."status" IN (
        'Confirmed',
        'To Ship and Invoice',
        'To Ship',
        'To Invoice',
        'In Progress'
      )
      AND so."companyId" = company_id
      AND sol."locationId" = location_id
    GROUP BY sol."itemId"
  ),
  open_jobs AS (
    SELECT 
      j."itemId",
      SUM(j."productionQuantity" + j."scrapQuantity" - j."quantityReceivedToInventory" - j."quantityShipped") AS "quantityOnProductionOrder"
    FROM job j
    WHERE j."status" IN (
      'Ready',
      'In Progress',
      'Paused'
    )
    GROUP BY j."itemId"
  ),
  item_ledgers AS (
    SELECT "itemId", SUM("quantity") AS "quantityOnHand"
    FROM "itemLedger"
    WHERE "companyId" = company_id
      AND "locationId" = location_id
    GROUP BY "itemId"
  )
  
SELECT
  i."id",
  i."readableId",
  i."name",
  i."active",
  i."type",
  i."itemTrackingType",
  i."replenishmentSystem",
  m."materialSubstanceId",
  m."materialFormId",
  CASE
    WHEN i."thumbnailPath" IS NULL AND mu."thumbnailPath" IS NOT NULL THEN mu."thumbnailPath"
    ELSE i."thumbnailPath"
  END AS "thumbnailPath",
  i."unitOfMeasureCode",
  COALESCE(il."quantityOnHand", 0) AS "quantityOnHand",
  COALESCE(so."quantityOnSalesOrder", 0) AS "quantityOnSalesOrder",
  COALESCE(po."quantityOnPurchaseOrder", 0) AS "quantityOnPurchaseOrder",
  COALESCE(jo."quantityOnProductionOrder", 0) AS "quantityOnProductionOrder"
FROM
  "item" i
  LEFT JOIN item_ledgers il ON i."id" = il."itemId"
  LEFT JOIN open_sales_orders so ON i."id" = so."itemId"
  LEFT JOIN open_purchase_orders po ON i."id" = po."itemId"
  LEFT JOIN open_jobs jo ON i."id" = jo."itemId"
  LEFT JOIN material m ON i."id" = m."itemId"
  LEFT JOIN "modelUpload" mu ON mu.id = i."modelUploadId"
WHERE
  i."itemTrackingType" <> 'Non-Inventory';
  END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP FUNCTION IF EXISTS get_item_quantities;


DROP FUNCTION IF EXISTS get_item_quantities_by_shelf_batch_serial;

CREATE
OR REPLACE FUNCTION get_item_quantities_by_shelf_batch_serial (item_id TEXT, company_id TEXT, location_id TEXT) RETURNS TABLE (
  "itemId" TEXT,
  "shelfId" TEXT,
  "shelfName" TEXT,
  "batchNumber" TEXT,
  "serialNumber" TEXT,
  quantity NUMERIC
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    il."itemId",
    il."shelfId",
    s."name" AS "shelfName",
    il."batchNumber",
    il."serialNumber",
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
    il."batchNumber",
    il."serialNumber";
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;



DROP FUNCTION IF EXISTS get_job_quantity_on_hand;
CREATE OR REPLACE FUNCTION get_job_quantity_on_hand(job_id TEXT, company_id TEXT, location_id TEXT)
  RETURNS TABLE (
    "id" TEXT,
    "jobMaterialItemId" TEXT,
    "jobMakeMethodId" TEXT,
    "itemReadableId" TEXT,
    "name" TEXT,
    "description" TEXT,
    "itemTrackingType" "itemTrackingType",
    "methodType" "methodType",
    "type" "itemType",
    "thumbnailPath" TEXT,
    "unitOfMeasureCode" TEXT,
    "quantityPerParent" NUMERIC,
    "estimatedQuantity" NUMERIC,
    "quantityIssued" NUMERIC,
    "quantityOnHand" NUMERIC,
    "quantityOnSalesOrder" NUMERIC,
    "quantityOnPurchaseOrder" NUMERIC,
    "quantityOnProductionOrder" NUMERIC
  ) AS $$
  BEGIN
    RETURN QUERY
    
WITH
  open_purchase_orders AS (
    SELECT
      pol."itemId" AS "purchaseOrderItemId",
      SUM(pol."quantityToReceive" * pol."conversionFactor") AS "quantityOnPurchaseOrder" 
    FROM
      "purchaseOrder" po
      INNER JOIN "purchaseOrderLine" pol
        ON pol."purchaseOrderId" = po."id"
    WHERE
      po."status" IN (
        'To Receive',
        'To Receive and Invoice'
      )
      AND po."companyId" = company_id
      AND pol."locationId" = location_id
    GROUP BY pol."itemId"
  ),
  open_sales_orders AS (
    SELECT
      sol."itemId" AS "salesOrderItemId",
      SUM(sol."quantityToSend") AS "quantityOnSalesOrder" 
    FROM
      "salesOrder" so
      INNER JOIN "salesOrderLine" sol
        ON sol."salesOrderId" = so."id"
    WHERE
      so."status" IN (
        'Confirmed',
        'To Ship and Invoice',
        'To Ship',
        'To Invoice',
        'In Progress'
      )
      AND so."companyId" = company_id
      AND sol."locationId" = location_id
    GROUP BY sol."itemId"
  ),
  open_jobs AS (
    SELECT 
      j."itemId" AS "jobItemId",
      SUM(j."productionQuantity" + j."scrapQuantity" - j."quantityReceivedToInventory" - j."quantityShipped") AS "quantityOnProductionOrder"
    FROM job j
    WHERE j."status" IN (
      'Ready',
      'In Progress',
      'Paused'
    )
    GROUP BY j."itemId"
  ),
  item_ledgers AS (
    SELECT "itemId" AS "ledgerItemId", SUM("quantity") AS "quantityOnHand"
    FROM "itemLedger"
    WHERE "companyId" = company_id
      AND "locationId" = location_id
    GROUP BY "itemId"
  )
  
SELECT
  jm."id",
  jm."itemId" AS "jobMaterialItemId",
  jm."jobMakeMethodId",
  i."readableId" AS "itemReadableId",
  i."name",
  jm."description",
  i."itemTrackingType",
  jm."methodType",
  i."type",
  CASE
    WHEN i."thumbnailPath" IS NULL AND mu."thumbnailPath" IS NOT NULL THEN mu."thumbnailPath"
    ELSE i."thumbnailPath"
  END AS "thumbnailPath",
  i."unitOfMeasureCode",
  jm."quantity" as "quantityPerParent",
  jm."estimatedQuantity",
  jm."quantityIssued",
  COALESCE(il."quantityOnHand", 0) AS "quantityOnHand",
  COALESCE(so."quantityOnSalesOrder", 0) AS "quantityOnSalesOrder",
  COALESCE(po."quantityOnPurchaseOrder", 0) AS "quantityOnPurchaseOrder",
  COALESCE(jo."quantityOnProductionOrder", 0) AS "quantityOnProductionOrder"
FROM
  "jobMaterial" jm
  INNER JOIN "item" i ON i."id" = jm."itemId"
  LEFT JOIN item_ledgers il ON i."id" = il."ledgerItemId"
  LEFT JOIN open_sales_orders so ON i."id" = so."salesOrderItemId"
  LEFT JOIN open_purchase_orders po ON i."id" = po."purchaseOrderItemId"
  LEFT JOIN open_jobs jo ON i."id" = jo."jobItemId"
  LEFT JOIN material m ON i."id" = m."itemId"
  LEFT JOIN "modelUpload" mu ON mu.id = i."modelUploadId"
WHERE
  jm."jobId" = job_id;
  END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP VIEW IF EXISTS "shipmentLines";
CREATE OR REPLACE VIEW "shipmentLines" WITH(SECURITY_INVOKER=true) AS
  SELECT
    sl.*,
    CASE
      WHEN i."thumbnailPath" IS NULL AND mu."thumbnailPath" IS NOT NULL THEN mu."thumbnailPath"
      ELSE i."thumbnailPath"
    END AS "thumbnailPath",
    i."name" as "description"
  FROM "shipmentLine" sl
  INNER JOIN "item" i ON i."id" = sl."itemId"
  LEFT JOIN "modelUpload" mu ON mu.id = i."modelUploadId";

DROP TABLE IF EXISTS "itemInventory";

UPDATE "salesOrder" SET "status" = 'To Ship' WHERE "status" = 'Confirmed';