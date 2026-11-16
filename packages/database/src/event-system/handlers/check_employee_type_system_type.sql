CREATE OR REPLACE FUNCTION public.check_employee_type_system_type(p_table text, p_operation text, p_new jsonb, p_old jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Reads the request role, as check_employee_type_change does.
  IF current_setting('role', true) IN ('anon', 'authenticated') IS NOT TRUE THEN
    RETURN;
  END IF;

  -- The Admin system type is Full on every page, so setting or clearing a
  -- systemType is a server-only write.
  IF (p_operation = 'INSERT' AND p_new->>'systemType' IS NOT NULL)
     OR (p_operation = 'UPDATE'
         AND (p_new->>'systemType') IS DISTINCT FROM (p_old->>'systemType')) THEN
    RAISE EXCEPTION 'An employee type''s system type can only be set by the server'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- A type moved to another company stops counting for the people on it: the
  -- Admin type moved away would leave the company with no Admin.
  IF p_operation = 'UPDATE' AND (
       (p_new->>'id') IS DISTINCT FROM (p_old->>'id')
       OR (p_new->>'companyId') IS DISTINCT FROM (p_old->>'companyId')
     ) THEN
    RAISE EXCEPTION 'An employee type''s company can only be changed by the server'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF p_operation = 'DELETE' AND p_old->>'systemType' IS NOT NULL THEN
    RAISE EXCEPTION 'A system employee type can only be deleted by the server'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
END;
$function$;
