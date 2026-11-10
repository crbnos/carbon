CREATE OR REPLACE FUNCTION public.check_goods_in_storage_unit(p_table text, p_operation text, p_new jsonb, p_old jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_location TEXT;
  v_lot TEXT;
  v_deactivated BOOLEAN;
  v_moved BOOLEAN;
BEGIN
  IF p_operation <> 'UPDATE' THEN
    RETURN;
  END IF;
  v_deactivated := COALESCE((p_old->>'active')::boolean, true)
    AND NOT COALESCE((p_new->>'active')::boolean, true);
  v_moved := (p_new->'locationId') IS DISTINCT FROM (p_old->'locationId');
  IF NOT v_deactivated AND NOT v_moved THEN
    RETURN;
  END IF;
  IF current_setting('app.inspection_release', true) = 'on'
     OR current_setting('app.sync_in_progress', true) = 'true' THEN
    RETURN;
  END IF;

  SELECT l."name" INTO v_location
  FROM "location" l
  WHERE l."companyId" = p_old->>'companyId'
    AND (l."inspectionStorageUnitId" = p_old->>'id' OR l."rejectedStorageUnitId" = p_old->>'id')
  ORDER BY l."name"
  LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION '% is a goods-in storage unit of %. Choose another unit in Settings → Quality first.',
      COALESCE(p_new->>'name', p_new->>'id'), v_location;
  END IF;

  SELECT COALESCE(i."inspectionId", i."id") INTO v_lot
  FROM "inspection" i
  WHERE i."storageUnitId" = p_old->>'id'
    AND i."companyId" = p_old->>'companyId'
    AND i."status" IN ('Pending', 'In Progress', 'Partial')
    AND public.inspection_lot_holds(i."id", i."status", i."acceptedQuantity")
  ORDER BY i."inspectionId"
  LIMIT 1;
  IF FOUND THEN
    IF NOT EXISTS (SELECT 1 FROM "company" c WHERE c."id" = p_old->>'companyId') THEN
      RETURN;
    END IF;
    RAISE EXCEPTION '% holds stock of inspection lot %. Quality must decide the lot first.',
      COALESCE(p_new->>'name', p_new->>'id'), v_lot;
  END IF;
END;
$function$;
