-- Composite indexes on child tables that a list view groups by its parent.
--
-- The view groups the child table before the list keeps a page, and RLS reads
-- it by "companyId". With no index that starts with "companyId", Postgres reads
-- every tenant's rows to apply RLS. Measured as an RLS user, 96 companies,
-- 18,000–45,000 child rows (.ai/runs/2026-11-03-query-performance-sweep.md):
--
--   issues          (nonConformanceItem)   4.2 ->  3.7 ms
--   supplierQuotes  (supplierQuoteLine)    6.6 ->  4.4 ms
--   processes       (workCenterProcess)   10.1 ->  7.8 ms
--   workCenters     (workCenterProcess)    7.2 ->  4.7 ms
--
-- A single ("companyId") index on the list tables themselves was measured too
-- and made pages slower (workCenters 1.3 -> 3.0 ms): Postgres switched from the
-- ordered unique index to the company index and a sort. Those are not added.

CREATE INDEX IF NOT EXISTS "nonConformanceItem_companyId_nonConformanceId_idx"
  ON "nonConformanceItem" ("companyId", "nonConformanceId");

CREATE INDEX IF NOT EXISTS "supplierQuoteLine_companyId_supplierQuoteId_idx"
  ON "supplierQuoteLine" ("companyId", "supplierQuoteId");

CREATE INDEX IF NOT EXISTS "workCenterProcess_companyId_processId_idx"
  ON "workCenterProcess" ("companyId", "processId");

CREATE INDEX IF NOT EXISTS "workCenterProcess_companyId_workCenterId_idx"
  ON "workCenterProcess" ("companyId", "workCenterId");
