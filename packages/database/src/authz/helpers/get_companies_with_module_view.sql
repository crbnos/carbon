CREATE OR REPLACE FUNCTION public.get_companies_with_module_view(modules text[], permissions text[])
 RETURNS text[]
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  -- get_companies_with_any_employee_permission over `permissions` and View on every
  -- page of `modules` (util.module_pages). A read admits any page of the module that
  -- owns the table, so a policy names the module and a new page changes no policy.
  SELECT get_companies_with_any_employee_permission(
    permissions || ARRAY(
      SELECT page || '_view'
      FROM unnest(modules) AS m(module), unnest(util.module_pages(m.module)) AS p(page)
    )
  )
$function$;
