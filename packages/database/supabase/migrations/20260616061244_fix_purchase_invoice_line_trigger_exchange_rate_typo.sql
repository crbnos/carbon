-- Fix typo in update_purchase_invoice_line_price_exchange_rate trigger function where it tried to update purchaseInvoiceLine using column purchaseInvoiceId instead of invoiceId
CREATE OR REPLACE FUNCTION update_purchase_invoice_line_price_exchange_rate()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE "purchaseInvoiceLine"
  SET "exchangeRate" = NEW."exchangeRate",
      "updatedBy" = COALESCE(NEW."updatedBy", 'system'),
      "updatedAt" = NOW()
  WHERE "invoiceId" = NEW."id";

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Fix existing purchaseInvoiceLine records that were not updated due to the trigger bug.
-- NOTE: updatedBy must be set to avoid NOT NULL violation in the purchaseInvoicePriceChange
-- event interceptor (sync_purchase_invoice_line_price_change) which fires on unitPrice change.
UPDATE "purchaseInvoiceLine" pl
SET "exchangeRate" = pi."exchangeRate",
    "updatedBy" = COALESCE(pi."updatedBy", 'system'),
    "updatedAt" = NOW()
FROM "purchaseInvoice" pi
WHERE pl."invoiceId" = pi."id" AND (pl."exchangeRate" IS DISTINCT FROM pi."exchangeRate" OR pl."exchangeRate" IS NULL);

-- Add a BEFORE INSERT trigger to ensure new lines always inherit the parent's exchange rate
-- This prevents lines from being stuck at exchangeRate = 1 if the client fails to pass it correctly.
CREATE OR REPLACE FUNCTION sync_purchase_invoice_line_exchange_rate_on_insert()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW."exchangeRate" IS NULL OR NEW."exchangeRate" = 1 THEN
    SELECT "exchangeRate" INTO NEW."exchangeRate"
    FROM "purchaseInvoice"
    WHERE "id" = NEW."invoiceId";
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS purchase_invoice_line_exchange_rate_insert_trigger ON "purchaseInvoiceLine";
CREATE TRIGGER purchase_invoice_line_exchange_rate_insert_trigger
BEFORE INSERT ON "purchaseInvoiceLine"
FOR EACH ROW
EXECUTE FUNCTION sync_purchase_invoice_line_exchange_rate_on_insert();

-- NOTE: This migration previously also recreated the "purchaseOrders" and "purchaseInvoices"
-- views (to divide supplierShippingCost by exchangeRate). That section was removed: it is
-- backdated relative to the already-applied 20260630 invoice batch (20260630095023 drops the
-- purchaseInvoice."balance" column and 20260630151500 is the current view definition), so
-- recreating the view here fails with `column pi.balance does not exist` and is fully
-- superseded regardless. See the shippingCost/exchangeRate note flagged in the PR.
