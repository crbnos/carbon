-- Company-level default number of decimal places for purchase order unit prices.
-- Mirrors the per-line quoteLine.unitPricePrecision pattern, but applied
-- company-wide to purchasing. Suppliers often quote 3-5 decimal places (metals
-- trading, high-precision manufacturing); this lets a company preserve that
-- precision instead of silently rounding PO unit prices to 2 decimals.
-- Default 5 preserves the behavior shipped in #1203.
ALTER TABLE "companySettings"
ADD COLUMN IF NOT EXISTS "purchaseOrderUnitPricePrecision" INTEGER NOT NULL DEFAULT 5
CHECK ("purchaseOrderUnitPricePrecision" IN (2, 3, 4, 5));
