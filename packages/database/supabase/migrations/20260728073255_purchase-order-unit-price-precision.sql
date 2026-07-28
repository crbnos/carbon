-- Per-company decimal precision for the Purchase Order line Unit Price input.
-- purchaseOrderLine.supplierUnitPrice is stored as an unconstrained NUMERIC, but
-- the PO line form's currency-styled NumberControlled rounds committed input to
-- Intl.NumberFormat's currency default (2 dp for USD/EUR/CAD). Some suppliers
-- quote extended precision (3-4 dp); this setting lets a company raise the input
-- precision so the entered price is preserved exactly.
--
-- Default 2 preserves the existing rounding behavior. Mirrors the quoteLine
-- unitPricePrecision precedent (2/3/4), but at the company level like the other
-- purchasing settings on companySettings.
ALTER TABLE "companySettings"
  ADD COLUMN IF NOT EXISTS "purchaseOrderUnitPricePrecision" INTEGER NOT NULL DEFAULT 2
  CHECK ("purchaseOrderUnitPricePrecision" IN (2, 3, 4));
