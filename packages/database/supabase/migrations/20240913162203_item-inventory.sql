

-- Create itemInventory table
CREATE TABLE "itemInventory" (
  "id" TEXT NOT NULL DEFAULT xid(),
  "itemId" TEXT NOT NULL,
  "locationId" TEXT,
  "shelfId" TEXT,
  "companyId" TEXT NOT NULL,
  "quantityOnHand" NUMERIC(12, 4) NOT NULL DEFAULT 0,
  "quantityOnPurchase" NUMERIC(12, 4) NOT NULL DEFAULT 0,
  "quantityOnSalesOrder" NUMERIC(12, 4) NOT NULL DEFAULT 0,
  "quantityOnProductionOrder" NUMERIC(12, 4) NOT NULL DEFAULT 0,
  CONSTRAINT "itemInventory_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "itemInventory_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "item"("id") ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT "itemInventory_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "location"("id") ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT "itemInventory_shelfId_fkey" FOREIGN KEY ("shelfId", "locationId") REFERENCES "shelf"("id", "locationId") ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT "itemInventory_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON UPDATE CASCADE ON DELETE CASCADE
);

-- Create index on companyId
CREATE INDEX "itemInventory_companyId_idx" ON "itemInventory" ("companyId");

-- Create composite index on companyId and locationId
CREATE INDEX "itemInventory_companyId_locationId_idx" ON "itemInventory" ("companyId", "locationId");


ALTER TABLE "itemInventory" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Employees with parts_view or inventory_view inventory_view can view item inventory" ON "itemInventory"
  FOR SELECT
  USING (
    has_role('employee', "companyId") AND (
      has_company_permission('parts_view', "companyId") OR 
      has_company_permission('inventory_view', "companyId")
    )
  );

-- Create function to update itemInventory
CREATE OR REPLACE FUNCTION update_item_inventory_from_item_ledger()
RETURNS TRIGGER AS $$
BEGIN
  -- Check if a row exists, handling NULL shelfId and locationId
  IF EXISTS (
    SELECT 1 FROM "itemInventory"
    WHERE "itemId" = NEW."itemId"
      AND "companyId" = NEW."companyId"
      AND (("locationId" = NEW."locationId") OR (NEW."locationId" IS NULL AND "locationId" IS NULL))
      AND (("shelfId" = NEW."shelfId") OR (NEW."shelfId" IS NULL AND "shelfId" IS NULL))
  ) THEN
    -- Update existing row
    UPDATE "itemInventory"
    SET "quantityOnHand" = "quantityOnHand" + 
      CASE 
        WHEN NEW."entryType" IN ('Positive Adjmt.', 'Purchase', 'Output', 'Assembly Output') THEN NEW."quantity"
        WHEN NEW."entryType" IN ('Negative Adjmt.', 'Sale', 'Consumption', 'Assembly Consumption') THEN -NEW."quantity"
        WHEN NEW."entryType" = 'Transfer' THEN 
          CASE 
            WHEN NEW."locationId" = OLD."locationId" THEN -NEW."quantity"
            ELSE NEW."quantity"
          END
        ELSE 0
      END
    WHERE "itemId" = NEW."itemId"
      AND "companyId" = NEW."companyId"
      AND (("locationId" = NEW."locationId") OR (NEW."locationId" IS NULL AND "locationId" IS NULL))
      AND (("shelfId" = NEW."shelfId") OR (NEW."shelfId" IS NULL AND "shelfId" IS NULL));
  ELSE
    -- Insert new row
    INSERT INTO "itemInventory" ("itemId", "locationId", "shelfId", "companyId", "quantityOnHand")
    VALUES (NEW."itemId", NEW."locationId", NEW."shelfId", NEW."companyId",
      CASE 
        WHEN NEW."entryType" IN ('Positive Adjmt.', 'Purchase', 'Output', 'Assembly Output') THEN NEW."quantity"
        WHEN NEW."entryType" IN ('Negative Adjmt.', 'Sale', 'Consumption', 'Assembly Consumption') THEN -NEW."quantity"
        WHEN NEW."entryType" = 'Transfer' THEN 
          CASE 
            WHEN NEW."locationId" = OLD."locationId" THEN -NEW."quantity"
            ELSE NEW."quantity"
          END
        ELSE 0
      END);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- Create trigger on itemLedger
CREATE TRIGGER update_item_inventory_from_item_ledger_trigger
AFTER INSERT OR UPDATE ON "itemLedger"
FOR EACH ROW
EXECUTE FUNCTION update_item_inventory_from_item_ledger();

-- Function to update inventory quantity on purchase order based on purchase order status changes
CREATE OR REPLACE FUNCTION update_inventory_quantity_on_purchase_order()
RETURNS TRIGGER AS $$
DECLARE
  line RECORD;
BEGIN
  -- When status changes to 'To Receive and Invoice'
  IF (OLD.status = 'Draft' OR OLD.status = 'To Review') AND NEW.status = 'To Receive and Invoice' THEN
    FOR line IN (SELECT * FROM "purchaseOrderLine" WHERE "purchaseOrderId" = NEW.id)
    LOOP
      IF EXISTS (
        SELECT 1 FROM "itemInventory"
        WHERE "itemId" = line."itemId"
          AND "companyId" = line."companyId"
          AND (("locationId" = line."locationId") OR (line."locationId" IS NULL AND "locationId" IS NULL))
          AND (("shelfId" = line."shelfId") OR (line."shelfId" IS NULL AND "shelfId" IS NULL))
      ) THEN
        -- Update existing row
        UPDATE "itemInventory"
        SET "quantityOnPurchase" = "quantityOnPurchase" + (line."quantityToReceive" - COALESCE(line."quantityReceived", 0))
        WHERE "itemId" = line."itemId"
          AND "companyId" = line."companyId"
          AND (("locationId" = line."locationId") OR (line."locationId" IS NULL AND "locationId" IS NULL))
          AND (("shelfId" = line."shelfId") OR (line."shelfId" IS NULL AND "shelfId" IS NULL));
      ELSE
        -- Insert new row
        INSERT INTO "itemInventory" ("itemId", "locationId", "shelfId", "companyId", "quantityOnPurchase")
        VALUES (line."itemId", line."locationId", line."shelfId", line."companyId", line."quantityToReceive" - COALESCE(line."quantityReceived", 0));
      END IF;
    END LOOP;

  -- When status changes back to 'Draft' or to 'Closed'
  ELSIF (NEW.status = 'Draft' AND OLD.status != 'Draft') OR (NEW.status = 'Closed' AND OLD.status != 'Closed') THEN
    FOR line IN (SELECT * FROM "purchaseOrderLine" WHERE "purchaseOrderId" = NEW.id)
    LOOP
      IF EXISTS (
        SELECT 1 FROM "itemInventory"
        WHERE "itemId" = line."itemId"
          AND "companyId" = line."companyId"
          AND (("locationId" = line."locationId") OR (line."locationId" IS NULL AND "locationId" IS NULL))
          AND (("shelfId" = line."shelfId") OR (line."shelfId" IS NULL AND "shelfId" IS NULL))
      ) THEN
        UPDATE "itemInventory"
        SET "quantityOnPurchase" = "quantityOnPurchase" - (line."quantityToReceive" - COALESCE(line."quantityReceived", 0))
        WHERE "itemId" = line."itemId"
          AND "companyId" = line."companyId"
          AND (("locationId" = line."locationId") OR (line."locationId" IS NULL AND "locationId" IS NULL))
          AND (("shelfId" = line."shelfId") OR (line."shelfId" IS NULL AND "shelfId" IS NULL));
      END IF;
    END LOOP;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create trigger on purchaseOrder
CREATE TRIGGER update_inventory_quantity_on_purchase_order_trigger
AFTER UPDATE OF status ON "purchaseOrder"
FOR EACH ROW
WHEN (OLD.status IS DISTINCT FROM NEW.status)
EXECUTE FUNCTION update_inventory_quantity_on_purchase_order();

-- Function to update inventory quantity when purchaseOrderLine is updated
CREATE OR REPLACE FUNCTION update_inventory_quantity_on_purchase_order_line()
RETURNS TRIGGER AS $$
BEGIN
  -- Only proceed if quantityReceived has changed and is not 0
  IF NEW."quantityReceived" != OLD."quantityReceived" AND NEW."quantityReceived" != 0 THEN
    -- Check if an entry exists in itemInventory
    IF EXISTS (
      SELECT 1 FROM "itemInventory"
      WHERE "itemId" = NEW."itemId"
        AND "companyId" = NEW."companyId"
        AND (("locationId" = NEW."locationId") OR (NEW."locationId" IS NULL AND "locationId" IS NULL))
        AND (("shelfId" = NEW."shelfId") OR (NEW."shelfId" IS NULL AND "shelfId" IS NULL))
    ) THEN
      -- Update existing row
      UPDATE "itemInventory"
      SET "quantityOnPurchase" = "quantityOnPurchase" - (NEW."quantityReceived" - OLD."quantityReceived")
      WHERE "itemId" = NEW."itemId"
        AND "companyId" = NEW."companyId"
        AND (("locationId" = NEW."locationId") OR (NEW."locationId" IS NULL AND "locationId" IS NULL))
        AND (("shelfId" = NEW."shelfId") OR (NEW."shelfId" IS NULL AND "shelfId" IS NULL));
    ELSE
      -- Insert new row
      INSERT INTO "itemInventory" ("itemId", "locationId", "shelfId", "companyId", "quantityOnPurchase")
      VALUES (NEW."itemId", NEW."locationId", NEW."shelfId", NEW."companyId", NEW."quantityToReceive");
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create trigger on purchaseOrderLine
CREATE TRIGGER update_inventory_quantity_on_purchase_order_line_trigger
AFTER UPDATE OF "quantityReceived" ON "purchaseOrderLine"
FOR EACH ROW
WHEN (OLD."quantityReceived" IS DISTINCT FROM NEW."quantityReceived")
EXECUTE FUNCTION update_inventory_quantity_on_purchase_order_line();

-- Function to update inventory quantity on sales order based on sales order status changes
CREATE OR REPLACE FUNCTION update_inventory_quantity_on_sales_order()
RETURNS TRIGGER AS $$
DECLARE
  line RECORD;
BEGIN
  -- When status changes to 'To Ship and Invoice'
  IF (OLD.status = 'Draft' OR OLD.status = 'Needs Approval') AND NEW.status = 'Confirmed' THEN
    FOR line IN (SELECT * FROM "salesOrderLine" WHERE "salesOrderId" = NEW.id)
    LOOP
      IF EXISTS (
        SELECT 1 FROM "itemInventory"
        WHERE "itemId" = line."itemId"
          AND "companyId" = line."companyId"
          AND (("locationId" = line."locationId") OR (line."locationId" IS NULL AND "locationId" IS NULL))
          AND (("shelfId" = line."shelfId") OR (line."shelfId" IS NULL AND "shelfId" IS NULL))
      ) THEN
        -- Update existing row
        UPDATE "itemInventory"
        SET "quantityOnSalesOrder" = "quantityOnSalesOrder" + line."quantityToSend"
        WHERE "itemId" = line."itemId"
          AND "companyId" = line."companyId"
          AND (("locationId" = line."locationId") OR (line."locationId" IS NULL AND "locationId" IS NULL))
          AND (("shelfId" = line."shelfId") OR (line."shelfId" IS NULL AND "shelfId" IS NULL));
      ELSE
        -- Insert new row
        INSERT INTO "itemInventory" ("itemId", "locationId", "shelfId", "companyId", "quantityOnSalesOrder")
        VALUES (line."itemId", line."locationId", line."shelfId", line."companyId", line."quantityToSend");
      END IF;
    END LOOP;

  -- When status changes back to 'Draft' or to 'Closed'
  ELSIF (NEW.status = 'Draft' AND OLD.status != 'Draft') OR (NEW.status = 'Closed' AND OLD.status != 'Closed') OR (NEW.status = 'Cancelled' AND OLD.status != 'Cancelled') THEN
    FOR line IN (SELECT * FROM "salesOrderLine" WHERE "salesOrderId" = NEW.id)
    LOOP
      IF EXISTS (
        SELECT 1 FROM "itemInventory"
        WHERE "itemId" = line."itemId"
          AND "companyId" = line."companyId"
          AND (("locationId" = line."locationId") OR (line."locationId" IS NULL AND "locationId" IS NULL))
          AND (("shelfId" = line."shelfId") OR (line."shelfId" IS NULL AND "shelfId" IS NULL))
      ) THEN
        UPDATE "itemInventory"
        SET "quantityOnSalesOrder" = "quantityOnSalesOrder" - line."quantityToSend"
        WHERE "itemId" = line."itemId"
          AND "companyId" = line."companyId"
          AND (("locationId" = line."locationId") OR (line."locationId" IS NULL AND "locationId" IS NULL))
          AND (("shelfId" = line."shelfId") OR (line."shelfId" IS NULL AND "shelfId" IS NULL));
      END IF;
    END LOOP;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

ALTER TYPE "salesOrderStatus" ADD VALUE 'Closed';

-- Create trigger on salesOrder
CREATE TRIGGER update_inventory_quantity_on_sales_order_trigger
AFTER UPDATE OF status ON "salesOrder"
FOR EACH ROW
WHEN (OLD.status IS DISTINCT FROM NEW.status)
EXECUTE FUNCTION update_inventory_quantity_on_sales_order();

-- Function to update inventory quantity when salesOrderLine is updated
CREATE OR REPLACE FUNCTION update_inventory_quantity_on_sales_order_line()
RETURNS TRIGGER AS $$
BEGIN
  -- Only proceed if quantitySent has changed and is not 0
  IF NEW."quantitySent" != OLD."quantitySent" AND NEW."quantitySent" != 0 THEN
    -- Check if an entry exists in itemInventory
    IF EXISTS (
      SELECT 1 FROM "itemInventory"
      WHERE "itemId" = NEW."itemId"
        AND "companyId" = NEW."companyId"
        AND (("locationId" = NEW."locationId") OR (NEW."locationId" IS NULL AND "locationId" IS NULL))
        AND (("shelfId" = NEW."shelfId") OR (NEW."shelfId" IS NULL AND "shelfId" IS NULL))
    ) THEN
      -- Update existing row
      UPDATE "itemInventory"
      
      SET "quantityOnSalesOrder" = "quantityOnSalesOrder" - (NEW."quantitySent" - OLD."quantitySent")
      WHERE "itemId" = NEW."itemId"
        AND "companyId" = NEW."companyId"
        AND (("locationId" = NEW."locationId") OR (NEW."locationId" IS NULL AND "locationId" IS NULL))
        AND (("shelfId" = NEW."shelfId") OR (NEW."shelfId" IS NULL AND "shelfId" IS NULL));
    ELSE
      -- Insert new row
      INSERT INTO "itemInventory" ("itemId", "locationId", "shelfId", "companyId", "quantityOnSalesOrder")
      VALUES (
        NEW."itemId",
        NEW."locationId",
        NEW."shelfId",
        NEW."companyId",
        NEW."quantitySent"
      );
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create trigger on salesOrderLine
CREATE TRIGGER update_inventory_quantity_on_sales_order_line_trigger
AFTER UPDATE OF "quantitySent" ON "salesOrderLine"
FOR EACH ROW
EXECUTE FUNCTION update_inventory_quantity_on_sales_order_line();



ALTER TABLE "pickMethod" DROP CONSTRAINT IF EXISTS "pickMethod_shelfId_fkey";
ALTER TABLE "purchaseOrderLine" DROP CONSTRAINT IF EXISTS "purchaseOrderLine_shelfId_fkey";
ALTER TABLE "itemLedger" DROP CONSTRAINT IF EXISTS "itemLedger_shelfId_fkey";
ALTER TABLE "receiptLine" DROP CONSTRAINT IF EXISTS "receiptLine_shelfId_fkey";
ALTER TABLE "purchaseInvoiceLine" DROP CONSTRAINT IF EXISTS "purchaseInvoiceLines_shelfId_fkey";
ALTER TABLE "salesOrderLine" DROP CONSTRAINT IF EXISTS "salesOrderLine_shelfId_fkey";
ALTER TABLE "itemInventory" DROP CONSTRAINT IF EXISTS "itemInventory_shelfId_fkey";

-- Drop the existing primary key constraint
ALTER TABLE "shelf" DROP CONSTRAINT IF EXISTS "shelf_pkey";

-- Add the 'id' column as the new primary key
ALTER TABLE "shelf" ADD COLUMN IF NOT EXISTS "id" TEXT NOT NULL DEFAULT xid();
ALTER TABLE "shelf" ADD PRIMARY KEY ("id");

-- Add the 'name' column
ALTER TABLE "shelf" ADD COLUMN IF NOT EXISTS "name" TEXT NOT NULL;

-- Add a unique constraint for name and locationId
ALTER TABLE "shelf" ADD CONSTRAINT "shelf_name_locationId_key" UNIQUE ("name", "locationId");

-- Add back the foreign key constraints
ALTER TABLE "pickMethod" ADD CONSTRAINT "pickMethod_shelfId_fkey" FOREIGN KEY ("defaultShelfId") REFERENCES "shelf"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "purchaseOrderLine" ADD CONSTRAINT "purchaseOrderLine_shelfId_fkey" FOREIGN KEY ("shelfId") REFERENCES "shelf"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "itemLedger" ADD CONSTRAINT "itemLedger_shelfId_fkey" FOREIGN KEY ("shelfId") REFERENCES "shelf"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "receiptLine" ADD CONSTRAINT "receiptLine_shelfId_fkey" FOREIGN KEY ("shelfId") REFERENCES "shelf"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "purchaseInvoiceLine" ADD CONSTRAINT "purchaseInvoiceLines_shelfId_fkey" FOREIGN KEY ("shelfId") REFERENCES "shelf"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "salesOrderLine" ADD CONSTRAINT "salesOrderLine_shelfId_fkey" FOREIGN KEY ("shelfId") REFERENCES "shelf"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "itemInventory" ADD CONSTRAINT "itemInventory_shelfId_fkey" FOREIGN KEY ("shelfId") REFERENCES "shelf"("id") ON DELETE SET NULL ON UPDATE CASCADE;



DROP VIEW IF EXISTS "itemQuantities";

CREATE INDEX IF NOT EXISTS "item_itemTrackingType_idx" ON "item" ("itemTrackingType");

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
    COALESCE(inv."quantityOnHand", 0) AS "quantityOnHand",
    COALESCE(inv."quantityOnPurchase", 0) AS "quantityOnPurchaseOrder",
    COALESCE(inv."quantityOnSalesOrder", 0) AS "quantityOnSalesOrder",
    COALESCE(inv."quantityOnProductionOrder", 0) AS "quantityOnProdOrder",
    COALESCE(inv."quantityOnHand", 0) - 
      COALESCE(inv."quantityOnSalesOrder", 0) - 
      COALESCE(inv."quantityOnProductionOrder", 0) AS "quantityAvailable",
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
    m."thumbnailPath",
    loc."name" AS "locationName",
    i."unitOfMeasureCode"
  FROM "item" i
  CROSS JOIN (SELECT * FROM "location" WHERE "id" = location_id) loc
  LEFT JOIN "itemInventory" inv ON i."id" = inv."itemId" AND loc."id" = inv."locationId"
  LEFT JOIN "material" mat ON i."id" = mat."itemId"
  LEFT JOIN "modelUpload" m ON m."id" = i."modelUploadId"
  WHERE i."itemTrackingType" = 'Inventory';
END;
$$ LANGUAGE plpgsql SECURITY INVOKER;


ALTER TABLE "itemLedger" ADD COLUMN "createdBy" TEXT REFERENCES "user"("id");
-- Set default value for createdBy column to 'system' for existing rows
UPDATE "itemLedger" SET "createdBy" = 'system' WHERE "createdBy" IS NULL;

-- Make createdBy column NOT NULL
ALTER TABLE "itemLedger" ALTER COLUMN "createdBy" SET NOT NULL;

-- Set default value for createdBy column to 'system' for new rows
ALTER TABLE "itemLedger" ALTER COLUMN "createdBy" SET DEFAULT 'system';
