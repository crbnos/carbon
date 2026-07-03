# Account Ledger Drill-Down + Period Selector

Last tested: 2026-07-02
Routes: `/x/accounting/{trial-balance,balance-sheet,income-statement,charts}` + child `.../{ledger/}$accountId`
Tracking spec: `.ai/specs/2026-07-02-account-ledger-drilldown.md`

## Prerequisites
- Dev stack up for this worktree (`crbn up`). If you launch the ERP dev server
  manually, you MUST pass `NODE_EXTRA_CA_CERTS=$HOME/.portless/ca.pem` or the
  Supabase auth fetch fails with "self-signed certificate in certificate chain"
  → login shows "Authentication Error".
- Authenticated via `/auth` (DEV_BYPASS_EMAIL=test@carbon.ms).
- **Journal data must exist.** A fresh stack has 0 journals → all balances blank.
  Seed class-normalized lines directly (see below). Balances cap at *today*, so
  seed postingDates on/before the current date.
- **Chart of Accounts only:** the balance cell + "View Ledger" menu render **only
  when `companySettings.accountingEnabled = true`** (false after reset). The three
  report pages do NOT gate on this. Enable with:
  `UPDATE "companySettings" SET "accountingEnabled"=true;` (id = companyId).

## Seeding fixtures (psql via `docker exec <postgres-container> psql -U postgres`)
- `amount` is class-normalized: `toDisplayDebit/Credit` in `@carbon/utils` treat
  Asset/Expense as natural-debit. So for a Revenue (credit-normal) account:
  `amount > 0` → **Credit** column, `amount < 0` → **Debit** column. For an Asset:
  positive → Debit. Each side of a balanced entry is stored positive-on-its-natural-side
  (a credit to Asset AR is stored NEGATIVE, not as a positive on a contra row).
- Insert into `journal` (needs `journalEntryId` unique per company, `status`
  Draft|Posted|Reversed, `postingDate`) then `journalLine` (needs `amount`,
  `journalLineReference`, `companyId`, `accountId`). Leave `accountingPeriodId`,
  `createdBy` null. Draft journals ARE counted in balances (no status filter).
- To exercise the pager (50/page) put >50 lines on one account.
- Full seed script used: `/tmp/seed-ledger.sql` (55 July sales + 1 June opening +
  1 return + 1 draft on account 4010 Sales / 1110 AR).

## Steps
### 1. Navigate + PeriodSelector
- Open `/x/accounting/trial-balance`. A **PeriodSelector** button (default "All Time")
  replaces the old date pickers.
- Click it → popover with presets. **range** variant (TB/IS/charts): This Month,
  Last Month, This Quarter, Last Quarter, Year to Date, Last Year, All Time, Custom.
  **asOf** variant (Balance Sheet): Today, End of Last Month/Quarter/Year, Custom.
- Selecting a preset writes literal ISO dates to `?startDate=&endDate=` (All Time
  clears both). Active preset is inferred from the params.

### 2. Drill a leaf account (open the drawer)
- **Selector note:** the tree row is a plain `<div onClick>` (snapshot labels it
  `treeitem`). An agent-browser ref-click can hit the expand chevron and just
  toggle. Instead JS-click the name span:
  ```
  const row=[...document.querySelectorAll('div.cursor-pointer')].find(r=>r.textContent.includes('4010')&&r.textContent.includes('Sales'));
  [...row.querySelectorAll('span')].find(s=>s.textContent.trim()==='Sales').click();
  ```
- Chart of Accounts is different: **row-click = edit** (`/charts/$accountId`);
  the **balance cell** (a `button.w-32.underline`) drills to `/charts/ledger/$accountId`.
  There's also a "View Ledger" item in the row's `⋮` menu (same `openLedger` fn;
  Radix menu is hard to drive via synthetic click — verify by code equivalence).

### 3. Verify the drawer
- Header: account name, mono number, class badge (e.g. REVENUE), period label.
- Summary strip: **Opening / Net Change / Closing**. Invariant:
  `opening = closing − netChange`, and **Closing == the tree row's Ending** for the
  same period. Balance Sheet child forces `startDate=null` (as-of → Opening 0 / "All Time").
- Table: Date / Entry (link → `/x/journal-entry/$id/details`) / Description + source
  type / Debit / Credit. Draft lines show a **DRAFT** badge.
- Pager: 50/page, `?offset=50` param, "Next page"/"Previous page" aria-label icon
  buttons; footer "1–50 of N". Lines are date-filtered by the period (opening-only
  prior-period lines are NOT listed).

### 4. Close
- Escape (no explicit X). Returns to the parent route **preserving period params**,
  dropping `offset`.

## Verified 2026-07-02 (all PASS)
- TB/IS/charts range PeriodSelector + Balance Sheet asOf variant; presets write URL dates.
- Drill-down opens on all four pages; Closing ties out to the tree (500/5525/6025 under This Month; 0/6025/6025 under All Time).
- Debit/Credit correct for credit-normal (Revenue: +→Credit, return −→Debit) AND debit-normal (AR: +→Debit).
- DRAFT badge on unposted line; entry link opens the journal entry; pager pages; close preserves params.

## Common failures
- "Authentication Error" on login → ERP server missing `NODE_EXTRA_CA_CERTS`.
- All balances blank → no journal data seeded, or seeded with future postingDates.
- Charts balances/View Ledger absent → `accountingEnabled=false`.
- Drill "does nothing" on a ref-click → clicked the chevron; JS-click the name span.
