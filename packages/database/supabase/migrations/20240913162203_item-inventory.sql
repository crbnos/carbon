

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
        SET "quantityOnPurchase" = "quantityOnPurchase" + line."quantityToReceive"
        WHERE "itemId" = line."itemId"
          AND "companyId" = line."companyId"
          AND (("locationId" = line."locationId") OR (line."locationId" IS NULL AND "locationId" IS NULL))
          AND (("shelfId" = line."shelfId") OR (line."shelfId" IS NULL AND "shelfId" IS NULL));
      ELSE
        -- Insert new row
        INSERT INTO "itemInventory" ("itemId", "locationId", "shelfId", "companyId", "quantityOnPurchase")
        VALUES (line."itemId", line."locationId", line."shelfId", line."companyId", line."quantityToReceive");
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
        SET "quantityOnPurchase" = "quantityOnPurchase" - line."quantityToReceive"
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
      SET "quantityOnPurchase" = "quantityOnPurchase" + (NEW."quantityReceived" - OLD."quantityReceived")
      WHERE "itemId" = NEW."itemId"
        AND "companyId" = NEW."companyId"
        AND (("locationId" = NEW."locationId") OR (NEW."locationId" IS NULL AND "locationId" IS NULL))
        AND (("shelfId" = NEW."shelfId") OR (NEW."shelfId" IS NULL AND "shelfId" IS NULL));
    ELSE
      -- Insert new row
      INSERT INTO "itemInventory" ("itemId", "locationId", "shelfId", "companyId", "quantityOnPurchase")
      VALUES (NEW."itemId", NEW."locationId", NEW."shelfId", NEW."companyId", NEW."quantityReceived");
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

-- Drop the existing view
DROP VIEW IF EXISTS "itemQuantities";

-- Create the new view
CREATE OR REPLACE VIEW "itemQuantities" AS 
SELECT 
  i."id" AS "itemId",
  i."companyId",
  inv."locationId",
  COALESCE(SUM(inv."quantityOnHand"), 0) AS "quantityOnHand",
  COALESCE(SUM(inv."quantityOnPurchase"), 0) AS "quantityOnPurchaseOrder",
  COALESCE(SUM(inv."quantityOnSalesOrder"), 0) AS "quantityOnSalesOrder",
  COALESCE(SUM(inv."quantityOnProductionOrder"), 0) AS "quantityOnProdOrder",
  COALESCE(SUM(inv."quantityOnHand"), 0) - 
    COALESCE(SUM(inv."quantityOnSalesOrder"), 0) - 
    COALESCE(SUM(inv."quantityOnProductionOrder"), 0) AS "quantityAvailable",
  i."readableId",
  i."type",
  i."name",
  i."active",
  i."itemTrackingType",
  m."thumbnailPath",
  l."name" AS "locationName"
FROM "item" i
LEFT JOIN "itemInventory" inv ON i."id" = inv."itemId"
LEFT JOIN "location" l ON inv."locationId" = l."id"
LEFT JOIN "modelUpload" m ON m."id" = i."modelUploadId"
GROUP BY 
  i."id",
  i."companyId",
  inv."locationId",
  i."readableId",
  i."type",
  i."name",
  i."active",
  i."itemTrackingType",
  m."thumbnailPath",
  l."name";


