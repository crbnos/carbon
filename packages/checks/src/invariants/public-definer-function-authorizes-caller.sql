-- invariant: every SECURITY DEFINER function in "public" authorizes its caller
-- returns rows that VIOLATE the rule (none = healthy)
--
-- Every function in "public" is a PostgREST RPC, callable with the anon key the
-- apps publish; API-key requests also arrive as anon. A SECURITY DEFINER
-- function runs as the owner and bypasses RLS, so one that takes a company or
-- user id from the caller without checking it is a cross-tenant read or write
-- for anyone (20260925121735_rpc-function-guards).
--
-- REVOKE EXECUTE is NOT an escape hatch on this image: a call to a revoked
-- function segfaults the backend (20260924192316). A SECURITY DEFINER function
-- must instead do one of:
--   - assert_company_access(company_id[, permission]) first thing, for a
--     company id the caller supplies;
--   - raise when current_setting('role') is anon/authenticated, for a function
--     only service_role and direct connections may call;
--   - be caller-scoped, answering only about auth.uid() or the request's own
--     carbon-key (the RLS helpers).
-- An internal helper called only from other SECURITY DEFINER functions, or an
-- event interceptor, should simply be SECURITY INVOKER: from its SECURITY
-- DEFINER caller it still runs as the owner, and through the API it runs under
-- the caller's RLS.
--
-- Trigger functions are excluded: PostgREST cannot call them.
-- get_company_id_from_foreign_key is excluded by name: 44 RLS policies resolve
-- a child row's company through it and then check membership themselves, and
-- it returns nothing but a company id.
SELECT p.oid::regprocedure AS function
FROM pg_proc p
WHERE p.pronamespace = 'public'::regnamespace
  AND p.prosecdef
  AND p.prorettype <> 'trigger'::regtype
  AND p.oid <> 'get_company_id_from_foreign_key(text,text)'::regprocedure
  AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e')
  AND p.prosrc !~* '(assert_company_access|assert_audit_log_access|can_manage_event_subscription|current_setting\(\s*''role''|auth\.uid\(|auth\.role\(|get_companies_with_[a-z_]+\(|get_company_id_from_api_key\(|request\.headers)'
ORDER BY 1;
