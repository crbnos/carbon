CREATE OR REPLACE FUNCTION public.sync_unload_work_center_operation(p_table text, p_operation text, p_new jsonb, p_old jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF p_operation != 'UPDATE' THEN RETURN; END IF;
  IF (p_new->>'status') NOT IN ('Done', 'Canceled') THEN RETURN; END IF;
  IF (p_old->>'status') = (p_new->>'status') THEN RETURN; END IF;

  UPDATE "workCenter"
  SET "loadedJobOperationId" = NULL,
      "loadedAt" = NULL
  WHERE "loadedJobOperationId" = p_new->>'id';
END;
$function$;
