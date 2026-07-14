# Period Closing in Top ERPs — Research Notes

Research date: 2026-07-02. Focus: how leading ERPs model accounting periods, month-end / year-end close, posting validation, and reopening — with a synthesis for a modern mid-market manufacturing ERP.

---

## 1. SAP (S/4HANA and ECC)

### Posting Period Variant (OB52)

SAP does not close periods per se — it controls *which periods accept postings* via a **Posting Period Variant (PPV)** assigned to one or more company codes. The variant is maintained in transaction OB52 ("Open and Close Posting Periods").
([saponlinetutorials.com](https://www.saponlinetutorials.com/define-variant-for-open-and-close-posting-periods-sap-ob52/), [learntosap.com](https://www.learntosap.com/ficotutorialopenandcloseperiod.html))

Each OB52 row specifies:

- **Account type** — the row applies to a class of accounts:
  - `+` = valid for all account types (a required baseline row; From/To Account left blank)
  - `A` = assets, `D` = customers (A/R), `K` = vendors (A/P), `M` = materials, `S` = G/L accounts
- **Account range** (From Account / To Account) — lets you keep only *specific G/L accounts* open (e.g., only accrual accounts during close).
- **Three period intervals**:
  - **Interval 1** (`From per.1` / `To per.1`) — normal posting periods; can carry an **authorization group** so only privileged users (e.g., the close team) may post in it.
  - **Interval 2** (`From per.2` / `To per.2`) — a second open range, typically the **special periods**, open to everyone or used for the prior period during the close window.
  - **Interval 3** (`From per.3`) — periods checked for postings transferred **from CO to FI** (controlling-internal postings) — S/4HANA-relevant since CO and FI share the Universal Journal.
  ([sapsharks.com](https://sapsharks.com/ob52-open-and-close-fi-posting-periods/), [SAP Community](https://community.sap.com/t5/enterprise-resource-planning-q-a/open-and-close-posting-period-ob52/qaq-p/3980255))

Key design consequences:
- **Granular soft close**: you can close A/P (`K`) and A/R (`D`) while G/L (`S`) remains open — exactly the "lock subledgers first, GL last" pattern.
- **Role-based exception**: interval 1 + authorization group = "period closed for everyone except accountants in group X." This is the SAP mechanism for controllers posting late adjustments.
- Mass maintenance exists via program RFOB5200 for orgs with many variants. ([help.sap.com](https://help.sap.com/docs/SUPPORT_CONTENT/fiaccounting/3361878788.html))

### Special periods 13–16

A fiscal year variant has up to 12 normal periods plus up to **4 special periods (13–16)** that all map to the last calendar month of the fiscal year. They exist solely for **year-end adjustments**: audit adjustments in 13, tax adjustments in 14, etc. Posting to a special period requires a posting date in the last normal period, with the special period entered explicitly. This lets SAP produce multiple year-end financial statement versions (pre-audit, post-audit, post-tax) without contaminating December operational numbers. ([saponlinetutorials.com](https://www.saponlinetutorials.com/define-variant-for-open-and-close-posting-periods-sap-ob52/), [sappeers.wordpress.com](https://sappeers.wordpress.com/2011/02/06/open-and-close-posting-periods-ob52/))

### Year-end: balance carryforward (FAGLGVTR)

- SAP posts **no closing entries** to the old year in the classic income-summary sense. Instead, program **FAGLGVTR** (S/4HANA: "Balance Carryforward" job) writes carryforward records into **period 0** of the new fiscal year: balance-sheet account balances carry forward as-is; P&L account balances roll into the configured **retained earnings account**.
- Crucially, carryforward is **self-maintaining**: once run, any subsequent posting to the old year automatically updates the period-0 carryforward in the new year — so late adjustments never desynchronize opening balances. ([SAP Community](https://community.sap.com/t5/enterprise-resource-planning-blog-posts-by-members/s-4hana-finance-balance-carryforward-technical-tip/ba-p/13367327))
- Typical year-end sequence: open new-year periods → run carryforward → block old-year normal periods, keep special periods open for adjustments → post audit adjustments in periods 13–16 → close special periods.

### Close orchestration: Financial Closing Cockpit / Advanced Financial Closing

- The **Financial Closing Cockpit (FCC)** — embedded in S/4HANA since 1709 — provides **task list templates** modeling the close as a structured, dependency-ordered set of tasks (transactions, jobs, programs, manual tasks) across company codes; stakeholders execute or monitor their tasks, with status reporting and audit trail. ([help.sap.com](https://help.sap.com/docs/SAP_S4HANA_ON-PREMISE/8b1d76cd5e7644caa0553fcf338f3982/3fe49e8767d648a6b1b5edeec8849b8d.html), [SAP Community](https://community.sap.com/t5/financial-management-blog-posts-by-members/sap-s-4hana-financial-closing-cockpit-at-glance/ba-p/13414771))
- **SAP Advanced Financial Closing (AFC)** is the cloud successor: centrally defined close templates, task dependencies, assignments, approvals, automated job execution across many systems/entities, plus close analytics (cycle-time, bottlenecks). ([IBM](https://www.ibm.com/think/insights/advanced-financial-closing-and-sap-s4hana), [sap-press.com](https://blog.sap-press.com/improving-financial-close-with-sap-s/4hana-finance-tools))

### Soft vs hard close in SAP terms

"Soft close" = OB52 rows tightened progressively (subledger account types closed, G/L restricted to an authorization group). "Hard close" = all account types closed for the period for everyone. Nothing is irreversible — OB52 can always be reopened by someone with config access, so auditability relies on change logs of the variant.

---

## 2. NetSuite

### Accounting period setup

- Periods are **first-class records** (not just date checks): fiscal calendars generate a year of period records with format **standard calendar months, 4-week, or 4-4-5** ([Oracle docs — Manage Accounting Periods](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N1445839.html), [Oracle docs — Year-End Closing](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N1457773.html)).
- Periods nest: year → quarter → month; one-day **adjustment periods** can be created that overlap a normal period (used to isolate audit adjustments — the NetSuite analog of SAP special periods).
- Multiple fiscal calendars are supported so different subsidiaries can have different year-ends.

### The Period Close Checklist

The centerpiece of NetSuite close is a built-in, per-period **checklist** with enforced ordering (tasks show lock icons until prerequisites complete; statuses are Not Started / Partially Done / Complete). Full task list, in order ([Oracle docs — Using the Period Close Checklist](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N1455781.html)):

1. **Lock A/R** — blocks A/R-posting transactions in the period
2. **Lock A/P** — blocks A/P-posting transactions
3. **Lock Payroll** (if enabled) / **Lock All** shortcut
4. **Resolve Date/Period Mismatches** (inventory feature) — transactions whose date and assigned period disagree
5. **Review Negative Inventory** — negative on-hand makes costing unreliable; resolve before close
6. **Review Inventory Cost Accounting** — ensure costing queue has processed
7. **Review Inventory Activity** (OneWorld)
8. **Review Custom GL Plug-in Executions**
9. **Create Intercompany Adjustments** (OneWorld)
10. **Revalue Open Foreign Currency Balances** — unrealized FX gain/loss on open balances
11. **Recognize Revenue** / **Reclassify Revenue** (ARM)
12. **Calculate Consolidated Exchange Rates** (OneWorld)
13. **Eliminate Intercompany Transactions** — requires FX revaluation + consolidated rates done first (explicit dependency) ([Oracle docs — Intercompany Elimination](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N1498385.html))
14. **Create Period End Journals** (if feature enabled — materializes consolidation/close as actual journals)
15. **GL Audit Numbering** — assign and verify **gapless sequence numbers** on GL impact for statutory jurisdictions (last month of period only)
16. **Close** — final task; period excludes all posting transactions

Notes:
- **Sequential close**: all prior periods must be closed before a period can be closed; only the earliest open period's checklist is fully actionable. ([Oracle docs — Accounting Period Close](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N1452509.html))
- The lock tasks create a deliberate **"pre-closed state"** so accountants can review stable balances and post adjustments before the hard close. ([Oracle docs — Locking and Unlocking](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N1451780.html))

### Period status & posting validation

- Effective statuses: **Open → Locked (per subledger: A/R, A/P, Payroll, or All) → Closed**.
- Locking is *permission-aware*: users with **Override Period Restrictions** can still post to a locked (not closed) period — this is the controller exception. Closed periods block GL-impacting changes for everyone. ([Oracle docs — Locking and Unlocking](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N1451780.html))
- **Allow Non-G/L Changes** — a per-period flag: users holding the matching permission may edit non-GL-impacting fields (memos, shipping status, etc.) on transactions in a closed period without reopening it. ([Oracle docs — Manage Accounting Periods](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N1445839.html))
- Validation happens **at transaction save time** against the posting period/date's status — there is no batch "post later" escape hatch.

### Reopening

Reopening a closed period **automatically reopens all later closed periods**, and checklist tasks may need to be redone for each; everything is logged. ([Oracle docs — Reopening a Closed Period](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N1457543.html))

### Year-end close is implicit

NetSuite posts **no closing entries**. Retained Earnings is a **system-calculated account**: for any balance-sheet date, the system rolls cumulative prior-year net income into Retained Earnings virtually at report time ("Automatic Close" method). Income-statement accounts "reset" each year only in presentation, not via journals. Closing the last period of the year is what finalizes the year. Optionally, the **Period End Journal Entries** feature materializes closing/consolidation as real journals for jurisdictions that require visible closing entries. ([Oracle docs — Year-End Closing](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N1457773.html), [Oracle docs — Period End Journal Entries](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_1531269686.html), [rsmus.com](https://technologyblog.rsmus.com/technologies/netsuite/month-end-and-year-end-processing-in-netsuite/))

### Multi-book and subsidiary dimensions

- **Extended Accounting Period Close** ("per-book closing") gives each accounting book (e.g., GAAP book vs IFRS book vs tax book) its **own close checklist and period status**, closable/reopenable independently. ([scalenorth.com](https://scalenorth.com/insights/netsuite-close-accounting-period), [Oracle docs](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N1455781.html))
- Base NetSuite closes periods **globally across subsidiaries** (one period record for all of OneWorld); intercompany elimination and consolidated-rate tasks are how subsidiary consolidation enters the checklist. True subsidiary-independent close is a known limitation people work around with fiscal calendars per subsidiary.

---

## 3. Brief references

### Microsoft Dynamics 365 Business Central

- Posting control is **date-range based, not status based**: General Ledger Setup has **Allow Posting From / Allow Posting To**; the **User Setup** table overrides these per user, so most users are pinned to the current period while the controller keeps a wider window. ([kristenhosman.com](https://www.kristenhosman.com/2024/04/working-with-posting-dates-in-microsoft.html), [erpsoftwareblog.com](https://erpsoftwareblog.com/2022/09/how-to-run-the-close-income-statement-in-microsoft-dynamics-365-business-central/))
- Year-end: "Close Year" marks fiscal-year periods closed (irreversibly flagged, but you can *still post* to a closed year — entries are marked prior-year), then the **Close Income Statement batch job** generates an explicit closing journal that zeroes P&L accounts into retained earnings, posted on a fictitious **"C" closing date** (e.g., `C12/31/2025`) that sits *between* Dec 31 and Jan 1 so it never distorts real-date balances. Re-run the batch job after late adjustments. ([Microsoft Learn](https://learn.microsoft.com/en-us/dynamics365/business-central/year-close-income-statement), [erpconnectconsulting.com](https://erpconnectconsulting.com/blogs/blog/closing-the-fiscal-year-in-dynamics-365-business-central))

### Microsoft Dynamics 365 Finance (F&O) — worth noting

- Ledger calendar period statuses: **Open / On hold / Permanently closed**. On hold blocks posting but is reversible; permanently closed is designed to be irreversible. ([cittros.com](https://www.cittros.com/insights/close-a-period-for-posting-in-d365-finance), [brightpointinfotech.com](https://brightpointinfotech.com/revert-to-open-permanently-closed-calendar-period-status-in-d365/))
- Per period, **module-level access** (GL, AP, AR, inventory, projects…) can be set to **All / None / a specific user group** — the cleanest mainstream implementation of "subledger closed for everyone except the close team." ([arcticit.com](https://arcticit.com/how-to-specify-which-users-can-post-to-a-period-in-dynamics-365-finance/))
- A **Financial period close workspace** provides checklist/task orchestration with assignments and due dates, like a lightweight FCC. ([d365training.com](https://www.d365training.com/post/period-close-in-d365-finance-the-close-workspace))

### Odoo

- No period entities at all — close is implemented as **lock dates** on the company ([Odoo 19 docs — Year-end closing](https://www.odoo.com/documentation/19.0/applications/finance/accounting/reporting/year_end.html), [Odoo forum — Lock Dates FAQ](https://www.odoo.com/forum/help-1/odoo-18-lock-dates-frequently-asked-questions-263564)):
  - **Sales / Purchase lock dates** — module-specific soft locks
  - **Tax lock date** — nothing affecting a filed tax return can change on/before it
  - **Fiscal-year lock date ("everyone" / non-advisers lock date)** — regular users blocked; Adviser-group users may still post
  - **Hard lock date** — irreversible, for statutory inalterability regimes; cannot be overridden by any role
- Year-end is implicit like NetSuite: an unallocated-earnings auto-computation, with an optional manual entry to allocate to retained earnings.

### QuickBooks (Online/Desktop)

- Minimal model: a single **closing date** plus optional **closing-date password**; edits to transactions on/before the closing date prompt for the password and are logged in the **"Exceptions to Closing Date"** report (audit trail of post-close changes). Only admins set/change the date. ([Intuit — Close your books](https://quickbooks.intuit.com/learn-support/en-us/help-article/close-books/close-books-quickbooks-online/L59LelyPM_US_en_US), [Intuit — Edit closed books](https://quickbooks.intuit.com/learn-support/en-us/help-article/customer-company-settings/edit-closed-books/L76xHuaZ5_US_en_US))
- Demonstrates the floor: even the simplest system pairs the lock with a *bypass mechanism + exception report*, not an absolute block.

---

## 4. Synthesis / Recommendations for a modern mid-market manufacturing ERP

### 4.1 Terminology to adopt

| Concept | Recommended term | Why |
|---|---|---|
| Period record | **Accounting Period** (a.k.a. fiscal period) | NetSuite/D365 standard; avoids confusion with MRP "planning periods" |
| Container | **Fiscal Year** with generated periods | universal |
| Status while posting allowed | **Open** | universal |
| Subledger-restricted state | **Locked** (per ledger: AR / AP / Inventory / Payroll / All) | NetSuite's term; "soft close" as the colloquial description |
| Fully closed | **Closed** | universal; reversible with permission + audit |
| Optional irreversible state | **Permanently Closed** (or Odoo-style **hard lock date**) | only if statutory inalterability is ever needed; D365/Odoo precedent |
| Year-end adjustment window | **Adjustment Period** | NetSuite term; clearer than SAP's numeric "special periods" |

Status lifecycle: `Open → Locked(subledger…) → Closed → (Reopened → …) [→ Permanently Closed]`.

### 4.2 Period entity model

- `fiscalYear` (companyId, start/end, calendar type) → `accountingPeriod` rows generated from a **fiscal calendar** (calendar-month first; design the generator so 4-4-5/4-week and 52/53-week calendars are a data question, not a schema question — NetSuite precedent).
- Period record: `id, companyId, fiscalYearId, number, startDate, endDate, status, arLocked, apLocked, inventoryLocked, isAdjustmentPeriod, closedAt, closedBy, reopenedAt/By (history table better)`.
- Support NetSuite-style **one-day adjustment periods** at year-end rather than SAP's periods 13–16 — same purpose (multiple statement versions: pre-audit / post-audit), simpler model. Alternatively BC's "C-date" trick if closing entries are ever materialized.
- Periods are **per company** (multi-tenant: companyId scoping as usual). If consolidation entities arrive later, follow D365/SAP: close per legal entity, orchestrate across entities via the checklist layer — do NOT copy NetSuite's global-close limitation.

### 4.3 Soft close vs hard close

Adopt the industry-consensus two-stage model:

1. **Soft close = module locks.** Lock subledgers **first** (AP, AR, payroll, then inventory/WIP after costing runs settle), keeping GL open for adjustments. This is SAP account-type rows, NetSuite Lock A/R–A/P–All, D365 module access, Odoo sales/purchase lock dates — every serious ERP converges here. For manufacturing specifically, inventory close must wait for: date/period mismatch resolution, negative-inventory cleanup, and the costing queue (NetSuite tasks 4–7 map directly to a manufacturing checklist). ([Oracle docs](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N1455781.html), [mayantechs.com](https://www.mayantechs.com/post/mastering-gl-and-subledger-reconciliation-in-epicor-kinetic))
2. **Hard close = period status Closed.** Blocks all GL-impacting postings; only reachable after subledger locks and checklist completion.

Ordering rule: **subledgers → inventory/costing → FX revaluation → intercompany/eliminations → GL close** (NetSuite's checklist order is the best public template).

### 4.4 Close checklist / orchestration

- Model the close as a **per-period task list** (template → instance), NetSuite-style, with:
  - task **dependencies** (task locked until prerequisites complete — e.g., eliminations require FX revaluation),
  - **assignments and status** (Not Started / In Progress / Complete) per task — the SAP AFC / D365 close-workspace pattern,
  - a mix of **system tasks** (lock AR = one click that flips a flag and validates) and **manual/review tasks** (reconcile inventory to GL).
- Some tasks are conditional on enabled features (multicurrency → revaluation; multi-entity → eliminations) — NetSuite handles this by hiding inapplicable tasks; do the same.
- Enforce **sequential close** (cannot close period N until N−1 closed) — NetSuite rule; prevents opening-balance ambiguity.

### 4.5 Year-end handling

**Recommend the implicit / virtual close (NetSuite/Odoo model), not explicit closing entries:**
- Retained Earnings is a **system account**; reports compute it as prior-years' cumulative net income at read time. No income-summary journals to generate, reverse, or desynchronize.
- Closing the last period of the fiscal year *is* the year-end close — no separate batch job.
- If materialized opening balances are ever needed for performance, copy SAP's **self-healing carryforward**: period-0 balance rows per account that are *automatically updated* when a prior-year posting occurs ([SAP Community](https://community.sap.com/t5/enterprise-resource-planning-blog-posts-by-members/s-4hana-finance-balance-carryforward-technical-tip/ba-p/13367327)) — never a one-shot job that goes stale (BC's re-run-the-batch-job model is a known footgun).
- Keep the door open for an optional "materialize closing journals" feature (NetSuite Period End Journals) for statutory jurisdictions, but don't build it first.

### 4.6 Reopening rules and audit trail

- **Closed is reversible** with a dedicated permission; **reopening period N reopens nothing silently** — either block if later periods are closed, or (NetSuite model) cascade-reopen all later periods explicitly and tell the user. Cascading is more honest than allowing an island of closed-after-open.
- Every status transition (lock/unlock/close/reopen) writes an **audit record**: who, when, prior status, reason (free text). QuickBooks' "Exceptions to Closing Date" report is the minimum bar: any bypass posting into a locked period must be queryable.
- Consider a NetSuite-style **"allow non-GL changes"** flag so operational edits (memos, references, shipment status) don't force a reopen.

### 4.7 Role-based exceptions

Two-tier override, combining the best of each system:
- Permission **`accounting.postToLockedPeriod`** (NetSuite "Override Period Restrictions" / SAP authorization group / Odoo adviser lock): may post to a **Locked** period; postings are flagged in the audit trail.
- **Closed** periods reject postings from everyone through the normal API; reopening (permission `accounting.reopenPeriod`) is required — this keeps "who changed a closed month" answerable from the reopen log alone.
- Do not implement per-user date ranges (BC User Setup) — period-status + permission is cleaner and matches the rest of the recommended model.

### 4.8 Posting validation enforcement

- **Validate at journal creation time, server-side, in one choke point** (the journal-insert service / a DB trigger or RPC): given `postingDate` (or explicit `accountingPeriodId`) + source module + user permissions →
  1. resolve the period (reject if none exists — force calendar generation ahead of time),
  2. reject if period **Closed** (no override),
  3. reject if the relevant **module lock** (AR/AP/inventory) is set, unless caller has the override permission (then log),
  4. reject if period **Open** but date outside period bounds when a period id is passed (NetSuite's date/period mismatch — better to prevent than to reconcile at close).
- Every posting flow (invoices, receipts, cost postings, manual journals, background jobs) must go through this single validation — NetSuite's lesson is that locks are only trustworthy because *every* GL-impacting save checks them; SAP's is that the check must know *which subledger* the posting comes from.

### 4.9 Manufacturing-specific checklist content (starter template)

1. Lock AP · 2. Lock AR · 3. Resolve date/period mismatches · 4. Review negative inventory · 5. Verify costing/GL-posting queue drained (WIP, variances, overhead absorption) · 6. Reconcile inventory & WIP subledger to GL control accounts · 7. Lock inventory · 8. FX revaluation (if multicurrency) · 9. Intercompany adjustments/eliminations (if multi-entity) · 10. Review GL / post accruals · 11. Close period.

---

## Source index

- SAP OB52 / PPV: https://www.saponlinetutorials.com/define-variant-for-open-and-close-posting-periods-sap-ob52/ · https://sapsharks.com/ob52-open-and-close-fi-posting-periods/ · https://www.learntosap.com/ficotutorialopenandcloseperiod.html · https://community.sap.com/t5/enterprise-resource-planning-q-a/open-and-close-posting-period-ob52/qaq-p/3980255 · https://help.sap.com/docs/SUPPORT_CONTENT/fiaccounting/3361878788.html
- SAP FCC / AFC / carryforward: https://help.sap.com/docs/SAP_S4HANA_ON-PREMISE/8b1d76cd5e7644caa0553fcf338f3982/3fe49e8767d648a6b1b5edeec8849b8d.html · https://community.sap.com/t5/enterprise-resource-planning-blog-posts-by-members/s-4hana-finance-balance-carryforward-technical-tip/ba-p/13367327 · https://www.ibm.com/think/insights/advanced-financial-closing-and-sap-s4hana · https://blog.sap-press.com/improving-financial-close-with-sap-s/4hana-finance-tools
- NetSuite: https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N1455781.html · https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N1452509.html · https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N1451780.html · https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N1445839.html · https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N1457543.html · https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N1457773.html · https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_1531269686.html · https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N1498385.html · https://scalenorth.com/insights/netsuite-close-accounting-period · https://technologyblog.rsmus.com/technologies/netsuite/month-end-and-year-end-processing-in-netsuite/
- Business Central: https://learn.microsoft.com/en-us/dynamics365/business-central/year-close-income-statement · https://www.kristenhosman.com/2024/04/working-with-posting-dates-in-microsoft.html · https://erpsoftwareblog.com/2022/09/how-to-run-the-close-income-statement-in-microsoft-dynamics-365-business-central/ · https://erpconnectconsulting.com/blogs/blog/closing-the-fiscal-year-in-dynamics-365-business-central
- D365 Finance: https://www.cittros.com/insights/close-a-period-for-posting-in-d365-finance · https://arcticit.com/how-to-specify-which-users-can-post-to-a-period-in-dynamics-365-finance/ · https://www.d365training.com/post/period-close-in-d365-finance-the-close-workspace
- Odoo: https://www.odoo.com/documentation/19.0/applications/finance/accounting/reporting/year_end.html · https://www.odoo.com/forum/help-1/odoo-18-lock-dates-frequently-asked-questions-263564
- QuickBooks: https://quickbooks.intuit.com/learn-support/en-us/help-article/close-books/close-books-quickbooks-online/L59LelyPM_US_en_US · https://quickbooks.intuit.com/learn-support/en-us/help-article/customer-company-settings/edit-closed-books/L76xHuaZ5_US_en_US
- Close ordering best practices: https://www.dualentry.com/blog/general-ledger-vs-subledger · https://www.mayantechs.com/post/mastering-gl-and-subledger-reconciliation-in-epicor-kinetic · https://insightsoftware.com/blog/navigating-the-maze-of-the-subledger-close-cycle/
