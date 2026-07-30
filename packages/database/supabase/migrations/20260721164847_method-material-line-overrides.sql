-- Per-line overrides of the item-level replenishment/method/sourcing defaults.
-- The effective columns (methodType, sourcingType, replenishmentSystem) stay
-- NOT NULL and are what downstream consumers (get_method_tree, MRP) read. The
-- *Overridden flags gate the item->line cascade so a deliberate per-line edit
-- is not re-stomped when the item default later changes.

ALTER TABLE "methodMaterial"
  ADD COLUMN IF NOT EXISTS "replenishmentSystem" "itemReplenishmentSystem"
    NOT NULL DEFAULT 'Buy';

ALTER TABLE "methodMaterial"
  ADD COLUMN IF NOT EXISTS "replenishmentSystemOverridden" BOOLEAN
    NOT NULL DEFAULT false;

ALTER TABLE "methodMaterial"
  ADD COLUMN IF NOT EXISTS "methodTypeOverridden" BOOLEAN
    NOT NULL DEFAULT false;

ALTER TABLE "methodMaterial"
  ADD COLUMN IF NOT EXISTS "sourcingTypeOverridden" BOOLEAN
    NOT NULL DEFAULT false;

-- Backfill replenishmentSystem from the component item. Existing rows are all
-- read-only mirrors of the item today, so every flag stays false (no prior
-- overrides exist), which is correct.
UPDATE "methodMaterial" mm
SET "replenishmentSystem" = i."replenishmentSystem"
FROM "item" i
WHERE i."id" = mm."itemId"
  AND i."companyId" = mm."companyId"
  AND mm."replenishmentSystem" IS DISTINCT FROM i."replenishmentSystem";
