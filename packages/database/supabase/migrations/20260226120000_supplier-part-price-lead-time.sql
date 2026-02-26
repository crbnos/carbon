-- Add lead time column to supplierPartPrice
-- Matches the NUMERIC(10,5) type used in supplierQuoteLinePrice.leadTime

ALTER TABLE "supplierPartPrice"
ADD COLUMN IF NOT EXISTS "leadTime" NUMERIC(10, 5) NOT NULL DEFAULT 0;
