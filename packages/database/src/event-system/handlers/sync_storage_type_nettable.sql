CREATE OR REPLACE FUNCTION public.sync_storage_type_nettable(p_table text, p_operation text, p_new jsonb, p_old jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_location_ids TEXT[];
BEGIN
  IF p_operation = 'INSERT' THEN
    RETURN;
  END IF;

  IF p_operation = 'UPDATE'
    AND (p_new->'nettable') IS NOT DISTINCT FROM (p_old->'nettable') THEN
    RETURN;
  END IF;

  -- Deleting a nettable type changes no unit.
  IF p_operation = 'DELETE'
    AND COALESCE((p_old->>'nettable')::boolean, true) THEN
    RETURN;
  END IF;

  SELECT array_agg(DISTINCT su."locationId")
  INTO v_location_ids
  FROM "storageUnit" su
  WHERE su."companyId" = p_old->>'companyId'
    AND su."storageTypeIds" @> ARRAY[p_old->>'id'];

  PERFORM util.refresh_storage_unit_nettable(v_location_ids);
END;
$function$;
