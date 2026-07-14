# Account Ledger Drill-Down + Period Selector

> Status: implemented (pending visual verification)
> Author: Claude (with Brad Barbin)
> Date: 2026-07-02

## TLDR

The four financial report pages — Trial Balance, Balance Sheet, Income Statement, and Chart of Accounts — now support drilling from any leaf account into the journal lines behind its balance, via a shared **Account Ledger drawer** (right-side overlay with an Opening / Net Change / Closing tie-out strip and a paginated line table). The bare start/end date pickers on those pages are replaced by a shared **PeriodSelector**: preset ranges (This Month, Last Month, This Quarter, Last Quarter, fiscal-aware This/Last Fiscal Year and Fiscal Year to Date, All Time — each row shows its resolved dates) with a custom date range as the escape hatch; the Balance Sheet uses an "as of" variant (Today, End of Last Month/Quarter/Fiscal Year). Both pieces write the same `startDate`/`endDate` URL params the loaders already read, so report semantics are unchanged.

## Tie-out contract (the important invariant)

Report balances come from the `accountTreeBalancesByCompany` RPC
(`packages/database/supabase/migrations/20260315000001_per-company-balance-rpc.sql`), whose line
predicate is: join `journalLine` → `journal`, filter by optional single `companyId`, date-filter on
`journal.postingDate`, **no journal-status filter** (Draft journals count toward balances).

The drill-down mirrors this exactly:

- Lines come from the new `journalLines` view (`journalLine ⋈ journal`, no status filter); Draft /
  Reversed lines render with a status badge instead of being hidden.
- The drawer's summary strip calls the **same RPC** with the same params and reads the account's row:
  `closing = balanceAtDate`, `netChange`, `opening = closing − netChange` — identical numbers to the
  tree's Beginning/Ending columns by construction.
- Company scoping mirrors the pages: single selected company → `eq(companyId)`; `companies=all` →
  no company filter (RPC's `p_company_id = NULL`). The chart of accounts (whole-group balances,
  `bypassRls`) drills down with no company filter and `bypassRls`, matching its parent.
- Stored `journalLine.amount` is class-normalized (positive = the account's natural side), so the
  drawer's Debit/Credit columns use `toDisplayDebit` / `toDisplayCredit` from `@carbon/utils`.

## Data model

One migration, `20260702122210_journal-lines-view.sql`:

```sql
DROP VIEW IF EXISTS "journalLines";
CREATE VIEW "journalLines" WITH(SECURITY_INVOKER=true) AS
SELECT jl.*, j."postingDate", j."journalEntryId", j."status", j."sourceType",
       j."description" AS "journalDescription"
FROM "journalLine" jl
JOIN "journal" j ON j."id" = jl."journalId";
```

No base-table changes; SECURITY_INVOKER defers to `journalLine`/`journal` RLS. Until the
cloud-generated DB types include the view, the service queries it through a cast with a hand-kept
row type (`AccountLedgerLine` in `types.ts`) — remove both once types regenerate.

## Services (`apps/erp/app/modules/accounting/`)

- `getAccountLedger(client, { accountId, companyId, startDate, endDate, limit, offset })` —
  paginated view query, newest first (`postingDate`, `journalEntryId`, `id` desc), count exact.
- `getAccountLedgerSummary(client, companyGroupId, companyId, { accountId, startDate, endDate })` —
  RPC wrapper returning `{ opening, netChange, closing }`.
- Types: `AccountLedgerLine`, `AccountLedgerSummary` in `types.ts`.

## UI

- **`PeriodSelector`** (`apps/erp/app/components/PeriodSelector.tsx`) — `variant: "range" | "asOf"`,
  `fiscalStartMonth` (1–12, from `fiscalYearSettings.startMonth`; Fiscal Year to Date / Last Fiscal
  Year are fiscal-aware, quarters calendar). Popover with a preset list (each row shows its resolved
  date range so "Last Fiscal Year" is unambiguous) + in-place custom view (DatePickers + Apply).
  Writes literal ISO dates to `startDate`/`endDate`; active preset is inferred by comparing params
  to computed ranges. "All Time" clears both params.
- **`AccountLedgerDrawer`** (`ui/Reports/AccountLedgerDrawer.tsx`) — `DrawerContent size="lg"`;
  header (account name, mono number, class badge, period label); 3-cell summary strip; table of
  Date / Entry (link to `path.to.journalEntryDetails`) / Description + source type / Debit / Credit;
  offset-param pager (50/page); closing navigates back to the parent preserving params minus `offset`.
- **Filter bars**: `ReportFilters.tsx` (+ `periodVariant`, `fiscalStartMonth` props) and
  `ChartOfAccountsTableFilters.tsx` swap their date-range popovers for `PeriodSelector`.
- **Drill-down affordances**: `TrialBalanceTree` / `FinancialStatementTree` take an optional
  `ledgerPath(accountId)` prop — leaf-row click opens the ledger (groups still expand/collapse; the
  synthetic Net Income row is excluded); the Ending/Balance cell underlines on row hover.
  `ChartOfAccountsTree` keeps row-click = edit; the balance cell (and a "View Ledger" menu item)
  opens the ledger. Its amount column shows `netChange` for every row — activity within the selected
  period, always equal to the drawer's Net Change (never the RPC's all-time `balance`). The header
  reads "Net Change" when a `startDate` is active, "Balance" otherwise (no `startDate` ⇒ the range
  starts at inception, so `netChange` degenerates to the cumulative balance).
- **`FinancialStatementTree`** takes a required `measure: "balanceAtDate" | "netChange"` and renders
  a single amount column: the Balance Sheet passes `balanceAtDate` ("Balance"), the Income Statement
  passes `netChange` ("Net Change"). The former Balance + Net Change column pair is gone — it showed
  life-to-date cumulative balances on the Income Statement regardless of the selected period, and a
  duplicated column on the Balance Sheet (which forces `startDate = null`). Known gap: the translated
  column still comes from `translateTrialBalance`, which translates `balanceAtDate` only, so translated
  Income Statement figures remain life-to-date until that RPC learns about `netChange`.

## Routes

- Child drawer routes (loaders: `view: "accounting"`, same param parsing as parents):
  `trial-balance.$accountId.tsx`, `balance-sheet.$accountId.tsx` (forces `startDate = null`),
  `income-statement.$accountId.tsx`, `charts.ledger.$accountId.tsx` (static `ledger` segment avoids
  the existing `charts.$accountId` edit route). The three report parents gained `<Outlet />`.
- Path helpers: `trialBalanceLedger`, `balanceSheetLedger`, `incomeStatementLedger`,
  `chartOfAccountsLedger`.
- All four parents export `shouldRevalidate = revalidateIgnoringOffset`
  (`~/utils/revalidate.ts`): opening/closing the drawer and paging skip the expensive balance
  RPCs; period/company changes and mutations revalidate normally.

## Acceptance criteria

- [x] PeriodSelector on TB/IS/charts shows presets + custom; Balance Sheet shows the as-of variant;
      selecting a preset writes literal dates to the URL and the report updates. *(verified 2026-07-02:
      "This Month" → `?startDate=2026-07-01&endDate=2026-07-31`; Balance Sheet shows Today / End of Last
      Month/Quarter/Year.)*
- [x] Clicking a leaf account on each of the four pages opens the drawer; Opening/Closing equal the
      tree row's Beginning/Ending for the same period. *(verified on all four pages; This Month Sales
      drawer Opening 500 / Net Change 5,525 / Closing 6,025 == tree row; Balance Sheet child forces
      startDate=null.)*
- [x] Debit/Credit split is correct for a credit-normal account (e.g. Revenue: credits in the Credit
      column, positive stored amounts). *(verified: Revenue +100 → Credit, return −50 → Debit; Asset AR
      +100 → Debit.)*
- [x] Draft journal lines appear with a Draft badge (they are included in report balances today).
      *(verified: DRAFT badge on the unposted line; +75 counted in the 6,025 balance.)*
- [x] Entry links open the journal entry; pager works; closing the drawer preserves period params.
      *(verified: link → `/x/journal-entry/$id/details`; pager `?offset=50`, "1–50 of N"; Escape returns
      to parent keeping period params, dropping offset.)*
- [ ] `tsgo --noEmit` (erp) and Biome pass. *(not run in the browser-verification pass.)*

## Out of scope

- Currency translation inside the drawer (`showTranslated` pages show untranslated company-currency
  lines); group-account drill-down (leaf accounts only); per-row running balance; ledger CSV export;
  fiscal quarters.

## Changelog

- 2026-07-02: Implemented (view migration, services, PeriodSelector, drawer, 4 child routes, tree
  affordances, revalidation guards). Browser verification deferred at user request — do a visual
  pass (tie-out + preset behavior) before moving to `implemented/`.
- 2026-07-02: Browser-verified via `/test` against the local stack (seeded fixtures on Sales 4010 /
  AR 1110). All acceptance criteria PASS except the `tsgo`/Biome gate, which was out of scope for this
  visual pass. Screenshot: `.ai/scratch/e2e/account-ledger-drawer-trial-balance.png`. Playbook cached
  at `.ai/playbooks/account-ledger-drilldown.md`. Ready to move to `implemented/` pending typecheck +
  your OK.
