-- Per-company opt-in for showing the supplier/customer readableId in the UI.
-- Default OFF: companies that don't want the extra column / form field /
-- dropdown prefix don't see them. The underlying data (readableId column,
-- trigger, sequences) keeps working the same regardless — this only gates
-- visibility in tables, forms, and the multi-select dropdowns.

ALTER TABLE "companySettings"
  ADD COLUMN IF NOT EXISTS "showSupplierReadableId" BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE "companySettings"
  ADD COLUMN IF NOT EXISTS "showCustomerReadableId" BOOLEAN NOT NULL DEFAULT FALSE;
