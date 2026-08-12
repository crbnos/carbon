-- Amplify itemLedger by cloning ONE tenant's rows, to chart how each mechanism
-- scales. Rows are cloned (fresh id(), same itemId/locationId/companyId) so all
-- foreign keys stay valid; entryNumber has no unique constraint.
--
-- Usage:  psql -v copies=63 -f scripts/bench-amplify.sql
--
-- Only tenant d0rlmp5l6de2s779lqi0 grows. Every other tenant is untouched --
-- that is the point: the old matview refresh is global, so one tenant's growth
-- is paid for by everyone.
--
-- The stock-quantity triggers are disabled for the clone itself (a transition
-- table holding millions of rows is not the thing under test) and the aggregate
-- is rebuilt afterwards with the same reconciliation function pg_cron runs.

\set ON_ERROR_STOP on
\pset pager off

ALTER TABLE "itemLedger" DISABLE TRIGGER "trg_stock_qty_ins_itemLedger";

INSERT INTO "itemLedger" (
  "entryType", "postingDate", "documentType", "documentId", "itemId",
  "locationId", "storageUnitId", "quantity", "companyId", "createdBy",
  "trackedEntityId", "trackedEntityStatus"
)
SELECT
  il."entryType", il."postingDate", il."documentType", il."documentId", il."itemId",
  il."locationId", il."storageUnitId", il."quantity", il."companyId", il."createdBy",
  il."trackedEntityId", il."trackedEntityStatus"
FROM "itemLedger" il
CROSS JOIN generate_series(1, :copies) g
WHERE il."companyId" = 'd0rlmp5l6de2s779lqi0';

ALTER TABLE "itemLedger" ENABLE TRIGGER "trg_stock_qty_ins_itemLedger";

-- Rebuild both mechanisms so the next comparison measures steady state rather
-- than one huge catch-up diff.
SELECT reconcile_item_stock_quantities();
REFRESH MATERIALIZED VIEW "_bench_stock_matview";

ANALYZE "itemLedger";
ANALYZE "itemStockQuantities";

SELECT count(*) AS ledger_rows,
       pg_size_pretty(pg_total_relation_size('"itemLedger"')) AS ledger_size
FROM "itemLedger";
