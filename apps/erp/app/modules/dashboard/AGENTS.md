# Dashboard Module — Agent Guide

The **Analytics** section at the bottom of the ERP home page (`/x`): pre-built
widgets (stat, trend, breakdown, list) that users show or hide, a page-wide time
range with per-widget overrides, and five KPI SQL functions. No permission
family of its own — every widget declares the module whose `view` permission
gates it. Spec: `.ai/specs/2026-09-05-homepage-analytics-dashboard.md`.

## Files

| File | What it is |
|---|---|
| `dashboard.models.ts` | `DASHBOARD_RANGES` + `resolveDashboardRange` / `windowFromDates` (pure `@internationalized/date`), the `DASHBOARD_WIDGETS` registry, `resolveDashboardLayout`, `percentChange` / `ratioPercent`, zod validators, payload types. **Imports nothing from Lingui or `~/utils/path`** so vitest can load it. |
| `dashboard.labels.ts` | `useWidgetLabels()` (title + description per key) and `useDashboardRangeLabels()` — React-macro `t` hooks. Vite-only. |
| `dashboard.links.ts` | `widgetLinks`: drill-down `path.to.*` per key. Kept apart from the registry because `~/utils/path` pulls the glossary's `msg` macro. |
| `dashboard.service.ts` | `getDashboardLayout`, `getDashboardPreference`, `upsertDashboardWidgets`, `upsertDashboardPreference`, and `getWidgetData` — one exhaustive `switch` arm per registry key (no `default`). |
| `dashboard.models.test.ts` | Range arithmetic, layout resolution, delta math, validator cases. |
| `ui/DashboardSection.tsx` | Rendered by `routes/x+/_index.tsx`; range select, "Add widgets" button, drag-to-reorder widget grid (dnd-kit), catalog drawer. |
| `ui/DashboardWidget.tsx` | Card shell: per-widget `useFetcher` load, skeleton, drill-down link, range-override menu. |
| `ui/{Stat,Trend,Breakdown,List}Widget.tsx` | Kind renderers. |
| `ui/DashboardCatalogDrawer.tsx` | Show/hide switches grouped by module; Save posts the full layout. |

Routes: `routes/api+/dashboard.widget.$key.ts` (GET, gated on the widget's module),
`routes/api+/dashboard.layout.ts` and `routes/api+/dashboard.preference.ts` (POST
JSON, personal rows only). Path helpers: `path.to.api.dashboardWidget(key)`,
`.dashboardLayout`, `.dashboardPreference`.

## Data

- `userDashboardWidget (widgetKey, userId, companyId, visible, range)` — explicit
  override per widget; absent row = the registry's `defaultVisible`, `range` null =
  follow the page. `userDashboardPreference (userId, companyId, range)` — the page
  range; absent = `30d`. Both owner-only RLS (`reportPin` pattern). Migration
  `20260904202730_homepage-dashboard.sql`.
- SQL functions (all `SECURITY INVOKER`, company id explicit, never divide):
  `get_on_time_delivery`, `get_production_quantity_summary` (scrap rate + first-pass
  yield), `get_inspection_pass_rate` (table `inspection`, `dispositionedAt`),
  `get_open_backlog`, `get_overdue_purchase_orders`. Ratios are computed in the
  service with `ratioPercent` (rounded once at internal scale).

## Adding a widget

1. Add the entry to `DASHBOARD_WIDGETS` (key namespaced by module, `module` = the
   permission key, `kind`, `size`, `defaultVisible`, `supportsRange`, optional
   `goal` / `valueKind`).
2. Add its `useWidgetLabels` and `widgetLinks` entries — both are `Record<WidgetKey, …>`,
   so typecheck fails until you do.
3. Add the `switch` arm in `getWidgetData` — the switch has no `default`, so a
   missing arm is a type error.
4. Money values are base currency; percent values are 0–100 (the UI divides by
   100 for the percent formatter); counts and quantities go through the quantity
   formatter. Never inline fraction digits.

## Rules

- Every query scopes by `companyId`; "as of now" widgets take `today` from the
  loader (company timezone), never `CURRENT_DATE`.
- Unknown or now-forbidden keys in a saved layout are skipped by
  `resolveDashboardLayout`, never deleted.
- Drag-to-reorder saves `userDashboardPreference.widgetOrder` (the full key list, hidden widgets keep their slot); `resolveDashboardLayout` puts listed keys first, unlisted after in registry order. No resize: size is registry-fixed.
