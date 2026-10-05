# Verification runs: revenue recognition and rentals

Browser verification of each phase of `.ai/plans/implemented/2026-09-22-revenue-recognition-and-rentals.md` (spec `.ai/specs/implemented/2026-09-22-revenue-recognition-and-rentals.md`), one section per phase, in order. Each records its own date, commit and environment.

## Phase A — recognition core (Task 18)

- Date: 2026-09-22 (app/DB clock: 2026-09-23 UTC)
- Branch: revenue-recognition-rentals-spec
- Commit: 371ffc0f5f
- URL: https://erp.revenue-recognition-rentals-spec.dev (company "Carbon Development", timezone UTC)
- Mode: verify only — no code changes, no DB writes outside the UI; SQL cross-checks are read-only via `pnpm exec tsx scripts/run-local-accounting-check.ts psql -X -tAc`
- Plan: `.ai/plans/implemented/2026-09-22-revenue-recognition-and-rentals.md` Task 18; spec `.ai/specs/implemented/2026-09-22-revenue-recognition-and-rentals.md` §1
- Note: a previous attempt was interrupted before writing anything; it left Draft invoice `AR000002` (si_7sbouNFK5GGm7YtA1XgDhg, Apex Space Research, no lines). `AR000001` is an older unrelated Draft (Part line) and was left alone.

### Starting state (SQL, before any check)
- `revenueRecognitionSchedule` 0 rows, `revenueRecognitionRun` 0, `revenueRecognitionRunLine` 0, `accountingPeriod` 0
- `journal` 1 row pre-existing (see below), Service item: `SVC-TVT` Thermal Vacuum Test (external) (item_QrazL3YRdGvDHzVUf9KqgY)
- Customers: Apex Space Research, NovaSat Networks, ORBSEC Defense, PolarView Earth

- Pre-existing journal (seeded, not from this run): `je_RNeJ1PX5DvDtZgMLB4dq6m` sourceType NULL, "Revenue recognition — ORBSEC partial delivery", postingDate 2026-01-09, Dr 1010 Bank - Cash 1,800,000 / Cr 4010 Sales 1,800,000
- `companySettings` (SQL): `dapa1q7520gg2acvqpfg|Carbon Development|revenueRecognitionEnabled=f|accountingEnabled=t|UTC`

### Check 1 — Settings + Account Defaults: PASS

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

### Check 2 — Flag OFF: Service invoice with no service dates posts to Sales (4010): PASS

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

### Check 3 — Flag ON: $1,200 Service line, service 2026-10-01 → 2027-03-31: PARTIAL (journal PASS; six Planned rows PASS on count/dates; amounts are day-prorated, NOT 200.00 each; posting date stamped as today, not 2026-10-05)

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

### Check 5 (part 1, taken right after check 3) — October close checklist BEFORE the run

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

### Check 4 — Recognition run for 2026-10-31: (see result below)

#### 4a. Creating the run
- `/x/accounting/revenue-recognition-runs` (sidebar GENERAL LEDGER → Revenue Recognition): heading "Revenue Recognition", empty list, one button **"Run Next Period"** → Confirm modal "Run Next Period": "This will create a draft revenue recognition run for the period ending **Sep 30, 2026**. Every schedule row due on or before that date will be included." with a hidden `periodEnd=2026-09-30` (`getNextPeriodEnd(null)` = end of the current month; no run exists yet). **There is no period-end picker in the UI.**
- Submitted as offered (Sep 30): redirect back to the list, toast **"Nothing to recognize for this period"**, SQL `revenueRecognitionRun` count 0 (`createRevenueRecognitionRunProposal` returns null and persists nothing when no row is due). Because no run persists, "Run Next Period" keeps offering Sep 30 — the UI cannot reach a 2026-10-31 run while today is 2026-09-23.
- **Deviation:** to exercise the October run, the same modal form was submitted with its hidden `periodEnd` input set to `2026-10-31` (the route's validator accepts the posted `periodEnd`). Result: toast **"Revenue recognition run created"**, redirect to `/x/revenue-recognition-run/rvrn_X3BtRJUYMBGKGQx6QePuTL`.
- Run page text: `RR000001 · DRAFT · Post Run · Period End Oct 31, 2026 · Deferrals — Period "Oct 1, 2026 → Oct 31, 2026" · Scheduled "Oct 31, 2026" · Source "YU1hk9DR5Wm9iqZyznRQUj" · Amount "$204.40" · "1 line" · "$204.40"` — ONE Deferral line, but **$204.40 (204.39561), not 200.00** (day-prorated row, see check 3). The Source column shows the raw `salesInvoiceLineId` rather than the invoice number.
- SQL run: `rvrn_X3BtRJUYMBGKGQx6QePuTL|RR000001|2026-10-31|Draft`; run line: `rvrl_FafDafkdLRVGmedT7WsHj9|rvrn_X3BtRJUYMBGKGQx6QePuTL|rvsc_6m8vwh81n6gBKZV5DEvyqa|204.39561`; the Oct schedule row `rvsc_6m8vwh81n6gBKZV5DEvyqa` now carries `runLineId rvrl_FafDafkdLRVGmedT7WsHj9` and is still `Planned`; the other five rows are unclaimed.

#### 4b. Posting the run and the duplicate check
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

### Check 5 (part 2) — October checklist AFTER the run, then Lock

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

### Check 5 (part 3) — Nov 30 run proposed and posted while October is Locked

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

### Final state (SQL, all journals; sums are natural-balance: Asset/Expense vs Liability/Revenue/Equity)
```
je_RNeJ1PX5DvDtZgMLB4dq6m|(NULL, seeded)     |Revenue recognition — ORBSEC partial delivery|2026-01-09|1800000|1800000
je_Cc6GcULwxahEZarVkFqB87|Sales Invoice      |Sales Invoice AR000002                       |2026-09-23|500    |500
je_LZUbEnRuGqjYYFgivDwD4F|Sales Invoice      |Sales Invoice AR000003                       |2026-09-23|1200   |1200
je_NNPHk6kX4JXF8h7r4AFTNP|Revenue Recognition|Revenue Recognition RR000001                 |2026-10-31|0      |0.00000  (−204.39561 on 2160 + 204.39561 on 4010)
je_JSCpbwb6n2mXKtJaqWFGoU|Revenue Recognition|Revenue Recognition RR000002                 |2026-11-30|0      |0.0000   (−197.8022 on 2160 + 197.8022 on 4010)
```
Left as-is: revenue-recognition toggle ON; October 2026 Locked; runs RR000001/RR000002 Posted; four Planned rows (Dec 2026 → Mar 2027) remain.

### Results

| # | Check | Result | Notes |
|---|-------|--------|-------|
| 1 | Settings + Account Defaults | PASS | GL on, "Revenue recognition" switch present/off; six new defaults prefilled (2160, 1145, 1160, 4060, 4070, 4150), Sales 4010 |
| 2 | Flag OFF: Service invoice posts to Sales | PASS | AR000002 → `je_Cc6GcULwxahEZarVkFqB87` Dr 1110 500 / Cr 4010 500; no schedule rows; no service-date pickers shown |
| 3 | Flag ON: $1,200 deferred over 6 months | PARTIAL | AR000003 → `je_LZUbEnRuGqjYYFgivDwD4F` Dr 1110 1,200 / Cr 2160 1,200 (PASS); six Planned Deferral rows Oct→Mar, Σ 1,200.00 (PASS) but day-prorated 204.40/197.80/204.40/204.40/184.62/204.40, NOT 200.00 each (FAIL vs plan; matches §1 "prorated by days"); posting date stamped 2026-09-23 (UI cannot post dated 2026-10-05) |
| 4 | Oct run: propose, post, duplicate refused | PASS (with deviations) | RR000001 one Deferral line 204.40; `je_NNPHk6kX4JXF8h7r4AFTNP` Revenue Recognition 2026-10-31 Dr 2160 / Cr 4010 204.39561; duplicate → "A revenue recognition run already exists for this period". Deviation: UI offers only "Run Next Period" (Sep 30 today, "Nothing to recognize for this period"); Oct 31 reached by overriding the modal's hidden `periodEnd` |
| 5 | Periods + close checklist | PARTIAL | "Recognize revenue for the period": OPEN before the Oct run → DONE after (PASS); Lock Oct PASS ("Period locked"); Nov run RR000002 posts while Oct Locked (PASS, `je_JSCpbwb6n2mXKtJaqWFGoU` 2026-11-30 Dr 2160 / Cr 4010 197.8022); Close Oct BLOCKED by "4 unposted documents" (seeded drafts RE000001/SHP000001/AR000001/AP000001) — Closed-period error not exercised |

## Phase B — fleet bridge (Task 31)

- Date: 2026-09-22 (app/DB clock: 2026-09-23 UTC)
- Branch: revenue-recognition-rentals-spec
- Commit: 9d2cf1fcab (HEAD at the time the browser run started; 7cf5f42130 when the task was handed over)
- URL: https://erp.revenue-recognition-rentals-spec.dev (company "Carbon Development", timezone UTC)
- Mode: verify only — no code changes, no DB writes outside the UI; SQL cross-checks are read-only via `pnpm exec tsx scripts/run-local-accounting-check.ts psql -X -tAc`
- Plan: `.ai/plans/implemented/2026-09-22-revenue-recognition-and-rentals.md` Task 31; spec `.ai/specs/implemented/2026-09-22-revenue-recognition-and-rentals.md` §2; rule `.claude/rules/fixed-asset-lifecycle.md`
- Browser: isolated `agent-browser` session `AGENT_BROWSER_SESSION=revrec-lagos-b`, dev-bypass login as test@carbon.ms
- Environment note: the ERP Vite dev server (pid 27897, `crbn up --all --no-migrate --no-regen`) was mid cold-compile when the run started; `/login` returned no bytes for ~50 min (99 % CPU in rolldown workers) and the first request completed after 294 s, after which the app answered in ~0.1 s.

### Environment note (read first)
The machine restarted after check (b) and the Docker restart recreated the Postgres volume: the company was **re-seeded** (new company id `dapj4unle0g0282krg10`, default seed data only). Checks (a) and (b) and the first W-1 registration were verified against the live database BEFORE the loss and are kept exactly as recorded, but every id in those sections is gone. Check (c) was redone from the beginning and checks (c)–(f) ran on the re-seeded company with new ids (see "ENVIRONMENT RESET" inside check (c) for the SQL proof). Nothing was restored or written outside the UI.

### Starting state (SQL, before any check)
- `companySettings`: accountingEnabled = t, revenueRecognitionEnabled = t (Phase A left it on)
- Asset classes (id | name | isCIP | life | residual % | asset acct | accum acct):
```
dapa1q7520gg2acvqpj0|Buildings|f|468|0|1360|1330
dapgg5v520gghv4vrgc0|Construction in Progress|t|120|0|1390|1330
dapa1q7520gg2acvqpjg|Machinery & Equipment|f|120|0|1350|1330
dapgg5v520gghv4vrgbg|Rental Fleet|f|60|20|1370|1380
dapa1q7520gg2acvqpk0|Vehicles|f|60|0|1310|1330
```
- Accounts: 1210 Raw Materials, 1220 Finished Goods, 1230 Work In Progress (WIP), 1330 Accumulated Depreciation, 1350 Machinery & Equipment, 1370 Rental Fleet, 1380 Accumulated Depreciation – Rental Fleet, 1390 Construction in Progress, 4140 Gain on Disposal, 6310 Depreciation Expense, 6320 Loss on Disposal. Account defaults: WIP 1230, labor absorption 5060, finished goods 1220, raw materials 1210.
- Fixed assets: 4 seeded (FA000001 Clean Room HVAC Active/Buildings 85,000; FA000002 CMM Active/M&E 240,000; FA000003 5-Axis CNC Draft; FA000004 Delivery Van Fully Depreciated/Vehicles 48,000/48,000). `fixedAssetTransfer` 0 rows, `fixedAssetCipCost` 0 rows.
- Journals: 5 (the Phase A set); no `Asset Transfer` journals; NO journal lines on 1230 at all (no job carries WIP yet).
- Depreciation runs: `DR000001` 2026-08-31 **Draft** (seeded).
- Accounting periods: Jan–Dec 2026 exist; Oct 2026 `Locked` (Phase A), the rest Open.
- Serialized items: `RW-010` Reaction Wheel 0.010 Nm (Buy, FIFO, standardCost 14,500; on hand 4 at Manufacturing Plant bin `sh_PhVKpG9VyRCJp7tZFQ2vfa`; Available serials RW010-SN-0051/0052/0053) and `SAT-1000` (Make). `itemSerialSequence`: 0 rows.
- Jobs: J000001 In Progress (SAT-1000 ×3), J000002 Ready (SAT-1000), J000003 Planned, J000004 Draft, J000005 Paused, J000006 Completed, J000007 Closed, J000008 Cancelled — all linked to sales-order lines, so none can be attached to an asset.
- Work centers (labor rate): Clean Room Bay A 95, CNC Mill 85, PCB Lab 90, Potting Station 65, QC Bench 70, TIG Welder Cell 75, TVAC Chamber 1 70.

### Check (a) — Make to Asset (job → two Rental Fleet assets)

#### Setup (all through the UI)
- `/x/part/new`: Part ID `VEH-100`, Short Description "Fleet Vehicle 100", Replenishment System **Make** (Default Method Type auto-switched to Make to Order), Tracking Type **Serial**, UoM Each → `requestSubmit` Save → redirected to `/x/part/item_NWaXeMjbnaHKrL36eduEKv/details`. SQL: `item_NWaXeMjbnaHKrL36eduEKv|VEH-100|Serial|Make|Make to Order|t`; make method `make_GVuQSSv8qzQGVgvPj7kfoT` V1 (Active switch on).
- Bill of Process: on `/x/part/<id>/make/<makeMethodId>` → "Add Operation" (inline editor) → Process **MACHINING** (Operation Type Process, description "Machining"), Work center **CNC MILL** (labor 85 / machine 120 per h) → `requestSubmit` Save. SQL: `methodOperation JYy6y9xjuEFoUh2JYefYv|Machining|Process|wc_42raRQhQKfGvCnm35hYG98`. (On the `/details` route the "Add Operation" button does nothing; it works on the `/make/<id>` route. After a history-back the make route rendered "Looks empty here" for the Bill of Process although the row existed — stale client data, unrelated to Phase B.)
- Serial sequence (needed so a 2-unit serial job splits into two numbered units): `/x/settings/serial-numbers/new` → Item `VEH-100 Fleet Vehicle 100`, Prefix `VEH100-`, Current 0, Size 5, Step 1 → Save → list shows `VEH-100 | Fleet Vehicle 100 | VEH100- | 0 | 5 | 1`. SQL: `item_NWaXeMjbnaHKrL36eduEKv|VEH100-|0|5|1`.
- Job: `/x/job/new` → Item `VEH-100`, Quantity 2 (hidden `quantity=2` verified), Location MANUFACTURING PLANT, **Complete To** select (options Inventory / Fixed Asset Class / Asset Under Construction) → **Fixed Asset Class**, then the **Fixed Asset Class** select (options Buildings / Machinery & Equipment / Rental Fleet / Vehicles — the CIP class is correctly hidden) → **Rental Fleet**. Hidden inputs before submit: `quantity=2 completeTo=class fixedAssetClassId=dapgg5v520gghv4vrgbg fixedAssetId= itemId=item_NWaXeMjbnaHKrL36eduEKv`. `requestSubmit` Save → after ~10 s redirected to `/x/job/job_55XBSqZ2tGswDmzduS7Zvw/details`, heading **J000009**, Bill of Process shows "Machining".
- SQL job: `job_55XBSqZ2tGswDmzduS7Zvw|J000009|Draft|2|dapgg5v520gghv4vrgbg(Rental Fleet)|fixedAssetId NULL|loc_DL9rttXaZ26sR2PvLzXxuR`; serial units created at job creation: `uw0LFJn5cUlZ5KShZQEF1|VEH100-00001|Reserved|1`, `QhaC1MqxehP7E0q4e7M0t|VEH100-00002|Reserved|1` (both `{"Job": job_55XB…, "Job Make Method": jmm_8EyLyuaQNbjyJhZDu7W6GZ}`); `jobMakeMethod jmm_8EyLyuaQNbjyJhZDu7W6GZ requiresSerialTracking=t`; operation `jo_7WYdBoX3CacKxzr7K4rEs9|Machining|Todo|CNC Mill|laborRate 85|machineRate 120`.
- Release: job page "Release" → dialog "Release Job J000009" → `requestSubmit` "Release Job" (`action=/x/job/job_55XB…/status?schedule=1`) → header now shows Pause / Release (disabled) / Complete / Cancel. SQL: `J000009|Ready`, operation `Ready`. The Make to Asset release gate accepted the serialized 2-unit job.
- WIP: `/x/job/job_55XB…/events/new` ("Create Production Event") → Operation `Machining`, Work Center `CNC MILL`, Event Type Labor, Start 9/22/2026 8:00 AM, End 9/22/2026 10:00 AM (segment fills; hidden `startTime=2026-09-22T12:00:00.000Z endTime=2026-09-22T14:00:00.000Z`, browser is UTC−4) → `requestSubmit` Save → redirected to `/x/job/job_55XB…/events`, row `Machining | VEH-100 | LABOR | 2 hours | CNC MILL | 9/22/26 8:00 AM | 9/22/26 10:00 AM`. SQL: `productionEvent pe_K67zpBADJ9AtaUBcFG8Vi6|Labor|duration 7200 s|wc_42raRQhQKfGvCnm35hYG98`; the route invoked `post-production-event` synchronously — journal `je_TbjzVSYW6tWGCkyQ19ZdeG` (Production Event):
```
je_TbjzVSYW6tWGCkyQ19ZdeG|1230|Work In Progress (WIP)      | 170|WIP Account             |Production Event|job_55XBSqZ2tGswDmzduS7Zvw
je_TbjzVSYW6tWGCkyQ19ZdeG|5060|Labor & Machine Absorption  |-170|Labor/Machine Absorption|Production Event|job_55XBSqZ2tGswDmzduS7Zvw
```
  → the job carries WIP 170.00 (2 h × 85/h) before completion.

#### Completion
- Job page → "Complete" → dialog text (innerText): `Receive J000009 to Inventory | This job will be received to inventory. It will no longer be available on the shop floor. | Completes to fixed asset class dapgg5v520gghv4vrgbg | Quantity Completed [2] | Serial numbers received | VEH100-00001, VEH100-00002 | Cancel | Complete Job` — no location / bin pickers (hidden `locationId=loc_DL9rttXaZ26sR2PvLzXxuR`, `storageUnitId=` empty). UI observations: the dialog title and body still say "Receive … to Inventory / will be received to inventory" for a Make to Asset job, and the target class is shown as its **raw id** (`dapgg5v520gghv4vrgbg`) rather than "Rental Fleet".
- `requestSubmit` "Complete Job" (`action=/x/job/job_55XB…/complete`) → job header reads `J000009 | COMPLETED`, Pause/Release/Complete/Cancel all disabled.
- SQL job: `J000009|Completed|quantity 2|quantityComplete 2|quantityReceivedToInventory 2|completedDate 2026-09-23 01:29:11+00`.
- SQL fixed assets (id | readable | name | serial | status | class | cost | acqDate | depStart | method | life | residual | location | entity | qty):
```
dapimpv520gi6v4vs3d0|FA000005|Fleet Vehicle 100 VEH100-00001|VEH100-00001|Active|Rental Fleet|85.00|2026-09-23|2026-09-23|Straight Line|60|20|loc_DL9rttXaZ26sR2PvLzXxuR|uw0LFJn5cUlZ5KShZQEF1|1
dapimpv520gi6v4vs3dg|FA000006|Fleet Vehicle 100 VEH100-00002|VEH100-00002|Active|Rental Fleet|85.00|2026-09-23|2026-09-23|Straight Line|60|20|loc_DL9rttXaZ26sR2PvLzXxuR|QhaC1MqxehP7E0q4e7M0t|1
```
  → two Active Rental Fleet assets at 85.00 each = the job's WIP 170.00 ÷ 2 units; class method / life / residual copied; location = the job's.
- SQL transfers:
```
fatr_JgTefGh9VeeG3UnQ9REfg3|FAT000001|Capitalization|Job|FA000005 (dapimpv520gi6v4vs3d0)|item VEH-100|uw0LFJn5cUlZ5KShZQEF1|job_55XB…|loc_DL9r…|1|2026-09-23|85.00|je_VcVmrpSY8UJRJjG23hSd2p|Posted
fatr_LoYmbcZNkqAEFZbu2sUWT7|FAT000002|Capitalization|Job|FA000006 (dapimpv520gi6v4vs3dg)|item VEH-100|QhaC1MqxehP7E0q4e7M0t|job_55XB…|loc_DL9r…|1|2026-09-23|85.00|je_VcVmrpSY8UJRJjG23hSd2p|Posted
```
- SQL journal: `je_VcVmrpSY8UJRJjG23hSd2p|Asset Transfer|Job Completion to Fixed Asset J000009|postingDate 2026-09-23|ap_MuaZV81rC8aXmjKaTN5Ae5 (Sep 2026)`; lines (amount natural-balance signed):
```
je_VcVmrpSY8UJRJjG23hSd2p|1230|Work In Progress (WIP)|Asset|-170|WIP Account |Asset Transfer|job_55XBSqZ2tGswDmzduS7Zvw|job:job_55XBSqZ2tGswDmzduS7Zvw
je_VcVmrpSY8UJRJjG23hSd2p|1370|Rental Fleet          |Asset| 170|Fixed Asset |Asset Transfer|job_55XBSqZ2tGswDmzduS7Zvw|job:job_55XBSqZ2tGswDmzduS7Zvw
```
  → **Dr 1370 Rental Fleet 170.00 / Cr 1230 WIP 170.00**, source type Asset Transfer, both lines `documentId = jobId`. Net by account for `documentId = job_55XB…`: `1230 → 0`, `1370 → 170`, `5060 → −170` — the job's WIP balance nets to zero.
- SQL tracked entities: `uw0LFJn5cUlZ5KShZQEF1|VEH100-00001|Consumed|1|{"Job": …, "Fixed Asset": "dapimpv520gi6v4vs3d0", …}`, `QhaC1MqxehP7E0q4e7M0t|VEH100-00002|Consumed|1|{…"Fixed Asset": "dapimpv520gi6v4vs3dg"…}`; `trackedActivity` `Bo61vwjaCk7VmYTG565ab|Capitalize|Fixed Asset|dapimpv520gi6v4vs3d0|FA000005` and `eZxONGVdGwQmq63JufX0J|Capitalize|Fixed Asset|dapimpv520gi6v4vs3dg|FA000006`, each with the unit as its `trackedActivityInput` (qty 1).
- SQL inventory: `itemLedger` 0 rows, `costLedger` 0 rows, `pickMethod` 0 rows for VEH-100; `itemCost.unitCost` untouched (NULL, FIFO) — VEH-100 on-hand unchanged (never entered stock).

**Check (a) result: PASS** — two Active Rental Fleet assets FA000005 / FA000006 at 85.00 each (WIP 170 ÷ 2), transfers FAT000001 / FAT000002 (Capitalization / Job, Posted), journal `je_VcVmrpSY8UJRJjG23hSd2p` Asset Transfer Dr 1370 170 / Cr 1230 170, both units Consumed with the `Fixed Asset` attribute and a Capitalize activity, no inventory movement. UI nits: complete dialog shows the raw class id and "Receive … to Inventory" wording.

### Check (b) — Capitalize a stocked serialized unit from the item inventory page

#### Prerequisite (no real serial stock existed)
- Starting state: NO `itemLedger` row in the company carries a `trackedEntityId` (the seeded RW-010 serials RW010-SN-0051/52/53 are `Available` tracked entities with no ledger or cost rows; RW-010's on-hand 4 is one untracked `Positive Adjmt.` row) — so the storage-unit table showed one aggregated row `A2-L2 | 4` with no Tracking ID and no "Capitalize as Fixed Asset" action. A unit had to be put into stock through the UI first.
- `/x/part/item_Qr9PVVG5FuJrgVkGXWwjw7/costing` ("Costing & Posting"): Unit Cost `$0.00` → `14500` (fill + Tab; hidden `unitCost=14500`, costingMethod FIFO) → `requestSubmit` Save → field shows `$14,500.00`, toast. SQL `itemCost`: `14500|14500.00000|FIFO`.
- `/x/part/item_Qr9P…/inventory` → "Update Inventory" → modal "Inventory Adjustment": Location MANUFACTURING PLANT (read-only), Storage Unit `A2-L2 Aisle-A`, Adjustment Type `Positive Adjustment`, Serial Number `RW010-SN-0061`, Quantity 1 (locked for a serial). Hidden: `trackedEntityId=odlynOciy-gi9U-v8e4mC readableId=RW010-SN-0061 adjustmentType=Positive Adjmt. quantity=1 storageUnitId=sh_PhVKpG9VyRCJp7tZFQ2vfa locationId=loc_DL9rttXaZ26sR2PvLzXxuR requiresSerialTracking=true` → `requestSubmit` Save (`action=/x/inventory/quantities/<item>/adjustment`) → page now `/x/inventory/quantities/item_Qr9P…/details`, Quantity on Hand **5**, Storage Units rows `A2-L2 | 4 | (no tracking id)` and `A2-L2 | 1 | RW010-SN-0061` (with its own Actions menu).
- SQL: entity `odlynOciy-gi9U-v8e4mC|RW010-SN-0061|Available|1|Item|item_Qr9P…`; `itemLedger il_MmEkJYwYgPrQjRTyRm3T5p|Positive Adjmt.|qty 1|trackedEntityId odlynOciy-gi9U-v8e4mC|sh_PhVKpG9VyRCJp7tZFQ2vfa|2026-09-23`; `costLedger cl_XyXUnu4ecSCJ74FKZRdvKg|Direct Cost|qty 1|cost 14500|remaining 1`; adjustment journal `je_KwCEr1FgErdM4xGVGucMvL|Inventory Adjustment`: Dr 1210 Raw Materials 14,500 / Cr 5310 Inventory Adjustment 14,500. RW-010 is a **Buy** item, so its inventory account is 1210 Raw Materials (not 1220).

#### Capitalize
- Row action: the `A2-L2 | 1 | RW010-SN-0061` row's Actions menu lists `Update Quantity | Print Label | Capitalize as Fixed Asset -> /x/fixed-asset/capitalize?itemId=item_Qr9PVVG5FuJrgVkGXWwjw7&trackedEntityId=odlynOciy-gi9U-v8e4mC&locationId=loc_DL9rttXaZ26sR2PvLzXxuR&storageUnitId=sh_PhVKpG9VyRCJp7tZFQ2vfa` (the aggregated untracked row has no Capitalize item). Automation note: `agent-browser click` on the row's "Actions" button did not open this Radix dropdown (aria-expanded stayed false); it opened with synthetic pointer events via `eval`, and the same URL was then opened directly.
- Modal "Capitalize as Fixed Asset" (`/x/fixed-asset/capitalize?…`): `Item RW-010 — Reaction Wheel 0.010 Nm | Serial Number RW010-SN-0061 | Estimated Cost $14,500.00 | The unit leaves stock and becomes an asset at its carrying cost… | Asset Class [Rental Fleet] (preselected) | Name [Reaction Wheel 0.010 Nm RW010-SN-0061] | Transfer Date 9/23/2026`. Hidden inputs: `itemId=item_Qr9P… trackedEntityId=odlynOciy-gi9U-v8e4mC locationId=loc_DL9r… storageUnitId=sh_PhVK… fixedAssetClassId=dapgg5v520gghv4vrgbg transferDate=2026-09-23`. `requestSubmit` "Capitalize" → toast, redirect to `/x/fixed-asset/dapiq2f520gid8kvs3j0`.
- Asset page text: `FA000007 | ACTIVE | Acquisition Cost $14,500.00 | Accum. Depreciation $0.00 | Net Book Value $14,500.00 | Name Reaction Wheel 0.010 Nm RW010-SN-0061 | Asset Class RENTAL FLEET | Serial Number RW010-SN-0061 | Location MANUFACTURING PLANT | Work Center — | Straight Line | 60 months | Residual 20% | Acquisition Date Sep 23, 2026 | Depreciation Start Sep 23, 2026 | Transfers: FAT000003 CAPITALIZATION INVENTORY Sep 23, 2026 View $14,500.00`.
- SQL asset: `dapiq2f520gid8kvs3j0|FA000007|Reaction Wheel 0.010 Nm RW010-SN-0061|RW010-SN-0061|Active|Rental Fleet|14500|2026-09-23|2026-09-23|loc_DL9r…|item_Qr9P…|odlynOciy-gi9U-v8e4mC|qty 1`
- SQL transfer: `fatr_YcKo71n1T5d7z2WTWa7YX2|FAT000003|Capitalization|Inventory|dapiq2f520gid8kvs3j0|item_Qr9P…|odlynOciy-gi9U-v8e4mC|jobId NULL|loc_DL9r…|sh_PhVK…|1|2026-09-23|14500|je_9AyUJUPpeUJqtC8BdvVbat|Posted`
- SQL journal `je_9AyUJUPpeUJqtC8BdvVbat|Asset Transfer|Capitalize RW-010 RW010-SN-0061 → FA000007|2026-09-23`:
```
1210|Raw Materials|-14500|Raw Materials Account     |Asset Transfer|fatr_YcKo71n1T5d7z2WTWa7YX2
1370|Rental Fleet | 14500|Fixed Asset Acquisition   |Asset Transfer|fatr_YcKo71n1T5d7z2WTWa7YX2
```
  → **Dr 1370 Rental Fleet 14,500 / Cr 1210 Raw Materials 14,500** at the unit's carrying cost (RW-010 is a Buy item → raw-materials inventory account; 1220 would apply to a made item).
- SQL ledgers: `itemLedger il_RXo5zeKcWwHeUh5WA8NuG9|Negative Adjmt.|Asset Transfer|fatr_YcKo…|-1|odlynOciy-gi9U-v8e4mC|sh_PhVK…|2026-09-23`; on-hand Σ = **4** (5 → 4); `costLedger cl_XfjyJkRAe6hoR2QXnr5pBs|Direct Cost|Asset Transfer|-1|-14500` consuming layer `cl_XyXUnu4ecSCJ74FKZRdvKg` (remaining 1 → 0).
- SQL entity: `odlynOciy-gi9U-v8e4mC|RW010-SN-0061|Consumed|1|{"Fixed Asset": "dapiq2f520gid8kvs3j0", …}`; activity `3SIfLwSt8Z88LI-X6dAvT|Capitalize|Fixed Asset|FA000007|inputs odlynOciy-gi9U-v8e4mC`.

**Check (b) result: PASS** — FA000007 Active in Rental Fleet at 14,500 with the serial, Dr 1370 / Cr 1210 at carrying cost, on-hand −1, entity Consumed, transfer FAT000003 Posted. (Precondition: the seeded serials had no ledger rows, so a unit was adjusted in through the UI first — see above.)

### Check (c) — Construction in Progress (W-1)

#### Create + register in the CIP class
- `/x/accounting/fixed-assets/new` ("New Fixed Asset" modal): Name `W-1`, Asset Class **CONSTRUCTION IN PROGRESS** (options BUILDINGS / CONSTRUCTION IN PROGRESS / MACHINERY & EQUIPMENT / RENTAL FLEET / VEHICLES); the class filled Straight Line / 120 months. Hidden `fixedAssetClassId=dapgg5v520gghv4vrgc0`. `requestSubmit` Save → toast "Fixed asset created", redirect `/x/fixed-asset/dapiqtf520giencvs3mg`.
- Asset page text: `FA000008 | DRAFT | Acquisition Cost $0.00 | … | Name W-1 | Asset Class CONSTRUCTION IN PROGRESS | … | Useful Life 120 months | Residual Value 0% | Acquisition Date — | Depreciation Start — | Construction in Progress: "No cost has been recorded against this asset yet."` (the CIP card renders for a CIP-class asset).
- `/x/fixed-asset/dapiqtf520giencvs3mg/register` ("Register Existing Asset" drawer): cost 0 was refused — form errors **"Acquisition cost must be positive"** and **"Depreciation start date is required"** (the latter even for a CIP asset that will not depreciate — UI observation). Registered with Acquisition Cost `500`, Acquisition Date 9/23/2026, Depreciation Start Date 9/23/2026 (hidden `acquisitionCost=500 acquisitionDate=2026-09-23 accumulatedDepreciation=0 depreciationStartDate=2026-09-23` verified before `requestSubmit` "Register"). The drawer sat on "Loading" for ~10 s (the dev server was recompiling) but the write had landed.
- SQL asset: `FA000008|Under Construction|acquisitionCost 500|acquisitionDate 2026-09-23|depreciationStartDate 2026-09-23` → a CIP-class registration lands at **Under Construction**.
- SQL journal `je_J9nDqfgxKPVMxsH2kuWwA5|Manual|Asset Registration: FA000008|2026-09-23`:
```
1390|Construction in Progress|500|Capitalize fixed asset at cost
3100|Retained Earnings       |500|Direct asset registration (owner equity)
```
  → Dr 1390 CIP 500 / Cr 3100 Retained Earnings 500 (the ordinary registration entry, but into the CIP asset account).
- SQL CIP cost row #1: `facc_LbSNoFHPppvrPnfaDsuMF9|dapiqtf520giencvs3mg|Manual|amount 500|costDate 2026-09-23|journal je_J9nDqfgxKPVMxsH2kuWwA5`.

#### ENVIRONMENT RESET (between the registration above and the attach-job step)
The machine restarted mid-run and the stack came back with a **re-seeded database** (Postgres container age 2 min at 02:01 UTC, `.env.local` rewritten 21:58 local; same ports/URLs). SQL on the fresh DB at 02:01 UTC: company `dapj4unle0g0282krg10|Carbon Development|accountingEnabled t|revenueRecognitionEnabled f` (the id was `dapa1q7520gg2acvqpfg` before, and Phase A had left the toggle ON); `item WHERE readableId='VEH-100'` → 0; `itemSerialSequence` → 0; jobs J000001–J000008 only (no J000009); `fixedAsset` → only the seeded FA000001–FA000004 with NEW ids (`dapj4unle0g0282krgjg…`); `fixedAssetCipCost` 0; `fixedAssetTransfer` 0; `journal` 1 row (the seeded ORBSEC entry, now dated 2026-01-10); no accounting periods from Phase A (October is no longer Locked). The `fleetAssets` view now also exposes `rentalAgreementId`, `customerId`, `customerLocationId` (rental migrations applied).

Consequence: every id recorded for checks (a), (b) and the W-1 registration above (FA000005–FA000008, FAT000001–3, `je_VcVm…`, `je_9AyU…`, `je_J9nD…`, `facc_LbSN…`) **no longer exists**. Those sections stand as observations that were cross-checked against the live database at the time; they are not reproducible from the current DB. Nothing was restored or reset by this run. The remaining checks re-create only the prerequisites they need through the UI, on the fresh seed, and re-record ids from scratch below.

#### (c) redone from the beginning on the re-seeded company
- Pre-check (SQL at 02:01 UTC, fresh seed): classes `Buildings|1360/1330`, `Construction in Progress|1390/1330|120 mo`, `Machinery & Equipment|1350/1330|120 mo`, `Rental Fleet|1370/1380|60 mo|20 %`, `Vehicles|1310/1330`; accounts 1370/1380/1390 present; `depreciationRun` = seeded `DR000001 2026-08-31 Draft`; `accountingPeriod` 0 rows; `/x/accounting/asset-classes` lists BUILDINGS · CONSTRUCTION IN PROGRESS · MACHINERY & EQUIPMENT · RENTAL FLEET · VEHICLES.
- **Seed gap found:** on the fresh seed the "Construction in Progress" class row had `isConstructionInProgress = f` (all five classes `f`, created by `system` at 01:59:22 by the dev bootstrap; `functions/lib/seed.data.ts` line 972 sets `true` for the onboarding `seed-company` path, so this is a dev-bootstrap-only gap). The class edit form (`/x/accounting/asset-class/<id>`, "Edit Asset Class") has **no control for the flag** (fields: Name, Description, Depreciation Method, Useful Life, Residual %, seven account pickers), so it cannot be repaired from the UI. The coordinator set the flag directly (out of band, before any W-1 registration on this DB); SQL now reads `dapj4unle0g0282krg6g|Construction in Progress|t`. No other data was touched.
- **W-1 (again, fresh DB):** `/x/accounting/fixed-assets/new` → Name `W-1`, Asset Class CONSTRUCTION IN PROGRESS (hidden `fixedAssetClassId=dapj4unle0g0282krg6g`, method Straight Line, life 120) → Save → `/x/fixed-asset/dapj8fnle0g08u2ks090`, page `FA000005 | DRAFT | … | Construction in Progress: No cost has been recorded against this asset yet.` (Automation note: the first submit lost the typed values on a modal re-render and the form answered "Name is required"; re-filled and submitted with a verify-then-submit eval.)
- Register (`/x/fixed-asset/dapj8fnle0g08u2ks090/register`): Acquisition Cost 500, Acquisition Date 9/23/2026, Depreciation Start Date 9/23/2026 (the drawer still requires both a positive cost and a depreciation start date for a CIP asset). Hidden `acquisitionCost=500 acquisitionDate=2026-09-23 accumulatedDepreciation=0 depreciationStartDate=2026-09-23` verified, `requestSubmit` Register → asset page: `FA000005 | UNDER CONSTRUCTION | Acquisition Cost $500.00 | Accum. Depreciation $0.00 | Net Book Value $500.00 | … | Acquisition Date Sep 23, 2026 | Depreciation Start Sep 23, 2026 | Construction in Progress: Sep 23, 2026 MANUAL — View $500.00 | Total $500.00`. (Automation note: `agent-browser fill` on the react-aria money field committed `0.01` once; the value was set through the visible input with the native value setter + blur, and the eval refused to submit until the hidden inputs read exactly 500 / 2026-09-23 / 0 / 2026-09-23.)
- SQL asset: `FA000005|Under Construction|500|2026-09-23|2026-09-23|locationId NULL`.
- SQL journal `je_RJyrC4P7VchJruZonNmv7q|Manual|Asset Registration: FA000005|2026-09-23`:
```
1390|Construction in Progress|500|Capitalize fixed asset at cost
3100|Retained Earnings       |500|Direct asset registration (owner equity)
```
- SQL CIP cost row #1: `facc_85qccrJvrd1PUt7gqjcrp5|dapj8fnle0g08u2ks090|Manual|amount 500|costDate 2026-09-23|journal je_RJyrC4P7VchJruZonNmv7q`.

#### Job with WIP to attach (fresh DB)
- Item: `/x/part/new` → Part ID `W1-ASSY`, "W-1 Machine Assembly", Replenishment **Make**, Tracking **Inventory** (a non-serial item with a quantity-one job satisfies the Make to Asset guard and avoids serial handling for the CIP case) → Save → `/x/part/item_F973E88AzvtsxioVFuqPb8/details`. SQL: `item_F973E88AzvtsxioVFuqPb8|W1-ASSY|Inventory|Make|Make to Order`, make method `make_3RrMEoqc3i6Ncpw5zC7sGD` V1.
- Bill of Process on `/x/part/item_F973…/make/make_3RrMEoqc3i6Ncpw5zC7sGD` → Add Operation → Process MACHINING (type Process, "Machining"), Work center CNC MILL → Save. SQL: `methodOperation 7hQUPw1xK4HDdAC3padzb|Machining|Process|wc_LUqpXYqEAv6ndVdyY9uUbQ (CNC Mill, labor 85 / machine 120)|pr_Bh1wDESrC9QYagjP2maRX7`.
- Job: `/x/job/new` → Item `W1-ASSY W-1 Machine Assembly`, Quantity 1, Location MANUFACTURING PLANT, Complete To left at Inventory (hidden `itemId=item_F973… quantity=1 fixedAssetClassId= fixedAssetId=` verified) → Save → `/x/job/job_HvPNRCne8DzFHibqwxJEE2/details`, heading **J000009**. Release → "Release Job" dialog → `requestSubmit` (`/x/job/job_HvPN…/status?schedule=1`) → header `J000009 | RELEASED`. SQL: `job_HvPNRCne8DzFHibqwxJEE2|J000009|Ready|qty 1|fixedAssetClassId NULL|fixedAssetId NULL|salesOrderLineId NULL|loc_3nHYBiQEPRqga5g7bpcwNh`; operation `jo_3T3MtFLgUBE5X5GJecM9Yy|Machining|Ready|CNC Mill|laborRate 85`.
- WIP: `/x/job/job_HvPN…/events/new` → Operation Machining, Work Center CNC Mill, Labor, 9/22/2026 8:00 AM → 10:00 AM (hidden `startTime=2026-09-22T12:00:00.000Z endTime=2026-09-22T14:00:00.000Z`; browser local time is UTC−4) → Save → events list `Machining | LABOR | 2 hours | CNC MILL`. SQL: `productionEvent pe_XCi56RGWY8APyy6YeSn4qb|Labor|7200 s|wc_LUqp…`; journal `je_TxYLzR8xoeZZTrMMNqwnXh` (Production Event): Dr 1230 WIP 170 (`WIP Account`) / Cr 5060 Labor & Machine Absorption 170, both `documentId = job_HvPNRCne8DzFHibqwxJEE2` → the job carries **WIP 170.00** before attachment.

#### Attach the job (sweep of the current WIP balance)
- `/x/fixed-asset/dapj8fnle0g08u2ks090/attach-job` ("Attach Job": "The job's work-in-progress balance moves to this asset now, and completing the job sweeps the rest. Only open jobs that are not linked to a sales order or another asset are listed."). Job combobox options: **only `J000009 W1-ASSY · W-1 Machine Assembly`** (the eight seeded jobs are all sales-order-linked and correctly absent). Hidden `jobId=job_HvPNRCne8DzFHibqwxJEE2` → `requestSubmit` Attach → toast "Job attached", asset page: `FA000005 | UNDER CONSTRUCTION | Acquisition Cost $670.00 | NBV $670.00 | Location MANUFACTURING PLANT (filled from the job) | Construction in Progress: Sep 23, 2026 MANUAL — $500.00 · Sep 23, 2026 JOB J000009 $170.00 · Total $670.00 | Transfers: FAT000001 CAPITALIZATION JOB Sep 23, 2026 View $170.00`.
- SQL job: `J000009|In Progress|fixedAssetId dapj8fnle0g08u2ks090|fixedAssetClassId NULL` (status moved Ready → In Progress when the labor event was logged).
- SQL transfer: `fatr_JdpWKKdxZCAZdKRJnk4XnW|FAT000001|Capitalization|Job|dapj8fnle0g08u2ks090|job_HvPN…|loc_3nHY…|qty 1|2026-09-23|170|je_ETqKtRCqDDuBsSDMqG2BFW|Posted`.
- SQL CIP cost row #2: `facc_BaN1DWiMNFyVZWHyt2p7Gq|Job|jobId job_HvPN…|170|2026-09-23|je_ETqKtRCqDDuBsSDMqG2BFW`.
- SQL journal `je_ETqKtRCqDDuBsSDMqG2BFW|Asset Transfer|Attach job J000009 → FA000005|2026-09-23`:
```
1230|Work In Progress (WIP)  |-170|WIP Account            |Asset Transfer|job_HvPNRCne8DzFHibqwxJEE2|FAT000001
1390|Construction in Progress| 170|Fixed Asset Acquisition|Asset Transfer|job_HvPNRCne8DzFHibqwxJEE2|FAT000001
```
  → **Dr 1390 CIP 170 / Cr 1230 WIP 170** for the job's WIP balance, both lines `documentId = jobId`, transfer in `documentLineReference`. Net by account for the job: `1230 → 0`, `1390 → 170`, `5060 → −170`.
- Second labor event after attachment (so completion has something to sweep): 9/22/2026 8:00 → 9:00 AM Labor at CNC Mill (`startTime …T12:00:00Z endTime …T13:00:00Z`) → events list `1 hour`, `2 hours`. SQL: `pe_4oQSa1EYJakmNWwusp7R3|3600 s`; journal `je_GYWyvgkwD9ksRd8P6mxpkC` (Production Event) Dr 1230 85 / Cr 5060 85. Net for the job before completion: `1230 → 85`, `1390 → 170`, `5060 → −255`.

#### Complete the attached job (sweep of the remainder)
- Job page → "Complete" → dialog: `Receive J000009 to Inventory | This job will be received to inventory. It will no longer be available on the shop floor. | Sweeps cost to asset dapj8fnle0g08u2ks090 | Quantity Completed [0] | Cancel | Complete Job` — no location/bin pickers; the target asset is shown as its **raw id** (`dapj8fnle0g08u2ks090`, not "FA000005 W-1") and the title/body still talk about receiving to inventory. The quantity field opened at **0** for this untracked one-unit job (hidden `quantityComplete=0`); set to 1 through the visible input (hidden verified `quantityComplete=1 locationId=loc_3nHY…`) → `requestSubmit` "Complete Job" (`/x/job/job_HvPN…/complete`) → header `J000009 | COMPLETED`.
- SQL job: `J000009|Completed|qty 1|quantityComplete 1|quantityReceivedToInventory 1|fixedAssetId dapj8fnle0g08u2ks090`.
- SQL asset: `FA000005|Under Construction|acquisitionCost 755 (500 + 170 + 85)|2026-09-23|2026-09-23|loc_3nHY…` — status unchanged (still Under Construction; a job completion into a CIP asset never activates it).
- SQL CIP cost row #3: `facc_CEpqKib8E7VV9c1Rm8t6NK|Job|jobId job_HvPN…|85|2026-09-23|je_Pe5MC2H8TQN1RYQwgrt4SS`. Transfer `FAT000002|Capitalization|Job|job_HvPN…|qty 1|2026-09-23|85|je_Pe5MC2H8TQN1RYQwgrt4SS|Posted`.
- SQL journal `je_Pe5MC2H8TQN1RYQwgrt4SS|Asset Transfer|Job Completion to Fixed Asset J000009|2026-09-23`:
```
1230|Work In Progress (WIP)  |-85|WIP Account |Asset Transfer|job_HvPNRCne8DzFHibqwxJEE2|job:job_HvPNRCne8DzFHibqwxJEE2
1390|Construction in Progress| 85|Fixed Asset |Asset Transfer|job_HvPNRCne8DzFHibqwxJEE2|job:job_HvPNRCne8DzFHibqwxJEE2
```
  → Dr 1390 CIP 85 / Cr 1230 WIP 85 for the WIP accumulated after attachment. Net for the job: `1230 → 0`, `1390 → 255`, `5060 → −255`. W1-ASSY: `itemLedger` 0, `costLedger` 0 — nothing was received to stock.
- Asset page: `FA000005 | Under Construction | Acquisition Cost $755.00 | NBV $755.00 | Construction in Progress: Sep 23 Manual — $500.00 · Sep 23 Job J000009 $170.00 · Sep 23 Job J000009 $85.00 · Total $755.00 | Transfers: FAT000001 Capitalization Job $170.00 · FAT000002 Capitalization Job $85.00`.

---

### Re-run on the recreated stack (2026-09-23)

- Date: 2026-09-23 (company today 2026-09-23, timezone UTC). Branch `revenue-recognition-rentals-spec`, HEAD `f7a8a721ed`.
- Stack: recreated again since the section above (company `dapm0k5hs0gg26itf610` "Carbon Development"); every id above is gone. Phase C/D fleet data reused: VEH-100 units FA000005–FA000009 (Rental Fleet, cost 42,000, 60 mo, 20 %), rental agreements RA000003–RA000005 On Rent on FA000005–FA000007.
- Browser: `AGENT_BROWSER_SESSION=verify-phase-b`, dev-bypass login `test@carbon.ms`. All data created through the UI; SQL was read-only (`docker exec carbon-carbon-revenue-recognition-rentals-spec-postgres-1 psql`). Sign convention in journal lines: natural-balance signed (asset/expense debit +, asset credit −, liability/revenue credit +, contra-asset debit +).
- Pre-check: `Construction in Progress` class `dapm0k5hs0gg26itf66g` has `isConstructionInProgress = t` on this seed (the bootstrap fix from Task 35 holds; no hand patch needed). `depreciationRun`: only the seeded `DR000001 2026-08-31 Draft`.
- Browser-environment note: an ERROR flash thrown from a LOADER redirect never renders as a toast on this stack (both the new on-rent refusal and the pre-existing "Only Draft assets can be purchased" redirect showed an empty Notifications region), while action success toasts ("Asset taken out of service", "Asset returned to service") render. Refusals were therefore verified by the 302 response + unchanged DB state rather than toast text.

#### Check (c) — CIP: attach job, complete, Fixed Asset PO line, capitalize, depreciation

**Setup (UI).** `/x/part/new` → `W1-ASSY` "W-1 Machine Assembly", Replenishment Make, Tracking Inventory → `item_LGKPZxihZtJdX2zMjYPxAL` (make method `make_CNhy6pUMSRACa9FMtJBFoG`). Bill of Process on `/x/part/<id>/make/<mm>` → Add Operation → Machining / CNC MILL (labor 85/h) → `methodOperation V28MdINIXISiOB6c965xF`.

**First CIP asset W-1 (FA000017, `dapu5ilhs0grt4qtfuk0`).** `/x/accounting/fixed-assets/new` → Name W-1, class CONSTRUCTION IN PROGRESS (Straight Line, 120 mo) → Draft, CIP card "No cost has been recorded against this asset yet." Not registered (Attach Job is offered while Draft).
- Job `/x/job/new` → W1-ASSY qty 1, Complete To left at Inventory → `job_Mnix7KuUjw8dBKj8BEMA7m` **J000009**; Release → `Ready`. Labor event 9/23 8:00–10:00 AM, CNC Mill → `pe_PApzoh5CGMiu9511xsxP5Z` 7200 s; journal `je_9YVAtcHqDaZh1HM33KBacJ` Production Event: 1230 +170 / 5060 −170 → **WIP 170.00**.
- Asset Actions (Draft): Edit · Register · Purchase · Attach Job. Attach Job dialog lists only `J000009 W1-ASSY · W-1 Machine Assembly` (the eight seeded jobs are all sales-order-linked). Attach → asset page `FA000017 | UNDER CONSTRUCTION | Acquisition Cost $170.00 | Location MANUFACTURING PLANT | CIP: Sep 23, 2026 JOB J000009 $170.00 | Transfers: FAT000013 CAPITALIZATION JOB $170.00`.
  - SQL: job `J000009|In Progress|fixedAssetId dapu5ilhs0grt4qtfuk0`; CIP row `facc_PgHoyQpeQSJgeEP2j5s32V|Job|170|2026-09-23|je_BrHeAd8JM5kxqaem8GqJiW`; transfer `FAT000013|Capitalization|Job|qty 1|170|Posted`.
  - Journal `je_BrHeAd8JM5kxqaem8GqJiW` Asset Transfer "Attach job J000009 → FA000017" 2026-09-23: `1230 WIP −170 (WIP Account)` / `1390 CIP +170 (Fixed Asset Acquisition)`, both `documentId = job_Mnix…`, `documentLineReference FAT000013` → **Dr 1390 170 / Cr 1230 170**. PASS.
- Second event 10:00–11:00 → `je_YWiiy3n5FJWT34Mc6zAB3V` 1230 +85 / 5060 −85. Complete dialog: `Receive J000009 to Inventory | This job will be received to inventory… | Sweeps cost to asset dapu5ilhs0grt4qtfuk0 | Quantity Completed [0]` (same nits as before: raw asset id, inventory wording, quantity opens at 0 with Complete Job disabled). Increase → 1 → Complete Job → `J000009 | COMPLETED`.
  - SQL: `J000009|Completed|quantityComplete 1|quantityReceivedToInventory 1`; asset `Under Construction|acquisitionCost 255`; CIP row #2 `facc_KSFoMc8SuijUdCLW9j77kp|Job|85|je_5CGZ8tSrB85A5keU9c3YRw`; transfer `FAT000014|Capitalization|Job|85|Posted`; journal `je_5CGZ8tSrB85A5keU9c3YRw` "Job Completion to Fixed Asset J000009": 1230 −85 / 1390 +85. Net by account for the job: `1230 → 0`, `1390 → 255`, `5060 → −255`; W1-ASSY `itemLedger` 0 rows. PASS.
- **Fixed Asset PO line for W-1 — FAIL (UI cannot target an Under Construction asset).** Asset Actions after attach: Edit · Attach Job · Capitalize (Purchase gone). `/x/fixed-asset/<W-1>/purchase` loader refuses "Only Draft assets can be purchased". The PO line form's Fixed Asset picker and the purchase invoice line form's picker both query `status = 'Draft'` only, so once a CIP asset has its first cost (Under Construction) no new Fixed Asset PO/PI line can name it. The spec (§2 CIP, acceptance line 650) orders the PO line AFTER the job cost. The posting side supports it (`post-receipt` only flips `Draft`; an Under Construction asset keeps its status and gets a `Receipt` CIP row — proven below). W-1 (FA000017) was left `Under Construction` at 255.

**Replacement CIP asset W-1B (FA000018, `dapu85ths0gs23qtfv2g`), used for the rest of (c).** The only UI route to a PO line on a CIP asset is to raise it while the asset is still Draft, so:
- New asset W-1B in CONSTRUCTION IN PROGRESS → Draft. Actions → Purchase → Supplier AstroMill Machining → Create Purchase Order → `po_RizCkokiq9xTEy7WGcXR1j` **PO000005** with line `4ctf5cpJiStW1SicinptHA|Fixed Asset|assetId dapu85ths0gs23qtfv2g|qty 1|price 0`. Line edited: Unit Price 6000 (fill + blur, hidden `supplierUnitPrice=6000`) → Save → SQL `unitPrice 6000|supplierExtendedPrice 6000`. PO left un-received for now.
- Job `job_4oFfyohEBoMnospzxX6S11` **J000010** (W1-ASSY qty 1) → Release → labor 8:00–10:00 → `je_Ks4qt9f9PubtsXwJhWiTiL` 1230 +170 / 5060 −170.
- Attach Job on W-1B (list shows only `J000010`; completed J000009 correctly absent) → `FA000018 | UNDER CONSTRUCTION | $170.00`. SQL: CIP row #1 `facc_9wk9LB9AVkpYTThuV9YmaG|Job|170|je_U8qvH8j2vLbSsm4zRZy1wc`; `FAT000015|Capitalization|Job|170|Posted`; journal `je_U8qvH8j2vLbSsm4zRZy1wc` "Attach job J000010 → FA000018": **1230 −170 / 1390 +170**, `documentId = job_4oFf…`, ref FAT000015.
- Labor 10:00–11:00 (`je_TMsNMGKz1ZYMDxxhRxsagf` 1230 +85 / 5060 −85) → Complete (qty 0 → 1) → `J000010|Completed|fixedAssetId dapu85ths0gs23qtfv2g`. CIP row #2 `facc_JRWDfA9dNXtUWJKq5AR13h|Job|85|je_L34WbFEeFVUndqEBZA81BM`; `FAT000016|Capitalization|Job|85|Posted`; journal `je_L34WbFEeFVUndqEBZA81BM` "Job Completion to Fixed Asset J000010": **1230 −85 / 1390 +85**. Job net `1230 → 0`, `1390 → 255`, `5060 → −255`. Asset `Under Construction|255`.
- PO000005: Finalize → `To Receive and Invoice`; Receive → `rec_BHm1ZJ4d5YyovTf25F9JZy` **RE000002** (Receipt Lines empty, Fixed Assets section "W-1B FA000018") → Post Receipt → `Posted`.
  - Journal `je_TCnFN9GFCGjpaiq4421ky9` Purchase Receipt: **1390 CIP +6000 (Fixed Asset Acquisition) / 2125 GR/IR Clearing +6000 (credit)**.
  - CIP row #3 `facc_Qgrck95d5UMcwZiwyBc2Cq|Receipt|sourceDocumentId rec_BHm1…|lineId Xy2ybFb4LGm2FgUwoAUcyF|6000|je_TCnFN9GFCGjpaiq4421ky9`; asset `Under Construction|acquisitionCost 6255|acquisitionDate 2026-09-23|depreciationStartDate NULL` (status kept, no depreciation start — correct for a CIP asset).
- PO → Invoice → `pi_DqKkwK6eMEcF16pfRD2rTe` **AP000002** ($6,000.00) → Post Invoice → `Open`. Journal `je_Lb62bgBj5dydBY1SyPfRvJ`: 2125 GR/IR −6000 (debit) / 2010 AP +6000. **No second CIP row** (the invoice clears GR/IR against the receipt; the asset stays at 6,255) — no double count.
- **Capitalize** (`/x/fixed-asset/<W-1B>/capitalize`): dialog `Total Construction Cost: $6,255.00`, class options Buildings / Machinery & Equipment / Rental Fleet / Vehicles (CIP hidden), in-service defaulted to today; chose **Machinery & Equipment**, In-Service Date **10/01/2026** (hidden `toClassId=dapm0k5hs0gg26itf650 inServiceDate=2026-10-01`); preview "Debit Machinery & Equipment · Credit Construction in Progress · $6,255.00" → Capitalize → `FA000018 | ACTIVE | $6,255.00 | MACHINERY & EQUIPMENT | Acquisition Date Oct 1, 2026 | Depreciation Start Oct 1, 2026 | Transfers FAT000017 CAPITALIZATION CONSTRUCTION IN PROGRESS Oct 1, 2026 $6,255.00`.
  - SQL asset: `FA000018|Active|Machinery & Equipment|6255|2026-10-01|2026-10-01|120|0|Straight Line`; Σ CIP rows = 6255.
  - Transfer `FAT000017|Capitalization|Construction in Progress|fromClassId dapm0k5hs0gg26itf66g|transferDate 2026-10-01|inServiceDate 2026-10-01|6255|je_5s6FQMpZ7SXBLgKvmt1bC|Posted`.
  - Journal `je_5s6FQMpZ7SXBLgKvmt1bC` Asset Transfer "Capitalize FA000018 — Construction in Progress → Machinery & Equipment", postingDate 2026-10-01 (October period auto-created): **1350 +6255 / 1390 −6255**. PASS.
- **Depreciation.** (Dev seed run DR000001 was **posted** through the UI — Aug 31, FA000001 20,187.50 + FA000002 30,400.00 — so the next run could be made.)
  - Expected: W-1B excluded from any run ending before 2026-10-01; first eligible month October = 6,255 × (1 − 0 %) / 120 = 52.125 → **52.13**.
  - Accounting → Depreciation → Run Next Period → "period ending Sep 30, 2026" → **DR000002** (`dapub75hs0gs24itfvv0`): FA000001 672.92, FA000002 1,900.00, FA000016 40.00, FA000005–FA000009 560.00 each; **FA000018 absent**. Posted (Sept is the earlier month → excluded; PASS).
  - Run Next Period → "Oct 31, 2026" → **DR000003** (`dapucslhs0gs99qtg0jg`) Draft: **FA000018 W-1B $6,255.00 → $52.13, NBV after $6,202.87** (plus the eight others). PASS. DR000003 was then **deleted** through the UI (More options → Delete) so a future-period draft is not left holding a line for FA000008, which (f) returns to stock.

**Check (c) result: PASS for the posting chain; FAIL for the UI step "Fixed Asset PO line against the asset after it is Under Construction".** Attach (Dr 1390 / Cr 1230 170), completion sweep (85), Receipt CIP row (6,000; invoice adds none), capitalization Dr 1350 / Cr 1390 6,255, Active, excluded from September, 52.13 in October all verified on W-1B. The PO line had to be raised while W-1B was still Draft because no UI path names an Under Construction asset on a PO/PI line (defect D1).

#### Check (d) — work-center link and Capital Cost panel

- W-1B → Actions → Edit (`/x/fixed-asset/dapu85ths0gs23qtfv2g/details`): Work Center picker → CNC MILL (hidden `workCenterId=wc_GFFqpoM5i457cSgTygxvju` verified) → Save → redirected to the asset page, which still reads **Work Center —**. SQL: `FA000018|workCenterId NULL`. Screenshot `.context/phase-b-d-workcenter-not-saved.png`. **FAIL (defect D2).**
- Panel proof on a separate asset (the create action spreads every validated field, so the link is saved there): `/x/accounting/fixed-assets/new` → "WC Panel Check Mill Fixture", MACHINERY & EQUIPMENT, Work Center CNC MILL → `FA000019` (`dapue1lhs0gsc8atg0og`, `workCenterId wc_GFFq…`) → Register: cost 12,000, acquired 9/23/2026, depreciation start 10/1/2026 → Active; journal `je_LYoe7tWfnya8R96TaXyqjr` Manual: 1350 +12,000 / 3100 +12,000.
- `/x/resources/work-centers/wc_GFFqpoM5i457cSgTygxvju` → Edit Work Center drawer, section **CAPITAL COST**: `Asset | Name | Net Book Value | Monthly Depreciation — FA000019 | WC Panel Check Mill Fixture | $12,000.00 | $100.00 — Total $12,000.00 $100.00` (12,000 / 120 = 100). Screenshot `.context/phase-b-d-capital-cost-panel.png`.

**Check (d) result: FAIL** — the panel works, but an existing asset (the capitalized W-1B) cannot be linked to a work center: the edit action drops `workCenterId`.

#### Check (e) — out of service / return to service, and the On Rent guard

- Fleet register (`/x/accounting/fleet`): FA000005–07 ON RENT, FA000008 AVAILABLE, FA000009 IN MAINTENANCE ("Brake inspection", from Phase C/D).
- **On Rent guard.** Row menu for FA000005 (On Rent): **only "View Asset"** — Take Out of Service (and Return to Inventory) hidden. PASS.
  - The asset page (`/x/fixed-asset/dapt1dths0gplaitff30`) Actions menu still lists `Edit · Sell · Return to Inventory · Take Out of Service · Dispose` for the On Rent unit; clicking Take Out of Service lands back on the asset page (no modal).
  - Loader: `GET …/out-of-service.data` → `SingleFetchRedirect` 302 → `/x/fixed-asset/dapt1dths0gplaitff30`.
  - Action: `POST …/out-of-service.data` with `reason=Verify guard - should be refused` → 302 to the asset page; SQL afterwards `FA000005|outOfServiceSince NULL|outOfServiceReason NULL`, `fleetStatus On Rent`. Refused on both loader and action. PASS. (The refusal text "The asset is on rent on RA…; …" is not shown — see the loader-flash note at the top; screenshot `.context/phase-b-e-onrent-refused.png`.)
- **Take out of service.** FA000008 row menu `View Asset · Rent · Take Out of Service · Return to Inventory` → Take Out of Service modal ("…Depreciation continues and its accounting is unchanged.") → Reason "Tyre replacement (Phase B check e)" → toast **"Asset taken out of service"**. SQL: `FA000008|Active|outOfServiceSince 2026-09-23|Tyre replacement (Phase B check e)`, `fleetStatus In Maintenance`. PASS.
- **Still depreciates.** DR000002 (posted, Sept) charged FA000009 (out of service since 9/23) 560.00: journal `je_EZ8KVQsQoAsgcXvm4KhxSy` 6310 +560 / 1380 −560. DR000003 (Oct draft, created while FA000008 was In Maintenance) included **FA000008 560.00**. Expected 42,000 × 80 % / 60 = 560.00. PASS.
- **Return to service.** Fleet row menu (In Maintenance) `View Asset · Return to Service · Return to Inventory` → Return to Service → toast **"Asset returned to service"**. SQL `FA000008|Active|outOfServiceSince NULL|reason NULL`, `fleetStatus Available`. PASS.

**Check (e) result: PASS.** Observation: the asset page's own Actions menu does not hide Take Out of Service / Return to Inventory for an On Rent unit (only the fleet table does). The server refuses both, as the rule documents.

#### Check (f) — return to inventory at NBV, then sell

- Starting NBV for FA000008: cost 42,000 − accumulated 560 (DR000002) = **41,440**. VEH-100 is a Buy item, so the inventory account is 1210 Raw Materials.
- Expected journal: Dr 1210 41,440 / Dr 1380 560 / Cr 1370 42,000.
- Fleet row → Return to Inventory → modal `Current Net Book Value: $41,440.00 | … no gain or loss | Location MANUFACTURING PLANT | Storage Unit A1-L1 | Transfer Date 9/23/2026` → submit → asset page `FA000008 | DISPOSED | … | Transfers FAT000018 RETURN TO INVENTORY $41,440.00 | Disposal Method Transfer to Inventory | NBV at Disposal $41,440.00 | Proceeds $0.00 | Gain/Loss $0.00`.
  - Transfer `fatr_L5C1xrP5baHfHcDodZVPhp|FAT000018|Return to Inventory|Inventory|amount 41440|accumulatedDepreciation 560|sh_ErfmBvipEsfNkDhVkADw1J|je_6qzryvaRR9DajPGcuJ8SgU|Posted`.
  - Journal `je_6qzryvaRR9DajPGcuJ8SgU` Asset Transfer "Return to inventory FA000008 → VEH-100 VEH100-004": **1210 +41,440 / 1380 +560 (debit) / 1370 −42,000**.
  - Asset `Disposed|Transfer to Inventory|2026-09-23`; `fixedAssetDisposal` `Transfer to Inventory|NBV 41440|gainLoss 0|proceeds 0`; `fleetStatus Returned to Stock`.
  - Entity `-w10J4sVHxWrFc8eEb2ky VEH100-004|Available`, `Fixed Asset` attribute removed. `itemLedger` +1 `Positive Adjmt.`/Asset Transfer at A1-L1; cost layer `cl_63TUYxF5TeSnrwnwUkdifT|Direct Cost|Asset Transfer|1|41440|remaining 1`. Return: PASS.
- **Sell.** `/x/sales-order/new` → NovaSat Networks → **SO000011** (`so_YEmx3fU3kakyiYYzoFAvR1`); line Part VEH-100 qty 1 at 45,000 (Pull from Inventory; picker showed "VEH-100 … 5 EA") → Confirm → `To Ship and Invoice` → Ship → **SHP000002** (`sh_5pV2ABg9gUjjAaNVUkVSZu`); Tracking Number 1 → "Show available tracking numbers" → `VEH100-004` (the other four offered were blank-serial Phase C units) → Post Shipment → `Posted`.
  - Shipment journal `je_9Sqmy3fqf8m7ZgmFekMDdT`: **5010 COGS +42,000 / 1210 −42,000**. The cost ledger consumed `cl_SeqDaFURjBUznQAFxcbH4Z` (42,000, the oldest layer). The NBV layer `cl_63TU…` (41,440) is **still remaining 1**. Entity VEH100-004 `Consumed`.
  - Expected COGS was **41,440** (the NBV the unit came back at). **FAIL (defect D3).** Screenshot `.context/phase-b-f-shipment-cogs-fifo.png`.
- SO → Invoice → **AR000016** (`si_TpGd84C9aZBm6QKbwvW1Ah`, $45,000) → Post Invoice → `Submitted`. Journal `je_JYQAicMbJ2dbhCxtGNXEGq`: **1110 AR +45,000 / 4010 Sales +45,000**; SO000011 `Completed`. Revenue: PASS.
- Aggregates stay consistent: 4 units on hand, remaining layers 3 × 42,000 + 41,440 = 167,440. So the GL is not out of balance; the specific unit's cost is simply not what COGS used.
- Side observation (pre-existing, outside Phase B): the shipment's `itemLedger` row has no `storageUnitId`, because the SO/shipment line's bin was blank. VEH-100 bins now read A1-L1 +1 (where VEH100-004 was) and unassigned 3, even though VEH100-004 left from A1-L1. `post-shipment` takes the bin from `shipmentLine.storageUnitId` (e.g. `post-shipment/index.ts:358`), not from the tracked entity.

**Check (f) result: return to inventory PASS; sale PARTIAL — revenue correct, COGS 42,000 instead of the 41,440 NBV** because other VEH-100 stock with older FIFO layers existed.

#### Summary (re-run)

| Check | Result | Notes |
|---|---|---|
| (a) Make to Asset | PASS (earlier run, pre-reset) | not re-run |
| (b) Capitalize stocked serial | PASS (earlier run, pre-reset) | not re-run |
| (c) CIP | PASS posting chain / **FAIL** one UI step | W-1B: 170 + 85 + 6,000 = 6,255 → Dr 1350 / Cr 1390, Active, excluded Sept, 52.13 Oct; PO line on an Under Construction asset impossible in UI (D1) |
| (d) Work-center link | **FAIL** | edit drops `workCenterId` (D2); panel itself verified via an asset linked at creation |
| (e) Out of service | PASS | In Maintenance, still depreciates, Available on return; On Rent hidden in fleet table and refused by loader and action |
| (f) Return + sell | Return PASS / sale **PARTIAL** | Dr 1210 41,440 / Dr 1380 560 / Cr 1370 42,000; revenue 45,000 OK; COGS 42,000 not 41,440 (D3) |

#### Defects (diagnosis only — not fixed)

- **D1 — a Fixed Asset PO/PI line cannot name an asset once it is Under Construction.**
  - Where: `apps/erp/app/modules/purchasing/ui/PurchaseOrder/PurchaseOrderLineForm.tsx:248` and `apps/erp/app/modules/invoicing/ui/PurchaseInvoice/PurchaseInvoiceLineForm.tsx:190` load picker options with `.eq("status", "Draft")`. `apps/erp/app/routes/x+/fixed-asset+/$fixedAssetId.purchase.tsx:49` refuses non-Draft ("Only Draft assets can be purchased"), and `$fixedAssetId.tsx:259` shows Purchase only `isDraft`.
  - Why it matters: the spec's CIP flow adds PO cost after the job cost; posting already supports it (`post-receipt` flips only Draft, and a receipt against Under Construction appended the `Receipt` CIP row above).
  - Likely fix: also admit `Under Construction` assets whose class `isConstructionInProgress`.
- **D2 — editing an asset never saves its work center.**
  - Where: `apps/erp/app/routes/x+/fixed-asset+/$fixedAssetId.details.tsx:53-71` passes an explicit field list to `updateFixedAsset` and omits `workCenterId`. The validator (`accounting.models.ts:1003`) and `updateFixedAsset` (`accounting.service.ts:6278`) both accept it; the create route spreads `...d`, so only creation links.
  - Consequence: an existing or capitalized asset can never be linked, so the capital-cost panel can't show it.
- **D3 — a unit returned to inventory at NBV is costed FIFO at sale, not at its NBV.**
  - Where: `packages/database/supabase/functions/shared/calculate-cogs.ts:56-82` selects the item's layers ordered by `postingDate, createdAt` with no tracked-entity (specific identification) filter. `post-shipment/index.ts:1088` calls it per item.
  - Consequence: the Return-to-Inventory layer (`post-asset-transfer` return, 41,440) sits behind older same-day 42,000 layers. COGS differs from NBV whenever other stock of the item exists; it matches only when the returned unit's layer is the oldest remaining.
  - Classification: a costing-model gap (serialized FIFO items are not specifically identified), not a regression in the transfer itself. The spec's "sold later like any other stock … COGS at NBV" holds only for a sole or oldest unit.

#### Minor UI observations (unchanged from the earlier run)

- Make to Asset / sweep complete dialog: title and body still say "Receive … to Inventory / will be received to inventory".
- The same dialog shows the target asset as a raw id ("Sweeps cost to asset dapu5ilhs0grt4qtfuk0").
- Quantity Completed opens at 0 for an untracked one-unit job.
- Loader-redirect error flashes don't render as toasts on this stack (general, not Phase B specific).
- Asset page Actions menu shows Take Out of Service / Return to Inventory for On Rent units (server refuses).

#### Data left behind (all via the UI)

- Items and assets: W1-ASSY; FA000017 W-1 (Under Construction, 255); FA000018 W-1B (Active M&E 6,255); FA000019 (Active M&E 12,000, CNC Mill).
- Documents: J000009 / J000010 Completed; PO000005 / RE000002 / AP000002; SO000011 / SHP000002 / AR000016.
- Depreciation: DR000001 and DR000002 Posted; DR000003 created then deleted.
- Fleet units: FA000008 Disposed (Transfer to Inventory), with VEH100-004 sold; FA000005 unchanged.

## Phase C — rental agreements (Task 46)

- Date: 2026-09-23 (app/DB clock and `company_today` = 2026-09-23, company timezone UTC)
- Branch / commit: revenue-recognition-rentals-spec @ a6f8de3152
- URL: https://erp.revenue-recognition-rentals-spec.dev, company "Carbon Development" (`dapm0k5hs0gg26itf610`), dev-bypass login test@carbon.ms
- Browser: `AGENT_BROWSER_SESSION=verify-phase-c`
- Mode: verify only, no code changes. Data created through the UI and the route actions it calls. Read-only SQL through `docker exec … psql`; three diagnostic INSERTs ran inside `BEGIN … ROLLBACK` (nothing persisted). **One accidental write**, disclosed under Environment.
- Plan: `.ai/plans/implemented/2026-09-22-revenue-recognition-and-rentals.md` Task 46; spec §3 + Acceptance Criteria; user doc `docs/content/docs/reference/rental-agreements.mdx`.

### Result summary

| # | Check | Result |
|---|---|---|
| 0 | Create / edit a rental agreement from the UI | **FAIL (blocker)**: D1. Everything below used a one-field workaround. |
| 0b | Open an agreement by URL (reload, new tab, deep link) | **FAIL**: D2 |
| 1 | Rate ladder on a fleet item, snapshotted at activation | PASS |
| 2 | Calendar Month Advance: 16/30 × 1,500 = 800.00; Generate Invoices; Dr AR / Cr 2160 + Deferral; run releases Dr 2160 / Cr 4060; proposed only once | PASS; the "next period on Oct 1" part is **NOT RUN** (needs Oct 1) |
| 3 | Arrears twin: accrual Dr 1145 / Cr 4060; the invoice consumes the accrual (Cr 1145) | PASS (observation O1) |
| 4 | 120.00 mileage charge: Charge line, Dr AR / Cr 4060, no schedule row | PASS |
| 5 | Deposit 3,000 → apply 500 → refund 2,500; 2110 nets to 0 | PASS |
| 6 | 28 Days Best Rate returns after 3 / 10 / 20 / 35 days | **PARTIAL**: all amounts and tiers correct, but the Return form will not submit (D3) and the re-cut Arrears period keeps its old due date, so it cannot be invoiced (D4) |
| 7 | Advance early return on day 3: −1,200 credit, Dr 2160 / Cr AR, deferral reduced to 300 | PASS (return needed the D3 workaround) |
| 8 | Advance return on day 20: no adjustment | PASS (D3 workaround) |
| 9 | Holdover past the end date on an operating line | PASS (D3 workaround; observation O2) |
| 10 | Return with "Take out of service" → In Maintenance | PASS (D3 workaround) |
| 11 | Return to Inventory refused while on rent | PASS |
| 12 | Close checklist revenue task fails on an unaccrued month, passes after the run | PASS |
| 13 | Rental Utilization report | PASS (every figure matches the arithmetic) |
| 14 | Crafted `/x/sales-invoice/<draft>/<posted-line>/delete` refused | PASS |
| 15 | A Draft agreement holding a deposit can be deleted | PASS |
| + | Future return date refused; a second Generate Invoices is a no-op; deleting a draft invoice releases its period; a duplicate run for a period is refused | PASS |

### Defects

#### D1 (blocker): no rental agreement can be created or edited from the UI
- **UI:** New Rental Agreement → Save shows the toast **"Failed to create rental agreement"** and returns to the list. Saving an existing Draft's Terms shows **"Failed to update rental agreement"** (screenshot `.context/phase-c-fail-update-rental-agreement.png`).
- **Wire:** Kong log shows `POST /rest/v1/rentalAgreement?columns=…"exchangeRate"…` → **400**, and `PATCH /rest/v1/rentalAgreement?id=eq.…&status=eq.Draft` → **400**.
- **DB error** (reproduced in a rolled-back transaction): `null value in column "exchangeRate" of relation "rentalAgreement" violates not-null constraint`.
- **Cause:** `rentalAgreementTerms()` (`apps/erp/app/modules/sales/sales.service.ts:7926`) names `exchangeRate: terms.exchangeRate` explicitly. The form (`RentalAgreementForm`) never posts `exchangeRate`, and the validator makes it optional (`sales.models.ts:1359`), so the value is `undefined`. `sanitize()` then turns it into `null` (insert at `sales.service.ts:7951`, update at `:8002`), and the column is `NOT NULL DEFAULT 1` (migration `20260923003525_rental-agreements.sql:47`).
- **Origin:** commit f5b1b8188d ("enforce rental guards on the server") replaced `...sanitize(rentalAgreement)`, where an absent key was never sent, with the explicit field pick.
- **Workaround for this run:** the same form was submitted to the same route action with one extra hidden input, `exchangeRate=1`. The Terms edit path was not used again.

#### D2: loading an agreement's URL directly returns a raw React Router error
- **Repro:** Hard-load `/x/rental-agreement/<id>` or `/x/rental-agreement/<id>/details` (reload, new tab, or pasted link). The body is JSON: `You made a GET request to "/x/rental-agreement/<id>/details" but did not provide a loader for route "routes/x+/rental-agreement+/$id.details"`. Opening the agreement by clicking it in the list still works.
- **Cause:** `apps/erp/app/routes/x+/rental-agreement+/$id.details.tsx` exports only an `action`, with no `loader` and no default component, so it is a resource route. Yet `$id._index.tsx:8` and every action redirect to `path.to.rentalAgreementDetails` (`/details`). By comparison, `x+/fixed-asset+/$fixedAssetId.details.tsx` has a default export.

#### D3 (high): the Return form never submits for an operating unit
- **Repro:** Line actions → Return → "Return Unit". The click does nothing: no toast, no field error, and no POST reaches the server (checked in the ERP log). The same happens with a valid date (screenshot `.context/phase-c-fail-return-form-no-submit.png`).
- **Cause:** `RentalAgreementReturnForm.tsx:77` renders `<Hidden name="isSalesType" value={isSalesType ? "true" : ""} />`, but the validator declares `isSalesType: zfd.checkbox({ trueValue: "true" })` (`sales.models.ts:1452`). That schema accepts only `"true"` or `undefined`. Running it under `tsx` with `""` gives `invalid_union`. Client-side ValidatedForm validation therefore fails on a hidden field that shows no error. The server action would reject the same body.
- **Origin:** Phase D commit e271366816.
- **Scope:** this blocks every operating return from the UI (early return, day-20, ladder, holdover, take out of service).
- **Workaround for this run:** disable the empty hidden input before `requestSubmit`, so the body omits the field, which is what a correct form sends for an operating line. The route re-reads the classification from the line (`$id.$lineId.return.tsx` action), so this does not bypass any server guard.

#### D4 (medium): an Arrears period re-cut by a return keeps its original due date
- **Repro:** RA000008 (28 Days, Arrears, start 2026-09-21), returned on 2026-09-23. The period is correctly re-cut to Sep 21 – Sep 23, 3 days, Day tier, 300.00, but `dueOn` stays **2026-10-18**. "Generate Invoices" answers "Nothing is due on this agreement yet", and the page shows "Due Oct 18, 2026" (screenshot `.context/phase-c-fail-arrears-recut-dueOn.png`).
- **Same on the other re-cut periods:**
  - RA000009 (10 days) is due 10-11.
  - RA000010 (20 days) is due 10-01.
  - RA000011 (35 days) has period 2 due 10-14.
  - RA000012 (holdover) has its re-cut September period due 09-30.
- **Effect:** the final Arrears invoice after a return is held back until the original natural period end, up to 25 days after the unit came back. The agreement also cannot be closed until then. The doc says Arrears is due "on its last [day]", and the spec's return example expects the final period to be proposed at return.
- **Cause:**
  - `RecutPeriod` (`packages/database/supabase/functions/shared/rental-billing.ts:58`) has no `dueOn`.
  - The return's re-cut update (`post-rental-agreement/index.ts:1169-1186`) sets `periodEnd`, `days`, `amount` and `rateUnitApplied`, but not `dueOn`.
  - For Arrears, `dueOn` should become the new `periodEnd`.

#### Observations (not failing a check)
- **O1: pre-delivery rent lands on the period's last day.** On RA000005 (delivered on the last day of its first period), the non-accrued remainder 1,446.43 was deferred as a single row dated 2026-09-23 → 2026-09-23. It was not spread over the billed days Aug 27–Sep 22. This is the documented choice in `post-sales-invoice/rental-posting.ts:167-169` ("deferred from the day after the last accrued day"), and totals are right. The effect is that rent billed for days before delivery is recognized in the month the period ends.
- **O2: holdover periods are cut at activation.** Activation cuts a holdover period even when the fixed term has not ended yet:
  - RA000006 (term Sep 21 – Oct 18, activated Sep 23) got an Oct 19 – Nov 15 period.
  - RA000012 got September and October holdover periods at activation.
  - Cause: `generateRentalBillingPeriods` runs to `through = today + 28` when the end date is earlier (`shared/rental-billing.ts:280`).
  - A return before the end date deletes them (verified), but until then "Unbilled" and the billing table show rent past the term.
- **O3: UI nits.**
  - The run page's **Accruals** "Source" column shows raw line ids (`ragl_…`); Deferrals show invoice numbers.
  - Invoice line descriptions repeat the serial ("… Fleet Vehicle 100 VEH100-001 VEH100-001").
  - A refused crafted line delete shows only "Failed to delete sales invoice line", not the specific reason.
  - Take Out of Service on an On Rent unit, opened from the asset page's Actions menu, is refused, but no toast was visible to the user.
  - The asset page still offers "Return to Inventory" for an On Rent unit; the server refuses it.
- **O4: deposit journal document type.** The deposit journal lines carry `documentType 'Payment'` / the payment id, not the `'Rental Agreement'` / agreement id the spec text describes. The description "Customer Deposit" is present.
- **O5 (pre-existing, not Phase C): empty serial accepted.** The inventory adjustment modal accepted an EMPTY serial number for a serial-tracked item (see Environment).

### Setup (all UI)
- **Revenue recognition:** Settings → Accounting → "Revenue recognition" switch → toast "Revenue recognition enabled"; `companySettings.revenueRecognitionEnabled = t`. Accounting was already on. Account defaults were already mapped:
  - deferred revenue 2160
  - contract assets 1145
  - rental income 4060
  - prepayments 2110
- **Item:** `/x/part/new` → VEH-100 "Fleet Vehicle 100", Buy, Tracking **Serial**, Unit Cost 42,000 → `item_JWryRZm5yBhfFkfW6rdTPt`.
- **Stock:** Inventory → Update Inventory (Positive Adjustment, Manufacturing Plant), five adjustments with serials VEH100-001…005.
- **Fleet:** each serial capitalized through `/x/fixed-asset/capitalize?itemId=…&trackedEntityId=…` (Asset Class preselected "Rental Fleet", transfer 2026-09-23). Result: FA000005–FA000009, each Active, Rental Fleet, cost 42,000, acquired 2026-09-23; `fleetAssets.fleetStatus = Available` for all five.
- **Accounting periods:** auto-created on first posting (September 2026, Open).

### Check 1: Rate ladder: PASS
- Part → Sales tab → "Rental Rates" card (shown for the serial part): Day 100 / Week 500 / Month 1,500 → Save. SQL `itemRentalRate`: `USD|100|500|1500`.
- The Add Unit drawer shows `Day $100.00 · Week $500.00 · Month $1,500.00 — From the item's rental rates. They are snapshotted onto the line when the agreement is activated.`
- After activation, each line carries `dayRate 100, weekRate 500, monthRate 1500`.
- Raising the item's Day Rate to 120 afterwards (Sales tab save, SQL `120|500|1500`) left RA000003/4/5 lines at `100|500|1500`. The rate was then reverted to 100.

### Check 2: Calendar Month Advance (RA000003): PASS, with the October step NOT RUN
- **Setup:** NovaSat Networks, start 2026-09-15, open-ended, Calendar Month, Advance, deposit 3,000 (D1 workaround). Add Unit FA000005 (Best Rate) → toast "Added unit to the agreement" → Activate (confirm "Activate RA000003") → toast "Rental agreement activated".
- **Activation SQL:** header `Active`; line `Pending|Operating`; no journal written (journal count unchanged). Fleet status became **Reserved**.
- **Billing periods:**
```
2026-09-15|2026-09-30|16|Month| 800|due 2026-09-15|Pending   ← 1,500 × 16/30 = 800.00
2026-10-01|2026-10-31|31|Month|1500|due 2026-10-01|Pending
2026-11-01|2026-11-30|30|Month|1500|due 2026-11-01|Pending   (horizon = end of next month + one)
```
- **Deliver:** Line actions → Deliver ("Mark the unit as delivered to the customer today…") → "Unit delivered". Line `On Rent|deliveredAt 2026-09-23`, fleet `On Rent`.
- **Generate Invoices** (confirm "Draft a sales invoice for every billing period and charge due today") → "Drafted 1 rental invoice". Draft AR000002 (`si_GvApMbqVAxDZHLGsXzUYTy`) has:
  - `Rental|Rent|"2026-09-15 – 2026-09-30 · 16 days · Month rate — …"|1 × 800|service 09-15→09-30`
  - the Charge line (check 4)
  - the period stamped `Invoiced` with the line id
- **Idempotent:** a second Generate Invoices → toast "Nothing is due on this agreement yet"; the Rental line count stays 2.
- **Post** AR000002 → "Sales invoice confirmed". Journal JE-2026-09-000015 (natural-balance signs):
```
1110 Accounts Receivable  800  Invoice si_Gv…
1110 Accounts Receivable  120  Invoice si_Gv…
2160 Deferred Revenue     800  Rental Agreement RA000003   ← Cr 2160 800
4060 Rental Income        120  Rental Agreement RA000003   ← charge (check 4)
```
  Schedule row: `Deferral|Planned|2026-09-15→09-30|scheduled 2026-09-30|800|Dr 2160|Cr 4060`.
- **Run:** RR000002 (period end 2026-09-30, see check 12) posted `2160 −800 / 4060 +800 "Revenue recognized" Invoice si_Gv…` and the row became `Posted`.
- **Never twice:**
  - Generate Invoices re-run → nothing due.
  - A second run for 2026-09-30 → toast "A revenue recognition run already exists for this period".
  - The Deferral row is Posted, so it cannot be claimed again.
- **NOT RUN:** proposing the next period on/after Oct 1 needs Oct 1. It currently sits `Pending, due 2026-10-01`, not proposed.

### Check 3: Arrears twin: PASS
- **RA000004:** Apex Space Research, Calendar Month, **Arrears**, start 2026-09-15, FA000006, delivered 2026-09-23.
  - Periods: `09-15→09-30 800 due 09-30`, `10-01→10-31 1500 due 10-31`, `11-01→11-30 1500 due 11-30`.
  - Generate Invoices → "Nothing is due on this agreement yet" (nothing proposed before the period ends).
  - Run accrual: slice Sep 23–30 = 800 × 8/16 = **400.00** `Accrual Dr 1145 / Cr 4060`, posted by RR000002 as `1145 +400 "Unbilled rent accrued" / 4060 +400 "Rental income accrued"` (Rental Agreement RA000004).
- **Invoice consuming the accrual:** the Calendar Month twin's Sep invoice cannot be drafted before Sep 30, so the consumption was exercised on **RA000005**:
  - Setup: PolarView Earth, **28 Days, Arrears**, start 2026-08-27, FA000007, delivered 2026-09-23. Period 1 is `08-27→09-23 28 days Month 1,500 due 09-23`.
  1. Generate Invoices → Draft AR000003 ("2026-08-27 – 2026-09-23 · 28 days · 1 × Month rate").
  2. New Run for 2026-09-30 (RR000001, temporary) synthesized:
     - period 1, Sep 23: 1,500 − round(1,500 × 27/28) = **53.57143**
     - period 2, Sep 24–30: 1,500 × 7/28 = **375.00**
     - RA000004: 400.00
  3. **Post AR000003** → JE-2026-09-000019:
```
1110 Accounts Receivable  1500
1145 Contract Assets      -53.57143   ← Cr 1145 (the accrual), instead of 2160
2160 Deferred Revenue    1446.42857   ← Cr 2160 for the non-accrued remainder
```
     The accrual row is stamped `billedBySalesInvoiceLineId = GfFtQtzo…`. The remainder became `Deferral 09-23→09-23 1446.42857` (O1).
  4. RR000001 (Draft) was deleted ("Successfully deleted revenue recognition run"). The rows were unclaimed and kept, then re-proposed and posted in RR000002.
- **Ledger after RR000002:** 1145 = +1,225.00 (run) − 53.57 (invoice) = **1,171.43**, which is the open unbilled accruals.

### Check 4: Mileage charge: PASS
- RA000003 → Add Charge (unit FA000005, date 2026-09-23, "Mileage overage 400 mi", 120, tax 0%) → "Added charge". SQL: `rentalAgreementCharge Charge|2026-09-23|120`.
- It rode AR000002 as `Rental|Charge|"Mileage overage 400 mi"|120`, and the charge is stamped with the line id.
- Posting: Dr 1110 120 / Cr **4060 120** (above).
- No schedule row: `revenueRecognitionSchedule` rows for AR000002 = only the 800 Deferral.

### Check 5: Deposit 3,000 → apply 500 → refund 2,500: PASS
1. **Receipt:** RA000003 → Deposits → "Record Deposit" → `/x/payments/new?customerId=…&rentalAgreementId=…&amount=3000`. The form is prefilled Payment from Customer / NovaSat / **"Deposit for" RA000003** ("Unapplied cash is held as a customer prepayment…") / 3,000 / 1010. Save → PAY-2026-09-000001 → Post. JE-2026-09-000016: `1010 +3000 "Bank / Cash"`, `2110 +3000 "Customer Deposit"` → **Dr cash 3,000 / Cr 2110 3,000**.
2. **Apply 500:** New zero-cash receipt for NovaSat (PAY-2026-09-000002). Its "Apply to invoices" table shows "On-account credit available $3,000.00". Set AR000002 applied 500 ("Drawing $500.00 from on-account credit") → Save applications → Post.
   - `invoiceSettlement`: `targetSalesInvoiceId si_Gv…|applied 500|sourcePaymentId = PAY-…001`.
   - JE-2026-09-000017: `1110 −500`, `2110 −500 "Customer Deposit (applied)"` → **Dr 2110 500 / Cr AR 500**.
   - AR000002 is Partially Paid, balance 420 (920 − 500).
3. **Refund 2,500:** New payment, Type "Refund to Customer", **"Refund deposit for" RA000003** (the options listed agreements and sales orders), 2,500 → PAY-2026-09-000003 Disbursement → Post. JE-2026-09-000018: `1010 −2500`, `2110 −2500 "Customer Deposit"` → **Dr 2110 2,500 / Cr cash 2,500**.
4. **Σ 2110 = 0.00** (SQL sum over all 2110 lines).

### Check 6: 28 Days Best Rate returns (Arrears): PARTIAL
Each ladder agreement is NovaSat, 28 Days, Arrears, Best Rate, open-ended, on unit FA000008 (reused), delivered and returned on 2026-09-23 (the D3 workaround was needed for every return).

| Agreement | Start | Days used | Periods after return | Expected | Due (D4) |
|---|---|---|---|---|---|
| RA000008 | 09-21 | 3 | `09-21→09-23 3 Day 300` | 3 × 100 = 300 | 10-18 (should be 09-23) |
| RA000009 | 09-14 | 10 | `09-14→09-23 10 Week 1000` | 2 × 500 = 1,000 (ties 10 × 100; larger unit wins) | 10-11 |
| RA000010 | 09-04 | 20 | `09-04→09-23 20 Month 1500` | 1 × 1,500 (ties 3 × 500) | 10-01 |
| RA000011 | 08-20 | 35 | `08-20→09-16 28 Month 1500` + `09-17→09-23 7 Week 500` | 1,500 + 500 = **2,000** | 09-16 / 10-14 |

- Tiers and amounts all match.
- Before each return the line had three 28-day 1,500 periods. The return deleted the Pending periods after the return date and re-cut the one it fell in.
- **FAIL part (D4):** the re-cut periods keep their pre-return due dates, so Generate Invoices on RA000008 answers "Nothing is due". The invoice text "10 days · 2 × week rate" could not be observed for that reason.
- **Line text seen instead:** RA000011's period 1 (due 09-16) drafted AR000007 as "2026-08-20 – 2026-09-16 · 28 days · 1 × Month rate …". Deleting that draft ("Delete AR000007") set the period back to `Pending` with no stamp, so a deleted draft invoice releases its period.

### Check 7: Advance early return on day 3 (RA000006): PASS
- **Setup:** ORBSEC, 28 Days, **Advance**, Best Rate, 2026-09-21 → 2026-10-18 (exactly 28 days), FA000008.
- **Activation periods:** `09-21→10-18 28 Month 1500 due 09-21`, plus a holdover period `10-19→11-15` (O2).
- **Advance invoice:** Generate Invoices → AR000004 → Post → JE-2026-09-000020: Dr 1110 1,500 / Cr 2160 1,500. Deferral rows:
  - `09-21→09-30 535.71429` (10/28)
  - `10-01→10-18 964.28571` (18/28)
- **Future-date check:** delivered, then the Return form with date 2026-09-24 → toast **"The return date cannot be in the future"** (line still On Rent).
- **Return on 2026-09-23** (day 3) → "Unit returned":
  - line `Returned`, fleet `Available`
  - the holdover period was deleted
  - new adjustment row `09-21→10-18|3|Day|-1200|isAdjustment|due 09-23` = 1,500 − 3 × 100
- **Credit invoice:** Generate Invoices → AR000005 "Early return credit — 3 days used …" 1 × −1,200 → Post → JE-2026-09-000021: `1110 −1200 / 2160 −1200` → **Dr 2160 1,200 / Cr AR 1,200**.
- **Deferral effect:** negative rows `10-01→10-18 −964.28571` and `09-21→09-30 −235.71429` (latest first). Net Planned by date: **2026-09-30 = 300.00**, 2026-10-18 = 0.00. RR000002 recognized 535.71 − 235.71 = **300.00** for September.

### Check 8: Return on day 20 (RA000007): PASS
- **Setup:** ORBSEC, 28 Days, Advance, 2026-09-04 → 2026-10-01, FA000008.
- AR000006 1,500 posted (JE-2026-09-000022, Dr 1110 / Cr 2160 1,500). Deferrals `09-04→09-30 1446.42857` and `10-01 53.57143`.
- Delivered, then returned 2026-09-23 (day 20). Periods afterwards: only the invoiced `09-04→10-01 1500`.
- **No adjustment row**: 20 days at best rate is the month tier, 1,500, and 1,500 − 1,500 = 0. The holdover period 10-02 was dropped.

### Check 9: Holdover (RA000012): PASS
- **Setup:** Apex, Calendar Month, Arrears, 2026-08-01 → 2026-08-31, FA000009, delivered 2026-09-23 (after the end date).
- **Periods at activation:** `08-01→08-31 1500`, `09-01→09-30 1500`, `10-01→10-31 1500` (holdover at the same rate).
- The header reads **"ACTIVE · PAST END DATE"**, Term "Aug 1, 2026 – Aug 31, 2026", Unbilled $4,500.00 (screenshot `.context/phase-c-holdover-header.png`).
- **Return 2026-09-23:**
  - September re-cut to `09-01→09-23 23 Month` **1,150.00** (1,500 × 23/30)
  - October deleted
  - August untouched
  - the September due date stays 09-30 (D4)

### Check 10: Return with "Take out of service": PASS
- Same RA000012 return: Take out of service ON, Out of Service Reason "Brake inspection", Meter Reading 12450, Return Notes "Returned after holdover" → "Unit returned".
- SQL: line `Returned`, `meterIn 12450`, `returnNotes` saved. `fleetAssets`: **FA000009 | In Maintenance | Brake inspection**.

### Check 11: Return to Inventory blocked while on rent: PASS
- FA000009, while On Rent on RA000012 → asset page Actions (Edit / Sell / Return to Inventory / Take Out of Service / Dispose) → Return to Inventory → submit.
- Toast: **"Asset FA000009 is on rent on rental agreement RA000012; return it from the agreement first"**. Asset still `Active`, fleet still `On Rent`.
- Take Out of Service from the same menu, and loading `/out-of-service` directly, were refused as well (no dialog, asset unchanged; O3: no toast visible).

### Check 12: Close checklist and the September run: PASS
- **Before any run:** `/x/accounting/periods/<Sep>/close` shows "Recognize revenue for the period | Auto | WARNING | **OPEN**". Cause: a Planned 800 deferral is due, and RA000004/RA000005 were on rent with no accrual.
- **Just before the final run:** still **OPEN**, with 8 Planned rows due ≤ 09-30 totalling 4,821.43.
- **RR000002** (New Run, period end 9/30/2026; the dialog defaulted to 8/31) → the run page lists:
  - **Deferrals** (5 lines, **3,992.86**):
    - AR000003 1,446.43
    - AR000004 535.71
    - AR000006 1,446.43
    - AR000002 800.00
    - AR000005 −235.71
  - **Accruals** (8 lines, **1,225.00**):
    - RA000004 400
    - RA000008 100 (300 − 200)
    - RA000005 375
    - RA000011 71.43 (500 − 428.57)
    - RA000005 53.57
    - RA000009 100 (1,000 − 900)
    - RA000012 50 (1,150 − 1,100)
    - RA000010 75 (1,500 − 1,425)

  Each accrual is the cumulative-rounding slice for the delivery day.
- **Post Run** → `Posted`, JE-2026-09-000023, source type Revenue Recognition, posting date **2026-09-30**:
```
1145 Contract Assets   8 lines  +1,225.00000   (Dr)
2160 Deferred Revenue  5 lines  −3,992.85714   (Dr)
4060 Rental Income    13 lines  +5,217.85714   (Cr)   balanced
```
- **After:** the close task reads **DONE** (screenshot `.context/phase-c-close-task-after-run.png`). A second run for 2026-09-30 → "A revenue recognition run already exists for this period".
- **Remaining Planned rows** (all after Sep 30): RA000007 10-01 53.57; RA000006 10-18 +964.29 / −964.29. The 2160 balance is 53.57, which matches them.

### Check 13: Rental Utilization, 2026-09-01 → 2026-09-30 (30 days): PASS
Every unit was acquired on 2026-09-23, so fleet days = Sep 23–30 = 8. Income is the Posted 4060-credit schedule rows plus posted Charge lines. Dollar utilization = income × 365/30 ÷ 42,000. Screenshot `.context/phase-c-rental-utilization-sep.png`.

| Unit | Fleet | On rent | Time | Income (expected) | Dollar (expected) | UI |
|---|---|---|---|---|---|---|
| FA000005 | 8 | 8 (open line, Sep 23–30) | 100% | 800 + charge 120 = 920 | 920 × 12.1667 / 42,000 = 26.651% | 8 · 8 · 100% · $920.00 · 26.651% |
| FA000006 | 8 | 8 | 100% | accrual 400 | 11.587% | matches |
| FA000007 | 8 | 8 | 100% | 53.57 + 375 + 1,446.43 = 1,875 | 54.315% | matches |
| FA000008 | 8 | 1 (six lines, all Sep 23, unioned) | 12.5% | 300 + 1,446.43 + 100 + 100 + 75 + 71.43 = 2,092.86 | 60.626% | matches |
| FA000009 | 8 | 1 | 12.5% | 50 | 1.448% | matches |
| **Total Rental Fleet** | 40 | 26 | **65%** | **5,337.86** (= run 5,217.86 + charge 120) | 5,337.86 × 12.1667 / 210,000 = **30.926%** | matches |

### Check 14: Crafted invoice-line delete: PASS
- Opened `/x/sales-invoice/si_ET7qUpVkfiavuCDr4f65Aw/QAE1JGUx15pQQzLWzqjozJ/delete`: draft AR000003 in the URL, with AR000002's **posted** Rent line.
- The confirm dialog renders ("…delete the sales invoice line for 1 2026-09-15 – 2026-09-30 · 16 days…?"). Delete → toast "Failed to delete sales invoice line".
- SQL: the line still exists on `si_Gv…` (AR000002), and its period is still `Invoiced` with the stamp.

### Check 15: Delete a Draft agreement holding a deposit: PASS
- On Draft `RA-TEST-ROLLBACK` (see Environment): "Record Deposit" → PAY-2026-09-000004 (3,000, Draft, `rentalAgreementId = rag_Ncx1…`).
- Agreement header ⋯ → "Delete Agreement" → confirm → toast "Deleted rental agreement".
- SQL: the agreement is gone; the payment has `rentalAgreementId NULL` and `companyId dapm0k5hs0gg26itf610` kept, so the composite SET NULL fix works.
- The payment was left Draft to keep 2110 clean. The FK path is the same for a posted deposit.

### Final state (SQL)
- **Agreements:** RA000003–RA000012 all Active. RA000001 and RA000002 were consumed by the two failed D1 attempts.
- **Lines:**
  - RA000003/4/5 On Rent (FA000005/6/7)
  - RA000006–011 Returned (FA000008)
  - RA000012 Returned (FA000009)
- **Fleet:** FA000005–007 On Rent, FA000008 Available, FA000009 In Maintenance.
- **Invoices:**
  - AR000002 Partially Paid 420
  - AR000003 1,500
  - AR000004 1,500
  - AR000005 −1,200
  - AR000006 1,500 (all Submitted)
  - AR000001 is the seeded draft
- **Rental-activity balances since 13:19 UTC** (natural signs):
  - 1010: +500 (3,000 − 2,500)
  - 1110: +3,720 (920 + 1,500 + 1,500 − 1,200 + 1,500 − 500)
  - 1145: +1,171.43
  - 2110: 0
  - 2160: 53.57
  - 4060: 5,337.86

### Environment notes (read these)
- **Accidental write.** While diagnosing D1, a `curl` POST to PostgREST with `Prefer: tx=rollback` was NOT rolled back: the server ignores that preference under its default config. It committed one Draft agreement, `RA-TEST-ROLLBACK` (`rag_Ncx1pNzyzPDr7SV74AZ9e5`). It was later deleted through the UI in check 15, and it is the agreement the Draft deposit PAY-2026-09-000004 was recorded against.
- **Leftover draft deposit.** PAY-2026-09-000004 (3,000, Draft, no document) remains. It counts in "Post pending operational documents" on the September close.
- **Blank-serial units.** Four VEH-100 units with **blank serial numbers** are in stock (Positive Adjmt., 42,000 each): a shell loop filled the serial field with an empty string and the modal accepted it (O5). Real serials VEH100-001…005 were adjusted in afterwards and capitalized. The four blanks sit in inventory and appear in no fleet or rental data. They were not removed, because doing so would need more adjustments.
- **Workarounds used:** D1 (injected `exchangeRate=1` hidden input on agreement create) and D3 (omitted the empty `isSalesType` hidden input on return). Both went through the same route actions the UI calls; neither bypasses a server guard.
- **Accruals on same-day delivery.** Dates were re-based to 2026-09-23. With Deliver stamping today, every accrual covers only days from Sep 23. Units delivered and returned on the same day give one on-rent day.

## Phase D — sales-type leases (Task 56)

- Date: 2026-09-23 (company today 2026-09-23, timezone UTC)
- Branch / commit: revenue-recognition-rentals-spec @ bbbfc44ff3
- URL: https://erp.revenue-recognition-rentals-spec.dev, company "Carbon Development" (`dapm0k5hs0gg26itf610`), dev-bypass login test@carbon.ms
- Browser: `AGENT_BROWSER_SESSION=verify-phase-d` (closed at the end)
- Mode: verify only. No code changes and no commits. Every record was created through the UI or the route actions its buttons post to. SQL was read-only.
- Sources: plan Task 56 + Execution notes; spec §4 + Acceptance Criteria (Sales-type, Classification); `docs/content/docs/reference/rental-agreements.mdx`.
- Amount conventions:
  - Journal amounts below are as stored: natural-balance signs, so a revenue credit reads positive and an asset credit reads negative.
  - Amounts are kept at internal scale (5 dp). Cent figures are the display values.

### Result summary

| # | Check | Result |
|---|---|---|
| 1 | Create an agreement from the UI (Phase C D1) | **PASS** |
| 2 | Edit a Draft agreement's terms (Phase C D1) | **PASS** |
| 3 | Reload `/x/rental-agreement/<id>/details`; open the bare `/x/rental-agreement/<id>` (Phase C D2) | **PASS** |
| 4 | Return form submits for an operating unit (Phase C D3) | **PASS** |
| A1 | Scenario A classification preview (line form) and Activate commencement preview | **PASS** |
| A2 | Scenario A commencement journal, `sellingProfit`, NI, dimensions | **PASS** |
| A3 | Asset Disposed (Sale) + `fixedAssetDisposal`; fleet reads Sold; tracked entity Consumed with Rental Agreement + Customer; Lease Commencement activity | **PASS** |
| A4 | 36 `rentalLeaseScheduleLine` rows: month 1 185.25 / 814.75 / 36,234.49, last closing 5,000.00 | **PASS** |
| A5 | 36 Planned Interest rows Dr 1160 / Cr 4150 | **PASS** |
| A6 | Month-1 Arrears invoice posts Dr AR 1,000 / Cr 1160 1,000, with no schedule rows | **PASS** |
| A7 | A run posts month-1 interest Dr 1160 185.25 / Cr 4150 185.25 and stamps the schedule line | **PASS** |
| A8 | Net investment report ties to 1160 | **PASS**. A later timing gap on RA000020 is the documented behaviour (see A8). |
| A9 | Months 2–36, Scenario A's own Sell to Customer | **NOT RUN**: date-bound (Sep 30 2026 … Jul 31 2029). The schedule itself is verified (A4). |
| B1 | Scenario B (11 months, ended) commencement ×3 | **PASS** |
| B2 | All 11 periods due; Generate Invoices; Sales-Type Rent lines credit 1160 | **PASS** |
| B3 | Run posts all 11 months of interest per lease; per-line 1160 = closing 3,000.00 | **PASS** |
| B4 | (i) Sell to Customer: option invoice Dr AR / Cr 1160 + **shortfall** Dr 5010 / Cr 1160; line 1160 = 0; line Sold; agreement closes | **PASS** |
| B5 | Purchase option **excess** Dr 1160 / Cr 4070 (extra twin RA000017) | **PASS** |
| B6 | (ii) Return To = Rental fleet: new fleet asset at closing NI, Dr 1370 / Cr 1160, line 1160 = 0; agreement closes | **PASS** |
| B7 | (iii) Return To = Inventory: +1 at closing NI, Dr inventory / Cr 1160, entity Available | **PASS** (observation O2) |
| B8 | Return To left empty is refused with "Choose where the returned unit goes" | **PASS** |
| C1 | Option not certain + fair value 60,000 → Operating (preview and stored) | **PASS** |
| C2 | Open-ended → Operating even with a test met (specialized asset) | **PASS** |
| C3 | Option reasonably certain without End Date is rejected by the form | **PASS** |
| C4 | Mid-month start: whole-periods message in the Activate preview, then Activate refused | **PASS** |
| C5 | Override: reason required; override saved; audit entry `entityType rentalAgreement`; override kept at activation | **PASS** (observation O1). The `update: accounting` denial was code-checked only (single admin user). |
| C6 | Advance-timing sales-type (annuity-due) numbers | **PASS**, with defect **D1** (low) |
| C7 | Sell before End Date refused; sales-type Return before End Date refused; Cancel disabled on a commenced sales-type agreement | **PASS** |
| C8 | Accumulated-depreciation leg with a non-zero value | **NOT RUN**: environment. Every unit had 0 depreciation (see Environment). The builder omits the zero leg, and the preview shows it as $0.00. |

### Defects

#### D1 (low): an Advance lease that closes on zero writes a −0.00001 Interest row in its last month
- **Where:** RA000020 (Advance, 36 × 1,000, 6 %, no certain option, no residual, so the closing target is 0).
- **Schedule:** the second-to-last line closes on **1,000.00001**. The last line therefore books `interestAmount = −0.00001`, `principal 1,000.00001`, closing 0.
- **Interest row:** activation turned that line into a Planned `Interest` row of **−0.00001**, scheduled 2029-07-31 (Dr 1160 / Cr 4150 with a negative amount).
  ```
  2029-06-30|1995.02489|1000|4.97512|995.02488|1000.00001
  2029-07-31|1000.00001|1000|-0.00001|1000.00001|0
  revenueRecognitionSchedule Interest … scheduledDate 2029-07-31 amount -0.00001
  ```
- **Cause:**
  - `packages/database/supabase/functions/shared/lessor-lease.ts:189-190`: the last line's interest is `round(closingTarget − opening + payment)`. Per-line 5-dp rounding drift can make that negative when the true final interest is 0, which is always the case for Advance with a zero closing target: the last payment lands at the start and nothing earns interest.
  - `packages/database/supabase/functions/post-rental-agreement/lessor.ts:125`: `interestRows` drops only `round(interest) === 0`, so a −0.00001 row survives.
- **Effect:** a sub-cent negative lease-interest line in the July 2029 run. The money is immaterial, but it is a negative interest row on the lease.
- **Date-bound:** it would post in 2029.

No other defects found. Every Phase C fix re-checked here holds (D1, D2, D3).

### Observations (not failing a check)
- **O1: the override audit entry is written even with the audit log OFF.**
  - `company.auditLogEnabled = false` for this company, yet the override created `auditLog_dapm0k5hs0gg26itf610` and wrote the row. `insert_audit_log_batch` calls `create_audit_log_table` itself.
  - The route comment `apps/erp/app/routes/x+/rental-agreement+/$id.$lineId.classification.tsx:113` says "a company without audit logging has no audit table", which is not true.
  - The docs (`rental-agreements.mdx:126`) say the change is recorded "with the audit log on".
  - Decide which is intended. Either way the doc and the comment disagree with the code.
- **O2: return to inventory debits the item's inventory account.** For this Buy item that is **1210 Raw Materials**. The spec text says Finished Goods (1220).
  - It is consistent: capitalizing the same unit credited 1210.
  - The docs say "inventory", which matches the code.
- **O3: the run page's Source column shows raw `ragl_…` line ids for Interest rows.** This is the same as Phase C O3 for Accruals.
- **O4: the Close dialog copy is out of date.** It reads "Every unit must be returned and every billing period invoiced" (`RentalAgreementHeader.tsx:116`), but a Sold unit also qualifies (RA000014 closed with its unit Sold).
- **O5: "Sell to Customer" is offered in the line menu before the End Date.** The server refuses with a clear message (C7). The docs describe exactly this.
- **O6: when the start date falls in a month whose run already posted.** RA000020's August interest (160.18, dated 2026-08-31) waits for the next run: RR000003 for Aug 31 was already Posted, and a run is one per period end.
  - Meanwhile the net investment report shows its NI at 33,035.37 while 1160 holds 31,035.37 (two Advance rent invoices posted).
  - This is the documented "report does not tie until the run and the invoices for the same months are both posted" behaviour.
- **O7: interest for the ended leases posts on the run's period end.** Interest for Oct 2025 – Jul 2026 on the ended B leases posted in one run at 2026-08-31 (RR000003), because a run claims every Planned row on or before its period end. Posting to 1160/4150 is correct; the P&L timing is the run date.

### Setup (all UI)
- **Item:** `/x/part/new` → **LSE-100** "Lease Excavator 100", Buy, Tracking **Serial**, Unit Cost 30,000 (`item_9EfDBS4TDs9nqow3wmcqkp`).
  - Part → Sales → Rental Rates: Day 60 / Week 300 / Month 1,000.
  - SQL `itemRentalRate`: `USD|60|300|1000`.
- **Stock:** Inventory → Quantities → LSE-100 → Update Inventory (Positive Adjustment, Manufacturing Plant), serials LSE100-001…006. `costLedger`: six layers of 30,000.
- **Fleet:** each serial capitalized through `/x/fixed-asset/capitalize?itemId=…&trackedEntityId=…&locationId=…`; the form preselected Rental Fleet and today, then "Capitalize".
  - Result: FA000010–FA000015, Active, cost 30,000, accumulated depreciation 0, fleet Available.
- **Settings in place:**
  - `revenueRecognitionEnabled = t`; lease policy 75 / 90 / 6.
  - Defaults: 1160 Net Investment in Leases, 4070 Lease Revenue, 4150 Interest Income – Leases, 5010 COGS.
  - Rental Fleet class: asset 1370, accumulated depreciation 1380, 60 months, 20 %.

### Independent expected numbers (own JS, not the app's library)
```
A  36×1,000 Arrears 6% opt 5,000:  pvRent 32,871.01624  pvOpt 4,178.22459  PVpay = NI 37,049.24083
   month 1: int 185.2462  prin 814.7538  close 36,234.48703;  month 36 close 5,000;  Σ interest 3,950.75917
   C = 30,000 → COGS 30,000, selling profit 7,049.24
B  11×1,000 Arrears 6% opt 2,000 certain, URV 1,000:  PVpay 12,570.25646  PVres 946.61487  NI 13,516.87133
   C = 30,000 → COGS 29,053.38513, selling profit −16,483.12867;  Σ interest 483.12867;  closing 3,000
   NI + Σint − 11,000 = 3,000;  option 2,000 < 3,000 → shortfall 1,000
B4 10×1,000 Arrears, option 2,000 NOT certain, URV 500, FV 10,000:  PVpay 9,730.41186 (97.30 % → test d)  PVres 475.67397
   NI 10,206.08583;  COGS 29,524.32603;  Σ interest 293.91417;  closing 500 → option 2,000 → excess 1,500
X4 36×1,000 ADVANCE, no certain option (override Sales-Type):  NI 33,035.37132; month 1 int 160.17686 / prin 839.82314 / close 32,195.54818
Classification op: 32,871.02 / 60,000 = 54.785 %; 36/120 = 30 %
```

### Checks 1–4: Phase C fixes re-confirmed
- **1. Create: PASS.**
  - Clicks: Fleet register (`/x/accounting/fleet`) → FA000010 row menu → **Rent** → `/x/rental-agreement/new?fixedAssetId=…`.
  - Filled: NovaSat Networks, Start 08/01/2026, End 07/31/2029, Calendar Month, **Arrears**, Discount Rate 6, Purchase option 5,000, "Purchase option reasonably certain" ON → Save.
  - Redirected to `/x/rental-agreement/rag_DGn7HHVPhcmCXf65eoduru/details` (**RA000013**).
  - SQL: `Draft|2026-08-01|2029-07-31|Arrears|6|5000|t|exchangeRate 1`. The form posts no `exchangeRate` and the default applied. Twelve more agreements were created the same way (RA000014–RA000021).
- **2. Edit: PASS.** RA000020 (Draft) Terms card: Start Date changed 08/15/2026 → 08/01/2026 → Save. Toast **"Updated rental agreement"**; SQL `startDate 2026-08-01`, `exchangeRate 1`.
- **3. Reload: PASS.**
  - `agent-browser reload` on `/x/rental-agreement/rag_DGn…/details` rendered the page (title "Carbon | Rental Agreement", RA000013 visible).
  - Opening the bare `/x/rental-agreement/rag_DGn…` redirected to `/details` and rendered.
- **4. Operating Return: PASS.**
  - RA000021 (Apex, FA000016 = the unit returned to the fleet in B6; open-ended, Calendar Month, Advance, start 2026-09-01) → Activate (Operating) → Deliver → Line actions → **Return** → "Return Unit".
  - The form carries no `isSalesType` / Return To fields for an operating line: `rentalAgreementLineId, returnedAt, meterIn, takeOutOfService`.
  - Toast **"Unit returned"**; line `Returned|2026-09-23`.
  - September re-cut to `09-01→09-23 | 23 days | 766.66667` (23/30 × 1,000).

### Scenario A: RA000013 (NovaSat, FA000010 / LSE100-001, NBV 30,000)
- **A1: previews.**
  - Line → Edit → "Lease classification inputs": Fair Value 38,000, Economic Life 120, residuals 0 → Save.
  - The unit form shows **SALES-TYPE · PREVIEW**: ✓ Purchase option reasonably certain; ✓ PV ≥ 90 % of fair value (**97.498 %**); term 30 %; PV of Payments **$37,049.24**, PV of Residual $0.00, Net Investment $37,049.24 (screenshot `.context/phase-d-a-line-preview.png`). The spec's "97.5 %" is this figure rounded.
  - **Activate** confirmation (`.context/phase-d-a-activate-preview.png`):
    ```
    Net Investment in Leases   $37,049.24
    Cost of Goods Sold         $30,000.00
    Lease Revenue                          $37,049.24
    Accumulated Depreciation   $0.00
    Fixed Asset (at cost)                  $30,000.00
    Selling profit: $7,049.24
    ```
- **A2: Activate → "Rental agreement activated".**
  - Line: `Pending|Sales-Type|initialNetInvestment 37049.24083|sellingProfit 7049.24083`, rates snapshotted `60|300|1000`.
  - JE-2026-09-000036 `Lease`, 2026-09-23, "Lease commencement RA000013 LSE100-001":
    ```
    1160 Net Investment in Leases  37049.24083  (Dr)
    5010 Cost of Goods Sold        30000        (Dr)
    4070 Lease Revenue             37049.24083  (Cr)
    1370 Rental Fleet             -30000        (Cr)   — no 1380 line: accumulated depreciation is 0
    ```
  - All lines have `documentType 'Rental Agreement'`, `documentId rag_DGn…`.
  - Dimensions on all four lines: Customer (NovaSat), Item (LSE-100), Location (Manufacturing Plant).
- **A3: the unit.**
  - `fixedAsset` FA000010: `Disposed|Sale|disposalDate 2026-09-23|saleProceeds 37049.24083`.
  - `fixedAssetDisposal`: `Sale|2026-09-23|proceeds 37049.24083|NBV 30000|gainLoss 7049.24083|journal je_5qm…`.
  - `fleetAssets.fleetStatus` = **Sold**.
  - Tracked entity LSE100-001: **Consumed**, attributes `{"Customer": "cust_2e2u…", "Rental Agreement": "rag_DGn…"}` (Fixed Asset removed).
  - Activities: Capitalize, then **Lease Commencement** (Rental Agreement RA000013).
- **A4: schedule.** 36 rows, 2026-08-31 → 2029-07-31, Σ interest 3,950.75917, Σ principal 32,049.24083.
  ```
  2026-08-31|37049.24083|1000|185.2462 |814.7538 |36234.48703
  2026-09-30|36234.48703|1000|181.17244|818.82756|35415.65947
  2029-06-30| 6935.47192|1000| 34.67736|965.32264| 5970.14928
  2029-07-31| 5970.14928|1000| 29.85072|970.14928| 5000
  ```
  Billing periods: 36 × 1,000, each due on its period end (Arrears), all Pending.
- **A5: interest rows.** 36 × `Interest|Planned`, Σ 3,950.75917, Dr **1160** / Cr **4150**. The first is `2026-08-01→08-31 scheduled 08-31 185.2462`.
- **A6: month-1 invoice.**
  - Line actions → Deliver ("Mark the unit as delivered… today") → **"Unit delivered"** (`On Rent|2026-09-23`).
  - Header **Generate Invoices** → Draft **AR000008**: `Rental` line "2026-08-01 – 2026-08-31 · 31 days · Month rate — …", 1 × 1,000.
  - Only August was due (Arrears; September is due 09-30).
  - Invoice → Post → "Post Invoice". JE-2026-09-000037: `1110 +1000 (Invoice) / 1160 −1000 (Rental Agreement RA000013)`. No `revenueRecognitionSchedule` row for the line.
  - The header **Cancel** button is disabled on this commenced sales-type agreement.
- **A7: run.**
  - Accounting → Revenue Recognition → **New Run**, period end 08/31/2026 → **RR000003** (34 Interest lines, $1,634.63 = A 185.25 + 3 × B 483.13) → **Post Run** → `Posted`.
  - JE-2026-09-000044, `Revenue Recognition`, posting date 2026-08-31: `1160 +1634.63221 / 4150 +1634.63221`. RA000013's lines: `1160 185.2462 "Net investment interest"`, `4150 185.2462 "Lease interest income"`.
  - All 34 schedule rows `Posted`; the 34 `rentalLeaseScheduleLine` rows have `journalId` and `postedAt` stamped.
- **A8: net investment report.**
  - Accounting → Reports → "Net Investment in Leases" (`/x/reports/lease-net-investment`), As of 9/23/2026, before end of term (`.context/phase-d-ni-report-before-end.png`):
    - RA000013: At commencement $37,049.24 · collected $814.75 · NI **$36,234.49** · next interest $181.17 Sep 30 2026 · FY2026 $4,000 / FY2027 $12,000 / FY2028 $12,000 / FY2029 $7,000 · residual+option $5,000.
    - RA000014/15/16: $13,516.87 · $10,516.87 · **$3,000.00** each.
    - **Total $45,234.49.**
  - SQL Σ 1160 = **45,234.48703**. The report **ties**.
  - Final state (`.context/phase-d-ni-report-final.png`):
    - Sold and returned lines have dropped out.
    - RA000013 $36,234.49 plus RA000020 $33,035.37; total $69,269.86 vs 1160 $67,269.86.
    - The 2,000 gap is RA000020's two Advance rent invoices, with no interest run yet (O6, documented).

### Scenario B: ended leases (start 2025-10-01, end 2026-08-31, Calendar Month, Arrears, 1,000/month, 6 %, option 2,000 reasonably certain, fair value 14,000, life 120, URV 1,000)
Agreements, all created with the same form (Rent URL):

| Agreement | Customer | Unit |
|---|---|---|
| RA000014 | Apex | FA000011 / LSE100-002 |
| RA000015 | ORBSEC | FA000012 / LSE100-003 |
| RA000016 | PolarView | FA000013 / LSE100-004 |

- **B1: commencement.**
  - Activate preview: `NI $13,516.87 / COGS $29,053.39 / Lease Revenue $12,570.26 / Accumulated Depreciation $0.00 / Fixed Asset $30,000.00 / Selling profit -$16,483.13` (a selling loss, because C = 30,000).
  - Stored: `Sales-Type|13516.87133|-16483.12867`.
  - JE-000038/39/40, e.g. 038:
    ```
    5010  29053.38513 / 1160 13516.87133 / 4070 12570.25646 / 1370 -30000
    ```
  - Schedule (11 rows):
    ```
    2025-10-31 67.58436/932.41564/12584.45569 … 2026-07-31 24.77661/975.22339/3980.09949 … 2026-08-31 19.90051/980.09949/3000
    ```
  - Σ interest 483.12867 (11 Interest rows). Billing periods 11 × 1,000, due 2025-10-31 … 2026-08-31.
- **B2: invoices.**
  - Deliver ×3 → "Unit delivered".
  - Generate Invoices ×3 → AR000009 / AR000010 / AR000011, each 11 Rental lines Σ 11,000 → Post ×3.
  - JE-000041/42/43 each: `1110 +11000 (11 lines) / 1160 −11000 (11 lines)`. 0 schedule rows; 33 periods `Invoiced`.
- **B3: interest.** RR000003 (above) posted each lease's 11 months. Per-agreement 1160 after the run: RA000014 / 15 / 16 = **3,000.00000** each (= 13,516.87133 + 483.12867 − 11,000).
- **B4 (i): Sell to Customer on RA000014.**
  - Line actions → **Sell to Customer** ("A purchase option charge of $2,000.00 is billed today and its invoice drafted…") → toast **"Purchase option invoice drafted. Posting it transfers the unit to the customer."**
  - Charge row `Purchase Option|2026-09-23|2000|"Purchase option exercised"` → AR000012 line kind `Purchase Option` 2,000 → Post.
  - JE-2026-09-000045:
    ```
    1110 Accounts Receivable                 2000   (Dr AR)
    1160 Net Investment in Leases           -2000   (Cr — option)
    5010 Cost of Goods Sold - Lease Residual  1000  (Dr — shortfall 3,000 − 2,000)
    1160 Net Investment in Leases           -1000   (Cr — shortfall)
    ```
  - RA000014 1160 = **0.00000**; line **Sold**.
  - Header **Close** → "Close RA000014…" → **Closed** (`closedAt` set).
- **B5: excess leg (twin RA000017, NovaSat, FA000014).**
  - Terms: start 2025-10-01, end 2026-07-31 (10 months), option 2,000 **not** certain, URV 500, FV 10,000.
  - Preview and stored tests `{d: true}` only → Sales-Type. NI 10,206.08583, COGS 29,524.33, selling profit −19,793.91.
  - Schedule Σ interest 293.91417, closing 500.
  - Deliver → Generate Invoices → AR000013 (10 × 1,000) → Post.
  - New Run **2026-07-31** → RR000004 (10 lines, $293.91) → Post (JE-000050, posting date 2026-07-31). RA000017 1160 = **500.00000**.
  - Sell to Customer → AR000014 → Post. JE-2026-09-000051:
    ```
    1110 +2000 / 1160 -2000 (option) / 1160 +1500 / 4070 +1500 (excess: Dr 1160 / Cr Lease Revenue)
    ```
  - RA000017 1160 = **0.00000**; line **Sold**.
- **B6 (ii): Return To = Rental fleet on RA000015.**
  - Line actions → **Return**. The form shows "This is a sales-type lease… The unit can be returned on or after the end date, Aug 31, 2026…".
  - Submitting with no choice → field error **"Choose where the returned unit goes"** (line still On Rent).
  - Chose "Rental fleet, as a new fleet asset", notes → Return Unit → line `Returned|2026-09-23`.
  - JE-2026-09-000046 `Lease` "Lease return RA000015 LSE100-003": `1370 +3000 / 1160 −3000`.
  - New asset **FA000016**: Active, Rental Fleet, cost **3,000**, acquired/depreciation start 2026-09-23, 60 months / 20 %, same serial / trackedEntity.
  - Transfer FAT000012 `Capitalization|Inventory|3000`, with a journal.
  - Entity `Consumed` with `Fixed Asset` = FA000016 (Rental Agreement / Customer removed). Fleet: FA000016 Available, FA000012 Sold.
  - RA000015 1160 = **0.00000**; its 11 schedule lines are kept, all posted. Close → "Rental agreement closed".
- **B7 (iii): Return To = Inventory on RA000016.**
  - → `Returned`. JE-2026-09-000047: `1210 Raw Materials +3000 / 1160 −3000` (O2).
  - `itemLedger` `Positive Adjmt.` +1, `documentType 'Rental Agreement'`; `costLedger` layer +1 at **3,000**.
  - Entity LSE100-004 **Available** with attributes cleared, and a `Return to Inventory` activity. RA000016 1160 = **0.00000**.
- Every `Lease` journal (000036/38/39/40/46/47/48/52) balances to 0.00000.

### Classification checks (unit FA000015 / LSE100-006, reused through Cancel)
- **C1: RA000018** (ORBSEC, 2026-08-01 → 2029-07-31, Arrears, option 5,000 not certain, FV 60,000, life 120).
  - The unit form shows **OPERATING · PREVIEW**: term 30 %, PV **54.785 %**, PV $32,871.02 (`.context/phase-d-x1-operating-preview.png`).
  - The Activate confirmation lists no commencement.
  - Activate → stored `Operating`, tests all false, `pvToFairValuePercent 54.78503`, `termToLifePercent 30`; no journal, no schedule; fleet Reserved.
  - Cancel → "Cancel Agreement" → `Cancelled`, unit Available.
- **C2: RA000019**, open-ended, "Specialized asset" ON, FV 38,000.
  - Preview: **OPERATING**, with "An open-ended agreement is always an operating lease: a sales-type lease needs an end date."
  - Activate → stored `Operating` with tests `{e: true}`, no journal. Cancelled.
- **C3:** new agreement, no End Date, option 5,000, "Purchase option reasonably certain" ON → Save.
  - Form error **"A purchase option that is reasonably certain needs an end date"**. The URL stays on `/new`; agreement count 17 → 17 (`.context/phase-d-x3-option-no-end.png`).
- **C4: RA000020** (Advance, start **2026-08-15**, end 2029-07-31, option 5,000 not certain, FV 60,000; overridden to Sales-Type in C5).
  - The Activate confirmation shows, under the unit, **"FA000015 · … is a sales-type lease, which runs whole billing periods: start on the first of a month and end on a month end"** (`.context/phase-d-x4-midmonth-preview.png`).
  - Activate → toast **"FA000015 is a sales-type lease, which runs whole billing periods: start on the first of a month and end on a month end"**; agreement stays Draft.
- **C5: override on RA000020's line.**
  - Unit form → **Override** → "Override Classification" (Classification Sales-Type, Reason).
  - Submitting with an empty Reason → **"A reason is required"**, nothing saved.
  - Reason "Custom-built attachment, no alternative use for us" → toast **"Classified as Sales-Type"**. Line `classificationOverride t|Sales-Type|<reason>`.
  - Audit row in `auditLog_dapm0k5hs0gg26itf610`:
    ```
    rentalAgreementLine|rentalAgreement|rag_7ew2…|ragl_Mszx…|UPDATE|<user>|{"lessorClassification":{"new":"Sales-Type","old":null},"classificationOverride":{"new":true,"old":false},"classificationOverrideReason":{"new":"Custom-built…","old":null}}|{"origin":"web"}
    ```
    Written although `company.auditLogEnabled = false` (O1).
  - Route permission `requirePermissions(request, { update: "accounting" })` (`$id.$lineId.classification.tsx:27-29`). A denial was not exercised: only one admin user.
  - After fixing the start date (check 2) → Activate preview `NI $33,035.37 / COGS $30,000.00 / Lease Revenue $33,035.37 / Selling profit $3,035.37` → **"Rental agreement activated"**.
  - Stored `Sales-Type`, `classificationOverride t`, tests **all false**: the override is kept over the tests' Operating. Commencement JE-2026-09-000052.
- **C6: Advance numbers (RA000020).**
  - Month 1 `33035.37132|1000|160.17686|839.82314|32195.54818`; month 2 `155.97774`, matching annuity-due, interest on the balance after the payment.
  - Billing periods due on the 1st (Aug 1 and Sep 1 due) → Generate Invoices → AR000015 (2 × 1,000) → JE-000053 `1110 +2000 / 1160 −2000`.
  - **D1**: the last line's interest is −0.00001.
- **C7: early-exit guards on RA000020.**
  - Sell to Customer → toast **"The purchase option is exercised at the end of the term (2029-07-31); early termination of a sales-type lease is a manual journal"**; no charge row.
  - Return (Rental fleet) → toast **"Early termination of a sales-type lease is a manual journal"**; line still On Rent.
  - Header Cancel is disabled on commenced sales-type agreements (RA000013, RA000014).

### Final state (SQL)
- **Agreements:**
  - RA000013 Active (On Rent)
  - RA000014 Closed (Sold)
  - RA000015 Closed (Returned)
  - RA000016 Active (Returned)
  - RA000017 Active (Sold)
  - RA000018 / RA000019 Cancelled
  - RA000020 Active (On Rent)
  - RA000021 Active (Returned, operating)
- **1160 by agreement:** RA000013 36,234.48703 · RA000020 31,035.37132 · all others 0 · total 67,269.85835.
- **LSE units:** FA000010–15 Disposed (Sale), fleet Sold; FA000016 Active / Available (the returned residual).
- **Invoices (all Submitted):** AR000008–AR000015.
- **Runs:** RR000003 (2026-08-31) and RR000004 (2026-07-31), both Posted.
- **Accounting periods** 2026-07 and 2026-08 were auto-created by the back-dated runs, and `accountingPeriod.status` follows the latest posting. This is existing behaviour, and September is Active again.

### Environment notes
- **No depreciation on the LSE units (C8 NOT RUN).** "Run Next Period" on Depreciation is disabled by a seeded Draft run **DR000001** (2026-08-31, 2 lines, 50,587.50). Posting or deleting it would have changed seeded data, so every commencement ran with accumulated depreciation 0. The builder omits the zero 1380 leg; the preview shows it as $0.00.
- **Date-bound items NOT RUN:**
  - RA000013 months 2–36 (next due 2026-09-30), and its end-of-term Sell (2029-07-31). The schedule is proven to close at 5,000.00.
  - RA000020's first-month interest (2026-08-31) waits for a future run (O6).
- **Scenario A start date.** It used **2026-08-01** rather than 2026-09-01, so the month-1 Arrears invoice and the month-1 interest run fall due today. The 36-period numbers are identical.
- **Run period end.** The Scenario A/B interest run used period end 2026-08-31. RR000002 (2026-09-30, Phase C) already exists, and a run is one per period end.
- **Workarounds.** None were needed. Twin agreements were created by opening the same `/x/rental-agreement/new?fixedAssetId=…` URL the fleet "Rent" action opens (the first one through a real Rent click).
- **Residue in the dev company:**
  - item LSE-100 with one unit back in stock (LSE100-004 at 3,000);
  - FA000016;
  - the agreements, invoices and runs above;
  - `auditLog_dapm0k5hs0gg26itf610` (created by the override, O1).
- **Screenshots:** `.context/phase-d-*.png` (evidence; no FAIL screenshots, since the one defect is a data finding).
