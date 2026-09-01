-- salesInvoice was the only rate-bearing document header with no cascade to its
-- lines. quote and salesOrder propagate via event interceptors; purchaseOrder,
-- purchaseInvoice and supplierQuote via AFTER UPDATE OF triggers. salesInvoice
-- had neither, so refreshing the rate or changing the currency moved the header
-- alone and left salesInvoiceLine -- and every converted* column generated off
-- it -- at whatever rate was current when each line was created.
--
-- The invoice then carries two rates for one currency: the PDF sums lines at the
-- line rate and header shipping at the header rate, printing a total that exists
-- at no exchange rate.
--
-- This mirrors the purchaseInvoice pair exactly (20241210214820, 20260616061244)
-- so the two invoice sides behave identically.

-- 1. Backfill lines that have already drifted from their header.
UPDATE "salesInvoiceLine" sl
SET "exchangeRate" = si."exchangeRate",
    "updatedBy" = COALESCE(si."updatedBy", 'system'),
    "updatedAt" = NOW()
FROM "salesInvoice" si
WHERE sl."invoiceId" = si."id"
  AND (sl."exchangeRate" IS DISTINCT FROM si."exchangeRate" OR sl."exchangeRate" IS NULL);

-- 2. Cascade a header rate change down to the lines.
CREATE OR REPLACE FUNCTION update_sales_invoice_line_exchange_rate()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE "salesInvoiceLine"
  SET "exchangeRate" = NEW."exchangeRate"
  WHERE "invoiceId" = NEW."id";

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS update_sales_invoice_line_exchange_rate_trigger ON "salesInvoice";
CREATE TRIGGER update_sales_invoice_line_exchange_rate_trigger
AFTER UPDATE OF "exchangeRate" ON "salesInvoice"
FOR EACH ROW
WHEN (OLD."exchangeRate" IS DISTINCT FROM NEW."exchangeRate")
EXECUTE FUNCTION update_sales_invoice_line_exchange_rate();

-- 3. A new line inherits the header's rate, so it cannot be stranded at the
--    DEFAULT of 1 when the client fails to pass one.
CREATE OR REPLACE FUNCTION sync_sales_invoice_line_exchange_rate_on_insert()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW."exchangeRate" IS NULL OR NEW."exchangeRate" = 1 THEN
    SELECT "exchangeRate" INTO NEW."exchangeRate"
    FROM "salesInvoice"
    WHERE "id" = NEW."invoiceId";
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS sales_invoice_line_exchange_rate_insert_trigger ON "salesInvoiceLine";
CREATE TRIGGER sales_invoice_line_exchange_rate_insert_trigger
BEFORE INSERT ON "salesInvoiceLine"
FOR EACH ROW
EXECUTE FUNCTION sync_sales_invoice_line_exchange_rate_on_insert();
