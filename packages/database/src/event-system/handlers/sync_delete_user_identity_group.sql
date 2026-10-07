CREATE OR REPLACE FUNCTION public.sync_delete_user_identity_group(p_table text, p_operation text, p_new jsonb, p_old jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF p_operation != 'DELETE' THEN RETURN; END IF;

  DELETE FROM "group"
  WHERE "id" = p_old->>'id'
    AND "isIdentityGroup" = TRUE;
END;
$function$;
