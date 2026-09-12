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
--      each gains an in-function authorization guard (below).

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
-- 2. In-function authorization guard on the SECURITY DEFINER RPCs
--
-- The RLS above scopes DIRECT PostgREST table access, but the three RPCs that
-- maintain "eventSystemSubscription" bypass RLS and are auto-exposed as
-- PostgREST RPCs. They took a companyId / row id with NO caller check, so an
-- authenticated user could create_event_system_subscription(...) — even for
-- their OWN company, without any settings permission — with handlerType WEBHOOK
-- and an attacker-controlled config.url, forwarding company records externally
-- (and for ANY company, cross-tenant, as in the disclosure's INSERT PoC).
--
-- util.can_manage_event_subscription() centralizes the rule (in the internal
-- `util` schema — like util.wake_event_queue() — so it is never exposed as a
-- PostgREST RPC; anon/authenticated have no USAGE on util):
--   * service role                       -> always allowed
--   * WEBHOOK (external url + secret)     -> a settings write permission
--       (create OR update OR delete). The sync_webhook_subscription trigger
--       recreates the row (delete+create) on every webhook write, and the writer
--       may hold only ONE of those perms (INSERT=create, UPDATE=update,
--       DELETE=delete), so any of the three must satisfy it — this mirrors the
--       "webhook" table's own per-verb policies while never breaking the trigger.
--   * internal handler types (AUDIT, SYNC, SEARCH, EMBEDDING, WORKFLOW)
--       -> employee membership, so the audit-sync loader (gated only on
--       settings_view) keeps working.
--
-- auth.role() / the claims read by the get_companies_* helpers come from
-- request-scoped GUCs that SECURITY DEFINER does not reset, so the guard sees the
-- ORIGINAL caller even through the (also SECURITY DEFINER) webhook trigger.
-- get_companies_*() returns NULL for a non-member, and `= ANY(NULL)` is NULL
-- (which an IF treats as false, skipping the RAISE), so each array is COALESCEd
-- to empty to reject non-members.
--
-- All four functions pin search_path (public, pg_temp last) — required for a
-- SECURITY DEFINER function that references unqualified relations, else a
-- pg_temp relation could shadow "eventSystemSubscription" and bypass the guard.
--
-- RPC bodies are forked verbatim from 20260204080000_async-search-triggers.sql;
-- only the guard + search_path are added. Signatures/return types are unchanged,
-- so CREATE OR REPLACE preserves existing grants and dependents.
-- ---------------------------------------------------------------------------

CREATE SCHEMA IF NOT EXISTS util;

CREATE OR REPLACE FUNCTION util.can_manage_event_subscription(
  p_company_id TEXT,
  p_handler_type TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF (SELECT auth.role()) = 'service_role' THEN
    RETURN TRUE;
  END IF;

  IF p_handler_type = 'WEBHOOK' THEN
    RETURN p_company_id = ANY (COALESCE((SELECT get_companies_with_employee_permission('settings_create'))::text[], ARRAY[]::text[]))
        OR p_company_id = ANY (COALESCE((SELECT get_companies_with_employee_permission('settings_update'))::text[], ARRAY[]::text[]))
        OR p_company_id = ANY (COALESCE((SELECT get_companies_with_employee_permission('settings_delete'))::text[], ARRAY[]::text[]));
  END IF;

  RETURN p_company_id = ANY (COALESCE((SELECT get_companies_with_employee_role())::text[], ARRAY[]::text[]));
END;
$$;

-- Internal predicate only — the three SECURITY DEFINER RPCs call it as owner.
REVOKE ALL ON FUNCTION util.can_manage_event_subscription(TEXT, TEXT) FROM PUBLIC;


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
RETURNS TABLE (id TEXT, name TEXT, "handlerType" TEXT, "table" TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT util.can_manage_event_subscription(p_company_id, p_handler_type) THEN
    RAISE EXCEPTION 'Not authorized to manage % event subscriptions for company %', p_handler_type, p_company_id
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
$$;


CREATE OR REPLACE FUNCTION delete_event_system_subscription(
  p_subscription_id TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_company_id TEXT;
  v_handler_type TEXT;
BEGIN
  SELECT "companyId", "handlerType" INTO v_company_id, v_handler_type
  FROM "eventSystemSubscription"
  WHERE "id" = p_subscription_id;

  -- Nothing to delete (missing id, or already gone) — no-op, as before.
  IF v_company_id IS NULL THEN
    RETURN;
  END IF;

  IF NOT util.can_manage_event_subscription(v_company_id, v_handler_type) THEN
    RAISE EXCEPTION 'Not authorized to manage % event subscriptions for company %', v_handler_type, v_company_id
      USING ERRCODE = '42501';
  END IF;

  DELETE FROM "eventSystemSubscription" WHERE "id" = p_subscription_id;
END;
$$;


CREATE OR REPLACE FUNCTION delete_event_system_subscriptions_by_name(
  p_company_id TEXT,
  p_name TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_handler_type TEXT;
BEGIN
  -- A (companyId, name) group is one handler type in practice; if any matching
  -- row is WEBHOOK, require the stricter WEBHOOK gate. NULL (no rows) falls
  -- through to the membership gate on a delete that affects nothing.
  SELECT CASE WHEN bool_or("handlerType" = 'WEBHOOK') THEN 'WEBHOOK' ELSE max("handlerType") END
  INTO v_handler_type
  FROM "eventSystemSubscription"
  WHERE "companyId" = p_company_id AND "name" = p_name;

  IF NOT util.can_manage_event_subscription(p_company_id, COALESCE(v_handler_type, '')) THEN
    RAISE EXCEPTION 'Not authorized to manage event subscriptions for company %', p_company_id
      USING ERRCODE = '42501';
  END IF;

  DELETE FROM "eventSystemSubscription"
  WHERE "companyId" = p_company_id AND "name" = p_name;
END;
$$;
