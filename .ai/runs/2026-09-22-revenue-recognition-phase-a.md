# Verification run: Revenue recognition Phase A (Task 18 browser verification)

- Date: 2026-09-22 (app/DB clock: 2026-09-23 UTC)
- Branch: revenue-recognition-rentals-spec
- Commit: 371ffc0f5f
- URL: https://erp.revenue-recognition-rentals-spec.dev (company "Carbon Development", timezone UTC)
- Mode: verify only — no code changes, no DB writes outside the UI; SQL cross-checks are read-only via `pnpm exec tsx scripts/run-local-accounting-check.ts psql -X -tAc`
- Plan: `.ai/plans/2026-09-22-revenue-recognition-and-rentals.md` Task 18; spec `.ai/specs/2026-09-22-revenue-recognition-and-rentals.md` §1
- Note: a previous attempt was interrupted before writing anything; it left Draft invoice `AR000002` (si_7sbouNFK5GGm7YtA1XgDhg, Apex Space Research, no lines). `AR000001` is an older unrelated Draft (Part line) and was left alone.

## Starting state (SQL, before any check)
- `revenueRecognitionSchedule` 0 rows, `revenueRecognitionRun` 0, `revenueRecognitionRunLine` 0, `accountingPeriod` 0
- `journal` 1 row pre-existing (see below), Service item: `SVC-TVT` Thermal Vacuum Test (external) (item_QrazL3YRdGvDHzVUf9KqgY)
- Customers: Apex Space Research, NovaSat Networks, ORBSEC Defense, PolarView Earth

- Pre-existing journal (seeded, not from this run): `je_RNeJ1PX5DvDtZgMLB4dq6m` sourceType NULL, "Revenue recognition — ORBSEC partial delivery", postingDate 2026-01-09, Dr 1010 Bank - Cash 1,800,000 / Cr 4010 Sales 1,800,000
- `companySettings` (SQL): `dapa1q7520gg2acvqpfg|Carbon Development|revenueRecognitionEnabled=f|accountingEnabled=t|UTC`

## Check 1 — Settings + Account Defaults: PASS

`/x/settings/accounting` snapshot excerpt:
```
- heading "General Ledger" [level=3]
- switch [checked=true]
- heading "Revenue recognition" [level=3]
- switch [checked=false]
- heading "Show Trailing Zeros" [level=3]
- switch [checked=true]
- heading "Fixed Assets" [level=3]
- switch [checked=false]
```
Accounting is on; the "Revenue recognition" toggle exists and is off (left off for check 2).

`/x/accounting/defaults` ("Default Accounts", reached via accounting sidebar CONFIGURE → Default Accounts) shows all six new mappings prefilled:
```
- heading "Deferred Revenue ..." — combobox: 2160 Deferred Revenue
- heading "Contract Assets ..." — combobox: 1145 Contract Assets
- heading "Net Investment in Leases ..." — combobox: 1160 Net Investment in Leases
- heading "Rental Income ..." — combobox: 4060 Rental Income
- heading "Lease Revenue ..." — combobox: 4070 Lease Revenue
- heading "Interest Income – Leases ..." — combobox: 4150 Interest Income – Leases
- heading "Sales ..." — combobox: 4010 Sales
```
Each of the six has a help popover ("What is Deferred Revenue (default)? Liability GL account credited when an invoice line with service dates, or a rental line, is billed before the revenue is earned; a recognition run releases it to revenue.") and a "Clear" button.

SQL cross-check (`accountDefault` for company dapa1q7520gg2acvqpfg, resolved by id):
```
deferredRevenueAccount=2160 Deferred Revenue | contractAssetAccount=1145 Contract Assets | netInvestmentInLeasesAccount=1160 Net Investment in Leases | rentalIncomeAccount=4060 Rental Income | leaseRevenueAccount=4070 Lease Revenue | leaseInterestIncomeAccount=4150 Interest Income – Leases | salesAccount=4010 Sales
```

## Check 2 — Flag OFF: Service invoice with no service dates posts to Sales (4010): PASS

- Reused the leftover Draft `AR000002` (`si_7sbouNFK5GGm7YtA1XgDhg`, customer Apex Space Research, Date Issued 2026-09-23).
- Added one line via "Add Line Item" → "New Sales Invoice Line" drawer: Change Type → Service, item `SVC-TVT Thermal Vacuum Test (external)`, quantity 1, unit price 500 (fill + blur; hidden inputs verified `{"price":"500","qty":"1"}`), saved with `requestSubmit`. With the flag OFF the drawer showed NO "Service start" / "Service end" pickers (`input[name=serviceStartDate]` absent: `svcStart:false, svcEnd:false`).
- Line row (SQL): `7HAnRvQMULsjCjwcXmvtNn|si_7sbouNFK5GGm7YtA1XgDhg|Service|item_QrazL3YRdGvDHzVUf9KqgY|1|500|||` (serviceStartDate/serviceEndDate NULL)
- Posted via header "Post" → modal "Post Invoice" listing `SVC-TVT Thermal Vacuum Test (external) | 1` → `requestSubmit` on "Post and Ship Invoice". The button sat in "Loading Post and Ship Invoice" for ~40 s (edge function) before the invoice flipped.
- Invoice after posting (SQL): `AR000002|Submitted|postingDate 2026-09-23`.
- Journal (SQL): `je_Cc6GcULwxahEZarVkFqB87|Sales Invoice|Sales Invoice AR000002|postingDate 2026-09-23`, accounting period auto-created `ap_MuaZV81rC8aXmjKaTN5Ae5` (2026-09-01 → 2026-09-30, Active).
- Journal lines (SQL; amount is natural-balance signed):
```
journalId                 | number | name                        | class   | amount | description           | documentType | documentId
je_Cc6GcULwxahEZarVkFqB87 | 1110   | Accounts Receivable         | Asset   | 500    | Accounts Receivable   | Invoice      | si_7sbouNFK5GGm7YtA1XgDhg
je_Cc6GcULwxahEZarVkFqB87 | 1210   | Raw Materials               | Asset   | 0      | Raw Materials Account | Invoice      | si_7sbouNFK5GGm7YtA1XgDhg
je_Cc6GcULwxahEZarVkFqB87 | 4010   | Sales                       | Revenue | 500    | Sales Account         | Invoice      | si_7sbouNFK5GGm7YtA1XgDhg
je_Cc6GcULwxahEZarVkFqB87 | 5010   | Cost of Goods Sold - Direct | Expense | 0      | Cost of Goods Sold    | Invoice      | si_7sbouNFK5GGm7YtA1XgDhg
```
  → Dr 1110 AR 500.00 / Cr 4010 Sales 500.00 (the two zero-amount 1210/5010 lines are the pre-existing inventory/COGS pair for a line with no cost). No 2160 line.
- `revenueRecognitionSchedule` count after posting: 0.
- Observation (not a check): `salesInvoice.subtotal/totalTax/totalAmount` read `0|0|0` for AR000002 after posting even though the line is 1 × 500.
- Environment note: during this check the shared `agent-browser` default session was navigated away by another worktree's agent (it landed on `erp.rillet-ramp-accounting-provider.dev/login`). All later checks use an isolated session (`AGENT_BROWSER_SESSION=revrec-lagos`) with a fresh dev-bypass login.

## Check 3 — Flag ON: $1,200 Service line, service 2026-10-01 → 2027-03-31: PARTIAL (journal PASS; six Planned rows PASS on count/dates; amounts are day-prorated, NOT 200.00 each; posting date stamped as today, not 2026-10-05)

- Toggle: `/x/settings/accounting` → clicked the "Revenue recognition" switch → snapshot `switch [checked=true]`; SQL `companySettings.revenueRecognitionEnabled = t`.
- New invoice via `/x/sales-invoice/new`: Customer "NovaSat Networks" (combobox → option), Date Issued set to 2026-10-05 by filling the month/day/year spinbuttons ("10", "05", "2026") + Tab — hidden `input[name=dateIssued]` verified `"2026-10-05"` — then `requestSubmit`. Redirected to `/x/sales-invoice/si_TXwoRUWbtHjmkrDJ2SAjLv/details`, heading **AR000003**. SQL header before posting: `si_TXwoRUWbtHjmkrDJ2SAjLv|AR000003|Draft|dateIssued 2026-10-05|NovaSat Networks`.
  - Note: `agent-browser keyboard type "10052026"` failed with `CDP error (Input.dispatchKeyEvent): Invalid 'text' parameter`; per-segment `fill` on the spinbuttons works.
- Line: "Add Line Item" → with the flag ON the drawer now shows the two date pickers (`svcStart:true, svcEnd:true`) between Unit Price and Shipping Location. Change Type → Service, item `SVC-TVT Thermal Vacuum Test (external)`, unit price 1200, Service start 10/01/2026, Service end 03/31/2027 (segment fills + Tab). Hidden inputs verified `{"price":"1200","qty":"1","svcStart":"2026-10-01","svcEnd":"2027-03-31"}` before `requestSubmit`.
- Line row (SQL): `YU1hk9DR5Wm9iqZyznRQUj|si_TXwoRUWbtHjmkrDJ2SAjLv|Service|item_QrazL3YRdGvDHzVUf9KqgY|1|1200|taxPercent 0|2026-10-01|2027-03-31`
- Posted via "Post" → modal "Post Invoice" (`SVC-TVT Thermal Vacuum Test (external) | 1`) → `requestSubmit` "Post and Ship Invoice" (~60 s in "Loading").
- Invoice after posting (SQL): `AR000003|Submitted|postingDate 2026-09-23|dateIssued 2026-09-23` — **posting re-stamped both dates to today**; `post-sales-invoice/index.ts` sets `postingDate: today` and `dateIssued: today` ("Posting stamps dateIssued with today"), so the UI cannot post an invoice dated 2026-10-05. The journal therefore sits in the September 2026 period, not October.
- Journal (SQL): `je_LZUbEnRuGqjYYFgivDwD4F|Sales Invoice|Sales Invoice AR000003|postingDate 2026-09-23|ap_MuaZV81rC8aXmjKaTN5Ae5 (Sep 2026)`
- Journal lines (SQL):
```
je_LZUbEnRuGqjYYFgivDwD4F|1110|Accounts Receivable|Asset|1200|Accounts Receivable|Invoice|si_TXwoRUWbtHjmkrDJ2SAjLv
je_LZUbEnRuGqjYYFgivDwD4F|1210|Raw Materials|Asset|0|Raw Materials Account|Invoice|si_TXwoRUWbtHjmkrDJ2SAjLv
je_LZUbEnRuGqjYYFgivDwD4F|2160|Deferred Revenue|Liability|1200|Deferred Revenue|Invoice|si_TXwoRUWbtHjmkrDJ2SAjLv
je_LZUbEnRuGqjYYFgivDwD4F|5010|Cost of Goods Sold - Direct|Expense|0|Cost of Goods Sold|Invoice|si_TXwoRUWbtHjmkrDJ2SAjLv
```
  → **Dr 1110 AR 1,200.00 / Cr 2160 Deferred Revenue 1,200.00** — no 4010 line. PASS.
- Schedule rows (SQL `revenueRecognitionSchedule`, id|type|status|periodStart|periodEnd|scheduledDate|amount|dr|cr|salesInvoiceLineId|accountingPeriodId|runLineId|journalId):
```
rvsc_6m8vwh81n6gBKZV5DEvyqa|Deferral|Planned|2026-10-01|2026-10-31|2026-10-31|204.39561|2160|4010|YU1hk9DR5Wm9iqZyznRQUj|||
rvsc_CNmpdqwz5pSCxroQ8SiZNs|Deferral|Planned|2026-11-01|2026-11-30|2026-11-30|197.8022|2160|4010|YU1hk9DR5Wm9iqZyznRQUj|||
rvsc_Y2hK6hLFRa8rGB6sajPrS5|Deferral|Planned|2026-12-01|2026-12-31|2026-12-31|204.3956|2160|4010|YU1hk9DR5Wm9iqZyznRQUj|||
rvsc_NVJ86evFNKayvudswRi7dG|Deferral|Planned|2027-01-01|2027-01-31|2027-01-31|204.3956|2160|4010|YU1hk9DR5Wm9iqZyznRQUj|||
rvsc_L9yUsWwhZXn9FUqYt77bTo|Deferral|Planned|2027-02-01|2027-02-28|2027-02-28|184.61539|2160|4010|YU1hk9DR5Wm9iqZyznRQUj|||
rvsc_6iemWaY936q5xvP8EWPjmt|Deferral|Planned|2027-03-01|2027-03-31|2027-03-31|204.3956|2160|4010|YU1hk9DR5Wm9iqZyznRQUj|||
sum(amount) = 1200.00000
```
  Six `Deferral` / `Planned` rows dated each month end Oct 2026 → Mar 2027, Dr 2160 / Cr 4010, Σ = 1,200.00 exactly — but the amounts are **prorated by days** (31/30/31/31/28/31 of 182 days: 1200 × 31/182 = 204.39560…), not six × 200.00. This matches spec §1's sentence "amounts prorated by days (last row absorbs rounding…)" and `shared/revenue-schedule.ts` `spreadStraightLine` (`amount * days / totalDays` per month cut, `distributeRoundingResidual` at the default 5-decimal scale), but NOT the plan/AC expectation "six Planned schedule rows of 200.00". `accountingPeriodId` is NULL on every row (no Oct 2026 … Mar 2027 periods exist yet; only Sep 2026 was auto-created by the postings).
- Waterfall `/x/reports/revenue-waterfall` (breadcrumb Accounting → Reports → Deferred Revenue Waterfall; as-of date field defaulted to 9/23/2026; "Download CSV"):
```
- columnheader "Month" / "Type" / "Amount"
- cell "Oct 2026" - cell "DEFERRAL" - cell "$204.40"
- cell "Nov 2026" - cell "DEFERRAL" - cell "$197.80"
- cell "Dec 2026" - cell "DEFERRAL" - cell "$204.40"
- cell "Jan 2027" - cell "DEFERRAL" - cell "$204.40"
- cell "Feb 2027" - cell "DEFERRAL" - cell "$184.62"
- cell "Mar 2027" - cell "DEFERRAL" - cell "$204.40"
- cell "Total" - cell "$1,200.00"
```
  Six rows visible, one per month, total $1,200.00. (The report table does not show a status column; rows are the six Planned rows.)

## Check 5 (part 1, taken right after check 3) — October close checklist BEFORE the run

- Only September 2026 existed (auto-created by the postings), so October was created through the UI: `/x/accounting/periods` → "Generate Fiscal Year" → modal "Generate fiscal year" ("Creates the 12 monthly periods for a fiscal year. Periods that already exist are kept." · "Jan 2026 – Dec 2026 · 12 monthly periods"), Fiscal year 2026 → `requestSubmit` "Generate". List now shows January … December 2026; Sep = ACTIVE/OPEN, the rest INACTIVE/OPEN. October 2026 = `ap_2ymKsCGw9mbeHP44XAhC1E` (2026-10-01 → 2026-10-31). The six schedule rows still have `accountingPeriodId` NULL after generation.
- Close task definitions (SQL `periodCloseTaskDefinition`, sortOrder order): … `4 Post depreciation runs covering the period (Auto, draft-depreciation, Warning)` → **`5 Recognize revenue for the period (Auto, unposted-revenue-schedules, Warning, isSystem)`** → `5 Match & eliminate intercompany transactions` … (the new task shares sortOrder 5 with the intercompany task).
- `/x/accounting/periods/ap_2ymKsCGw9mbeHP44XAhC1E/close` ("Close FY2026 · Period 10", "Cannot close yet") — snapshot excerpt:
```
- cell "Post pending operational documents What this task means 4 unposted documents" | Auto | BLOCKER | OPEN
- cell "Post or re-date draft journal entries"                                          | Auto | BLOCKER | DONE
- cell "Lock the period"                                                                | Action | — | OPEN   (button "Lock Period")
- cell "Post depreciation runs covering the period"                                     | Auto | WARNING | DONE
- cell "Recognize revenue for the period"                                               | Auto | WARNING | OPEN   (button "Skip")
- cell "Match & eliminate intercompany transactions"                                    | Auto | WARNING | DONE
- cell "Review negative on-hand inventory"                                              | Action | — | OPEN
- cell "Trial balance in balance for the period"                                        | Auto | BLOCKER | DONE
- cell "Review financial statements"                                                    | Action | — | OPEN
- cell "External GL sync complete"                                                      | Auto | BLOCKER | DONE
- button "Close Period" [disabled]
```
  → "Recognize revenue for the period" reads **OPEN** (warning severity) while the Planned row dated 2026-10-31 (`rvsc_6m8vwh81n6gBKZV5DEvyqa`, 204.39561) exists. PASS for the "before" half.
- Observation: the "Recognize revenue for the period" row (and "External GL sync complete") has no "What this task means" help button, unlike the other Auto tasks.

## Check 4 — Recognition run for 2026-10-31: (see result below)

### 4a. Creating the run
- `/x/accounting/revenue-recognition-runs` (sidebar GENERAL LEDGER → Revenue Recognition): heading "Revenue Recognition", empty list, one button **"Run Next Period"** → Confirm modal "Run Next Period": "This will create a draft revenue recognition run for the period ending **Sep 30, 2026**. Every schedule row due on or before that date will be included." with a hidden `periodEnd=2026-09-30` (`getNextPeriodEnd(null)` = end of the current month; no run exists yet). **There is no period-end picker in the UI.**
- Submitted as offered (Sep 30): redirect back to the list, toast **"Nothing to recognize for this period"**, SQL `revenueRecognitionRun` count 0 (`createRevenueRecognitionRunProposal` returns null and persists nothing when no row is due). Because no run persists, "Run Next Period" keeps offering Sep 30 — the UI cannot reach a 2026-10-31 run while today is 2026-09-23.
- **Deviation:** to exercise the October run, the same modal form was submitted with its hidden `periodEnd` input set to `2026-10-31` (the route's validator accepts the posted `periodEnd`). Result: toast **"Revenue recognition run created"**, redirect to `/x/revenue-recognition-run/rvrn_X3BtRJUYMBGKGQx6QePuTL`.
- Run page text: `RR000001 · DRAFT · Post Run · Period End Oct 31, 2026 · Deferrals — Period "Oct 1, 2026 → Oct 31, 2026" · Scheduled "Oct 31, 2026" · Source "YU1hk9DR5Wm9iqZyznRQUj" · Amount "$204.40" · "1 line" · "$204.40"` — ONE Deferral line, but **$204.40 (204.39561), not 200.00** (day-prorated row, see check 3). The Source column shows the raw `salesInvoiceLineId` rather than the invoice number.
- SQL run: `rvrn_X3BtRJUYMBGKGQx6QePuTL|RR000001|2026-10-31|Draft`; run line: `rvrl_FafDafkdLRVGmedT7WsHj9|rvrn_X3BtRJUYMBGKGQx6QePuTL|rvsc_6m8vwh81n6gBKZV5DEvyqa|204.39561`; the Oct schedule row `rvsc_6m8vwh81n6gBKZV5DEvyqa` now carries `runLineId rvrl_FafDafkdLRVGmedT7WsHj9` and is still `Planned`; the other five rows are unclaimed.

### 4b. Posting the run and the duplicate check
- Run page → "Post Run" (`fetcher.Form method=post action=post`, `requestSubmit`) → toast **"Revenue recognition run posted"**; page: `RR000001 · POSTED · Period End Oct 31, 2026 · Posted At Sep 22, 2026 (browser-local rendering of 2026-09-23 00:53 UTC) · Journal: "View journal entry"` → `/x/journal-entry/je_NNPHk6kX4JXF8h7r4AFTNP`. The Deferrals section still lists the one line, $204.40.
- SQL journal: `je_NNPHk6kX4JXF8h7r4AFTNP|Revenue Recognition|Revenue Recognition RR000001|postingDate 2026-10-31|ap_2ymKsCGw9mbeHP44XAhC1E (2026-10-01..2026-10-31, Active, Open)` — the October period (previously Inactive) is now Active.
- SQL journal lines (amount natural-balance signed):
```
je_NNPHk6kX4JXF8h7r4AFTNP|2160|Deferred Revenue|Liability|-204.39561|Deferred revenue released|Invoice|si_TXwoRUWbtHjmkrDJ2SAjLv
je_NNPHk6kX4JXF8h7r4AFTNP|4010|Sales|Revenue|204.39561|Revenue recognized|Invoice|si_TXwoRUWbtHjmkrDJ2SAjLv
```
  → **Dr 2160 204.39561 / Cr 4010 204.39561**, both lines `documentType Invoice / documentId si_TXwoRUWbtHjmkrDJ2SAjLv`. Structure as expected; the amount is the day-prorated 204.40, not 200.00 (see check 3).
- SQL run: `rvrn_X3BtRJUYMBGKGQx6QePuTL|RR000001|2026-10-31|Posted|postedAt 2026-09-23 00:53:14+00|postedBy 6ea9e841-…`; run line `rvrl_FafDafkdLRVGmedT7WsHj9|rvrn_X3BtRJUYMBGKGQx6QePuTL|rvsc_6m8vwh81n6gBKZV5DEvyqa|204.39561`.
- SQL schedule after posting: Oct row `rvsc_6m8vwh81n6gBKZV5DEvyqa|2026-10-31|Posted|204.39561|rvrl_FafDafkdLRVGmedT7WsHj9|je_NNPHk6kX4JXF8h7r4AFTNP`; Nov → Mar rows still `Planned`, unclaimed.
- Second run for the same period end: list shows `RR000001 | Oct 31, 2026 | POSTED`; "Run Next Period" now offers **Nov 30, 2026** ("period ending Nov 30, 2026"). Submitting the modal with `periodEnd` overridden back to `2026-10-31` → toast **"A revenue recognition run already exists for this period"**, redirect to the list, still exactly one run (SQL count unchanged). PASS — refused, no duplicate line.

**Check 4 result: PASS with deviations** — run creation for 2026-10-31 required overriding the modal's hidden `periodEnd` (the UI only offers "the period after the last run" / current month, no picker), and the line/journal amount is 204.40 (day-prorated) rather than 200.00.

## Check 5 (part 2) — October checklist AFTER the run, then Lock

- `/x/accounting/periods/ap_2ymKsCGw9mbeHP44XAhC1E/close` re-opened after RR000001 posted — dialog text:
```
Post pending operational documents  4 unposted documents | Auto | BLOCKER | OPEN
Post or re-date draft journal entries                     | Auto | BLOCKER | DONE
Lock the period                                           | Action | — | OPEN   [Lock Period]
Post depreciation runs covering the period                | Auto | WARNING | DONE
Recognize revenue for the period                          | Auto | WARNING | DONE     <-- was OPEN before the run
Match & eliminate intercompany transactions               | Auto | WARNING | DONE
Review negative on-hand inventory                         | Action | — | OPEN
Trial balance in balance for the period                   | Auto | BLOCKER | DONE
Review financial statements                               | Action | — | OPEN
External GL sync complete                                 | Auto | BLOCKER | DONE
Cannot close yet — "Post pending operational documents" has unresolved blocking issues
```
  → "Recognize revenue for the period" is **DONE** once the only row due ≤ 2026-10-31 is Posted (evaluator: `revenueRecognitionSchedule` where `status = Planned` and `scheduledDate <= endDate`). PASS (before OPEN → after DONE).
- **Lock October:** "Lock Period" (form `intent=lock`, `requestSubmit`) → toast **"Period locked"**; the "Lock the period" task reads DONE with an "Unlock" button. 

- SQL October period after lock: `ap_2ymKsCGw9mbeHP44XAhC1E|2026-10-01|2026-10-31|status Active|closeStatus Locked|lockedAt 2026-09-23 00:55:07+00|lockedBy 6ea9e841-…`.
- **Close October: BLOCKED (environment, not this feature).** The checklist's "Close Period" button is disabled: `Cannot close yet — "Post pending operational documents" has unresolved blocking issues` (BLOCKER, not skippable). Its "4 unposted documents" popover ("Unposted Documents — These documents haven't posted to the general ledger, so their amounts are missing from this period. Post or void each one — an undated document receives the posting day's date when it posts.") lists four pre-existing seeded drafts: `RE000001 Receipt DRAFT`, `SHP000001 Shipment DRAFT`, `AR000001 Sales Invoice DRAFT`, `AP000001 Purchase Invoice DRAFT` (SQL confirms these four Draft rows). Posting or voiding unrelated receipts/shipments/invoices is outside this verification, so the period was NOT closed and the "posting into a Closed period fails with the period error" sub-check could not be exercised. Note also that a second October-dated run is impossible regardless (the duplicate check refuses it before any period check), so the plan's "Close October → post an October run" step needs a different setup (e.g. the spec AC's "December Locked → posts; December Closed → period error" with a Draft December run).

## Check 5 (part 3) — Nov 30 run proposed and posted while October is Locked

- `/x/accounting/revenue-recognition-runs` → "Run Next Period" now offers **"period ending Nov 30, 2026"** (hidden `periodEnd=2026-11-30`, submitted exactly as offered, no override) → toast "Revenue recognition run created" → `/x/revenue-recognition-run/rvrn_XA2Ms6iKWUpV1YzrS3ysFJ`: `RR000002 · DRAFT · Period End Nov 30, 2026 · Deferrals: Nov 1, 2026 → Nov 30, 2026 · Nov 30, 2026 · YU1hk9DR5Wm9iqZyznRQUj · $197.80 · 1 line · $197.80` — the single November line (the Oct row is Posted and not re-proposed).
- "Post Run" → toast **"Revenue recognition run posted"**; page `RR000002 · POSTED · Posted At Sep 22, 2026 · View journal entry` → `/x/journal-entry/je_JSCpbwb6n2mXKtJaqWFGoU`. Posting succeeded while October was Locked (the run's posting date 2026-11-30 falls in November, which is Open — so this only proves a Locked *earlier* period does not block later runs).
- SQL journal: `je_JSCpbwb6n2mXKtJaqWFGoU|Revenue Recognition|Revenue Recognition RR000002|postingDate 2026-11-30|ap_HhKTuSHYXtWxmg9ETtKa7A (2026-11-01..2026-11-30, Open)`; lines:
```
je_JSCpbwb6n2mXKtJaqWFGoU|2160|Deferred Revenue|Liability|-197.8022|Deferred revenue released|Invoice|si_TXwoRUWbtHjmkrDJ2SAjLv
je_JSCpbwb6n2mXKtJaqWFGoU|4010|Sales|Revenue|197.8022|Revenue recognized|Invoice|si_TXwoRUWbtHjmkrDJ2SAjLv
```
  → Dr 2160 197.8022 / Cr 4010 197.8022.
- SQL runs: `RR000001|2026-10-31|Posted`, `RR000002|2026-11-30|Posted`; run lines `rvrl_FafDafkdLRVGmedT7WsHj9 (Oct, 204.39561)`, `rvrl_FvZQ8pYNquggAZtghtguq8 (Nov, 197.8022)`.
- SQL schedule: Oct and Nov rows `Posted` (with `runLineId` + `journalId`); Dec 2026 → Mar 2027 rows `Planned`, unclaimed.
- SQL periods: Sep 2026 Open, **Oct 2026 Locked**, Nov 2026 Open (now `status Active`), Dec 2026 Open.
- UI journal `je_NNPHk6kX4JXF8h7r4AFTNP` renders as `JE-2026-09-000003`, description "Revenue Recognition RR000001", source type "Revenue Recognition" (disabled combobox).

- UI journal lines for `je_NNPHk6kX4JXF8h7r4AFTNP` (`/x/journal-entry/je_NNPHk6kX4JXF8h7r4AFTNP/details`, POSTED, posting date 10/31/2026): line 1 `2160 Deferred Revenue · LIABILITY · dimensions SVC-TVT / MANUFACTURING PLANT / NOVASAT NETWORKS`; line 2 `4010 Sales · REVENUE · dimensions SVC-TVT / MANUFACTURING PLANT / NOVASAT NETWORKS`; Totals **BALANCED $204.40 / $204.40** (Item / Location / Customer dimensions copied from the invoice line, per spec §1).
- Files touched by this verification: only this evidence file. Other working-tree changes present at the end (rules/docs/glossary/locale `.po`, `20260923003308_rental-enums.sql`, `20260923003525_rental-agreements.sql`) were made by a concurrent agent in this worktree, not by this run.

**Check 5 result: PARTIAL** — checklist before/after PASS; Lock PASS; Nov run posts while Oct Locked PASS; **Close October BLOCKED** by the pre-existing "4 unposted documents" blocker (RE000001, SHP000001, AR000001, AP000001), so the Closed-period rejection was not exercised.

## Final state (SQL, all journals; sums are natural-balance: Asset/Expense vs Liability/Revenue/Equity)
```
je_RNeJ1PX5DvDtZgMLB4dq6m|(NULL, seeded)     |Revenue recognition — ORBSEC partial delivery|2026-01-09|1800000|1800000
je_Cc6GcULwxahEZarVkFqB87|Sales Invoice      |Sales Invoice AR000002                       |2026-09-23|500    |500
je_LZUbEnRuGqjYYFgivDwD4F|Sales Invoice      |Sales Invoice AR000003                       |2026-09-23|1200   |1200
je_NNPHk6kX4JXF8h7r4AFTNP|Revenue Recognition|Revenue Recognition RR000001                 |2026-10-31|0      |0.00000  (−204.39561 on 2160 + 204.39561 on 4010)
je_JSCpbwb6n2mXKtJaqWFGoU|Revenue Recognition|Revenue Recognition RR000002                 |2026-11-30|0      |0.0000   (−197.8022 on 2160 + 197.8022 on 4010)
```
Left as-is: revenue-recognition toggle ON; October 2026 Locked; runs RR000001/RR000002 Posted; four Planned rows (Dec 2026 → Mar 2027) remain.

## Results

| # | Check | Result | Notes |
|---|-------|--------|-------|
| 1 | Settings + Account Defaults | PASS | GL on, "Revenue recognition" switch present/off; six new defaults prefilled (2160, 1145, 1160, 4060, 4070, 4150), Sales 4010 |
| 2 | Flag OFF: Service invoice posts to Sales | PASS | AR000002 → `je_Cc6GcULwxahEZarVkFqB87` Dr 1110 500 / Cr 4010 500; no schedule rows; no service-date pickers shown |
| 3 | Flag ON: $1,200 deferred over 6 months | PARTIAL | AR000003 → `je_LZUbEnRuGqjYYFgivDwD4F` Dr 1110 1,200 / Cr 2160 1,200 (PASS); six Planned Deferral rows Oct→Mar, Σ 1,200.00 (PASS) but day-prorated 204.40/197.80/204.40/204.40/184.62/204.40, NOT 200.00 each (FAIL vs plan; matches §1 "prorated by days"); posting date stamped 2026-09-23 (UI cannot post dated 2026-10-05) |
| 4 | Oct run: propose, post, duplicate refused | PASS (with deviations) | RR000001 one Deferral line 204.40; `je_NNPHk6kX4JXF8h7r4AFTNP` Revenue Recognition 2026-10-31 Dr 2160 / Cr 4010 204.39561; duplicate → "A revenue recognition run already exists for this period". Deviation: UI offers only "Run Next Period" (Sep 30 today, "Nothing to recognize for this period"); Oct 31 reached by overriding the modal's hidden `periodEnd` |
| 5 | Periods + close checklist | PARTIAL | "Recognize revenue for the period": OPEN before the Oct run → DONE after (PASS); Lock Oct PASS ("Period locked"); Nov run RR000002 posts while Oct Locked (PASS, `je_JSCpbwb6n2mXKtJaqWFGoU` 2026-11-30 Dr 2160 / Cr 4010 197.8022); Close Oct BLOCKED by "4 unposted documents" (seeded drafts RE000001/SHP000001/AR000001/AP000001) — Closed-period error not exercised |
