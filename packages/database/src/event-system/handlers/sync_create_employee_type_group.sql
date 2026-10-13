CREATE OR REPLACE FUNCTION public.sync_create_employee_type_group(p_table text, p_operation text, p_new jsonb, p_old jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF p_operation != 'INSERT' THEN RETURN; END IF;

  INSERT INTO "group" ("id", "name", "isEmployeeTypeGroup", "companyId")
  VALUES (
    p_new->>'id',
    p_new->>'name',
    TRUE,
    p_new->>'companyId'
  );

  INSERT INTO "membership" ("groupId", "memberGroupId")
  VALUES (
    '00000000-0000-'
      || substring((p_new->>'companyId')::text, 1, 4) || '-'
      || substring((p_new->>'companyId')::text, 5, 4) || '-'
      || substring((p_new->>'companyId')::text, 9, 12),
    p_new->>'id'
  );
END;
$function$;
