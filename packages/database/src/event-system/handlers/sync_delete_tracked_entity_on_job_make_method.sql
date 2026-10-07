CREATE OR REPLACE FUNCTION public.sync_delete_tracked_entity_on_job_make_method(p_table text, p_operation text, p_new jsonb, p_old jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
  IF p_operation != 'DELETE' THEN RETURN; END IF;

  DELETE FROM "trackedEntity"
  WHERE "attributes"->>'Job Make Method' = p_old->>'id';
END;
$function$;
