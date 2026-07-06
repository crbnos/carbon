-- demandForecastSource: associates BOM-derived demandForecast rows with the
-- parent demand sources (jobs / sales orders / production projections) that
-- produced them via MRP. Populated by the MRP edge function whenever it
-- writes demandForecast rows with forecastMethod = 'mrp'. Manual /
-- statistical / ml forecasts have no traceable parent sources and do not
-- write rows here.
--
-- This migration also adds a surrogate `id` column to demandProjection so
-- demandForecastSource can FK to a specific projection (the existing
-- composite PK doesn't qualify as an FK target on its own).

-- ── 1. Surrogate id on demandProjection (needed for the FK below) ───
ALTER TABLE "demandProjection"
  ADD COLUMN "id" TEXT NOT NULL DEFAULT id();

ALTER TABLE "demandProjection"
  ADD CONSTRAINT "demandProjection_id_key" UNIQUE ("id");

-- ── 2. demandForecastSourceType enum (all three values from the start
-- so the CHECK constraint below works in this same transaction; ALTER
-- TYPE ADD VALUE can't be used in the same transaction that consumes
-- the value) ─────────────────────────────────────────────────────────
CREATE TYPE "demandForecastSourceType" AS ENUM (
  'Job Material',
  'Sales Order',
  'Demand Projection'
);

-- ── 3. demandForecastSource table ───────────────────────────────────
CREATE TABLE "demandForecastSource" (
  "id" TEXT NOT NULL DEFAULT id(),
  "itemId" TEXT NOT NULL,
  "locationId" TEXT,
  "periodId" TEXT NOT NULL,
  "sourceType" "demandForecastSourceType" NOT NULL,
  "jobId" TEXT,
  "salesOrderLineId" TEXT,
  "demandProjectionId" TEXT,
  "parentItemId" TEXT NOT NULL,
  "quantity" NUMERIC NOT NULL,
  "companyId" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),

  -- Surrogate PK because the natural key contains nullable columns
  -- (locationId, jobId, salesOrderLineId, demandProjectionId) which
  -- PostgreSQL forbids in a PRIMARY KEY. MRP fully rewrites these rows
  -- per company on each run (see mrp/index.ts), so no UNIQUE on the
  -- natural key is needed.
  CONSTRAINT "demandForecastSource_pkey" PRIMARY KEY ("id"),

  CONSTRAINT "demandForecastSource_itemId_fkey"
    FOREIGN KEY ("itemId") REFERENCES "item"("id") ON DELETE CASCADE,
  CONSTRAINT "demandForecastSource_locationId_fkey"
    FOREIGN KEY ("locationId") REFERENCES "location"("id") ON DELETE CASCADE,
  CONSTRAINT "demandForecastSource_periodId_fkey"
    FOREIGN KEY ("periodId") REFERENCES "period"("id") ON DELETE CASCADE,
  CONSTRAINT "demandForecastSource_jobId_fkey"
    FOREIGN KEY ("jobId") REFERENCES "job"("id") ON DELETE CASCADE,
  CONSTRAINT "demandForecastSource_salesOrderLineId_fkey"
    FOREIGN KEY ("salesOrderLineId") REFERENCES "salesOrderLine"("id") ON DELETE CASCADE,
  CONSTRAINT "demandForecastSource_demandProjectionId_fkey"
    FOREIGN KEY ("demandProjectionId") REFERENCES "demandProjection"("id") ON DELETE CASCADE,
  CONSTRAINT "demandForecastSource_parentItemId_fkey"
    FOREIGN KEY ("parentItemId") REFERENCES "item"("id") ON DELETE CASCADE,
  CONSTRAINT "demandForecastSource_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE,

  -- Exactly one of jobId / salesOrderLineId / demandProjectionId must
  -- be set, matching the sourceType.
  CONSTRAINT "demandForecastSource_source_check"
    CHECK (
      ("sourceType" = 'Job Material'
        AND "jobId" IS NOT NULL
        AND "salesOrderLineId" IS NULL
        AND "demandProjectionId" IS NULL)
      OR
      ("sourceType" = 'Sales Order'
        AND "salesOrderLineId" IS NOT NULL
        AND "jobId" IS NULL
        AND "demandProjectionId" IS NULL)
      OR
      ("sourceType" = 'Demand Projection'
        AND "demandProjectionId" IS NOT NULL
        AND "jobId" IS NULL
        AND "salesOrderLineId" IS NULL)
    )
);

ALTER TABLE "demandForecastSource" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Employees with inventory_view can view demandForecastSource"
  ON "demandForecastSource"
  FOR SELECT
  USING (
    "companyId" = ANY(get_companies_with_permission('inventory_view')::text[])
  );

CREATE POLICY "Employees with inventory_create can insert demandForecastSource"
  ON "demandForecastSource"
  FOR INSERT
  WITH CHECK (
    "companyId" = ANY(get_companies_with_employee_permission('inventory_create')::text[])
  );

CREATE POLICY "Employees with inventory_update can update demandForecastSource"
  ON "demandForecastSource"
  FOR UPDATE
  USING (
    "companyId" = ANY(get_companies_with_employee_permission('inventory_update')::text[])
  );

CREATE POLICY "Employees with inventory_delete can delete demandForecastSource"
  ON "demandForecastSource"
  FOR DELETE
  USING (
    "companyId" = ANY(get_companies_with_employee_permission('inventory_delete')::text[])
  );

CREATE INDEX "demandForecastSource_itemId_locationId_periodId_idx"
  ON "demandForecastSource" ("itemId", "locationId", "periodId");
CREATE INDEX "demandForecastSource_companyId_idx"
  ON "demandForecastSource" ("companyId");
CREATE INDEX "demandForecastSource_jobId_idx"
  ON "demandForecastSource" ("jobId");
CREATE INDEX "demandForecastSource_salesOrderLineId_idx"
  ON "demandForecastSource" ("salesOrderLineId");
CREATE INDEX "demandForecastSource_demandProjectionId_idx"
  ON "demandForecastSource" ("demandProjectionId");
