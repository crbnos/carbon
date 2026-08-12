-- Purchasing stored tax AMOUNTS and derived the RATE via a GENERATED column
-- (rate = amount / subtotal), making the rate a lossy echo of a cents-rounded
-- amount. DROP EXPRESSION converts each column to plain writable IN PLACE:
-- values are already materialized -> catalog-only, no backfill, no view drops.
ALTER TABLE "purchaseOrderLine" ALTER COLUMN "taxPercent" DROP EXPRESSION IF EXISTS;
ALTER TABLE "purchaseOrderLine" ALTER COLUMN "taxPercent" SET DEFAULT 0;

ALTER TABLE "purchaseInvoiceLine" ALTER COLUMN "taxPercent" DROP EXPRESSION IF EXISTS;
ALTER TABLE "purchaseInvoiceLine" ALTER COLUMN "taxPercent" SET DEFAULT 0;

ALTER TABLE "supplierQuoteLinePrice" ALTER COLUMN "taxPercent" DROP EXPRESSION IF EXISTS;
ALTER TABLE "supplierQuoteLinePrice" ALTER COLUMN "taxPercent" SET DEFAULT 0;
