# Dimensional Pivot-Table Reporting Research: Best Practices Survey

## Summary

Surveyed how best-in-class ERPs turn a dimension-tagged general ledger into
interactive slice-and-dice analytics: **Sage Intacct** (multidimensional GL +
Interactive Custom Report Writer), **NetSuite** (custom segments + SuiteAnalytics
Workbook + saved searches), **SAP S/4HANA** (Universal Journal ACDOCA + CO-PA
Profitability Analysis + statistical key figures), and **QuickBooks Online / Xero**
(lightweight tracking categories / classes). Plus a cross-tool survey of the
pivot-builder UX and how accounting systems answer *operational* (non-financial)
questions.

The dominant industry pattern is a **multidimensional GL**: every posting line is
tagged with a set of dimension values, and analytics come "for free" by
**grouping/filtering the ledger by dimension** — no per-breakdown GL accounts, no
separate data warehouse until scale demands it. The pivot UX has strongly
converged on a **Rows / Columns / Values / Filters "shelf" model** with per-measure
aggregation, an expandable row-group hierarchy with subtotals, and double-click
drill-through to the underlying transactions. Non-financial questions ("biggest
causes of scrap", "units by reason") are answered either by tagging the relevant
GL lines with an operational dimension (e.g. ScrapReason) or via **statistical
accounts** carrying quantities alongside money. Dimension **hierarchies** (item →
item group, customer → customer type, account → category) are resolved by joining
to master data at query time, not by denormalizing parents onto every fact row.

**This maps almost perfectly onto Carbon's existing model:** the GL already carries
rich per-line analytical tags via the `journalLineDimension` join table (12 entity
types actively populated at posting time), but **every current report aggregates by
account only** — no dimension is a query parameter anywhere. The feature is the
missing aggregation-by-dimension path plus a pivot UI on top of data we already
capture.

## Competitors Surveyed

- **SAP S/4HANA** — enterprise reference. Universal Journal (ACDOCA) puts every
  dimension as a column on each line; CO-PA is the dedicated profitability
  slice/dice cube; statistical key figures mix non-financial quantities with money.
- **Sage Intacct** — the market leader in *multidimensional* mid-market accounting
  and the feature the user explicitly wants to emulate. Dimensions tag every
  transaction and propagate to the GL; Interactive Custom Report Writer (ICRW) is
  the drag-and-drop pivot builder; statistical accounts cover operational metrics.
- **NetSuite** — custom segments (`cseg…`) extend the native four classifications;
  SuiteAnalytics Workbook is the modern Rows/Columns/Measures pivot; Saved Searches
  are the grouping-based analytics workhorse.
- **QuickBooks Online / Xero** — small-business reference showing the *minimum
  viable* dimension model (2 lightweight tracking categories / classes + a canned
  "P&L by <dimension>" report). Useful as the floor, not the target.

## Key Consensus Patterns

### 1. Multidimensional GL — tag the line, pivot the ledger
- **SAP**: ACDOCA carries profit center, cost center, functional area, segment,
  WBS, customer, product, and CO-PA market-segment characteristics as native
  columns on every journal line — one harmonized table, no FI/CO reconciliation.
- **Intacct**: every transaction is tagged with multiple dimension values
  (Location, Department, Project, Customer, Vendor, Employee, Item, Class, +
  user-defined) that **propagate down to the GL entries**, so slicing needs no
  extra accounts.
- **NetSuite**: native Subsidiary/Department/Class/Location + custom segments,
  applied at body and/or line, flagged "GL Impact" so they flow to postings.
- **Xero/QBO**: the lite version — 2 tracking categories (Xero) / Class + Location
  (QBO) tagged per line.
- **Rationale**: a fat segmented account number or a per-breakdown report doesn't
  scale; tagging the line once and grouping at read time answers unlimited
  questions from the same books.

### 2. The pivot builder — Rows / Columns / Values / Filters shelves
- **NetSuite Workbook**: drag fields into Rows, Columns, Measures; each measure has
  its own summary type (sum/count/avg/min/max); nested row fields form an
  expand/collapse hierarchy with per-level subtotals; Top-10/Bottom-10 filters;
  double-click a cell drills to source records.
- **Intacct ICRW**: canvas drag-and-drop; Define (columns) → Refine (reorder +
  calculated columns) → Views (pivot + grouping) → Prompts (run-time filters) →
  drill-to-source.
- **SAP KE30**: OLAP drill-down report — start aggregated, drill characteristic by
  characteristic (country → customer → product), dynamically re-pivot.
- **Power BI / Excel / Metabase**: identical four-well model.
- **Rationale**: this interaction model is so universal that users already know it;
  an ERP should copy it rather than invent. **Copyable model**: field list → four
  droppable shelves → per-Value aggregation dropdown → indented expand/collapse row
  tree with subtotals + grand total → double-click drills to journal lines.

### 3. Natural sign — present magnitudes, not raw debit/credit
- Assets/expenses are normal-debit; liabilities/equity/revenue are normal-credit.
  Every tool applies a **"normal balance by account type" sign rule** so revenue
  *and* expense both surface as positive magnitudes, with a per-report "reverse
  sign" escape hatch (NetSuite "Account Format: Reverse Sign"; Intacct derives sign
  from the account group's normal balance).
- **Rationale**: raw debit/credit signs read backwards to business users. Carbon
  already has this: `applyRootSignCorrection` / `rootSignMultiplier(class)` in
  `accounting.service.ts`.

### 4. Operational (non-financial) analytics — two mechanisms
- **(a) Dimension-tag the GL line** and pivot the ledger directly (Intacct/BC
  "default dimensions", SAP CO-PA characteristics). Answers anything expressible in
  **money** along any tagged dimension ("sales by customer type", "cost by item
  group"). Fast, always consistent with the books.
- **(b) Statistical accounts / statistical key figures** carry **quantities** that
  don't have to balance (units produced, scrap units, headcount) tagged by the same
  dimensions, rolled in next to money to compute ratios (revenue/employee,
  cost/unit). This is how Intacct/SAP answer "biggest causes of scrap" purely
  inside accounting.
- Modern mid-market ERPs favor **(a) + (b)**, deferring a separate star-schema
  warehouse **(c)** until volume/BI demand justifies the ETL.
- **Note for Carbon**: journal lines already carry a `quantity` column *and*
  dimensions — so pattern (a) works today for money, and (a)-with-quantity gives us
  most of (b)'s value without a separate statistical ledger. The gap is that some
  operational dimensions (ScrapReason, Department) aren't yet tagged at posting.

### 5. Dimension hierarchies — resolve parents at query time
- Store only the **leaf** dimension value on the fact line; keep parent
  relationships on master data (item → itemGroup, customer → customerType, account
  → category) and resolve roll-ups with a **join at pivot time** (SQL `GROUP BY
  ROLLUP` or a hierarchy join). Re-parenting a value reclassifies history
  automatically — no fact backfill.
- **Rationale**: matches how Carbon's financial statements already roll accounts up
  their category tree; keeps the fact table narrow.

### 6. Saved / shared report definitions
- Every tool lets a user **save ("memorize")** a customized report (its
  rows/columns/measures/filters), **share** it (public flag + role/group/user
  grants), **schedule + email/export** (PDF/CSV/Excel), and organize into groups.
- **Rationale**: a pivot builder is only useful if the good pivots become
  reusable, shareable saved views. Carbon already has `reportPin` (per-user
  pinning) as a seed of this.

### 7. Performance — narrow indexed fact + optional pre-aggregation
- Interactive pivots run **on-the-fly `GROUP BY`** over a well-indexed journal-line
  table (composite index on `companyId, period, account, <dimension>`); the hot,
  repetitive reports are backed by **pre-aggregated period-balance summary tables /
  materialized views** (Oracle `GL_DAILY_BALANCES` pattern — maintain
  balances-by-account-by-period(-by-dimension) incrementally at post time).
- **Rationale**: don't re-sum millions of lines per report; but don't build a
  warehouse before you need it. Carbon already has `accountingPeriodBalance`
  snapshots + the `accountTreeBalance*` RPCs for the account-only path — the
  dimensional path can start as on-the-fly `GROUP BY` and add a summary rollup only
  if volume bites.

## Answers to Research Questions

1. **Dimension data model** — Tag each transaction/journal line with N dimension
   values that propagate to the GL. Standard set spans Location, Department,
   Project, Customer, Vendor/Supplier, Employee, Item, Class, Cost Center + custom.
   Values form parent/child **hierarchies** with roll-up. SAP puts them as columns
   (ACDOCA); Intacct/NetSuite as tags/segments; Xero/QBO cap at ~2 lightweight ones.
   **Carbon uses a normalized join table** (`journalLineDimension`) keyed by
   `entityType` — closer to Intacct's tag model than SAP's column model.

2. **Report-builder UX** — Converged **Rows / Columns / Values / Filters** shelves;
   drag fields in; per-measure aggregation (sum/count/avg/min/max); nested row
   groups expand/collapse with per-level subtotals + grand total; double-click a
   cell drills through to the underlying transaction lines; run-time filter prompts.

3. **Measures** — Sum of **signed GL amount** (with a natural-sign-by-account-type
   presentation flip), **quantity**, **count**, and calculated/formula measures.
   Amount must balance per journal; quantity need not — which is what enables
   operational metrics.

4. **Operational questions** — "biggest causes of scrap" / "sales by customer type"
   / "what item groups drove inventory": answered by grouping the dimension-tagged
   ledger (money and/or quantity), optionally supplemented by statistical accounts.
   Requires the relevant lines to actually be tagged with the operational dimension
   at posting time.

5. **Saved/shared definitions** — Save a pivot config, share via public flag +
   role/group/user grants, schedule + email, export PDF/CSV/Excel, organize into
   groups. Permissions gate who can run/edit.

## Competitor-Specific Details

### Sage Intacct (the primary model to emulate)
- **Standard dimensions** (module-gated): Location, Department, Vendor, Customer,
  Employee, Project, Item, Class, + Affiliate, Asset, Contract, Cost type, Task,
  Warehouse. **User-defined dimensions** via Platform Services (custom objects
  flagged `userDefinedDimension` / `enabledInGL`).
- **Dimension groups** (a named member set — manual or rule-based "all members
  matching criteria" — surfaced as a filter dropdown), **dimension structures** (a
  group of groups; financial-statement columns/rows with "roll up child amount"),
  and **dimension relationships** (auto-fill/restrict one dimension from another at
  entry). The user's `no-matrix-config` preference aligns with groups + relationships,
  not a classification matrix.
- **Statistical accounts**: non-financial quantities, don't balance, rolled into
  account groups to appear beside money; "dimension count rules" can auto-post them.
- **ICRW** tiers: Financial Report Writer (GAAP statements) → Custom Report Writer
  → Interactive Custom Report Writer (the pivot) → Interactive Visual Explorer (BI
  charts).

### NetSuite
- **Custom segments** (`cseg…`) with GL-Impact flag, body/line placement,
  parent/child hierarchies, dependent "Filter By" cascades, up to 2 "balancing"
  segments. **Saved Searches**: Criteria + Results with per-column **Summary Types**
  (Group / Sum / Count / Avg / Min / Max) → grouped summary rows + drill-down; group
  by *any* field incl. non-financial (item group, customer category, custom
  segment). **SuiteAnalytics Workbook**: dataset (joined records) → Rows/Columns/
  Measures pivot + calculated measures + drill to cell detail.

### SAP S/4HANA
- **ACDOCA** = every dimension as a column on one line-item table; coding-block
  (CI_COBL / OXK3) extensibility propagates custom fields into the journal.
- **CO-PA**: characteristics (dimensions) + value fields or (account-based) GL
  accounts as measures; **derivation strategies** auto-populate dependent
  characteristics from master data (customer → region/group); **KE30** drill-down.
- **Statistical key figures**: non-monetary values (headcount, m², units, scrap
  qty) as allocation bases and for ratio reporting.

### QuickBooks Online / Xero (the floor)
- **Xero**: max **2** tracking categories, ~100 options each, tagged per line; "P&L
  by tracking category" report.
- **QBO**: **Class** (per line or per transaction) + **Location** (per transaction);
  Plus caps class+location+sub-items at 40 combined, Advanced unlimited; "P&L by
  Class / by Location" reports. Reports are Customized → Save-as/memorized → shared
  → scheduled.

## Recommended Approach for Carbon

Follows the **Sage Intacct multidimensional-GL + interactive pivot** pattern,
grounded in Carbon's existing `journalLineDimension` model and reporting base.

1. **Reuse the existing dimension tag layer as the analytics substrate.** Carbon's
   `journalLineDimension(journalLineId, dimensionId, valueId)` is exactly Intacct's
   "tag propagated to the GL line" pattern. No schema change to *capture* dimensions
   — the data is already there for 12 entity types.

2. **Build the missing aggregation-by-dimension path.** Every current report
   aggregates by account only (snapshot-based `accountTreeBalance*` RPCs, no
   dimension params). Add a new query/RPC that joins
   `journalLines` → `journalLineDimension`, resolves `valueId` per `entityType`
   against its source table, filters (period, company, account scope, dimension
   filters), and groups by 1–2 chosen dimensions — returning **sum(signed amount)**
   and **sum(quantity)** with the natural-sign correction already in the codebase.

3. **Adopt the Rows/Columns/Values/Filters pivot UX** but scoped to what's
   achievable: a **Group-By (rows) + optional pivot dimension or period (columns) +
   measure (amount/quantity/count) + dimension filters** control bar, an
   expand/collapse row-group tree (reuse `TreeView`/`useTree` + `reportTree.ts`),
   subtotals + grand total, and **double-click drill-through** to the journal lines
   behind a cell (reuse the existing `AccountLedgerDrawer` pattern).

4. **Consolidate hardcoded per-dimension reports into generic measure-anchored
   reports** (per the user's steer): "Revenue", "Expenses", "COGS", "Inventory
   Change", "Scrap" become generic reports whose Group-By is interactive. The
   existing `revenue-by-customer` / `expenses-by-supplier` routes become **preset
   views** (a saved Group-By selection) of the generic reports.

5. **Resolve hierarchies at query time**, not by denormalizing: group by the leaf
   value and, where a parent exists (item → itemGroup, customer → customerType),
   offer the parent as its own Group-By option resolved via a master-data join —
   mirroring the account-category roll-up financial statements already use.

6. **Natural sign + quantity as first-class measures.** Reuse
   `rootSignMultiplier` / `applyRootSignCorrection` so revenue and expense read
   positive; expose `quantity` as a measure so operational questions ("scrap units
   by reason", "units by item group") work from the same pivot.

7. **Close the operational-tagging gap as needed.** "Biggest causes of scrap"
   requires the ScrapReason dimension to actually be tagged on the relevant journal
   lines — today `post-inventory-adjustment` writes zero dimensions and `ScrapReason`/
   `Department` are enum values without writers. Decide in the spec whether v1 ships
   only the dimensions already populated (Location, Item, ItemPostingGroup,
   Customer, CustomerType, Supplier, SupplierType, CostCenter, WorkCenter, Process,
   FixedAssetClass, Employee) and defers scrap/department tagging to a follow-up, or
   includes the posting-function changes to tag them.

8. **Saved views over a config engine.** Start with saved/shareable pivot
   definitions (extend the `reportPin` idea into named, shareable report views)
   rather than a heavyweight report-writer. No classification-matrix config
   (consistent with the `no-matrix-config` preference).

9. **Performance: on-the-fly `GROUP BY` first.** Index `journalLineDimension` and
   the `journalLines` view path on `(companyId, dimensionId, valueId)` /
   `(companyId, accountId, postingDate)`; only add a pre-aggregated per-period,
   per-dimension summary table (Oracle `GL_DAILY_BALANCES` style) if interactive
   latency becomes a problem. Don't build a warehouse up front.

## Open Questions to Carry Into the Spec

- **Scrap/Department tagging**: v1 scope — ship only already-populated dimensions,
  or extend posting functions (esp. `post-inventory-adjustment`) to tag ScrapReason
  / Department so "biggest causes of scrap" works day one?
- **Measure set for v1**: amount + quantity + count enough, or do we need
  calculated/ratio measures (cost per unit)?
- **Columns/pivot axis**: support a full second (column) pivot dimension in v1, or
  ship rows-group + period-columns first and add a free column dimension later?
- **Saved views scope**: per-user pins only (like `reportPin` today), or
  shareable/company-wide saved pivots with permissions in v1?
- **Which generic reports to seed**: Revenue, Expenses, COGS, Inventory Change,
  Scrap — and how existing narrow reports migrate to presets.
- **Aggregation home**: new Postgres RPC (consistent with `accountTreeBalance*`) vs.
  a Kysely query in the service layer — and whether it can reuse period-bucket
  logic (`computeReportPeriodBuckets`).

## Sources

### Sage Intacct
- https://www.intacct.com/ia/docs/en_US/help_action/Intacct_basics/Dimensions/basics-dimensions-overview.htm
- https://developer.intacct.com/api/platform-services/dimensions/
- https://www.intacct.com/ia/docs/en_GB/help_action/Reporting/Get_started/report-types.htm
- https://www.intacct.com/ia/docs/en_US/help_action/Reporting/Interactive_custom_reports/Intro/interactive-custom-report-writer-overview.htm
- https://www.intacct.com/ia/docs/en_US/help_action/General_Ledger/Setup/Statistical_accounts_and_journals/track-statistical-data-overview.htm
- https://www.claconnect.com/en/resources/blogs/sage/sage-intacct-reports-dimension-groups-and-dimension-structures
- https://planergy.com/blog/sage-intacct-dimensions/
- https://intellitecsolutions.com/sage-intacct-best-practices-standard-user-defined-dimensions/

### NetSuite
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_4313464596.html
- https://www.houseblend.io/articles/netsuite-custom-segments-setup-gl-impact
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N648820.html
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_158042187611.html
- https://www.salto.io/blog-posts/netsuite-suiteanalytics-workbook-guide
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_3891485192.html
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_0801122218.html

### SAP
- https://www.cbs-consulting.com/us/sap-universal-journal-acdoca/
- https://blog.sap-press.com/what-is-saps-universal-journal
- https://community.sap.com/t5/technology-blog-posts-by-members/the-ultimate-sap-s-4hana-guide-to-profitability-analysis-co-pa/ba-p/14223304
- https://learning.sap.com/courses/profitability-analysis-in-sap-s-4hana/defining-a-derivation-strategy
- https://blog.sap-press.com/account-based-co-pa-in-sap-s4hana-how-margin-analysis-works-in-the-universal-journal
- https://erproof.com/co/sap-co-training/sap-statistical-key-figures/
- https://www.michaelmanagement.com/blog/sap/a-look-at-statistical-key-figures-and-reporting

### QuickBooks Online / Xero
- http://elearningresources.blob.core.windows.net/cloudhelp/Desktop/Content/Connect/Xero-tracking.htm
- https://www.ledgerlogic.ca/blog/xero-tracking-categories-guide
- https://quickbooks.intuit.com/learn-support/en-us/help-article/class-list/track-transactions-class/L927QQfNV_US_en_US
- https://fitsmallbusiness.com/using-classes-and-locations-quickbooks-online/
- https://quickbooks.intuit.com/learn-support/en-us/help-article/memorizing-reports/create-access-modify-memorized-reports/L8TUb2B8j_US_en_US

### Pivot UX / operational analytics / performance
- https://learn.microsoft.com/en-us/power-bi/paginated-reports/report-builder-tables-matrices-lists
- https://learn.microsoft.com/en-us/power-bi/guidance/star-schema
- https://www.sqlbi.com/articles/controlling-drillthrough-in-excel-pivottables-connected-to-power-bi-or-analysis-services/
- https://blog.prolecto.com/2013/03/14/the-pluses-and-minuses-of-netsuite-financial-statement-polarity/
- https://businesscentralinsights.com/analyze-data-by-dimensions
- https://medium.com/learning-sql/olap-hierarchical-aggregation-with-sql-6c45ebc206d7
- https://blogs.oracle.com/erp-ace/cloud-gls-daily-pl-reporting
- https://support.boldbi.com/kb/article/15430/summary-tables-vs-materialized-views-a-comparison
