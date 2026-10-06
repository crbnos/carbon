CREATE OR REPLACE FUNCTION public.sync_update_employee_type_group(p_table text, p_operation text, p_new jsonb, p_old jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF p_operation != 'UPDATE' THEN RETURN; END IF;

  UPDATE "group"
  SET "name" = p_new->>'name'
  WHERE "id" = p_new->>'id'
    AND "isEmployeeTypeGroup" = TRUE;
END;
$function$;
