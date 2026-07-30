-- ============================================================
-- Ledger performance indexes.
--
-- The ledger tables are append-only and aggregated on read, but the hottest
-- read paths had no matching indexes:
--
-- 1. itemLedger had NO index on itemId/locationId at all. The issue edge
--    function (functions/issue/index.ts) and lib/storage-units.ts run
--    `SUM(quantity) WHERE "itemId" = ? AND "locationId" = ?` per material
--    issued — with no companyId filter — so each was a sequential scan of the
--    entire multi-tenant table, inside the posting transaction.
-- 2. journalLine.journalId is a NOT NULL FK (20260402000000) but was never
--    indexed — hit by the journalEntries view (GROUP BY journal), journal
--    cascade deletes, void/reverse reads, and the per-row Draft-check RLS on
--    journalLine UPDATE/DELETE.
-- 3. Void paths look up ledger rows by documentId / documentLineReference;
--    tie-out and statement queries filter journal by companyId + postingDate.
-- 4. supplierLedger had zero indexes beyond its PK.
--
-- Nullable FKs use partial indexes, matching the style of
-- 20260630111923_ar-ap-fk-indexes.sql. All statements are idempotent.
-- ============================================================

-- itemLedger: per-item aggregation paths (issue, storage-unit defaults,
-- get_item_quantities_by_tracking_id). INCLUDE makes the per-item SUMs
-- index-only scans — they never touch the heap as the table grows.
CREATE INDEX IF NOT EXISTS "itemLedger_itemId_locationId_idx"
  ON "itemLedger" ("itemId", "locationId")
  INCLUDE ("storageUnitId", "quantity", "trackedEntityStatus");

-- itemLedger: company/location-scoped aggregation paths
-- (get_inventory_quantities, get_inventory_value_by_location,
-- get_job_quantity_on_hand, itemStockQuantities matview refresh).
CREATE INDEX IF NOT EXISTS "itemLedger_companyId_locationId_itemId_idx"
  ON "itemLedger" ("companyId", "locationId", "itemId");

-- itemLedger: void/reverse paths fetch a document's ledger rows.
CREATE INDEX IF NOT EXISTS "itemLedger_documentId_idx"
  ON "itemLedger" ("documentId") WHERE "documentId" IS NOT NULL;

-- journalLine: FK join path (journalEntries view, cascades, RLS Draft check).
CREATE INDEX IF NOT EXISTS "journalLine_journalId_idx"
  ON "journalLine" ("journalId");

-- journalLine: void/reverse + GR/IR accrual netting lookups.
CREATE INDEX IF NOT EXISTS "journalLine_documentId_idx"
  ON "journalLine" ("documentId") WHERE "documentId" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "journalLine_documentLineReference_idx"
  ON "journalLine" ("documentLineReference") WHERE "documentLineReference" IS NOT NULL;

-- journal: company-scoped date filters (tie-out, financial statements).
-- The existing journal_postingDate_idx is single-column.
CREATE INDEX IF NOT EXISTS "journal_companyId_postingDate_idx"
  ON "journal" ("companyId", "postingDate");

-- costLedger: unindexed FK (added 20250116182231).
CREATE INDEX IF NOT EXISTS "costLedger_supplierId_idx"
  ON "costLedger" ("supplierId") WHERE "supplierId" IS NOT NULL;

-- supplierLedger: no indexes existed beyond the PK.
CREATE INDEX IF NOT EXISTS "supplierLedger_companyId_supplierId_idx"
  ON "supplierLedger" ("companyId", "supplierId");
