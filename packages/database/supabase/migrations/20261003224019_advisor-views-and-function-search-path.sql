-- Supabase's security advisor, as of 2026-10-04.

-- 1. Two views ran with their owner's rights. `modules` lists an enum and
-- `eventSystemTrigger` reads the trigger catalog; neither needs more than the
-- caller has, so they run as the caller like every other view.
ALTER VIEW "modules" SET (security_invoker = true);
ALTER VIEW "eventSystemTrigger" SET (security_invoker = true);

-- 2. `v_readable_id` exists only in production (no migration creates it): a
-- two-column table in the API schema with RLS off, so any caller could read
-- and write it. RLS on with no policy leaves it to the service role. A no-op
-- wherever the table does not exist.
ALTER TABLE IF EXISTS public."v_readable_id" ENABLE ROW LEVEL SECURITY;

-- 3. A function with no search_path of its own resolves unqualified names
-- through its caller's. For a SECURITY DEFINER function that is how a caller
-- substitutes its own objects for the ones the function meant.
--
-- Pinned to `public, extensions`: what the API roles and direct connections
-- already resolve through ("$user" names no schema for any of them), so
-- nothing looks anything up differently than it does today.
--
-- plpgsql only. A `LANGUAGE sql` function with a SET clause can no longer be
-- inlined into the query that calls it, which would slow the planning views
-- and report functions that rely on it.
--
-- Not the functions fired by triggers on `auth.users` and `storage.objects`:
-- those run with the auth and storage roles' own search paths, and pinning
-- them here would change what they resolve.
--
-- Not the event-system functions either. Each is owned by its file under
-- packages/database/src/event-system/functions, and `authz sync` recreates
-- them from there: a setting made here would be gone after the next sync and
-- leave production different from every other database. Pin those in their
-- own files.
DO $$
DECLARE
  fn regprocedure;
BEGIN
  FOR fn IN
    SELECT p.oid::regprocedure
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    JOIN pg_language l ON l.oid = p.prolang
    WHERE n.nspname = 'public'
      AND p.prokind = 'f'
      AND l.lanname = 'plpgsql'
      AND NOT EXISTS (
        SELECT 1 FROM unnest(coalesce(p.proconfig, '{}')) AS setting
        WHERE setting LIKE 'search_path=%'
      )
      -- Owned by an extension, not by us.
      AND NOT EXISTS (
        SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e'
      )
      AND p.proname <> ALL (ARRAY[
        'attach_audit_log_append_only',
        'attach_event_trigger',
        'attach_statement_handler',
        'create_audit_log_table',
        'create_company_search_index',
        'create_embedding_subscriptions_for_company',
        'create_search_subscriptions_for_company',
        'delete_from_search_index',
        'delete_old_audit_logs',
        'drop_audit_log_table',
        'drop_company_search_index',
        'get_audit_log',
        'get_audit_log_count',
        'get_audit_logs_for_archive',
        'get_entity_audit_log',
        'get_primary_key_column',
        'get_primary_key_columns',
        'insert_audit_log_batch',
        'on_company_created_search_index',
        'populate_company_search_index',
        'prevent_audit_log_mutation',
        'search_company_index',
        'upsert_to_search_index'
      ])
      AND NOT EXISTS (
        SELECT 1
        FROM pg_trigger t
        JOIN pg_class c ON c.oid = t.tgrelid
        JOIN pg_namespace tn ON tn.oid = c.relnamespace
        WHERE t.tgfoid = p.oid AND tn.nspname <> 'public'
      )
  LOOP
    EXECUTE format('ALTER FUNCTION %s SET search_path = public, extensions', fn);
  END LOOP;
END
$$;
