CREATE OR REPLACE FUNCTION public.check_membership_system_group(p_table text, p_operation text, p_new jsonb, p_old jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  -- A type, organisation or identity group mirrors who someone is, and shared
  -- documents trust it (the Admin type's group reads Admin-only documents), so
  -- only the interceptors that keep it in step write it. Their writes are nested
  -- inside another trigger; a direct API write is not.
  IF current_setting('role', true) IN ('anon', 'authenticated') IS NOT TRUE
     OR pg_trigger_depth() > 1 THEN
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1 FROM "group"
    WHERE id IN (p_new->>'groupId', p_old->>'groupId')
      AND ("isEmployeeTypeGroup" OR "isCustomerTypeGroup" OR "isSupplierTypeGroup"
           OR "isCustomerOrgGroup" OR "isSupplierOrgGroup" OR "isIdentityGroup")
  ) THEN
    RAISE EXCEPTION 'The members of this group are kept by the server'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
END;
$function$;
