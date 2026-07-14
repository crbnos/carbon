# Financial Reporting Research: Best Practices Survey

## Summary

Surveyed how SAP S/4HANA, NetSuite, QuickBooks Online, and Xero implement the core
financial statements package — income statement, balance sheet, trial balance, cash
flow statement — plus the reporting mechanics around them: account-to-line mapping,
retained earnings without a hard close, comparative columns, drill-down, and
consolidated statements. Key findings: (1) every system maps accounts to statement
lines through account type + hierarchy (SMB) or a dedicated layout object (SAP FSV,
NetSuite layouts) — nobody hand-builds statements; (2) the modern consensus is **no
closing entries** — Net Income and Retained Earnings are computed at report time
(NetSuite reference rows, QBO/Xero virtual rollover; SAP is the outlier with posted
balance carryforward, and even SAP also computes the current-year result on the fly);
(3) automated cash flow statements are **indirect method**, derived from net income
plus balance-sheet account deltas, classified into Operating/Investing/Financing by
account type with a per-account override; (4) comparative reporting = relative period
ranges per column plus formula (variance) columns, with balance-sheet accounts always
cumulative and P&L accounts always periodic; (5) drill-down is a universal two-hop:
statement amount → account transactions (GL detail) → journal entry. Carbon already
has trial balance, balance sheet, income statement, and consolidation; the gaps this
research informs are the cash flow statement, retained-earnings/current-year-earnings
split, comparative columns, period-based reporting, drill-down, GL detail, and export.

## Competitors Surveyed

- **SAP S/4HANA** — enterprise reference: FSV hierarchies, Universal Journal (ACDOCA)
  live aggregation, trial balance semantics, balance carryforward, group reporting.
- **NetSuite** — closest architectural peer: mid-market ERP, multi-subsidiary
  consolidation with elimination subsidiaries and CTA (the model Carbon already
  follows), Financial Report Builder, computed retained earnings.
- **QuickBooks Online** — SMB baseline most Carbon customers migrate from; account
  type drives everything; simplest useful model of each report.
- **Xero** — SMB reference for report layouts and drill-down; notable as the
  direct-method cash flow outlier; Carbon already integrates with Xero.

## Key Consensus Patterns

### 1. Accounts map to statement lines via type + hierarchy; layout designers are an enterprise add-on

- **SAP**: Financial Statement Version (FSV) — a time-dependent tree; leaf nodes hold
  from/to account intervals with debit/credit indicators; auto-generated special
  items (Assets, Liabilities+Equity, Net result profit/loss, P+L result, Not
  assigned). Accounts with balances not assigned to any node surface in a "Not
  assigned" section rather than silently disappearing.
- **NetSuite**: reusable statement **layouts** made of Financial Sections whose
  selection criteria are primarily **account type**; computed rows (Gross Profit,
  Net Income) are formula/summary rows; one layout serves many reports.
- **QBO**: no layout object at all — **account type alone** determines statement
  placement and section order (detail type is organizational only).
- **Xero**: standard layouts + an "Edit layout" editor (account groups, formula
  rows); practice-level Report Codes exist for cross-client templates.
- **Rationale**: the statement structure is derivable from the chart of accounts
  classification; a custom layout designer is a power feature layered on top, not a
  prerequisite. An "unassigned accounts" safety net matters more than layout
  flexibility — a statement that silently omits accounts is worse than an ugly one.

### 2. No closing entries: Net Income and Retained Earnings are computed at report time

- **SAP**: statement programs compute the net result at runtime into special FSV
  nodes ("Net result: profit/loss" on the BS, "P+L result" on the IS) so the balance
  sheet balances mid-year with no posting. Year-end **balance carryforward**
  (FAGLGVTR) then posts P&L balances into retained earnings account(s) (OB53
  mapping) as period-0 documents — and self-adjusts when late postings hit a closed
  year.
- **NetSuite**: never posts closing entries. Balance sheet "Net Income" row = a
  reference row against the income statement for fiscal-year-start → as-of date;
  "Retained Earnings" row = cumulative net income from inception → beginning of the
  report's fiscal year, plus direct postings to the RE account. Year-end close is
  automatic when all periods close; P&L history is preserved.
- **QBO**: identical model — "Net Income" = fiscal-YTD computed; "Retained Earnings"
  = sum of prior years' net income + manual RE postings; the rollover is a virtual
  "electronic swap" with no visible transactions; RE has no register.
- **Xero**: identical — "Current Year Earnings" (drills to the P&L) + "Retained
  Earnings" system account (locked for normal coding).
- **Rationale**: computing avoids closing-entry bulk postings, keeps P&L history
  queryable forever, and makes reopening trivial. The universal split is: **Retained
  Earnings = inception → fiscal-year start (+ direct RE postings); Current Year
  Earnings = fiscal-year start → as-of date**. Carbon's period-closing spec already
  chose the computed model; the balance sheet must present the two lines separately,
  not one merged "Net Income" line.

### 3. Cash flow statement: indirect method, classified by account type, with per-account override

- **SAP**: standard app is **indirect method** (F3076), driven by semantic tags on
  FSV nodes; strategic successor is finance-owned "Reporting Rules" classifying by
  account ranges. A direct-method view exists only on the treasury/cash-management
  side.
- **NetSuite**: indirect only. Operating starts at Net Income (reference row), then
  period **changes** in working-capital account balances by account type (AR,
  inventory, other current assets, AP, other current liabilities); Investing =
  changes in Fixed Asset + Other Asset accounts; Financing = changes in Long Term
  Liability + Equity accounts; ends with Net Change in Cash, Beginning Cash,
  FX effect on cash, Ending Cash. Classification lives in the report layout keyed on
  account type.
- **QBO**: indirect, fixed classification by account type (current asset/liability →
  Operating; fixed/other asset → Investing; long-term liability + equity →
  Financing). QuickBooks **Desktop** exposes "Classify Cash" — per-account override
  among O/I/F — and its absence in QBO is a documented pain point (e.g. long-term
  deferred revenue misfiled under Financing).
- **Xero**: the outlier — **direct method** from coded cash transactions; an
  indirect-method report is a top open feature request precisely because accountants
  need the net-income reconciliation for three-way reporting.
- **Rationale**: the indirect method is the automation consensus because every input
  already exists in the GL — net income from the P&L, everything else from
  balance-sheet deltas; no transaction-level cash tagging needed. Both ASC 230 and
  IAS 7 permit it, and US GAAP requires an indirect reconciliation even from
  direct-method filers. Default the O/I/F bucket from account type, exclude cash
  accounts from the body (their delta is the bottom line), and provide a per-account
  override — the edge cases (deferred revenue, shareholder loans) are exactly where
  type-based defaults are wrong. Non-cash addbacks (depreciation) fall out
  automatically as the delta of accumulated-depreciation accounts.

### 4. Comparative reporting: relative period ranges per column + variance formula columns

- **SAP**: RFBILA00/F.01 takes reporting year+period range and comparison
  year+period range, outputs both plus absolute and relative difference. Fiori F0708
  makes End Period / Comparison End Period mandatory filters. The hard semantic
  rule: **balance sheet accounts are always cumulative (carryforward + periods up to
  the limit); P&L accounts sum only the selected interval**.
- **NetSuite**: report columns carry an "Alternate Date/Period Range", either fixed
  or **relative to the report date** (Previous Period, Last Fiscal Year, This FY to
  Date), so comparison columns shift automatically; variance and % change are
  formula columns; Budget vs Actual is the same row layout with Budget Amount +
  variance formula columns; "View Columns By" generates month-by-month matrix
  columns (30-column limit).
- **QBO**: Previous Period / Previous Year / YTD checkbox columns, each with
  optional $ change and % change; % of Income/Expense/Row/Column; column split by
  month/quarter/class/location.
- **Xero**: "Compare with" N previous periods, same-month-last-year, budget columns
  with variance as value or percent.
- **Rationale**: comparisons are never snapshots — they are just different period
  aggregations over the same journal, so they stay correct after reopening/adjusting.
  Relative ranges (prior period, same period prior year, YTD) cover ~all real use;
  budget comparison is the same mechanism with the budget as the alternate source
  (Carbon's budgeting spec Phase 3 already plans exactly this).

### 5. Drill-down: statement amount → account detail (GL register) → journal entry

- **SAP**: FSV node → G/L account balance → line items → journal entry document
  (F0708 → Display G/L Account Balances → line-item browser → Manage Journal
  Entries); unbroken because everything aggregates live from ACDOCA.
- **NetSuite**: statement amount → **Account Detail report** (register style: date,
  type, document, amount, running balance, Split column) → transaction record.
  Caveat documented: removing the Amount column breaks drill-down; formula rows are
  not drillable.
- **QBO**: amount → Transaction Report filtered to account + period + basis → source
  transaction.
- **Xero**: balance → **Account Transactions report** scoped to account + period →
  transaction; computed rows drill contextually (Current Year Earnings → the P&L).
- **Rationale**: the two-hop pattern is universal and is what makes statements
  trustworthy — every number can be decomposed to journal lines. It requires a
  general-purpose **GL detail / account transactions report** (account + date-range
  filtered journal line listing with running balance) as the drill target; computed
  rows (Net Income, RE) drill to the statement that defines them, not to lines.

### 6. Trial balance: opening balance / debit / credit / closing balance, period-driven

- **SAP**: Trial Balance app (F0996) columns are Starting Balance, Debit, Credit,
  Ending Balance per account over a ledger + company code + period range; opening
  balance includes period-0 carryforward; "adjusted" trial balance = include special
  periods 13–16, "unadjusted" = stop at period 12. A Trial Balance Comparison app
  compares two timeframes.
- **NetSuite**: as-of-date report, one row per account ordered by account type,
  footer option for Debit/Credit two-column or single net Total column; P&L accounts
  show fiscal-YTD activity, balance-sheet accounts life-to-date; computed RE row
  keeps it balancing at any date. Amounts click through to Account Detail.
- **QBO/Xero**: trial balance + GL detail live in the "For my accountant" section —
  they are close/tie-out artifacts, not management reports.
- **Rationale**: the four-column shape (opening, debit movement, credit movement,
  closing) is the accountant's working format; Carbon's current two-column
  (debit/credit of net change) trial balance covers the minimum but the four-column
  form is what ties periods together and is the standard handoff to external
  accountants.

### 7. Consolidated statements: account-level rate types, report-time CTA, elimination entity

- **SAP**: aggregation tier simply sums company codes (ACDOCA stores group-currency
  amounts on every line); formal tier (Group Reporting) maps accounts to FS items,
  translates CLO (closing) for BS / AVG for P&L with translation difference to a CTA
  item, and posts IC eliminations via monitors.
- **NetSuite**: Subsidiary Context selector (single vs consolidated); Consolidated
  Exchange Rates table with Current/Average/Historical rate types per account
  (General Rate Type + a separate **Cash Flow Rate Type** for the SCF);
  system CTA account computed dynamically at report time; eliminations are journal
  entries posted to a dedicated elimination subsidiary swept during period close.
- **Rationale**: Carbon already implements exactly the NetSuite model
  (`consolidatedRate` on account, `translateTrialBalance`, CTA computation,
  elimination entities) — consolidation is a solved problem for Carbon reporting;
  new reports (cash flow, comparatives) must simply flow through the same
  translation path. NetSuite's separate Cash Flow Rate Type flags a subtlety: cash
  flow lines are period *deltas*, so translating them at the closing rate creates
  artifacts; the FX effect belongs in an explicit "Effect of exchange rate on cash"
  line.

### 8. The month-end deliverable: 3 statements + trial balance + GL detail, with export

- **QBO/Xero/close-checklist literature**: the standard package is P&L, Balance
  Sheet, Cash Flow ("three-way reporting"), supported by Trial Balance and GL detail
  for tie-out; P&L presented in multiple views (vs budget, vs prior period/year, %
  of sales). Export to PDF/Excel (Xero adds Google Sheets) is table stakes;
  manufacturers additionally reconcile inventory/WIP to GL before issuing.
- **SAP**: the Financial Statements Review Booklet (F8587) bundles B/S, P&L, trial
  balance, and cash flow into one reviewable package.
- **Rationale**: financial reporting is consumed as a period-end package tied to the
  close (Carbon's period-closing spec makes closed periods immutable — reports for a
  closed period are reproducible). Export matters because the audience (owners,
  banks, external accountants) lives outside the ERP.

## Answers to Research Questions

1. **How should GL accounts map to statement lines?** By account classification +
   hierarchy, not a layout designer. QBO proves account type alone suffices at SMB
   scale; NetSuite's sections are account-type queries; SAP's FSV adds interval
   mapping for enterprises with many charts. Carbon's `account.parentId` tree +
   `accountType`/`class`/`incomeBalance` already encode statement placement — no new
   mapping object is needed. Adopt SAP's "Not assigned" safety net: surface accounts
   that fail classification instead of dropping them.
2. **How is retained earnings handled without closing entries?** Computed two-line
   split, universally: Retained Earnings = inception → current-fiscal-year start
   (+ direct RE postings); Net Income / Current Year Earnings = FY start → as-of
   date. NetSuite/QBO/Xero all do this; SAP computes current-year result on the fly
   and only materializes carryforward at year-end. Requires a designated
   retained-earnings account (Carbon's `accountType` enum already has "Retained
   Earnings") and the fiscal-year start from `fiscalYearSettings`.
3. **Which cash flow method, and how are accounts classified?** Indirect (SAP,
   NetSuite, QBO; the accounting-automation consensus; Xero's direct method is the
   documented exception users complain about). Classification: Operating = P&L +
   current assets/liabilities deltas; Investing = long-term asset deltas; Financing
   = long-term liability + equity deltas; cash/bank accounts excluded (their delta
   is the result line). Default from account type; per-account override (QuickBooks
   Desktop "Classify Cash", SAP semantic tags) is the escape hatch every mature
   system provides.
4. **How do comparative columns work?** Per-column relative period ranges (previous
   period, same period last year, YTD) + variance formula columns ($ and %), with BS
   accounts cumulative and P&L accounts periodic — recomputed live, never
   snapshotted. Budget comparison is the same mechanism sourcing the budget matrix
   (already specced in Carbon's budgeting Phase 3).
5. **What is the drill-down path?** Statement amount → account-transactions report
   (account + period filter, running balance) → journal entry. Computed rows drill
   to their defining statement. This requires a GL detail report as a first-class
   route.
6. **What does a standard trial balance look like?** One row per posting account:
   opening balance, period debits, period credits, closing balance, with
   debit/credit display driven by account class, computed RE keeping it balanced at
   any date, and zero-balance suppression. Period-driven (fiscal period selector),
   not just free dates, once periods exist.
7. **How do consolidated financial statements work?** Entity selector (single vs
   consolidated), account-level rate types (Current/Average/Historical), report-time
   CTA, eliminations as posted journals on an elimination entity — Carbon already
   implements this model; extend it to the new reports rather than inventing
   anything.

## Competitor-Specific Details

### SAP S/4HANA
- FSV special items are auto-generated and program-filled: Assets, Liabilities+
  Equity, Net result: profit, Net result: loss, P+L result, Not assigned, Notes.
- D/C indicator: same account can report under Assets when in debit and Liabilities
  when in credit (bank accounts), paired via contra items — an enterprise nicety
  Carbon does not need initially.
- Trial balance "adjusted vs unadjusted" is expressed via special periods 13–16 for
  audit adjustments; Carbon's analog would be reporting a period before vs after
  late adjustments, since periods stay reproducible after close.
- Balance carryforward posts period-0 documents and **self-adjusts** on late
  postings to closed years — the reason SAP can afford posted carryforward. Systems
  without that machinery (everyone else) compute instead.
- Plan/actual comparison rides a separate plan table (ACDOCP) — mirrors Carbon's
  `budgetLine` as a parallel source joined by account + period.

### NetSuite
- Row taxonomy worth borrowing conceptually: Financial Section (account-backed),
  Header/Summary pair, Formula Row, Reference Row (value from another statement —
  how Net Income and Beginning Cash appear on BS/SCF), Text Row.
- Budget vs Actual = Amount, Budget Amount, Amount Over Budget, % of Budget columns
  over the standard income-statement layout.
- "Report by Period" preference switches financials between date-range and
  accounting-period semantics — supporting both is the mature end state.
- Consolidated statements include the elimination subsidiary automatically; CTA is
  dynamic at report time; drill-down warns that formula rows aren't drillable.
- Trial balance docs warn TB vs Account Detail can differ subtly due to P&L
  date-range and computed-RE handling — a reconciliation trap to design away.

### QuickBooks Online
- Account Type list (Bank, AR, Other Current Asset, Fixed Asset, Other Asset, AP,
  Credit Card, Other Current Liability, Long Term Liability, Equity, Income, COGS,
  Expense, Other Income, Other Expense) is nearly identical to Carbon's
  `accountType` enum — Carbon's enum was clearly modeled on it, which makes
  QBO-style type-driven classification a natural fit.
- SCF classification is fixed by type in QBO (no override) and users hit real
  misclassification (long-term deferred revenue → Financing); Desktop's "Classify
  Cash" per-account override is the fix. Carbon should ship the override on day one.
- "Close the books" = lock date + optional password; no closing entries — matches
  Carbon's period-closing Locked status.

### Xero
- Direct-method SCF is the cautionary tale: cleaner theory, but the missing
  indirect reconciliation to net income is a top feature request from accountants.
- Current Year Earnings drills to the P&L — the right behavior for computed rows.
- Report Codes (practice-level taxonomy mapped over client charts) foreshadow
  multi-chart standardization — not relevant while Carbon charts are per company
  group.
- Export: PDF, Excel, Google Sheets; saved custom reports + report packs for
  publishing period-end packages.

## Recommended Approach for Carbon

1. **Keep hierarchy-driven statements; no layout designer.** Carbon's account tree +
   `accountType`/`incomeBalance` already place accounts (QBO model). Add SAP's
   safety net: any posting account that can't be classified (e.g. no `accountType`
   or orphaned from the tree) appears in an "Unassigned" section rather than
   vanishing.
2. **Split the balance sheet equity into computed "Retained Earnings" + "Current
   Year Earnings" lines** (NetSuite/Xero naming), replacing the single synthetic
   Net Income line: RE = income-statement activity from inception → fiscal-year
   start + direct postings to the Retained Earnings account; CYE = FY start → as-of
   date. Fiscal-year boundaries come from `fiscalYearSettings.startMonth` /
   `accountingPeriod.fiscalYear` (period-closing spec). No closing entries, ever —
   consistent with the period-closing spec's year-end decision.
3. **Build the cash flow statement indirect-method** (SAP/NetSuite/QBO consensus):
   Net Income (computed) + deltas of balance-sheet accounts between two dates,
   bucketed Operating/Investing/Financing. Default the bucket from `accountType`
   (current assets/liabilities → Operating; fixed/other assets → Investing;
   long-term liabilities + equity → Financing; Bank/Cash excluded → bottom
   reconciliation), and add a nullable per-account `cashFlowActivity` override
   column (QuickBooks Desktop "Classify Cash" pattern). In consolidated view, add an
   "Effect of exchange rates on cash" line (NetSuite pattern) since translated
   deltas don't sum cleanly.
4. **Add comparative columns as relative period ranges + computed variance** —
   prior period, same period prior year, and YTD for the income statement; prior
   period / prior year-end for the balance sheet; $ and % variance columns. Honor
   the universal semantic: BS cumulative, P&L periodic. Once period-closing lands,
   let reports run by fiscal period (NetSuite "Report by Period") in addition to
   free date ranges.
5. **Ship the drill-down chain**: make every statement/trial-balance amount a link
   into a new **GL detail (account transactions) report** — journal lines filtered
   by account + date range with running balance and document links — and from each
   line to the journal entry. Computed rows (CYE, RE) drill to the income statement.
6. **Upgrade the trial balance to the four-column form** (opening balance, debits,
   credits, closing balance — SAP F0996 shape) with zero-balance suppression, since
   it is the accountant handoff artifact.
7. **Export the package**: CSV/Excel export of every report and a printable PDF
   financial-statements package (P&L + BS + SCF for a period), consistent with
   Carbon's existing PDF generation infrastructure. This is the close deliverable
   (three-way reporting package) every competitor treats as table stakes.
8. **Reuse the existing consolidation path unchanged** — company selector,
   `consolidatedRate` translation, report-time CTA, elimination entities — for all
   new reports; budget-vs-actual columns stay in the budgeting spec (Phase 3) and
   should reuse the comparative-column mechanism built here.

## Sources

### SAP
- https://community.sap.com/t5/enterprise-resource-planning-blog-posts-by-sap/what-the-fsv-unpacking-standard-financial-statement-versions-in-s-4hana/ba-p/13747219
- https://community.sap.com/t5/technology-blog-posts-by-members/mastering-financial-statement-design-with-manage-global-hierarchies-in-sap/ba-p/14260213
- https://community.sap.com/t5/enterprise-resource-planning-blog-posts-by-sap/new-gl-and-unassigned-gl-mapping-to-financial-statement-version/ba-p/13540659
- https://userapps.support.sap.com/sap/support/knowledge/en/2283719 (Trial balance opening/closing balances)
- https://userapps.support.sap.com/sap/support/knowledge/en/3071770 (Retained earnings logic)
- https://userapps.support.sap.com/sap/support/knowledge/en/3478671 (Accounts landing in "Not Assigned")
- https://userapps.support.sap.com/sap/support/knowledge/en/3348991 (F0708/F3084 comparison periods)
- https://community.sap.com/t5/enterprise-resource-planning-blog-posts-by-sap/cash-flow-statement-reporting-rules-vs-semantic-tags/ba-p/14396951
- https://community.sap.com/t5/enterprise-resource-planning-blog-posts-by-members/s-4hana-finance-balance-carryforward-technical-tip/ba-p/13367327
- https://fioriappslibrary.hana.ondemand.com/sap/fix/externalViewer/?appId=F3076 (Cash Flow Statement – Indirect Method)
- https://eursap.eu/blog/an-overview-of-group-reporting-in-sap-s-4-hana-1909
- https://www.pikon.com/en/blog/fiori-apps-for-finance-in-sap-s4hana/
- https://help.sap.com/docs/SUPPORT_CONTENT/fiaccounting/3361880573.html (RFBILA00)

### NetSuite
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/chapter_N2105415.html (Financial Report Builder)
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N2115374.html (Financial statement rows)
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N2110511.html (Financial statement layouts)
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N2106822.html (Edit Columns page)
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N2093552.html (Income Statement)
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N2098310.html (Balance Sheet)
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N2103273.html (Cash Flow Statement)
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N2103948.html (Customizing cash flow account sections)
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N1520986.html (Trial Balance)
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N2095037.html (Comparative Income Statement)
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N2097218.html (Budget vs. Actual)
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N1457773.html (Year-End Closing)
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N719130.html (Drill-down)
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N278654.html (Consolidated reporting in OneWorld)
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N1522428.html (Account Detail report)
- https://www.sikich.com/insight/retained-earnings-concept-in-netsuite/

### QuickBooks
- https://quickbooks.intuit.com/learn-support/en-us/help-article/chart-accounts/learn-account-detail-types-chart-accounts/L2gCy0rfy_US_en_US
- https://quickbooks.intuit.com/learn-support/en-us/help-article/financial-reports/view-retained-earnings-account-details/L7d6Ugx58_US_en_US
- https://quickbooks.intuit.com/learn-support/en-us/help-article/close-books/close-books-quickbooks-online/L59LelyPM_US_en_US
- https://quickbooks.intuit.com/learn-support/en-us/help-article/financial-reports/run-statement-cash-flows/L7f72hT6Q_US_en_US
- https://longforsuccess.com/quickbooks-tip-classifying-accounts-for-statement-of-cash-flow/ (Classify Cash)
- https://quickbooks.intuit.com/learn-support/en-us/reports-and-accounting/how-do-i-make-it-so-long-term-deferred-revenue-account-will-show/00/718506 (misclassification pain)
- https://quickbooks.intuit.com/learn-support/en-us/help-article/report-management/run-profit-loss-comparison-report/L6GthoBhe_US_en_US
- https://quickbooks.intuit.com/learn-support/en-us/help-article/report-management/show-active-rows-columns-reports/L0fJtAnS2_US_en_US

### Xero
- https://central.xero.com/s/article/Create-reusable-custom-report-layouts
- https://central.xero.com/s/article/Report-codes-for-practices-using-report-templates
- https://central.xero.com/s/article/Balance-Sheet-New-US (Current Year Earnings)
- https://central.xero.com/s/article/Locked-and-system-accounts-in-your-chart-of-accounts
- https://central.xero.com/s/article/Statement-of-Cash-Flows-New (direct method)
- https://productideas.xero.com/forums/967133-reports-tax/suggestions/44961463-reporting-statement-of-cash-flow-indirect-metho (indirect-method feature request)
- https://central.xero.com/s/article/Account-Transactions-report-New (drill target)
- https://central.xero.com/s/article/Export-or-print-a-report

### Standards / general
- https://www.accountingtools.com/articles/cash-flow-statement-indirect-method
- https://corporatefinanceinstitute.com/resources/accounting/statement-of-cash-flows/
- https://openstax.org/books/principles-financial-accounting/pages/16-3-prepare-the-statement-of-cash-flows-using-the-indirect-method
- https://viewpoint.pwc.com/dt/us/en/pwc/accounting_guides/financial_statement_/financial_statement___18_US/chapter_6_statement__US/64_format_of_the_sta_US.html (ASC 230 format)
- https://theceosrighthand.co/the-importance-of-the-month-end-reporting-package/
- https://keitercpa.com/blog/financial-close-checklist/
