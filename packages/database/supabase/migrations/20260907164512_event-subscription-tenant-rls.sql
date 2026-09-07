-- Security fix: cross-tenant authorization flaw on "eventSystemSubscription"
-- (coordinated disclosure, S9S Security Research; CWE-284 / CWE-639).
--
-- The prior policy was `FOR ALL USING (auth.role() = 'authenticated')` — no
-- companyId predicate and no WITH CHECK — so any authenticated user of any
-- company could SELECT/INSERT/UPDATE/DELETE every other company's event
-- subscriptions over PostgREST. WEBHOOK rows carry `config` JSONB holding the
-- target url + signing secret, so this leaked secrets and allowed planting a
-- webhook that exfiltrates a victim's records (and deleting a victim's
-- subscriptions for a DoS).
--
-- Two vectors are closed here:
--   1. The permissive RLS policy is replaced with the standard tenant-scoped
--      four-policy pattern (below).
--   2. The SECURITY DEFINER RPCs that maintain this table bypass RLS and are
--      auto-exposed as PostgREST RPCs — an equivalent cross-tenant vector — so
--      each gains an in-function tenant guard (below).

-- ---------------------------------------------------------------------------
-- 1. Tenant-scoped RLS policies
--
-- SELECT uses get_companies_with_employee_role() — the Carbon-standard read
-- gate: any employee of the company can read (pure userToCompany membership, no
-- permission grant required). Writes are gated on settings_{create,update,delete},
-- mirroring the "webhook" table (the user-facing source of truth for WEBHOOK
-- subscriptions).
--
-- Safe by construction: the only authenticated-client access to this table is
-- the audit-log settings read in @carbon/database/src/audit.ts, whose routes
-- require settings_view / settings_update — so those callers are employees and
-- pass the employee-role SELECT gate. Every write path is service-role, a
-- SECURITY DEFINER RPC, or Kysely (workflows sync, dataset seeding) — all of
-- which bypass RLS — so the new write policies block only the cross-tenant
-- PostgREST writes from the disclosure, not any real flow.
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "manage_subscriptions" ON "public"."eventSystemSubscription";
DROP POLICY IF EXISTS "SELECT" ON "public"."eventSystemSubscription";
DROP POLICY IF EXISTS "INSERT" ON "public"."eventSystemSubscription";
DROP POLICY IF EXISTS "UPDATE" ON "public"."eventSystemSubscription";
DROP POLICY IF EXISTS "DELETE" ON "public"."eventSystemSubscription";

CREATE POLICY "SELECT" ON "public"."eventSystemSubscription"
FOR SELECT USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_role())::text[])
);

CREATE POLICY "INSERT" ON "public"."eventSystemSubscription"
FOR INSERT WITH CHECK (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('settings_create'))::text[])
);

CREATE POLICY "UPDATE" ON "public"."eventSystemSubscription"
FOR UPDATE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('settings_update'))::text[])
) WITH CHECK (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('settings_update'))::text[])
);

CREATE POLICY "DELETE" ON "public"."eventSystemSubscription"
FOR DELETE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('settings_delete'))::text[])
);

-- ---------------------------------------------------------------------------
-- 2. In-function tenant guard on the SECURITY DEFINER RPCs
--
-- The RLS above scopes DIRECT PostgREST table access, but the three RPCs that
-- maintain "eventSystemSubscription" bypass RLS and are auto-exposed as
-- PostgREST RPCs. They took a companyId / row id with NO caller check, so an
-- authenticated user could still create_event_system_subscription(...) for ANY
-- company (plant a WEBHOOK pointing config.url at an attacker server — the
-- disclosure's INSERT PoC), or delete for ANY company (integration DoS).
--
-- They cannot be revoked from `authenticated`: the audit-log settings UI
-- (enableAuditLog / syncAuditSubscriptions in @carbon/database/src/audit.ts) and
-- the sync_webhook_subscription trigger both call them from an authenticated
-- context. So each gains an in-function tenant guard: allow when the request is
-- the service role, OR the caller is an employee of the target company.
-- auth.role() / the claims read by get_companies_with_employee_role() come from
-- request-scoped GUCs that SECURITY DEFINER does not reset, so the guard sees the
-- ORIGINAL caller even through the (also SECURITY DEFINER) webhook trigger.
-- Membership — not a granular settings_* permission — is used deliberately: it is
-- the minimum that blocks cross-tenant while leaving every legitimate same-company
-- caller (the audit UI's settings_view-only loader included) working as before.
-- get_companies_with_employee_role() returns NULL for a non-employee, and
-- `= ANY(NULL)` is NULL (which an IF treats as false, skipping the RAISE), so the
-- array is COALESCEd to empty to reject non-employees.
--
-- Bodies are forked verbatim from 20260204080000_async-search-triggers.sql; only
-- the guard is prepended. Signatures/return types are unchanged, so
-- CREATE OR REPLACE preserves existing grants and dependents.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION create_event_system_subscription(
  p_name TEXT,
  p_table TEXT,
  p_company_id TEXT,
  p_operations TEXT[],
  p_handler_type TEXT,
  p_config JSONB DEFAULT '{}',
  p_filter JSONB DEFAULT '{}',
  p_active BOOLEAN DEFAULT TRUE
)
RETURNS TABLE (id TEXT, name TEXT, "handlerType" TEXT, "table" TEXT) AS $$
BEGIN
  IF (SELECT auth.role()) <> 'service_role'
     AND NOT (p_company_id = ANY (COALESCE((SELECT get_companies_with_employee_role())::text[], ARRAY[]::text[]))) THEN
    RAISE EXCEPTION 'Not authorized to manage event subscriptions for company %', p_company_id
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  INSERT INTO "eventSystemSubscription" (
    "name", "table", "companyId", "operations",
    "handlerType", "config", "filter", "active"
  )
  VALUES (
    p_name, p_table, p_company_id, p_operations,
    p_handler_type, p_config, p_filter, p_active
  )
  ON CONFLICT ON CONSTRAINT "unique_subscription_name_per_company"
  DO UPDATE SET
    "operations" = EXCLUDED."operations",
    "filter" = EXCLUDED."filter",
    "handlerType" = EXCLUDED."handlerType",
    "config" = EXCLUDED."config",
    "active" = EXCLUDED."active"
  RETURNING
    "eventSystemSubscription"."id",
    "eventSystemSubscription"."name",
    "eventSystemSubscription"."handlerType",
    "eventSystemSubscription"."table";
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


CREATE OR REPLACE FUNCTION delete_event_system_subscription(
  p_subscription_id TEXT
)
RETURNS VOID AS $$
DECLARE
  v_company_id TEXT;
BEGIN
  SELECT "companyId" INTO v_company_id
  FROM "eventSystemSubscription"
  WHERE "id" = p_subscription_id;

  -- Nothing to delete (missing id, or already gone) — no-op, as before.
  IF v_company_id IS NULL THEN
    RETURN;
  END IF;

  IF (SELECT auth.role()) <> 'service_role'
     AND NOT (v_company_id = ANY (COALESCE((SELECT get_companies_with_employee_role())::text[], ARRAY[]::text[]))) THEN
    RAISE EXCEPTION 'Not authorized to manage event subscriptions for company %', v_company_id
      USING ERRCODE = '42501';
  END IF;

  DELETE FROM "eventSystemSubscription" WHERE "id" = p_subscription_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


CREATE OR REPLACE FUNCTION delete_event_system_subscriptions_by_name(
  p_company_id TEXT,
  p_name TEXT
)
RETURNS VOID AS $$
BEGIN
  IF (SELECT auth.role()) <> 'service_role'
     AND NOT (p_company_id = ANY (COALESCE((SELECT get_companies_with_employee_role())::text[], ARRAY[]::text[]))) THEN
    RAISE EXCEPTION 'Not authorized to manage event subscriptions for company %', p_company_id
      USING ERRCODE = '42501';
  END IF;

  DELETE FROM "eventSystemSubscription"
  WHERE "companyId" = p_company_id AND "name" = p_name;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
