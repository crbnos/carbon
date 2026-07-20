# Accounting Module

Chart of accounts, journal entries, general ledger, fiscal periods, currencies, payment terms, cost centers, dimensions, financial reporting (trial balance, balance sheet, income statement), fixed assets with depreciation, intercompany transactions, and external accounting sync (Xero).

## Key Domain Concepts

- **Chart of Accounts** — hierarchical account tree. Accounts have `class` (Asset/Liability/Equity/Revenue/Expense), `incomeBalance` (Balance Sheet/Income Statement), and `accountType`. Group accounts contain children; leaf accounts post transactions. Scoped by `companyGroupId`.
- **Journal Entries** — double-entry bookkeeping in the `journal` table. `amount > 0` = debit, `amount < 0` = credit. Lines carry dimensions and cost center allocations. Statuses: Draft → Posted → Reversed.
- **Fiscal Year Settings** — configurable start month for fiscal and tax years. Accounting periods auto-created via `getOrCreateAccountingPeriod`.
- **Dimensions** — analytical tags on journal lines (Location, Department, Project, etc.). Entity-type dimensions resolve values from their source table; Custom dimensions use `dimensionValue`.
- **Cost Centers** — hierarchical organizational units for cost allocation via `parentCostCenterId`.
- **Fixed Assets** — capital assets with depreciation. Supports straight-line, declining balance, MACRS, and units-of-production methods. Depreciation runs generate journal entries. See `.claude/rules/fixed-asset-lifecycle.md`.
- **Intercompany** — transactions between companies in a group. `runIntercompanyMatching` pairs them; `generateEliminations` creates reversing entries for consolidation.
- **Net Income** — computed equity line on the balance sheet, never a posted account. Uses synthetic `NET_INCOME_ACCOUNT_ID` constant.

## Safety

### Always
- MUST ensure journal entries balance — `postJournalEntry` validates total debits = total credits before posting.
- MUST use `rootSignMultiplier` logic for root account aggregation — Assets/Revenue add, Liabilities/Equity/Expense subtract.
- MUST scope chart of accounts by `companyGroupId` (shared across group) and transactions by `companyId`.
- MUST use `getOrCreateAccountingPeriod` before posting — it checks for closed periods and auto-creates missing ones.
- MUST use `toStoredAmount` / `toDisplayDebit` / `toDisplayCredit` for amount conversion — respects account class sign conventions.

### Ask First
- Modifying the chart of accounts structure — affects all financial reporting.
- Running depreciation — `insertDepreciationRun` creates journal entries that are difficult to reverse.
- Changing fiscal year settings — impacts period boundaries and reporting.
- Generating intercompany eliminations — creates adjustment entries on elimination entities.

### Never
- Delete posted journal entries — MUST use `reverseJournalEntry` instead.
- Manually create a "Net Income" account — it is computed via `NET_INCOME_ACCOUNT_ID`.
- Bypass double-entry balance validation when posting journal entries.
- Delete accounts that have posted journal lines — will violate referential integrity.

## Validation Commands

```bash
pnpm --filter @carbon/erp typecheck
pnpm --filter @carbon/erp test -- --testPathPattern=accounting
```

## Key Data Model

| Table / View | Purpose |
|---|---|
| `account` / `accounts` (view) | Chart of accounts with class, type, and hierarchy |
| `journal` / `journalLine` | Double-entry transactions; lines carry dimension assignments |
| `journalLineDimension` | Dimension values assigned to journal lines |
| `accountingPeriod` | Fiscal periods. `closeStatus` (`periodCloseStatus`: Open→Locked→Closed lifecycle), `fiscalYear`/`periodNumber` (identity from the fiscal start month), `lockedAt`/`lockedBy`. Legacy `status` (Active/Inactive) is deprecated. |
| `accountingPeriodBalance` | Cumulative per-account GL balance snapshots. `closeAccountingPeriod` calls `snapshotAccountingPeriodBalances` inside its close transaction (after the flip to Closed) to write them; `reopenAccountingPeriod` deletes them (`endingBalanceDate` ≥ period `endDate`) before flipping back to Open. Read by `accountTreeBalancesByCompany` (snapshot + delta; full-scan fallback when empty). Balance RPCs exclude Draft journals. |
| `periodCloseTaskDefinition` / `periodCloseTask` | NetSuite-style close checklist: company-level task templates + per-period instances (seeded via `seed-company`) |
| `accountDefault` | Default GL account mappings (AR, AP, inventory, etc.) |
| `currency` / `currencyCode` / `exchangeRateHistory` | Multi-currency with historical rates |
| `paymentTerm` | Payment terms (Net 30, 2/10 Net 30, etc.) |
| `costCenter` | Hierarchical cost allocation units |
| `dimension` / `dimensionValue` | Analytical dimensions and custom values |
| `fixedAsset` / `fixedAssetClass` | Capital assets with depreciation configuration |
| `depreciationRun` / `depreciationRunLine` | Batch depreciation processing |
| `fixedAssetDisposal` / `fixedAssetUsageLog` | Asset disposal and usage tracking |
| `intercompanyTransaction` | Cross-company transaction matching |
| `fiscalYearSettings` | Fiscal and tax year configuration |

## Key Service Functions

- `getChartOfAccounts` / `getAccounts` / `upsertAccount` — account management
- `getTrialBalance` — trial balance via `trialBalance` RPC
- `getFinancialStatementBalances` — balance sheet / income statement with Net Income computation
- `getConsolidatedBalances` — multi-company consolidation with currency translation
- `createJournalEntry` / `saveJournalEntryWithLines` / `postJournalEntry` / `reverseJournalEntry` — journal lifecycle
- `getOrCreateAccountingPeriod` / `getCurrentAccountingPeriod` — period management (lazy create on posting)
- `createFiscalYearPeriods` — generate the 12 monthly periods for a fiscal year (idempotent; from `fiscalYearSettings.startMonth`)
- `lockAccountingPeriod` / `unlockAccountingPeriod` / `closeAccountingPeriod` / `reopenAccountingPeriod` — Open↔Locked↔Closed transitions (sequential close/reopen)
- `getPeriodCloseChecklist` / `closePeriodWithChecklist` / `completeCloseTask` / `skipCloseTask` — the close checklist (instantiates tasks, evaluates auto-checks, gates the close)
- `getAccountingPeriodDeletability` / `deleteAccountingPeriod` — delete an empty, open period (blocks Locked/Closed or periods with journals)
- `getFiscalCalendarCommitted` — is the fiscal calendar committed (any posting or Locked/Closed period)? Gates editing the fiscal start month
- `getCurrencies` / `getBaseCurrency` / `getCurrencyByCode` — currency lookups
- `translateCompanyBalances` — balance translation for multi-currency consolidation
- `getDimensions` / `getActiveDimensionsWithValues` / `saveJournalLineDimensions` — dimension management
- `getCostCenters` / `getCostCentersTree` — cost center hierarchy
- `getFixedAssets` / `insertFixedAsset` / `insertDepreciationRun` — fixed asset lifecycle
- `createIntercompanyTransaction` / `runIntercompanyMatching` / `generateEliminations` — IC processing

## Key Exports

```typescript
import { getCurrencyByCode, getPaymentTermsList, getDefaultAccounts } from "~/modules/accounting";
```

## Related Modules

- **purchasing** — purchase invoices post to AP; receipts create inventory GL entries
- **sales** — sales invoices post to AR; quotes use `getCurrencyByCode` for exchange rates
- **inventory** — inventory movements create GL entries via posting groups
- **items** — `itemPostingGroup` maps item categories to GL accounts
- **people** — employees used as dimension values; cost center assignments

## Rules References

- `.claude/rules/accounting-sync-handlers.md` — Xero sync architecture, entity syncers, Inngest functions
- `.claude/rules/fixed-asset-lifecycle.md` — asset statuses, depreciation methods, disposal flow
