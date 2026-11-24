---
paths: []
triggers: []
promoted: null
---
# `max_rows` is enforced in production but not by the local dev stack

**Context:** MRP's Phase-1 loads used bare `.select("*")` with no pagination, and had done so since the function was written. Every local test passed.

**Problem:** `packages/database/supabase/config.toml` sets `max_rows = 1000`, so PostgREST truncates responses in production. The crbn dev stack runs its own `postgrest` container without `PGRST_DB_MAX_ROWS`, so locally the same query returns everything — verified: a view with 2,497 rows returned all 2,497 locally. Two production tenants exceeded the cap on `openJobMaterialLines` (2,497 and 1,495 rows) and a third on `demandActual` (9,391), so MRP silently planned on truncated demand and its zeroing pass missed stale actuals. The bug is structurally invisible to local testing.

**Rule:** Any PostgREST read that can exceed 1000 rows must paginate — `fetchAllFromTable`/`fetchAllRecords` from `@carbon/database` in app code, `fetchAll` (`@carbon/database/fetch-all`, source `packages/database/src/fetch-all.ts`) in server functions, `@carbon/planning` and edge functions — and must carry a stable `.order()` so pages don't shift between requests. Do not conclude "it returns everything" from a local run; check the row count against `max_rows` in `config.toml` instead.

**Applies to:** `packages/planning/src/mrp/mrp.ts`, `packages/database/src/fetch-all.ts`, `packages/database/supabase/config.toml`, any `.select()` in `packages/planning/src/**` or `apps/erp/app/modules/**`.
