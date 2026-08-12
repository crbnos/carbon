-- Benchmark for the itemStockQuantities refresh mechanism.
--
-- Run against a worktree's local Postgres, e.g.
--   docker exec -i <project>-postgres-1 psql -U postgres -d postgres \
--     -f - < scripts/bench-stock-quantities.sql
--
-- Timings come from psql's \timing rather than a PL/pgSQL loop because
-- REFRESH MATERIALIZED VIEW CONCURRENTLY cannot run inside a transaction
-- block (and a DO block is one).

\set ON_ERROR_STOP on
\pset pager off

\echo '=============================================='
\echo ' 1. Data shape'
\echo '=============================================='

SELECT
  (SELECT count(*) FROM "company")     AS companies,
  (SELECT count(*) FROM "item")        AS items,
  (SELECT count(*) FROM "itemLedger")  AS ledger_rows,
  (SELECT count(*) FROM "makeMethod")  AS make_methods,
  (SELECT count(*) FROM "methodMaterial") AS method_materials;

\echo '--- relation sizes ---'
SELECT
  c.relname AS relation,
  c.relkind AS kind,
  pg_size_pretty(pg_total_relation_size(c.oid)) AS total_size
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN ('itemLedger', 'itemStockQuantities', 'itemLedgerSnapshot')
ORDER BY pg_total_relation_size(c.oid) DESC;

\echo '--- largest tenants by ledger rows ---'
SELECT "companyId", count(*) AS ledger_rows
FROM "itemLedger"
GROUP BY "companyId"
ORDER BY 2 DESC
LIMIT 5;

\echo ''
\echo '=============================================='
\echo ' 2. Matview refresh cost (4 runs, discard #1)'
\echo '=============================================='

\timing on
REFRESH MATERIALIZED VIEW CONCURRENTLY "itemStockQuantities";
REFRESH MATERIALIZED VIEW CONCURRENTLY "itemStockQuantities";
REFRESH MATERIALIZED VIEW CONCURRENTLY "itemStockQuantities";
REFRESH MATERIALIZED VIEW CONCURRENTLY "itemStockQuantities";
\timing off

\echo ''
\echo '=============================================='
\echo ' 3. The aggregation itself (what refresh scans)'
\echo '=============================================='

EXPLAIN (ANALYZE, BUFFERS, TIMING ON)
SELECT
  "itemId",
  "companyId",
  COALESCE("locationId", '') AS "locationId",
  SUM("quantity") FILTER (
    WHERE "trackedEntityStatus" IS NULL
       OR "trackedEntityStatus" != 'Rejected'
  ) AS "quantityOnHand"
FROM "itemLedger"
GROUP BY "itemId", "companyId", COALESCE("locationId", '');

\echo ''
\echo '=============================================='
\echo ' 4. The dropdown read (per-company, largest tenant)'
\echo '=============================================='

SELECT "companyId" AS biggest_company
FROM "itemLedger"
GROUP BY "companyId"
ORDER BY count(*) DESC
LIMIT 1
\gset

\echo 'largest tenant:' :'biggest_company'

EXPLAIN (ANALYZE, BUFFERS)
SELECT "itemId", "locationId", "quantityOnHand"
FROM "itemStockQuantities"
WHERE "companyId" = :'biggest_company';

\echo ''
\echo '=============================================='
\echo ' 5. Cron schedule state'
\echo '=============================================='

SELECT jobname, schedule, active
FROM cron.job
WHERE jobname LIKE '%item%' OR jobname LIKE '%stock%' OR jobname LIKE '%ledger%'
ORDER BY jobname;
