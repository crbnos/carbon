-- Company-owned workflows.
--
-- A workflow runs as its owner (`engine/owner.ts`), and `ownerId` is set once from
-- `createdBy` and never reassigned. So a workflow stops working the moment its author
-- is deactivated: `deactivateEmployee` strips the company from `userPermission` and
-- deletes the `userToCompany` row, every node then fails its permission check, and no
-- one can repair or even test-run the workflow afterwards.
--
-- This gives each company a service identity that a workflow can be owned by instead.
-- The identity is a `user` row with no auth account, no employee row and read-only
-- grants -- the minimum that `get_claims` and `get_companies_with_employee_permission`
-- need in order to resolve permissions at all.

-- 1. Mark non-human principals on `user`.
--
-- Needed as a real column rather than an id-prefix convention because seat billing
-- counts `userToCompany` rows (`updateSubscriptionQuantityForCompany`), and a service
-- identity must not be billed as a seat or listed as a person.
ALTER TABLE "user"
  ADD COLUMN "isServiceAccount" BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX "user_isServiceAccount_idx" ON "user" ("isServiceAccount")
  WHERE "isServiceAccount" = TRUE;

COMMENT ON COLUMN "user"."isServiceAccount" IS
  'A non-human principal owned by the platform (currently the per-company workflow service identity). Never a seat, never an employee, never shown in a people picker.';

-- 2. Ownership kind on `workflow`.
--
-- `ownerId` keeps pointing at a real `user` row in both cases, so the engine, the
-- matcher and the scheduler are unchanged -- they resolve an owner id either way.
-- `ownerKind` is what the UI, the test-run gate and company restore branch on.
--
-- DEFAULT is mandatory: `assertBackupImportable` rejects a backup that is missing a
-- NOT NULL column with no default, which would make every existing backup unimportable.
ALTER TABLE "workflow"
  ADD COLUMN "ownerKind" TEXT NOT NULL DEFAULT 'user'
  CHECK ("ownerKind" IN ('user', 'company'));

COMMENT ON COLUMN "workflow"."ownerKind" IS
  'user = owned by the employee who created it, runs with their permissions. company = owned by the company service identity, survives any employee leaving.';

-- 3. The read-only grant set for a service identity.
--
-- Every module gets `_view` scoped to the one company; create/update/delete stay empty
-- arrays rather than absent, because every path that mutates permissions assumes the
-- keys are present. The `"0"` all-companies wildcard is retired
-- (20260817030612_remove-global-permission-wildcard.sql) -- enumerate the company.
CREATE OR REPLACE FUNCTION workflow_service_user_permissions(company_id TEXT)
RETURNS JSONB
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT COALESCE(jsonb_object_agg(key, value), '{}'::jsonb)
  FROM (
    SELECT lower(m.name::text) || '_view' AS key, to_jsonb(ARRAY[company_id]) AS value
    FROM modules m
    UNION ALL
    SELECT lower(m.name::text) || '_' || a.action, '[]'::jsonb
    FROM modules m
    CROSS JOIN (VALUES ('create'), ('update'), ('delete')) AS a(action)
  ) grants;
$$;

-- 4. Provision (idempotently) the service identity for one company.
--
-- Three rows and no auth account:
--   `user`           -- the FK target for workflow.ownerId
--   `userPermission` -- without it get_claims returns NULL, which the engine reads as
--                       "owner has no permissions" and fails every step
--   `userToCompany`  -- role 'employee', required by every RLS gate on the workflow
--                       tables via get_companies_with_employee_permission
--
-- No `employee` row on purpose: the `employees` view inner-joins `employee`, so
-- omitting it keeps the identity out of the employee list and the people picker.
CREATE OR REPLACE FUNCTION provision_workflow_service_user(company_id TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  service_user_id TEXT := 'wfsvc_' || company_id;
BEGIN
  INSERT INTO "user" ("id", "email", "firstName", "lastName", "isServiceAccount")
  VALUES (
    service_user_id,
    -- `.internal` is unroutable by design, matching the `@console.internal`
    -- convention already used for the other synthetic user in this schema.
    service_user_id || '@workflow.internal',
    'Workflow',
    'Service',
    TRUE
  )
  ON CONFLICT ("id") DO NOTHING;

  INSERT INTO "userPermission" ("id", "permissions")
  VALUES (service_user_id, workflow_service_user_permissions(company_id))
  ON CONFLICT ("id") DO UPDATE
    SET "permissions" = EXCLUDED."permissions";

  INSERT INTO "userToCompany" ("userId", "companyId", "role")
  VALUES (service_user_id, company_id, 'employee')
  ON CONFLICT ("userId", "companyId") DO NOTHING;

  RETURN service_user_id;
END;
$$;

-- Provisioning is a privileged operation: it mints a principal with company-wide read
-- access. Only the service role (the migration itself, and `seed-company`) may call it.
REVOKE EXECUTE ON FUNCTION provision_workflow_service_user(TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION provision_workflow_service_user(TEXT) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION provision_workflow_service_user(TEXT) TO service_role;

-- 5. Backfill every existing company.
--
-- seed-company only runs at company creation and short-circuits on an existing
-- userToCompany row for the owner, so it can never reach companies that already exist.
DO $$
DECLARE
  company_record RECORD;
BEGIN
  FOR company_record IN SELECT "id" FROM "company" LOOP
    PERFORM provision_workflow_service_user(company_record."id");
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
