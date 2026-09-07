-- ============================================================
-- Homepage analytics dashboard: per-user widget visibility + page range, and
-- five read-only KPI functions for numbers Carbon never computed before.
-- Widgets are static definitions keyed by slug in
-- apps/erp/app/modules/dashboard/dashboard.models.ts, so, like reportPin, a row
-- stores an EXPLICIT value and an absent row means the registry default.
-- Spec: .ai/specs/2026-09-05-homepage-analytics-dashboard.md
-- ============================================================

CREATE TABLE IF NOT EXISTS "userDashboardWidget" (
    "widgetKey" TEXT NOT NULL,
    "userId" TEXT NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
    "companyId" TEXT NOT NULL,
    "visible" BOOLEAN NOT NULL,
    -- Per-widget override of the page-wide range; NULL = follow the page.
    "range" TEXT,

    "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "updatedBy" TEXT REFERENCES "user"("id"),
    "updatedAt" TIMESTAMP WITH TIME ZONE,

    PRIMARY KEY ("widgetKey", "userId", "companyId"),
    FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE,
    CONSTRAINT "userDashboardWidget_range_check"
      CHECK ("range" IS NULL OR "range" IN ('7d','30d','90d','mtd','qtd','ytd','12m'))
);

CREATE INDEX IF NOT EXISTS "userDashboardWidget_userId_companyId_idx"
  ON "userDashboardWidget" ("userId", "companyId");
CREATE INDEX IF NOT EXISTS "userDashboardWidget_companyId_idx"
  ON "userDashboardWidget" ("companyId");
CREATE INDEX IF NOT EXISTS "userDashboardWidget_createdBy_idx"
  ON "userDashboardWidget" ("createdBy");
CREATE INDEX IF NOT EXISTS "userDashboardWidget_updatedBy_idx"
  ON "userDashboardWidget" ("updatedBy");

ALTER TABLE "public"."userDashboardWidget" ENABLE ROW LEVEL SECURITY;

-- A personal UI preference: rows are visible/writable only by their owner,
-- within companies the user belongs to (reportPin pattern).
DROP POLICY IF EXISTS "SELECT" ON "public"."userDashboardWidget";
CREATE POLICY "SELECT" ON "public"."userDashboardWidget" FOR SELECT USING (
  (SELECT auth.uid())::text = "userId"
  AND "companyId" = ANY ((SELECT get_companies_with_employee_role())::text[])
);
DROP POLICY IF EXISTS "INSERT" ON "public"."userDashboardWidget";
CREATE POLICY "INSERT" ON "public"."userDashboardWidget" FOR INSERT WITH CHECK (
  (SELECT auth.uid())::text = "userId"
  AND "companyId" = ANY ((SELECT get_companies_with_employee_role())::text[])
);
DROP POLICY IF EXISTS "UPDATE" ON "public"."userDashboardWidget";
CREATE POLICY "UPDATE" ON "public"."userDashboardWidget" FOR UPDATE USING (
  (SELECT auth.uid())::text = "userId"
  AND "companyId" = ANY ((SELECT get_companies_with_employee_role())::text[])
);
DROP POLICY IF EXISTS "DELETE" ON "public"."userDashboardWidget";
CREATE POLICY "DELETE" ON "public"."userDashboardWidget" FOR DELETE USING (
  (SELECT auth.uid())::text = "userId"
  AND "companyId" = ANY ((SELECT get_companies_with_employee_role())::text[])
);

-- One row per user per company: the page-wide time range. Absent = '30d'.
CREATE TABLE IF NOT EXISTS "userDashboardPreference" (
    "userId" TEXT NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
    "companyId" TEXT NOT NULL,
    "range" TEXT NOT NULL DEFAULT '30d',
    -- Widget keys in the user's drag-and-drop order. Empty = registry order.
    -- Keys not listed (added to the registry later) follow in registry order;
    -- unknown keys (removed from the registry) are ignored on read.
    "widgetOrder" TEXT[] NOT NULL DEFAULT '{}',

    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "updatedAt" TIMESTAMP WITH TIME ZONE,

    PRIMARY KEY ("userId", "companyId"),
    FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE,
    CONSTRAINT "userDashboardPreference_range_check"
      CHECK ("range" IN ('7d','30d','90d','mtd','qtd','ytd','12m'))
);

CREATE INDEX IF NOT EXISTS "userDashboardPreference_companyId_idx"
  ON "userDashboardPreference" ("companyId");

ALTER TABLE "public"."userDashboardPreference" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "SELECT" ON "public"."userDashboardPreference";
CREATE POLICY "SELECT" ON "public"."userDashboardPreference" FOR SELECT USING (
  (SELECT auth.uid())::text = "userId"
  AND "companyId" = ANY ((SELECT get_companies_with_employee_role())::text[])
);
DROP POLICY IF EXISTS "INSERT" ON "public"."userDashboardPreference";
CREATE POLICY "INSERT" ON "public"."userDashboardPreference" FOR INSERT WITH CHECK (
  (SELECT auth.uid())::text = "userId"
  AND "companyId" = ANY ((SELECT get_companies_with_employee_role())::text[])
);
DROP POLICY IF EXISTS "UPDATE" ON "public"."userDashboardPreference";
CREATE POLICY "UPDATE" ON "public"."userDashboardPreference" FOR UPDATE USING (
  (SELECT auth.uid())::text = "userId"
  AND "companyId" = ANY ((SELECT get_companies_with_employee_role())::text[])
);
DROP POLICY IF EXISTS "DELETE" ON "public"."userDashboardPreference";
CREATE POLICY "DELETE" ON "public"."userDashboardPreference" FOR DELETE USING (
  (SELECT auth.uid())::text = "userId"
  AND "companyId" = ANY ((SELECT get_companies_with_employee_role())::text[])
);

-- ------------------------------------------------------------
-- KPI functions. All SECURITY INVOKER so RLS on the underlying tables applies;
-- all take an explicit company id; none divides — the app computes the ratio
-- (numeric-precision rule: round once, at the display boundary).
-- ------------------------------------------------------------

-- On-time delivery: sales order lines SENT in the window that carried a
-- promise date. Lines with no promisedDate are excluded from both counts.
CREATE OR REPLACE FUNCTION get_on_time_delivery(
  company_id TEXT, start_date DATE, end_date DATE
)
RETURNS TABLE ("shipped" INTEGER, "onTime" INTEGER)
LANGUAGE sql STABLE SECURITY INVOKER
AS $$
  SELECT
    COUNT(*)::INTEGER AS "shipped",
    COUNT(*) FILTER (WHERE "sentDate" <= "promisedDate")::INTEGER AS "onTime"
  FROM "salesOrderLine"
  WHERE "companyId" = company_id
    AND "sentDate" IS NOT NULL
    AND "promisedDate" IS NOT NULL
    AND "sentDate" >= start_date
    AND "sentDate" <= end_date;
$$;

-- Production quantities recorded in the window, split by type. Serves both the
-- scrap-rate widget (scrap / (production + scrap)) and first-pass yield
-- (production / (production + rework + scrap)).
CREATE OR REPLACE FUNCTION get_production_quantity_summary(
  company_id TEXT, start_date DATE, end_date DATE
)
RETURNS TABLE ("production" NUMERIC, "scrap" NUMERIC, "rework" NUMERIC)
LANGUAGE sql STABLE SECURITY INVOKER
AS $$
  SELECT
    COALESCE(SUM("quantity") FILTER (WHERE "type" = 'Production'), 0)::NUMERIC AS "production",
    COALESCE(SUM("quantity") FILTER (WHERE "type" = 'Scrap'), 0)::NUMERIC AS "scrap",
    COALESCE(SUM("quantity") FILTER (WHERE "type" = 'Rework'), 0)::NUMERIC AS "rework"
  FROM "productionQuantity"
  WHERE "companyId" = company_id
    AND "createdAt" >= start_date::TIMESTAMPTZ
    AND "createdAt" < (end_date + 1)::TIMESTAMPTZ;
$$;

-- Inspections dispositioned (passed or failed) in the window.
CREATE OR REPLACE FUNCTION get_inspection_pass_rate(
  company_id TEXT, start_date DATE, end_date DATE
)
RETURNS TABLE ("passed" INTEGER, "failed" INTEGER)
LANGUAGE sql STABLE SECURITY INVOKER
AS $$
  SELECT
    COUNT(*) FILTER (WHERE "status" = 'Passed')::INTEGER AS "passed",
    COUNT(*) FILTER (WHERE "status" = 'Failed')::INTEGER AS "failed"
  FROM "inspection"
  WHERE "companyId" = company_id
    AND "dispositionedAt" IS NOT NULL
    AND "dispositionedAt" >= start_date::TIMESTAMPTZ
    AND "dispositionedAt" < (end_date + 1)::TIMESTAMPTZ;
$$;

-- Open backlog: value still to ship on open sales orders, in base currency
-- (convertedUnitPrice is unitPrice × exchangeRate, generated). as_of is the
-- company's current day, passed in by the caller — never CURRENT_DATE.
CREATE OR REPLACE FUNCTION get_open_backlog(company_id TEXT, as_of DATE)
RETURNS TABLE ("value" NUMERIC, "lines" INTEGER, "pastDueLines" INTEGER)
LANGUAGE sql STABLE SECURITY INVOKER
AS $$
  SELECT
    COALESCE(SUM(o."quantityToSend" * COALESCE(sol."convertedUnitPrice", 0)), 0)::NUMERIC AS "value",
    COUNT(*)::INTEGER AS "lines",
    COUNT(*) FILTER (WHERE o."promisedDate" IS NOT NULL AND o."promisedDate" < as_of)::INTEGER AS "pastDueLines"
  FROM "openSalesOrderLines" o
  JOIN "salesOrderLine" sol ON sol."id" = o."id" AND sol."companyId" = o."companyId"
  WHERE o."companyId" = company_id
    AND o."quantityToSend" > 0;
$$;

-- Overdue purchase orders: open POs with at least one line past its promised
-- date and quantity still outstanding. One row per PO for the list widget;
-- the stat widget counts the rows.
CREATE OR REPLACE FUNCTION get_overdue_purchase_orders(company_id TEXT, as_of DATE)
RETURNS TABLE (
  "id" TEXT, "purchaseOrderId" TEXT, "supplierId" TEXT,
  "earliestPromisedDate" DATE, "overdueLines" INTEGER
)
LANGUAGE sql STABLE SECURITY INVOKER
AS $$
  SELECT
    po."id",
    po."purchaseOrderId",
    po."supplierId",
    MIN(pol."promisedDate") AS "earliestPromisedDate",
    COUNT(*)::INTEGER AS "overdueLines"
  FROM "purchaseOrder" po
  JOIN "purchaseOrderLine" pol
    ON pol."purchaseOrderId" = po."id" AND pol."companyId" = po."companyId"
  WHERE po."companyId" = company_id
    AND po."status" IN ('To Receive', 'To Receive and Invoice')
    AND pol."promisedDate" IS NOT NULL
    AND pol."promisedDate" < as_of
    AND COALESCE(pol."purchaseQuantity", 0) - COALESCE(pol."quantityReceived", 0) > 0
  GROUP BY po."id", po."purchaseOrderId", po."supplierId"
  ORDER BY MIN(pol."promisedDate") ASC;
$$;
