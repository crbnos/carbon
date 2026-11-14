-- A user can also put the sub-modules of a module in their own order. Each
-- module's row keeps the links of its sub-modules in that order.
ALTER TABLE "userModulePreference"
  ADD COLUMN "submoduleOrder" TEXT[] NOT NULL DEFAULT '{}';

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
            'hidden', mp."hidden",
            'hiddenSubmodules', mp."hiddenSubmodules",
            'submoduleOrder', mp."submoduleOrder"
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
