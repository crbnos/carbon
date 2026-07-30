-- Single owner for the "inherit unless overridden" invariant on INSERT, plus
-- the tracking-override guard on both INSERT and UPDATE.
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
--
-- The tracking override is only valid between Inventory and Non-Inventory: a
-- Serial/Batch component must mirror the item (the BoM editor hides the
-- control), and a line can never be made Serial/Batch on its own. The app layer
-- honors this, but a direct write (API/MCP upsert) could set
-- "itemTrackingTypeOverridden" = true with a value the issue function would act
-- on — e.g. a Serial component treated as Non-Inventory, skipping its stock
-- ledger entry. So the function clamps illegal tracking overrides (clamp, not
-- reject: pre-existing insert paths rely on this trigger to fix their values)
-- and a second, narrow BEFORE UPDATE OF trigger applies the same clamp on
-- edits. The UPDATE path stops at the clamp — upsertMethodMaterial re-derives
-- mirrors on edit, and re-syncing here would touch lines on frozen
-- (Active/Archived) methods as a side effect of unrelated edits.

CREATE OR REPLACE FUNCTION public.method_material_inherit_item_defaults()
RETURNS TRIGGER AS $$
DECLARE
  v_item RECORD;
BEGIN
  IF NEW."itemId" IS NULL THEN
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

  -- Tracking-override guard: overrides are only valid between Inventory and
  -- Non-Inventory. Runs on both INSERT and UPDATE.
  IF v_item."itemTrackingType" IN ('Serial', 'Batch')
     OR NEW."itemTrackingType" IN ('Serial', 'Batch') THEN
    NEW."itemTrackingType" := v_item."itemTrackingType";
    NEW."itemTrackingTypeOverridden" := false;
  END IF;

  IF TG_OP = 'UPDATE' THEN
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

-- Narrow UPDATE trigger: only fires when the tracking columns are written, so
-- unrelated edits on frozen (Active/Archived) methods never re-sync anything.
DROP TRIGGER IF EXISTS "methodMaterialTrackingOverrideGuard" ON "methodMaterial";
CREATE TRIGGER "methodMaterialTrackingOverrideGuard"
  BEFORE UPDATE OF "itemTrackingType", "itemTrackingTypeOverridden" ON "methodMaterial"
  FOR EACH ROW
  EXECUTE FUNCTION public.method_material_inherit_item_defaults();

-- Repair rows already written by the pre-trigger insert paths. Tracking type
-- re-syncs on every method status (no interlock, live-mirror semantics — the
-- issue function used to read the live item), and any illegal override (flag
-- set on a Serial/Batch component, or a line claiming Serial/Batch) is reset
-- to inherit. sourcingType/replenishmentSystem re-sync Draft methods only:
-- they are interlocked with the Draft-gated methodType, and updating them on a
-- frozen method would create pairs getValidMethodTypes forbids. Legal
-- overridden fields are untouched.
UPDATE "methodMaterial" mm
SET "itemTrackingType" = i."itemTrackingType",
    "itemTrackingTypeOverridden" = mm."itemTrackingTypeOverridden"
      AND i."itemTrackingType" NOT IN ('Serial', 'Batch')
      AND mm."itemTrackingType" NOT IN ('Serial', 'Batch')
FROM "item" i
WHERE i."id" = mm."itemId"
  AND i."companyId" = mm."companyId"
  AND (
    (NOT mm."itemTrackingTypeOverridden" AND mm."itemTrackingType" IS DISTINCT FROM i."itemTrackingType") OR
    (mm."itemTrackingTypeOverridden" AND (i."itemTrackingType" IN ('Serial', 'Batch') OR mm."itemTrackingType" IN ('Serial', 'Batch')))
  );

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
