-- =============================================================================
-- Convert legacy item triggers to event system interceptors.
--
-- Both are AFTER INSERT -> after_sync_functions:
--   sync_create_item_related_records:
--     Looks up company baseCurrencyCode, then inserts itemCost (FIFO),
--     itemReplenishment, itemUnitSalePrice, and itemPlanning per location.
--   sync_create_make_method_related_records:
--     Inserts a makeMethod row only for Part and Tool item types.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- Item interceptor functions
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION sync_create_item_related_records(
  p_table TEXT,
  p_operation TEXT,
  p_new JSONB,
  p_old JSONB
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  base_currency TEXT;
BEGIN
  IF p_operation != 'INSERT' THEN RETURN; END IF;

  SELECT "baseCurrencyCode" INTO base_currency
  FROM "company"
  WHERE "id" = p_new->>'companyId';

  INSERT INTO "itemCost"("itemId", "costingMethod", "createdBy", "companyId")
  VALUES (p_new->>'id', 'FIFO', p_new->>'createdBy', p_new->>'companyId');

  INSERT INTO "itemReplenishment"("itemId", "createdBy", "companyId")
  VALUES (p_new->>'id', p_new->>'createdBy', p_new->>'companyId');

  INSERT INTO "itemUnitSalePrice"("itemId", "currencyCode", "createdBy", "companyId")
  VALUES (p_new->>'id', COALESCE(base_currency, 'USD'), p_new->>'createdBy', p_new->>'companyId');

  -- Insert itemPlanning records for each location in the company
  INSERT INTO "itemPlanning"("itemId", "locationId", "createdBy", "companyId")
  SELECT
    p_new->>'id',
    l.id,
    p_new->>'createdBy',
    p_new->>'companyId'
  FROM "location" l
  WHERE l."companyId" = p_new->>'companyId';
END;
$$;

CREATE OR REPLACE FUNCTION sync_create_make_method_related_records(
  p_table TEXT,
  p_operation TEXT,
  p_new JSONB,
  p_old JSONB
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF p_operation != 'INSERT' THEN RETURN; END IF;

  IF (p_new->>'type') IN ('Part', 'Tool') THEN
    INSERT INTO "makeMethod"("itemId", "createdBy", "companyId")
    VALUES (p_new->>'id', p_new->>'createdBy', p_new->>'companyId');
  END IF;
END;
$$;


-- -----------------------------------------------------------------------------
-- Drop legacy triggers
-- -----------------------------------------------------------------------------

DROP TRIGGER IF EXISTS create_item_related_records ON "item";
DROP TRIGGER IF EXISTS create_make_method_related_records ON "item";


-- -----------------------------------------------------------------------------
-- Attach event triggers with interceptor arrays
-- -----------------------------------------------------------------------------

SELECT attach_event_trigger('item',
  ARRAY[]::TEXT[],
  ARRAY['sync_create_item_related_records', 'sync_create_make_method_related_records']::TEXT[]
);
