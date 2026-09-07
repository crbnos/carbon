# Homepage Analytics Dashboard

> Status: in-progress
> Author: naveenkash
> Date: 2026-09-05
> Research: `.ai/research/homepage-analytics-dashboard.md`

## TLDR

Add an **Analytics** section at the bottom of the ERP home page (`/x`) made of
pre-built widgets: stat tiles with a delta vs the prior period, small trend charts,
top-N breakdowns, and short action lists. Widgets are defined in code in a typed
registry; each declares the module permission it needs. A page-wide time-range
select drives every widget, and any widget can override it. Users choose which
widgets are shown (show/hide from a catalog); order and size are fixed by the
registry. The choice is stored per user per company in a new `userDashboardWidget`
table following the `reportPin` pattern. A first-time user sees a curated default
subset derived from their permissions. The feature is available on every plan and
edition. Four job-shop KPIs that Carbon has never computed — on-time delivery,
scrap rate, first-pass yield, and open backlog — ship as new read-only RPCs.

## Problem Statement

The home page today is a greeting, a search bar, the module cards, and a Recent
list. It shows no operational numbers. To learn "how many jobs are late" or "what
is AR overdue" a user opens each module dashboard in turn (`/x/sales`,
`/x/purchasing`, `/x/production`, `/x/quality`, `/x/invoicing`), each with its own
date picker. Every competitor surveyed (SAP My Home, NetSuite portlets, Epicor
Kinetic home, MRPeasy, Cloudflare Custom Dashboards) puts a personalizable set of
KPIs on the landing page. Carbon already has the data endpoints, the chart
primitives, and a per-user layout-preference pattern; nothing composes them on
the home page.

## Proposed Solution

A `dashboard` module (`apps/erp/app/modules/dashboard/`) owning:

1. **A widget registry** — `dashboard.models.ts` exports `DASHBOARD_WIDGETS`, a
   `readonly` array of `WidgetDefinition`:
   ```ts
   type WidgetKind = "stat" | "trend" | "breakdown" | "list";
   type WidgetSize = "sm" | "md" | "lg"; // 1/3, 2/3, full of the lg:grid-cols-3 grid
   type WidgetDefinition = {
     key: WidgetKey;                 // stable string literal, e.g. "sales.openOrders"
     module: Module;                 // permission module gating catalog, default, and data
     kind: WidgetKind;
     size: WidgetSize;               // fixed; not user-adjustable
     title: MessageDescriptor;       // Lingui msg`…`
     description: MessageDescriptor;
     defaultVisible: boolean;        // curated default subset (Q4)
     goal?: "higher" | "lower";      // stat delta colouring
     valueKind?: "count" | "money" | "percent" | "quantity"; // formatter kind
     supportsRange: boolean;         // false for "as of now" stats (open counts, AR aging, inventory value)
     to?: (companyRoutes) => string; // drill-down link
   };
   ```
   Registry order is the render order. Keys are namespaced by module so a later
   rename of a module keeps old keys readable.
2. **A layout table** `userDashboardWidget` — one row per widget the user has
   explicitly toggled, `visible BOOLEAN NOT NULL`. Absent row = `defaultVisible`.
3. **One data route** `api+/dashboard.widget.$key.ts` — returns the payload for one
   widget for a `start`/`end` window, gated on the widget's module permission.
4. **A home-page section** rendered below the Modules/Recent grid: range select,
   edit toggle, widget grid, catalog drawer.
5. **Four new RPCs** for the KPIs with no existing query: `get_on_time_delivery`,
   `get_scrap_rate`, `get_first_pass_yield`, `get_open_backlog`.

### Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Where widgets are defined | Typed registry in `dashboard.models.ts`, not DB rows | Every surveyed ERP ships a curated catalog; no user-authored KPIs on a home page. Keeps every widget fast, translated, and permission-tagged at compile time. |
| Placement | New section at the **bottom** of `/x`, below Recent + Modules (Q1) | User decision, mirrors Cloudflare's overview: quick actions first, analytics below. Existing home content is untouched. |
| User control | **Show/hide + drag-to-reorder** (Q2, revised 2026-09-07); size fixed by the registry | User decision. Order is one `widgetOrder TEXT[]` on the preference row, saved on drop. Hide is in each card's menu; the catalog (opened by "Add widgets") remains the way to re-add. |
| Layout storage | New `userDashboardWidget(widgetKey, userId, companyId, visible)`, PK `(widgetKey, userId, companyId)`, absent row = registry default | Exact `reportPin` shape: explicit override over a code default. Per user per company, DB-backed — Carbon never persists layout in localStorage (`useRecentlyViewed` comment; `tableView` precedent). |
| Default layout | Registry `defaultVisible` flag, then filtered by `permissions.can("view", module)` (Q4 option 2) | A permission-only default would render ~25 widgets for an owner. Admin-published company defaults (NetSuite Publish) are a later spec. |
| Time range | Page-wide range select in the URL (`?range=`) and persisted per user; **per-widget override** allowed (Q3 option 3) | User decision. Override is stored in `userDashboardWidget.range` so it survives reloads with the visibility row. |
| Range presets | `7d`, `30d`, `90d`, `mtd`, `qtd`, `ytd`, `12m` | Presets only, no custom dates — a home page, not a report. Resolved server-side against the company timezone with `@internationalized/date`; no JS `Date`. |
| Range persistence | `userDashboardPreference` row per user per company: `range` | One row, not a column on every widget row. Absent = `30d`. |
| Data loading | Each widget calls `api/dashboard/widget/:key?start&end` via `useFetcher` after mount; the home loader loads only layout + preference | Mirrors the five module dashboards; the home page SSR never waits on 20 queries. |
| Data route permissions | `requirePermissions(request, { view: widget.module })` per request, resolved from the registry by key | The route's own permission check cannot be static because widgets span modules. Unknown key → 404; forbidden → 403. |
| Delta vs prior period | Every `supportsRange` stat returns `{ value, previous }`; prior period = same length immediately before `start` | Same arithmetic as `sales.kpi.$key.ts`. `goal` decides whether an increase renders positive or negative. |
| Stat formatting | `valueKind` picks the `@carbon/utils` formatter kind (`formatMoney` / `formatPercent` / `formatQuantity` / integer count) | `numeric-precision.md`: named kinds only, never inline fraction digits. Money uses the company base currency and `currency.decimalPlaces`. |
| Charts | `@carbon/react/Chart` (`ChartContainer`, recharts `AreaChart`/`BarChart`) | Already used by module dashboards; no new dependency. |
| Plan / edition gating | **None** (Q6) | User decision. All data is already visible on module dashboards to anyone with view permission. |
| Module folder | New `apps/erp/app/modules/dashboard/` with no permission family | Cross-module by nature; `agent` is the precedent for a module folder without its own permission. Lesson "features live inside existing permission modules" is about *domain* features; every widget's data still belongs to its domain module's permission. |
| New KPIs | `get_on_time_delivery`, `get_scrap_rate`, `get_first_pass_yield`, `get_open_backlog` as `security_invoker` SQL functions (Q5) | User decision: all four, limited to data that exists. Each is computable from current columns (see Data Model). Company-scoped via `companyId` argument and RLS on the underlying tables. |
| Unknown / forbidden saved keys | Skipped silently on read; rows are never deleted by the reader | A widget removed from the registry or a revoked permission must not error the home page. |
| Empty data | Widget renders the `Empty` component with a one-line prompt and its drill-down link | Cloudflare Teams Home pattern: empty state carries an action. |
| Heuristic 1 multi-tenancy | `userDashboardWidget` and `userDashboardPreference` carry `companyId`; PK is the natural key `(widgetKey, userId, companyId)` / `(userId, companyId)` | Same as `reportPin` and `userModulePreference` — preference tables key on the natural tuple, not `id('prefix')`. |
| Heuristic 2 service shape | `getDashboardLayout`, `upsertDashboardWidgets`, `upsertDashboardPreference`, one `getWidgetData` dispatcher — all `(client, …) → { data, error }` | Module convention. |
| Heuristic 3 RLS | Owner-only policies on both tables, company membership via `get_companies_with_employee_role()` | Copied from `reportPin`. |
| Heuristic 4 permissions | Home loader: `requirePermissions(request, {})`; layout API: `requirePermissions(request, {})` (own rows only); widget data: `{ view: widget.module }` | Personal preferences need no module permission; data does. |
| Heuristic 5 forms | Edit mode posts JSON to `api/dashboard/layout` from a fetcher, no `ValidatedForm` | Same as `api/module-preferences`; a switch list is not a form. Payload validated with `dashboardLayoutValidator` (zod) in the action. |
| Heuristic 6 module layout | `dashboard.models.ts`, `dashboard.service.ts`, `index.ts`, `ui/` | Convention. |
| Heuristic 7 backward compatibility | No frozen surface touched; new tables, new route, new RPCs; existing KPI routes unchanged | Additive only. |

## Data Model Changes

### `userDashboardWidget`

```sql
-- Per-user show/hide override and optional range override for one dashboard
-- widget. Widgets are static definitions keyed by slug in
-- apps/erp/app/modules/dashboard/dashboard.models.ts, so, like reportPin, a row
-- stores an EXPLICIT value and an absent row means the registry default.
CREATE TABLE "userDashboardWidget" (
    "widgetKey" TEXT NOT NULL,
    "userId" TEXT NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
    "companyId" TEXT NOT NULL,
    "visible" BOOLEAN NOT NULL,
    "range" TEXT,                      -- per-widget override; NULL = follow page range

    "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "updatedBy" TEXT REFERENCES "user"("id"),
    "updatedAt" TIMESTAMP WITH TIME ZONE,

    PRIMARY KEY ("widgetKey", "userId", "companyId"),
    FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE,
    CONSTRAINT "userDashboardWidget_range_check"
      CHECK ("range" IS NULL OR "range" IN ('7d','30d','90d','mtd','qtd','ytd','12m'))
);

CREATE INDEX "userDashboardWidget_userId_companyId_idx"
  ON "userDashboardWidget" ("userId", "companyId");

ALTER TABLE "userDashboardWidget" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "SELECT" ON "userDashboardWidget" FOR SELECT USING (
  (SELECT auth.uid())::text = "userId"
  AND "companyId" = ANY ((SELECT get_companies_with_employee_role())::text[])
);
CREATE POLICY "INSERT" ON "userDashboardWidget" FOR INSERT WITH CHECK (
  (SELECT auth.uid())::text = "userId"
  AND "companyId" = ANY ((SELECT get_companies_with_employee_role())::text[])
);
CREATE POLICY "UPDATE" ON "userDashboardWidget" FOR UPDATE USING (
  (SELECT auth.uid())::text = "userId"
  AND "companyId" = ANY ((SELECT get_companies_with_employee_role())::text[])
);
CREATE POLICY "DELETE" ON "userDashboardWidget" FOR DELETE USING (
  (SELECT auth.uid())::text = "userId"
  AND "companyId" = ANY ((SELECT get_companies_with_employee_role())::text[])
);
```

### `userDashboardPreference`

```sql
-- One row per user per company: the page-wide time range. Absent = '30d'.
CREATE TABLE "userDashboardPreference" (
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
-- RLS: identical four owner-only policies as userDashboardWidget.
```

### New RPCs (all `LANGUAGE sql STABLE SECURITY INVOKER`, args `(company_id TEXT, start_date DATE, end_date DATE)`)

| Function | Definition | Source columns (verified) |
|---|---|---|
| `get_on_time_delivery` | `on_time / shipped` over `salesOrderLine` rows with `sentDate` in range and `promisedDate IS NOT NULL`; on time = `sentDate <= promisedDate`. Returns `(shipped INT, on_time INT)`. | `salesOrderLine.sentDate` (`20250209170952_shipment.sql`), `salesOrderLine.promisedDate` |
| `get_scrap_rate` | `scrap / (production + scrap)` over `productionQuantity` rows with `createdAt` in range, by `type`. Returns `(production NUMERIC, scrap NUMERIC, rework NUMERIC)`. | `productionQuantity.type` enum `Production | Scrap | Rework`, `createdAt` |
| `get_first_pass_yield` | `production / (production + rework + scrap)` from the same rows as `get_scrap_rate` — one function serves both widgets. | same |
| `get_inspection_pass_rate` | `passed / (passed + failed)` over `inspection` with `dispositionedAt` in range (Passed vs Failed). Separate widget from production FPY. | `inspection.status` enum `inspectionStatusType`, `dispositionedAt` |
| `get_open_backlog` | `SUM(quantityToSend × convertedUnitPrice)` over `openSalesOrderLines` (already filtered to `To Ship` / `To Ship and Invoice`), plus count of lines with `promisedDate < CURRENT company day`. Not range-driven (`supportsRange: false`). Returns `(value NUMERIC, lines INT, past_due_lines INT)`. | `openSalesOrderLines.quantityToSend`, `salesOrderLine.convertedUnitPrice` (base currency, generated) |

Scrap rate and FPY are reported on **operation-level production quantities**, not job header `quantityScrapped`, because only `productionQuantity` carries a timestamp for windowing. Percentages are computed in TypeScript from the returned numerators and denominators with `round()` from `@carbon/utils` at internal scale; the SQL never divides.

### Generated types

`pnpm run generate:types` after the migration; both tables and all five functions must appear in `@carbon/database` before typecheck.

## API / Service Changes

### `apps/erp/app/modules/dashboard/dashboard.models.ts`

- `DASHBOARD_RANGES = ["7d","30d","90d","mtd","qtd","ytd","12m"] as const` and `resolveDashboardRange(range, todayInCompanyTz): { start, end, previousStart, previousEnd }` using `@internationalized/date`.
- `DASHBOARD_WIDGETS` registry (see catalog below) and `WidgetKey` union derived from it.
- `dashboardLayoutValidator = z.object({ widgets: z.array(z.object({ key: z.enum(keys), visible: z.boolean(), range: z.enum(DASHBOARD_RANGES).nullable() })) })`.
- `dashboardPreferenceValidator = z.object({ range: z.enum(DASHBOARD_RANGES) })`.
- Payload types per kind: `StatPayload { value: number; previous?: number }`, `TrendPayload { points: { key: string; label: string; value: number }[] }`, `BreakdownPayload { rows: { name: string; value: number; to?: string }[] }`, `ListPayload { rows: { id: string; title: string; subtitle?: string; status?: string; dueDate?: string; to: string }[] }`.

### `apps/erp/app/modules/dashboard/dashboard.service.ts`

- `getDashboardLayout(client, userId, companyId)` → rows from `userDashboardWidget`.
- `getDashboardPreference(client, userId, companyId)` → `maybeSingle()`.
- `upsertDashboardWidgets(client, userId, companyId, rows)` → `upsert(..., { onConflict: "widgetKey,userId,companyId" })`.
- `upsertDashboardPreference(client, userId, companyId, range)`.
- `getWidgetData(client, { key, companyId, userId, start, end, previousStart, previousEnd })` → a `switch` on `key` that calls the per-widget query. Existing module service functions are reused where they exist (`getArAging`, `getApAging`, `get_inventory_valuation`, `getSalesDocumentsAssignedToMe`, the open-status constants from each module dashboard). The five new RPCs are called with `client.rpc(...)`.
- `resolveDefaultLayout(permissions, rows)` (pure, tested): registry filtered by `permissions.can("view", module)`, visibility = row override ?? `defaultVisible`, range = row override ?? null.

### Routes

| Route | Method | Permission | Purpose |
|---|---|---|---|
| `x+/_index.tsx` (existing) | loader | `{}` | Adds `dashboard: { layout, range, today }` to loader data; nothing else changes. |
| `api+/dashboard.widget.$key.ts` | GET | `{ view: widget.module }` resolved from the registry; 404 on unknown key | Parses `start`, `end` (`YYYY-MM-DD`), computes prior window, returns the kind's payload. Window capped at 500 days like the KPI routes. |
| `api+/dashboard.layout.ts` | POST | `{}` | Validates `dashboardLayoutValidator`, calls `upsertDashboardWidgets`. Keys not in the registry are rejected with 400. |
| `api+/dashboard.preference.ts` | POST | `{}` | Validates `dashboardPreferenceValidator`, upserts the page range. |

`path.to.api.dashboardWidget(key)`, `path.to.api.dashboardLayout`, `path.to.api.dashboardPreference` added to `utils/path.ts`.

### Widget catalog (v1)

`defaultVisible` marks the curated first-render subset (Q4). All are filtered by the module's `view` permission.

| Key | Module | Kind | Size | Range | Default | Source |
|---|---|---|---|---|---|---|
| `sales.openOrders` | sales | stat (count) | sm | no | ✓ | `salesOrder` count in `OPEN_SALES_ORDER_STATUSES` |
| `sales.openQuotes` | sales | stat (count) | sm | no | ✓ | `quote` count in `OPEN_QUOTE_STATUSES` |
| `sales.revenue` | sales | stat (money, goal higher) | sm | yes | ✓ | `salesOrders.orderTotal` by `orderDate` in range, with previous |
| `sales.revenueTrend` | sales | trend | md | yes | ✓ | same, bucketed by day (≤ 90d) or month |
| `sales.onTimeDelivery` | sales | stat (percent, goal higher) | sm | yes | ✓ | `get_on_time_delivery` |
| `sales.openBacklog` | sales | stat (money) with "N lines past due" description | sm | no | ✓ | `get_open_backlog` |
| `sales.assignedToMe` | sales | list | md | no | | `getSalesDocumentsAssignedToMe` |
| `purchasing.openOrders` | purchasing | stat (count) | sm | no | ✓ | `purchaseOrder` open statuses |
| `purchasing.overdueOrders` | purchasing | stat (count, goal lower) | sm | no | ✓ | open POs whose `purchaseOrderLine.promisedDate` < today with quantity outstanding |
| `purchasing.spend` | purchasing | stat (money) | sm | yes | | `purchaseOrders` total by `orderDate` in range |
| `purchasing.spendTrend` | purchasing | trend | md | yes | | same, bucketed |
| `purchasing.bySupplier` | purchasing | breakdown | md | yes | | top 8 suppliers by PO total in range |
| `purchasing.overdueList` | purchasing | list | md | no | ✓ | overdue POs, oldest first, max 8 |
| `production.activeJobs` | production | stat (count) | sm | no | ✓ | `job` in `Ready | In Progress | Paused` |
| `production.lateJobs` | production | stat (count, goal lower) | sm | no | ✓ | `job.dueDate < today` and not `Completed | Cancelled` |
| `production.assignedToMe` | production | stat (count) | sm | no | | `get_active_job_count(userId, companyId)` |
| `production.dueThisWeek` | production | list | md | no | ✓ | jobs with `dueDate` in the next 7 company days, max 8 |
| `production.byStatus` | production | breakdown | md | no | | job count by status |
| `production.utilization` | production | trend | md | yes | | reuse `production.kpi` `utilization` query |
| `production.scrapRate` | production | stat (percent, goal lower) | sm | yes | ✓ | `get_scrap_rate` |
| `production.firstPassYield` | production | stat (percent, goal higher) | sm | yes | | `get_scrap_rate` (production / total) |
| `quality.openIssues` | quality | stat (count, goal lower) | sm | no | ✓ | `issues` view open statuses |
| `quality.issuesTrend` | quality | trend | md | yes | | issues opened per bucket |
| `quality.issuesByType` | quality | breakdown | md | yes | ✓ | reuse `quality.kpi` `paretoByType` query |
| `quality.inspectionPassRate` | quality | stat (percent, goal higher) | sm | yes | | `get_inspection_pass_rate` |
| `invoicing.arOutstanding` | invoicing | stat (money) | sm | no | ✓ | `getArAging` total |
| `invoicing.arOverdue` | invoicing | stat (money, goal lower) | sm | no | ✓ | `getArAging` past-due buckets |
| `invoicing.apOutstanding` | invoicing | stat (money) | sm | no | | `getApAging` total |
| `invoicing.apOverdue` | invoicing | stat (money, goal lower) | sm | no | | `getApAging` past-due buckets |
| `inventory.value` | inventory | stat (money) | sm | no | ✓ | `get_inventory_valuation` summed |
| `workflows.failedRuns` | settings | stat (count, goal lower) | sm | yes | | `workflowRun` `Failed` with `completedAt` in range |

`purchasing.overdueOrders` and `purchasing.overdueList` share one query. Money stats are in the company base currency (`convertedUnitPrice` / order totals already converted).

## UI Changes

All under `apps/erp/app/modules/dashboard/ui/`:

- **`DashboardSection`** — rendered in `x+/_index.tsx` after the Modules/Recent grid, under a `SectionLabel` "Analytics". Header row: the label, `DashboardRangeSelect`, and an edit `IconButton` (pencil). Below it the widget grid `grid grid-cols-1 lg:grid-cols-3 gap-4`; `sm` = `col-span-1`, `md` = `lg:col-span-2`, `lg` = `lg:col-span-3`. Renders only visible widgets in registry order. If the user has hidden every widget, shows one `Empty` card with "Add widgets".
- **`DashboardRangeSelect`** — a `Select` of the seven presets, labels via Lingui (`Last 7 days`, `Last 30 days`, `Last 90 days`, `Month to date`, `Quarter to date`, `Year to date`, `Last 12 months`). Writes `?range=` to the URL and POSTs to `api/dashboard/preference` via a fetcher; the URL wins on first render so a shared link is reproducible.
- **`DashboardWidget`** — `Card` shell that owns the `useFetcher` load (`api/dashboard/widget/:key?start&end`), a `Skeleton` while loading, the `Empty` state, the drill-down `View` button (same `MetricCard` affordance), and, when `supportsRange`, a small per-widget range menu (kebab → the same seven presets plus "Follow page") that POSTs the override through `api/dashboard/layout`. A per-widget override shows as a muted caption under the title.
- **Kind renderers** — `StatWidget` (reuses `MetricCard` layout; value formatted by `valueKind`; delta chip "▲ 12% vs prior 30 days" coloured by `goal`), `TrendWidget` (`ChartContainer` + recharts `AreaChart`, `groupDataByDay`/`groupDataByMonth` bucketing), `BreakdownWidget` (horizontal `BarChart`, top 8), `ListWidget` (up to 8 `Hyperlink` rows with status badge and relative due date).
- **`DashboardCatalogDrawer`** — opened by the pencil. A `Drawer` listing every registry widget the user is permitted to see, grouped by module, each with a `Switch`. Toggling edits a draft; `Save` POSTs the full draft (one row per permitted widget) to `api/dashboard/layout`, `Cancel` discards. Same draft/dirty/save shape as `useNavigationEditMode`, minus drag-and-drop. Rows for widgets the user is not permitted to see are never written.
- **Loader data** — `x+/_index.tsx` loader adds `getDashboardLayout`, `getDashboardPreference`, and `today` in the company timezone (already computed for the greeting). `resolveDefaultLayout` runs on the client with `usePermissions()`.

No MES changes.

## Acceptance Criteria

- [ ] A user with `sales_view`, `production_view` and `quality_view` who has never customized opens `/x` and sees, below Modules and Recent, exactly the `defaultVisible` widgets for those three modules in registry order, and none from purchasing, invoicing, inventory or settings.
- [ ] A user with no module `view` permission at all sees no Analytics section and no pencil.
- [ ] Changing the page range from "Last 30 days" to "Quarter to date" updates the URL to `?range=qtd`, re-fetches every `supportsRange` widget, leaves "as of now" widgets untouched, and after a full reload the range is still "Quarter to date" from `userDashboardPreference`.
- [ ] Setting a per-widget override of "Last 7 days" on `sales.revenue` while the page is on "Last 30 days" shows a "Last 7 days" caption on that card, fetches that widget with a 7-day window, and persists in `userDashboardWidget.range`.
- [ ] Opening the catalog, switching `quality.openIssues` off and `invoicing.apOverdue` on, and saving writes two rows to `userDashboardWidget` (`visible=false`, `visible=true`), re-renders without a reload, and survives a reload.
- [ ] Cancel in the catalog discards draft changes and writes nothing.
- [ ] `GET /api/dashboard/widget/sales.revenue` by a user without `sales_view` returns 403; an unknown key returns 404; a window longer than 500 days returns an empty payload.
- [ ] A row in `userDashboardWidget` whose key is not in the registry, or whose module the user can no longer view, is ignored and the page renders.
- [ ] `sales.revenue` for a company with orders totalling 10,000 in the window and 8,000 in the prior window shows "10,000" and a positive "+25%" delta; with `goal: lower` widgets the same increase renders as negative.
- [ ] `sales.onTimeDelivery` with 8 lines sent in range, of which 2 have no `promisedDate`, 4 were sent on or before their `promisedDate`, and 2 were sent after, shows "66.667%": the denominator is the 6 promised lines, never the 8 sent lines.
- [ ] `production.scrapRate` with `productionQuantity` rows of 90 Production, 10 Scrap, 5 Rework in range shows "10%" and `production.firstPassYield` shows "85.71%" (percent kind, max 3 digits).
- [ ] `sales.openBacklog` sums `quantityToSend × convertedUnitPrice` over open lines only and reports the count of lines with `promisedDate` before the company's current day.
- [ ] Every money stat renders through the money formatter kind with the base currency's `decimalPlaces`; every percent through the percent kind; no inline fraction-digit options (`no-inline-fraction-digits` passes).
- [ ] `pnpm run generate:types`, `pnpm exec turbo run typecheck --filter=erp`, `pnpm run lint`, and the `dashboard` unit tests (`resolveDashboardRange`, `resolveDefaultLayout`, delta sign) pass.
- [ ] `pnpm db:check:datasets` and `pnpm db:check:backups` pass (new tables are company-scoped and included in backup/wipe discovery automatically).

## Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| Home page issues up to ~15 fetches on mount for a user with many widgets | Med | Fetches are parallel and per-widget after SSR; each query is an indexed count or an existing RPC. Cap visible widgets at 16 in the catalog if load tests show contention; no caching layer in v1. |
| `get_inventory_valuation` and the aging RPCs are heavier than a count | Med | They already back the invoicing and inventory pages; `inventory.value` is one call summed server-side. Mark these widgets `defaultVisible` only where the module dashboard already runs them on load. |
| Timezone drift between "today" for open/late counts and the range window | Med | Both come from one `today` computed in the company timezone in the loader and passed as `start`/`end`; SQL never uses `CURRENT_DATE` (`.claude/rules/date-handling.md`). |
| Registry key rename orphans saved rows | Low | Keys are namespaced and documented as stable; a rename ships with a migration that `UPDATE`s `widgetKey`. |
| Per-widget override plus page range confuses users | Low | Override is shown as a caption on the card and can be cleared with "Follow page". |
| Scrap/FPY defined on `productionQuantity` differs from job-header quantities on legacy data | Low | Definition is stated in the widget description tooltip; both widgets link to the production dashboard where the job-level view lives. |
| Backlog value mixes currencies | Low | Uses `convertedUnitPrice`, a generated base-currency column; the widget is labelled with the base currency. |

## Open Questions

> Resolved with the user before this spec was written (spec-writing Step 5).

- [x] Where does the dashboard sit on the home page? — **Answer:** At the bottom of `/x`, below the existing Recent and Modules grid, like Cloudflare's overview. Module cards and Recent are untouched.
- [x] How much layout control does the user have? — **Answer:** Show/hide and drag-to-reorder (revised 2026-09-07 from show/hide only). Size is fixed by the registry. No resize.
- [x] Are "hide" and "remove" one action? — **Answer:** One action (assumed with the user's tacit agreement when asked): a widget is shown or not, and hidden widgets are re-addable from the catalog. Layout row is `widgetKey` + `visible`.
- [x] Time range model? — **Answer:** A page-wide range select shown to the user, persisted per user, **plus** a per-widget override.
- [x] Default layout for a first-time user? — **Answer:** Curated subset via a `defaultVisible` flag on each registry entry, filtered by module permissions. Admin-published company defaults are a later spec.
- [x] Which KPIs needing new SQL are in scope? — **Answer:** All of on-time delivery, scrap rate, first-pass yield, and backlog, limited to what existing data supports. Verified: all four are computable from `salesOrderLine.sentDate/promisedDate`, `productionQuantity.type/createdAt`, `openSalesOrderLines` + `convertedUnitPrice`; inbound inspection pass rate added as a fifth since `inspection.status/dispositionedAt` exist.
- [x] Plan or edition gating? — **Answer:** None. Available to all.
- [x] Initial catalog? — **Answer:** Ship the full proposed list (stats, trends, breakdowns, lists), as tabulated above.

## Changelog

- 2026-09-05: Created after research (`.ai/research/homepage-analytics-dashboard.md`) and an eight-question interview; all questions resolved before writing.
- 2026-09-05: Implemented (migration `20260904202730_homepage-dashboard.sql`, `modules/dashboard/`, three `api+/dashboard.*` routes, home-page section). Deviations from the design text above: (1) the inspection KPI reads the `inspection` table (`inboundInspection` no longer exists) and is keyed `quality.inspectionPassRate`; (2) `production.utilization` is a per-work-center hours **breakdown**, not a trend, because the shared computation is per work center; (3) scrap rate and first-pass yield share one function, `get_production_quantity_summary`; (4) the registry's translatable copy and drill-down links live in `dashboard.labels.ts` and `dashboard.links.ts` so the registry stays importable from vitest.
