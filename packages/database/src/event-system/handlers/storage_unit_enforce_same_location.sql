CREATE OR REPLACE FUNCTION public.storage_unit_enforce_same_location(p_table text, p_operation text, p_new jsonb, p_old jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_parent_id       TEXT;
  v_parent_location TEXT;
  v_new_location    TEXT;
BEGIN
  IF p_operation NOT IN ('INSERT', 'UPDATE') THEN
    RETURN;
  END IF;

  v_parent_id := p_new->>'parentId';
  IF v_parent_id IS NULL THEN
    RETURN;
  END IF;

  v_new_location := p_new->>'locationId';

  SELECT "locationId"
  INTO v_parent_location
  FROM "storageUnit"
  WHERE "id" = v_parent_id;

  IF v_parent_location IS NULL THEN
    RAISE EXCEPTION 'Parent storage unit % does not exist', v_parent_id;
  END IF;

  IF v_parent_location <> v_new_location THEN
    RAISE EXCEPTION
      'Parent storage unit % is in location %, but this unit is in location %; they must match',
      v_parent_id, v_parent_location, v_new_location;
  END IF;
END;
$function$;
