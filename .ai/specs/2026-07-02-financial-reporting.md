# Financial Reporting

> Status: in-progress
> Author: Claude (with Brad Barbin)
> Date: 2026-07-02
> Research notes: `.ai/research/financial-reporting.md`

## TLDR

Carbon already renders a trial balance, balance sheet, and income statement from
the account tree via `accountTreeBalancesByCompany`, with multi-company
consolidation, currency translation, and a computed Net Income equity line. This
spec completes the financial statements package to the standard every surveyed
competitor (SAP, NetSuite, QuickBooks, Xero) converges on: a **statement of cash
flows** (indirect method, classified by `accountType` with a per-account
override — the QuickBooks Desktop "Classify Cash" pattern), a correct
**Retained Earnings / Net Income split** on the balance sheet (prior fiscal
years' income folds into the Retained Earnings row, current fiscal year shows as
Net Income — the NetSuite/QBO/Xero computed model, no closing entries, exactly
what the period-closing spec's virtual year-end assumes), **comparative
columns** (prior period / prior year with $ and % variance, recomputed live,
never snapshotted), a **general ledger detail report** that makes every
statement amount drillable (statement → account transactions → journal entry —
the universal two-hop), a **four-column trial balance** (opening / debits /
credits / closing — the SAP F0996 shape accountants hand to auditors), and
**CSV export** on every report. Scope also includes the former Phase 2 items:
**consolidated cash flow** (flows at average rate, cash at closing rates, an
explicit "Effect of exchange rate changes on cash" plug), a **PDF financial
statements package** (BS + IS + SCF in one document via `@carbon/documents`),
a **period picker** (report by fiscal period, reading the period-closing
migration's `fiscalYear`/`periodNumber`), and **saved report views** (named
per-user filter sets). Footprint: one nullable enum column on `account`, one
new personal-preference table (`reportView`), one extended RPC, one PDF
component, and service/UI work in the existing accounting module.

## Problem Statement

A controller closing June (per the period-closing spec) cannot produce the
standard month-end package — three statements plus tie-out reports — from
Carbon today:

- **No cash flow statement.** The third primary statement doesn't exist in any
  form. A manufacturer running on Carbon cannot answer "where did cash go"
  without exporting to a spreadsheet ([accounting routes](apps/erp/app/routes/x+/accounting+/)
  have `trial-balance`, `balance-sheet`, `income-statement` — nothing else).
- **The balance sheet conflates retained earnings with current-year income.**
  `getFinancialStatementBalances` ([accounting.service.ts:196-240](apps/erp/app/modules/accounting/accounting.service.ts))
  synthesizes a single "Net Income" line from *all* income-statement activity
  since inception. After the first fiscal year, that line is wrong twice over:
  prior years' profit should sit in Retained Earnings, and the Net Income line
  should show only the current fiscal year. Every surveyed competitor splits
  these (NetSuite: computed RE = inception → FY start; QBO: "electronic swap";
  Xero: Current Year Earnings). The period-closing spec's year-end design
  ("no closing entries, retained earnings roll-forward happens at report time")
  *depends* on this split existing — today the roll-forward has nowhere to go.
- **Numbers are dead ends.** Statement amounts aren't links. There is no GL
  detail / account-transactions report to drill into, and no journal-entry
  detail view (`journals.tsx` lists entries; there is no `journals.$journalId`).
  An auditor asking "what's in 6100 for June" gets a shrug.
- **No comparisons.** The income statement shows one period. Prior period,
  prior year, and variance — the daily-use view in QBO/Xero/NetSuite — require
  running the report twice and diffing by hand. The budgeting spec (Phase 3)
  plans budget-vs-actual columns on the income statement and needs the
  comparison-column mechanism this spec builds.
- **The trial balance shows only closing balances** (`trialBalance` RPC,
  [20260315000001_per-company-balance-rpc.sql:66](packages/database/supabase/migrations/20260315000001_per-company-balance-rpc.sql)):
  debit/credit of `balanceAtDate` plus a net change. The accountant handoff
  format is four columns — opening balance, period debits, period credits,
  closing balance (SAP Trial Balance app F0996) — which ties each period to the
  next.
- **No export.** Reports render in the app only. The audience for financial
  statements (owners, banks, external accountants) lives outside the ERP; QBO,
  Xero, and NetSuite all treat Excel/PDF export as table stakes.

## Proposed Solution

All inside the existing `accounting` module. Grounded in
`.ai/research/financial-reporting.md`; the sign conventions below follow
`packages/utils/src/accounting.ts` (`journalLine.amount` is **class-normal
signed**: positive = the account's natural direction — debit for Asset/Expense,
credit for Liability/Equity/Revenue).

### 1. Retained Earnings / Net Income split (balance sheet)

Adopt the NetSuite/QBO computed model, which the period-closing spec already
committed to:

- **Net Income** (existing synthetic `NET_INCOME_ACCOUNT_ID` row) becomes
  *fiscal-year-to-date only*: income-statement activity from the fiscal year
  start (derived from `fiscalYearSettings.startMonth` for the report's end
  date) through the report date.
- **Retained Earnings** — the posted account row (`accountType = 'Retained
  Earnings'`) has its *displayed* balance augmented with computed prior-years'
  net income (inception → fiscal year start). Direct postings to the RE account
  (dividends, prior-period adjustments) are already in the account's own
  balance, so displayed RE = posted balance + computed prior years — exactly
  NetSuite's presentation.

Mechanics: when `includeCurrentYearEarnings` is set, `getFinancialStatementBalances`
makes one additional `accountTreeBalancesByCompany` call with
`from_date = fiscalYearStart, to_date = endDate`. For income-statement leaves,
`netChange` of that window = current-year earnings and
`balanceAtDate − netChange` = prior-years' earnings. Existing column semantics
of the report are untouched. Degradation: if the chart has no
`accountType = 'Retained Earnings'` account, keep today's single Net Income
line (all-inception) and surface a warning in the report header. The balance
sheet stays balanced in every case because both lines live inside Equity and
their sum equals today's single line.

### 2. Statement of cash flows (indirect method)

The automation consensus (SAP F3076, NetSuite, QBO; see research §3): every
input already exists in the GL — net income from the P&L, everything else from
balance-sheet deltas. This section defines the single-company computation;
§7 extends it to consolidated mode.

**Classification.** A new nullable `cashFlowActivity` enum column on `account`
(`'Operating' | 'Investing' | 'Financing'`) is the per-account override
(QuickBooks Desktop "Classify Cash"; SAP semantic tags). When NULL, the bucket
defaults from `accountType`:

| `accountType` | Default bucket |
|---|---|
| Bank, Cash | **Excluded** — the reconciliation target, not a flow line |
| Accounts Receivable, Inventory, Other Current Asset, Accumulated Depreciation, Accounts Payable, Other Current Liability, Tax | Operating |
| Fixed Asset, Other Asset, Investments | Investing |
| Long Term Liability, Equity - No Close, Equity - Close, Retained Earnings | Financing |
| Income, COGS, Expense, Other Income, Other Expense | n/a — rolls into the Net Income line |
| NULL / anything else | **Unclassified** section (SAP "Not assigned" pattern — surfaced, never dropped) |

Classifying `Accumulated Depreciation` → Operating makes the D&A addback fall
out automatically (its period delta *is* the addback), fixing the QBO
known-wart of depreciation landing in Investing.

**Computation** (`getCashFlowStatement`, one `accountTreeBalancesByCompany`
call over `[startDate, endDate]` + the accounts list):

- Net Income = Σ over income-statement leaves of `rootSignMultiplier(class) × netChange` (identical to the income statement's bottom line).
- Cash effect of each non-cash balance-sheet leaf = `class === 'Asset' ? −netChange : +netChange` (an asset increase consumes cash; a liability/equity increase provides it — trivially correct under class-normal signing).
- Sections: Operating (Net Income + adjustments + working-capital changes), Investing, Financing, Unclassified.
- Beginning cash = Σ over Bank/Cash leaves of `balanceAtDate − netChange`; Net change in cash = Σ of their `netChange`; Ending cash = sum.
- Tie-out: Net Income + Σ all section effects = net change in cash **by the double-entry identity** — as long as every BS account is bucketed (the Unclassified section preserves the identity while flagging the gap). A mismatch is a data bug and renders as an explicit "Unreconciled difference" line rather than silently forcing the total.

**Route** `cash-flow.tsx` beside the other statements; sectioned report UI
(flat sections with subtotals, not the account tree); every line drills to the
GL detail report; Net Income drills to the income statement.

### 3. Drill-down chain + general ledger detail report

The universal two-hop (research §5): statement amount → account transactions →
journal entry.

- **GL detail report** (`general-ledger.tsx`): journal lines joined to their
  journal (posting date, journal `journalEntryId`, source type, document
  reference, description, debit, credit via `toDisplayDebit`/`toDisplayCredit`)
  filtered by account, company, date range, and source type; built on the
  shared `Table` component (CSV export for free). When filtered to a single
  account, shows an opening-balance row and a running balance column. Posted
  and Reversed journals only by default (Draft visible via an explicit status
  filter, excluded from running balance).
- **Journal entry drawer** (`journals.$journalId.tsx`): header + lines via the
  existing `getJournalEntry`, rendered as a Drawer overlay per the detail-view
  convention. The GL detail rows and the journals list both link to it.
- **Statements become drillable**: leaf rows in `FinancialStatementTree` and
  trial balance rows link into the GL detail report pre-filtered to that
  account + the report's window + company. Computed rows drill contextually
  (Net Income / Retained Earnings → income statement — the Xero behavior).

### 4. Four-column trial balance

Extend the `trialBalance` RPC (CREATE OR REPLACE, forking the **newest**
definition per `.ai/lessons.md`) to return, per leaf account: opening balance
(debit/credit split of `balanceAtDate − netChange`), **period debits** and
**period credits** (new leaf-movement sums: a line is a debit when
`(class ∈ {Asset, Expense} AND amount > 0) OR (class ∈ {Liability, Equity,
Revenue} AND amount < 0)`), and closing balance (existing debit/credit split).
Existing return columns are kept — additive change. UI shows grouped columns
Opening | Period activity | Closing with totals proving debits = credits;
zero-balance suppression stays. This is the close tie-out artifact
(period-closing readiness already runs a trial-balance sanity check).

### 5. Comparative columns

Per research §4: comparisons are live recomputations, never snapshots, so they
stay correct after a reopen — and balance-sheet accounts are always cumulative
while P&L accounts are periodic (the SAP rule, already how
`balanceAtDate`/`netChange` behave).

- A `compare` search param on the income statement and balance sheet:
  `none | priorPeriod | priorYear`.
- Income statement: comparison window = same-length window immediately before
  `startDate` (priorPeriod) or the same window shifted one year (priorYear).
  Balance sheet: comparison as-of = one month before `endDate` (priorPeriod) or
  one year before (priorYear).
- Loader runs the same balance call twice (or `getConsolidatedBalances` twice
  in consolidated mode) and zips by account id; UI adds Comparison, $ Variance,
  and % Variance columns to the tree.
- Date-math presets in v1; once period-closing's `fiscalYear`/`periodNumber`
  land, the period picker (§9) drives the same date params. The budgeting spec's
  Phase 3 "Compare to budget" picker plugs into this same column mechanism with
  the budget RPC as the alternate source — built here, consumed there.

### 6. CSV export

- GL detail: automatic via the shared `Table` component
  (`.ai/rules/table-csv-export.md`).
- Statement trees + trial balance + cash flow: an Export CSV button per report
  serializing the loaded rows (account number, name, and the visible amount
  columns) via `json2csv` — the existing standalone pattern
  (`ExchangeRateForm.tsx`). Filename `{report}-{endDate}.csv`.
- PDF statements package: §8.

### 7. Consolidated cash flow

Extends §2 to multi-company (the "All companies" selector the other statements
already have). Standard IAS 21 / ASC 830 presentation, mirroring the rate
model already in `translateTrialBalance`
(`20260315000002_exchange-rate-history.sql`: `translated = local × rate`,
average = AVG of daily rates over the window, closing = latest rate on/before
a date, fallbacks average → closing → 1):

- Compute each company's cash flow statement in its base currency (§2), then
  translate: **flow lines and Net Income at the window's average rate**,
  **beginning cash at the closing rate as of the window start**, **ending cash
  at the closing rate as of the window end**.
- Merge lines across companies by account id (the chart is shared per
  `companyGroupId`), summing translated amounts.
- **Effect of exchange rate changes on cash** = translated ending cash −
  translated beginning cash − translated net flows — the standard plug line,
  rendered between Financing and the cash reconciliation footer. With a single
  currency it is exactly zero.
- Intercompany eliminations are *not* applied to the SCF: elimination journals
  are non-cash balanced adjustments; IC receivable/payable deltas net out
  across the group inside Operating. (The elimination entity's own journals are
  included when it is part of the selection, same as the other statements.)

### 8. PDF financial statements package

The close deliverable: one PDF containing Balance Sheet, Income Statement, and
Cash Flow for the selected window and company (or consolidated) selection —
the "three-way reporting" package (research §8).

- **Hand-built react-pdf tree** (`FinancialStatementsPDF` in
  `packages/documents/src/pdf/`) wrapped in the shared `Template.tsx` page
  shell — the non-customizable authoring style per
  `.ai/rules/pdf-generation-patterns.md`. No document-template/block-registry
  integration in v1 (statements are not customer-customizable documents).
- Served from a `file+` PDF route (canonical `renderToStream` → Buffer →
  `application/pdf` response, copying the sales-invoice PDF route), driven by
  query params (`companies`, `startDate`, `endDate`) and reusing the exact
  service calls the screens use — the PDF always matches what the user sees.
- A "Download PDF" button on the three statement screens links to the route
  with the current filter params.

### 9. Period picker (report by fiscal period)

NetSuite's "Report by Period" semantics as pure UI over the existing
date-range contract: `ReportFilters` gains a Dates | Period mode toggle; Period
mode shows fiscal year + period selects populated from `accountingPeriod`
(`fiscalYear` / `periodNumber` columns from the period-closing migration) and
**writes the selected period's `startDate`/`endDate` into the URL** — loaders,
comparison math, exports, and the PDF route are untouched. Comparison presets
keep their date math (periods are calendar months via
`createFiscalYearPeriods`, so −1 month / −1 year already lands on period
boundaries); the comparison column header shows the period name when period
mode is active. The picker reads `accountingPeriod` directly (columns via
cast), so it depends only on the period-closing **migration** being applied,
not its service layer; when the columns are absent or no periods exist, the
toggle hides and reports behave exactly as today.

### 10. Saved report views

Named, per-user saved filter sets for the five report screens. The existing
table saved-views system is table-bound (`SavedView.table`, filter/sort URL
params) and doesn't fit statement screens, so reports get their own minimal
table — `reportView` — mirroring the `userModulePreference` personal-preference
pattern (`20260512174538_menu-customization.sql`: simple PK, `userId`-scoped
RLS on all four policies, `(userId, companyId, X, name)` uniqueness):

- Row = `{ name, report, params }` where `report` names the screen
  (`balance-sheet` | `income-statement` | `cash-flow` | `trial-balance` |
  `general-ledger`) and `params` is the URL search-param set (companies, dates,
  compare, translated, account, statuses).
- `ReportFilters` gains a views dropdown (apply = navigate with the saved
  params) plus Save / Delete actions backed by one resource route. Views are
  personal (no sharing in v1).

### 11. Posted-only balances (readiness audit fold-in)

Added per the public-company readiness audit (`.ai/specs/2026-07-03-public-company-readiness.md`, SD-1) — done here because this spec already redefines the `trialBalance` RPC and touches every report loader, so the retrofit cost is near zero now and real later. Today `accountTreeBalancesByCompany` and the `journalLines` view **include Draft journals in reported balances** (documented as intentional in `20260702122210_journal-lines-view.sql`); this spec already chose Posted+Reversed for the GL detail report. Extend that decision to the statements:

- `accountTreeBalancesByCompany` and `trialBalance` gain a `p_include_drafts BOOLEAN DEFAULT FALSE` parameter (added while `trialBalance` is being redefined for four columns anyway; `accountTreeBalancesByCompany` redefined in the same migration). Default **excludes Draft** journals — statements, trial balance, cash flow, and comparatives all report posted reality by default.
- Report filter bars gain an "Include drafts" toggle (preview workflow preserved; off by default) that passes the param through; the account-ledger drill-down drawer follows its parent's toggle so the tie-out contract (drawer == tree row) holds in both modes, with the existing Draft badge marking draft lines when included.
- The period-closing readiness check ("draft journals in period" = close blocker) is unchanged — drafts must still be resolved before close; they just no longer move the statements silently in the meantime.

### Out of scope (all phases)

Cash-basis reporting toggle (accrual only), dimension/cost-center-filtered
statements (future spec; budget columns belong to the budgeting spec's
Phase 3), block-template customization of the PDF package, shared/company-wide
saved views.

### Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Statement structure | Account tree + `accountType`/`incomeBalance` classification; **no layout designer** | QBO proves type-driven placement suffices at SMB scale; SAP FSV/NetSuite layouts are enterprise add-ons. Carbon's tree already encodes placement. Unclassified accounts surface in a section, never dropped (SAP "Not assigned"). |
| RE / Net Income | Computed at report time; RE row = posted balance + prior-years' income; Net Income = fiscal-YTD | NetSuite/QBO/Xero consensus; the period-closing spec's virtual year-end requires exactly this; self-healing on prior-year reopen. No closing entries, ever. |
| Fiscal year boundary | Derived from `fiscalYearSettings.startMonth` (fallback: calendar year when missing) | Works before period-closing's generated periods exist; period-closing backfills `fiscalYear` from the same source, so the two stay consistent. |
| Cash flow method | Indirect only | SAP/NetSuite/QBO standard, US GAAP-required reconciliation, computable entirely from existing GL data. Xero's direct method is the documented cautionary tale (top feature request is the indirect view). |
| Cash flow classification | Default by `accountType` + nullable per-account `cashFlowActivity` override | QBO's fixed-by-type without override causes real misclassification pain; QuickBooks Desktop "Classify Cash" is the fix. One nullable column, no mapping table. |
| Accumulated depreciation bucket | Operating (default) | Its delta is the D&A addback; distinct `accountType` lets Carbon be correct-by-default where QBO structurally can't. |
| SCF scope | Single company AND consolidated (flows at average rate, cash at closing rates, explicit FX-effect plug line) | Standard IAS 21/ASC 830 presentation; mirrors the exact rate model of `translateTrialBalance` (`local × rate`, avg → closing → 1 fallbacks). Eliminations skipped on SCF (non-cash by construction). |
| PDF package | Hand-built react-pdf tree (`FinancialStatementsPDF`) in `Template.tsx` shell + `file+` PDF route reusing the screens' service calls | The non-customizable authoring style per `.ai/rules/pdf-generation-patterns.md`; block-registry is for customer-customizable docs, which statements are not. PDF = what the screen shows, by construction. |
| Period picker | UI-only mode in `ReportFilters` that writes the period's start/end dates to the URL; reads `accountingPeriod.fiscalYear`/`periodNumber` directly via cast | Loaders/compare/export/PDF stay date-driven (zero contract change); depends only on the period-closing migration, not its services; hides gracefully when columns/periods are absent. |
| Saved report views | New `reportView` table (`userId`-scoped RLS, `(userId, companyId, report, name)` unique, `params` JSONB) mirroring `userModulePreference` | Existing saved-views system is Table-component-bound; personal-preference precedent is the exact fit. One resource route serves all five reports. |
| Trial balance upgrade | Extend `trialBalance` RPC additively (opening + period debits/credits + closing) | Four-column is the accountant handoff form (SAP F0996); additive return columns avoid breaking the existing screen during transition. |
| Comparatives | Two live balance calls zipped in the loader; `compare` URL param; variance computed in TS | Never snapshot (stays correct after reopen); simplest thing that also serves budgeting Phase 3's column mechanism. |
| Draft journals in balances | Excluded by default (`p_include_drafts DEFAULT FALSE` on both balance RPCs) + explicit "Include drafts" toggle; drill-down drawer follows its parent | Readiness audit SD-1: statements handed to reviewers/auditors are IPE and must reflect posted reality; matches this spec's own GL-detail default; cheapest while the RPCs are already being redefined. |
| Drill target | New GL detail report route + `journals.$journalId` Drawer | The two-hop is universal (research §5); Drawer per detail-view convention. |
| Multi-tenancy (heuristic 1) | One new table: `reportView` with `companyId` + `userId` (personal preference rows; simple PK per the `userModulePreference` precedent). `cashFlowActivity` lands on `account` (group-scoped by `companyGroupId`, its existing pattern); all journal queries scope `companyId` | `account` deliberately has no `companyId` (shared chart); `reportView` follows the established personal-preference shape rather than the composite-PK business-entity template. GL detail service filters `journalLine.companyId` explicitly. |
| Service shape (heuristic 2) | `getCashFlowStatement`, `getConsolidatedCashFlowStatement`, `getCurrencyRatesForWindow`, `getGeneralLedgerLines`, `getReportViews`/`upsertReportView`/`deleteReportView`, extended `getFinancialStatementBalances`/`getTrialBalance` — all in `accounting.service.ts`, `(client, ...)` → `{data, error}` | One module service file; no new files beyond routes/UI and the PDF component. |
| RLS (heuristic 3) | `reportView`: four policies gated on `"userId" = auth.uid()::text` (personal rows — `userModulePreference` precedent). Everything else inherits: `account` UPDATE policy covers the new column; GL detail reads ride `journal`/`journalLine` SELECT policies | Personal-preference tables use owner-scoped RLS, not module-permission RLS — established precedent; verified policies exist on all read tables. |
| Permissions (heuristic 4) | All report loaders + the PDF route `view: "accounting"` + `role: "employee"` (matches existing report routes); `cashFlowActivity` edits ride the account form's `update: "accounting"` action; report-view saves need only the report's own `view` permission (personal data) | Exact precedent: `balance-sheet.tsx:31`. |
| Forms (heuristic 5) | Cash Flow Activity select added to the existing account form (`ValidatedForm` + extended `accountValidator`); save-view uses a small named form via the resource route (`ValidatedForm` + `reportViewValidator`) | Both follow the standard form pattern. |
| Module layout (heuristic 6) | Everything in `apps/erp/app/modules/accounting/` + `routes/x+/accounting+/` | No new module; report UI under `modules/accounting/ui/Reports/`. |
| Backward compatibility (heuristic 7) | RPC extended additively; `getFinancialStatementBalances` gains optional args; the Net Income line's *meaning* changes (fiscal-YTD instead of inception-to-date) | The meaning change is the point of the feature and only affects display (no posted data). Called out in acceptance criteria; no frozen surface touched. |

## Data Model Changes

One idempotent migration (`pnpm db:migrate:new financial-reporting`, randomized
HHMMSS — never `000000`), then `pnpm run generate:types`:

```sql
-- Cash flow activity override (QuickBooks Desktop "Classify Cash" pattern).
-- NULL = derive from accountType at read time.
DO $$ BEGIN
  CREATE TYPE "cashFlowActivity" AS ENUM ('Operating', 'Investing', 'Financing');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "account"
  ADD COLUMN IF NOT EXISTS "cashFlowActivity" "cashFlowActivity";

-- Redefine the accounts view so the new column is exposed (DROP + recreate
-- with SELECT * per view-redefinition convention).
DROP VIEW IF EXISTS "accounts";
CREATE VIEW "accounts" WITH(SECURITY_INVOKER=true) AS
SELECT * FROM "account";

-- Saved report views — personal-preference table mirroring
-- userModulePreference (20260512174538_menu-customization.sql):
-- simple PK, owner-scoped RLS, (userId, companyId, report, name) unique.
CREATE TABLE IF NOT EXISTS "reportView" (
  "id" TEXT NOT NULL DEFAULT id('rpv'),
  "userId" TEXT NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "companyId" TEXT NOT NULL REFERENCES "company"("id") ON DELETE CASCADE,
  "report" TEXT NOT NULL CHECK ("report" IN
    ('balance-sheet', 'income-statement', 'cash-flow', 'trial-balance', 'general-ledger')),
  "name" TEXT NOT NULL,
  "params" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMP WITH TIME ZONE,

  CONSTRAINT "reportView_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "reportView_userId_companyId_report_name_key"
    UNIQUE ("userId", "companyId", "report", "name")
);
CREATE INDEX IF NOT EXISTS "reportView_userId_companyId_idx"
  ON "reportView" ("userId", "companyId");
ALTER TABLE "reportView" ENABLE ROW LEVEL SECURITY;
-- Owner-scoped policies (personal rows), per userModulePreference precedent:
-- SELECT / INSERT / UPDATE / DELETE all gate on "userId" = auth.uid()::text

-- Four-column trial balance: fork the NEWEST definition
-- (20260315000001_per-company-balance-rpc.sql) and extend additively.
-- New return columns: openingDebit, openingCredit, periodDebits,
-- periodCredits (closing = existing debitBalance/creditBalance).
DROP FUNCTION IF EXISTS "trialBalance"(TEXT, TEXT, DATE, DATE);
CREATE OR REPLACE FUNCTION "trialBalance" (
  p_company_group_id TEXT,
  p_company_id TEXT DEFAULT NULL,
  from_date DATE DEFAULT (now() - INTERVAL '100 year'),
  to_date DATE DEFAULT now()
)
RETURNS TABLE (
  "accountId" TEXT,
  "accountNumber" TEXT,
  "accountName" TEXT,
  "accountClass" "glAccountClass",
  "incomeBalance" "glIncomeBalance",
  "openingDebit" NUMERIC(19, 4),
  "openingCredit" NUMERIC(19, 4),
  "periodDebits" NUMERIC(19, 4),
  "periodCredits" NUMERIC(19, 4),
  "debitBalance" NUMERIC(19, 4),   -- closing, kept for compatibility
  "creditBalance" NUMERIC(19, 4),  -- closing, kept for compatibility
  "netChange" NUMERIC(19, 4)
) LANGUAGE "plpgsql" SECURITY INVOKER SET search_path = public
AS $$
-- Body: existing leaf/balance logic + a movements CTE:
--   periodDebits  = Σ ABS(amount) of in-range lines where the line is a debit:
--     (class IN ('Asset','Expense') AND amount > 0) OR
--     (class IN ('Liability','Equity','Revenue') AND amount < 0)
--   periodCredits = the mirror case
--   opening = balanceAtDate − netChange, split debit/credit by class sign
--   (same CASE style as the existing closing-balance split)
$$;
```

Notes:
- One new table (`reportView`, personal-preference shape with owner-scoped RLS
  and audit-by-ownership — no `createdBy`, matching `userModulePreference`);
  everything else inherits (`account` is group-scoped by design;
  `journal`/`journalLine` policies unchanged).
- The `accounts` view is a plain `SELECT *` today
  (`20260229000003_chart-of-accounts-tree.sql`); recreating it after the column
  add follows the view-redefinition convention.
- `DROP FUNCTION` before `CREATE` because the return table changes (Postgres
  cannot `CREATE OR REPLACE` with a different OUT row type); both statements
  are idempotent so the migration re-runs safely.

## API / Service Changes

All in `apps/erp/app/modules/accounting/accounting.service.ts` (+ zod in
`accounting.models.ts`, types in `types.ts`, barrel exports unchanged):

```ts
// Extended: fiscal-year-aware RE/CYE split (extra RPC call over the FY window)
getFinancialStatementBalances(client, companyGroupId, companyId, {
  startDate, endDate,
  includeCurrentYearEarnings?: boolean   // now splits RE (prior years) from Net Income (fiscal YTD)
})

// New: indirect-method cash flow (single company, local currency)
getCashFlowStatement(client, companyGroupId, companyId, { startDate, endDate })
// → { data: { operating: Line[], investing: Line[], financing: Line[],
//              unclassified: Line[], netIncome, netChangeInCash,
//              beginningCash, endingCash }, error }

// New: consolidated cash flow — per-company SCF translated to parent currency
// (flows × average rate, cash × closing rates) + FX-effect plug line
getConsolidatedCashFlowStatement(client, companyGroupId, companyIds, parentCurrency, { startDate, endDate })
// → same shape + { effectOfExchangeRates: number }

// New: scalar rates for a currency over a window (mirrors translateTrialBalance
// fallbacks: average → closing → 1); parent currency returns 1s
getCurrencyRatesForWindow(client, companyGroupId, currencyCode, { startDate, endDate })
// → { data: { average, closingAtStart, closingAtEnd }, error }

// New: saved report views (personal; owner-scoped RLS does the heavy lifting)
getReportViews(client, companyId, userId, report)
upsertReportView(client, { id?, userId, companyId, report, name, params })
deleteReportView(client, id, userId)

// New: GL detail (journal lines + journal header, paginated)
getGeneralLedgerLines(client, companyId, args: GenericQueryFilters & {
  accountId?: string; startDate?: string; endDate?: string;
  sourceType?: string; status?: string[];   // default Posted + Reversed
})
// plus getGeneralLedgerOpeningBalance(client, companyGroupId, companyId, accountId, beforeDate)
// for the running-balance row (reuses accountTreeBalancesByCompany)

// Unchanged signature; returns the four-column RPC shape
getTrialBalance(client, companyGroupId, companyId, { startDate, endDate })

// New pure helper (models or utils): default bucket from accountType
getCashFlowActivityForAccountType(accountType | null): CashFlowActivity | "Excluded" | null
```

Models: `accountValidator` gains optional `cashFlowActivity`;
`cashFlowActivities` enum array exported for the select.

Routes (all under `apps/erp/app/routes/x+/accounting+/` unless noted, loaders
`view: "accounting"` + `role: "employee"`):
- `cash-flow.tsx` — new statement route (company selector incl. consolidated,
  date range, FX-effect line in consolidated mode, export).
- `general-ledger.tsx` — new GL detail report (shared `Table`, filters, running
  balance when single-account).
- `journals.$journalId.tsx` — new Drawer child of `journals.tsx` showing the
  entry via `getJournalEntry`.
- `income-statement.tsx` / `balance-sheet.tsx` — `compare` param, second
  balance call, variance columns.
- `trial-balance.tsx` — four-column data, drill links.
- `report-views.tsx` — resource route (actions only) with `intent`:
  `save` | `delete`, shared by all five report screens.
- `apps/erp/app/routes/file+/accounting+/financial-statements[.]pdf.tsx` — PDF
  package route (query params `companies`, `startDate`, `endDate`); canonical
  `renderToStream` shape copied from the sales-invoice PDF route.

`path.to` additions: `cashFlowStatement`, `generalLedger`, `journalEntry(id)`,
`reportViews`, `financialStatementsPdf`.

PDF component: `FinancialStatementsPDF` in `packages/documents/src/pdf/`
(hand-built tree in the `Template.tsx` shell; barrel-exported from
`pdf/index.ts`; styled via `useTw()` semantic grays).

## UI Changes

All under `apps/erp/app/modules/accounting/ui/` (copying the nearest existing
screen per UI precedent rule):

- **`Reports/CashFlowStatement.tsx`** — sectioned statement (Operating /
  Investing / Financing / Unclassified + cash reconciliation footer); rows link
  to GL detail; header warning when the Unclassified section is non-empty
  ("N accounts need a cash flow activity — set account type or override").
- **`Reports/FinancialStatementTree.tsx`** — leaf amounts become links to GL
  detail (account + window prefilled); comparison/variance columns when
  `compare` is active; Retained Earnings row shows the augmented balance with a
  "computed" affordance (tooltip: posted + prior years' income); Net Income row
  drills to the income statement.
- **`Reports/TrialBalanceTable.tsx`** — Opening | Period | Closing column
  groups with debit=credit footer totals; rows link to GL detail.
- **`Reports/ReportFilters.tsx`** — gains the Compare select (income statement
  / balance sheet) — everything else (date pickers, company selector,
  translation toggle) reused as-is.
- **`GeneralLedger/GeneralLedgerTable.tsx`** — shared `Table` over
  `getGeneralLedgerLines` (CSV export automatic); opening-balance + running
  balance in single-account mode; each row links to the journal drawer.
- **`JournalEntries/JournalEntryDrawer.tsx`** — read-only entry header + lines
  (Drawer overlay convention).
- **Account form** (`ChartOfAccounts/`) — Cash Flow Activity select (options
  Operating/Investing/Financing + "Default (from account type)" for NULL),
  visible for Balance Sheet accounts only.
- **Export CSV button** on the three statement routes + trial balance
  (`json2csv` standalone pattern); **Download PDF button** on the three
  statement routes linking to the financial-statements PDF route with current
  params.
- **`Reports/ReportFilters.tsx`** additions: Dates | Period mode toggle
  (Period mode = fiscal year + period selects reading `accountingPeriod`;
  writes the period's dates to the URL; hidden when period columns/rows are
  absent) and a saved-views dropdown (apply/save/delete via the `report-views`
  resource route).
- **Cash flow consolidated mode**: "All companies" option renders translated
  sections in the parent currency plus an "Effect of exchange rate changes on
  cash" line between Financing and the cash reconciliation footer.
- Sidebar: Cash Flow and General Ledger added to the accounting nav beside the
  existing reports.

## Acceptance Criteria

- [ ] **RE/CYE split**: with FY = calendar year and posted revenue of 100 in Dec 2025 and 40 in Mar 2026, the balance sheet as of 2026-03-31 shows Retained Earnings = RE-account posted balance + 100 and Net Income = 40; the equity section totals match today's single-line total; balance sheet still balances (Assets − Liabilities − Equity ≈ 0 at the root).
- [ ] With no `Retained Earnings`-typed account in the chart, the balance sheet renders the legacy single Net Income line plus a header warning — no crash, still balanced.
- [ ] **Cash flow**: for a period containing a cash sale of 100, an on-credit sale of 50, and a depreciation entry of 20, the statement shows Net Income 170 − AR change 50 + depreciation addback 20 in Operating, net change in cash 120, and Beginning + Net change = Ending equal to the Bank/Cash accounts' GL movement for the period.
- [ ] The cash flow tie-out holds on the demo dataset: Net Income + Σ section effects = Net change in cash, with zero Unreconciled difference while all BS accounts have a bucket; deliberately nulling an account's `accountType` moves it to the Unclassified section (with header warning) without breaking the tie-out.
- [ ] Setting `cashFlowActivity = 'Financing'` on an Other Current Liability account (via the account form) moves its delta from Operating to Financing on the next render.
- [ ] **Drill-down**: clicking a leaf amount on the balance sheet opens the GL detail report filtered to that account + the report window + company; the sum of the listed (Posted/Reversed) lines equals the statement amount; clicking a line opens the journal entry drawer showing balanced lines.
- [ ] GL detail in single-account mode shows an opening-balance row and a running balance whose final value equals the account's closing balance on the trial balance for the same window.
- [ ] **Trial balance**: four column groups render with footer totals where total debits = total credits for opening, period, and closing; for any account, opening + period debits − period credits (class-signed) = closing; zero-balance suppression unchanged.
- [ ] **Comparatives**: income statement with `compare=priorYear` renders Comparison, $ Variance, % Variance columns; the comparison column for a given account equals the plain report run over the shifted window; works in consolidated (multi-company) mode.
- [ ] **Export**: every report (income statement, balance sheet, cash flow, trial balance, GL detail) downloads a CSV whose rows match the visible data.
- [ ] Consolidated balance sheet / income statement behavior (translation, CTA, eliminations) is unchanged from before this feature (regression: same numbers on the demo group).
- [ ] **Consolidated cash flow**: with two companies sharing the parent currency, "All companies" shows summed sections and an FX-effect line of exactly 0; with a foreign-currency subsidiary and differing average vs closing rates, Beginning + Σ flows + FX effect = Ending in the parent currency.
- [ ] **PDF package**: Download PDF on the balance sheet returns an `application/pdf` response containing all three statements whose totals match the on-screen reports for the same params; works in consolidated mode.
- [ ] **Period picker**: with the period-closing migration applied and FY2026 periods generated, selecting "FY2026 · P6" sets the June date range and the report matches the same report run with those dates typed manually; without period rows, the toggle is absent and reports behave as before.
- [ ] **Saved views**: saving "Board pack" on the income statement (consolidated + prior-year compare) and reopening it from the dropdown restores the exact URL params; the view is invisible to another user; deleting removes it.
- [ ] **Posted-only default**: with a Draft journal of 75 on a revenue account, the income statement/trial balance exclude it by default; enabling "Include drafts" reproduces the pre-change numbers and the drill-down drawer's tie-out strip matches the tree row in both modes; the period-close readiness blocker for draft journals still fires.
- [ ] `pnpm run generate:types` then scoped typecheck (`pnpm exec turbo run typecheck --filter=@carbon/erp`) and `pnpm run lint` pass; migration applies idempotently twice.

## Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| Fiscal-year derivation wrong for companies whose `startMonth` changed historically | Med | Derive FY start from `fiscalYearSettings` at report time (same source period-closing backfills from); document that historical startMonth changes shift the RE/NI split; the period picker (§9) sidesteps it by using stored period boundaries |
| Existing charts have NULL `accountType` on many leaves → noisy Unclassified section | Med | Unclassified section + header warning makes the gap visible and actionable (set type or override); tie-out identity is preserved regardless |
| `trialBalance` RPC return-shape change breaks the existing screen during migration | Low | Additive columns; existing `debitBalance`/`creditBalance`/`netChange` keep their meaning; screen updated in the same phase; types regenerated before typecheck |
| Two balance calls per comparative/consolidated render → slow reports on big charts | Low | The RPC is a single recursive query already used per render; two calls stay interactive; period-closing's closed periods make caching possible later if needed |
| CTA account matched by hardcoded number `"3200"` in existing consolidation code | Low | Out of scope to fix here, but new code must not copy the pattern; noted for a follow-up (use account designation, not number) |
| Net Income line meaning change surprises existing users | Low | It becomes *correct* (fiscal-YTD); release note + tooltip on the computed rows; prior behavior only ever existed pre-first-year-end |
| Running balance pagination (GL detail) — page N needs cumulative sum of pages 1..N−1 | Low | Opening balance computed server-side for the filter window start; running balance rendered only when a single account is selected and sort is posting-date ascending |
| Sparse `exchangeRateHistory` (few daily rates) makes the average rate unrepresentative → inflated FX-effect plug | Med | Same fallback chain as `translateTrialBalance` (average → closing → 1) keeps it consistent with the BS/IS translation; the FX line makes the distortion visible instead of hiding it in section totals |
| Period picker reads period-closing's columns before that feature ships | Low | Reads columns via cast directly from `accountingPeriod`; toggle hides when columns/rows are absent — zero coupling to period-closing's service layer or UI |
| PDF render cost for large charts (three statements in one document) | Low | Fonts are bundled/registered in-process (no network); data calls are the same three the screens make; statements render summary rows, not journal lines |

## Open Questions

> All questions resolved 2026-07-02 (recommendations accepted; user requested
> spec + plan together, delegating open-question resolution to best judgment —
> same pattern as the period-closing and plaid-bank-feeds specs).

- [x] **Consolidated cash flow in v1?** — **Answer (revised 2026-07-02):** In scope — user brought Phase 2 into v1. Flows and Net Income translate at the window's average rate, cash balances at closing rates for their respective dates, with an explicit "Effect of exchange rate changes on cash" plug line (§7); rate model mirrors `translateTrialBalance` exactly. *(Original resolution deferred this to Phase 2.)*
- [x] **PDF financial-statements package in v1?** — **Answer (revised 2026-07-02):** In scope — user brought Phase 2 into v1. Hand-built `FinancialStatementsPDF` in the `Template.tsx` shell served from a `file+` PDF route reusing the screens' service calls (§8). CSV export still ships alongside. *(Original resolution deferred this to Phase 2.)*
- [x] **Computed-row naming** — **Answer:** Keep "Net Income" (NetSuite/QBO naming; existing Carbon label). The augmented Retained Earnings row keeps the account's own name with a computed-value tooltip.
- [x] **GL detail default status filter** — **Answer:** Posted + Reversed by default. Draft journals are visible only behind an explicit status filter and are always excluded from the running balance (they aren't real GL yet).
- [x] **Comparative presets before period-closing ships** — **Answer (revised 2026-07-02):** Date-math presets stay (correct for calendar-month periods), AND the period picker ships in v1 as UI over the date params (§9) — it reads `accountingPeriod.fiscalYear`/`periodNumber` directly and hides gracefully when the period-closing migration hasn't been applied. *(Original resolution deferred the picker to Phase 2.)*
- [x] **Dimension/cost-center-filtered statements** — **Answer:** Out of scope for this spec — a future spec of its own. Budget comparison columns remain owned by the budgeting spec (Phase 3), which plugs into this spec's comparison-column mechanism.

## Changelog

- 2026-07-02: Created — grounded in codebase exploration (existing trial balance / balance sheet / income statement routes, `accountTreeBalancesByCompany` semantics, class-normal sign convention in `packages/utils/src/accounting.ts`, consolidation path) and competitor research (SAP FSV/F0996/F3076, NetSuite layouts + computed RE + Classify-Cash-style overrides, QBO/Xero computed equity rows and drill-down); see `.ai/research/financial-reporting.md`. Coordinated with the period-closing spec (virtual year-end → report-time RE) and budgeting spec (Phase 3 reuses the comparison-column mechanism).
- 2026-07-02: All open questions resolved (recommendations accepted; user delegated by requesting spec + plan together); status → in-progress. Key calls: SCF single-company in v1, PDF package deferred (CSV ships), "Net Income" label kept, GL detail defaults to Posted+Reversed, date-math comparison presets, dimension-filtered statements out of scope.
- 2026-07-03: **Posted-only balances folded in** per the public-company readiness audit (`2026-07-03-public-company-readiness.md` SD-1, roadmap `.ai/plans/2026-07-03-public-company-readiness-roadmap.md`): `p_include_drafts DEFAULT FALSE` on `accountTreeBalancesByCompany` + `trialBalance`, "Include drafts" toggle on report filters, drawer follows parent. Update `.ai/plans/2026-07-02-financial-reporting.md` tasks accordingly before implementation.
- 2026-07-02: Phase 2 folded into v1 scope at user request — consolidated cash flow (§7, `translateTrialBalance` rate model + FX-effect plug), PDF financial statements package (§8, hand-built react-pdf per `.ai/rules/pdf-generation-patterns.md`), period picker (§9, UI-only over date params, reads period-closing's columns via cast), saved report views (§10, new `reportView` table mirroring `userModulePreference`). Three open-question answers revised accordingly. Still out: cash-basis toggle, dimension-filtered statements, PDF customization, shared views.
