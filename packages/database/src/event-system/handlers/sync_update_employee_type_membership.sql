CREATE OR REPLACE FUNCTION public.sync_update_employee_type_membership(p_table text, p_operation text, p_new jsonb, p_old jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF p_operation != 'UPDATE' THEN RETURN; END IF;

  UPDATE "membership"
  SET "groupId" = p_new->>'employeeTypeId'
  WHERE "groupId" = p_old->>'employeeTypeId'
    AND "memberUserId" = p_new->>'id';
END;
$function$;
