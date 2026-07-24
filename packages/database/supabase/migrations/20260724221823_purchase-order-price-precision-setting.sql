ALTER TABLE "companySettings"
ADD COLUMN IF NOT EXISTS "purchaseOrderPricePrecision" INTEGER NOT NULL DEFAULT 2 CHECK ("purchaseOrderPricePrecision" IN (2, 3, 4));
