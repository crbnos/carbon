CREATE OR REPLACE FUNCTION public.check_employee_type_change(p_table text, p_operation text, p_new jsonb, p_old jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Moving a person to another employee type changes their access, so it goes
  -- through writeAccessGrants (audit, claims cache). Reads the request role: the
  -- dispatcher runs this as the owner, so current_user is never an API role.
  IF p_operation = 'UPDATE'
     AND (p_new->>'employeeTypeId') IS DISTINCT FROM (p_old->>'employeeTypeId')
     AND current_setting('role', true) IN ('anon', 'authenticated') THEN
    RAISE EXCEPTION 'An employee''s type can only be changed by the server'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
END;
$function$;
