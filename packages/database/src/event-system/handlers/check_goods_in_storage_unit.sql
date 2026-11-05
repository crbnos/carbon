CREATE OR REPLACE FUNCTION public.check_goods_in_storage_unit(p_table text, p_operation text, p_new jsonb, p_old jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions'
AS $function$
-- Goods-in inspection hold (spec .ai/specs/2026-11-03-goods-in-inspection-hold.md).
-- A location's inspection and rejected storage units stay active and
-- non-nettable: held stock in a nettable unit would be offered to MRP and
-- picking, and an inactive unit cannot be picked for a receipt line. Every
-- change of effectiveNettable is written by util.refresh_storage_unit_nettable
-- as an UPDATE of the unit, so a change of the unit's own flag, a parent's or a
-- storage type's reaches this check. A plain RAISE (P0001), so the API shows
-- the text.
DECLARE
  v_location TEXT;
  v_becomes_nettable BOOLEAN;
  v_deactivated BOOLEAN;
BEGIN
  IF p_operation <> 'UPDATE' THEN
    RETURN;
  END IF;
  v_becomes_nettable := COALESCE((p_new->>'effectiveNettable')::boolean, true)
    AND NOT COALESCE((p_old->>'effectiveNettable')::boolean, true);
  v_deactivated := COALESCE((p_old->>'active')::boolean, true)
    AND NOT COALESCE((p_new->>'active')::boolean, true);
  IF NOT v_becomes_nettable AND NOT v_deactivated THEN
    RETURN;
  END IF;
  IF current_setting('app.inspection_release', true) = 'on'
     OR current_setting('app.sync_in_progress', true) = 'true' THEN
    RETURN;
  END IF;

  SELECT l."name" INTO v_location
  FROM "location" l
  WHERE l."companyId" = p_new->>'companyId'
    AND (l."inspectionStorageUnitId" = p_new->>'id' OR l."rejectedStorageUnitId" = p_new->>'id')
  ORDER BY l."name"
  LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION '% is a goods-in storage unit of %. Choose another unit in Settings → Quality first.',
      COALESCE(p_new->>'name', p_new->>'id'), v_location;
  END IF;
END;
$function$;
