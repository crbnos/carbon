# Currency Architecture — `currency` table + companyGroupId scoping

Research ahead of the currency refactor. Core problem under investigation: `currency` is
scoped to `companyGroupId`, so an exchange rate is normalized once per company group — but
each company in a group has its own `company.baseCurrencyCode`, so "exchange rate to base"
is ill-defined at group scope whenever the group's companies disagree on base currency.

All paths are relative to repo root unless absolute. Line numbers are as of branch
`currency-exchange-rate-refactor` (conductor worktree `hat-yai`) @ `ed0bdebd95`
(2026-09-02).

---

## 1. Schema

### 1.1 `currency` — DDL history

| Migration | Change |
|---|---|
| `packages/database/supabase/migrations/20230330024715_accounts.sql:1-24` | Created `currency` with `companyId`, `name`, `symbol`, `isBaseCurrency`, `exchangeRate NUMERIC(20,8) NOT NULL DEFAULT 1` (CHECK > 0), `decimalPlaces INTEGER NOT NULL DEFAULT 2`, `active`, unique `("code","companyId")`, RLS via legacy `has_role`/`has_company_permission`. |
| `20240930183906_currency-codes.sql:1-141` | Created reference table `currencyCode(code PK, name, symbol)` (ISO seed list); FK `currency.code → currencyCode.code`; **dropped** `currency.name`, `currency.symbol`, `currency.isBaseCurrency` (lines 137-140). Added `company.baseCurrencyCode TEXT NOT NULL` FK → `currencyCode` (lines 142-154, backfilled `'USD'`). |
| `20241008201834_remove-currency-symbol-column.sql` | `currencies` view redefinition after symbol removal. |
| `20241010193506_quote-order-presentation-currency.sql:110-119` | RLS rework (accounting_view SELECT policy), dropped INSERT/DELETE policies; added document `exchangeRate` snapshot columns (see §5). |
| `20241119015113_tags.sql` | Added `tags TEXT[]`. |
| `20241210140215_rls-performance.sql:390` | Rewrote SELECT policy for performance. |
| `20250728114226_xid-to-uuid.sql` | id default change. |
| **`20260228023426_company-groups.sql:325-341`** | **The scope flip**: added `companyGroupId TEXT NOT NULL` (backfilled from `company.companyGroupId`), **dropped `companyId`**, FK → `companyGroup(id) ON DELETE CASCADE`, unique `currency_code_key ("code","companyGroupId")`, index `currency_companyGroupId_idx`. |
| `20260315000002_exchange-rate-history.sql:60` | Added `historicalExchangeRate NUMERIC(20,8)` (IAS 21 equity translation), plus the `exchangeRateHistory` table (see §1.4). |

### 1.2 Current shape (generated types, `packages/database/src/types.ts:8899-8996`)

```
currency: {
  id            string   (PK, single column — NOT the usual ("id","companyId") composite)
  code          string   → FK currencyCode(code)
  companyGroupId string  → FK companyGroup(id) ON DELETE CASCADE   [NOT NULL]
  exchangeRate  number   NUMERIC(20,8) NOT NULL DEFAULT 1, CHECK > 0
  historicalExchangeRate number | null   (manual, for equity translation)
  decimalPlaces number   INTEGER NOT NULL DEFAULT 2
  active        boolean
  tags          string[] | null
  customFields  Json | null
  createdBy/createdAt, updatedBy/updatedAt
}
UNIQUE ("code", "companyGroupId")   ← one row per currency code per GROUP
```

There is deliberately no `name`/`symbol` (live on `currencyCode`) and no
`isBaseCurrency` flag — "base" is knowable only via `company.baseCurrencyCode`, i.e.
**per company**, while the row itself is per group.

The `currencies` VIEW (`20260228023426_company-groups.sql:924-928`) is
`currency INNER JOIN currencyCode ON code` (SECURITY_INVOKER), adding `name`.

### 1.3 RLS (current, `20260228023426_company-groups.sql:866-894`)

- `SELECT`: `companyGroupId = ANY(get_company_groups_for_employee())` — employee of ANY
  member company of the group can read.
- `INSERT`/`UPDATE`/`DELETE`: `companyGroupId = ANY(get_company_groups_for_root_permission('accounting_create|update|delete'))`
  — writes require the accounting permission on the group's **root company**
  (`parentCompanyId IS NULL`).
- Helpers defined at `20260228023426_company-groups.sql:65-160`:
  `get_company_groups_for_employee()` (maps the user's employee companies →
  their groups; also handles the API-key path via `get_company_id_from_api_key()`)
  and `get_company_groups_for_root_permission(permission)`.

### 1.4 `companyGroup` / `company` relationship

- `companyGroup` table: `20260228023426_company-groups.sql:10-25`. Service-role only
  (RLS enabled, **no** user policies). `company` gained `companyGroupId` (FK, `ON DELETE
  SET NULL`), `parentCompanyId`, `isEliminationEntity`, `active`
  (lines 27-43).
- Backfill created **one group per existing company** (lines 45-59); new companies get a
  group at creation (see §3/§6 — `seedCompanyGroup` path). So today groups are almost
  always 1:1 with companies; multi-company groups arise when a second company is created
  under an existing owner (`apps/erp/app/routes/x+/settings+/companies.new.tsx` /
  onboarding, which attach the new company to the creator's existing group — see §6.3).
- Group-scoped base tables in the current schema (have `companyGroupId`, no `companyId`):
  `account`, `currency`, `dimension`, `dimensionValue`, `exchangeRateHistory`,
  `intercompanyTransaction` (from `packages/database/src/types.ts`, tables containing
  `companyGroupId`; views: `accounts`, `companies`, `currencies`, `dimensionValues`,
  `journalLinesByAccountNumber`). Operational tables (e.g. `accountDefault`) keep
  `companyId` and reference group-scoped rows by id.
- App-side resolution: `requirePermissions` returns `companyGroupId` alongside
  `companyId` (`packages/auth/src/services/auth.server.ts:345, 358, 419`); it lives in the
  auth session, set at company selection via `updateCompanySession(request, companyId,
  companyGroupId)` (`packages/auth/src/services/session.server.ts:455-476`), and for API
  keys via the embed `...company(companyGroupId)` (`auth.server.ts:128`).

### 1.5 `exchangeRateHistory` (`20260315000002_exchange-rate-history.sql:1-57`)

`(currencyCode, effectiveDate, companyGroupId)` unique; daily spot rates, group-scoped,
RLS mirroring `currency`. Consumed by `translateTrialBalance()` (same file, lines 78+;
newest version `20260811123614_widen-ledger-amounts.sql:260-333`): Closing = latest
history rate ≤ period end, Average = AVG over period, Historical =
`currency.historicalExchangeRate` — all fetched **per group**, while the function reads
the subsidiary's own `company.baseCurrencyCode` as source currency
(`20260811123614:269-270`). It computes `translatedBalance = localBalance * rate`
(`20260811123614:325-329`) — i.e. it treats the stored rate as **target units per source
unit**, which is the INVERSE of the `currency.exchangeRate` convention ("foreign per
base", §2.2). Since `exchangeRateHistory` has no writers (§3.1) and
`historicalExchangeRate` is free-text user input with no direction stated in the form
(`ExchangeRateForm.tsx:174-181`), this direction contradiction has never been forced into
the open — but any refactor that starts populating history must pick a direction and
reconcile the multiply.

---

## 2. Base currency & what `exchangeRate` means

### 2.1 Where base currency lives

- `company.baseCurrencyCode TEXT NOT NULL` FK → `currencyCode(code)` —
  `20240930183906_currency-codes.sql:142-154`. Per **company**, not per group. There is no
  group-level base currency column anywhere.
- `getBaseCurrency(client, companyId)`
  (`apps/erp/app/modules/accounting/accounting.ee.service.ts:1813-1837`) is the canonical
  helper: read `company.baseCurrencyCode` + `company.companyGroupId`, then select the
  `currency` row by `(code, companyGroupId)`. I.e. "the base currency" is a **group-scoped
  row selected by a company-scoped code**.
- `getBaseCurrencyDecimalPlaces(client, companyId, companyGroupId)`
  (`accounting.ee.service.ts:1917-1938`) — same two-step, returns settlement decimals for
  GL/fixed-asset rounding (falls back to 2).

### 2.2 Semantics of `currency.exchangeRate`

**`exchangeRate` = units of THIS (foreign) currency per 1 unit of the base currency**, and
the base currency's own row is expected to hold `exchangeRate = 1`. Evidence:

- The updater: `ExchangeRatesClient.convertExchangeRates(baseCurrencyCode, rates)`
  (`packages/ee/src/exchange-rates/exchange-rates.server.ts:68-91`) re-bases the EUR-based
  API rates so `converted[base] = 1` and `converted[X] = rates[X]/rates[base]` — foreign
  per base.
- Document math: `quoteLinePrice.convertedUnitPrice GENERATED ALWAYS AS ("unitPrice" *
  "exchangeRate")` (`20241010193506_quote-order-presentation-currency.sql:122-127`) —
  `unitPrice` is in base currency, multiply by the snapshot to get the presentation
  (customer/supplier) currency amount. Same for `salesOrderLine` (lines 148-150) and the
  purchasing equivalents.
- Inverse direction (foreign → base) is division: e.g. `translateTrialBalance`
  (`20260315000002:…`, `translatedBalance = localBalance / rate`), and the posting flows
  divide document-currency amounts by the document's snapshot `exchangeRate` to book base
  currency GL amounts (see §4).

So "the" rate is only meaningful **relative to a chosen base**. Because the row is
group-scoped, the whole group shares one normalization — whichever company's
`baseCurrencyCode` the rate updater used (§3) — and for a group whose companies have
different base currencies, every company except that one reads rates normalized to a base
that is not its own. The base-currency row for such a company will not even be 1.

### 2.2a The convention is pinned by UI copy, per viewer

`ExchangeRateForm.tsx:93-96` renders the helper text
`"One ${company.baseCurrencyCode} is equal to how many ${code}?"` and clamps the rate to 1
when `code === company.baseCurrencyCode` (:166-167) — but `company` here is the **viewing
user's** company (`useUser()`), while the row is group-shared. Two admins in different
companies of the same group see the same row described against two different bases, and
each sees a different code clamped to 1. Nothing server-side enforces the base row = 1
invariant at all.

### 2.3 One row per code per group

Yes — `currency_code_key UNIQUE ("code","companyGroupId")`
(`20260228023426_company-groups.sql:339`). There is no per-company row and no way to store
two normalizations for one group.

---

## 3. Writes — every insert/update of `currency`

There are exactly **six** write paths (five code + one migration backfill). No create-currency
UI exists (`path.to.newExchangeRate` is defined at `apps/erp/app/utils/path.ts:1484` but there
is no `exchange-rates.new.tsx` route); rows are created only by the seed paths.

| # | Path | Kind | Op | Scoping | Rate source |
|---|------|------|----|---------|-------------|
| 1 | `apps/erp/app/modules/accounting/accounting.ee.service.ts:3696-3720` `upsertCurrency` | shared service helper | insert (3712) / update (3714-3719) by `id` | `companyGroupId` in payload | caller |
| 2 | `apps/erp/app/routes/x+/accounting+/exchange-rates.$currencyId.tsx:43-81` (calls `upsertCurrency` at :59) | route action, `update: "accounting"` | UPDATE only (`if (!id) throw`, :57) | `companyGroupId` from `requirePermissions` (:45) | **user input** (`ExchangeRateForm`) |
| 3 | `packages/jobs/src/inngest/functions/scheduled/update-exchange-rates.ts:219-221` | Inngest cron `0 0 * * *`, service role | `.upsert(updates)` of full rows | reads `company.companyGroupId` (:171), selects all group rows (:177-180) | **external API** (EUR-base `exchangeratesapi.io`, `EXCHANGE_RATES_API_KEY`) |
| 4 | `packages/database/supabase/functions/seed-company/index.ts:335-338` | edge function, Kysely txn | insert — **only when `isNewGroup`** (:334, group resolution :83-123) | `companyGroupId` | **hardcoded 1** for all 118 codes (`functions/lib/seed.data.ts:484`) |
| 5 | `packages/database/src/datasets/bootstrap.ts:300-306` | dev seed / `db:check:datasets` (raw SQL) | insert | `companyGroupId` created in `seedCompanyReferenceData` (:130-134) | **hardcoded 1** |
| 6 | `packages/database/supabase/migrations/20260228023426_company-groups.sql:327-330` | one-time backfill | UPDATE set `companyGroupId` from `company` | — | n/a |

Details worth keeping in the refactor's head:

- **The daily job is where the group-vs-base contradiction becomes live data churn.**
  `updateExchangeRatesFunction` iterates active `companyIntegration` rows
  (`id = "exchange-rates-v1"`, :79-83), reads *that company's* `baseCurrencyCode` (:153),
  converts the EUR-based API rates to that base
  (`convertExchangeRates`, `packages/ee/src/exchange-rates/exchange-rates.server.ts:68-91`,
  cached per base :130-166), and then **upserts the whole group's rows** (:177-221). Two
  companies in one group, both with the integration active, different bases → the same
  group-shared rows are rewritten twice per night with two different normalizations;
  iteration order is the unordered `companyIntegration` select, so which base "wins" is
  arbitrary. With one integration-enabled company, the group's rows are stably normalized
  to that one company's base — and every *other* company in the group silently consumes
  rates relative to a base that may not be its own.
- The job overrides only `exchangeRate` (+`updatedAt`) — `historicalExchangeRate`,
  `decimalPlaces`, `active` are preserved (spread of the existing row, :197-206). Codes
  missing from the API response are filtered out (falsy rate, :206) and left stale.
- Seed rows are all `exchangeRate: 1` until a human edits them or the integration runs —
  so a fresh company's foreign-currency documents all snapshot rate 1.
- Subsidiaries joining an existing group get **no** currency seed (path 4 skipped) — they
  inherit the group's rows, normalized to whatever base the group already uses.
- `upsertCurrency`'s update branch passes through `sanitize()`; fields written from
  `currencyValidator` (`accounting.models.ts:416-424`): `code`, `decimalPlaces`,
  `exchangeRate`, `historicalExchangeRate`, `customFields`. The form's "base currency"
  behavior (`ExchangeRateForm.tsx:93,166-167` — clamps rate to 1 when
  `code === company.baseCurrencyCode`) is **client-side only**; nothing persists an
  `isBaseCurrency` flag (the column is gone) and nothing server-side enforces base rate = 1.

### 3.1 `exchangeRateHistory` — zero writers

Despite its own comment ("daily spot rates auto-populated by sync job",
`20260315000002_exchange-rate-history.sql:1-2`), **nothing writes this table** — not the
daily job (writes only `currency`), not a trigger, not a seed. Verified by grepping all
migrations and TS for inserts/updates. Its readers therefore always fall back:

- `translateTrialBalance` RPC (`20260315000002:117-141`, re-created in
  `20260713225803_ledger-balance-posted-filter.sql:204,212` and
  `20260811123614_widen-ledger-amounts.sql:288,296`) — closing/average rates
  `COALESCE(..., 1)`.
- `getExchangeRateHistory` (`accounting.ee.service.ts:4735-4750`) — feeds the (empty)
  history chart in `ExchangeRateForm` via `exchange-rates.$currencyId.tsx:32-34`.

---

## 4. Reads — every consumer

Note: the `currencies` VIEW is `currency ⋈ currencyCode` (§1.2), so every read of the view
is a read of the table. The overarching rule that fell out of the sweep:

> **Every document flow reads the live rate exactly once — at creation / currency change /
> explicit refresh — and stamps it onto the document. Posting, PDFs, EE sync, and list
> views all consume the snapshot.** The only always-live consumers at read time are the
> consolidation-rates RPC and the nightly rate-updater job itself.

### 4.1 Service helpers (`apps/erp/app/modules/accounting/accounting.ee.service.ts`)

| Fn | Line | Source | Scoping | Live/snapshot |
|---|---|---|---|---|
| `getBaseCurrency` | 1813 | table | `companyId` → (`baseCurrencyCode`, `companyGroupId`) → row by `(code, group)` | live |
| `getCurrency` | ~1901 | table (`*, currencyCode!inner(name)`) | by `id` only — **unscoped**, RLS is the only tenant filter | live |
| `getBaseCurrencyDecimalPlaces` | 1917 | view, `decimalPlaces` | `companyId` + `companyGroupId` args | decimals only |
| `getCurrencyByCode` | 1940 | view | `(code, companyGroupId)` | live |
| `getCurrencies` | 1953 | view | `companyGroupId` | live (admin list) |
| `getCurrenciesList` | 1982 | `currencyCode` ⟕ view (`code, decimalPlaces`) | view side by `companyGroupId` | decimals only |

### 4.2 `getCurrencyByCode` callers — the live-rate → snapshot stamping sites

All pass `companyGroupId` from `requirePermissions` (post-PR-#1525 pattern):

- **Quote**: `sales.service.ts:3519` (create), `:3651`, `:3732`, `:3828` (currency change /
  convert) → written to `quote.exchangeRate` at `:3525, :3657, :3738, :3834` (base → 1 at `:3742`).
- **Sales order**: `sales.service.ts:5327, 5441, 5600, 5660` → `salesOrder.exchangeRate`
  at `:5333, 5447, 5606, 5666` (base → 1 at `:5670`).
- **Purchase order / supplier quote**: `purchasing.service.ts:1508, 1609, 1696` (PO),
  `:2077, 2182, 2235, 2321` (supplier quote).
- **Invoices**: `invoicing.service.ts:568, 729` (purchase invoice), `:946, 1107` (sales invoice).
- **Route actions/loaders** (currency-change actions, "Update Exchange Rate" buttons,
  finalize, PDF preflight):
  `x+/quote+/update.tsx:70`, `x+/quote+/$quoteId.exchange-rate.tsx:39`,
  `x+/quote+/$quoteId.tsx:124`;
  `x+/purchase-order+/$orderId.exchange-rate.tsx:51`, `x+/purchase-order+/update.tsx:60,122`,
  `x+/purchase-order+/$orderId.tsx:282,508`, `x+/purchase-order+/$orderId.finalize.tsx:340`;
  `x+/purchase-invoice+/$invoiceId.tsx:79`, `x+/purchase-invoice+/$invoiceId.exchange-rate.tsx:51`,
  `x+/purchase-invoice+/update.tsx:56,137`;
  `x+/sales-order+/$orderId.exchange-rate.tsx:35`, `x+/sales-order+/update.tsx:49,77`;
  `x+/supplier-quote+/$id.tsx:63` (serviceRole), `x+/supplier-quote+/update.tsx:73`;
  `x+/sales-invoice+/$invoiceId.tsx:80`, `x+/sales-invoice+/update.tsx:55`;
  `modules/settings/documentPreview.server.ts:252` (quote PDF preview) and
  `modules/shared/shared.server.ts:289` (SO preview — reads the row for `decimalPlaces`,
  serviceRole).

### 4.3 Other helper callers

- `getBaseCurrency` → `x+/accounting+/_layout.tsx:42` (accounting module layout).
- `getCurrency` → `x+/accounting+/exchange-rates.$currencyId.tsx:31` (edit drawer).
- `getCurrencies` → `x+/accounting+/exchange-rates.tsx:29` (admin table).
- `getBaseCurrencyDecimalPlaces` → `x+/accounting+/depreciation-runs.new.tsx:115` and
  `x+/depreciation-run+/$depreciationRunId.repeat.tsx:151` (base-currency GL rounding
  scale for depreciation, consumed by `accounting.utils.ts:285,336,426,453,464,521`).
- `getCurrenciesList` → `api+/accounting.currencies.ts:12` — the endpoint behind
  `useCurrencies`.

### 4.4 Hooks / UI (decimals only — no hook reads `exchangeRate`)

- `apps/erp/app/hooks/useCurrencies.ts:27` `useCurrencies()` — fetches
  `api+/accounting.currencies.ts` (group-scoped `getCurrenciesList`); rows are
  `{code, name, decimalPlaces}` where `decimalPlaces` is the **group's** configured value
  (null when the group hasn't configured that code).
- `useCurrencyDecimalsLookup` (:50) / `useCurrencyDecimals` (:73) — `code → decimalPlaces`
  map, CLDR fallback; the settlement-scale source for money inputs/tables.
- `useCurrencyMinDecimals` (:90) — company settings, not the currency table.
- `apps/erp/app/hooks/useCurrencyFormatter.tsx:46,58` — digits via `useCurrencyDecimals`;
  base-currency default from route data `company.baseCurrencyCode` (a code string).
- `apps/erp/app/components/MotionMoney.tsx:10-51`, `components/Form/TaxFields.tsx:28-153` —
  take `decimalPlaces`/`currencyDecimals` props resolved upstream from the same map.
- `x+/purchasing+/planning.update.tsx:413` (decimals read from `currencies` view at
  `:177-182`, mapped `:237`) → `applyRate` settlement rounding.

### 4.5 Posting / edge functions (`packages/database/supabase/functions/`)

**No posting function reads the `currency` table — all consume document snapshots**
(their `companyGroupId` usage is for dimensions/accounts, not currency):

- `post-receipt/index.ts:625` — `purchaseOrder.exchangeRate` snapshot.
- `post-shipment/index.ts` — no currency read.
- `post-purchase-invoice/index.ts:566,842` — `purchaseInvoice.exchangeRate` snapshot.
- `post-sales-invoice/index.ts:317` — `salesInvoice.exchangeRate` snapshot.
- `post-payment/index.ts:230,296,407,716` — `payment.exchangeRate` + applied documents'
  snapshot rates (:681,690).
- `post-memo/index.ts:207,268` — `memo.exchangeRate` snapshot.
- `get-method/index.ts:6875,6962` — copies the source quote's snapshot.

**Edge functions that DO read the live table (to stamp a new document):**

- `convert/index.ts:1084` — RFQ→quote: `currency` by `(code, companyGroupId)` (group from
  `company` row); throws for a foreign currency with no configured rate rather than
  quoting at par (:1089-1095).
- `create/index.ts:541` — outside-operation → PO: `currency` by `(code, companyGroupId)`
  per supplier currency (group resolved at :531); `exchangeRate ?? 1`.

### 4.6 SQL / RPC live reads

- `getConsolidationRates` (`20260713225803_ledger-balance-posted-filter.sql:219-222`,
  re-defined `20260811123614_widen-ledger-amounts.sql:303-306`) — reads
  `currency.historicalExchangeRate` by `(code, companyGroupId)`; called from
  `translateCompanyBalances` (`accounting.ee.service.ts:4296`) → consolidation reports
  (`x+/reports+/balance-sheet.tsx:167`, `income-statement.tsx:142`, `executive-pnl.tsx:143`).
  **Live, group-scoped, at report time.**
- `translateTrialBalance` (§1.5) — live `currency.historicalExchangeRate` +
  (empty) `exchangeRateHistory`.

### 4.7 `packages/ee` accounting sync (Xero / QBO / Rillet)

**No EE provider reads the `currency` table.** They use document `currencyCode` strings +
snapshot rates:

- `packages/ee/src/accounting/core/payment-syncer.ts:525,686,715`,
  `core/payment-application.ts:35,256,284,322` — `payment.exchangeRate` snapshot.
- `core/document-costing.ts:62` — base→transaction conversion using the passed document rate.
- Rillet `providers/rillet/entities/shared.ts:210-221` `loadCompanyBaseCurrency` — reads
  `company.baseCurrencyCode` (per company, correct), not the table.
- Xero `provider.ts:338` — currencies from the Xero org API.

### 4.8 `packages/documents` (PDFs)

PDFs never read the table — `exchangeRate` and `currencyDecimals` arrive as props from
loaders (`QuotePDF.tsx:20,38,45,56,64,110,118,134,188`; `SalesOrderPDF.tsx:39,56,62,65`;
`PurchaseOrderPDF.tsx:39,55,62,65`; `SalesInvoicePDF.tsx:38,57,63,66`;
`blocks/SummaryBlock.tsx:89`, `blocks/quote/LineItemsBlock.tsx:40,120,128,225`,
`utils/sales-invoice.ts:86`). The table read happens upstream (e.g.
`shared.server.ts:289`).

### 4.9 `packages/jobs`

- `inngest/functions/integrations/paperless-parts.ts:808-820` — **local duplicate**
  `getCurrencyByCode` reading `currency.exchangeRate` by `(companyGroupId, code)`; stamps
  imported `quote.exchangeRate` at `:327`. Live read → snapshot.
- `inngest/functions/scheduled/update-exchange-rates.ts:177-180` — the writer's own
  read-modify-write (§3).
- `backups/scope.test.ts:278` — pins `currency` as `companyGroupId`-scoped for backup export.

### 4.10 MES / academy / starter

**Zero currency-table reads** in `apps/mes`, `apps/academy`, `apps/starter` (no
`from("currency")`, `getCurrencyByCode`, `getBaseCurrency`, `useCurrencies`).

### 4.11 Views

Only the `currencies` view joins the table. The document list views (`quotes`,
`salesOrders`, `purchaseOrders`, `purchaseInvoices`, `salesInvoices`, `supplierQuotes`)
surface their **own snapshot columns**, never a live currency join.

---

## 5. Document snapshot `exchangeRate` columns

Every document header snapshot means "**document-currency units per 1 base-currency
unit**"; line-level `converted*` amounts are STORED generated columns multiplying by it.
`exchangeRateUpdatedAt` exists only on the six document **headers**.

| Table | Columns | Added by | Set on create / currency change | Explicit refresh | Header→line propagation |
|---|---|---|---|---|---|
| `quote` | `currencyCode`, `exchangeRate`, `exchangeRateUpdatedAt` | `20241010193506:3-4` | `upsertQuote` `sales.service.ts:3516-3549`; `updateQuote` `:3635-3674`, convert `:3731-3743, 3819-3835` | `updateQuoteExchangeRate` `sales.service.ts:3215-3228`; route `x+/quote+/$quoteId.exchange-rate.tsx:47`; MCP `sales_updateQuoteExchangeRate` | interceptor `sync_update_quote_exchange_rate` `20260410031804_exchange-rate-interceptors.sql:17-36` |
| `quoteLinePrice` | `exchangeRate` (default 1) + generated `convertedUnitPrice/NetUnitPrice/NetExtendedPrice` (`20241010193506:122-127`), `convertedShippingCost` (`20241105002325:30`) | `20241010193506:122` | seeded from quote at `sales.service.ts:4045` | — | via quote interceptor |
| `salesOrder` | `currencyCode`, `exchangeRate`, `exchangeRateUpdatedAt` | `20241010193506:35-36` | `upsertSalesOrder` `sales.service.ts:5314-5359`; update `:5425-5464, 5591-5607, 5659-5671` | `updateSalesOrderExchangeRate` `:3257-3270`; route `x+/sales-order+/$orderId.exchange-rate.tsx:43`; MCP | interceptor `sync_update_sales_order_exchange_rate` `20260410031804:38-57` |
| `salesOrderLine` | `exchangeRate` (default 1) + generated `convertedUnitPrice/AddOnCost` (`20241010193506:149-150`), `convertedShippingCost/NonTaxableAddOnCost` (`20260321120000:5`, `20260811123619:35-38`) | `20241010193506:148` | line seed `sales.service.ts:5826` | — | via SO interceptor |
| `purchaseOrder` | `currencyCode`, `exchangeRate`, `exchangeRateUpdatedAt` | orig. `20230924004608:303`; re-added `20241010193506:75-76` | `upsertPurchaseOrder` `purchasing.service.ts:1505-1538`; update `:1606-1625, 1695-1707`; copy-from-source `:149,167` | `updatePurchaseOrderExchangeRate` `:1166-1178`; route `x+/purchase-order+/$orderId.exchange-rate.tsx:59`; MCP | trigger `update_purchase_order_line_price_exchange_rate` (fn `20241210214820:131`, re-created `20260811123616:533-534`) |
| `purchaseOrderLine` | `exchangeRate` + generated `convertedUnitPrice/ShippingCost/AddOnCost` (`20250109000722:33-35`) | `20230924004608` era | via header trigger | — | (is the target) |
| `supplierQuote` | `currencyCode`, `exchangeRate`, `exchangeRateUpdatedAt` | `20241202192419:43` | `upsertSupplierQuote` `purchasing.service.ts:2074-2109`; update `:2166-2198, 2234-2246, 2305-2328` | `updateSupplierQuoteExchangeRate` `:1345-1357`; route `x+/supplier-quote+/$id.exchange-rate.tsx:47`; MCP | trigger `update_supplier_quote_line_price_exchange_rate` (fn `20241202192419:214`, re-created `20260811123616:545-546`) |
| `supplierQuoteLinePrice` | `exchangeRate` (default 1) + generated `unitPrice/extendedPrice/shippingCost` = supplier* × rate (`20241202192419:110-114`), `taxAmount` (`20241210214820:424`) | `20241202192419:109` | | | via trigger |
| `purchaseInvoice` | `exchangeRate` NOT NULL default 1, `exchangeRateUpdatedAt` | `20230924004608:24`; updatedAt `20241210214820:289` | `upsertPurchaseInvoice` `invoicing.service.ts:563-594, 728-756` | `updatePurchaseInvoiceExchangeRate` `:407-419`; route `x+/purchase-invoice+/$invoiceId.exchange-rate.tsx:59`; MCP | trigger fn `20241210214820:325`, **typo-fixed** `20260616061244_fix_purchase_invoice_line_trigger_exchange_rate_typo.sql:2-13`; + BEFORE INSERT inherit trigger `sync_purchase_invoice_line_exchange_rate_on_insert` (`20260616061244:27-43`); re-created `20260811123616:539-540` |
| `purchaseInvoiceLine` | `exchangeRate` (`20230924004608:144`) + converted generated cols (widened `20250109034107:18-23`) | | | | via triggers |
| `salesInvoice` | `currencyCode`, `exchangeRate` NOT NULL default 1, `exchangeRateUpdatedAt` | `20250507143421:40,46-47` | `upsertSalesInvoice` `invoicing.service.ts:941-972, 1106-1133` | `updateSalesInvoiceExchangeRate` `:452-464`; route `x+/sales-invoice+/$invoiceId.exchange-rate.tsx:56`; MCP | **NONE** — no trigger and no interceptor; lines get their rate only at service insert. Asymmetric with every other document. |
| `salesInvoiceLine` | `exchangeRate` (`20250507143421:146`) + generated `convertedUnitPrice/AddOnCost/ShippingCost/SetupPrice` (`:152-155`) | | | | (no propagation) |
| `payment` | `currencyCode`, `exchangeRate` NOT NULL default 1 CHECK > 0 | `20260630093809_ar-ap-payments.sql:203-204,232` | set at draft | none | n/a |
| `memo` | `currencyCode`, `exchangeRate` NOT NULL default 1 CHECK > 0 | `20260630093809:319-320,343` | set at draft | none | n/a |
| `invoiceSettlement` | `sourceExchangeRate`, `targetExchangeRate` (CHECK > 0) + generated `fxGainLossAmount = appliedAmount * (source - target)` STORED | `20260630093809:427-436,467-468` | captured at apply time from the payment/memo (source) and invoice (target) rows — `invoicing.service.ts:2378-2379, 1481-1482, 1649-1670`; never refreshed | — | n/a — the realized-FX primitive |

Tables **verified to carry no** rate/currency snapshot: `job`, `jobMaterial`,
`jobOperation`, `itemCost`, `receipt`, `shipment`, `salesRfq`, `purchaseOrderDelivery`
(receipts/shipments inherit currency context from their parent document; production
costing is base-currency via `itemCost`/cost ledger).

Related master data: `account.consolidatedRate` enum (Current/Average/Historical,
`20260315000002:62-71`) selects which rate class `translateTrialBalance` applies per
account.

---

## 6. Group-vs-company mismatch sites

### 6.1 The fixed precedent — PR #1525 (merge `01c43cfd4b`)

`fix(accounting): resolve quote currency by company group, not dropped companyId` —
one file, `packages/database/supabase/functions/convert/index.ts`. The RFQ→quote path was
still filtering `from("currency").eq("companyId", companyId)` **after**
`20260228023426` dropped that column. PostgREST errored, `currency.data` was undefined,
and `?? 1` silently quoted every foreign-currency customer at par. The fix: filter by
`company.data.companyGroupId`, and throw on a missing rate unless the code IS the
company's base (where 1 is correct by definition).

Two failure classes to grep for in future work:
1. **Stale scope column** — `from("currency")` + `.eq("companyId", …)`: swept the repo;
   **no remaining instances** (only `convert` had it).
2. **Silent par fallback** — `?? 1` after a currency read that can fail. Still present at
   `packages/database/supabase/functions/create/index.ts:541` (outside-op → PO stamps
   `exchangeRate ?? 1` without #1525's refuse-on-missing guard) and in the service-layer
   creation flows (`sales.service.ts`, `purchasing.service.ts`, `invoicing.service.ts` —
   `currency.data?.exchangeRate ?? 1` variants).

### 6.2 The live mismatch: the nightly rate updater (worst site)

`packages/jobs/src/inngest/functions/scheduled/update-exchange-rates.ts` (§3) — rates are
normalized to **each integration-enabled company's** `baseCurrencyCode` (:153,:161-165)
but written to the **group's** shared rows (:177-221). One group, two companies, two
bases, both enabled → the group's rows are overwritten twice nightly with incompatible
normalizations, in the arbitrary order of the `companyIntegration` select. Every snapshot
stamped from those rows (§4.2) inherits whichever normalization was live at that moment.
The structural root: `companyIntegration` is **company**-scoped while `currency` is
**group**-scoped — the integration loop and the rows it writes disagree on tenancy grain.

**A fix already exists but is NOT on this branch**: commit `b4d30d3ca3`
(`fix(jobs): rebase exchange rates once per company group, not once per company`), on
`origin/fix/exchange-rate-job-group-scoping` only. It groups the integrations by
`companyGroupId`, rebases once per group, and **refuses with an error naming the group
and the conflicting codes when member companies disagree on base currency** — plus two
smaller fixes (warn on feed-omitted codes that silently keep stale rates; set
`updatedBy` on the upsert). Its commit message states the design premise the refactor
must confirm or replace: "Nothing in the schema records a group-level base currency, and
`getBaseCurrency` resolves a company's base against the group's shared rows, so the model
already assumes one base per group."

### 6.3 How multi-company groups arise (i.e., when this stops being theoretical)

- Group creation: `seed-company` edge function
  (`packages/database/supabase/functions/seed-company/index.ts:82-121`) — a root company
  creates its own `companyGroup`; a company created with `parentCompanyId` **joins the
  parent's group** (:87-97). Subsidiary creation route:
  `apps/erp/app/routes/x+/settings+/companies.new.tsx:83`.
- Nothing constrains a subsidiary's `baseCurrencyCode` to match the parent's — the whole
  point of the consolidation feature (`translateTrialBalance`,
  `translateCompanyBalances`) is that they can differ. So "companies in a group with
  different bases" is a **supported product configuration** whose currency rates are
  structurally under-specified.

### 6.4 Per-company semantics leaking through group-shared rows

- `ExchangeRateForm` (§2.2a) — helper text and the rate=1 clamp are computed from the
  *viewer's* `company.baseCurrencyCode` against a group-shared row
  (`ExchangeRateForm.tsx:93-96,166-167`). No server-side invariant.
- `getBaseCurrency(client, companyId)` (`accounting.ee.service.ts:1813`) — resolves the
  company's base code to the group row; for a company whose base differs from the group's
  normalization base, that row's `exchangeRate` is not 1 and nothing flags it.
- Creation flows force `exchangeRate = 1` when the document currency equals the
  *company's* base (`sales.service.ts:3742, 5670` etc.) — correct per company — but take
  the group rate verbatim for any foreign currency, which is only correct when the group's
  normalization base == this company's base.
- `translateCompanyBalances` / `getConsolidationRates`
  (`accounting.ee.service.ts:4267-4340`; RPC first defined
  `20260713225803_ledger-balance-posted-filter.sql:179-233`, newest
  `20260811123614:303-306`) — rates are looked up by
  `(sourceCurrency = company base, companyGroupId)` only; `targetCurrency` participates
  in nothing but the `sameCurrency → 1` short-circuit (:4318-4331). The stored rate is
  implicitly "target per source" for exactly one target — whichever base the group's rates
  were normalized to. Translating to any other `targetCurrency` silently applies a rate
  for the wrong pair.
- **The root company's base is the de-facto group base — by caller convention only.** All
  four consolidated reports compute `targetCurrency` as the ROOT company's
  `baseCurrencyCode` (`companiesList.find(c => !c.parentCompanyId)`):
  `x+/reports+/trial-balance.tsx:69-70,89-93`, `income-statement.tsx:74-75,102-106`,
  `balance-sheet.tsx:95-96,123-127`, `executive-pnl.tsx:75-76,103-107`. Nothing persists
  or validates this convention — the schema has no group-level base currency column, and
  the nightly job (§6.2) doesn't honor it either (it rebases to whichever *member* has
  the integration).
- **Intercompany defers conversion to consolidation.** `intercompanyTransaction` stores
  the source company's base as its `currencyCode`
  (`modules/accounting/ui/Intercompany/IntercompanyTransactionForm.tsx:157-166`);
  `createIntercompanyTransaction` (`accounting.ee.service.ts:4596-4688`) posts
  source-company journal lines with no cross-base conversion at capture. Correctness of
  the eventual elimination therefore rests entirely on the group-scoped rates above.
- A subsidiary picks its own base at creation
  (`modules/settings/ui/Companies/SubsidiaryCompanyForm.tsx:45`) — nothing warns that the
  group's shared rates will not be normalized to it.
- RLS nuance for API keys: the legacy API-key ALL policy on `currency`
  (`20240821150639_api-key-all-tables.sql:56-59`) was dropped in
  `20250201181148_rls-refactor.sql:1175`. Post-groups, API-key SELECT works through
  `get_company_groups_for_employee()` (honors the key's company,
  `20260228023426:77-85`), but API-key **writes** to group-scoped tables are impossible —
  `get_company_groups_for_root_permission` ignores the API-key path.

### 6.5 Adjacent inconsistencies the refactor should sweep up

- `translateTrialBalance` multiplies where the `exchangeRate` convention implies dividing
  (§1.5) — the direction of `historicalExchangeRate` / `exchangeRateHistory.rate` is
  undefined because no producer exists and the form never states it.
- `exchangeRateHistory` has **no writers** (§3.1) — closing/average consolidation rates
  are always the `COALESCE(..., 1)` fallback today.
- `salesInvoice` lacks the header→line rate propagation every sibling document has (§5).
- The form helper text "Leave blank to use the current exchange rate"
  (`ExchangeRateForm.tsx:180`) does not match the RPC fallback (historical → closing →
  1, never `currency.exchangeRate`).
- `getCurrency(client, currencyId)` (`accounting.ee.service.ts:~1901`) reads by bare `id`
  with RLS as the only tenant guard — fine today, but any move of currency back to
  company scope must revisit the RLS-only assumption (group SELECT policy exposes rows to
  every member company's employees).

---

## 7. Structural observations for the refactor

1. **The blast radius of changing `currency`'s scope is small and choke-pointed; the
   blast radius of changing `exchangeRate`'s *meaning* is large.** Only ~6 write paths
   and ~6 service helpers touch the table, and effectively every document flow funnels
   through `getCurrencyByCode`/`getBaseCurrency` (§4.1-4.2) plus two edge functions
   (`convert`, `create`) and one jobs-package duplicate (`paperless-parts.ts:808`).
   Re-scoping the table means touching those. But the *snapshot* columns (§5) already
   insulate posting, PDFs, EE sync, and views from the table — historical documents keep
   working whatever happens to the master rows. The refactor's semantic risk concentrates
   in: the stamping sites, the nightly job, and consolidation.

2. **The missing concept is "base of normalization".** Every rate in the system is
   relative to *some* base, but that base is recorded nowhere: not on `currency` (no
   `isBaseCurrency` since `20240930183906`), not on `companyGroup` (no base column), only
   implicitly in (a) whichever company's base the nightly job last used, (b) the root
   company's base assumed by the report callers, and (c) the viewer's base shown by the
   form. Options are: per-company currency rows (revert of `20260228023426`'s Part 4c),
   a persisted `companyGroup.baseCurrencyCode` with a one-base-per-group invariant
   (the direction `b4d30d3ca3` leans), or base-agnostic pair/history storage. Whichever
   is chosen, `unique("code", scope)` and the RLS policies move with it.

3. **Decimals and rates want different scopes.** `decimalPlaces` is a property of a
   currency (JPY has 0 everywhere) and is consumed far more widely than the rate
   (`useCurrencies` → every money input; `getBaseCurrencyDecimalPlaces` → GL rounding) —
   group-sharing it is harmless. `exchangeRate` is a property of a currency *pair* and is
   what breaks at group scope. A refactor can split them rather than move both.

4. **Three latent defects should ride along**: (a) `exchangeRateHistory` has no writer
   (§3.1) while consolidation already reads it — the nightly job is the natural producer;
   (b) the multiply-vs-divide direction contradiction between `currency.exchangeRate`
   ("foreign per base", form text `ExchangeRateForm.tsx:96`) and `translateTrialBalance`
   / `translateCompanyBalances` (`balance * rate`) must be pinned when history gains a
   producer; (c) the `?? 1` par-fallbacks in `create/index.ts:541` and the service
   creation flows lack #1525's refuse-on-missing guard.

5. **Merge order matters**: `origin/fix/exchange-rate-job-group-scoping` (`b4d30d3ca3`)
   hard-codes the "one base per group, refuse on disagreement" stance into the nightly
   job. If the refactor instead legitimizes per-company bases within a group, that fix
   is the first thing it must supersede — land one or the other, not both silently.

6. **`currency` is one of only six group-scoped base tables** (`account`, `currency`,
   `dimension`, `dimensionValue`, `exchangeRateHistory`, `intercompanyTransaction`) and
   the backup scoping map pins it (`packages/jobs/src/backups/scope.test.ts:278`).
   Re-scoping touches: RLS helpers (§1.3), the seed paths (§3 #4-5), backup/restore
   scoping, and the `currencies` view — plus `pnpm db:check:backups` /
   `db:check:datasets` will both exercise it pre-commit.

---

## Appendix: verification notes

- Branch at research time: `currency-exchange-rate-refactor` (worktree `hat-yai`),
  HEAD `ed0bdebd95`. PR #1525's merge (`01c43cfd4b`) **is** an ancestor;
  `b4d30d3ca3` is **not** (verified `git merge-base --is-ancestor`).
- Generated types read directly at `packages/database/src/types.ts:8899-8996` — the
  `currency` Row has NO `name`/`symbol`/`isBaseCurrency`/`companyId`.
- Stale-filter sweep (`from("currency")`/`from("currencies")` near `.eq("companyId"`)
  returned zero hits; no Kysely `selectFrom/updateTable("currency")` outside
  `seed-company` and `bootstrap.ts`.
- Findings compiled with four parallel sub-investigations (writes, reads, snapshots,
  mismatches); every line number above spot-checked or taken from direct file reads of
  the load-bearing sites (`update-exchange-rates.ts`, `convert` diff,
  `translateTrialBalance` newest version, `ExchangeRateForm`, `seed-company`,
  `accounting.ee.service.ts` helpers).
