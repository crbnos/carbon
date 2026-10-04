-- The app shell read nine tables with nine requests on every load. They ran in
-- parallel, so the page waited for the slowest of nine trips through the API
-- gateway. This returns the same rows in one.
--
-- SECURITY INVOKER: it runs as the caller, so each table's RLS decides what
-- comes back, exactly as it did when the app read them one request each. It
-- can return nothing the caller could not already read through REST.
CREATE OR REPLACE FUNCTION "get_app_shell"(company_id TEXT, user_id TEXT)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'companies', (
      SELECT COALESCE(jsonb_agg(to_jsonb(c) ORDER BY c."name"), '[]'::jsonb)
      FROM "companies" c
      WHERE c."userId" = user_id
    ),
    'companyIntegrations', (
      SELECT COALESCE(jsonb_agg(to_jsonb(ci)), '[]'::jsonb)
      FROM "companyIntegration" ci
      WHERE ci."companyId" = company_id
    ),
    'companySettings', (
      SELECT to_jsonb(cs)
      FROM "companySettings" cs
      WHERE cs."id" = company_id
    ),
    'savedViews', (
      SELECT COALESCE(jsonb_agg(to_jsonb(tv) ORDER BY tv."name"), '[]'::jsonb)
      FROM "tableView" tv
      WHERE tv."createdBy" = user_id AND tv."companyId" = company_id
    ),
    'user', (
      SELECT to_jsonb(u)
      FROM "user" u
      WHERE u."id" = user_id AND u."active" = true
    ),
    'groups', to_jsonb(groups_for_user(user_id)),
    'defaults', (
      SELECT to_jsonb(ud)
      FROM "userDefaults" ud
      WHERE ud."userId" = user_id AND ud."companyId" = company_id
      LIMIT 1
    ),
    'modulePreferences', (
      SELECT COALESCE(
        jsonb_agg(
          jsonb_build_object(
            'module', mp."module",
            'position', mp."position",
            'hidden', mp."hidden"
          )
          ORDER BY mp."position"
        ),
        '[]'::jsonb
      )
      FROM "userModulePreference" mp
      WHERE mp."userId" = user_id AND mp."companyId" = company_id
    ),
    'printerRoutes', (
      SELECT COALESCE(jsonb_agg(to_jsonb(pr) ORDER BY pr."name"), '[]'::jsonb)
      FROM "printerRoute" pr
      WHERE pr."companyId" = company_id
    ),
    'implementationHub', (
      SELECT to_jsonb(h)
      FROM "implementationHub" h
      WHERE h."id" = company_id
    )
  );
$$;
