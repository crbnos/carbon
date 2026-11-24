---
paths: ["packages/database/supabase/migrations/20260807011742_lateralize-order-list-views.sql", "packages/database/supabase/migrations/20260806235710_perf-list-query-indexes.sql", "apps/erp/app/utils/query.ts"]
triggers: ["JOIN LATERAL", "EXPLAIN ANALYZE"]
promoted: null
---
# A list-query benchmark that omits the ORDER BY measures a query the app never runs

**Context:** Lateralizing the `salesOrders`/`purchaseOrders` list views on `sid/perf-audit-hot-paths`. The rewrite benchmarked as a ~9x win and shipped; re-measuring later against the real endpoint showed page 1 taking **41.6 seconds**.

**Problem:** The benchmark ran `SELECT ... FROM "salesOrders" WHERE "companyId" = $1 LIMIT 100` — no `ORDER BY`. Every one of these endpoints applies a fixed default sort (`setGenericQueryFilters(query, args, [{ column: "createdAt", ascending: false }])`). That one clause inverts the result: with no sort the planner pushes `LIMIT 100` below the lateral join so the aggregate runs ~100 times (10.6 ms vs 91.3 ms for the bulk form — the win that was measured); with the sort and no index supplying its order, every row must be produced before the limit applies, so the aggregate runs once per order in the company — 10,000 times, each re-scanning `item` under a non-indexable RLS policy. Two other things hid it: the seeded tables had **never been analyzed** (`last_analyze` and `last_autoanalyze` both NULL, `n_live_tup` 0), so plan choice was unstable; and the stated rationale — "the bulk form aggregates every tenant's lines" — was simply false, since `salesOrderLine` has RLS and the view is `SECURITY INVOKER`, so it was always company-scoped.

**Rule:** Benchmark the query the service actually builds — copy the projection, the `ORDER BY` from `setGenericQueryFilters`, and the `LIMIT/OFFSET`, not a simplified `SELECT * ... LIMIT n`. Run `ANALYZE` before trusting any timing on seeded data, and check `pg_stat_user_tables.last_analyze` first. When a rewrite's premise is "this touches rows it shouldn't", verify it against `pg_policies` before optimizing — RLS may already be doing it. A LATERAL is only a win when the limit can be pushed below the join, which needs an index supplying the sort; check the plan for `Seq Scan ... loops=<number of outer rows>`, which is the signature of a per-row aggregate that was meant to run per page.

**Applies to:** `packages/database/supabase/migrations/20260807011742_lateralize-order-list-views.sql`, `20260806235710_perf-list-query-indexes.sql`, `apps/erp/app/utils/query.ts` (`setGenericQueryFilters`), and any future list-view or RLS-policy performance work.
