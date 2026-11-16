-- A constant default is a catalog-only change: no table rewrite.
ALTER TABLE "companySettings"
ADD COLUMN IF NOT EXISTS "receiptBatchNumbersFromPurchaseOrder" BOOLEAN NOT NULL DEFAULT true;
