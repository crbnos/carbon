CREATE OR REPLACE FUNCTION public.sync_storage_unit_nettable(p_table text, p_operation text, p_new jsonb, p_old jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
  IF p_operation = 'INSERT' THEN
    PERFORM refresh_storage_unit_nettable(ARRAY[p_new->>'locationId']);
    RETURN;
  END IF;

  IF p_operation <> 'UPDATE' THEN
    RETURN;
  END IF;

  -- Only the inputs of effectiveNettable. refresh_storage_unit_nettable writes
  -- effectiveNettable itself, and that write must not refresh again.
  IF (p_new->'nettable') IS NOT DISTINCT FROM (p_old->'nettable')
    AND (p_new->'parentId') IS NOT DISTINCT FROM (p_old->'parentId')
    AND (p_new->'storageTypeIds') IS NOT DISTINCT FROM (p_old->'storageTypeIds')
    AND (p_new->'locationId') IS NOT DISTINCT FROM (p_old->'locationId') THEN
    RETURN;
  END IF;

  PERFORM refresh_storage_unit_nettable(
    ARRAY[p_new->>'locationId', p_old->>'locationId']
  );
END;
$function$;
