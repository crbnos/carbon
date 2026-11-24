---
paths: []
triggers: []
promoted: null
---
# A public SECURITY DEFINER function that calls net.http_post is a remote-DoS surface — put it in an internal schema

**Context:** The push-based event-queue wake (`20260721184852_event-queue-wake.sql`) originally defined `wake_event_queue()` / `sweep_event_queue()` in the `public` schema. Both are SECURITY DEFINER and call `net.http_post` (pg_net) to POST to the `event-wake` edge function. The trigger (`dispatch_event_batch`) and pg_cron call them as the owner (superuser).

**Problem:** Every `public` function is auto-exposed as a PostgREST RPC (`/rest/v1/rpc/<name>`), reachable by `anon`. Worse than mere exposure: referencing such a function as a **non-superuser** role segfaults the backend (pg_net 0.20 / PG15) — reproducible via `SET ROLE authenticated; EXPLAIN SELECT public.wake_event_queue();`, which crashed even though `EXPLAIN` never runs the body and the role lacked EXECUTE. The crash happens at plan/permission-resolution time, **before** the ACL check — so `REVOKE ALL … FROM PUBLIC, anon, authenticated` does NOT protect: an unauthenticated `POST /rpc/wake_event_queue` crash-loops the whole DB (postmaster reinitializes all backends → "database system is in recovery mode" for every client). Same-body call as superuser was fine, which is why the trigger/cron paths worked and masked it in end-to-end testing.

**Rule:** Never define an internal SECURITY DEFINER helper (especially one calling `net.http_post` / pg_net) in `public`. Put it in the internal `util` schema (the existing Carbon/Supabase convention — cf. `util.process_embeddings`), where `anon`/`authenticated` have no `USAGE`, so the API can't reference it at all and a hostile call fails cleanly with `permission denied for schema util` before any crash-prone planning. Callers that are triggers/pg_cron run as owner and reach `util` fine; update their bodies to `util.<fn>()`. Keep `REVOKE ALL … FROM PUBLIC` on the util function as defense-in-depth, but the schema-USAGE gate is the real fix. Verify with `SET ROLE authenticated; SELECT util.<fn>();` → must be a clean `permission denied`, not a dropped connection. Note PostgREST-exposed schemas exclude `util`/`pgmq` but include `public`/`net` (`has_schema_privilege('anon', <schema>, 'USAGE')`).

**Applies to:** any new SECURITY DEFINER function that calls pg_net/`net.http_post` or is meant to be trigger/cron-only (`packages/database/supabase/migrations/`). Trigger functions returning `trigger` are not RPC-exposed (safe in public), but VOID/scalar helpers are.

**Update (2026-09-24):** pg_net is not required. On `supabase/postgres:15.14.1.112`, a plain
`LANGUAGE sql` function (`select 1`) with `REVOKE EXECUTE … FROM PUBLIC, anon, authenticated`
segfaults the backend (signal 11) when called under `SET ROLE authenticated` or `anon`. This was
reproduced in a fresh container of that image. A missing table privilege, a `RAISE`, and "must be owner"
are all ordinary errors. So `REVOKE EXECUTE` on any function in `public` is itself an unauthenticated DoS
(`POST /rest/v1/rpc/<fn>`). Gate API access INSIDE the function instead, and raise on
`current_setting('role', true) IN ('anon','authenticated')` without the permission — see
`assert_audit_log_access` in `20260924171942_audit-log-company-scope.sql`. When you test a revoke, use a
throwaway container (`docker run --rm supabase/postgres:<tag>`), never a shared dev database. The crash
restarts every backend. `20260924192316_api-function-guards-not-revokes.sql` replaced the six existing public-function
revokes (integration secrets, `upsert_company_integration_patch`, the job-completion helpers). A nested
helper of a SECURITY DEFINER function cannot use the role-GUC guard, because `current_setting('role')`
still reads `authenticated` inside the nested call. Make those `SECURITY INVOKER` instead.
