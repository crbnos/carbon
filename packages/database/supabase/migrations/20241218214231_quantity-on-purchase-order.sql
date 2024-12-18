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
      SET "quantityOnPurchase" = "quantityOnPurchase" - ((NEW."quantityReceived" * COALESCE(NEW."conversionFactor", 1)) - (OLD."quantityReceived" * COALESCE(OLD."conversionFactor", 1)))
      WHERE "itemId" = NEW."itemId"
        AND "companyId" = NEW."companyId"
        AND (("locationId" = NEW."locationId") OR (NEW."locationId" IS NULL AND "locationId" IS NULL))
        AND (("shelfId" = NEW."shelfId") OR (NEW."shelfId" IS NULL AND "shelfId" IS NULL));
    ELSE
      -- Insert new row
      INSERT INTO "itemInventory" ("itemId", "locationId", "shelfId", "companyId", "quantityOnPurchase")
      VALUES (NEW."itemId", NEW."locationId", NEW."shelfId", NEW."companyId", NEW."quantityToReceive" * COALESCE(NEW."conversionFactor", 1));
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

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
        SET "quantityOnPurchase" = "quantityOnPurchase" + (line."quantityToReceive" * COALESCE(line."conversionFactor", 1)) - (COALESCE(line."quantityReceived", 0) * COALESCE(line."conversionFactor", 1))
        WHERE "itemId" = line."itemId"
          AND "companyId" = line."companyId"
          AND (("locationId" = line."locationId") OR (line."locationId" IS NULL AND "locationId" IS NULL))
          AND (("shelfId" = line."shelfId") OR (line."shelfId" IS NULL AND "shelfId" IS NULL));
      ELSE
        -- Insert new row
        INSERT INTO "itemInventory" ("itemId", "locationId", "shelfId", "companyId", "quantityOnPurchase")
        VALUES (line."itemId", line."locationId", line."shelfId", line."companyId", (line."quantityToReceive" * COALESCE(line."conversionFactor", 1)) - (COALESCE(line."quantityReceived", 0) * COALESCE(line."conversionFactor", 1)));
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
        SET "quantityOnPurchase" = "quantityOnPurchase" - (line."quantityToReceive" * COALESCE(line."conversionFactor", 1)) - (COALESCE(line."quantityReceived", 0) * COALESCE(line."conversionFactor", 1))
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