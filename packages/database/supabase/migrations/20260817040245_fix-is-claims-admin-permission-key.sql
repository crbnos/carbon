-- Fix a pre-existing bug in is_claims_admin: it checked the REVERSED permission
-- key 'update_users' via has_company_permission, but userPermission keys are
-- '<module>_<action>' — the correct key is 'users_update'. 'update_users' never
-- exists, so has_company_permission always returned an empty array (the gate only
-- ever passed via the non-authenticator ELSE branch). Check the real key so the
-- gate enforces "caller may update users in this company" as intended.
CREATE OR REPLACE FUNCTION is_claims_admin(company text) RETURNS "bool"
  LANGUAGE "plpgsql"
  AS $$
  BEGIN
    IF session_user = 'authenticator' THEN
      IF extract(epoch from now()) > coalesce((current_setting('request.jwt.claims', true)::jsonb)->>'exp', '0')::numeric THEN
        return false; -- jwt expired
      END IF;
      IF has_company_permission('users_update', company) THEN
        return true;
      ELSE
        return false;
      END IF;
    ELSE -- not a user session (trigger etc.)
      return true;
    END IF;
  END;
$$;

NOTIFY pgrst, 'reload schema';
