CREATE OR REPLACE FUNCTION public.storage_unit_block_location_change_with_children(p_table text, p_operation text, p_new jsonb, p_old jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_id              TEXT;
  v_new_location    TEXT;
  v_old_location    TEXT;
BEGIN
  IF p_operation <> 'UPDATE' THEN
    RETURN;
  END IF;

  v_new_location := p_new->>'locationId';
  v_old_location := p_old->>'locationId';

  IF v_new_location IS NOT DISTINCT FROM v_old_location THEN
    RETURN;
  END IF;

  v_id := p_old->>'id';

  IF EXISTS (SELECT 1 FROM "storageUnit" WHERE "parentId" = v_id) THEN
    RAISE EXCEPTION
      'Cannot change locationId of storage unit % because it has child units',
      v_id;
  END IF;
END;
$function$;
