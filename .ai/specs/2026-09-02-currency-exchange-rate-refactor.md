# Currency & Exchange Rate Architecture Refactor

> Status: draft
> Author: Claude (feature pipeline, autonomous mode), for info@carbon.ms
> Date: 2026-09-02

Research: [.ai/research/exchange-rate-competitor-practice.md](../research/exchange-rate-competitor-practice.md) ·
[PR audit](../research/2026-09-02-exchange-rate-pr-audit.md) ·
[Currency architecture / blast radius](../research/2026-09-02-currency-architecture.md) ·
[Rate update path](../research/2026-09-02-exchange-rate-update-path.md)

## TLDR

Replace the group-scoped `currency.exchangeRate` column and the integration-gated nightly
job with: (1) a **platform-global, effective-dated `exchangeRate` table** anchored to USD,
written daily by an unconditional feed job (one API call for the whole installation);
(2) a **per-company `exchangeRateOverride` table** whose rows always beat the feed
(QBO's "your rate" vs "market rate"); (3) a **single SQL resolver
`get_exchange_rate(companyId, code)`** that answers "units of `code` per 1 unit of THIS
company's base currency" — base = 1 by definition, override next, else the ratio of two
USD-anchored feed rates (SAP triangulation). The `currency` table survives as group-scoped
currency *configuration* (decimalPlaces, active, historicalExchangeRate) with the rate
columns removed. Document snapshot semantics — the header `exchangeRate` stamped at
creation, line `converted*` generated columns, posting/PDF/sync reading snapshots only —
are **preserved exactly**, so the blast radius is the ~40 stamping sites, two edge
functions, one jobs duplicate, the nightly job, and consolidation's closing/average
lookups. The `exchange-rates-v1` integration is deleted; rates are on by default for
everyone. Along the way: `?? 1` par fallbacks become errors, `(currencyCode, exchangeRate)
` becomes an atomic pair at every write, the missing salesInvoice header→line propagation
is added, rate > 0 is enforced by DB CHECKs, and `toBaseAmount`/`fromBaseAmount` helpers
pin the direction convention.

## Problem Statement

Three architectural problems, evidenced by 12 symptom PRs from BettrCallRaul
(#1525–#1549, classified in the PR audit):

1. **The rate's base is recorded nowhere.** `currency` is unique per
   `(code, companyGroupId)` and `exchangeRate` means "foreign units per 1 base unit" —
   but base currency lives per company (`company.baseCurrencyCode`), and companies in a
   group can differ (a supported configuration: consolidation exists precisely to
   translate them). The nightly job normalizes the group's shared rows to *each
   integration-enabled company's* base in arbitrary order (last writer wins — PR #1542);
   consolidated reports assume the *root* company's base; the edit form describes the row
   against the *viewer's* base. Every company except "whichever wrote last" reads rates
   normalized to a base that is not its own, and its own base-currency row isn't 1.
2. **Rates require an integration.** `exchange-rates-v1` is a pure on/off toggle (empty
   settings, global env API key) whose only function is gating the cron's company list.
   Without it, all 118 seeded currency rows sit at `exchangeRate = 1` forever — and ~25
   `?? 1` / `|| 1` call sites plus `DEFAULT 1` columns make missing rates look plausible.
   Every foreign-currency document on a fresh company quietly books at par (#1525's
   six-month silent par-quoting is the canonical case).
3. **The defect classes behind the PR wave** (audit's patterns): silent par fallbacks
   (#1525, #1526); direction-is-tribal-knowledge rate² bugs (#1544, #1543, #1532);
   non-atomic `(currencyCode, exchangeRate)` writes (#1526, #1530); inconsistent
   header→line propagation — interceptors for quote/SO, triggers for PO/PI/supplierQuote,
   **nothing** for salesInvoice (#1527); no positivity enforcement (#1541); manual edits
   clobbered by the nightly feed (no provenance concept at all).

Additional latent defects that ride along: `exchangeRateHistory` has **zero writers**
while consolidation already reads it (closing/average rates COALESCE to 1 today);
`translateTrialBalance` multiplies by a rate whose convention implies dividing — a
direction contradiction never forced into the open because no producer exists.

## Proposed Solution

### The model

```
┌─────────────────────────────────────────────────────────────────────────┐
│ exchangeRate (GLOBAL — no tenant column)                                │
│   one row per (currencyCode, effectiveDate)                             │
│   rate = units of currencyCode per 1 USD                                │
│   written by the daily feed job + seeded snapshot; read by everyone     │
├─────────────────────────────────────────────────────────────────────────┤
│ exchangeRateOverride (PER COMPANY)                                      │
│   one row per (companyId, currencyCode)                                 │
│   rate = units of currencyCode per 1 unit of company.baseCurrencyCode   │
│   written by users; ALWAYS beats the feed; delete = back to market rate │
├─────────────────────────────────────────────────────────────────────────┤
│ currency (GROUP config — unchanged scope, rate columns removed)         │
│   (code, companyGroupId): decimalPlaces, active, tags, customFields,    │
│   historicalExchangeRate (manual IAS-21 input, consolidation only)      │
└─────────────────────────────────────────────────────────────────────────┘

get_exchange_rate(companyId, code, asOf = today) →
  1. code == company.baseCurrencyCode        → 1        (only sanctioned constant)
  2. exchangeRateOverride(companyId, code)   → its rate  (source: 'override')
  3. global: rate(code, ≤asOf) / rate(base, ≤asOf)      (source: 'market')
  4. nothing                                  → ERROR    (never 1)
```

- **Rate meaning at every consumer is unchanged**: "document-currency units per 1
  base-currency unit", exactly what the six document headers snapshot today. Generated
  `converted*` columns, posting divides, PDF props, EE sync payloads — all untouched.
- **"Whose base?" dissolves**: the global store is anchored to USD (a property of the
  table, stated in its comment and column name), and every read is per-company via the
  resolver. Two companies in one group with different bases each get correct rates from
  the same global rows — NetSuite's logical-partition-by-base, Odoo's ratio resolution.
- **Feed defers to manual structurally** (NetSuite insert-if-absent, improved): the feed
  writes only the global table; users write only overrides. Different tables — clobbering
  is impossible by construction, no lock flag needed.
- **On by default**: the daily job runs unconditionally (no `companyIntegration` gate).
  The migration seeds the global table with a snapshot so every installation — including
  self-hosted with no `EXCHANGE_RATES_API_KEY` — resolves real rates from day one.

### What gets deleted

- `packages/ee/src/exchange-rates/` (integration `config.tsx`; the fetch/convert client
  moves into the job), the registry entry (`packages/ee/src/index.ts`), the
  `INTEGRATION_WHITELIST` entry (`packages/ee/src/plan.ts:31`), and all
  `companyIntegration` rows with `id = 'exchange-rates-v1'` (migration DELETE).
- `currency.exchangeRate` column (after migrating values to overrides — see Data Model),
  the group-scoped `exchangeRateHistory` table (zero writers ever, zero rows — replaced
  by the global table), and the `?? 1` fallbacks at every stamping site.

### Defect-class fixes folded in

| Defect class (audit) | Fix in this refactor |
|---|---|
| (a) group-scoping half-migration | resolver is per-company; global store is base-agnostic |
| (b) integration-gated rates / `?? 1` | on-by-default feed + seeded snapshot; resolver errors on missing, base=1 only constant |
| (c) snapshot vs live | unchanged snapshot doctrine, now stated: documents stamp at creation/currency-change/explicit refresh; refresh reads the resolver with the DOCUMENT's code (subsumes #1530) |
| (d) direction confusion | `toBaseAmount(amount, rate) = amount / rate`, `fromBaseAmount(amount, rate) = amount * rate` in `functions/shared/precision.ts` (re-exported via `@carbon/utils`); adopted in code this refactor touches; repo-wide checks ban is a follow-up |
| (e) header→line propagation | add the missing salesInvoice trigger pair (subsumes #1527), guarded/idempotent; existing quote/SO interceptors and PO/PI/SQ triggers left alone (working; minimal-impact) |
| (f) validation gaps | CHECK (`exchangeRate > 0`) on the 12 document tables (subsumes #1541), guarded; zod `.positive()` on every exchangeRate field |
| (g1) non-atomic pair | every write that sets `currencyCode` resolves `exchangeRate` in the same action via the resolver (absorbs #1526's `resolveCurrencyAndRate` as the TS wrapper); refresh routes take the code from the document, never the request (#1530) |
| (g2) untyped column families | out of scope for v1 beyond the helpers in (d) — noted as follow-up (branded types / checks rule) |

### Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Global store anchor | USD | Carbon's default base (`20240930183906` backfilled `'USD'`); anchor is invisible to consumers (all reads are ratios); feed's EUR-based payload converted at write |
| Global store shape | `(currencyCode, effectiveDate)` unique, effective-dated; the feed may CORRECT the same day's row via upsert (user data never lives in this table, so same-day correction clobbers nothing) | NetSuite/SAP/BC/Odoo consensus; gives consolidation a real closing/average source; ~43k rows/yr platform-wide |
| Global store tenancy | none (no companyId/companyGroupId), SELECT for all authenticated, writes service-role only | Market data, not tenant data — same class as `currencyCode` reference table; flagged as a deliberate multi-tenancy exception |
| Override scope | per **company**, not group | The entire point: rate-to-base is only well-defined per company; `company.baseCurrencyCode` is the anchor |
| Override dating | standing pin (one row per company+code), not effective-dated | Matches Carbon's current single-current-rate model + document snapshots; NetSuite-style dated manual rows are a compatible future extension |
| Override precedence | override always beats feed; delete restores market rate | QBO "your rate"/"market rate"; separate tables make clobbering structurally impossible |
| `currency` table fate | keep, group-scoped, as currency CONFIG (decimalPlaces, active, tags, customFields, historicalExchangeRate); drop `exchangeRate` | Decimals are intrinsic to a currency (JPY=0 everywhere) and group-sharing them is harmless (blast radius: `useCurrencies`, seeds, backups all unchanged); the rate is what breaks at group scope |
| `historicalExchangeRate` | untouched on `currency` (manual IAS-21 equity rate) | Consolidation's separate concern (NetSuite separates consolidation rates from transaction rates); its direction question is documented, not solved here |
| `exchangeRateHistory` | DROP (replaced by global `exchangeRate` table), guarded: the migration REFUSES if any deployment holds rows (the table was API-reachable even with no app writer) | Zero app writers ever; refusal beats silent discard for the theoretical API-written row |
| Consolidation closing/average | `translateTrialBalance` reads the global table: closing = r(target)/r(source) at period end, average = AVG over period | Its existing `balance * rate` multiply becomes CORRECT once the rate is a true target-per-source pair ratio — resolves the direction contradiction instead of patching it |
| Resolver | SQL functions `get_exchange_rate(companyId, code, asOf)` + `get_exchange_rates(companyId)` (all active codes + source) | One implementation for app services, edge functions (`convert`, `create`), and jobs (`paperless-parts` duplicate dies); PLPGSQL so ordering/inlining is deterministic |
| Missing rate | ERROR (SAP SG105), surfaced at point of use; base=1 the only free constant | Kills the `?? 1` class; seeded snapshot makes "missing" genuinely exceptional (unknown code only) |
| Rate meaning at stamping sites | unchanged: foreign-per-base, stamped on header at creation | Preserves every generated column, posting divide, PDF, sync payload; keeps this refactor orthogonal to the GL convention normalization draft (`2026-07-02-exchange-rate-convention-normalization.md`) |
| Line-level rates | keep (denormalization required by row-local STORED generated columns); complete propagation, don't unify mechanisms | Postgres generated columns can't reference the header; ripping them out is a different, larger refactor |
| Feed job | rewrite `update-exchange-rates` Inngest fn in place (same function id, same cron `0 0 * * *`): fetch once → write global rows for every `currencyCode` | Event/function-name surface FROZEN per BACKWARD_COMPATIBILITY.md; one API call per installation per day regardless of tenant count |
| Feed provider | exchangeratesapi.io via existing `EXCHANGE_RATES_API_KEY` env (global) | No new production dependency; key already provisioned in cloud |
| No-key installs | seeded snapshot + overrides; job logs and skips | Rates work out of the box everywhere; degrade is stale-but-real, never 1.0 |
| Schema contract (ADDITIVE-ONLY) | deliberate exception, data-preserving: `exchangeRate` values migrated to override rows before the column drop | Owner-requested refactor; precedent: this exact table already dropped `name`/`symbol`/`isBaseCurrency`/`companyId`; surfaced for veto |
| Heuristic 1 (multi-tenancy) | `exchangeRateOverride`: `id` default + `companyId`, PK `("id","companyId")`, unique `("companyId","currencyCode")`, composite FK pattern; global table: deliberate exception (above) | House convention |
| Heuristic 2 (service shape) | TS wrappers in `accounting.ee.service.ts` (`getExchangeRate`, `getExchangeRates`) return `{data, error}` | House convention |
| Heuristic 3 (RLS) | override: standard per-company policies (SELECT employee, writes `accounting_update`); global: SELECT `authenticated`, no write policies (service-role only); `currency` policies unchanged | House convention + market-data exception |
| Heuristic 4 (permissions) | exchange-rate routes keep `view/update: "accounting"` | Unchanged surface |
| Heuristic 5 (forms) | `ExchangeRateForm` stays ValidatedForm + zod; gains provenance display + "reset to market rate" | House convention |
| Heuristic 6 (module layout) | accounting module owns everything (`accounting.ee.service.ts`, `accounting.models.ts`); no new module | House convention |
| Heuristic 7 (backward compat) | route paths unchanged; MCP tools (`*_update*ExchangeRate`) unchanged in shape; edge fn names unchanged; service fn signatures: `getCurrencyByCode` keeps working (config row, no rate) — rate callers move to `getExchangeRate` | STABLE surfaces preserved |

## Data Model Changes

One migration (`pnpm db:migrate:new currency-exchange-rate-refactor`), idempotent
throughout (guards on every DDL), forward-dated. Then `pnpm run generate:types`.

```sql
-- 1) Global market-rate store. Deliberately NOT tenant-scoped: market data,
--    same class as "currencyCode". Anchor: units of currencyCode per 1 USD.
CREATE TABLE IF NOT EXISTS "exchangeRate" (
    "id" TEXT NOT NULL DEFAULT id('xrate'),
    "currencyCode" TEXT NOT NULL,
    "effectiveDate" DATE NOT NULL,
    "rate" NUMERIC NOT NULL CHECK ("rate" > 0 AND "rate" <> 'NaN'::numeric), -- NaN > 0 is TRUE in PG
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "updatedAt" TIMESTAMP WITH TIME ZONE,
    CONSTRAINT "exchangeRate_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "exchangeRate_currencyCode_fkey" FOREIGN KEY ("currencyCode")
      REFERENCES "currencyCode"("code") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "exchangeRate_rate_positive" CHECK ("rate" > 0),
    CONSTRAINT "exchangeRate_code_date_key" UNIQUE ("currencyCode", "effectiveDate")
);
CREATE INDEX IF NOT EXISTS "exchangeRate_code_date_idx"
  ON "exchangeRate" ("currencyCode", "effectiveDate" DESC);
ALTER TABLE "exchangeRate" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "SELECT" ON "exchangeRate" FOR SELECT TO authenticated USING (true);
-- no INSERT/UPDATE/DELETE policies: service-role (the feed job) only

-- 2) Per-company user overrides. rate = units of currencyCode per 1 unit of
--    the company's OWN base currency. Standing pin; delete = market rate.
CREATE TABLE IF NOT EXISTS "exchangeRateOverride" (
    "id" TEXT NOT NULL DEFAULT id('xrovr'),
    "companyId" TEXT NOT NULL,
    "currencyCode" TEXT NOT NULL,
    "rate" NUMERIC(20,8) NOT NULL,
    "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "updatedBy" TEXT REFERENCES "user"("id"),
    "updatedAt" TIMESTAMP WITH TIME ZONE,
    CONSTRAINT "exchangeRateOverride_pkey" PRIMARY KEY ("id", "companyId"),
    CONSTRAINT "exchangeRateOverride_companyId_fkey" FOREIGN KEY ("companyId")
      REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "exchangeRateOverride_currencyCode_fkey" FOREIGN KEY ("currencyCode")
      REFERENCES "currencyCode"("code") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "exchangeRateOverride_rate_positive" CHECK ("rate" > 0),
    CONSTRAINT "exchangeRateOverride_company_code_key" UNIQUE ("companyId", "currencyCode")
);
-- RLS: SELECT for employees of the company; INSERT/UPDATE/DELETE for accounting_update
-- (standard per-company policy shapes, policy names "SELECT"/"INSERT"/"UPDATE"/"DELETE")

-- 3) Seed the global store: static snapshot (as of the migration date) for every
--    code in "currencyCode", ON CONFLICT DO NOTHING. Rates work with no feed/key.

-- 4) Migrate existing user intent to overrides, THEN drop the column:
--    for each companyGroup WITHOUT an active 'exchange-rates-v1' companyIntegration
--    (feed-derived rates must NOT become pins), for each member company, for each
--    currency row with exchangeRate <> 1 AND code <> company.baseCurrencyCode:
--      INSERT INTO "exchangeRateOverride" (companyId, code, rate) preserving the
--      exact value that company resolves today. createdBy = 'system'.
--    ON CONFLICT DO NOTHING.
ALTER TABLE "currency" DROP COLUMN IF EXISTS "exchangeRate";
-- historicalExchangeRate, decimalPlaces, active, tags, customFields remain.

-- 5) DROP + recreate the "currencies" view (SECURITY_INVOKER) without exchangeRate,
--    forked from its NEWEST definition (currency ⋈ currencyCode + name).

-- 6) DROP TABLE IF EXISTS "exchangeRateHistory";  -- zero writers ever, zero rows

-- 7) Resolver (PLPGSQL, STABLE, SECURITY DEFINER not needed — reads are policy-open
--    for the global table; company/override reads run as invoker):
--    get_exchange_rate(company_id TEXT, code TEXT, as_of DATE DEFAULT NULL)
--      → NUMERIC  (RAISES on unresolvable; base → 1; override; else ratio of the
--         latest global rows with effectiveDate <= COALESCE(as_of, CURRENT_DATE))
--    get_exchange_rates(company_id TEXT)
--      → TABLE(currencyCode, name, decimalPlaces, rate NUMERIC, source TEXT
--         ('base'|'override'|'market'), rateUpdatedAt) for the group's active
--         currency config rows, resolved for THIS company

-- 8) salesInvoice header→line propagation (subsumes PR #1527), guarded:
--    AFTER UPDATE OF "exchangeRate" ON "salesInvoice" → update lines;
--    BEFORE INSERT ON "salesInvoiceLine" → inherit header rate.
--    Backfill: one-time UPDATE of existing line rates from their header where they
--    disagree AND the invoice is not posted.

-- 9) Positivity (subsumes PR #1541), all guarded ADD CONSTRAINT IF NOT EXISTS /
--    NOT VALID + VALIDATE where data may predate:
--    CHECK ("exchangeRate" > 0) on quote, salesOrder, purchaseOrder, supplierQuote,
--    purchaseInvoice, salesInvoice, quoteLinePrice, salesOrderLine, purchaseOrderLine,
--    supplierQuoteLinePrice, purchaseInvoiceLine, salesInvoiceLine
--    (payment/memo/invoiceSettlement already CHECKed).

-- 10) DELETE FROM "companyIntegration" WHERE "id" = 'exchange-rates-v1';

-- 11) translateTrialBalance + getConsolidationRates: fork NEWEST definitions
--     (20260811123614), closing/average now read the global "exchangeRate" table as
--     r(target)/r(source); historical stays currency."historicalExchangeRate".
--     COALESCE(...,1) fallbacks removed for closing/average (global store is seeded);
--     the multiply convention is now correct by construction.
```

Sequencing note: steps 3–4 run before the column drop in the same transaction; a failed
migration rolls back whole (idempotency guards make retry safe per the
migrations-must-be-idempotent lesson).

Seed-path changes outside the migration: `seed-company` (`functions/lib/seed.data.ts:484`
+ `seed-company/index.ts:335`) and `packages/database/src/datasets/bootstrap.ts:300` stop
writing `exchangeRate` (config columns only). Backup scoping: `exchangeRate` joins the
non-tenant reference class; `exchangeRateOverride` is companyId-scoped (auto-discovered);
`packages/jobs/src/backups/scope.test.ts` pins updated.

## API / Service Changes

**New (accounting module, `accounting.ee.service.ts` + `accounting.models.ts`):**
- `getExchangeRate(client, companyId, code)` → `{ data: number, error }` (RPC wrapper).
- `getExchangeRates(client, companyId)` → resolved list with `source` for the admin page.
- `upsertExchangeRateOverride` / `deleteExchangeRateOverride` (route-called).
- `exchangeRateOverrideValidator` (zod, `rate: z.number().positive()`).

**Changed — every stamping site moves `getCurrencyByCode(...).exchangeRate` →
`getExchangeRate(companyId, code)`** (the ~40 sites in the blast-radius file §4.2:
`sales.service.ts` quote/SO create+update+convert, `purchasing.service.ts` PO/supplier
quote, `invoicing.service.ts` both invoices, the six `*.exchange-rate.tsx` refresh routes
— which now take the code from the DOCUMENT row, subsuming #1530 — plus `update.tsx`
actions, finalize, PDF preflight loaders). `?? 1` disappears at each; a resolver error
propagates as the action/loader error. `getCurrencyByCode`/`getCurrencies`/
`getCurrenciesList`/`useCurrencies` keep their shapes (config + decimals; no rate).

**Edge functions:** `convert/index.ts:1084` and `create/index.ts:541` call
`get_exchange_rate` (via their existing clients) instead of reading `currency`; `create`
loses its `?? 1`. No new functions; no `config.toml` changes.

**Jobs:** `update-exchange-rates.ts` rewritten in place: fetch EUR-based payload once
(client code moves here from `packages/ee/src/exchange-rates/exchange-rates.server.ts`),
convert to USD-anchored, upsert today's global rows for every `currencyCode`; no
`companyIntegration` scan; skip-with-log when the env key is absent.
`paperless-parts.ts:808` local helper replaced by the resolver.

**Deleted:** `packages/ee/src/exchange-rates/config.tsx` (+ directory), registry entry,
whitelist entry. The Settings → Integrations page simply no longer lists it.

**Docs:** update the curated docs page for currencies/exchange rates (carbon-docs) — rates
are automatic; overrides documented.

## UI Changes

`/x/accounting/exchange-rates` (list + `$currencyId` drawer):
- List shows the **resolved rate for the viewing company** with a provenance badge —
  "Market rate" (with last-updated date) vs "Your rate" — instead of the raw group row.
- Editing the rate writes an `exchangeRateOverride`; a "Reset to market rate" action
  deletes it. Helper text stays "One {base} = how many {code}?" — now guaranteed true
  because base is the viewer company's and the value is company-resolved.
- Base currency row displays 1, not editable (matches today's client-side clamp, now
  server-true).
- `decimalPlaces` (+ tags/customFields) continue editing the group `currency` config row;
  `historicalExchangeRate` field remains (consolidation input).
- Rate-history chart (currently reading the empty `exchangeRateHistory`) reads the global
  table (market line) — overrides shown as a flat annotation.

No other UI changes: document forms/refresh buttons keep their look; they just resolve
through the new path.

## Acceptance Criteria

- [ ] Two companies in one group with different base currencies (e.g. USD and EUR) each
      resolve `get_exchange_rate` correctly for the same foreign code (e.g. GBP): values
      differ by exactly the ratio of their bases' global rates; each company's own base
      resolves to 1.
- [ ] A fresh company (no integration, no key) creates a EUR quote on a USD base and the
      stamped `quote.exchangeRate` is the seeded/feed market rate — not 1.
- [ ] Creating an override for (company, EUR) changes what new documents stamp; deleting
      it restores the market rate; the nightly job never modifies the override.
- [ ] The nightly job writes one global row per currency per day; running it twice for the
      same date is idempotent; two different-base companies' resolutions are unaffected by
      job iteration order (no per-company writes exist).
- [ ] `exchange-rates-v1` no longer appears in Settings → Integrations; existing
      `companyIntegration` rows are deleted; the exchange-rates page works with no
      integration concept.
- [ ] A sales invoice header rate refresh cascades to its lines (new trigger); a new line
      inherits the header rate (never DEFAULT 1).
- [ ] Attempting to save a 0 or negative rate fails at zod AND at the DB CHECK on all 12
      document tables + both new tables.
- [ ] The six document refresh routes ignore any client-supplied rate/currency and
      re-resolve from the document's own `currencyCode`.
- [ ] `convert` (RFQ→quote) and `create` (outside-op→PO) stamp resolver rates; a
      genuinely unresolvable code errors the operation instead of writing 1.
- [ ] Existing documents are byte-identical: no snapshot column value changes except the
      salesInvoiceLine backfill on unposted invoices.
- [ ] Groups without the integration that had hand-edited rates (≠1, ≠base) resolve the
      same values as before the migration (via migrated overrides).
- [ ] Consolidated balance sheet closing/average translation uses global-store ratios;
      report renders without the COALESCE-to-1 silent fallback.
- [ ] `pnpm db:check:datasets` and `pnpm db:check:backups` pass; `generate:types` clean;
      scoped typechecks pass (`erp`, `@carbon/jobs`, `@carbon/ee`, `@carbon/database`).

## Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| Column drop (`currency.exchangeRate`) breaks an unswept reader | High | Blast-radius file enumerates every reader; typecheck catches the rest post-`generate:types` (column gone from types); grep sweep for `exchangeRate` on currency reads as a gate |
| Migration mis-classifies feed-derived vs hand-edited rates → wrong overrides pinned | Med | Conservative rule (only integration-INACTIVE groups, only ≠1, only ≠base); overrides are user-visible with a "Reset to market rate" one-click undo |
| Behavior change: fresh companies now stamp real rates instead of 1 | Med | This is the feature; release note + docs. Historic documents untouched (snapshots) |
| Global-table RLS exception sets a precedent | Low | Documented as market-data class beside `currencyCode`; no tenant data in the table |
| `translateTrialBalance` rework changes consolidation numbers | Med | Today's closing/average are COALESCE(...,1) — i.e. wrong-by-fallback; new values are defensible; historical (manual) path unchanged; verify on seeded consolidation data |
| Open PRs #1527/#1541/#1530/#1526/#1542 merge before/after and conflict | Med | All subsumed pieces are guarded/idempotent (double-apply safe); interaction table below; #1542 is explicitly superseded (job rewritten) |
| Feed API shape/limits (EUR base, free tier) | Low | Same API/key as today; write path validates positive + known codes; partial payloads leave prior days' rows standing (resolver takes latest ≤ date) |
| `db:check:backups` scope drift | Low | scope.test.ts updated in the same change; check runs pre-commit |

### Open-PR interaction (from the audit)

| PR | Relationship to this refactor |
|---|---|
| #1542 (job rebases per group) | **Superseded** — the job no longer writes per-tenant rows at all |
| #1530 (refresh from document) | **Subsumed** — refresh routes re-resolve from the document row |
| #1526 (atomic code+rate writes) | **Subsumed conceptually** — resolver at every currency-setting write; if merged first, its `resolveCurrencyAndRate` is replaced by the resolver wrapper |
| #1527 (salesInvoice cascade) | **Subsumed** — same trigger shape, guarded so both can land |
| #1541 (rate > 0 everywhere) | **Subsumed** — same CHECKs, guarded so both can land |
| #1544, #1543, #1532 (direction/rate² bugs) | **Independent — merge first** (irreversible valuation corruption in #1544); refactor adds the helpers that prevent the class |
| #1548, #1549, #1547 (render/sync rate propagation) | **Independent — merge first**; #1547's remaining six syncer gaps are follow-up work |
| #1525 (merged) | Precedent; its refuse-on-missing guard becomes the resolver's default behavior |

## Open Questions

> All resolved autonomously (non-interactive session; user pre-delegated with veto).
> Resolution order: codebase precedent → research consensus → recommendation.

- [x] Global anchor currency — USD or EUR? — **Autonomous:** USD. Carbon's default base
      backfill was USD; anchor is consumer-invisible (ratios); feed payload converted at
      write. (EUR would equally work; USD wins on legibility for the majority tenant.)
- [x] Override scope: company or group? — **Autonomous:** company. `rate-to-base` is only
      well-defined against `company.baseCurrencyCode`; group scope is the bug being fixed.
- [x] Overrides effective-dated? — **Autonomous:** no — standing pin per (company, code),
      v1. Matches the current single-current-rate + snapshot model; dated overrides
      (NetSuite) are a compatible later extension. Trade-off: no scheduled future rates.
- [x] Keep `currency` group-scoped or move per-company? — **Autonomous:** keep group scope
      for what remains (decimalPlaces/active/historicalExchangeRate — intrinsic or
      consolidation-owned; group-sharing harmless), minimizing RLS/backup/seed churn. The
      per-company concern (the rate) moves out entirely.
- [x] Repurpose `exchangeRateHistory` or new table? — **Autonomous:** drop and create the
      global `exchangeRate` table. History table has zero writers/rows; keeping a
      group-scoped shell invites confusion.
- [x] Drop `currency.exchangeRate` despite ADDITIVE-ONLY schema contract? —
      **Autonomous:** yes, with data migrated to overrides first. Owner-requested
      refactor; table has four dropped-column precedents; a live-looking-but-dead rate
      column is the worse outcome. **Surfaced for veto explicitly.**
- [x] Migration heuristic for existing rates → overrides? — **Autonomous:** only
      groups that NEVER had the integration (any exchange-rates-v1 row, active or
      not, means feed-derived values that must not become pins), only rows
      with rate ≠ 1 and code ≠ that company's base, copied per member company (preserves
      each company's currently-resolved value). **Surfaced for veto** — this is the one
      data-shape judgment call.
- [x] Missing-rate behavior at stamping sites — error or warn-and-1? — **Autonomous:**
      error (SAP SG105 consensus; #1525 precedent). Seeded snapshot makes it rare.
- [x] Rewire consolidation closing/average now or later? — **Autonomous:** now, minimally
      (point the existing lookups at the global store; historical untouched). It is the
      only reader of the dropped `exchangeRateHistory`, so leaving it means leaving a
      dangling reader; and its COALESCE-to-1 is a live silent-wrongness.
- [x] Unify header→line propagation mechanisms? — **Autonomous:** no — only add the
      missing salesInvoice pair. Working interceptors/triggers stay (minimal impact).
- [x] Repo-wide `@carbon/checks` ban on raw `* rate` / `/ rate`? — **Autonomous:**
      follow-up, not v1 (baseline cost is large); helpers land now, ban lands with the
      (g2) typed-column-family work.

## Changelog

- 2026-09-02: Created (feature pipeline, autonomous mode). All open questions resolved
  autonomously per the recorded order; two flagged for explicit veto (column drop,
  override-migration heuristic).
