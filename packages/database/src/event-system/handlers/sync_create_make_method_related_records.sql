CREATE OR REPLACE FUNCTION public.sync_create_make_method_related_records(p_table text, p_operation text, p_new jsonb, p_old jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
  IF p_operation != 'INSERT' THEN RETURN; END IF;

  IF (p_new->>'type') IN ('Part', 'Tool', 'Service') THEN
    INSERT INTO "makeMethod"("itemId", "createdBy", "companyId")
    VALUES (p_new->>'id', p_new->>'createdBy', p_new->>'companyId');
  END IF;
END;
$function$;
