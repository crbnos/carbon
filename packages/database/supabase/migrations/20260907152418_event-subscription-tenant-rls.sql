-- Tenant-scope "eventSystemSubscription".
--
-- The table is declared strict multi-tenant ("companyId" NOT NULL REFERENCES
-- "company"), but its only policy was:
--
--   CREATE POLICY "manage_subscriptions" ON "eventSystemSubscription"
--   FOR ALL USING ((SELECT auth.role()) = 'authenticated');
--
-- No "companyId" predicate, and — because a permissive FOR ALL policy's USING
-- also serves as its WITH CHECK — no write guard either. `authenticated` holds
-- the default table grants, so any signed-in user of any company could SELECT,
-- INSERT, UPDATE and DELETE every other company's subscriptions over ordinary
-- PostgREST.
--
-- The blast radius is the WEBHOOK handler: `config.url` is the address the
-- dispatcher POSTs the changed record to (dispatch_event_batch -> pgmq ->
-- packages/jobs/src/inngest/functions/events/queue.ts). A cross-tenant INSERT
-- is therefore standing exfiltration of another company's business records on
-- their next matching write, and a cross-tenant DELETE silently stops their
-- integrations.
--
-- Two write paths reach this table from an end-user request, so both are fixed
-- here. Closing only the policy would leave PostgREST's /rpc/ surface open,
-- because the three subscription RPCs are SECURITY DEFINER and bypass RLS
-- entirely.

-- ---------------------------------------------------------------------------
-- 1. Replace the policy with the standard four, scoped to the company
-- ---------------------------------------------------------------------------
-- settings_* mirrors "webhook" (20250203121216_webhooks.sql), which is where
-- most of these rows come from: a subscription is derived from a webhook row,
-- an accounting-integration install, or the audit-log setting — all of them
-- Settings surfaces, and `config` carries integration detail nothing outside
-- Settings has business reading.
--
-- Every legitimate reader still works: the dispatcher (dispatch_event_batch) is
-- SECURITY DEFINER; the job/edge/Kysely writers connect as postgres; the
-- accounting hooks use the service role; and the one user-client read,
-- syncAuditSubscriptions, is reached only from routes gated on settings view or
-- update (apps/erp/app/routes/x+/settings+/audit-logs.tsx, api+/audit-log.ts).

DROP POLICY IF EXISTS "manage_subscriptions" ON "public"."eventSystemSubscription";

CREATE POLICY "SELECT" ON "public"."eventSystemSubscription"
FOR SELECT USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('settings_view'))::text[]
  )
);

CREATE POLICY "INSERT" ON "public"."eventSystemSubscription"
FOR INSERT WITH CHECK (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('settings_create'))::text[]
  )
);

CREATE POLICY "UPDATE" ON "public"."eventSystemSubscription"
FOR UPDATE USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('settings_update'))::text[]
  )
);

CREATE POLICY "DELETE" ON "public"."eventSystemSubscription"
FOR DELETE USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('settings_delete'))::text[]
  )
);

-- ---------------------------------------------------------------------------
-- 2. Tenant-guard the three SECURITY DEFINER subscription RPCs
-- ---------------------------------------------------------------------------
-- create_event_system_subscription / delete_event_system_subscription /
-- delete_event_system_subscriptions_by_name (20260204080000) run as their owner
-- and never checked the caller against the company id in their arguments.
-- PostgREST exposes them to `authenticated`, so each was a cross-tenant write
-- of its own, independent of the policy above.
--
-- One shared guard rather than three copies: these three are edited together
-- (the webhook interceptor calls two of them in the same function) and a guard
-- that drifts between them is the same bug again.

CREATE OR REPLACE FUNCTION require_event_subscription_company_access(
  p_company_id TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  allowed_companies TEXT[];
BEGIN
  -- Only end-user requests are constrained. A request arriving through
  -- PostgREST connects as `authenticator`; service_role (the ERP's server
  -- routes, the Inngest jobs) and direct Postgres connections (edge functions,
  -- Kysely, migrations, the SECURITY DEFINER triggers that seed search and
  -- webhook subscriptions) are already privileged. Same test as
  -- get_demand_projections (20260715195226).
  IF session_user <> 'authenticator'
     OR COALESCE(auth.role(), '') = 'service_role' THEN
    RETURN;
  END IF;

  -- Any Settings permission on the company, not one specific action: the
  -- callers already did their own RBAC check at a higher layer and arrive
  -- holding different ones — the webhook interceptor runs under the
  -- settings_create/update/delete that "webhook"'s own policies demanded, while
  -- syncAuditSubscriptions runs under settings_view. This guard's job is tenant
  -- isolation; demanding one exact action here would break a legitimate caller
  -- without closing anything the policies above leave open.
  allowed_companies :=
    COALESCE(get_companies_with_employee_permission('settings_view'), '{}')
    || COALESCE(get_companies_with_employee_permission('settings_create'), '{}')
    || COALESCE(get_companies_with_employee_permission('settings_update'), '{}')
    || COALESCE(get_companies_with_employee_permission('settings_delete'), '{}');

  IF p_company_id IS NULL OR NOT (p_company_id = ANY (allowed_companies)) THEN
    RAISE EXCEPTION 'Insufficient permissions';
  END IF;
END;
$$;

COMMENT ON FUNCTION require_event_subscription_company_access(TEXT) IS
  'Raises unless the caller may manage event subscriptions for p_company_id. No-op for service_role and direct Postgres connections.';

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
SET search_path TO 'public'
AS $$
BEGIN
  PERFORM require_event_subscription_company_access(p_company_id);

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

-- Takes no company id, so the row's own is what gets checked. A miss stays a
-- silent no-op (the DELETE matched nothing before this change either); only a
-- real row belonging to someone else raises.
CREATE OR REPLACE FUNCTION delete_event_system_subscription(
  p_subscription_id TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  subscription_company_id TEXT;
BEGIN
  SELECT "companyId" INTO subscription_company_id
  FROM "eventSystemSubscription"
  WHERE "id" = p_subscription_id;

  IF subscription_company_id IS NULL THEN
    RETURN;
  END IF;

  PERFORM require_event_subscription_company_access(subscription_company_id);

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
SET search_path TO 'public'
AS $$
BEGIN
  PERFORM require_event_subscription_company_access(p_company_id);

  DELETE FROM "eventSystemSubscription"
  WHERE "companyId" = p_company_id AND "name" = p_name;
END;
$$;
