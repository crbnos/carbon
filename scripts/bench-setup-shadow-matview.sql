-- Shadow copy of the ORIGINAL itemStockQuantities materialized view, so the old
-- and new mechanisms can be measured against identical data at each scale.
-- Definition copied verbatim from 20260420112047_inventory-quantity-status-aware.sql.

\set ON_ERROR_STOP on

DROP MATERIALIZED VIEW IF EXISTS "_bench_stock_matview";

CREATE MATERIALIZED VIEW "_bench_stock_matview" AS
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

-- Required for REFRESH ... CONCURRENTLY (as in the original migration).
CREATE UNIQUE INDEX "_bench_stock_matview_key"
  ON "_bench_stock_matview" ("itemId", "companyId", "locationId");

CREATE INDEX "_bench_stock_matview_companyId_idx"
  ON "_bench_stock_matview" ("companyId");
