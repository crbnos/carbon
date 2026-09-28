-- is_claims_admin answered false to the service role: a service-role request has no user,
-- so the users_update check (keyed on auth.uid()) never matched. Bulk permission edits run
-- as an Inngest job with the service role (update-permissions.ts), after the route checked
-- users_update, so every one failed with "You do not have permission to update
-- permissions". The service role already bypasses every policy; trust it here too.
CREATE OR REPLACE FUNCTION public.is_claims_admin(company text)
RETURNS boolean
LANGUAGE plpgsql
AS $function$
  BEGIN
    IF session_user = 'authenticator' THEN
      IF extract(epoch from now()) > coalesce((current_setting('request.jwt.claims', true)::jsonb)->>'exp', '0')::numeric THEN
        return false; -- jwt expired
      END IF;
      IF (current_setting('request.jwt.claims', true)::jsonb)->>'role' = 'service_role' THEN
        return true;
      END IF;
      RETURN company = ANY (coalesce(get_companies_with_employee_permission('users_update'), '{}'));
    ELSE -- not a user session (trigger etc.)
      return true;
    END IF;
  END;
$function$;
