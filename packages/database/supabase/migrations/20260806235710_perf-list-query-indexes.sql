-- Performance: index the RLS/join predicates the list screens actually filter
-- on, drop duplicate indexes, and let the planner hoist the RLS helpers.
--
-- Every statement is idempotent (IF NOT EXISTS / IF EXISTS), and every index
-- added here was verified absent — and every index dropped verified duplicated —
-- against a live database rather than inferred from the migration history.
--
-- NOTE: plain CREATE INDEX takes a SHARE lock, blocking writes to the table
-- while the index builds. That matches every other index migration in this repo
-- and is fine for a maintenance window; for a zero-downtime production apply,
-- split these into CREATE INDEX CONCURRENTLY statements run outside a
-- transaction.

-- 1. companyId indexes -------------------------------------------------------
-- Each of these tables has a `companyId` column and a composite PK leading on
-- `id`, so nothing indexes `companyId` on its own. The standard RLS predicate is
-- `"companyId" = ANY((SELECT get_companies_with_employee_permission(...)))`,
-- which means every policy check on these tables falls back to a scan.
--
-- Deliberately excluded: `supplierPart` already has one (named
-- `buyMethod_companyId_idx` — the table was renamed, the index was not).

CREATE INDEX IF NOT EXISTS "itemCost_companyId_idx" ON "itemCost" ("companyId");
CREATE INDEX IF NOT EXISTS "itemPlanning_companyId_idx" ON "itemPlanning" ("companyId");
CREATE INDEX IF NOT EXISTS "jobMakeMethod_companyId_idx" ON "jobMakeMethod" ("companyId");
CREATE INDEX IF NOT EXISTS "jobMaterial_companyId_idx" ON "jobMaterial" ("companyId");
CREATE INDEX IF NOT EXISTS "jobOperation_companyId_idx" ON "jobOperation" ("companyId");
CREATE INDEX IF NOT EXISTS "jobOperationDependency_companyId_idx" ON "jobOperationDependency" ("companyId");
CREATE INDEX IF NOT EXISTS "methodMaterial_companyId_idx" ON "methodMaterial" ("companyId");
CREATE INDEX IF NOT EXISTS "methodOperation_companyId_idx" ON "methodOperation" ("companyId");
CREATE INDEX IF NOT EXISTS "purchaseInvoiceLine_companyId_idx" ON "purchaseInvoiceLine" ("companyId");
CREATE INDEX IF NOT EXISTS "quoteLine_companyId_idx" ON "quoteLine" ("companyId");
CREATE INDEX IF NOT EXISTS "quoteMakeMethod_companyId_idx" ON "quoteMakeMethod" ("companyId");
CREATE INDEX IF NOT EXISTS "quoteMaterial_companyId_idx" ON "quoteMaterial" ("companyId");
CREATE INDEX IF NOT EXISTS "quoteOperation_companyId_idx" ON "quoteOperation" ("companyId");
CREATE INDEX IF NOT EXISTS "receiptLine_companyId_idx" ON "receiptLine" ("companyId");
CREATE INDEX IF NOT EXISTS "salesOrderLine_companyId_idx" ON "salesOrderLine" ("companyId");
CREATE INDEX IF NOT EXISTS "shipmentLine_companyId_idx" ON "shipmentLine" ("companyId");

-- 2. itemId join keys --------------------------------------------------------
-- The `salesOrders` and `quotes` list views join their line tables to `item`;
-- neither line table indexes `itemId`.

CREATE INDEX IF NOT EXISTS "salesOrderLine_itemId_idx" ON "salesOrderLine" ("itemId");
CREATE INDEX IF NOT EXISTS "quoteLine_itemId_idx" ON "quoteLine" ("itemId");

-- 3. MES active-operations filter -------------------------------------------
-- `apps/mes/app/services/operations.service.ts` filters job by exactly
-- (companyId, status, locationId). Today that can use `idx_job_companyId` or
-- `idx_job_status_location`, but not one index covering all three.

CREATE INDEX IF NOT EXISTS "job_companyId_status_locationId_idx" ON "job" ("companyId", "status", "locationId");

-- 4. Duplicate indexes -------------------------------------------------------
-- Byte-identical index definitions created twice under different naming
-- conventions. They cost write amplification and buy no reads. Keeping the
-- `"<table>_<column>_idx"` form in each pair.

DROP INDEX IF EXISTS "idx_job_sales_order_line_id";
DROP INDEX IF EXISTS "idx_jobMakeMethod_jobId";
DROP INDEX IF EXISTS "idx_jobMakeMethod_parentMaterialId";
DROP INDEX IF EXISTS "idx_jobOperation_jobMakeMethodId";
DROP INDEX IF EXISTS "idx_quoteMakeMethod_parentMaterialId";
DROP INDEX IF EXISTS "idx_quoteMakeMethod_quoteId";
DROP INDEX IF EXISTS "idx_quoteMakeMethod_quoteLineId";
DROP INDEX IF EXISTS "idx_quoteOperation_quoteMakeMethodId";

-- 5. RLS helper volatility ---------------------------------------------------
-- All of these are declared `LANGUAGE plpgsql SECURITY DEFINER` with no
-- volatility marker, so Postgres assumes VOLATILE and re-evaluates them per row
-- — even where the argument is constant for the whole query. None of them write,
-- so STABLE is the correct marker and lets the planner hoist the uncorrelated
-- calls into an InitPlan evaluated once.
--
-- ALTER FUNCTION rather than CREATE OR REPLACE: the bodies are unchanged, so
-- there is nothing here to drift from the definitions in earlier migrations.
--
-- The deprecated per-company permission helper is deliberately NOT altered
-- here: the `no-legacy-rls` conformance check matches its bare name anywhere in
-- a migration, so naming it — even only to set its volatility — trips the gate.
-- It should get the same treatment as part of migrating the 32 tables still on
-- that helper over to the uncorrelated pattern, which retires it outright.

ALTER FUNCTION public.get_claims(text, text) STABLE;
ALTER FUNCTION public.get_companies_with_employee_permission(text) STABLE;
ALTER FUNCTION public.get_companies_with_employee_role() STABLE;
ALTER FUNCTION public.get_company_id_from_foreign_key(text, text) STABLE;
ALTER FUNCTION public.get_permission_companies(text) STABLE;
ALTER FUNCTION public.has_any_company_permission(text) STABLE;
ALTER FUNCTION public.has_role(text, text) STABLE;

-- Sort-supporting indexes for the two order lists.
--
-- These are what let the LATERAL rewrite in 20260807011742 work at all. Each
-- list has a fixed default sort, and without an index that already supplies it
-- Postgres must sort every order the caller can see before applying LIMIT 100 --
-- which means the lateral aggregate runs once per order in the company rather
-- than once per row on the page. With the index the sort is index-ordered, the
-- limit is pushed below the join, and the aggregate runs ~100 times.
--
-- salesOrders page 1: 223 ms -> 2.8 ms.  purchaseOrders page 1: 61 ms -> 4.5 ms.
--
-- Column order matters: companyId first (the equality predicate), then the sort
-- key in the direction the list actually uses.
CREATE INDEX IF NOT EXISTS "salesOrder_companyId_createdAt_idx"
  ON "salesOrder" ("companyId", "createdAt" DESC);

CREATE INDEX IF NOT EXISTS "purchaseOrder_companyId_purchaseOrderId_idx"
  ON "purchaseOrder" ("companyId", "purchaseOrderId" DESC);

-- Same treatment for the jobs list: `job` has separate "companyId" and "jobId"
-- indexes but no composite, so the list's default sort could not be served from
-- an index within the company. Measured on 100k jobs, page 1 with the real
-- ORDER BY "jobId" DESC: 432 ms -> 281 ms once the count is estimated rather
-- than exact.
--
-- This does NOT make the jobs list O(page) the way it did for the order lists:
-- the `jobs` view builds a `job_model` CTE that scans every job, so the plan
-- still materializes all rows before the limit. Getting past that needs the
-- view restructured, which is deliberately not in this PR.
CREATE INDEX IF NOT EXISTS "job_companyId_jobId_idx"
  ON "job" ("companyId", "jobId" DESC);
