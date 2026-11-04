CREATE OR REPLACE FUNCTION public.sync_storage_unit_nettable(p_table text, p_operation text, p_new jsonb, p_old jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
  -- util.refresh_storage_unit_nettable's own write of effectiveNettable.
  IF current_setting('app.storage_unit_nettable_refresh', true) = 'on' THEN
    RETURN;
  END IF;

  IF p_operation = 'INSERT' THEN
    -- A new unit has no children and no stock, so only its own row can be
    -- wrong, and only when it is non-nettable (the column defaults to true) or
    -- arrives saying it is. A nettable insert, the usual row of a bulk import,
    -- recomputes nothing.
    IF COALESCE((p_new->>'nettable')::boolean, true)
      AND COALESCE((p_new->>'effectiveNettable')::boolean, true)
      AND NOT EXISTS (
        SELECT 1 FROM "storageType" st
        WHERE st."id" IN (SELECT jsonb_array_elements_text(
                COALESCE(p_new->'storageTypeIds', '[]'::jsonb)))
          AND st."nettable" = false
      )
      AND NOT EXISTS (
        SELECT 1 FROM "storageUnit" parent
        WHERE parent."id" = p_new->>'parentId'
          AND parent."effectiveNettable" = false
      ) THEN
      RETURN;
    END IF;
    PERFORM util.refresh_storage_unit_nettable(ARRAY[p_new->>'locationId']);
    RETURN;
  END IF;

  IF p_operation <> 'UPDATE' THEN
    RETURN;
  END IF;

  -- The inputs of effectiveNettable, and effectiveNettable itself: a write that
  -- set it directly is recomputed back.
  IF (p_new->'nettable') IS NOT DISTINCT FROM (p_old->'nettable')
    AND (p_new->'parentId') IS NOT DISTINCT FROM (p_old->'parentId')
    AND (p_new->'storageTypeIds') IS NOT DISTINCT FROM (p_old->'storageTypeIds')
    AND (p_new->'locationId') IS NOT DISTINCT FROM (p_old->'locationId')
    AND (p_new->'effectiveNettable') IS NOT DISTINCT FROM (p_old->'effectiveNettable') THEN
    RETURN;
  END IF;

  -- A move between two parents that agree changes nothing below the unit:
  -- the parent pass of a bulk import moves every row this way.
  IF (p_new->'nettable') IS NOT DISTINCT FROM (p_old->'nettable')
    AND (p_new->'storageTypeIds') IS NOT DISTINCT FROM (p_old->'storageTypeIds')
    AND (p_new->'locationId') IS NOT DISTINCT FROM (p_old->'locationId')
    AND (p_new->'effectiveNettable') IS NOT DISTINCT FROM (p_old->'effectiveNettable')
    AND COALESCE((
      SELECT parent."effectiveNettable" FROM "storageUnit" parent
      WHERE parent."id" = p_new->>'parentId'
    ), true) = COALESCE((
      SELECT parent."effectiveNettable" FROM "storageUnit" parent
      WHERE parent."id" = p_old->>'parentId'
    ), true) THEN
    RETURN;
  END IF;

  PERFORM util.refresh_storage_unit_nettable(
    ARRAY[p_new->>'locationId', p_old->>'locationId']
  );
END;
$function$;
