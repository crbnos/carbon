-- Per-line override of the item-level tracking type (Inventory vs Non-Inventory).
-- Mirrors the replenishment/method/sourcing per-line overrides added in
-- 20260721164847_method-material-line-overrides.sql: an effective column that
-- stays NOT NULL plus an *Overridden flag that gates the item->line cascade and
-- the upsertMethodMaterial re-derive so a deliberate per-line edit is not
-- re-stomped when the item default later changes.
--
-- Scope note: the per-line override only flips Inventory <-> Non-Inventory. For
-- Serial/Batch items the effective column always mirrors the item and the flag
-- stays false (the BoM editor hides the control). requiresSerial/BatchTracking on
-- jobMaterial keeps deriving from the item, so tracked-entity handling is
-- unaffected. The effective column is consumed at job consumption time (the issue
-- edge function) to decide whether a stock ledger entry is written.

ALTER TABLE "methodMaterial"
  ADD COLUMN IF NOT EXISTS "itemTrackingType" "itemTrackingType"
    NOT NULL DEFAULT 'Inventory';

ALTER TABLE "methodMaterial"
  ADD COLUMN IF NOT EXISTS "itemTrackingTypeOverridden" BOOLEAN
    NOT NULL DEFAULT false;

-- Backfill itemTrackingType from the component item. Existing rows are read-only
-- mirrors of the item today, so every flag stays false (no prior overrides),
-- which is correct.
UPDATE "methodMaterial" mm
SET "itemTrackingType" = i."itemTrackingType"
FROM "item" i
WHERE i."id" = mm."itemId"
  AND i."companyId" = mm."companyId"
  AND mm."itemTrackingType" IS DISTINCT FROM i."itemTrackingType";
