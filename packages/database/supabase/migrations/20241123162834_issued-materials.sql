ALTER TABLE "jobMaterial"
  ADD COLUMN "defaultShelf" BOOLEAN DEFAULT TRUE,
  ADD COLUMN "shelfId" TEXT REFERENCES "shelf"("id") ON DELETE SET NULL;


ALTER TABLE "jobMaterial"
  ADD COLUMN "quantityIssued" NUMERIC(10, 4) DEFAULT 0,
  ADD COLUMN "quantityToIssue" NUMERIC(9, 2) GENERATED ALWAYS AS (
    GREATEST(("estimatedQuantity" - "quantityIssued"), 0)
  ) STORED;

ALTER TYPE "itemLedgerDocumentType" ADD VALUE 'Job Consumption';


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
    SET "quantityOnHand" = "quantityOnHand" + NEW."quantity"
    WHERE "itemId" = NEW."itemId"
      AND "companyId" = NEW."companyId"
      AND (("locationId" = NEW."locationId") OR (NEW."locationId" IS NULL AND "locationId" IS NULL))
      AND (("shelfId" = NEW."shelfId") OR (NEW."shelfId" IS NULL AND "shelfId" IS NULL));
  ELSE
    -- Insert new row
    INSERT INTO "itemInventory" ("itemId", "locationId", "shelfId", "companyId", "quantityOnHand")
    VALUES (NEW."itemId", NEW."locationId", NEW."shelfId", NEW."companyId", NEW."quantity");
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

ALTER TABLE "itemLedger" ADD COLUMN "documentLineId" TEXT;
