# Configurable Homepage Analytics Research: Best Practices Survey

## Summary

Surveyed how enterprise ERPs (SAP S/4HANA Fiori, NetSuite, Epicor Kinetic, Odoo),
job-shop ERP/MES products (Fulcrum, ProShop, JobBOSS², Global Shop, Katana, MRPeasy,
First Resonance ION, Plex) and modern SaaS dashboards (Cloudflare, Grafana, Datadog,
Stripe, PostHog) let a user put analytics on their home page and adjust what they see.
The consensus is a **widget dashboard with an explicit edit mode and a widget catalog**:
a curated library of pre-built KPI tiles and charts, a per-user layout that starts from a
role-based default, a page-wide time-range control, and click-through from every widget
to the list or report behind it. Nobody ships a blank canvas or a free-form query builder
on the home page. Notably, Cloudflare's *home* is not customizable at all; what the user
is picturing is Cloudflare **Custom Dashboards** (edit mode, chart catalog, dashboard-wide
filters). Carbon already has most of the raw material: five module dashboards with
KPI API endpoints, a `MetricCard` tile, recharts wrappers, a drag-to-reorder + hide
navigation editor persisted in `userModulePreference`, and per-user report pins.

## Competitors Surveyed

- **SAP S/4HANA (Fiori Launchpad, My Home, Overview Pages, Smart Business)** — the
  enterprise reference for role-based defaults with a user personalization layer, KPI
  tile types, threshold colouring, and tile-to-app drill-down.
- **Oracle NetSuite** — the most mature "portlet" home dashboard: admin publishes per
  role, users personalize, explicit lock modes, KPI comparison periods and thresholds.
- **Epicor Kinetic** — discrete-manufacturing ERP; widget home page with personal vs
  published layouts and BAQ-driven tiles; ships four role home pages.
- **Odoo 17/18** — "add any view to my dashboard" affordance and spreadsheet dashboards
  with global filters; shows the cheapest possible path from an existing screen to a
  widget.
- **Job-shop ERP/MES (Fulcrum, ProShop, JobBOSS², Global Shop, Katana, MRPeasy, ION,
  Plex, Manufacturo)** — what KPIs a shop of Carbon's target size actually expects on
  day one.
- **Cloudflare Custom Dashboards + Grafana, Datadog, Stripe, PostHog** — the
  interaction pattern the user asked for by name.

## Key Consensus Patterns

### 1. Curated widget catalog, not a query builder

- **SAP**: users add tiles from the App Finder or "Add to My Home"; KPI definitions,
  thresholds and data sources are authored by key users, not end users.
- **NetSuite**: the Personalize palette lists fixed portlet types; a KPI is picked from
  75+ standard KPIs or a saved search that satisfies a strict contract.
- **Stripe**: "Add" opens a checklist of every available chart; tick and Apply.
- **Cloudflare Custom Dashboards**: add a chart from a fixed set of seven chart types
  over named datasets.
- **Rationale**: a home page is a landing surface, not an analysis tool. A closed catalog
  keeps every widget fast, permission-safe and visually consistent. Ad-hoc analysis lives
  in a separate reports/analytics area (SAP APF, NetSuite saved search, Carbon's pivot
  reports).

### 2. Role-based default, per-user override

- **SAP**: spaces/pages assigned to business roles; the user's personalization is a
  delta stored on top; admins can disable personalization but not force a layout.
- **NetSuite**: admin publishes a dashboard to roles with a lock mode per tab
  (Unlocked / Locked / Add-Move-only); republishing only overwrites user changes if the
  admin explicitly opts in.
- **Epicor**: Personal layout vs Published layout; users can always start from a
  published layout and then diverge.
- **Rationale**: the first render must be useful with zero setup, and the default must
  respect what the role is allowed to see. Personalization is the second step.

### 3. Explicit edit mode, view mode by default

- **Cloudflare**: enter edit mode to add, remove, rearrange; auto-saves on exit.
- **Grafana / Datadog / PostHog**: Edit → drag/resize/remove → Save or Discard.
- **NetSuite / Epicor**: pencil or Personalize toggle; drag-and-drop between columns.
- **Rationale**: prevents accidental layout changes and lets the view mode stay clean.
  Carbon's navigation editor already follows this exact shape
  (`useNavigationEditMode`: draft state, dirty flag, Save / Cancel).

### 4. Page-wide time range and filters

- **Cloudflare**: one time-range dropdown and "Add filter" chips re-query every card.
- **SAP OVP**: one global filter bar over all cards; **My Home** Insights cards carry
  the user's saved filters.
- **NetSuite**: date range is per KPI, but scorecards and Viewing options apply one
  range to all; Datadog/Grafana/PostHog use a global range with per-widget override.
- **Rationale**: comparing widgets is only meaningful when they share a window. Carbon's
  module dashboards already take `start`/`end`/`interval` on every KPI endpoint, so a
  shared range is a prop, not a redesign.

### 5. Widgets are links, not endpoints

- **SAP**: tile → app opened with the tile's filter variant; OVP card header → filtered
  list, line item → object.
- **NetSuite**: KPI → underlying report/saved search; Report Snapshot → "view report".
- **MRPeasy**: every widget clicks through to its report.
- **Rationale**: a number on the home page is a prompt to act. Carbon's `MetricCard`
  already has `to` + `linkLabel` for this.

### 6. Fixed set of tile shapes with constrained sizes

- **SAP Smart Business**: Numeric, Comparison (bars), Trend (micro line), Actual vs
  Target (bullet), Dual; OVP cards: List, Table, Analytical, Link list.
- **NetSuite**: KPI (numeric + comparison), KPI Meter (gauge), Trend Graph, Report
  Snapshot (list or chart), Custom Search (table), Reminders (counts).
- **Cloudflare**: Timeseries, Bar, Donut, Map, Stat, Percentage, Top N.
- **Rubrik design notes / Pencil & Paper**: offer 2–3 size presets rather than free
  resize; "structured flexibility".
- **Rationale**: a small taxonomy (stat, trend, breakdown, list) covers >90% of demand
  and keeps the grid legible.

### 7. Threshold colouring and comparison period on stat tiles

- **SAP**: evaluation defines goal type (maximize / minimize / range) with warning and
  critical thresholds → green/orange/red.
- **NetSuite**: Compare Range shows prior value and % change with arrows; "Highlight
  if" threshold flags the tile red.
- **Stripe**: comparison period dropdown alongside date range.
- **Rationale**: a bare number has no meaning; the delta vs last period or vs target is
  what makes a tile glanceable.

### 8. Permission-derived visibility, not per-widget grants

- **NetSuite**: "KPIs available depend on the role you used to log in."
- **MRPeasy**: widgets hidden by user rights.
- **Odoo**: dashboard data respects the viewer's record rules.
- **Rationale**: a widget is a view on an existing module; if you cannot open the
  module you should not see its number. Carbon's KPI endpoints already gate on
  `view: <module>`.

## Answers to Research Questions

1. **What entity/data model do competitors use for a personalized home page?** — A
   *dashboard* (per user, optionally per role) holding an ordered list or grid of
   *widgets*; each widget references a *definition* from a catalog plus small per-instance
   *config* (time range, filter, size). SAP: space → page → section → tile with a
   per-user personalization delta. NetSuite: dashboard → portlets, stored per user per
   role. Epicor: personal vs published *Layout*. Grafana/Datadog store `x,y,w,h` on a
   12- or 24-column grid; Stripe stores only an ordered list of enabled widgets.
2. **Per-user or shared?** — Home dashboards are per user (SAP My Home, NetSuite
   personalization, Epicor Personal layout, Odoo My Dashboard, Stripe Home). Shared
   dashboards exist as a separate "published/analytics dashboards" concept with
   role-gated editing (NetSuite Publish, Epicor Published layout, Odoo Dashboards app,
   Grafana/Datadog/PostHog). Carbon's `reportView` table already models exactly this
   Private / Company split.
3. **What do users get to change?** — Add/remove widgets from a catalog, reorder
   (drag-and-drop), sometimes resize among presets, set the widget's time range or
   filter, and hide sections. Users do **not** author KPI definitions, thresholds or
   queries on the home page in any surveyed ERP.
4. **What manufacturing KPIs ship out of the box?** — Ranked by how many job-shop
   products ship them: late/open POs and supplier on-time delivery (7), customer
   on-time delivery % (6), scrap/defect rate (5), late jobs (4), inventory value / low
   stock (4), capacity/utilization (4), sales revenue & margin (4), open quotes / win
   rate (3), first pass yield (3), backlog $ and recent shipments (2–3). SAP's role
   overview pages add: overdue PO items, purchase requisitions awaiting approval,
   material coverage shortages, GR-blocked stock, incoming sales orders, customer
   returns, open quality notifications. NetSuite adds AR/AP aging, cash, unbilled
   orders, open quotes, pipeline.
5. **Is there a standard term?** — "Widget" (Epicor, Grafana, Datadog, Atlassian) or
   "portlet" (NetSuite) for the unit; "tile" (SAP) for a stat-only unit; "card" (SAP
   OVP, Cloudflare) for a richer unit. "KPI" for the metric definition; "dashboard"
   for the page. Recommend **widget** for the unit and **KPI** for a metric definition.
6. **What edge cases do they handle?** — (a) republish vs user overrides (NetSuite's
   opt-in "override existing users"); (b) widget definition removed or renamed after
   layout saved (PostHog and Carbon's own run-history handle unknown ids by appending
   or skipping); (c) empty/no-data states with action prompts (Cloudflare Teams Home);
   (d) stale-cache indicators (NetSuite "cached data, last updated at"; SAP per-tile
   cache duration); (e) narrow layouts truncating content (NetSuite narrow column
   rules); (f) plan/feature gating of analytics (Katana tiers, Cloudflare granularity).
7. **How does Cloudflare specifically do it?** — Account Home and zone Overview are
   fixed. Cloudflare Custom Dashboards (GA 2026-04-22): start from a template or blank,
   explicit edit mode with auto-save on exit, per-chart kebab (edit / duplicate / drill
   down), seven chart types, dashboard-level filters including time range applied to
   all charts. Built-in analytics pages share the top-right time-range dropdown and
   "Add filter" pattern. Resizing and per-user scope are not documented.

## Competitor-Specific Details

### SAP S/4HANA
- KPI → Evaluation → Tile → Drill-down chain; one KPI can have many tiles.
- Tile types: Numeric, Comparison, Trend, Actual vs Target (bullet), Dual, Harvey Ball,
  Radial. Goal type drives colour direction.
- Dynamic tiles poll a count every N seconds (default 10 s); Smart Business tiles use a
  per-tile cache duration.
- "Save as Tile" from any list report creates a personal count tile that reopens the
  list pre-filtered — the cheapest user-authored widget in any surveyed product.
- My Home sections: To-Dos, Pages, Apps, Insights (tiles + up to 10 cards).

### NetSuite
- Portlet caps per dashboard (Report Snapshots 10, Custom Search 6, Trend Graphs 5,
  KPI Meter 3) — a precedent for capping widget count.
- KPI setup: Range, Compare + Compare Range (prior value, % change, arrows), Highlight
  If + Threshold, Headline, Employee scope (All / Only Mine / My Team's), Cached Data.
- Publish restriction modes: Unlocked / Locked / Add-Move Content ("sticky" widgets
  users cannot remove).
- No standard KPI for backorders, POs or work orders — customers build those.

### Epicor Kinetic
- Widget types: App Link, BAQ Grid, Updatable Grid, Discovery Chart / KPI / Dashboard,
  Image, Text, Web App, Website. KPI views are stoplight-coloured against a goal.
- Ships four role home pages (Executive, Financial, Manufacturing, Supply Chain) and
  ~30 EDD metrics (job count by status, hours vs downtime, scrap/rework, on-time vs
  overdue shipments, AR/AP aging, sales, orders).
- Weakness worth avoiding: default layout is assignable only per user, not per role;
  standard dashboards break on version upgrades.

### Odoo
- Favorites ▾ → "Add to my dashboard" turns any list/graph/pivot into a personal widget
  that keeps sort/measure interactivity but freezes the filter.
- Spreadsheet dashboards: per-app sections, star favourites, Access Groups, Is Published
  toggle, global date/relation filters.
- Manufacturing has no KPI landing page; OEE, Lost time, Load, Performance are smart
  buttons per work center.

### Job-shop ERP/MES
- **MRPeasy** is the closest literal model: a fixed widget list (Late CO, Late PO,
  Deliveries on time, Cash flow, Cash flow forecast, Sales, Invoices, Total inventory,
  MOs), add/remove/drag, click-through, hidden by user rights.
- **Fulcrum**: fixed KPI strip on each grid (late orders, how late, excess capacity,
  low inventory, last 7 days shipments); no widget picker.
- **Plex / Global Shop / ProShop**: role-specific named dashboards (Purchasing, Master
  Schedule, Labor Performance, Finance) with 25–60 standard KPIs.
- **ION**: eight standard dashboards, read vs write analytics permissions.

### Cloudflare, Grafana, Datadog, Stripe, PostHog

| | Layout storage | Scope | Sizes | Add flow | Time range | Edit mode |
|---|---|---|---|---|---|---|
| Cloudflare Custom Dashboards | ordered charts | account list | undocumented | template or blank → chart | dashboard filters apply to all | explicit, auto-save on exit |
| Grafana | `gridPos {x,y,w,h}`, 24 cols | shared | free | Edit → Add element → viz picker | header picker + URL `from`/`to` | Edit / Save / Discard |
| Datadog | `layout {x,y,w,h}`, 12 cols | shared, role-restricted edit | free, min widths | Add Widget tray with preview | global selector, per-widget override | Edit widgets |
| Stripe Home | ordered list of enabled charts | per account | none | checklist → Apply | range + unit + comparison | Add / Edit → Done |
| PostHog | per-breakpoint `x,y,w,h` | project-shared | free | New insight / Add to dashboard | dashboard range + per-tile override | `E` toggles, `Esc` discards |

## Carbon Today (what a spec can reuse)

- **Chart primitives**: `packages/react/src/Chart.tsx` (recharts wrappers,
  `ChartConfig`), `FunnelChart.tsx`; `apps/erp/app/components/MetricCard.tsx` is the
  existing stat tile (title, value, icon, link).
- **Five module dashboards** already compute KPIs with a shared `start`/`end`/`interval`
  contract via `useFetcher` against `api+/{sales,purchasing,production,quality,resources}.kpi.$key.ts`;
  keys live in each module's `*.models.ts`. Invoicing dashboard uses the `get_ar_aging`
  / `get_ap_aging` RPCs. Every endpoint gates with `requirePermissions({ view: module })`.
- **Cheap data sources**: `get_inventory_valuation`, `get_active_job_count`,
  `accountTreeBalancePeriodSeries` (Executive P&L), `journalDimensionPivot`,
  `workflowLastRun`, and the `salesOrders` / `purchaseOrders` / `jobs` / `issues` /
  `openSalesOrderLines` / `openPurchaseOrderLines` / `itemQuantities` views.
- **Gaps in data**: no on-time-delivery view or RPC; no scrap-count aggregate outside
  the GL scrap report; no NCR aging aggregate (derived from `issues` at query time).
- **Per-user layout precedent**: `userModulePreference` (`userId, companyId, module,
  position, hidden`) + `useNavigationEditMode` (`@dnd-kit` sortable, draft/dirty/save)
  is a near-exact template for a widget layout editor. `reportPin` is per-user pinning
  with a default fallback. `reportView` is the Private / Company shared-config model.
- **Persistence rule**: Carbon persists layout to the DB, never localStorage;
  localStorage is only for dismissals and recently-viewed.
- **Libraries**: `@dnd-kit` is already a dependency in ERP and MES; there is no
  `react-grid-layout`. A 1-D sortable list needs no new dependency; a 2-D resizable
  grid would.
- **Gating**: `FEATURE_PLANS` in `packages/ee/src/plan.ts` + `usePlanGate` /
  `requirePlan`; the pivot/report-view services are already in `accounting.ee.service.ts`.
- **Prior art**: no spec, plan or research on a homepage dashboard exists. The closest
  is `.ai/specs/2026-08-09-dimensional-pivot-reporting.md` (saved, shareable analytics
  config).

## Recommended Approach for Carbon

1. **Widget catalog + per-user layout, no query builder** (SAP, NetSuite, Stripe).
   Define widgets in code as a typed registry (`key`, module permission, kind, default
   size, data loader). Users add/remove/reorder from a catalog drawer. This keeps every
   widget fast and permission-safe and reuses the five existing KPI endpoints.
2. **Role-derived default layout with user override** (SAP, NetSuite, Epicor). The
   default set is derived from the user's module permissions (a user who can view
   sales, production and quality gets those modules' headline widgets), not from a
   hard-coded list, so it is useful on first render and never shows a widget the user
   cannot drill into. User edits are stored as a delta in a new per-user, per-company
   table shaped like `userModulePreference` (`widgetKey, position, hidden, config JSONB`).
   Do not use `user.flags` (company-agnostic) or localStorage.
3. **Explicit edit mode copied from the navigation editor** (Cloudflare, Grafana,
   Carbon's own `useNavigationEditMode`). Pencil → drag-to-reorder with `@dnd-kit`
   sortable, hide/show, Save/Cancel. Ship a 1-D ordered list with two or three width
   presets (1/3, 2/3, full) rendered in the existing `lg:grid-cols-3` on the home page
   rather than a free 2-D grid; that avoids a new dependency and matches Rubrik's
   "constrained sizes" guidance.
4. **One page-wide time range** (Cloudflare, SAP OVP). A single range picker above the
   widgets (This week / This month / Last 30 days / Quarter / Year to date) passed to
   every widget's loader; the KPI endpoints already accept it. Per-widget override can
   be a later layer.
5. **Four widget kinds** (SAP tile types, Cloudflare chart types): **Stat** (number +
   delta vs prior period + link), **Trend** (small area/bar over the range), **Breakdown**
   (top-N bars or donut), **List** (a short table such as "Jobs due this week" or
   "Overdue POs"). Every widget carries a `to` link to the filtered list or report.
6. **Initial catalog, prioritised by the cross-vendor ranking and by what Carbon can
   compute today**:
   - Stat: Open sales orders, Open quotes, Open POs, Overdue POs, Active jobs, Jobs
     assigned to me, Open issues (NCRs), AR outstanding / overdue, AP outstanding /
     overdue, Inventory value, Failed workflow runs (last 24 h).
   - Trend: Sales order revenue, PO spend, Issues opened per week, Utilization.
   - Breakdown: Issues by type (Pareto), Jobs by status, Purchases by supplier.
   - List: Jobs due this week, Late jobs, Overdue purchase orders, Recently viewed.
   - Defer until a data source exists: On-time delivery %, Scrap rate, First pass
     yield, Backlog $ (these are the top-ranked job-shop KPIs and belong in the spec's
     Open Questions with a proposed view/RPC each).
7. **Delta and colour on stat tiles** (NetSuite Compare, SAP goal type). Show prior
   period value and % change; colour by a `goal: "higher" | "lower"` on the widget
   definition. No user-editable thresholds in v1.
8. **Permission and plan gating fall out of the registry**. A widget declares its
   module; the loader filters the catalog and the default layout by `permissions.can`,
   and unknown or now-forbidden keys in a saved layout are skipped, not errored. If
   the feature is Business-plan only, add one `FEATURE_PLANS` key and gate the editor,
   not the default widgets.
9. **Keep shared/company dashboards out of v1** but leave the door open: the
   `reportView` Private / Company model is the pattern to copy when a "publish to
   team" request arrives (NetSuite Publish, Epicor Published layout).
10. **Naming**: call the unit a *widget*, the page area the *dashboard*, the definition a
    *KPI*. Avoid "portlet" and "tile".

## Open Questions for the Spec

- Should the dashboard replace the module-card grid on the home page, sit above it,
  or be a separate route linked from home? (SAP My Home keeps Apps + Insights as sibling
  sections; NetSuite makes the dashboard the home.)
- Time-range scope: page-wide only, or per-widget override in v1?
- Which of on-time delivery, scrap rate, backlog $ need a new view or RPC, and are
  they in scope?
- Is the feature plan-gated, and if so is it the editor, the catalog size, or the
  whole area?
- Widget count cap (NetSuite caps per type; Cloudflare caps dashboards at 25)?
- Should "Recently viewed" and the Implementation Hub card become widgets so the whole
  home page is one layout, or stay fixed?

## Sources

### SAP
- https://www.sap.com/design-system/fiori-design-web/v1-130/foundations/integration-and-services/sap-fiori-launchpad/sap-fiori-launchpad-my-home
- https://help.sap.com/doc/34796706f38646f68d51a0fa0d4636e4/100/en-US/c0a1907907fa4365a83247c0c9bbc247.html
- https://learning.sap.com/courses/learning-the-basics-of-sap-fiori/personalizing-sap-fiori_decea017-0eda-41c1-bea9-c83627443035
- https://community.sap.com/t5/technology-blog-posts-by-sap/manage-spaces-and-pages-for-sap-fiori-launchpad/ba-p/13458100
- https://community.sap.com/t5/technology-blog-posts-by-sap/how-sap-smart-business-works/ba-p/13326746
- https://help.sap.com/docs/SAP_S4HANA_CLOUD/a630d57fc5004c6383e7a81efee7a8bb/c00cbf7fe8464663aee830fb6e7eec13.html
- https://community.sap.com/t5/technology-blog-posts-by-sap/kpi-tile-refresh-in-smart-business-service/ba-p/13331305
- https://github.com/SAP-docs/sapui5/blob/main/docs/07_APF/configuring-the-sap-smart-business-kpi-tile-374364e.md
- https://github.com/SAP-docs/sapui5/blob/main/docs/06_SAP_Fiori_Elements/overview-page-card-74332d5.md
- https://github.com/SAP-docs/sapui5/blob/main/docs/06_SAP_Fiori_Elements/creating-cards-for-the-insights-cards-section-of-my-home-in-sap-s-4hana-cloud-public-edit-9b13559.md
- https://blog.sap-press.com/sap-fiori-overview-pages-features-and-personalization
- https://community.sap.com/t5/enterprise-resource-planning-blog-posts-by-members/dynamic-sap-fiori-tiles-using-variants-in-sap-s-4hana-1909/ba-p/13425514
- https://learning.sap.com/courses/business-processes-in-sap-s-4hana-sourcing-procurement/using-the-procurement-overview-app
- https://learning.sap.com/courses/functions-innovations-in-sap-s-4hana-sales/getting-an-overview-of-the-analytical-features-of-sap-s-4hana-sales_e361c6ec-03b1-4e42-b7eb-1ba63aabda0b
- https://learning.sap.com/courses/inventory-management-and-physical-inventory-in-sap-s-4hana/using-analytical-apps-for-inventory-management
- https://help.sap.com/doc/474a13c5e9964c849c3a14d6c04339b5/100/en-US/a685871d1f2b4f5f91613d99e701e3df.html

### NetSuite
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/chapter_N595760.html
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N601098.html
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N596767.html
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N597713.html
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N609047.html
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N605338.html
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N605811.html
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/chapter_N610592.html
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N626371.html
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N577248.html
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N578457.html
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_4072488196.html
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/chapter_N633149.html
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N634268.html
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N634404.html
- https://blog.proteloinc.com/faq-netsuite-dashboards

### Epicor Kinetic
- https://www.scribd.com/document/567994443/Personalizing-Kinetic-Home-Page
- https://datixinc.com/blog/how-to-add-new-baq-tiles-to-the-epicor-active-home-page/
- https://www.epiusers.help/t/2023-1-4-homepage-default-layout-or-deploying-a-custom-one/103861
- https://www.epiusers.help/t/set-homepage-layout-based-on-user-group/122169
- https://www.epiusers.help/t/publishing-home-page/134811
- https://www.epiusers.help/t/shop-dashboards/121801
- https://www.corporateservetech.com/erp-software/epicor-data-discovery/
- https://www.epicor.com/en/products/business-intelligence-and-data-management/epicor-data-analytics/data-analytics-for-advanced-mes/

### Odoo
- https://www.odoo.com/documentation/18.0/applications/productivity/dashboards.html
- https://www.odoo.com/documentation/18.0/applications/productivity/dashboards/build_and_customize_dashboards.html
- https://www.odoo.com/documentation/19.0/applications/productivity/dashboards/my_dashboard.html
- https://www.odoo.com/odoo-18-release-notes
- https://www.odoo.com/documentation/18.0/applications/inventory_and_mrp/manufacturing/advanced_configuration/using_work_centers.html
- https://www.odoo.com/documentation/18.0/applications/inventory_and_mrp/manufacturing/reporting/oee.html
- https://www.odoo.com/forum/help-1/customize-and-share-dashboards-250429

### Job-shop ERP / MES
- https://fulcrumpro.com/article/manufacturing-dashboards-for-actionable-data
- https://fulcrumpro.com/manufacturing-software/manufacturing-dashboard-live-reports
- https://www.paperlessparts.com/demos/efficiently-managing-quote-throughput-owners-ceos/
- https://www.selecthub.com/p/manufacturing-software/proshop-erp/
- https://www.ecisolutions.com/products/jobboss2/features/cost-reporting-and-dashboards/
- https://www.globalshopsolutions.com/dashboards-for-manufacturing
- https://www.globalshopsolutions.com/key-performance-indicators-software-for-manufacturing
- https://support.katanamrp.com/en/articles/6529431-using-the-insights-dashboard
- https://www.mrpeasy.com/resources/user-manual/dashboard/
- https://manual.firstresonance.io/ion-analytics
- https://www.firstresonance.io/blog/manufacturing-kpis
- https://plex.rockwellautomation.com/en-us/products/manufacturing-analytics.html
- https://www.ascm.org/ascm-insights/the-10-essential-kpis-for-supply-chain/
- https://harmoni.io/feeds/blog/manufacturing-metrics-dashboard
- https://jobpack.com/manufacturing-kpi-dashboard-examples/

### Cloudflare and SaaS dashboards
- https://developers.cloudflare.com/analytics/custom-dashboards/
- https://developers.cloudflare.com/changelog/post/2026-04-22-custom-dashboards-ga/
- https://blog.cloudflare.com/a-new-look-on-your-cloudflare-dashboard/
- https://blog.cloudflare.com/the-teams-dashboard-home/
- https://community.cloudflare.com/t/pin-or-favorite-sites-on-the-dashboard-home-page/57514
- https://developers.cloudflare.com/analytics/account-and-zone-analytics/zone-analytics/
- https://developers.cloudflare.com/analytics/network-analytics/configure/time-range/
- https://developers.cloudflare.com/web-analytics/configuration-options/filters/
- https://grafana.com/docs/grafana/latest/visualizations/dashboards/build-dashboards/view-dashboard-json-model/
- https://grafana.com/docs/grafana/latest/visualizations/dashboards/use-dashboards/
- https://docs.datadoghq.com/dashboards/
- https://docs.datadoghq.com/dashboards/widgets/configuration/
- https://github.com/DataDog/effective-dashboards/blob/main/guidelines.md
- https://support.stripe.com/questions/customize-your-dashboard-home-page-charts-for-better-business-insights
- https://posthog.com/docs/product-analytics/dashboards
- https://github.com/posthog/posthog/issues/44766
- https://medium.com/rubrik-design/customizable-dashboard-framework-design-step-by-step-c04fc75e1cb5
- https://www.pencilandpaper.io/articles/ux-pattern-analysis-data-dashboards
