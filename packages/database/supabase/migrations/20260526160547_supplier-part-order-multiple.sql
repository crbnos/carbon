-- Supplier order multiple: the pack/case quantity a supplier requires you to
-- order in (e.g., order in multiples of 25). Mirrors the nullable
-- "minimumOrderQuantity" column already on supplierPart, and matches the
-- "orderMultiple" naming used on itemPlanning.
ALTER TABLE "supplierPart"
  ADD COLUMN IF NOT EXISTS "orderMultiple" INTEGER DEFAULT 1;
