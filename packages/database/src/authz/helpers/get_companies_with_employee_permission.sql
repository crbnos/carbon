CREATE OR REPLACE FUNCTION public.get_companies_with_employee_permission(permission text)
 RETURNS text[]
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  -- '<page>_<action>': the companies where the caller's level on the page reaches the
  -- action's. The one-key form of get_companies_with_any_employee_permission.
  SELECT get_companies_with_any_employee_permission(ARRAY[permission])
$function$;
