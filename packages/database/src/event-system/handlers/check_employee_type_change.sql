CREATE OR REPLACE FUNCTION public.check_employee_type_change(p_table text, p_operation text, p_new jsonb, p_old jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Reads the request role: the dispatcher runs this as the owner, so
  -- current_user is never an API role.
  IF current_setting('role', true) IN ('anon', 'authenticated') IS NOT TRUE THEN
    RETURN;
  END IF;

  -- Moving a person to another employee type changes their access, so it goes
  -- through writeAccessGrants (audit, claims cache). Re-pointing a row at another
  -- person or company would carry its type (an Admin's) with it, and active is
  -- set by deactivation and invite acceptance, which run as the server.
  IF p_operation = 'UPDATE' AND (
       (p_new->>'employeeTypeId') IS DISTINCT FROM (p_old->>'employeeTypeId')
       OR (p_new->>'id') IS DISTINCT FROM (p_old->>'id')
       OR (p_new->>'companyId') IS DISTINCT FROM (p_old->>'companyId')
       OR (p_new->>'active') IS DISTINCT FROM (p_old->>'active')
     ) THEN
    RAISE EXCEPTION 'An employee''s type, person, company or active state can only be changed by the server'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- The type FK is on id alone, so nothing else stops a row naming another company's type.
  IF p_operation = 'INSERT' AND NOT EXISTS (
       SELECT 1 FROM "employeeType"
       WHERE id = p_new->>'employeeTypeId' AND "companyId" = p_new->>'companyId'
     ) THEN
    RAISE EXCEPTION 'An employee''s type must be one of the company''s'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Only the server removes a person (deactivation keeps the row); a delete and
  -- re-insert would otherwise move them to any type with no audit.
  IF p_operation = 'DELETE' THEN
    RAISE EXCEPTION 'An employee can only be removed by the server'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Putting a person on the Admin type is an Admin's call.
  IF p_operation = 'INSERT'
     AND EXISTS (
       SELECT 1 FROM "employeeType"
       WHERE id = p_new->>'employeeTypeId'
         AND "companyId" = p_new->>'companyId'
         AND "systemType" = 'Admin'
     )
     -- With no page, access_level is Full only for the company's Admin type.
     AND util.access_level(auth.uid()::text, NULL, p_new->>'companyId', NULL) IS DISTINCT FROM 'Full' THEN
    RAISE EXCEPTION 'Only an Admin can add a person on the Admin type'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
END;
$function$;
