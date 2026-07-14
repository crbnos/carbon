# FX & Consolidation Completeness — Unrealized Revaluation, Rate History, Posted CTA, Historical Rates

> Status: in-progress
> Author: Claude (readiness remediation Phase 1), for brad@carbonos.dev
> Date: 2026-07-04
> Tracking issue: crbnos/carbon#1050
> Readiness findings: SD-4 (FX completeness), SD-5 (consolidation correctness) — `.ai/specs/2026-07-03-public-company-readiness.md`

## TLDR

With the exchange-rate convention normalization spec implemented (divide-to-base everywhere, realized FX correct at settlement) and the bank-rec spec making `journalLine.sourceAmount`/`sourceCurrencyCode` mandatory on every posting path, four ASC 830/IAS 21 machines are still missing: (1) **period-end unrealized FX revaluation** of open monetary items as an auto-reversing close task (SAP FAGL_FCV / NetSuite "Revalue Open Foreign Currency Balances"); (2) a **writer for `exchangeRateHistory`** — today the table the entire translation layer reads from is never populated, so consolidated statements silently translate at rate 1; (3) **posted CTA** — currently a display-time plug applied to hardcoded account number `'3200'` (`balance-sheet.tsx:80,160`), violating the control-accounts-by-id lesson, never rolling forward; (4) **historical-rate memory** — a single `currency.historicalExchangeRate` per currency instead of per-transaction layers for equity. This spec delivers all four plus `netChange` on `translateTrialBalance` (translated income statements are currently life-to-date), and registers two new period-close checklist definitions: "Revalue open foreign currency balances" and "Verify consolidated exchange rates".

## Problem Statement

Facts (verified in code, 2026-07-04):

1. **No unrealized revaluation exists.** FX gain/loss realizes only at settlement (`build-payment-journal`); an open EUR invoice at period end is carried at the booking-date rate, misstating AR/AP and income under ASC 830 ¶ remeasurement / IAS 21.28. The period-closing spec's checklist has no FX task because the capability doesn't exist (SD-4).
2. **`exchangeRateHistory` has no writer.** The migration comment ("auto-populated by sync job", `20260315000002`) describes a job that does not exist — `update-exchange-rates.ts` updates `currency.exchangeRate` only. `translateTrialBalance` falls back `COALESCE(v_closing_rate, 1)` etc., so any multi-currency group's consolidated statements are silently wrong today (SD-5).
3. **`exchangeRateHistory.rate` semantics are undefined.** The table has no base-currency column; `translateTrialBalance` multiplies `localBalance × rate` toward an arbitrary `p_target_currency` — inverted relative to the platform's normalized foreign-per-base ÷ convention and ambiguous about what the rate is quoted against.
4. **CTA is a display plug on a hardcoded number.** `getConsolidatedBalances` computes `cta = assets − (liabilities+equity)` and `balance-sheet.tsx:80,160` attaches it to `accounts.find(a => a.number === "3200")`. `accountDefault.currencyTranslationAccount` (NOT NULL, FK, seeded → 3200) is **never read**. CTA never posts, never rolls forward, is invisible to drill-down and the JE population (`.ai/lessons.md` "Never resolve a control account by number/name").
5. **Translated income statements are life-to-date.** `translateTrialBalance` returns only `balanceAtDate` even though `accountTreeBalancesByCompany` already computes `netChange` — flagged in the drill-down and financial-reporting specs.
6. **Historical-rate memory is one number per currency.** `currency.historicalExchangeRate` cannot represent equity issued in tranches at different rates, or fixed-asset acquisition history, for `account.consolidatedRate = 'Historical'`.

Builds on (treated as implemented): `.ai/specs/2026-07-02-exchange-rate-convention-normalization.md` (rate = foreign units per base unit; **divide** to base), `.ai/specs/2026-07-02-bank-reconciliation.md` FX section (universal `sourceAmount`/`sourceCurrencyCode`), `.ai/specs/2026-07-02-period-closing.md` (persisted close checklist; later features register `periodCloseTaskDefinition` rows).

## Proposed Solution

### 1. Unrealized FX revaluation as an auto-reversing close task

A **currency revaluation run** per company per accounting period (SAP-style auto-reverse: post at period end, reverse on day 1 of the next period — realized-at-settlement logic stays untouched and self-heals):

- **Exposure set**, all measured **as of the period end date**:
  - Open FX AR/AP invoices: document-currency open balance at period end (invoice balance re-derived as-of-date from `invoiceSettlement` rows dated ≤ period end).
  - Unapplied FX payments and memos: unapplied remainder at period end.
  - FX-denominated bank/cash GL balances: Σ `journalLine.sourceAmount` per bank GL account where the linked `bankAccount.currencyCode` ≠ company base.
- **Revalued base value** = source amount ÷ closing rate (divide convention). Closing rate for document currency D vs company base B derived from group history: `rate(D)/rate(B)` where `rate(X)` = X units per group presentation unit (see §2); when B is the presentation currency, `rate(B) = 1`.
- **Posting**: one journal at the period end date (`sourceType 'Currency Revaluation'`, posted with `source: "accounting"` so it is legal in Locked periods) + one reversing journal dated day 1 of the next period, created and posted atomically, linked via `journal.reversedById`.
  - AR exposure: Dr/Cr **AR Revaluation Adjustment** (new balance-sheet account) ↔ Cr/Dr `unrealizedExchangeGainAccount`/`unrealizedExchangeLossAccount`.
  - AP exposure: mirror via **AP Revaluation Adjustment**.
  - Bank/cash exposure: posted **direct on the bank GL account** ↔ unrealized gain/loss.
  - Revaluation lines carry `sourceCurrencyCode` = exposure currency and `sourceAmount = 0` (a valuation posting moves base value only — satisfies the universal-population mandate honestly, SAP semantics).
- One Posted run per (company, period); redo = Void (reverses both journals) then re-run.
- **Checklist registration**: seeded `periodCloseTaskDefinition` "Revalue open foreign currency balances" (Auto, `autoCheckKey: 'fx-revaluation'`, severity Warning). Auto-check passes when the company has no open FX exposure at period end **or** a Posted revaluation run exists for the period.

Exposure-computation detail:

- As-of open balance for an invoice = posted invoice total (document currency) − Σ `invoiceSettlement` principal/discount/write-off dated ≤ period end — the same settlement-dated derivation the aging RPCs use, so a payment applied on Aug 3 does not shrink the Jul 31 exposure. Dust-forgiven invoices (`20260630151500`) with zero residual are excluded.
- `bookedBaseAmount` for AR/AP = document open amount ÷ invoice exchange rate (the booking-date rate carried on the invoice, divide convention). For bank exposure, booked base = the GL balance of the bank account at period end; source balance = Σ `sourceAmount` on the same lines (mandatory population makes this exact go-forward; accounts with legacy NULL-source lines are reported as unrevaluable with a warning rather than revalued from partial data).
- Out of scope for v1 (documented, not silently ignored): FX-denominated GR/IR, customer deposits (GAP-1 territory), and FX intercompany loans — the exposure preview lists these categories as "not covered" when the company has balances on them in foreign currency.

### 2. Rate-history feed + coverage warnings

- Extend `update-exchange-rates.ts`: after the per-company `currency` upsert loop, for each distinct `companyGroupId` processed, upsert one `exchangeRateHistory` row per enabled currency for today: `(companyGroupId, currencyCode, effectiveDate = today UTC, rate)` on the existing unique key, where **rate = currency units per one unit of the group presentation currency** (the base currency of the group's root company — the company with `parentCompanyId IS NULL`). A new `exchangeRateHistory.baseCurrencyCode` column makes the quote basis explicit.
- **Period averages stay derived** (AVG over daily rows in the RPC) — no second storage of the same fact.
- **Backfill is honestly NULL**: no fabricated history. Coverage begins at deploy; gaps surface as warnings, never as invented rates.
- **Kill the rate-1 fallback**: `translateTrialBalance` keeps the fallback *chain* (average→closing, historical→layers→closing) but when no rate exists at all it falls back to the live `currency.exchangeRate` with a `rateSource = 'spot-fallback'` flag, and to NULL (`rateSource = 'missing'`, translated balance NULL) when even that is absent. `getConsolidatedBalances` aggregates these into per-currency warnings that the consolidated report banners; it never silently shows rate-1 numbers.
- **Checklist registration**: seeded definition "Verify consolidated exchange rates" (Auto, `autoCheckKey: 'fx-rate-coverage'`, Warning; meaningful for group companies, auto-passes for single-company/single-currency setups). Check: for every currency in use across the group (company bases + open exposure currencies), a closing rate exists on or ≤ period end and no more than 7 days stale, and ≥ 1 in-period rate exists for the average.

### 3. Posted CTA at group close

- **Resolution by id**: consolidated reports and the CTA poster read `accountDefault.currencyTranslationAccount` (already NOT NULL + seeded). Both `number === "3200"` lookups in `balance-sheet.tsx` are deleted.
- **Posting mechanics** (decided): a **two-line elimination-entity journal**. A balanced journal cannot absorb a translation plug — translation is a report-time transform, and any balanced entry nets to zero against the imbalance — so materializing CTA in the GL requires an offset. The alternatives were (a) a full consolidation ledger with per-account group-currency deltas (SAP Group Reporting / parallel currencies — correct, and out of scope until a stored consolidated ledger exists) or (b) offset-account materialization. We choose (b):
  - New seeded equity account **"Currency Translation Offset"** + `accountDefault.currencyTranslationOffsetAccount`.
  - Service `postCurrencyTranslationAdjustment` computes live cumulative CTA for the group as of period end, reads the posted balance of the CTA account on the elimination entity, and posts the **movement**: Dr/Cr CTA ↔ Cr/Dr Offset on the parent node's elimination entity (`sourceType 'Consolidation'`, elimination entity's own accounting period, `source: "accounting"`). Precedent: `generateEliminationEntries` already posts group-level entries on elimination entities.
  - Consolidated reports: the CTA account row now comes from the GL (posted, drillable, rolls forward across periods as a real balance); the offset account is **excluded by id** from consolidated statements; a residual line "Unposted translation adjustment" = live plug − posted CTA renders only when non-zero (≈ 0 right after posting, live during open periods). The balance identity is unchanged (CTA + offset net to zero inside equity), so nothing else moves.
- Runs as part of the parent/elimination company's close checklist (the CTA step is a Manual task the controller completes from the consolidation UI; evidence = the posted journal id). A formal group-close lock stays Phase 4 (SD-5.4–.5).

Worked example: USD group, EUR subsidiary with net assets €1,000,000. July: closing 1.05, average 1.08, equity layers at 1.25. Translated assets − translated (liabilities + equity + income at average) leaves a cumulative plug of, say, $38,400 while the elimination entity's CTA account holds $30,000 from prior closes. `postCurrencyTranslationAdjustment` posts Dr Currency Translation Offset $8,400 / Cr CTA (3200) $8,400 on the elimination entity dated Jul 31; the consolidated balance sheet now shows CTA $38,400 from the GL, no offset row, and a zero residual line. August's movement computes against the new $38,400 posted balance — CTA rolls forward instead of being re-plugged from nothing.

### 4. `translateTrialBalance`: netChange + convention alignment

DROP/recreate (return-type change) forking from the **newest** definition per the lessons rule:

- New output columns `netChange`, `translatedNetChange` (income-statement rows translated at the **average** rate over the window — period activity, not life-to-date), and `rateSource TEXT` (`'history' | 'spot-fallback' | 'missing' | 'historical-layers'`).
- Rate math aligned to the platform convention: with `rate(X)` = X units per presentation unit, translation to `p_target_currency` T is `local × rate(T) / rate(source)` — divide-to-presentation, cross-rate to any target; degenerates to `÷ rate(source)` when T is the presentation currency.
- Rate-1 fallback removed per §2.

### 5. Historical-rate layers

Replace the single `currency.historicalExchangeRate` with per-transaction layers for accounts where `account.consolidatedRate = 'Historical'` (equity; fixed-asset history when asset accounts are so tagged):

- New table `historicalRateLayer`: one row per posted journal line hitting a Historical account — local (company-base) amount + the rate in force at posting.
- **Capture by trigger** on journal status → Posted (the only surface every poster crosses: edge functions, Inngest, app services — same rationale as the period-close trigger). Rate resolved from `exchangeRateHistory` at posting date; NULL when uncovered (flagged by the coverage check, editable in UI).
- `translateTrialBalance` for Historical accounts: Σ(`localAmount ÷ rate`) over layers ≤ period end, plus any residual (`balance − Σ localAmount`) at closing rate with `rateSource` flagging the residual.
- `currency.historicalExchangeRate` is kept as a **deprecated fallback** for layer-less history (pre-deploy balances), last in the chain before closing; no fabricated backfill.

### Design Decisions

| # | Decision | Choice | Rationale |
|---|----------|--------|-----------|
| 1 | Revaluation model | **Auto-reversing** (post period end, reverse day 1 next period), not delta-carrying | SAP FAGL_FCV auto-reverse mode; settlement-time realized FX logic untouched; self-healing when invoices settle mid-period; resolution baked in per readiness roadmap |
| 2 | Balance-sheet presentation | **Adjustment accounts** for AR/AP (`AR/AP Revaluation Adjustment`), **direct-on-account** for bank GL | AR/AP control accounts must keep tying to the subledger (tie-out RPCs compare control vs open invoices — a direct posting breaks them); SAP posts valuation to per-recon-account adjustment accounts for exactly this reason. Bank GL accounts have no subledger tie-out and their balance *is* the statement line; bank rec matches on `sourceAmount`, unaffected |
| 3 | Checklist severity | Both new tasks seeded as **Warning** (skippable with reason), not Blocker | Matches the depreciation and IC seeded precedent; auto-pass when no FX exposure / single currency keeps zero-config companies unblocked; a controller can harden to Blocker via the template settings |
| 4 | `exchangeRateHistory` semantics | rate = currency units **per group presentation unit**; explicit `baseCurrencyCode` column; cross-rate to any target | Matches the normalized foreign-per-base ÷ convention; the current table is quote-basis-ambiguous; one stored basis + cross-rates avoids N×N rows |
| 5 | Backfill | None — honest NULL history, warnings instead of invented rates | Fabricated history would silently launder the exact silent-rate-1 defect this spec kills |
| 6 | CTA mechanics | Two-line elimination-entity journal (CTA ↔ Offset), offset excluded from consolidated statements by id; residual line for unposted remainder | A balanced journal cannot absorb a one-sided plug; the full per-account consolidation ledger (SAP parallel currencies) is deferred; offset materialization gives posted/drillable/rolling CTA at a fraction of the cost, with the residual line keeping the report honest |
| 7 | Historical rates | Per-line `historicalRateLayer` captured by Posted-status trigger; `currency.historicalExchangeRate` demoted to deprecated fallback | Trigger is the only surface all posting paths cross; equity tranches at different rates are the norm, not the exception (IAS 21.23(b)) |
| 8 | Multi-tenancy (heuristic 1) | New tables carry `companyId`, composite PK `("id","companyId")`, `id('prefix')`, audit columns; `exchangeRateHistory` change is additive on the existing group-scoped table | House convention; rate history stays group-scoped like the chart |
| 9 | Service shape (heuristic 2) | All new functions in `accounting.service.ts` / models in `accounting.models.ts`, `(client, ...) → {data, error}` | One module service file, never scatter |
| 10 | RLS (heuristic 3) | Four policies per new table gated on `get_companies_with_employee_permission('accounting_*')`; `exchangeRateHistory` policies already exist | Standard pattern; no deprecated helpers |
| 11 | Permissions (heuristic 4) | Revaluation run + CTA posting behind `update: "accounting"`; report reads `view: "accounting"` | Matches journal posting and period close/lock precedent |
| 12 | Forms (heuristic 5) | Revaluation review + layer editor use `ValidatedForm` + zod validators; route actions with `intent` | Standard form pattern |
| 13 | Module layout (heuristic 6) | Everything under `modules/accounting/` + `routes/x+/accounting+/`; job change in `packages/jobs` | No new module |
| 14 | Backward compatibility (heuristic 7) | `translateTrialBalance` recreated (its callers are all in this repo and updated together); rate-1 fallback removal is the *point*; `currency.historicalExchangeRate` kept as fallback; revaluation entirely additive | Consolidated numbers change from "silently wrong" to "right or flagged" — called out in acceptance criteria |

## Data Model Changes

One migration wave (`pnpm db:migrate:new fx-consolidation-completeness`, randomized HHMMSS — never `000000`), then `pnpm run generate:types`. Sketches (bare `NUMERIC` per database conventions):

```sql
-- 1. Quote basis for rate history + honest coverage
ALTER TABLE "exchangeRateHistory"
  ADD COLUMN IF NOT EXISTS "baseCurrencyCode" TEXT REFERENCES "currencyCode"("code");
-- Backfill: set to the group's root-company baseCurrencyCode for any existing rows.

-- 2. New journal sources
ALTER TYPE "journalEntrySourceType" ADD VALUE IF NOT EXISTS 'Currency Revaluation';
ALTER TYPE "journalEntrySourceType" ADD VALUE IF NOT EXISTS 'Consolidation';

-- 3. Account defaults (nullable → backfill → NOT NULL, idempotent, per 20260630093809 pattern)
ALTER TABLE "accountDefault"
  ADD COLUMN IF NOT EXISTS "unrealizedExchangeGainAccount" TEXT,
  ADD COLUMN IF NOT EXISTS "unrealizedExchangeLossAccount" TEXT,
  ADD COLUMN IF NOT EXISTS "arRevaluationAccount" TEXT,
  ADD COLUMN IF NOT EXISTS "apRevaluationAccount" TEXT,
  ADD COLUMN IF NOT EXISTS "currencyTranslationOffsetAccount" TEXT;
-- Seed per company group (parents resolved by "isGroup" = TRUE AND name = '<Group Name>',
-- NEVER by number — lessons rule; NULL parent = error):
--   'Unrealized Exchange Gains'  (Other Income,  next free number near 4120)
--   'Unrealized Exchange Losses' (Other Expenses, next free number near 7060)
--   'AR Revaluation Adjustment'  (Asset, under the Receivables group header)
--   'AP Revaluation Adjustment'  (Liability, under the Payables group header)
--   'Currency Translation Offset' (Equity, isSystem, sibling of 3200)
-- Backfill accountDefault by resolved account *id*; then SET NOT NULL + FK + indexes.

-- 4. Revaluation run
CREATE TABLE "currencyRevaluationRun" (
  "id" TEXT NOT NULL DEFAULT id('crr'),
  "companyId" TEXT NOT NULL,
  "accountingPeriodId" TEXT NOT NULL REFERENCES "accountingPeriod"("id"),
  "rateDate" DATE NOT NULL,                    -- period end
  "status" TEXT NOT NULL DEFAULT 'Draft',      -- 'Draft' | 'Posted' | 'Voided'
  "journalId" TEXT REFERENCES "journal"("id"),          -- period-end valuation entry
  "reversingJournalId" TEXT REFERENCES "journal"("id"), -- day-1 auto-reversal
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  CONSTRAINT "currencyRevaluationRun_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "currencyRevaluationRun_companyId_fkey" FOREIGN KEY ("companyId")
    REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "currencyRevaluationRun_one_posted_per_period_idx"
  ON "currencyRevaluationRun" ("companyId", "accountingPeriodId")
  WHERE "status" = 'Posted';

CREATE TABLE "currencyRevaluationLine" (
  "id" TEXT NOT NULL DEFAULT id('crl'),
  "companyId" TEXT NOT NULL,
  "runId" TEXT NOT NULL,
  "exposureType" TEXT NOT NULL,   -- 'AR Invoice' | 'AP Invoice' | 'Payment' | 'Memo' | 'Bank'
  "documentId" TEXT,              -- invoice/payment/memo id; NULL for bank GL exposure
  "accountId" TEXT NOT NULL REFERENCES "account"("id"),  -- adjustment or bank GL account
  "currencyCode" TEXT NOT NULL REFERENCES "currencyCode"("code"),
  "sourceOpenAmount" NUMERIC NOT NULL,   -- document-currency exposure at period end
  "bookedBaseAmount" NUMERIC NOT NULL,
  "closingRate" NUMERIC NOT NULL,        -- doc units per company-base unit
  "revaluedBaseAmount" NUMERIC NOT NULL,
  "gainLossAmount" NUMERIC NOT NULL,     -- revalued − booked, signed
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  CONSTRAINT "currencyRevaluationLine_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "currencyRevaluationLine_run_fkey" FOREIGN KEY ("runId", "companyId")
    REFERENCES "currencyRevaluationRun"("id", "companyId") ON DELETE CASCADE
);
-- RLS: four policies each, SELECT via get_companies_with_employee_role(),
-- writes via get_companies_with_employee_permission('accounting_<action>'), ::text[] casts.

-- 5. Historical-rate layers
CREATE TABLE "historicalRateLayer" (
  "id" TEXT NOT NULL DEFAULT id('hrl'),
  "companyId" TEXT NOT NULL,
  "accountId" TEXT NOT NULL REFERENCES "account"("id"),
  "journalLineId" TEXT,                 -- NULL for manually entered opening layers
  "effectiveDate" DATE NOT NULL,
  "localAmount" NUMERIC NOT NULL,       -- company-base amount of the movement
  "rate" NUMERIC,                       -- company-base units per presentation unit; NULL = uncovered
  "notes" TEXT,
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  CONSTRAINT "historicalRateLayer_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "historicalRateLayer_companyId_fkey" FOREIGN KEY ("companyId")
    REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
-- Trigger: AFTER UPDATE OF "status" ON "journal" WHEN NEW."status" = 'Posted'
-- (and AFTER INSERT for journals born Posted) → insert one layer per journalLine
-- whose account has "consolidatedRate" = 'Historical', rate from exchangeRateHistory
-- at postingDate (NULL when uncovered).

-- 6. translateTrialBalance: DROP + recreate (fork the NEWEST definition) with
--    netChange/translatedNetChange/rateSource outputs, divide-to-presentation
--    cross-rate math, historical-layer valuation, and NO rate-1 fallback.
--    Rate resolution sketch (rates quoted as units per presentation unit):
--      v_closing  := latest history row ≤ p_period_end for the source currency;
--      v_average  := AVG(history) over [p_period_start, p_period_end];
--      v_target   := latest history row ≤ p_period_end for p_target_currency
--                    (1 when p_target_currency = history baseCurrencyCode);
--      translated := local × v_target / v_rate_for_account;
--      Historical accounts: Σ(layer.localAmount × v_target / layer.rate)
--        + (balance − Σ layer.localAmount) × v_target / v_closing  [flagged residual];
--      fallback chain: average→closing; layers→currency.historicalExchangeRate→closing;
--      closing→currency.exchangeRate ('spot-fallback')→NULL ('missing'). Never 1.

-- 7. Seed the two periodCloseTaskDefinition system rows per company
--    ('fx-revaluation', 'fx-rate-coverage'; Auto, Warning) + seed-company for new companies.
```

## API / Service Changes

`apps/erp/app/modules/accounting/accounting.service.ts` (+ zod in `accounting.models.ts`):

```ts
// Revaluation
buildCurrencyRevaluationRun(client, { companyId, periodId, userId })   // compute exposures → Draft run + lines
postCurrencyRevaluationRun(client, { runId, companyId, userId })       // both journals atomically; enforce next period exists & not Closed
voidCurrencyRevaluationRun(client, { runId, companyId, userId })       // reverse both journals; run → Voided
getCurrencyRevaluationRuns(client, companyId, { periodId? })

// Rate coverage + history
getExchangeRateCoverage(client, companyGroupId, { periodStart, periodEnd })
// → per-currency { hasClosing, closingStaleDays, hasAverage } — backs 'fx-rate-coverage'
// getExchangeRateHistory: existing, unchanged

// CTA
postCurrencyTranslationAdjustment(client, { companyGroupId, eliminationCompanyId, periodEnd, userId })
// movement = live cumulative CTA − posted CTA balance; 2-line journal on the elimination entity

// Consolidation
// getConsolidatedBalances: returns { data, cta: { postedBalance, unpostedResidual }, warnings: RateWarning[] }
// translateCompanyBalances: passes through netChange/translatedNetChange/rateSource

// Historical layers
get/upsert/deleteHistoricalRateLayer(...)   // manual opening layers + rate fixes for NULL-rate captures

// getPeriodCloseReadiness: two new evaluators keyed 'fx-revaluation', 'fx-rate-coverage'
```

`packages/jobs/src/inngest/functions/scheduled/update-exchange-rates.ts`: after the currency upsert loop, one `exchangeRateHistory` upsert per (group, currency, today) quoted against the group presentation currency; groups deduplicated across their member integrations; failures logged per group without aborting the loop.

Edge functions: none touched — revaluation and CTA post through the app-side journal services (`source: "accounting"`).

## UI Changes

- **Currency Revaluation** page under `routes/x+/accounting+/` : period picker → exposure preview table (per line: document, currency, source open amount, booked vs revalued base, gain/loss) → Post / Void; linked from the close-checklist task's drill-down.
- **Close checklist**: the two new Auto tasks render with drill links (revaluation page; rate-coverage detail listing missing currencies/days).
- **Consolidated balance sheet**: `'3200'` lookups deleted; CTA row sourced from GL by `accountDefault.currencyTranslationAccount` id; offset account suppressed; "Unposted translation adjustment" residual row when non-zero; rate-coverage warning banner (currencies + `rateSource` fallbacks in play).
- **Translated income statement / trial balance**: switch to `translatedNetChange` for the statement window.
- **Account settings**: `AccountDefaultsForm` gains the five new selects; historical-layer editor on Historical-rate accounts (list layers, add opening layer, fill NULL rates).

## Acceptance Criteria

Numeric master case — company base USD, EUR invoice of €1,100 posted at rate 1.10 (EUR per USD ⇒ booked base $1,000.00), open at period end 2026-07-31, closing rate 1.05:

- [ ] AR run: revalued base = 1,100 ÷ 1.05 = **$1,047.62**; period-end journal Dr `arRevaluationAccount` 47.62 / Cr `unrealizedExchangeGainAccount` 47.62 dated 2026-07-31; reversal Dr gain / Cr adjustment dated 2026-08-01; both `sourceType 'Currency Revaluation'`, linked via `reversedById`; AR **control account balance unchanged** and AR tie-out RPC still passes.
- [ ] Same facts as AP: unrealized **loss** 47.62 — Dr `unrealizedExchangeLossAccount` / Cr `apRevaluationAccount`.
- [ ] EUR bank account with source balance €10,000 booked at $9,090.91: revaluation posts Dr bank GL $432.90 / Cr unrealized gain (10,000 ÷ 1.05 = 9,523.81); bank rec on the account is unaffected (revaluation line has `sourceAmount = 0`).
- [ ] Second Posted run for the same (company, period) is rejected; Void reverses both journals and permits a re-run; posting is blocked when the next period is Closed.
- [ ] 'fx-revaluation' auto-check: fails for a period with open FX exposure and no Posted run; passes after posting; passes vacuously for a company with no FX exposure.
- [ ] Daily job appends one `exchangeRateHistory` row per (group, enabled currency, day) with `baseCurrencyCode` = group presentation currency; re-run same day upserts, no duplicates.
- [ ] With zero rate coverage, the consolidated balance sheet shows a warning banner naming the uncovered currencies and no figure is produced from an implicit rate 1 (`rateSource` ∈ {'spot-fallback','missing'} surfaces per currency); 'fx-rate-coverage' auto-check fails, and passes once closing + in-period rates exist.
- [ ] `translateTrialBalance` returns `netChange`/`translatedNetChange`; a EUR subsidiary's translated income statement for July equals July activity ÷ July average rate — not life-to-date.
- [ ] `postCurrencyTranslationAdjustment` posts the CTA movement on the elimination entity to the account resolved from `accountDefault.currencyTranslationAccount` (grep confirms no `"3200"` literal remains in app code); after posting, the consolidated residual line is ~0 and the CTA account balance rolls into the next period.
- [ ] Posting equity of €500,000 on a `consolidatedRate = 'Historical'` account at rate 1.25 auto-captures a layer (localAmount = base amount, rate 1.25 basis); translation at a later closing rate 1.05 still values that tranche at its layer rate; a second tranche at a different rate translates independently; residual without a layer falls back to closing with a `rateSource` flag.
- [ ] Regression: single-currency companies see byte-identical journals and reports (no exposure ⇒ no run; rate(base)=1 ⇒ translation unchanged).
- [ ] `pnpm run generate:types` then `pnpm exec turbo run typecheck --filter=@carbon/erp --filter=@carbon/jobs` pass.

## Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| As-of-date open-balance reconstruction (invoice balance at period end from settlements) diverges from live view balances | Med | Reuse the settlement-dated derivation the aging/tie-out RPCs use; acceptance test with a post-period-end settlement |
| `ALTER TYPE ... ADD VALUE` cannot run inside the same transaction as usage | Low | Separate migration file for the enum values, ordered first (existing repo precedent) |
| Layer-capture trigger adds write-path latency on every posting | Low | Fires only for Historical-rate accounts (rare); simple insert; index on `account.consolidatedRate` predicate |
| Rate-source API rate limits when appending history per group | Low | One fetch per day already; history append reuses the fetched/cached rates, no extra API calls |
| CTA offset account confuses users if surfaced | Low | `isSystem`, excluded from consolidated statements by id, named explicitly; docs note it mirrors CTA |
| Groups whose elimination entity base ≠ presentation currency | Med | Guard in `postCurrencyTranslationAdjustment`: refuse with explicit error (see open question) |

## Open Questions

> HARD STOP: Do not proceed with implementation until the unchecked items are answered.

- [x] Auto-reversing vs delta revaluation? — **Auto-reversing** (SAP-style), per readiness roadmap resolution.
- [x] Direct-on-account vs adjustment-account presentation? — **Adjustment accounts for AR/AP, direct for bank GL** (Design Decision 2).
- [x] Fabricate rate-history backfill? — **No**; honest NULL + coverage warnings.
- [x] Keep the rate-1 fallback? — **No**; spot-fallback with flag, then NULL + warning.
- [x] CTA posting mechanics? — **Two-line elimination-entity journal with excluded offset account**; full consolidation ledger deferred (Design Decision 6).
- [x] Historical rates per currency or per transaction? — **Per-transaction layers**, trigger-captured; `currency.historicalExchangeRate` demoted to deprecated fallback.
- [x] Checklist severity for the two new tasks? — **Warning**, hardenable per company via the template.
- [x] Do all existing company groups have an elimination entity whose base currency equals the group presentation currency (root-company base)? If not, is refusing CTA posting with an error acceptable for v1, or must the journal convert? — **Answer (Brad, 2026-07-04, ambition heuristic — be ambitious and thorough; back out at /plan stage if needed):** Migration audits all groups and auto-provisions/repairs elimination entities to the group presentation currency; the refuse-with-actionable-error path remains only as a runtime guard.
- [x] Unapplied-payment exposure reads `payment.totalAmount` — the convention-normalization spec left base-vs-document denomination of that column as its own open question. Confirm its resolution (spec assumes **base** + derived document amount) before implementing the Payment/Memo exposure types. — **Answer (Brad, 2026-07-04, ambition heuristic — be ambitious and thorough; back out at /plan stage if needed):** Adopt whatever #1030 (FX convention normalization) resolves — this spec reads exposure through a shared helper so either convention works; confirm during #1030 execution (dependency noted).

## Changelog

- 2026-07-04: Created from readiness findings SD-4/SD-5 (`2026-07-03-public-company-readiness.md`), research §Pattern 5 (SAP FAGL_FCV/FAGL_FC_TRANS, NetSuite revalue-open-balances + consolidated rate types), and code verification (`exchangeRateHistory` writer absence, `balance-sheet.tsx` '3200' plug, `translateTrialBalance` rate-1 fallbacks). Resolutions baked in per tracking issue crbnos/carbon#1050.
- 2026-07-04: Remaining open questions resolved under the program ambition heuristic (ambitious scope now; back-out valves at plan stage).
