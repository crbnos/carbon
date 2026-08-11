# Dimensional Pivot Reporting (Analytics on the Journal Dimension Layer)

> Status: draft
> Author: Claude (with Brad Barbin)
> Date: 2026-08-09
> Research: `.ai/research/dimensional-pivot-reporting.md`
> Related: `.ai/specs/2026-07-02-financial-reporting.md` (reporting base),
> `.ai/specs/2026-07-04-segment-reporting.md` (Segment dimension — complementary;
> once implemented, Segment becomes one more Group-By option here)

## TLDR

A small set of **generic, measure-anchored analytics reports** — Revenue,
Expenses, COGS, Inventory Change, Scrap — each defined by a declarative
**account scope** (class/type/configured-account filter over the GL), rendered
as an **interactive pivot**: up to 2 nested row Group-By dimensions, a free
column axis (period buckets *or* a dimension), measures Amount / Quantity /
Count with a "% of column total" toggle, dimension filters, and double-click
**drill-through** to the underlying journal lines. The data substrate is the
existing `journalLineDimension` tag layer (already populated by every posting
path for 13+ entity types, including ScrapReason since #1355) — no posting
changes required. One new plpgsql RPC does the `GROUP BY`; one new table
(`reportView`) stores **named, shareable saved views** (owner + company-wide
visibility). The hardcoded `revenue-by-customer` and `expenses-by-supplier`
reports are **replaced** by presets of the generic reports (old routes
redirect). This is the Sage Intacct multidimensional-GL pattern
(rows/columns/values/filters shelf UX per NetSuite SuiteAnalytics) built on
data Carbon already captures.

## Problem Statement

Carbon's GL carries rich per-line analytical tags — `journalLineDimension`
rows link every posted journal line to dimension values for Location, Item,
ItemPostingGroup, Customer, CustomerType, Supplier, SupplierType, CostCenter,
WorkCenter, Process, FixedAssetClass, Employee, and (as of #1355) ScrapReason —
but **no report can group or filter by any of them**. Every report on the
`financial-reports-module` branch aggregates by account only, via the
snapshot-based `accountTreeBalance*` RPCs, which take no dimension parameters.

Concrete questions a user cannot answer today without SQL:

- *What were my biggest causes of scrap last quarter?* (ScrapReason is tagged
  on scrap journal lines; nothing reads it.)
- *Which customer types drive revenue?* (CustomerType is tagged by
  `post-sales-invoice`; the only report is a hardcoded revenue-by-**customer**.)
- *Which item groups caused inventory to go up?* (ItemPostingGroup + Item are
  tagged on every inventory posting; inventory reports show accounts only.)

Each new question currently requires a new hardcoded report
(`revenue-by-customer.tsx`, `expenses-by-supplier.tsx`, …) — an unscalable
pattern the industry abandoned for the multidimensional-GL + pivot approach
(see research: Intacct dimensions/ICRW, NetSuite Workbook, SAP CO-PA).

## Proposed Solution

### Concept model

```
Generic report (code registry, seeded)     Pivot state (URL params / saved view)
┌─────────────────────────────┐            ┌────────────────────────────────┐
│ key: "revenue"              │            │ rows:    [CustomerType, Item]  │
│ name: "Revenue"             │   +        │ columns: period:month | dimId  │
│ accountScope:               │            │ measure: amount|quantity|count │
│   class = 'Revenue'         │            │ filters: {dimId: [valueIds]}   │
│ sign: natural (as stored)   │            │ period:  startDate..endDate    │
└─────────────────────────────┘            └────────────────────────────────┘
                    │                                      │
                    └──────────────┬───────────────────────┘
                                   ▼
              RPC journalDimensionPivot (plpgsql GROUP BY over
              journalLines ⨝ journalLineDimension, posted only)
                                   ▼
              Pivot tree: nested row groups + column matrix,
              subtotals, grand total, Unassigned bucket,
              double-click cell → drill-through drawer (journal lines)
```

### Seeded generic reports (v1)

| Key | Name | Account scope | Notes |
|-----|------|---------------|-------|
| `revenue` | Revenue | `account.class = 'Revenue'` | replaces revenue-by-customer |
| `expenses` | Expenses | `account.class = 'Expense'` | replaces expenses-by-supplier; includes COGS/Tax/Other Expense types |
| `cogs` | COGS | `account.accountType = 'Cost of Goods Sold'` | subset of Expenses |
| `inventory-change` | Inventory Change | `account.accountType = 'Inventory'` | net change (not balance) over the period |
| `scrap` | Scrap | accounts designated as scrap accounts: `accountDefault.scrapAccount` + posting-group overrides where present | default rows preset: ScrapReason |

The registry lives in code (`accounting.models.ts`), not in a DB table — no
config surface, consistent with the no-matrix-config rule. Each report page
shows its account scope as a read-only chip so users can see what's included.
User-defined account scopes are explicitly deferred.

### Sign convention

Stored `journalLine.amount` is signed so that **positive moves the account
toward its natural balance** (lesson: `journalEntries` view derives
debit/credit from class + sign). Within a single-class account scope,
`SUM(amount)` therefore already reads naturally: positive revenue = more
revenue, positive inventory change = inventory up, positive scrap = more scrap
cost. No `rootSignMultiplier` correction is needed inside one scope (it exists
for cross-class trees). The plan must include a seeded-data verification of
this before the RPC is finalized.

### Untagged lines

Lines in scope with no tag for a chosen Group-By dimension group into an
explicit **Unassigned** bucket (consistent with the segment-reporting spec's
Unassigned concept). History is never rewritten; pre-dimension lines simply
report as Unassigned.

### Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Report anchoring | Seeded account-class/type scopes in a code registry (**user choice Q1: a**) | Zero config, covers the motivating questions; account-scope builder deferred |
| Fate of narrow reports | Replace: routes redirect to generic-report preset URLs, hub cards repointed (**user choice Q1**) | One code path; old links keep working |
| Pivot capability v1 | Full shelf model: ≤2 nested row dims + free column axis (period buckets *or* one dimension) (**user choice Q2: b**) | NetSuite-Workbook parity; period is just another column option |
| Saved views | New `reportView` table, named views, owner + company-wide visibility from day one (**user choice Q3: c**) | Intacct/NetSuite parity; config is also URL-encoded so copy-paste links work |
| Measures v1 | Amount + Quantity + Count, plus a presentation-only "% of column total" toggle (**user choice Q4: b**) | `journalLine.quantity` already populated by inventory/scrap postings; ratios/calculated measures deferred |
| Aggregation home | New **plpgsql** RPC `journalDimensionPivot`, on-the-fly `GROUP BY`, posted (non-Draft) lines only | Consistent with existing report RPCs; plpgsql avoids the `LANGUAGE sql` inlining/ORDER-BY pitfall (lessons); no summary table until latency demands it |
| Dimension hierarchy | No hierarchy joins in v1 — parent classifications (CustomerType, SupplierType, ItemPostingGroup) are *already separate tagged dimensions* | Grouping by "customer type" needs no customer→type join; matches how posting writes tags today |
| Company scope | Single company per pivot in v1; multi-company consolidation + currency translation deferred | Translation machinery (`translateCompanyBalances`) is account-series-shaped; dimensions are companyId-scoped tags; cross-company pivot is a clean fast-follow |
| Row cap | RPC caps distinct row groups at 1,000, returns a `hasMore` flag; UI shows an explicit "showing top 1,000 groups by measure" banner | No silent truncation; protects against group-by-Item on huge datasets |
| Multi-tenancy (H1) | `reportView` has `companyId`, composite PK `("id","companyId")`, `id('rv')` default | Convention |
| Service shape (H2) | All new fns in `accounting.service.ts` take `client` first, return `{data, error}` | One service file per module rule |
| RLS (H3) | `reportView`: SELECT own-or-company-shared; INSERT/UPDATE/DELETE owner only; simple policy names + `::text[]` helper casts | RLS conventions |
| Permissions (H4) | Routes gate `requirePermissions(request, { view: "accounting", role: "employee" })`, same as sibling report routes | Reports are accounting-view surfaces |
| Forms (H5) | Save-view modal uses `ValidatedForm` + zod validator + route action | Form conventions |
| Module layout (H6) | Models/validators in `accounting.models.ts`, service fns in `accounting.service.ts`, UI in `modules/accounting/ui/Reports/`, routes in `x+/reports+/` | Existing reporting-base layout |
| Backward compat (H7) | Old report URLs 302-redirect with preset params; `reportPin` keys for removed reports migrate to the new report keys | No FROZEN surface touched |
| Drill-through | Second RPC `journalDimensionPivotLines` returns the journal lines behind a cell; rendered in a drawer (AccountLedgerDrawer pattern) | PostgREST can't express N dimension-tag joins; Drawer per detail-view convention |
| Value-name resolution | RPC returns `valueId`s; names resolved per entityType via the existing `getEntityDimensionValues` resolution logic, batched in the service | Avoids a 15-table CASE join in SQL; high-cardinality entities stay lazy |
| Export | CSV via the existing `exportReport.ts` pattern | Parity with sibling reports |

## Data Model Changes

No changes to `journalLine`, `journalLineDimension`, `dimension`, or any
posting path.

### New table: `reportView`

```sql
CREATE TYPE "reportViewVisibility" AS ENUM ('Private', 'Company');

CREATE TABLE "reportView" (
    "id" TEXT NOT NULL DEFAULT id('rv'),
    "companyId" TEXT NOT NULL,
    "reportKey" TEXT NOT NULL,          -- 'revenue' | 'expenses' | 'cogs' | 'inventory-change' | 'scrap'
    "name" TEXT NOT NULL,
    "config" JSONB NOT NULL,            -- validated pivot state: rows[], columnAxis, measure, filters, period prefs
    "visibility" "reportViewVisibility" NOT NULL DEFAULT 'Private',

    "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "updatedBy" TEXT REFERENCES "user"("id"),
    "updatedAt" TIMESTAMP WITH TIME ZONE,

    CONSTRAINT "reportView_pkey" PRIMARY KEY ("id", "companyId"),
    CONSTRAINT "reportView_companyId_fkey" FOREIGN KEY ("companyId")
      REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "reportView_name_unique" UNIQUE ("companyId", "reportKey", "name")
);

CREATE INDEX "reportView_companyId_idx" ON "reportView" ("companyId");
CREATE INDEX "reportView_createdBy_idx" ON "reportView" ("createdBy");

ALTER TABLE "reportView" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "SELECT" ON "reportView" FOR SELECT USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_role())::text[])
  AND ("visibility" = 'Company' OR "createdBy" = (SELECT auth.uid())::text)
);
CREATE POLICY "INSERT" ON "reportView" FOR INSERT WITH CHECK (
  "companyId" = ANY ((SELECT get_companies_with_employee_role())::text[])
  AND "createdBy" = (SELECT auth.uid())::text
);
CREATE POLICY "UPDATE" ON "reportView" FOR UPDATE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_role())::text[])
  AND "createdBy" = (SELECT auth.uid())::text
);
CREATE POLICY "DELETE" ON "reportView" FOR DELETE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_role())::text[])
  AND "createdBy" = (SELECT auth.uid())::text
);
```

### New RPC: `journalDimensionPivot` (plpgsql)

Signature sketch (exact SQL in the plan; fork period-bucket handling from the
newest `accountTreeBalancePeriodSeries` definition per the migration lesson):

```
journalDimensionPivot(
  p_company_id       TEXT,
  p_start_date       DATE,
  p_end_date         DATE,
  p_account_classes  "glAccountClass"[]  DEFAULT NULL,  -- scope, OR:
  p_account_types    "accountType"[]     DEFAULT NULL,
  p_account_ids      TEXT[]              DEFAULT NULL,  -- (scrap report)
  p_row_dimension_1  TEXT                DEFAULT NULL,  -- dimension.id
  p_row_dimension_2  TEXT                DEFAULT NULL,
  p_column_dimension TEXT                DEFAULT NULL,  -- mutually exclusive with p_period_ends
  p_period_ends      DATE[]              DEFAULT NULL,  -- from computeReportPeriodBuckets
  p_filters          JSONB               DEFAULT NULL   -- [{dimensionId, valueIds[]}]
) RETURNS TABLE (
  rowValue1Id TEXT,   -- NULL = Unassigned
  rowValue2Id TEXT,
  columnKey   TEXT,   -- valueId or periodEnd::text
  amount      NUMERIC,  -- SUM(jl.amount), natural-signed within scope
  quantity    NUMERIC,  -- SUM(jl.quantity)
  lineCount   BIGINT
)
```

Semantics:

- Reads the `journalLines` view (excludes `status = 'Draft'`), filtered by
  `companyId`, `postingDate` range, and the account scope (exactly one of
  classes/types/ids provided by the report registry).
- One `LEFT JOIN journalLineDimension` per selected dimension (max 3), each
  constrained to its `dimensionId`; `NULL` valueId groups as Unassigned.
- Filters are `EXISTS` subqueries per filter dimension.
- Caps output at 1,000 distinct (row1, row2) groups ordered by
  `ABS(SUM(amount))` DESC, plus a sentinel row / separate `hasMore` signal.
- Ordering is re-applied in the app (RPC ordering is not relied upon — lesson).

### New RPC: `journalDimensionPivotLines` (plpgsql)

Same filter params plus the clicked cell's `(rowValue1Id, rowValue2Id,
columnKey)`; returns the journal lines (id, postingDate, accountId, account
name/number, description, documentType, documentId, amount, quantity,
journalEntryId) behind that cell, capped + ordered by postingDate. Feeds the
drill-through drawer; its two measure sums must equal the cell.

### Indexes

Verify and add as needed (in the same migration):

```sql
CREATE INDEX IF NOT EXISTS "journalLineDimension_companyId_dimensionId_valueId_idx"
  ON "journalLineDimension" ("companyId", "dimensionId", "valueId", "journalLineId");
```

plus confirmation that the `journalLines` path has a usable
`(companyId, accountId, postingDate)` index (add if absent).

## API / Service Changes

All in `apps/erp/app/modules/accounting/` (one service, one models file).

`accounting.models.ts`:

- `analyticsReportKeys = ["revenue","expenses","cogs","inventory-change","scrap"] as const`
- `ANALYTICS_REPORTS` registry: key → name, account scope, default pivot state
  (e.g. scrap → rows `[ScrapReason]`), i18n label ids.
- `pivotStateValidator` (zod): `rows` (≤2 dimension ids), `columnAxis`
  (`{type:"period",bucket:"month"|"quarter"|"year"} | {type:"dimension",dimensionId}`),
  `measure` (`amount|quantity|count`), `percentOfTotal` (bool), `filters`,
  `startDate`, `endDate`. Used by both the URL-param parser and
  `reportViewValidator` (name, reportKey, visibility, config).

`accounting.service.ts`:

- `getDimensionPivot(client, params)` — calls `journalDimensionPivot`, resolves
  value display names per entityType (batched; reuses the
  `getEntityDimensionValues` resolution approach), re-sorts, returns groups +
  `hasMore`.
- `getDimensionPivotLines(client, params)` — drill-through.
- `getReportViews(client, {companyId, userId, reportKey?})`,
  `upsertReportView(client, view)`, `deleteReportView(client, id, companyId)`.
- Types propagate via `Awaited<ReturnType<...>>` in `types.ts` after
  `pnpm run generate:types`.

## UI Changes

Routes (`apps/erp/app/routes/x+/reports+/`):

- `analytics.$reportKey.tsx` — the pivot page. Loader: validate `reportKey`
  against the registry, parse pivot state from URL (fall back to the report's
  default preset), `requirePermissions({ view: "accounting", role: "employee" })`,
  run `getDimensionPivot`, load active dimensions for the shelf pickers
  (`getActiveDimensionsWithValues`; Customer/Supplier/Item values lazy).
  Action: save/update/delete `reportView`.
- `analytics.$reportKey.lines.tsx` (or fetcher route) — drill-through drawer
  data via `getDimensionPivotLines`; rendered as a **Drawer overlay** per the
  detail-view convention.
- `revenue-by-customer.tsx` / `expenses-by-supplier.tsx` — replaced by
  redirects to `analytics/revenue?rows=<customerDimId>` /
  `analytics/expenses?rows=<supplierDimId>`.

Components (`modules/accounting/ui/Reports/`):

- `PivotControlBar.tsx` — the shelves: Rows (up to 2 dimension selects),
  Columns (period-bucket segmented control ⟷ dimension select), Values
  (measure select + %-of-total toggle), Filters (dimension multi-selects),
  plus the shared `PeriodSelector`, account-scope chip, saved-view picker,
  Save-view button (`ValidatedForm` modal), CSV export, reset. Built from
  existing `ReportFilters` parts.
- `PivotTree.tsx` — nested row groups on `TreeView`/`useTree` (virtualized),
  column matrix with column subtotals + grand-total row/column, Unassigned
  bucket, top-1,000 banner when `hasMore`, empty states. Cell click opens the
  drill-through drawer. Rendering patterned on `MultiPeriodStatementTree`.
- `pivotTree.ts` — pure pivot-tree assembly from RPC rows (unit-testable,
  `reportTree.ts` style).

Hub (`x+/accounting+/reports.tsx`): the five generic reports as Analytics
cards (replacing the two hardcoded analytics cards); shared (`Company`) saved
views listed under their report; `reportPin` keys for the two removed reports
migrated to the new keys. `path.ts`: `analyticsReport(key)` +
`analyticsReportLines(key)` helpers; remove the dead helpers.

i18n: all new strings through Lingui; run `/translate` for the .po catalogs.

## Acceptance Criteria

- [ ] With seeded scrap postings across ≥2 scrap reasons, `analytics/scrap`
      defaults to rows=ScrapReason and shows one group per reason plus
      Unassigned, with Amount equal to the scrap account's net change for the
      period and Quantity matching the scrapped units; sorting by Amount ranks
      the biggest cause first.
- [ ] `analytics/revenue` grouped by CustomerType (rows) × month (columns)
      shows per-type monthly revenue as positive numbers; its grand total
      equals the Income Statement revenue total for the same period and
      company.
- [ ] `analytics/revenue` grouped by Customer reproduces the totals of the old
      revenue-by-customer report for the same period; `/x/reports/revenue-by-customer`
      redirects (302) to the preset URL.
- [ ] `analytics/inventory-change` grouped by ItemPostingGroup shows signed
      net change per group (positive = inventory up), summing to the inventory
      accounts' net change for the period.
- [ ] Rows accepts 2 dimensions (e.g. ScrapReason → Item): child groups render
      nested under parents with subtotals per parent and a grand total.
- [ ] Column axis switches between month/quarter/year buckets and a dimension
      (e.g. Location as columns); column subtotals and grand-total column are
      correct in both modes.
- [ ] Measure toggles between Amount, Quantity, Count; % of column total
      renders shares that sum to 100% per column (Unassigned included).
- [ ] A dimension filter (e.g. Location = one plant) restricts every cell,
      subtotal, and drill-through consistently.
- [ ] Double-clicking a cell opens a Drawer whose journal lines sum exactly to
      the cell's Amount and Quantity.
- [ ] Draft journals are excluded everywhere (pivot and drill-through).
- [ ] Saving a view named "Scrap by reason by plant" with visibility Company
      makes it appear for a *different* employee of the same company; a
      Private view does not; only the owner can edit/delete; view names are
      unique per company+report.
- [ ] Pivot state round-trips through the URL: copy-pasting the address into
      another session reproduces the exact pivot.
- [ ] With >1,000 row groups (group by Item on a large dataset), the UI shows
      the explicit top-1,000-by-measure banner — no silent truncation.
- [ ] CSV export contains exactly the rendered rows/columns.
- [ ] `pnpm exec turbo run typecheck --filter=erp` and scoped tests pass;
      `pnpm run generate:types` committed after the migration.

## Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| Pivot `GROUP BY` too slow on large journals (3 dimension joins) | Med | Composite indexes; ≤3 dimensions per query; 1,000-group cap; fall back to an incrementally-maintained per-period dimension summary table (Oracle GL_DAILY_BALANCES pattern) only if measured latency demands it |
| Sign convention misread (stored amount vs class-derived debit/credit) | High if wrong | Lesson documents natural-sign storage; plan includes a seeded-data assertion (revenue positive, scrap positive, inventory-up positive) before UI work |
| Value-name resolution for high-cardinality entities (Item/Customer/Supplier) | Med | Resolve names only for the ≤1,000 returned group ids, batched per entityType; pickers stay lazy as today |
| Dimension tagging gaps make reports look wrong (e.g. Department never tagged) | Med | Shelf pickers list only *active* dimensions; Unassigned bucket makes gaps visible instead of silently wrong; Department tagging is a known follow-up |
| RPC ordering dropped by planner | Low | plpgsql + authoritative re-sort in the service (lesson) |
| `reportView.config` drift as pivot state evolves | Low | `pivotStateValidator` parses configs on read; invalid saved views fall back to the report default with a toast |
| Redirects break existing pins/bookmarks | Low | 302 redirects + `reportPin` key migration in the same migration |

## Open Questions

> HARD STOP: Do not proceed with implementation until these are answered.

- [x] What anchors a generic report, and what happens to the existing narrow
      reports? — **Answer (Brad, 2026-08-09): (a)** seeded account-class/type
      scopes in code, scope shown as a read-only chip, account-scope builder
      deferred; `revenue-by-customer` / `expenses-by-supplier` replaced by
      redirects to generic-report presets.
- [x] How much pivot in v1? — **Answer (Brad, 2026-08-09): (b)** full shelf
      model: ≤2 nested row dimensions **and** a free column axis (dimension or
      period buckets), with column subtotals.
- [x] Saved views scope? — **Answer (Brad, 2026-08-09): (c)** named saved
      views with sharing from day one — owner + company-wide visibility flag;
      config also URL-encoded so links work.
- [x] Measure set? — **Answer (Brad, 2026-08-09): (b)** Amount + Quantity +
      Count (with the recommended presentation-only "% of column total"
      toggle); calculated/ratio measures deferred.

Decisions settled from codebase/research during design (recorded in Design
Decisions above): plpgsql RPC aggregation home; single-company v1; 1,000-group
cap; Unassigned bucket; no hierarchy joins (parent types are already separate
dimensions); drill-through via second RPC + Drawer; value-name resolution in
the service; CSV export parity.

## Deferred (explicitly out of scope for v1)

- Multi-company consolidation + currency translation on pivots
- User-defined account scopes / report builder
- Calculated measures (ratios, cost-per-unit)
- Scheduled delivery / email of saved views
- Department tagging at posting time (dimension exists, no writer yet)
- Pre-aggregated dimension summary table (only if latency demands)

## Changelog

- 2026-08-09: Created after abbreviated grill interview (4 questions resolved
  by Brad) on top of `.ai/research/dimensional-pivot-reporting.md`.
