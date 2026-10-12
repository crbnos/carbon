CREATE OR REPLACE FUNCTION public.sync_add_employee_to_type_group(p_table text, p_operation text, p_new jsonb, p_old jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF p_operation != 'INSERT' THEN RETURN; END IF;

  INSERT INTO "membership" ("groupId", "memberUserId")
  VALUES (
    p_new->>'employeeTypeId',
    p_new->>'id'
  );
END;
$function$;
