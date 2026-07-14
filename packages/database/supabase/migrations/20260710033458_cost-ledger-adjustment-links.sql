-- Layer cost adjustments are child rows pointing at the layer they adjust
-- (inventory-valuation spec decision #11: never mutate a posted layer's cost).
ALTER TABLE "costLedger"
  ADD COLUMN IF NOT EXISTS "appliesToCostLedgerId" TEXT;

CREATE INDEX IF NOT EXISTS "costLedger_appliesToCostLedgerId_idx"
  ON "costLedger" ("appliesToCostLedgerId")
  WHERE "appliesToCostLedgerId" IS NOT NULL;

-- 'Purchase Order' costLedger rows are planning/cost-history artifacts written at PO
-- finalization (update-purchased-prices), not real inventory layers. Make them
-- non-consumable so FIFO/LIFO never eats stock that hasn't been received.
UPDATE "costLedger"
SET "remainingQuantity" = 0
WHERE "documentType" = 'Purchase Order'
  AND "remainingQuantity" IS DISTINCT FROM 0;
