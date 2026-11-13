CREATE OR REPLACE FUNCTION public.check_employee_type_system_type(p_table text, p_operation text, p_new jsonb, p_old jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  -- The Admin system type is Full on every page, so setting or clearing a
  -- systemType is a server-only write. Reads the request role, as
  -- check_employee_type_change does.
  IF current_setting('role', true) IN ('anon', 'authenticated')
     AND (
       (p_operation = 'INSERT' AND p_new->>'systemType' IS NOT NULL)
       OR (p_operation = 'UPDATE'
           AND (p_new->>'systemType') IS DISTINCT FROM (p_old->>'systemType'))
     ) THEN
    RAISE EXCEPTION 'An employee type''s system type can only be set by the server'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
END;
$function$;
