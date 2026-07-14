# Budgeting in Top ERPs — Research Notes

Research date: 2026-07-02. Focus: how leading ERPs model GL budgets, cost-center
budgeting, budget versions/scenarios, entry/seeding workflows, and budget-vs-actual
reporting — with a synthesis for Carbon. Surveyed: SAP (canonical reference),
NetSuite (accounting-domain competitor), and Microsoft Dynamics 365 Business
Central (Carbon's accounting module follows BC/NAV patterns: posting groups,
accounting periods, dimension model).

---

## 1. SAP (ECC CO + S/4HANA)

### Cost center accounting (CO-OM-CCA)

- A **cost center** is an org unit where costs are incurred but revenue is not
  normally measured (department, team, machine group, service function). Master
  data: validity dates, category, person responsible, company code, profit
  center. ([SAP Help — CO-OM-CCA](https://help.sap.com/docs/SUPPORT_CONTENT/ficontrolling/3361881795.html))
- A mandatory **standard hierarchy** contains every cost center exactly once;
  unlimited **alternative groups** for reporting/allocations.
  ([SAP Help — Cost Centers and the Standard Hierarchy](https://help.sap.com/docs/SUPPORT_CONTENT/ficontrolling/3361878477.html))
- **Cost elements** are the GL link: every FI posting to an expense account
  carries both the GL account and a CO object (cost center, order). In S/4HANA
  the cost element and GL account are literally merged into one field in the
  Universal Journal (ACDOCA). ([SAP Press](https://blog.sap-press.com/primary-and-secondary-costs-in-sap-s4hana))

### Plan vs budget — SAP draws a hard line

- **Planning** (KP06) = granular estimate by **version + fiscal year + period +
  cost center + cost element**, used only for variance reporting. Nothing blocks
  overspend ("passive" control).
- **Budgeting** = the approved, binding figure, entered coarsely (per object,
  classically not per cost element), optionally driving **active availability
  control** (warnings → email → hard error at tolerance thresholds like 90%/100%).
- Classic ECC only enforced budgets on internal orders/WBS elements; real cost
  center budget enforcement arrived in S/4HANA 1909 and is still annual-only,
  per cost center + GL account group.
  ([ERPCorp — planning vs budgeting](https://erpcorp.com/sap-controlling-blog/sap-planning/what-is-the-difference-between-planning-and-budgeting-in-sap-controlling),
  [SAP Community — Cost Center Budget Availability Control](https://community.sap.com/t5/enterprise-resource-planning-blog-posts-by-members/cost-center-budget-availability-control/ba-p/13752625))

### Versions / scenarios

- **Version 0** holds the plan of record *and* actuals; plan/actual comparison
  always runs inside version 0. Extra versions (1, 2, …) are plan-only what-ifs.
- S/4HANA replaces versions with **plan categories** in table **ACDOCP** (`PLN`,
  `BUDGET01`, `BUDGET02`…) — a single plan-data table parallel to the actuals
  table. ([SAP Learning](https://learning.sap.com/courses/cost-center-and-internal-order-accounting-in-sap-s-4hana/planning-on-cost-centers-and-internal-orders))

### Entry & seeding workflows

- **Distribution keys** spread an annual amount across periods: equal split, by
  calendar days, percentage progression, proportional to activity, custom.
  ([SAP Help — Distribution Key](https://help.sap.com/doc/baf2cc53a8b77214e10000000a174cb4/3.6/en-US/f9e8cc53a8b77214e10000000a174cb4.html))
- **KP97** copy plan→plan, **KP98** copy actuals→plan, then revalue by ±% —
  "next year = last year + 3%" is a first-class operation. Excel upload is
  ubiquitous in practice.

### Commitments (second tier)

Purchase requisitions/POs account-assigned to a cost center create
**commitments**; assigned value = actuals + commitments; available = budget −
assigned. Commitments reverse as goods receipts/invoices post actuals.
([SAP Community — Cost Center Commitments](https://community.sap.com/t5/enterprise-resource-planning-blog-posts-by-sap/cost-center-commitments-in-sap-s-4hana-cloud/ba-p/13495753))

### Reporting

Canonical daily-use report **S_ALR_87013611 "Cost Centers: Actual/Plan/Variance"**:
rows = cost elements (grouped), columns = actual, plan, variance, variance %, for
a cost center (group) × fiscal year × period range × version. Variants add
commitments, quarterly and prior-year comparisons.
([Econvera guide](https://econvera.org/2025/09/24/sap-s_alr_87013611-cost-centers-actual-plan-variance-report-a-comprehensive-guide/))

### SAP essentials distilled

Plan lines at **cost center × GL account × period × version**; hard split
between advisory plan and binding budget; copy+revalue seeding; commitments as
the purchasing bridge; variance reporting as the primary surface; blocking as an
opt-in, profile-driven layer.

---

## 2. NetSuite

### Data model

- A **budget** covers one fiscal year and is keyed by a criteria tuple:
  subsidiary, fiscal year, **budget category**, **account** (required), and
  optional **department, class, location, customer/project, item** (+ custom
  segments). Amounts stored **per accounting period** within the year.
- Storage: `budgets` header (criteria tuple + year + total) +
  `budgetsMachine` child rows `(budget, period, amount)` — one row per period.
- **Uniqueness: one budget per {criteria tuple + category + fiscal year}.**
  CSV import upserts against this key and overwrites the matched record
  wholesale. Amounts are entered as **positive numbers** for both income and
  expense.
  ([Setting Up a Budget](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N1503407.html),
  [SuiteQL Budgets — Tim Dietrich](https://timdietrich.me/blog/netsuite-suiteql-budgets/),
  [Budgets Machine schema](https://www.netsuitediagnostics.com/posts/budgets-machine/))

### Budget categories = scenarios

The **Multiple Budgets** feature adds named categories ("Original", "Revised",
"Forecast"); reports pick which category to compare against. Consultant practice:
keep Original immutable once approved, reforecast in a separate category
quarterly/monthly. In OneWorld each category is **Global** (root parent currency)
or **Local** (per-subsidiary currency), with a dedicated **Budget Exchange
Rates** table for consolidation at plan rates.
([Multiple Budgets and Budget Categories](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N1506174.html),
[Subsidiary Budgets](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N1506361.html))

### Entry mechanisms

1. **Manual grid** (accounts × 12 periods) with **Fill** (copy first period to
   all) and **Distribute** (divide first period evenly across periods).
2. **CSV import** (dedicated 2-page assistant; account + year + category +
   segments + one column per period).
3. **Copy Budgets**: from prior budget or **from actuals**, with ±% modifier,
   "Keep Detail" (retain or collapse dimension detail), and Replace toggle.
4. **NSPB** (separately licensed Oracle EPM product) for driver-based planning,
   approvals, rolling forecasts — writes back into native budget categories.
([Importing a Budget](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N1505717.html),
[Copying a Budget](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N1505228.html))

### Reporting

**Budget vs. Actual** report = four columns: Amount (actual), Budget Amount,
Amount Over Budget, % of Budget — with a budget category selector and column
expansion by period/class/department/location/subsidiary. Budgets with a
dimension populated line up against actuals carrying the same dimension;
company-level (blank-dimension) budget rows are NOT apportioned down.
Gotcha: the "Report by Period" user preference must be enabled or budget
columns render zero.
([Budget vs. Actual Report](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N2097218.html))

### Enforcement

**Native budgets are reporting-only** ("budgets provide information for reports
but do not control income and expense"). Enforcement comes from the free
**Expense Commitments & Budget Validation** SuiteApp: Budget Control records
with **Warn Only** or **Prevent Save** actions on requisitions/POs/bills,
threshold warnings (e.g. 90%), consumed = actuals + open commitments.
([Creating a Budget Control Record](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_161794703618.html))

### Consultant best practices

- Budget monthly even when planned annually; use Distribute/Fill then hand-adjust
  seasonal accounts.
- Granularity workhorse: **account × department, monthly**. Avoid
  over-dimensioning (customer/item budgets explode row counts; revenue plans only).
- Most real-world entry happens via CSV round-trip (export → Excel → import).
- Restrict budget entry behind a dedicated permission; native budgets have no
  approval workflow or change history (a driver for NSPB upsell).
([Houseblend budgetary control](https://www.houseblend.io/articles/netsuite-budgetary-control-guide),
[RSM — Using Budgets](https://technologyblog.rsmus.com/technologies/netsuite/using-budgets-in-netsuite/))

---

## 3. Microsoft Dynamics 365 Business Central (NAV heritage)

### Data model — header + entry ledger

- **G/L Budget Name (table 95)** — the header: `Name`, `Description`, `Blocked`
  boolean, and **Budget Dimension 1–4 Code** (up to 4 budget-specific dimensions
  chosen per budget). Multiple budgets per year = versions/revisions/forecasts.
- **G/L Budget Entry (table 96)** — the line ledger: `Entry No.`, `Budget Name`,
  `G/L Account No.`, **`Date`** (a plain date, not a period FK), signed
  `Amount`, `Description`, Global Dimension 1–2 codes, Budget Dimension 1–4
  codes, `Business Unit Code` (consolidation), `Dimension Set ID`, user/date audit.
- Amounts aggregate on the fly by filtering entries (budget + account + date
  range + dimension filters) and summing — cells in the matrix are sums of one
  or more entries; drill-down opens the entry list.
- Dimensions stored twice: flattened code columns (2 global + 4 budget) for fast
  filtering, plus a normalized Dimension Set ID.
([G/L Budget Name](https://learn.microsoft.com/en-us/dynamics365/business-central/application/base-application/table/microsoft.finance.generalledger.budget.g-l-budget-name),
[G/L Budget Entry](https://learn.microsoft.com/en-us/dynamics365/business-central/application/base-application/table/microsoft.finance.generalledger.budget.g-l-budget-entry))

### Entry UX — the budget matrix

**Budget page**: matrix with configurable axes — Show as Lines / Show as Columns
each pick from `G/L Account | Period | Business Unit | Global Dim 1/2 | Budget
Dim 1–4`; View by Day/Week/Month/Quarter/Year/Accounting Period; rounding factor;
filters per dimension + account category + income/balance. Editing a cell writes
G/L Budget Entries through a buffer. **Excel export → edit → import (Add or
Replace modes)** is a first-class workflow Microsoft explicitly recommends for
distributing budget entry to department owners.
([Create Budgets](https://learn.microsoft.com/en-us/dynamics365/business-central/finance-how-create-budgets))

### Copy G/L Budget (report 96)

Source = **G/L Entry (actuals)** or **G/L Budget Entry** (another budget), with:
**Adjustment Factor** (e.g. 1.1 = +10%), **Rounding Method**, **Date Change
Formula** (`1Y` shifts last year's actuals into next year), **Date Compression**
(compress day-level actuals to one entry per month), closing-entry filter.
"Copy last year's actuals forward, +X%, rounded, shifted 1Y" is the heart of the
annual cycle.
([Copy G/L Budget](https://learn.microsoft.com/en-us/dynamics365/business-central/application/base-application/report/microsoft.finance.generalledger.budget.copy-g-l-budget))

### Budget vs actual analysis

1. **G/L Balance/Budget page** — per account: actual, budgeted, **Budget %**
   column; View by period length; filters hit both actual and budget entries.
2. **Trial Balance/Budget report** — net change/balance vs budget with % of
   budget columns, dimension-filterable.
3. **Financial reports (account schedules)** — column definitions with Ledger
   Entry Type = Ledger Entries | **Budget Entries**, a **Budget Filter** (which
   budget name feeds the budget columns), and formula columns for variance.
   Shipped column layouts: `ACT/BUD`, `BUDGANALYS`, `CVC YTDBUD`.
4. **Analysis views** with "Include Budgets" — pre-aggregated dimension cubes
   comparing actual vs budget across any 4 dimensions.
([Analyze Actual vs Budget](https://learn.microsoft.com/en-us/dynamics365/business-central/bi-how-analyze-actual-versus-budget),
[Column definitions](https://learn.microsoft.com/en-us/dynamics365/business-central/bi-column-definitions))

### Cost Accounting module (parallel subledger, NAV 2013+)

A GL-fed managerial ledger: **cost types** (≈ P&L accounts), **cost centers**
("where") and **cost objects** ("who/what") seeded from designated dimensions;
GL entries carrying those dimensions transfer to cost entries automatically;
**cost allocations** (static ratios or dynamic bases like headcount) cascade
costs; **cost budgets** (`Cost Budget Entry`: cost type, date, amount, cost
center, cost object) mirror GL budgets with per-cost-center matrix pages and
GL↔CA budget copy jobs. Invariant: every cost entry has exactly one of cost
center or cost object. Powerful but a distinct subsystem most SMB customers
never enable.
([About Cost Accounting](https://learn.microsoft.com/en-us/dynamics365/business-central/finance-about-cost-accounting),
[Cost Budget Entry](https://learn.microsoft.com/en-us/dynamics365/business-central/application/base-application/table/microsoft.costaccounting.budget.cost-budget-entry))

### Enforcement & period interaction — verified

- **Standard BC has no budget enforcement** — no checks on purchase documents,
  no encumbrance. Budget control is a Dynamics 365 Finance (different product)
  feature; in BC it's ISV/AppSource territory.
- Budget entries are plain dates with **no FK to accounting periods**; periods
  matter only as a reporting interval. Closing a fiscal year does **not** lock
  budgets. Practical rule: date budget entries on period start dates.
([Budget control = D365 Finance](https://learn.microsoft.com/en-us/dynamics365/finance/budgeting/budget-control-overview-configuration),
[Accounting periods](https://learn.microsoft.com/en-us/dynamics365/business-central/finance-accounting-periods-and-fiscal-years))

---

## 4. Key Consensus Patterns

### 1. The budget line is account × period × dimension(s), grouped under a named budget
- **SAP**: version + fiscal year + period + cost center + cost element.
- **NetSuite**: category + fiscal year + account + dept/class/location, child
  rows per period.
- **BC**: budget name + account + date + dimension codes.
- **Rationale**: monthly granularity at account × org-unit is the reporting
  workhorse everywhere; anything finer (customer/item) is for revenue plans only.

### 2. Multiple named budgets per fiscal year (versions/scenarios)
- SAP versions/plan categories; NetSuite budget categories (Original/Revised/
  Forecast); BC budget names. Keep the original immutable once approved;
  reforecast in a new version. No approval workflow in any base product.

### 3. Budgets are reporting-only by default; enforcement is opt-in
- SAP: passive plan checks by default, active availability control is opt-in
  config (and cost-center AVC only arrived in 2019, annual-only).
- NetSuite: native budgets never block; SuiteApp adds warn/block on purchasing.
- BC: no enforcement at all in the base product.
- **Rationale**: hard blocks frustrate operations; warn-at-threshold on
  purchasing documents is the common middle ground when control is wanted.

### 4. Copy/seed + spread are first-class operations
- Copy prior budget or copy actuals, apply ±% adjustment factor (all three).
- Spread annual amounts across periods: SAP distribution keys, NetSuite
  Fill/Distribute, BC even entry. Equal-split is the baseline; fancier keys are
  optional.

### 5. Spreadsheet round-trip is the real entry path
- All three treat Excel/CSV export → edit → import as the primary bulk-entry
  mechanism; the in-app matrix is for refinement.

### 6. Variance reporting is the daily-use surface
- Columns: Actual, Budget, Variance (absolute), Variance % — by account rows,
  filterable/pivotable by period and dimension, with a budget/version picker.
- Dimension matching: budget rows tagged with a dimension compare against
  actuals tagged the same; blank-dimension budgets are company-level and are
  not apportioned.

### 7. Budgets are decoupled from period close
- BC explicitly: closing a year doesn't lock budgets; entries are dated, not
  period-FK'd. NetSuite similar. Budgets are forward-looking planning data, not
  books of record — they stay editable after close (new versions capture
  reforecasts).

---

## 5. Recommended Approach for Carbon

Carbon already has the hard parts: chart of accounts (`account`, hierarchical),
first-class accounting periods (`accountingPeriod` gaining
`fiscalYear`/`periodNumber` via the period-close spec), **cost centers**
(`costCenter`, hierarchical), a generic dimension system
(`dimension`/`dimensionValue` incl. entityType `CostCenter`), GL lines tagged via
`journalLineDimension`, and reporting RPCs (`trialBalance`,
`accountTreeBalancesByCompany`).

1. **Follow the NetSuite/BC hybrid**: a `budget` header (name, fiscal year,
   status) + `budgetLine` rows keyed by **account × accounting period × optional
   cost center**, one row per cell (NetSuite-style buckets, not BC's additive
   entry ledger — simpler, upsertable, fits a matrix UI). Multiple budgets per
   fiscal year give versions/scenarios for free.
2. **Cost center as the v1 dimension**, as a direct FK — matching SAP's primary
   budgeting axis and BC cost accounting's hardwired cost center column. The
   generic dimension system stays the actuals-side tagging mechanism; variance
   reporting joins `journalLineDimension` through the CostCenter-type dimension.
   Generic budget dimensions (BC's Budget Dimension 1–4) can come later without
   schema upheaval.
3. **Reporting-only in v1** — consensus default posture in all three ERPs.
   Leave commitments/availability control as a clearly-marked future layer on
   purchasing documents (warn at threshold, never hard-block by default).
4. **Copy/seed as first-class services**: copy from prior budget and seed from
   actuals, both with an adjustment factor — plus Fill/Distribute helpers in the
   matrix UI.
5. **Budget vs Actual report** modeled on NetSuite's four columns (Actual,
   Budget, Variance, % of Budget) with period columns and a cost-center filter,
   implemented as an RPC beside `trialBalance`.
6. **Keep budgets decoupled from period close** (BC/NetSuite precedent), and
   **CSV round-trip** via Carbon's existing csv-import/table-export infra.
7. **Don't build**: approval workflows, driver-based planning, budget exchange
   rates, allocations — that's the NSPB/EPM tier; revisit on demand.
