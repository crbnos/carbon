CREATE OR REPLACE FUNCTION public.check_group_system_flags(p_table text, p_operation text, p_new jsonb, p_old jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_flags text[] := ARRAY['isEmployeeTypeGroup', 'isCustomerTypeGroup', 'isSupplierTypeGroup',
                          'isCustomerOrgGroup', 'isSupplierOrgGroup', 'isIdentityGroup'];
  v_flag text;
BEGIN
  -- A type, organisation or identity group is kept by the interceptors of the
  -- row it mirrors (nested inside that row's trigger); shared documents trust
  -- its members, so a direct API write may not create, re-flag, move or delete one.
  IF current_setting('role', true) IN ('anon', 'authenticated') IS NOT TRUE
     OR pg_trigger_depth() > 1 THEN
    RETURN;
  END IF;

  IF p_operation = 'UPDATE' AND (
       (p_new->>'id') IS DISTINCT FROM (p_old->>'id')
       OR (p_new->>'companyId') IS DISTINCT FROM (p_old->>'companyId')
     ) THEN
    RAISE EXCEPTION 'A group''s id and company can only be changed by the server'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  FOREACH v_flag IN ARRAY v_flags LOOP
    IF (p_operation = 'INSERT' AND (p_new->>v_flag)::boolean)
       OR (p_operation = 'UPDATE' AND (p_new->>v_flag) IS DISTINCT FROM (p_old->>v_flag))
       OR (p_operation = 'DELETE' AND (p_old->>v_flag)::boolean) THEN
      RAISE EXCEPTION 'This group is kept by the server'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END LOOP;
END;
$function$;
