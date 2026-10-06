CREATE OR REPLACE FUNCTION public.sync_update_tracked_entity_on_job_make_method(p_table text, p_operation text, p_new jsonb, p_old jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
  IF p_operation != 'UPDATE' THEN RETURN; END IF;
  IF (p_old->>'id') IS NOT DISTINCT FROM (p_new->>'id') THEN RETURN; END IF;

  UPDATE "trackedEntity"
  SET "attributes" = jsonb_set(
    "attributes",
    '{Job Make Method}',
    to_jsonb(p_new->>'id')
  )
  WHERE "attributes"->>'Job Make Method' = p_old->>'id';
END;
$function$;
