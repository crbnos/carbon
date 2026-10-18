-- Convert today's permissions to grants (.ai/specs/2026-10-18-page-level-permissions.md, phase 1).
--
-- 1. Each role's module checkboxes (employeeTypePermission) become one module grant.
-- 2. Each employee whose own keys (userPermission) resolve to another level than their
--    role's gets a person module grant for that module, None included.
-- 3. Each API key's scopes become module grants on the key.
--
-- The level is the lowest one that holds every granted checkbox: view and update
-- without create becomes Edit. "convertedFrom" keeps the checkboxes, so the change is
-- reportable. A "0" in a company list (all companies) counts as granted, as the app
-- reads it. The Admin type resolves to Full and gets no rows. Old columns stay until
-- the cleanup. Re-running is safe: a subject's existing module grant is left alone,
-- and supabase/tests/access-migration.test.sql runs this file again over fixtures.

CREATE OR REPLACE FUNCTION pg_temp.round_up(v boolean, c boolean, u boolean, d boolean)
RETURNS "permissionLevel" LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN d THEN 'Full'
    WHEN u THEN 'Edit'
    WHEN c THEN 'Create'
    WHEN v THEN 'View'
    ELSE 'None'
  END::"permissionLevel"
$$;

CREATE OR REPLACE FUNCTION pg_temp.flag_names(v boolean, c boolean, u boolean, d boolean)
RETURNS text[] LANGUAGE sql IMMUTABLE AS $$
  SELECT array_remove(ARRAY[
    CASE WHEN v THEN 'view' END,
    CASE WHEN c THEN 'create' END,
    CASE WHEN u THEN 'update' END,
    CASE WHEN d THEN 'delete' END
  ], NULL)
$$;

-- Per-key flags of a jsonb { "<module>_<action>": [companyIds] } for one company.
CREATE OR REPLACE FUNCTION pg_temp.key_flags(keys jsonb, company text)
RETURNS TABLE (module "module", v boolean, c boolean, u boolean, d boolean)
LANGUAGE sql STABLE AS $$
  SELECT m.module,
    bool_or(parts[2] = 'view'), bool_or(parts[2] = 'create'),
    bool_or(parts[2] = 'update'), bool_or(parts[2] = 'delete')
  FROM jsonb_each(CASE WHEN jsonb_typeof(keys) = 'object' THEN keys ELSE '{}'::jsonb END) kv
  CROSS JOIN LATERAL regexp_match(kv.key, '^(.*)_(view|create|update|delete)$') AS parts
  JOIN unnest(enum_range(NULL::"module")) AS m(module) ON lower(m.module::text) = parts[1]
  WHERE jsonb_typeof(kv.value) = 'array' AND (kv.value ? company OR kv.value ? '0')
  GROUP BY m.module
$$;

-- 1. Roles.
INSERT INTO "permission" ("companyId", "employeeTypeId", "module", "level", "convertedFrom", "createdBy")
SELECT et."companyId", etp."employeeTypeId", etp."module",
  pg_temp.round_up(f.v, f.c, f.u, f.d),
  pg_temp.flag_names(f.v, f.c, f.u, f.d),
  COALESCE(cg."ownerId", 'system')
FROM "employeeTypePermission" etp
JOIN "employeeType" et ON et.id = etp."employeeTypeId"
JOIN company co ON co.id = et."companyId"
JOIN "companyGroup" cg ON cg.id = co."companyGroupId"
CROSS JOIN LATERAL (SELECT
  COALESCE(cardinality(etp."view"), 0) > 0 AS v,
  COALESCE(cardinality(etp."create"), 0) > 0 AS c,
  COALESCE(cardinality(etp."update"), 0) > 0 AS u,
  COALESCE(cardinality(etp."delete"), 0) > 0 AS d
) f
WHERE et."systemType" IS DISTINCT FROM 'Admin'
  AND pg_temp.round_up(f.v, f.c, f.u, f.d) <> 'None'
ON CONFLICT ON CONSTRAINT "permission_unique" DO NOTHING;

-- 2. People whose own keys differ from their role.
WITH emp AS (
  SELECT utc."userId", utc."companyId", e."employeeTypeId"
  FROM "userToCompany" utc
  LEFT JOIN employee e ON e.id = utc."userId" AND e."companyId" = utc."companyId"
  LEFT JOIN "employeeType" et ON et.id = e."employeeTypeId"
  WHERE utc.role = 'employee' AND et."systemType" IS DISTINCT FROM 'Admin'
),
person AS (
  SELECT emp."userId", emp."companyId", k.module, k.v, k.c, k.u, k.d
  FROM emp
  JOIN "userPermission" up ON up.id = emp."userId"
  CROSS JOIN LATERAL pg_temp.key_flags(up.permissions, emp."companyId") k
),
role_keys AS (
  SELECT emp."userId", emp."companyId", etp."module",
    COALESCE(cardinality(etp."view"), 0) > 0 AS v,
    COALESCE(cardinality(etp."create"), 0) > 0 AS c,
    COALESCE(cardinality(etp."update"), 0) > 0 AS u,
    COALESCE(cardinality(etp."delete"), 0) > 0 AS d
  FROM emp
  JOIN "employeeTypePermission" etp ON etp."employeeTypeId" = emp."employeeTypeId"
),
merged AS (
  SELECT
    COALESCE(p."userId", r."userId") AS "userId",
    COALESCE(p."companyId", r."companyId") AS "companyId",
    COALESCE(p.module, r.module) AS module,
    COALESCE(p.v, false) AS v, COALESCE(p.c, false) AS c,
    COALESCE(p.u, false) AS u, COALESCE(p.d, false) AS d,
    pg_temp.round_up(COALESCE(r.v, false), COALESCE(r.c, false), COALESCE(r.u, false), COALESCE(r.d, false)) AS role_level
  FROM person p
  FULL JOIN role_keys r ON r."userId" = p."userId" AND r."companyId" = p."companyId" AND r.module = p.module
)
INSERT INTO "permission" ("companyId", "userId", "module", "level", "convertedFrom", "createdBy")
SELECT m."companyId", m."userId", m.module,
  pg_temp.round_up(m.v, m.c, m.u, m.d),
  pg_temp.flag_names(m.v, m.c, m.u, m.d),
  COALESCE(cg."ownerId", 'system')
FROM merged m
JOIN company co ON co.id = m."companyId"
JOIN "companyGroup" cg ON cg.id = co."companyGroupId"
WHERE pg_temp.round_up(m.v, m.c, m.u, m.d) <> m.role_level
ON CONFLICT ON CONSTRAINT "permission_unique" DO NOTHING;

-- 3. API keys.
INSERT INTO "permission" ("companyId", "apiKeyId", "module", "level", "convertedFrom", "createdBy")
SELECT k."companyId", k.id, f.module,
  pg_temp.round_up(f.v, f.c, f.u, f.d),
  pg_temp.flag_names(f.v, f.c, f.u, f.d),
  COALESCE(cg."ownerId", 'system')
FROM "apiKey" k
JOIN company co ON co.id = k."companyId"
JOIN "companyGroup" cg ON cg.id = co."companyGroupId"
CROSS JOIN LATERAL pg_temp.key_flags(k.scopes, k."companyId") f
WHERE pg_temp.round_up(f.v, f.c, f.u, f.d) <> 'None'
ON CONFLICT ON CONSTRAINT "permission_unique" DO NOTHING;
