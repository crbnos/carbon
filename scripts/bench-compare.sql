-- Old mechanism vs new mechanism, measured on identical data.
-- Run once per scale (see bench-amplify.sql).
--
--   OLD: REFRESH MATERIALIZED VIEW CONCURRENTLY  (every 30 min, all tenants)
--   NEW: trigger delta on write  +  one nightly reconciliation
--
-- The last measurement is the multi-tenant proof: a SMALL tenant's dropdown read
-- while a DIFFERENT tenant is the one carrying all the amplified rows.

\set ON_ERROR_STOP on
\pset pager off

\echo '###############################################'
SELECT
  count(*) AS ledger_rows,
  pg_size_pretty(pg_total_relation_size('"itemLedger"')) AS ledger_size
FROM "itemLedger";
\echo '###############################################'

\echo ''
\echo '--- OLD: matview refresh (3 runs) ---'
\timing on
REFRESH MATERIALIZED VIEW CONCURRENTLY "_bench_stock_matview";
REFRESH MATERIALIZED VIEW CONCURRENTLY "_bench_stock_matview";
REFRESH MATERIALIZED VIEW CONCURRENTLY "_bench_stock_matview";
\timing off

\echo ''
\echo '--- NEW: one posting (1 row, trigger fires) x3 ---'
\timing on
INSERT INTO "itemLedger" ("entryType","itemId","locationId","quantity","companyId")
SELECT 'Positive Adjmt.', "itemId", NULLIF("locationId",''), 1, "companyId"
FROM "itemStockQuantities" WHERE "locationId" <> '' ORDER BY "itemId" LIMIT 1;
INSERT INTO "itemLedger" ("entryType","itemId","locationId","quantity","companyId")
SELECT 'Positive Adjmt.', "itemId", NULLIF("locationId",''), 1, "companyId"
FROM "itemStockQuantities" WHERE "locationId" <> '' ORDER BY "itemId" LIMIT 1;
INSERT INTO "itemLedger" ("entryType","itemId","locationId","quantity","companyId")
SELECT 'Positive Adjmt.', "itemId", NULLIF("locationId",''), 1, "companyId"
FROM "itemStockQuantities" WHERE "locationId" <> '' ORDER BY "itemId" LIMIT 1;
\timing off

\echo ''
\echo '--- NEW: bulk posting (50 rows, one statement) x3 ---'
\timing on
INSERT INTO "itemLedger" ("entryType","itemId","locationId","quantity","companyId")
SELECT 'Positive Adjmt.', "itemId", NULLIF("locationId",''), 1, "companyId"
FROM "itemStockQuantities" WHERE "locationId" <> '' ORDER BY "itemId" LIMIT 50;
INSERT INTO "itemLedger" ("entryType","itemId","locationId","quantity","companyId")
SELECT 'Positive Adjmt.', "itemId", NULLIF("locationId",''), 1, "companyId"
FROM "itemStockQuantities" WHERE "locationId" <> '' ORDER BY "itemId" LIMIT 50;
INSERT INTO "itemLedger" ("entryType","itemId","locationId","quantity","companyId")
SELECT 'Positive Adjmt.', "itemId", NULLIF("locationId",''), 1, "companyId"
FROM "itemStockQuantities" WHERE "locationId" <> '' ORDER BY "itemId" LIMIT 50;
\timing off

\echo ''
\echo '--- NEW: nightly reconciliation (2 runs) ---'
\timing on
SELECT reconcile_item_stock_quantities();
SELECT reconcile_item_stock_quantities();
\timing off

\echo ''
\echo '--- Dropdown read for a SMALL tenant (multi-tenant proof) ---'
\timing on
SELECT count(*) FROM "itemStockQuantities" WHERE "companyId" = 'cs868u84gfk07v78v9e0';
SELECT count(*) FROM "itemStockQuantities" WHERE "companyId" = 'cs868u84gfk07v78v9e0';
\timing off
