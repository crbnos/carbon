CREATE OR REPLACE FUNCTION public.sync_storage_unit_nettable(p_table text, p_operation text, p_new jsonb, p_old jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
  -- refresh_storage_unit_nettable's own write of effectiveNettable.
  IF current_setting('app.storage_unit_nettable_refresh', true) = 'on' THEN
    RETURN;
  END IF;

  IF p_operation = 'INSERT' THEN
    -- A unit with no parent, no storage types and its own flag on is nettable,
    -- which the column default already says. Skipping it keeps a bulk import
    -- from recomputing the whole location once per row.
    IF COALESCE((p_new->>'nettable')::boolean, true)
      AND COALESCE((p_new->>'effectiveNettable')::boolean, true)
      AND p_new->>'parentId' IS NULL
      AND COALESCE(p_new->'storageTypeIds', '[]'::jsonb) = '[]'::jsonb THEN
      RETURN;
    END IF;
    PERFORM refresh_storage_unit_nettable(ARRAY[p_new->>'locationId']);
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

  PERFORM refresh_storage_unit_nettable(
    ARRAY[p_new->>'locationId', p_old->>'locationId']
  );
END;
$function$;
