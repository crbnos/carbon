-- The Projects module and its permissions.
-- Spec: .ai/specs/2026-10-03-projects.md

DROP VIEW IF EXISTS "modules";
CREATE VIEW "modules" WITH (security_invoker = true) AS
  SELECT unnest(enum_range(NULL::module)) AS name;

-- Each employee type's Production row becomes a Projects row (Brad 2026-10-07).
INSERT INTO "employeeTypePermission" ("employeeTypeId", "module", "create", "delete", "update", "view")
SELECT "employeeTypeId", 'Projects'::module, "create", "delete", "update", "view"
FROM "employeeTypePermission"
WHERE "module" = 'Production'
ON CONFLICT ("employeeTypeId", "module") DO NOTHING;

-- Admin and Management always get Projects.
INSERT INTO "employeeTypePermission" ("employeeTypeId", "module", "create", "delete", "update", "view")
SELECT et.id, 'Projects'::module, ARRAY[et."companyId"], ARRAY[et."companyId"], ARRAY[et."companyId"], ARRAY[et."companyId"]
FROM "employeeType" et
WHERE et.name IN ('Admin', 'Management')
ON CONFLICT ("employeeTypeId", "module") DO NOTHING;

-- Each user's production_* permissions become projects_*.
UPDATE "userPermission"
SET "permissions" = "permissions" || jsonb_build_object(
  'projects_view',   COALESCE("permissions"->'production_view',   '[]'::jsonb),
  'projects_create', COALESCE("permissions"->'production_create', '[]'::jsonb),
  'projects_update', COALESCE("permissions"->'production_update', '[]'::jsonb),
  'projects_delete', COALESCE("permissions"->'production_delete', '[]'::jsonb)
);

-- API keys keep parity with users.
UPDATE "apiKey"
SET "scopes" = "scopes" || jsonb_build_object(
  'projects_view',   COALESCE("scopes"->'production_view',   '[]'::jsonb),
  'projects_create', COALESCE("scopes"->'production_create', '[]'::jsonb),
  'projects_update', COALESCE("scopes"->'production_update', '[]'::jsonb),
  'projects_delete', COALESCE("scopes"->'production_delete', '[]'::jsonb)
)
WHERE "scopes" IS NOT NULL;
