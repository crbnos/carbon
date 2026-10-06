CREATE OR REPLACE FUNCTION public.sync_update_customer_type_group_name(p_table text, p_operation text, p_new jsonb, p_old jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF p_operation != 'UPDATE' THEN RETURN; END IF;

  UPDATE "group"
  SET "name" = p_new->>'name'
  WHERE "id" = p_new->>'id'
    AND "isCustomerTypeGroup" = TRUE;
END;
$function$;
