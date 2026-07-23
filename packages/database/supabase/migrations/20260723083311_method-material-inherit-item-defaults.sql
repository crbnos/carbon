-- Single owner for the "inherit unless overridden" invariant on INSERT.
--
-- methodMaterial's mirror columns (sourcingType, replenishmentSystem,
-- itemTrackingType) must equal the component item's values unless the matching
-- *Overridden flag is set. upsertMethodMaterial enforces this for UI writes,
-- but several other writers insert methodMaterial rows with explicit column
-- lists that predate these columns (get-method job->item / quote->item
-- copy-backs, import-csv), leaving the mirrors at their DB defaults — e.g. a
-- Serial or Non-Inventory component's line claiming 'Inventory', which the
-- issue function would then act on (wrong stock ledger behavior).
--
-- This BEFORE INSERT trigger fills any unflagged mirror field from the item so
-- every insert path is correct by construction. methodType is deliberately NOT
-- touched: on copy-backs it encodes tree structure (a Make to Order line owns a
-- sub-method via materialMakeMethodId), so it is writer-owned, not a mirror.
-- UPDATE paths are also untouched: upsertMethodMaterial re-derives on edit, and
-- the item->line cascades already guard per-field; an UPDATE trigger would
-- re-sync lines on frozen (Active/Archived) methods as a side effect of
-- unrelated edits.

CREATE OR REPLACE FUNCTION public.method_material_inherit_item_defaults()
RETURNS TRIGGER AS $$
DECLARE
  v_item RECORD;
BEGIN
  IF NEW."itemId" IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW."sourcingTypeOverridden"
     AND NEW."replenishmentSystemOverridden"
     AND NEW."itemTrackingTypeOverridden" THEN
    RETURN NEW;
  END IF;

  SELECT "sourcingType", "replenishmentSystem", "itemTrackingType"
    INTO v_item
    FROM "item"
   WHERE "id" = NEW."itemId"
     AND "companyId" = NEW."companyId";

  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  IF NOT NEW."sourcingTypeOverridden" THEN
    NEW."sourcingType" := v_item."sourcingType";
  END IF;
  IF NOT NEW."replenishmentSystemOverridden" THEN
    NEW."replenishmentSystem" := v_item."replenishmentSystem";
  END IF;
  IF NOT NEW."itemTrackingTypeOverridden" THEN
    NEW."itemTrackingType" := v_item."itemTrackingType";
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "methodMaterialInheritItemDefaults" ON "methodMaterial";
CREATE TRIGGER "methodMaterialInheritItemDefaults"
  BEFORE INSERT ON "methodMaterial"
  FOR EACH ROW
  EXECUTE FUNCTION public.method_material_inherit_item_defaults();

-- Repair rows already written by the pre-trigger insert paths. Tracking type
-- re-syncs on every method status (no interlock, live-mirror semantics — the
-- issue function used to read the live item). sourcingType/replenishmentSystem
-- re-sync Draft methods only: they are interlocked with the Draft-gated
-- methodType, and updating them on a frozen method would create pairs
-- getValidMethodTypes forbids. Overridden fields are untouched.
UPDATE "methodMaterial" mm
SET "itemTrackingType" = i."itemTrackingType"
FROM "item" i
WHERE i."id" = mm."itemId"
  AND i."companyId" = mm."companyId"
  AND NOT mm."itemTrackingTypeOverridden"
  AND mm."itemTrackingType" IS DISTINCT FROM i."itemTrackingType";

UPDATE "methodMaterial" mm
SET "sourcingType" = CASE WHEN mm."sourcingTypeOverridden" THEN mm."sourcingType" ELSE i."sourcingType" END,
    "replenishmentSystem" = CASE WHEN mm."replenishmentSystemOverridden" THEN mm."replenishmentSystem" ELSE i."replenishmentSystem" END
FROM "item" i
WHERE i."id" = mm."itemId"
  AND i."companyId" = mm."companyId"
  AND mm."makeMethodId" IN (
    SELECT "id" FROM "makeMethod" WHERE "status" = 'Draft'
  )
  AND (
    (NOT mm."sourcingTypeOverridden" AND mm."sourcingType" IS DISTINCT FROM i."sourcingType") OR
    (NOT mm."replenishmentSystemOverridden" AND mm."replenishmentSystem" IS DISTINCT FROM i."replenishmentSystem")
  );
