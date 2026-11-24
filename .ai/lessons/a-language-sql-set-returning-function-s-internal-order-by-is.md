---
paths: ["apps/mes/app/services/allocation.ts"]
triggers: ["get_available_tracked_entities", "sortLotsByPickMethod", "RETURNS SETOF", "RETURNS TABLE"]
promoted: null
---
# A LANGUAGE sql set-returning function's internal ORDER BY is not guaranteed through PostgREST

**Context:** `get_available_tracked_entities` (a `LANGUAGE sql STABLE` set-returning function) was extended with a `p_sort_method` param and a CASE-based `ORDER BY` (FEFO/FIFO/LIFO) to power an on-the-fly picking suggestion. FEFO worked, but calling the RPC for FIFO returned rows in the wrong order — its only effective sort key was the trailing `te."createdAt" ASC`, which came back unordered. Adding an explicit outer `ORDER BY "createdAt"` at the call site fixed it, proving the function's internal order was being dropped.

**Problem:** The Postgres planner **inlines** simple `LANGUAGE sql` functions into the calling query; when the caller (here, PostgREST via `client.rpc(...)`) supplies no outer `ORDER BY`, the inlined subquery's `ORDER BY` can be optimized away. Ordering that leads with a real indexed/leading column (expiration for FEFO) may survive by luck; ordering whose only key is a trailing column silently does not. Unit tests and typecheck can't catch this — only real-data querying does.

**Rule:** Do not rely on a `LANGUAGE sql` set-returning function's internal `ORDER BY` to reach the app. Either (a) sort authoritatively in the app after the RPC returns (return the sort columns and order in TS — see `apps/mes/app/services/allocation.ts` `sortLotsByPickMethod`, applied in `getSuggestedAllocationForMaterial`), or (b) if ordering must live in SQL, use `LANGUAGE plpgsql` with `RETURN QUERY ... ORDER BY` (plpgsql is never inlined). Always verify RPC ordering against seeded real data, not just unit tests.

**Applies to:** `packages/database/supabase/migrations/` set-returning `LANGUAGE sql` functions consumed via `client.rpc(...)`; any app code that greedy-fills / picks "the first row" from an RPC result.
