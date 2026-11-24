---
paths: []
triggers: ["NOTIFY pgrst", "psql -c", "PGRST205"]
promoted: null
---
# Direct psql DDL needs a PostgREST schema-cache reload

**Context:** Applied an unshipped migration's delta (drop `assemblyGroup`, create `assemblyUnit`) to the local DB with `psql` instead of `crbn migrate`, to avoid a full rebuild. The ERP page then hung: the `$id` loader's `Promise.all` timed out (`fetchWithRetry` TimeoutError) even on queries against unrelated tables.

**Problem:** PostgREST caches the DB schema. `crbn migrate` / `db:migrate` reload it after applying migrations; a raw `psql` DDL does not. With a stale cache, queries against the changed tables can't resolve and hang, which exhausts the connection pool and times out *other* queries too. (Confirmed after: `assemblyGroup` returned PGRST205 "Could not find the table in the schema cache".)

**Rule:** After any direct-psql schema change to a local Supabase DB, reload PostgREST — `psql -c "NOTIFY pgrst, 'reload schema';"` (or `docker restart <...>-postgrest-1`). Prefer `crbn migrate` when possible; when patching by hand (e.g. editing an unshipped migration in place), the reload is a required follow-up.

**Applies to:** any local schema change applied outside `crbn migrate`; symptom is loader/REST timeouts after a DDL patch.
