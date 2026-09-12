# How exchange rates get updated today (the integration path to eliminate)

Researched 2026-09-02 on branch `currency-exchange-rate-refactor` (base = main @ `ed0bdebd95`).
All paths absolute under `/Users/barbinbrad/conductor/workspaces/carbon/hat-yai/`.

**Important branch caveat:** two open PRs touch exactly this area and are NOT in this
tree — #1542 `fix(jobs): rebase exchange rates once per company group, not once per
company` (commit `b4d30d3ca3`, branch `origin/fix/exchange-rate-job-group-scoping`) and
#1530 `fix(accounting): take the refresh rate from the document, not the request`
(commit `f8e3a386dd`, branch `origin/fix/exchange-rate-refresh-document-currency`).
Several sibling commits on those branches (`aec17de6ba`, `02a7ce60f0`, `4931842606`,
`deee8198af`, `1f3d0bb0e5`, `0328146b0c` — which add a `resolveCurrencyAndRate`
resolver) are likewise unmerged. Everything below describes the tree as it stands,
with the pending changes flagged inline.

---

## 1. The integration

- **Definition**: `packages/ee/src/exchange-rates/config.tsx:6-19` —
  `defineIntegration({ name: "Exchange Rates", id: "exchange-rates-v1", active: true,
  category: "Accounting", settings: [], schema: z.object({}) })`. **Zero settings, empty
  schema** — there is nothing to configure per company; installing it is a pure on/off
  toggle. (`defineIntegration` itself: `packages/ee/src/fns.ts:46+`.)
- **Registry**: imported and included in the `integrations` array at
  `packages/ee/src/index.ts:2` and `:35`.
- **Plan gating**: `packages/ee/src/plan.ts:29-33` — `INTEGRATION_WHITELIST` contains
  `"exchange-rates-v1"` (alongside `"email"`), so it bypasses the `INTEGRATIONS`
  Business/Partner plan gate and is available on every plan. I.e. it is already
  "free"; the only friction is that a user must find and install it.
- **API key is platform-level, not per-company**: `packages/env/src/index.ts:172` —
  `EXCHANGE_RATES_API_KEY` is a single global env var (listed under optional
  integration vars in `.claude/rules/environment-configuration.md`). Companies never
  supply a key.
- **Install path**: Settings → Integrations →
  `apps/erp/app/routes/x+/settings+/integrations.$id.tsx` action →
  `upsertCompanyIntegration` in
  `apps/erp/app/modules/settings/settings.server.ts:293-314`: upserts one
  **`companyIntegration`** row `{ id: "exchange-rates-v1", companyId, active: true,
  metadata: {} }` with `onConflict: "id,companyId"`. Table:
  `packages/database/supabase/migrations/20240119095150_integrations.sql:26-34`
  (PK `("id","companyId")` — **company-scoped**, which matters in §2).
- **No lifecycle hooks**: `packages/ee/src/hooks.server.ts` registers hooks for
  email/jira/linear/onshape/quickbooks/etc. — nothing for exchange-rates. Enabling it
  creates **no `eventSystemSubscription`**, no vault secret, nothing but the
  `companyIntegration` row. The nightly job simply looks for that row.

## 2. The updater job

`packages/jobs/src/inngest/functions/scheduled/update-exchange-rates.ts`
(`updateExchangeRatesFunction`, registered via
`packages/jobs/src/inngest/functions/scheduled/index.ts` → `packages/jobs/src/inngest/index.ts`).

- **Schedule**: Inngest cron `"0 0 * * *"` (daily, midnight UTC), `retries: 2`
  (update-exchange-rates.ts:73-74).
- **Gate**: selects `companyIntegration` rows with `id = "exchange-rates-v1"` and
  `active = true` (:79-83). **Zero rows → the job exits without fetching anything**
  (:92-95). This is the "rates require an integration" behavior to eliminate.
- **Source API**: `getExchangeRatesClient(EXCHANGE_RATES_API_KEY)` (:102-104) from
  `packages/ee/src/exchange-rates/exchange-rates.server.ts:94-104` — default URL
  `https://api.exchangeratesapi.io/v1/latest` (apilayer's exchangeratesapi.io).
  Free tier is **EUR-base only** (comment at exchange-rates.server.ts:47-50), so the
  job fetches EUR rates once and rebases to each company's base currency by division
  (`convertExchangeRates`, exchange-rates.server.ts:68-91), caching per base
  currency (:129-132, :154-166).
- **What it writes**: for each company with the integration, it loads the company's
  `baseCurrencyCode` (:139-153), then **full-row upserts every `currency` row for
  the company's `companyGroupId`** with `exchangeRate: round(rate)` (internal
  SCALE=5 rounding, comment :200-203) and `updatedAt` (:168, :197-221). Rows whose
  feed rate is missing or rounds to 0 are filtered out and left untouched (:206) —
  silently stale. No `updatedBy` is set. **It does NOT write `exchangeRateHistory`**
  (see §6 — nothing does).
- **The group-scoping bug (pending PR #1542)**: `currency` rows are **group**-scoped
  (§5) but the loop iterates per-**company** integration, so a multi-company group is
  rewritten once per member, and members with different base currencies overwrite
  each other — last writer wins for the whole group. The PR version (read via
  `git show b4d30d3ca3:...update-exchange-rates.ts`) buckets companies by
  `companyGroupId`, refuses groups with mixed base currencies, rebases and writes
  once per group, logs the currencies the feed omitted, and sets
  `updatedBy: "system"`.
- **With no integration**: rates stay at whatever they were — the seeded `1` (§5) or
  the last manual edit. There is no staleness indicator anywhere except the
  per-document `exchangeRateUpdatedAt` timestamp.
- There is **no edge function** for rate updates; this Inngest job is the only writer
  of feed rates. (`grep exchange packages/database/supabase/functions` only hits
  document-level `exchangeRate` usage in `create`/`post-purchase-invoice`.)

## 3. Manual updates

Yes — fully supported, and it is the same column the job overwrites.

- **Routes**: `/x/accounting/exchange-rates` list —
  `apps/erp/app/routes/x+/accounting+/exchange-rates.tsx:17-36` (loader:
  `getCurrencies(client, companyGroupId, …)`, permission `view: "accounting"`).
  Edit drawer `/x/accounting/exchange-rates/:currencyId` —
  `apps/erp/app/routes/x+/accounting+/exchange-rates.$currencyId.tsx:43-81` (action:
  `update: "accounting"` → `upsertCurrency`).
- **Service**: `upsertCurrency` —
  `apps/erp/app/modules/accounting/accounting.ee.service.ts:3696-3725` (plain
  update of the `currency` row: `exchangeRate`, `historicalExchangeRate`,
  `decimalPlaces`, `customFields`, `updatedBy`).
- **Form**: `apps/erp/app/modules/accounting/ui/ExchangeRates/ExchangeRateForm.tsx` —
  editable `exchangeRate` NumberField (:162-171; base currency pinned to 1 via
  min/max, :166-167), `historicalExchangeRate` for IAS 21 equity translation
  (:172-182), plus a history chart/table/CSV fed by `exchangeRateHistory` (:187-298)
  — which is empty in practice (§6).
- **Table**: `ExchangeRatesTable.tsx` shows name/code/exchangeRate with an "Edit
  Currency" context item only — **no "New" button**; the currency list is fixed at
  seed time (§5). (`path.to.newExchangeRate` exists at
  `apps/erp/app/utils/path.ts:1484` and `ExchangeRateForm.tsx:142` references it, but
  there is no `exchange-rates.new.tsx` route — the create path is dead code.)
- **Sidebar**: always visible under Accounting —
  `apps/erp/app/modules/accounting/ui/useAccountingSubmodules.tsx:127`. Also an
  onboarding "get started" checklist item
  (`packages/onboarding/src/content/setup.ts:82-87`).
- **Clobbering**: yes. The nightly job upserts every group currency row it has a feed
  rate for (§2), so a manual edit to a feed-covered currency survives **at most until
  the next midnight UTC** while any company in the group has the integration active.
  There is no per-row "manual override / don't auto-update" flag on `currency`.
  Conversely `historicalExchangeRate` is never touched by the job — manual-only.
- **Rate history** shown in the form comes from `getExchangeRateHistory`
  (`accounting.ee.service.ts:4735-4750`, last 6 months by `companyGroupId` +
  `currencyCode`) — but see §6: no writer exists.

## 4. On-demand refresh on documents

Six sibling routes, one per FX-bearing document (all present in tree):

- `apps/erp/app/routes/x+/quote+/$quoteId.exchange-rate.tsx`
- `apps/erp/app/routes/x+/sales-order+/$orderId.exchange-rate.tsx`
- `apps/erp/app/routes/x+/purchase-order+/$orderId.exchange-rate.tsx`
- `apps/erp/app/routes/x+/purchase-invoice+/$invoiceId.exchange-rate.tsx`
- `apps/erp/app/routes/x+/sales-invoice+/$invoiceId.exchange-rate.tsx`
- `apps/erp/app/routes/x+/supplier-quote+/$id.exchange-rate.tsx`

Behavior (read from the PO route, representative): POSTed `currencyCode` from the
form → `getCurrencyByCode(client, companyGroupId, currencyCode)`
(`accounting.ee.service.ts:3735+` — reads the **live `currency` table**, no API
call) → writes only `exchangeRate` onto the document via
`update<Doc>ExchangeRate`. The refresh is therefore only as fresh as the shared
table — with no integration it re-stamps the seeded/manual value.

- **UI**: refresh button in each document's Properties panel, e.g.
  `apps/erp/app/modules/sales/ui/Quotes/QuoteProperties.tsx:430-450` (posts the
  document's own `currencyCode` to `path.to.quoteExchangeRate`), with the
  `exchangeRateUpdatedAt` timestamp shown via tooltip (:420-428). Same pattern in
  `SalesOrderProperties`, `PurchaseOrderProperties`, `SupplierQuoteProperties`,
  `PurchaseInvoiceProperties`, `SalesInvoiceProperties`.
- **Pending PR #1530**: because the routes trust the posted `currencyCode`, a crafted
  POST can stamp another currency's rate onto a document that keeps its own code. The
  PR reads the code from the loaded document and stops parsing the form, and routes
  the lookup through the (also-unmerged) `resolveCurrencyAndRate` so a refresh can't
  install a missing/unusable rate.
- **Where documents get their initial rate**: at creation the service resolves it from
  the currency table with a fallback to 1 — e.g. quote insert at
  `apps/erp/app/modules/sales/sales.service.ts:3516-3529` (`exchangeRate =
  currency.data.exchangeRate ?? 1`, `exchangeRateUpdatedAt = now`). When the
  currency is changed via Properties bulk-update, e.g.
  `apps/erp/app/routes/x+/quote+/update.tsx:69-86`: writes code + rate together when
  the lookup succeeds, but **falls through to the generic setter and writes the code
  with no rate when the lookup fails** (deliberate `// don't break` comment :86-87)
  — fixed by unmerged `aec17de6ba`.
- **Line cascade**: `packages/database/supabase/migrations/20241010193506_quote-order-presentation-currency.sql:122-144`
  — `quoteLinePrice.exchangeRate` mirrors the header via an AFTER UPDATE trigger, and
  `convertedUnitPrice`/`convertedNetExtendedPrice` etc. are GENERATED columns
  multiplying by it. Sales invoices cascade similarly (unmerged `080573aca2` touches
  this area too).

## 5. Defaults — new company, no integration

- **`currency` table**: created in
  `packages/database/supabase/migrations/20230330024715_accounts.sql:6` with
  `"exchangeRate" NUMERIC(20,8) NOT NULL DEFAULT 1` and `CHECK ("exchangeRate" > 0)`
  (:20). **Group-scoped since**
  `20260228023426_company-groups.sql:325-341` (`companyId` dropped, `companyGroupId`
  NOT NULL, `UNIQUE ("code","companyGroupId")`). Read through the `currencies` view
  (currency ⋈ currencyCode for the display name; latest definition
  `20260228023426_company-groups.sql:924-928`).
- **Seeding**: the `seed-company` edge function inserts, **for a new company group
  only**, all 118 ISO currencies from
  `packages/database/supabase/functions/lib/seed.data.ts:483-…` — every row
  `exchangeRate: 1` (`seed-company/index.ts:333-338`). Subsidiaries joining an
  existing group reuse the group's rows. Dev/demo datasets likewise assume rate 1
  (`packages/database/src/datasets/bootstrap.ts:300-305` inserts the same list;
  document tiers hardcode `exchangeRate: 1`, e.g. `datasets/tiers/04-sales.ts:20`,
  `05-purchasing.ts:192,246,321`).
- **So the out-of-box state is: every currency exists, every rate is 1.** A brand-new
  company that quotes in EUR against a USD base silently prices at parity until
  someone installs the integration or hand-edits the rate.
- **Missing-rate fallback is `?? 1` everywhere** (~25+ sites):
  `apps/erp/app/modules/sales/sales.service.ts:3525, 3657, 4045, 4425, 4549, 4638,
  5333, 5447, 5826`; `apps/erp/app/modules/purchasing/purchasing.service.ts:1514,
  1615, 2083, 2188`; UI e.g. `QuoteSummary.tsx:258,760,788,843`,
  `QuoteLinePricing.tsx:514,1320,1345`, `SalesOrderSummary.tsx:130`,
  `QuoteToOrderDrawer.tsx:424`; sync core
  `packages/ee/src/accounting/core/document-costing.ts:90`
  (`Number(invoice?.exchangeRate) || 1`); and in SQL,
  `translateTrialBalance` COALESCEs all three rate kinds to 1
  (`20260315000002_exchange-rate-history.sql:139-141`). The unmerged branch commits
  (`aec17de6ba`, `4931842606`) exist precisely because this fallback family kept
  writing rate-1 documents.

## 6. Other places rates enter or leave the system

- **Xero sync (per-document, both directions)** — the only provider carrying explicit
  rates. Outbound: `packages/ee/src/accounting/providers/xero/entities/invoice.ts:451`
  pushes `CurrencyRate: local.exchangeRate !== 1 ? local.exchangeRate : undefined`
  (serialization contract `xeroCurrencyRate`,
  `packages/ee/src/accounting/providers/xero/serialize.ts:25`). Inbound: remote
  documents map `exchangeRate: remote.CurrencyRate ?? 1` —
  `entities/invoice.ts:489`, `entities/payment.ts:224`,
  `entities/purchase-order.ts:416`. These rates land on **document rows** (invoice /
  payment / PO `exchangeRate` columns), never on the `currency` table. Unmerged
  `deee8198af` ("pass Xero's CurrencyRate through, don't invert it") fixes a
  direction bug here. QBO and Rillet entities have no CurrencyRate handling (grep
  `currencyRate` in `packages/ee/src` hits only Xero files + core).
- **Sync journal conversion** reads the document's stored rate:
  `packages/ee/src/accounting/core/document-costing.ts:61-90, 210-233`
  (base = transaction × rate; divide with penny-reconciliation).
- **Paperless Parts import**:
  `packages/jobs/src/inngest/functions/integrations/paperless-parts.ts:283-331` —
  imported quotes take `currency.data.exchangeRate ?? undefined` from the shared
  table (falls back to `exchangeRate = 1` when the currency row isn't found). Rates
  flow table→document, nothing external enters the table.
- **`exchangeRateHistory` has NO writer in the repo.** Table created in
  `20260315000002_exchange-rate-history.sql:1-56` with the comment "daily spot rates
  auto-populated by sync job" — but neither the current updater job nor PR #1542's
  version inserts into it; the only in-repo references are the reader
  `getExchangeRateHistory` (`accounting.ee.service.ts:4735-4750`), the
  `translateTrialBalance` RPC (closing/average rates, same migration:116-141, revised
  in `20260713225803`), and the auto-generated REST swagger
  (`packages/database/src/swagger-docs-schema.ts:36294+`, i.e. writable via the
  public API only). Consequence: the form's history chart is empty and consolidation
  "Average"/"Closing" rates COALESCE down to the spot fallback → 1. Any redesign
  should make the new shared store the history writer.
- No other rate sources found (no ECB/fixer/openexchangerates references anywhere;
  `exchangeratesapi.io` is the only feed).

---

## Summary for the redesign (shared on-by-default store + per-company override)

1. **The integration is a pure toggle with zero config** — no per-company key, no
   settings, already plan-whitelisted for everyone (`plan.ts:29-33`). Eliminating it
   costs nothing config-wise; the only thing the `companyIntegration` row does is
   gate the cron job's company list.
2. **The natural "shared store" already half-exists but is mis-keyed.** Rates live on
   group-scoped `currency` rows, rebased into each group's own base currency — so
   today's storage is per-group *derived* data, not a shared truth. A single
   platform-level rate table (e.g. EUR- or USD-based daily rates, one row per
   code+date) with per-group/company *override* rows would let the rebase happen at
   read time and make `exchangeRateHistory` (currently writer-less) the natural
   platform history.
3. **Manual edits and the feed write the same column with no precedence flag** — the
   nightly job clobbers manual edits; nothing marks a rate as "user-pinned". The
   override capability the redesign wants needs an explicit marker (or a separate
   override table), not just the current single `exchangeRate` column.
4. **Fallback-to-1 is pervasive and silent** (`?? 1` in ~25 call sites plus SQL
   COALESCEs) — with rates on by default, most of these become unreachable, but the
   unmerged branch (`resolveCurrencyAndRate`, refuse-don't-default) is the intended
   direction and should be reconciled with/landed before or with this work.
5. **Coordinate with the two open PRs** (#1542 group-scoped job rewrite, #1530
   document-sourced refresh + resolver commits on the same branches) — they rewrite
   exactly the files this refactor replaces; landing order matters to avoid
   conflicts or re-fixing.
