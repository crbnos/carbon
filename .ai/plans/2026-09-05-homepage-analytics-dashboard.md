# Homepage Analytics Dashboard — implementation plan

**Spec:** .ai/specs/2026-09-05-homepage-analytics-dashboard.md
**Research:** .ai/research/homepage-analytics-dashboard.md
**Branch:** configurable-homepage-analytics

## Progress
- [x] Task 1: Migration — `userDashboardWidget`, `userDashboardPreference`, five KPI functions
- [x] Task 2: Regenerate DB types
- [x] Task 3: `dashboard.models.ts` — ranges, widget registry, validators, payload types (+ unit tests)
- [x] Task 4: `dashboard.service.ts` — layout/preference CRUD and the widget data dispatcher
- [x] Task 5: API routes + `path.ts` entries
- [x] Task 6: Home loader additions
- [x] Task 7: UI — section, range select, widget shell, kind renderers, catalog drawer; wire into home
- [x] Task 8: Validation gates (lint, typecheck, tests, translations)
- [ ] Task 9: Browser verification (only with the user's go-ahead)

## Execution notes (2026-09-05)
- Task 1: `inboundInspection` was renamed to `inspection` by `20260722132135_inspections-refactor.sql`; the function is `get_inspection_pass_rate` over `inspection.status` / `dispositionedAt`, and the widget key is `quality.inspectionPassRate`.
- Task 3: `msg` descriptors and `path.to.*` links live in `dashboard.labels.ts` / `dashboard.links.ts`, not the registry — importing either from the models file breaks vitest (`~/utils/path` pulls the glossary's macro).
- Task 4: `production.utilization` is a per-work-center **breakdown** (hours), since the shared computation is per work center, not a time series. AR/AP totals are summed locally in the service (same bucket definition as the invoicing route) rather than moving the invoicing helpers.
- Task 8: `pnpm db:check:backups` must be run with `SUPABASE_DB_URL` pointing at this worktree's port; the worktree `.env` still carries the default 54322.

## Dependencies
- Task 2 needs Task 1 (applied migration).
- Task 3 is independent of Tasks 1–2 (pure TypeScript; the `range` enum literal is duplicated in SQL CHECK and zod on purpose).
- Task 4 needs Tasks 2 and 3 (generated types for the new tables/RPCs, registry keys).
- Task 5 needs Tasks 3 and 4. Task 6 needs Task 4. Task 7 needs Tasks 3, 5, 6.
- Task 8 needs everything before it. Task 9 needs Task 8.

---

## Task 1: Migration — tables and KPI functions

**Depends on:** none
**Files:**
- Create: `packages/database/supabase/migrations/<timestamp>_homepage-dashboard.sql` (via `pnpm db:migrate:new homepage-dashboard`)
- Copy from (precedent): `packages/database/supabase/migrations/20260809161618_report-pins.sql` (table + owner-only RLS), `packages/database/supabase/migrations/20240927033740_job-operations-for-mes.sql:258` (`get_active_job_count` SQL function shape)

**Steps:**
1. Run `pnpm db:migrate:new homepage-dashboard` from the repo root. Never hand-pick the timestamp.
2. Paste this SQL into the generated file:

```sql
-- ============================================================
-- Homepage analytics dashboard: per-user widget visibility + page range, and
-- five read-only KPI functions for numbers Carbon never computed before.
-- Widgets are static definitions keyed by slug in
-- apps/erp/app/modules/dashboard/dashboard.models.ts, so, like reportPin, a row
-- stores an EXPLICIT value and an absent row means the registry default.
-- ============================================================

CREATE TABLE IF NOT EXISTS "userDashboardWidget" (
    "widgetKey" TEXT NOT NULL,
    "userId" TEXT NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
    "companyId" TEXT NOT NULL,
    "visible" BOOLEAN NOT NULL,
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
-- all take an explicit company id; none divides — the app computes the ratio.
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
    COALESCE(SUM("quantity") FILTER (WHERE "type" = 'Production'), 0) AS "production",
    COALESCE(SUM("quantity") FILTER (WHERE "type" = 'Scrap'), 0) AS "scrap",
    COALESCE(SUM("quantity") FILTER (WHERE "type" = 'Rework'), 0) AS "rework"
  FROM "productionQuantity"
  WHERE "companyId" = company_id
    AND "createdAt" >= start_date::TIMESTAMPTZ
    AND "createdAt" < (end_date + 1)::TIMESTAMPTZ;
$$;

-- Inbound inspections dispositioned in the window.
CREATE OR REPLACE FUNCTION get_inbound_inspection_pass_rate(
  company_id TEXT, start_date DATE, end_date DATE
)
RETURNS TABLE ("passed" INTEGER, "failed" INTEGER)
LANGUAGE sql STABLE SECURITY INVOKER
AS $$
  SELECT
    COUNT(*) FILTER (WHERE "status" = 'Passed')::INTEGER AS "passed",
    COUNT(*) FILTER (WHERE "status" = 'Failed')::INTEGER AS "failed"
  FROM "inboundInspection"
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
    COALESCE(SUM(o."quantityToSend" * COALESCE(sol."convertedUnitPrice", 0)), 0) AS "value",
    COUNT(*)::INTEGER AS "lines",
    COUNT(*) FILTER (WHERE o."promisedDate" IS NOT NULL AND o."promisedDate" < as_of)::INTEGER AS "pastDueLines"
  FROM "openSalesOrderLines" o
  JOIN "salesOrderLine" sol ON sol."id" = o."id" AND sol."companyId" = o."companyId"
  WHERE o."companyId" = company_id
    AND o."quantityToSend" > 0;
$$;

-- Overdue purchase orders: open POs with at least one line past its promised
-- date and quantity still outstanding. Returns one row per PO for the list
-- widget; the stat widget counts the rows.
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
```

3. If `purchaseOrderLine` has no `purchaseQuantity` column (check with `grep -rn '"purchaseQuantity"' packages/database/supabase/migrations/ | head -3`), STOP and report — do not guess the quantity column name.
4. Apply with `pnpm db:migrate` (requires the worktree's Docker stack: `crbn status` must show containers running).

**Verify:**
```bash
pnpm db:migrate
# Expected: the new migration is listed as applied, no ERROR lines
psql "$(grep SUPABASE_DB_URL .env.local | cut -d= -f2-)" -c '\df get_on_time_delivery' -c '\d "userDashboardWidget"'
# Expected: one function row; table with columns widgetKey, userId, companyId, visible, range
```

**Out of scope:** any change to `reportPin`, `userModulePreference`, or existing KPI routes.

---

## Task 2: Regenerate DB types

**Depends on:** Task 1
**Files:**
- Modify (generated): `packages/database/src/types.ts`, `packages/database/supabase/functions/lib/types.ts`

**Steps:**
1. `pnpm run generate:types`
2. Do not hand-edit either file. If generation fails, STOP and report.

**Verify:**
```bash
grep -c "userDashboardWidget\|userDashboardPreference\|get_on_time_delivery\|get_production_quantity_summary\|get_inbound_inspection_pass_rate\|get_open_backlog\|get_overdue_purchase_orders" packages/database/src/types.ts
# Expected: a number ≥ 7
```

**Out of scope:** committing; any other schema change.

---

## Task 3: `dashboard.models.ts` — ranges, registry, validators, payloads

**Depends on:** none (parallel-safe with Tasks 1–2)
**Files:**
- Create: `apps/erp/app/modules/dashboard/dashboard.models.ts`
- Create: `apps/erp/app/modules/dashboard/dashboard.models.test.ts`
- Create: `apps/erp/app/modules/dashboard/index.ts` (barrel: `export * from "./dashboard.models"; export * from "./dashboard.service";` — the service export is added in Task 4; create the file now with the models line only)
- Copy from (precedent): `apps/erp/app/modules/accounting/accounting.models.ts:102-155` (`analyticsReports` registry shape), `packages/utils/src/accounting.ts` (`defaultReportRange` date arithmetic with `@internationalized/date`)

**Steps:**
1. Ranges:
   ```ts
   import { CalendarDate, parseDate, startOfMonth, startOfYear } from "@internationalized/date";
   import { msg } from "@lingui/core/macro";
   import type { MessageDescriptor } from "@lingui/core";
   import { z } from "zod";

   export const DASHBOARD_RANGES = ["7d", "30d", "90d", "mtd", "qtd", "ytd", "12m"] as const;
   export type DashboardRange = (typeof DASHBOARD_RANGES)[number];
   export const DEFAULT_DASHBOARD_RANGE: DashboardRange = "30d";
   export const dashboardRangeLabels: Record<DashboardRange, MessageDescriptor> = {
     "7d": msg`Last 7 days`, "30d": msg`Last 30 days`, "90d": msg`Last 90 days`,
     mtd: msg`Month to date`, qtd: msg`Quarter to date`, ytd: msg`Year to date`, "12m": msg`Last 12 months`
   };

   /** Inclusive YYYY-MM-DD window ending on `today`, plus the same-length window immediately before it. */
   export function resolveDashboardRange(range: DashboardRange, today: string): {
     start: string; end: string; previousStart: string; previousEnd: string; bucket: "day" | "month";
   }
   ```
   Rules: `end = today`. `7d/30d/90d`: `start = today.subtract({ days: n - 1 })`. `mtd`: `startOfMonth(today)`. `qtd`: first day of the calendar quarter (`new CalendarDate(y, ((m-1) - (m-1)%3) + 1, 1)`). `ytd`: `startOfYear(today)`. `12m`: `today.subtract({ months: 12 }).add({ days: 1 })`. Previous window: `previousEnd = start.subtract({ days: 1 })`, `previousStart = previousEnd.subtract({ days: end.compare(start) })`. `bucket = "day"` when `end.compare(start) < 92`, else `"month"`. Never use JS `Date`.
2. Registry types and entries exactly as the spec's catalog table (31 widgets). `module` values are the permission keys used by `useModules`: `"sales" | "purchasing" | "production" | "quality" | "invoicing" | "inventory" | "workflows"`. Use `"workflows"` (not `"settings"`) for `workflows.failedRuns` — that is the key `useModules.tsx:150-151` gates on. `to` is a plain `string` from `path.to.*` (import `path` from `~/utils/path`): sales → `path.to.salesOrders` / `path.to.quotes`; purchasing → `path.to.purchaseOrders`; production → `path.to.jobs`; quality → `path.to.issues`; invoicing AR → `path.to.receivables`, AP → `path.to.payables`; inventory → `path.to.inventoryValuation`; workflows → `path.to.workflowRuns`.
   ```ts
   export type WidgetKind = "stat" | "trend" | "breakdown" | "list";
   export type WidgetSize = "sm" | "md" | "lg";
   export type WidgetModule = "sales" | "purchasing" | "production" | "quality" | "invoicing" | "inventory" | "workflows";
   export type WidgetValueKind = "count" | "money" | "percent" | "quantity";
   export type WidgetDefinition = {
     key: string; module: WidgetModule; kind: WidgetKind; size: WidgetSize;
     title: MessageDescriptor; description: MessageDescriptor; defaultVisible: boolean;
     supportsRange: boolean; goal?: "higher" | "lower"; valueKind?: WidgetValueKind; to?: string;
   };
   export const DASHBOARD_WIDGETS = [ /* 31 entries */ ] as const satisfies readonly WidgetDefinition[];
   export type WidgetKey = (typeof DASHBOARD_WIDGETS)[number]["key"];
   export const WIDGET_KEYS = DASHBOARD_WIDGETS.map((w) => w.key) as [WidgetKey, ...WidgetKey[]];
   export function getWidgetDefinition(key: string): WidgetDefinition | undefined
   ```
   Because `msg` is a babel macro, this file is importable only by Vite-built app code and vitest (which runs the Lingui plugin for `apps/erp`); do not import it from `packages/jobs` or scripts (lesson `.ai/lessons.md:669`).
3. Validators:
   ```ts
   export const dashboardLayoutValidator = z.object({
     widgets: z.array(z.object({ key: z.enum(WIDGET_KEYS), visible: z.boolean(), range: z.enum(DASHBOARD_RANGES).nullable() }))
   });
   export const dashboardPreferenceValidator = z.object({ range: z.enum(DASHBOARD_RANGES) });
   ```
4. Payload types (`StatPayload`, `TrendPayload`, `BreakdownPayload`, `ListPayload`, union `WidgetPayload`) exactly as the spec's API section.
5. Pure layout resolver (client- and server-safe; takes a `can` function, not the hook):
   ```ts
   export type ResolvedWidget = WidgetDefinition & { visible: boolean; range: DashboardRange | null };
   export function resolveDashboardLayout(
     can: (action: "view", module: string) => boolean | undefined,
     rows: { widgetKey: string; visible: boolean; range: string | null }[]
   ): ResolvedWidget[]
   ```
   Returns registry order, filtered to `can("view", module)`, `visible = row?.visible ?? defaultVisible`, `range = row?.range ?? null` (only if it is a valid `DashboardRange`). Rows whose key is not in the registry are ignored.
6. Delta helper: `export function percentChange(value: number, previous: number): number | null` — `null` when `previous === 0`, else `round(((value - previous) / previous) * 100)` using `round` from `@carbon/utils` at its default scale (no scale literal).
7. Tests in `dashboard.models.test.ts` (vitest): `resolveDashboardRange("30d","2026-09-05")` → `{start:"2026-08-07", end:"2026-09-05", previousStart:"2026-07-08", previousEnd:"2026-08-06", bucket:"day"}`; `qtd` on `2026-09-05` → start `2026-07-01`; `12m` on `2026-09-05` → start `2025-09-06`, bucket `"month"`; `resolveDashboardLayout` with `can` true only for `sales` returns only sales widgets, honours a `visible:false` row, ignores an unknown key, and ignores an invalid range string; `percentChange(10000, 8000) === 25`, `percentChange(5, 0) === null`.

**Verify:**
```bash
pnpm --filter erp test -- app/modules/dashboard/dashboard.models.test.ts
# Expected: all tests pass, 0 failed
```

**Out of scope:** any service or UI code; changing `analyticsReports`.

---

## Task 4: `dashboard.service.ts` — layout CRUD and widget data

**Depends on:** Tasks 2, 3
**Files:**
- Create: `apps/erp/app/modules/dashboard/dashboard.service.ts`
- Modify: `apps/erp/app/modules/dashboard/index.ts` — add `export * from "./dashboard.service";`
- Copy from (precedent): `apps/erp/app/modules/users/users.server.ts:833-864` (`getModulePreferences` / `upsertModulePreferences`), `apps/erp/app/routes/api+/sales.kpi.$key.ts` (windowed queries + previous period), `apps/erp/app/routes/x+/quality+/_index.tsx:155-200` (issue counts), `apps/erp/app/routes/x+/purchasing+/_index.tsx:87-102` (open-status constants), `apps/erp/app/modules/invoicing/invoicing.service.ts:2440-2475` (`getArAging`/`getApAging`), `apps/erp/app/modules/inventory/inventory.service.ts:340-350` (`getInventoryValuation`), `apps/erp/app/routes/api+/quality.kpi.$key.ts:165-195` (`paretoByType`), `apps/erp/app/routes/api+/production.kpi.$key.ts:62-120` (`utilization`)

**Steps:**
1. Layout/preference functions, each `(client: SupabaseClient<Database>, userId, companyId, …)` returning the raw supabase response:
   - `getDashboardLayout(client, userId, companyId)` → `from("userDashboardWidget").select("widgetKey, visible, range").eq("userId", userId).eq("companyId", companyId)`
   - `getDashboardPreference(client, userId, companyId)` → `from("userDashboardPreference").select("range")…maybeSingle()`
   - `upsertDashboardWidgets(client, userId, companyId, rows: { key; visible; range }[])` → `upsert(rows.map(r => ({ widgetKey: r.key, userId, companyId, visible: r.visible, range: r.range, createdBy: userId, updatedBy: userId, updatedAt: datetime.timestamp() })), { onConflict: "widgetKey,userId,companyId" })`
   - `upsertDashboardPreference(client, userId, companyId, range)` → `upsert({ userId, companyId, range, updatedAt }, { onConflict: "userId,companyId" })`
2. Window type and dispatcher:
   ```ts
   export type WidgetWindow = { start: string; end: string; previousStart: string; previousEnd: string; bucket: "day" | "month"; today: string };
   export async function getWidgetData(client, args: { key: WidgetKey; companyId: string; userId: string; window: WidgetWindow }): Promise<WidgetPayload>
   ```
   A `switch (args.key)` with one arm per registry key; the switch must have no `default` arm so an unhandled key is a type error (`.ai/lessons.md:625`). Query rules per widget:
   - **Open counts** (`sales.openOrders`, `sales.openQuotes`, `purchasing.openOrders`, `production.activeJobs`, `quality.openIssues`): `select("id", { count: "exact", head: true }).eq("companyId", companyId).in("status", STATUSES)`. Copy the status arrays verbatim from the module dashboards: sales `OPEN_SALES_ORDER_STATUSES` / `OPEN_QUOTE_STATUSES` (`x+/sales+/_index.tsx:70-84`), purchasing `OPEN_PURCHASE_ORDER_STATUSES` (`x+/purchasing+/_index.tsx:94-102`), production `ACTIVE_JOB_STATUSES` (import from `~/modules/production`, `production.models.ts:1622`), quality `["Registered","In Progress"]` on the `issues` view.
   - **Ranged money stats** (`sales.revenue`, `purchasing.spend`): select `orderTotal, orderDate` from the `salesOrders` / `purchaseOrders` views with `.gte("orderDate", start).lte("orderDate", end)`, sum `orderTotal` in TS; repeat for the previous window → `{ value, previous }`.
   - **Trends** (`sales.revenueTrend`, `purchasing.spendTrend`, `quality.issuesTrend`): same rows, bucketed with `groupDataByDay` / `groupDataByMonth` from `~/utils/chart` on `window.bucket`; `points = Object.entries(grouped).map(([key, rows]) => ({ key, label: key, value: sum }))`.
   - `sales.onTimeDelivery`: `client.rpc("get_on_time_delivery", { company_id, start_date: start, end_date: end })` and again for the previous window; `value = onTime/shipped*100` (TS, `round`), `null` numerator → value 0 and `empty: true`.
   - `sales.openBacklog`: `rpc("get_open_backlog", { company_id, as_of: window.today })` → `{ value, description: pastDueLines }` (StatPayload gets an optional `detail?: number`).
   - `purchasing.overdueOrders` / `purchasing.overdueList`: `rpc("get_overdue_purchase_orders", { company_id, as_of: today })`; count rows / map first 8 rows to `ListPayload` with `to: path.to.purchaseOrder(id)`.
   - `purchasing.bySupplier`: `purchaseOrders` view rows in range, group by `supplierId`, join names via `from("supplier").select("id,name").in("id", ids)` (one call), top 8.
   - `production.lateJobs`: `from("job").select("id", {count:"exact", head:true}).eq("companyId").lt("dueDate", today).in("status", ACTIVE_JOB_STATUSES)`.
   - `production.assignedToMe`: `rpc("get_active_job_count", { employee_id: userId, company_id: companyId })`.
   - `production.dueThisWeek`: `from("jobs").select("id, jobId, itemReadableIdWithRevision, dueDate, status").eq("companyId").in("status", ACTIVE_JOB_STATUSES).gte("dueDate", today).lte("dueDate", today+6d).order("dueDate").limit(8)` → `ListPayload` with `to: path.to.job(id)`.
   - `production.byStatus`: `from("job").select("status").eq("companyId").in("status", ACTIVE_JOB_STATUSES)`, count in TS.
   - `production.utilization`: extract the body of the `utilization` case from `api+/production.kpi.$key.ts:62-120` into `getUtilizationSeries(client, companyId, start, end)` in `apps/erp/app/modules/production/production.service.ts` and call it from both places (route keeps its behaviour); map to `TrendPayload`.
   - `production.scrapRate` / `production.firstPassYield`: `rpc("get_production_quantity_summary", …)` current and previous; scrap = `scrap/(production+scrap)*100`; FPY = `production/(production+rework+scrap)*100`.
   - `quality.issuesByType`: extract `paretoByType` body (`quality.kpi.$key.ts:165-195`) into `getIssueCountsByType(client, companyId, start, end)` in `quality.service.ts`; map top 8 to `BreakdownPayload`.
   - `quality.inboundPassRate`: `rpc("get_inbound_inspection_pass_rate", …)` → `passed/(passed+failed)*100`.
   - `invoicing.ar*` / `invoicing.ap*`: `getArAging(client, companyId, today, {})` / `getApAging`; outstanding = sum of every row's total; overdue = sum of buckets past due — reuse `overdueOf` from `InvoicingDashboard.tsx` by moving it to `invoicing.models.ts` as an exported pure function (`InvoicingDashboard.tsx` imports it from there afterwards).
   - `inventory.value`: `getInventoryValuation(client, companyId, { asOfDate: today })`, sum `totalValue`.
   - `workflows.failedRuns`: `from("workflowRun").select("id", {count:"exact", head:true}).eq("companyId").eq("status","Failed").gte("completedAt", start).lt("completedAt", end + 1 day)`, and previous.
   - `sales.assignedToMe`: `getSalesDocumentsAssignedToMe(client, userId, companyId)` → first 8 → `ListPayload` (`to` by `type`: `path.to.salesOrder(id)` / `path.to.quote(id)` / `path.to.salesRfq(id)`).
3. Every query includes `.eq("companyId", companyId)`; never a query inside a loop.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: 0 errors (the exhaustive switch fails typecheck if a registry key has no arm)
```

**Out of scope:** changing what `production.kpi` / `quality.kpi` routes return; new SQL beyond Task 1.

---

## Task 5: API routes and path entries

**Depends on:** Tasks 3, 4
**Files:**
- Create: `apps/erp/app/routes/api+/dashboard.widget.$key.ts`
- Create: `apps/erp/app/routes/api+/dashboard.layout.ts`
- Create: `apps/erp/app/routes/api+/dashboard.preference.ts`
- Modify: `apps/erp/app/utils/path.ts` — inside `api: {` add `dashboardWidget: (key: string) => generatePath(\`${api}/dashboard/widget/${key}\`)`, `dashboardLayout: \`${api}/dashboard/layout\``, `dashboardPreference: \`${api}/dashboard/preference\``
- Copy from (precedent): `apps/erp/app/routes/api+/sales.kpi.$key.ts:1-60` (param parsing, 500-day cap), `apps/erp/app/routes/api+/module-preferences.tsx` (JSON POST + upsert)

**Steps:**
1. `dashboard.widget.$key.ts` loader: `const def = getWidgetDefinition(params.key)`; if none → `throw data({ error: "Unknown widget" }, { status: 404 })`. Then `const { client, companyId, userId } = await requirePermissions(request, { view: def.module })`. Read `start`, `end` (`YYYY-MM-DD`), `today`; validate with `parseDate`; if `end.compare(start) < 0 || > 500` return an empty payload for the kind. Derive `previousStart/previousEnd/bucket` with the same arithmetic as `resolveDashboardRange` (export a helper `windowFromDates(start, end, today)` from models). Return `getWidgetData(...)`.
2. `dashboard.layout.ts` action: `assertIsPost`; `requirePermissions(request, {})`; `dashboardLayoutValidator.safeParse(await request.json())` → 400 on failure; `upsertDashboardWidgets`; return `{ success: true }` or 500 with `error.message`.
3. `dashboard.preference.ts` action: same shape with `dashboardPreferenceValidator` and `upsertDashboardPreference`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: 0 errors
```

**Out of scope:** UI; the home loader.

---

## Task 6: Home loader additions

**Depends on:** Task 4
**Files:**
- Modify: `apps/erp/app/routes/x+/_index.tsx` — loader only

**Steps:**
1. Destructure `userId` from `requirePermissions`. Alongside the existing greeting computation add:
   ```ts
   const today = datetime.today(tz).toString();
   const [layout, preference] = await Promise.all([
     getDashboardLayout(client, userId, companyId),
     getDashboardPreference(client, userId, companyId)
   ]);
   const url = new URL(request.url);
   const urlRange = url.searchParams.get("range");
   const range = DASHBOARD_RANGES.includes(urlRange as DashboardRange) ? (urlRange as DashboardRange)
     : (preference.data?.range as DashboardRange | undefined) ?? DEFAULT_DASHBOARD_RANGE;
   return { greeting, agentDismissed, dashboard: { rows: layout.data ?? [], range, today } };
   ```
2. Import from `~/modules/dashboard`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: 0 errors
```

**Out of scope:** the component body (Task 7).

---

## Task 7: UI — section, range select, widgets, catalog drawer

**Depends on:** Tasks 3, 5, 6
**Files:**
- Create: `apps/erp/app/modules/dashboard/ui/DashboardSection.tsx`
- Create: `apps/erp/app/modules/dashboard/ui/DashboardRangeSelect.tsx`
- Create: `apps/erp/app/modules/dashboard/ui/DashboardWidget.tsx` (shell + fetcher + kind switch)
- Create: `apps/erp/app/modules/dashboard/ui/StatWidget.tsx`, `TrendWidget.tsx`, `BreakdownWidget.tsx`, `ListWidget.tsx`
- Create: `apps/erp/app/modules/dashboard/ui/DashboardCatalogDrawer.tsx`
- Create: `apps/erp/app/modules/dashboard/ui/index.ts`
- Modify: `apps/erp/app/routes/x+/_index.tsx` — render `<DashboardSection>` after the closing `</div>` of the `grid-cols-1 lg:grid-cols-3` block (line ~246)
- Copy from (precedent): `apps/erp/app/components/MetricCard.tsx` (stat card), `apps/erp/app/routes/x+/sales+/_index.tsx:150-330,500-560` (fetcher load with `start`/`end`, `ChartContainer` + `BarChart`, delta arithmetic), `apps/erp/app/routes/x+/person+/$personId.timecard.tsx:537-556` (`Select` / `SelectTrigger size="sm"` / `SelectContent` / `SelectItem`), `apps/erp/app/modules/accounting/ui/PaymentTerms/PaymentTermForm.tsx:78-120` (`ModalDrawer*` with footer buttons), `apps/erp/app/components/Layout/Navigation/useNavigationEditMode.tsx` (draft / isDirty / save shape), `apps/erp/app/routes/x+/_index.tsx:392-460` (`RecentDocumentRow`, `SectionLabel` styling)

**Steps:**
1. `DashboardSection` props: `{ rows, range, today }` from loader data. Compute `const widgets = resolveDashboardLayout(permissions.can, rows)` with `usePermissions()`. If `widgets.length === 0` render nothing. Header: `<SectionLabel><Trans>Analytics</Trans></SectionLabel>` on the left; right side `<DashboardRangeSelect value={range} />` and an `IconButton aria-label={t\`Customize widgets\`} icon={<LuPencil />} variant="ghost" size="sm"` that opens the drawer. Grid: `grid grid-cols-1 lg:grid-cols-3 gap-4`, size classes `sm → ""`, `md → "lg:col-span-2"`, `lg → "lg:col-span-3"`. Render `widgets.filter(w => w.visible)`. If none visible, one `Card` with `Empty` and a `Button` "Add widgets" opening the drawer. Wrap in `mb-8`.
2. `DashboardRangeSelect`: `Select` with the seven presets labelled via `i18n._(dashboardRangeLabels[r])`. `onValueChange`: `setParams({ range: value })` from `useUrlParams()` AND `fetcher.submit(JSON.stringify({ range: value }), { method: "post", action: path.to.api.dashboardPreference, encType: "application/json" })`.
3. `DashboardWidget` props `{ widget: ResolvedWidget; pageRange: DashboardRange; today: string }`. Effective range = `widget.range ?? pageRange`; `const w = resolveDashboardRange(effectiveRange, today)`; `useEffect` → `fetcher.load(\`${path.to.api.dashboardWidget(widget.key)}?start=${w.start}&end=${w.end}&today=${today}\`)` keyed on `widget.key, w.start, w.end`. Shell is `Card` with `CardHeader` (title via `i18n._(widget.title)`, `View` link button when `widget.to`, and when `widget.supportsRange` a `DropdownMenu` (`LuEllipsisVertical`) listing the seven presets plus `Follow page`, each item posting `{ widgets: [{ key, visible: true, range }] }` to `path.to.api.dashboardLayout` with `encType: "application/json"` then `revalidator.revalidate()`). A muted caption `i18n._(dashboardRangeLabels[widget.range])` under the title when overridden. Body: `Skeleton` while `fetcher.state !== "idle" || !fetcher.data`, else the kind component.
4. `StatWidget`: value formatted by `valueKind` — `money` → `useCurrencyFormatter()`, `percent` → `usePercentFormatter()` on `value / 100`, `quantity` → `useQuantityFormatter()`, `count` → `useNumberFormatter({ maximumFractionDigits: 0 })` is NOT allowed (inline digits) — use `useQuantityFormatter()` for counts too. Value in `text-4xl font-medium tracking-tighter tabular-nums` (same as `MetricCard`). Delta: `percentChange(value, previous)`; render `▲ 25% vs prior period` in `text-emerald-600` when the change direction matches `goal` (`higher` and positive, or `lower` and negative), `text-red-600` when it opposes, `text-muted-foreground` when `goal` is unset or change is `null`/0. `detail` (backlog past-due lines) renders as the `MetricCard` description line.
5. `TrendWidget`: `ChartContainer` config `{ value: { color: "hsl(var(--primary))" } }`, recharts `AreaChart` with `XAxis dataKey="label"` and `Area dataKey="value" type="monotone"`, height class `h-40`. `BreakdownWidget`: `BarChart layout="vertical"` with `YAxis dataKey="name" type="category" width={120}` and `Bar dataKey="value"`. `ListWidget`: up to 8 rows styled like `RecentDocumentRow` (`flex items-center gap-3 p-3 rounded-lg border`), each a `Link to={row.to}` with title, subtitle, optional `Badge` status and `formatRelativeTime(dueDate)` when present; empty → `Empty`.
6. `DashboardCatalogDrawer` props `{ open, onClose, widgets: ResolvedWidget[] }`. Draft state seeded from `widgets` on open; group by module with the module name from `useModules()` (`name` of the entry whose `key`/`permission` equals `widget.module`); each row `Switch` toggling `visible`; footer `Cancel` + `Save` (`isDisabled={!isDirty}`, `isLoading` while the fetcher is submitting). Save posts `{ widgets: draft.map(({ key, visible, range }) => ({ key, visible, range })) }` to `path.to.api.dashboardLayout` with `encType: "application/json"`; on `fetcher.data?.success` call `revalidator.revalidate()` and `onClose()`.
7. All strings through Lingui (`t`/`Trans`/`msg`). Icons from `react-icons/lu`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp && pnpm run lint
# Expected: 0 type errors; biome reports no errors
```

**Out of scope:** drag-and-drop, resizing, MES, module dashboards.

---

## Task 8: Validation gates

**Depends on:** Tasks 1–7
**Files:** none new

**Steps:**
1. `pnpm run lint`
2. `pnpm exec turbo run typecheck --filter=erp --filter=@carbon/database`
3. `pnpm --filter erp test -- app/modules/dashboard`
4. `pnpm db:check:datasets` and `pnpm db:check:backups` (both need the migrated local DB).
5. `pnpm --filter @carbon/checks` conformance (if a `check` script exists at the root, run `pnpm run check`; otherwise skip and note it).
6. Run `/translate` only if the `.po` catalogs report missing strings (`pnpm --filter @carbon/locale extract` then inspect).

**Verify:**
```bash
pnpm run lint && pnpm exec turbo run typecheck --filter=erp && pnpm --filter erp test -- app/modules/dashboard
# Expected: every command exits 0
```

**Out of scope:** committing — that is the `/check-and-commit` skill, and only on the user's explicit ask.

---

## Task 9: Browser verification

**Depends on:** Task 8
**Files:** none

**Steps:**
1. Ask the user before opening a browser (memory: no browser unless asked). If approved: `crbn up` with the ERP app, `/auth`, then `/test` against the acceptance criteria in the spec: default widgets per permission, range change persists, per-widget override caption, catalog save/cancel, 403/404 on the widget API.

**Verify:**
```bash
# /test run record in .ai/runs/ shows each acceptance criterion PASS
```

**Out of scope:** any code change discovered here goes back through Task 7, not a hot-fix in the browser session.
