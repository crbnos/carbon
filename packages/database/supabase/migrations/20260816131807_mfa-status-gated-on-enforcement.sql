-- Which members of a company have a verified authenticator.
--
-- SECURITY DEFINER because TOTP factors live in Supabase's `auth.mfa_factors`,
-- which the `employees` view cannot reach: that view is SECURITY_INVOKER, so a
-- member reading it has no rights to the auth schema. Returns ids only — no
-- secrets, no factor material — and is scoped to companies the caller actually
-- belongs to, so it cannot be used to probe another tenant.
--
-- The tenant guard has to accept BOTH callers. The employees route reads through
-- `requirePermissions(..., { bypassRls: true })`, i.e. a SERVICE-ROLE client with
-- no `auth.uid()` — for it `get_companies_with_employee_role()` is NULL and a
-- membership-only guard silently returns zero rows (which reads on screen as
-- "nobody has 2FA"). Service role is already authorized at the route, so it is
-- allowed through explicitly; an ordinary authenticated caller still has to be a
-- member of the company it asks about.
--
-- Also short-circuits unless the company enforces MFA: the employees table only
-- renders the Two-Factor column while `requireMfa` is on, so for every other
-- company the join would be work thrown away. Gating here keeps it to ONE query
-- either way — reading `companySettings` in the loader first would add a round
-- trip for the companies that DO use it, which is backwards.
CREATE OR REPLACE FUNCTION users_with_verified_mfa(company_id TEXT)
RETURNS TABLE ("userId" TEXT)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT DISTINCT utc."userId"
  FROM "userToCompany" utc
  JOIN auth.mfa_factors f ON f.user_id::text = utc."userId"
  WHERE utc."companyId" = company_id
    AND f.status = 'verified'
    AND (
      auth.role() = 'service_role'
      OR company_id = ANY ((SELECT get_companies_with_employee_role())::text[])
    )
    AND EXISTS (
      SELECT 1 FROM "companySettings" cs
      WHERE cs."id" = company_id AND cs."requireMfa" = true
    );
$$;

GRANT EXECUTE ON FUNCTION users_with_verified_mfa(TEXT) TO authenticated;
