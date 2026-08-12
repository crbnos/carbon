-- Correctness proof for the incrementally-maintained itemStockQuantities.
--
-- The invariant: the trigger-maintained table must equal a fresh recompute from
-- itemLedger, for every tenant. Checked with EXCEPT in both directions, so
-- neither a missing row nor a spurious one can hide.

\set ON_ERROR_STOP on
\pset pager off

\echo '=============================================='
\echo ' 0. Relation is now a TABLE (not a matview)'
\echo '=============================================='

SELECT c.relkind AS kind, count(*) OVER () AS relations,
       (SELECT count(*) FROM "itemStockQuantities") AS rows
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relname = 'itemStockQuantities';

\echo '--- triggers installed ---'
SELECT tgname FROM pg_trigger
WHERE tgrelid = '"itemLedger"'::regclass AND NOT tgisinternal
  AND tgname LIKE 'trg_stock_qty%'
ORDER BY tgname;

\echo '--- cron: refresh gone, reconcile scheduled ---'
SELECT jobname, schedule FROM cron.job
WHERE jobname IN ('refresh-item-stock-quantities', 'reconcile-item-stock-quantities');

\echo ''
\echo '=============================================='
\echo ' 1. Baseline equality (all 1634 tenants)'
\echo '=============================================='

CREATE OR REPLACE VIEW _recompute_stock_quantities AS
SELECT
  "itemId",
  "companyId",
  COALESCE("locationId", '') AS "locationId",
  COALESCE(SUM(item_ledger_on_hand_contribution("quantity", "trackedEntityStatus")), 0) AS "quantityOnHand"
FROM "itemLedger"
GROUP BY "itemId", "companyId", COALESCE("locationId", '');

\echo 'rows in table vs recompute:'
SELECT
  (SELECT count(*) FROM "itemStockQuantities") AS table_rows,
  (SELECT count(*) FROM _recompute_stock_quantities) AS recompute_rows;

\echo 'DRIFT (must be 0 both directions):'
SELECT
  (SELECT count(*) FROM (
     SELECT * FROM "itemStockQuantities" EXCEPT SELECT * FROM _recompute_stock_quantities
   ) t) AS in_table_not_recompute,
  (SELECT count(*) FROM (
     SELECT * FROM _recompute_stock_quantities EXCEPT SELECT * FROM "itemStockQuantities"
   ) t) AS in_recompute_not_table;
