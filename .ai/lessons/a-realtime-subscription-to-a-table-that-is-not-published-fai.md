---
paths: []
triggers: []
promoted: null
---
# A realtime subscription to a table that is not published fails silently

**Context:** The ERP job page did not show an operation completed in the MES until a reload. It subscribed with `postgres_changes` to `jobOperationStep` and `jobOperationStepRecord`, which were never in the `supabase_realtime` publication, and it had no subscription to `jobOperation` or `job` at all.

**Problem:** Realtime accepts a `postgres_changes` subscription for any table name. For an unpublished table it joins, delivers nothing and reports nothing. The code looked wired and typecheck, lint and tests were all green.

**Rule:** Realtime goes through broadcast topics (`@carbon/query`). Declare a route's tables in `handle.realtime`; the table type is derived from `event-system/attachments.ts`, so a table with no broadcast handler does not compile, and `no-postgres-changes` fails the old API. Verify a "live" page by changing the row while the page is open, not by reading the subscription code.

**Applies to:** `apps/*/app/routes/**` `handle.realtime`, `useRealtime`, `useChangedRows`, `.claude/rules/realtime-system.md`.
