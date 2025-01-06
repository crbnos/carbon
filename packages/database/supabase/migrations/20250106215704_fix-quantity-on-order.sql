DROP VIEW IF EXISTS "itemQuantities";

-- remove the use of a cross join
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
  WHERE i."itemTrackingType" = 'Inventory'
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
  ELSIF (NEW.status = 'Draft' OR NEW.status = 'Closed' OR NEW.status = 'Cancelled' OR NEW.status = 'Completed') THEN
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

-- First, update quantityOnSalesOrder for all completed sales orders
WITH completed_order_lines AS (
  SELECT 
    sol."itemId",
    sol."companyId", 
    sol."locationId",
    sol."shelfId",
    sol."quantityToSend"
  FROM "salesOrder" so
  INNER JOIN "salesOrderLine" sol ON so."id" = sol."salesOrderId"
  WHERE so."status" = 'Completed'
)
UPDATE "itemInventory" ii
SET "quantityOnSalesOrder" = ii."quantityOnSalesOrder" - col."quantityToSend"
FROM completed_order_lines col
WHERE ii."itemId" = col."itemId"
  AND ii."companyId" = col."companyId"
  AND ((ii."locationId" = col."locationId") OR (col."locationId" IS NULL AND ii."locationId" IS NULL))
  AND ((ii."shelfId" = col."shelfId") OR (col."shelfId" IS NULL AND ii."shelfId" IS NULL));

-- Then set any negative quantityOnSalesOrder to 0
UPDATE "itemInventory"
SET "quantityOnSalesOrder" = 0
WHERE "quantityOnSalesOrder" < 0;
