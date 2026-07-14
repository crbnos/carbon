# Multi-Book Accounting — Adjustment-Only Books (GAP-5)

> Status: in-progress
> Author: Claude (with Brad Barbin)
> Date: 2026-07-04
> Tracking issue: [crbnos/carbon#1052](https://github.com/crbnos/carbon/issues/1052)
> Readiness finding: GAP-5 (`.ai/specs/2026-07-03-public-company-readiness.md`), design decision 5
> Research: `.ai/research/public-company-compliance.md` §Pattern 2
> Depends on: #1047 record integrity & audit hardening (seeds `journal.bookId` + `accountingBook` + `accountingBookCompany`; its spec is being written in parallel — the DDL below is the shared contract, reconcile before either implements)

## TLDR

Carbon today has one implicit ledger: every journal is "the book." A multi-national files statutory accounts under local GAAP/IFRS while the group reports US GAAP — the same lease, the same inventory write-down, and the same machine produce different numbers per accounting principle. This spec adds **NetSuite-style adjustment-only books** on the header-level `journal.bookId` seeded by #1047: the PRIMARY book keeps receiving 100% of operational postings, and each adjustment book stores only **deltas** (book-scoped manual JEs, book-specific depreciation deltas, and generator-produced adjustments for IAS 2 NRV reversals and IFRS 16 lease differences). Reports gain a book perspective — PRIMARY, a single book's deltas, or PRIMARY+book combined — labeled by each book's accounting principle (US-GAAP | IFRS | Local | Tax). Books are defined at the company-group level and enabled per company; adjustment books close with the company's period via book-scoped close-checklist tasks. The SAP full-ledger fan-out approach (every posting duplicated per ledger) is explicitly rejected.

## Problem Statement

- **One implicit book.** `journal` has no book dimension (pre-#1047); `trialBalance` / `accountTreeBalancesByCompany` (`20260315000001`) aggregate all journal lines as a single population. There is no way to state "IFRS balance sheet" vs "US GAAP balance sheet" for the same entity.
- **Concrete divergences already queued.** (a) IAS 2 requires NRV write-down reversals that US GAAP forbids — the inventory valuation spec (#1040) blocks on this. (b) IFRS 16's single lease model vs ASC 842's operating/finance split — the lease spec (#1056) blocks on this. (c) Statutory depreciation (e.g., German tax lives, French statutory rates) diverges from US GAAP book depreciation — today's `fixedAsset` hardcodes exactly two books (book + tax columns) and can express nothing else.
- **The retrofit is the expensive part.** Research §Pattern 2: bolting a book dimension on later is one of the costliest ERP retrofits; NetSuite provisions Multi-Book via professional services because even they can't retrofit cheaply. #1047 lands the column while the posting surface is already being touched; this spec makes it do real work.

## Proposed Solution

### Book model: PRIMARY + adjustment-only deltas (NetSuite pattern)

- Every company group has exactly one **Primary** book (seeded by #1047's migration). All operational posting paths (edge functions, payments, inventory, production, existing depreciation runs) write it and never anything else.
- **Adjustment books** (`type = 'Adjustment'`) hold only deltas relative to Primary. A book's standalone TB is *just the adjustments*; the meaningful statements come from the **Combined** view: PRIMARY + book, summed per account.
- Adjustment books share the Primary book's chart of accounts, base currency, and period calendar. No book-specific COA mapping, calendars, or currencies in v1 (that is NetSuite's full secondary-book tier; adjustment-only books don't need it — research §Pattern 2).
- Definitions are **group-scoped** (like `account`, `20260228023426` pattern), enabled per company through `accountingBookCompany` — a statutory HGB book is defined once and enabled only for the German entity (resolved, Brad 2026-07-03).
- Each book carries an `accountingPrinciple` (`US-GAAP | IFRS | Local | Tax`) that drives report labeling ("Balance Sheet — IFRS (Combined: Primary + IFRS Adjustments)") and generator applicability.

### Book-scoped manual journal entries

`JournalEntryForm` gains a book selector (default Primary; adjustment books listed only when enabled for the company and the user has `accounting_create`). Manual JEs into adjustment books flow through the exact same lifecycle as Primary JEs: Draft → (Pending Approval, per #1032's rules — same rules, no per-book routing in v1) → Posted; posted-record immutability, reversal-only correction, gapless numbering, and the period-close trigger all apply identically because they operate on `journal` rows regardless of `bookId`.

### Reporting: three perspectives everywhere

`accountTreeBalancesByCompany` and `trialBalance` (and the financial-reporting spec's four-column TB / GL-detail queries) gain:

- `p_book_id TEXT DEFAULT NULL` — NULL means the group's Primary book.
- `p_book_mode TEXT DEFAULT 'Primary'` ∈ `('Primary', 'Book', 'Combined')`:
  - **Primary**: today's numbers — lines where the journal's book is Primary (backward-compatible default; existing callers unchanged).
  - **Book**: the adjustment book's deltas alone (reviewing what the book adds).
  - **Combined**: Primary + the selected book (the statutory/IFRS statements auditors receive).

TB, BS, IS, and GL-detail report filter bars gain a book picker (hidden when the company has no adjustment books enabled). GL-detail and the account drill-down drawer pass the same book parameters as their parent so the tie-out contract holds in every mode. The #1047 JE population export gains the same `bookId` filter + a `book` column on every row (already in its column contract); FEC/SAF-T for a statutory entity later export the Combined population of its statutory book (#1053).

### Book-specific depreciation

- New `fixedAssetBook` rows hold per-asset, per-book depreciation settings: method, useful life, residual %, start date, per-book accumulated depreciation. Absence of a row = the asset depreciates identically to Primary in that book (delta 0 — the common case, kept free).
- Book depreciation posts as **deltas**: for each period, the statutory-depreciation generator computes `bookDepreciation − primaryDepreciation` per asset and posts only the difference into the adjustment book (Dr/Cr depreciation expense / accumulated depreciation from the asset class accounts). Combined view = full statutory depreciation.
- Reuses the existing `depreciationRun` machinery with a nullable `bookId`: NULL = today's Primary runs (untouched); book runs are created by the generator, carry delta amounts per line, and post journals stamped with the book.
- The existing hardcoded tax columns on `fixedAsset` (`taxDepreciationMethod`, MACRS, `accumulatedTaxDepreciation`, deferred-tax posting) are untouched in v1; migrating them into a `Tax`-principle adjustment book is a candidate follow-up once this framework is proven (noted in Risks).

### Adjustment-generator framework

A registered-generator contract so subsystems produce book entries without inventing parallel machinery — mirroring the period-close spec's `autoCheckKey` evaluator pattern (code-level registry, persisted runs):

```ts
// apps/erp/app/modules/accounting/accounting.books.ts (registry)
type BookAdjustmentGenerator = {
  key: string;                    // 'statutory-depreciation' | 'ias2-nrv-reversal' | 'ifrs16-lease-delta'
  name: string;                   // display + close-task name
  appliesTo: (book: AccountingBook) => boolean;   // usually by accountingPrinciple
  generate: (args: {
    client: SupabaseClient<Database>;             // caller's client; RLS applies
    companyId: string;
    bookId: string;
    accountingPeriodId: string;
  }) => Promise<{ data: DraftAdjustmentJournal[] | null; error: PostgrestError | null }>;
};
```

- `generate` is **pure proposal**: it returns balanced draft journal payloads (`sourceType: 'Book Adjustment'`, `bookId`, `postingDate` = period end, line-level document references back to the driving records). It never posts. The framework inserts them as Draft journals, records a `bookAdjustmentRun` row (period × book × generator, journal ids, status), and the normal posting path (with approval gates when a rule matches) takes over.
- **Idempotent per (period, book, generator)**: re-running while a run is Draft regenerates (delete drafts, re-insert); re-running after Posted is refused — corrections are reversal + regenerate, consistent with immutability.
- **Named v1 consumers**: `statutory-depreciation` (ships with this spec, defined above); `ias2-nrv-reversal` (registered by the inventory valuation spec #1040 — reverses prior NRV write-downs where IAS 2 requires it and US GAAP posted none); `ifrs16-lease-delta` (registered by the lease spec #1056 — single-model vs 842 P&L difference per lease). The latter two specs own their computation; this spec owns the contract they register against.
- **Close-checklist integration**: for each enabled (book × applicable generator), the framework registers a `periodCloseTaskDefinition` (per the #1031 coordination rule — never a parallel checklist): Auto task "Generate {generator} adjustments — {book}", `autoCheckKey: 'book-adjustments'`, severity Warning. The auto-check passes when the `bookAdjustmentRun` for that period/book/generator is Posted or Skipped. Skips require a reason, as usual.

### Book-aware close

Adjustment books have **no separate period lifecycle** in v1: they close when the company's period closes (same `accountingPeriod.closeStatus`; the period-close trigger already blocks every journal, book journals included). Book-scoped readiness = the generator tasks above plus a `book-balanced` auto-check (each adjustment book's period delta sums to zero — every book is internally double-entry; the #1047 balance trigger enforces this per journal, the check surfaces it per book). SAP-style special periods 13–16 are explicitly not adopted — adjustment JEs into an open period 12 achieve the same end under Carbon's model.

### Guardrails (the v1 boundary)

1. **System posting paths always write PRIMARY.** No edge function, payment builder, or inventory poster accepts a `bookId`; the `journal` BEFORE INSERT trigger stamps the group's Primary book when `bookId` is NULL.
2. **Adjustment books never receive operational postings.** DB trigger: a journal whose book is `type = 'Adjustment'` must have `sourceType IN ('Manual', 'Book Adjustment', 'Asset Depreciation')` and its book must be enabled for the journal's company (`accountingBookCompany`). Everything else is raised at the DB, binding the service role.
3. **Consolidation and translation read PRIMARY only in v1.** `translateTrialBalance`, eliminations, and consolidated statements are unchanged (they see Primary because that's the default mode). Consolidated Combined views (translate Primary+book per subsidiary, e.g., group IFRS consolidation) are explicitly deferred to the FX/consolidation completeness work (#1050/#1058) — the RPC parameters added here make that a parameter-plumbing exercise, not a schema change.
4. **Integrations (Xero sync, MCP posting tools, JE import #1059) read/write PRIMARY** unless they explicitly pass an enabled adjustment book with `accounting_create`; the trigger in (2) backstops them regardless.
5. **Virtual year-end needs nothing:** RE/Net-Income are computed from lines at report time, so each book mode's equity computes correctly by construction.

### Design Decisions

| # | Decision | Choice | Rationale |
|---|----------|--------|-----------|
| 1 | Ledger architecture | NetSuite **adjustment-only books** (deltas on Primary), not SAP ledger fan-out (every posting duplicated per ledger) | Readiness DD-5 + research §Pattern 2; deltas keep operational posting single-path (no N× journal volume, no fan-out bugs); SAP's extension ledgers are themselves the delta admission; full secondary books (own COA/currency/calendar) are a later tier if ever |
| 2 | Book placement | Header-level `journal.bookId` (one journal = one book), never line-level | Readiness DD-5; matches NetSuite book JEs / SAP ledger-group posting; keeps the per-journal balance trigger (#1047) meaningful per book |
| 3 | Book scoping | Group-scoped `accountingBook` + per-company `accountingBookCompany` enablement | Resolved Brad 2026-07-03; mirrors the shared-COA pattern (`account.companyGroupId`) |
| 4 | Primary default mechanics | BEFORE INSERT trigger resolves the group's Primary book when `bookId` IS NULL (not a static column DEFAULT) | A static `DEFAULT 'PRIMARY'` (readiness sketch) can't point at per-group seeded rows; trigger keeps every existing writer correct with zero code changes |
| 5 | Generator registry | Code-level registry + persisted `bookAdjustmentRun` rows | Same shape as close-checklist `autoCheckKey` evaluators; generators need code anyway; runs table gives idempotency + close evidence |
| 6 | Generators propose, posting disposes | Generators emit Draft journals; normal post path (approvals, immutability, numbering, period gates) applies | One posting pipeline; adjustment entries get the full Phase-0 control stack for free |
| 7 | Book depreciation vehicle | Reuse `depreciationRun` with nullable `bookId`; lines carry **delta** amounts | Existing UI/posting machinery; NULL keeps current behavior byte-identical; delta semantics follow decision 1 |
| 8 | Book close lifecycle | Shared with the company period; book-scoped tasks on the existing close checklist | #1031 coordination rule (register task definitions, never parallel checklists); a per-book period state machine is complexity with no v1 consumer |
| 9 | Multi-tenancy heuristic | `accountingBook` group-scoped (single-col PK + `companyGroupId`, like `account`); `accountingBookCompany`/`fixedAssetBook`/`bookAdjustmentRun` company-scoped with composite PK `("id","companyId")`, `id('prefix')`, audit columns | Repo conventions; definitions shared, activity per-tenant |
| 10 | Service shape | New functions in `modules/accounting/accounting.service.ts` + `accounting.models.ts` (`(client, companyId, ...)` → `{data, error}`, never throw); generator registry + posting transaction in `accounting.server.ts` | One service/models file per module — never scattered |
| 11 | RLS | Four named policies per new table; SELECT via `get_companies_with_employee_role()` (group tables: group-membership helper per `20260228023426`), writes via `get_companies_with_employee_permission('accounting_*')` | `packages/database/AGENTS.md` conventions |
| 12 | Permissions | Book definitions/enablement = `accounting_update` (settings-tier); book JEs/generator runs = existing `accounting_create`/`accounting_update`; no new permission actions | Follows period-closing precedent of reusing accounting tiers |
| 13 | Forms/UI pattern | `ValidatedForm` + zod validators; book picker as a `Select` on existing report filter bars; new settings page under `routes/x+/accounting+/books*` | `conventions-forms.md` / existing accounting settings precedent |
| 14 | Backward compatibility | Additive only: RPC params default to `'Primary'` mode reproducing today's numbers; `depreciationRun.bookId` NULL = today; no operational poster changes | The whole point of adjustment-only: PRIMARY is untouched |

## Data Model Changes

One migration (`pnpm db:migrate:new multi-book-adjustment-books`, randomized HHMMSS, idempotent), then `pnpm run generate:types`. The first block is the **shared #1047 contract** — whichever spec's migration lands first creates these; this spec's migration guards with IF NOT EXISTS.

```sql
-- ── Shared with #1047 (record integrity) — the book seed ─────────────────
CREATE TABLE IF NOT EXISTS "accountingBook" (
  "id" TEXT NOT NULL DEFAULT id('book'),
  "companyGroupId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "type" TEXT NOT NULL DEFAULT 'Adjustment',       -- 'Primary' | 'Adjustment'
  "accountingPrinciple" TEXT NOT NULL DEFAULT 'Local',  -- 'US-GAAP' | 'IFRS' | 'Local' | 'Tax'
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  "customFields" JSONB,
  CONSTRAINT "accountingBook_pkey" PRIMARY KEY ("id"),   -- group-scoped like "account"
  CONSTRAINT "accountingBook_companyGroupId_fkey" FOREIGN KEY ("companyGroupId")
    REFERENCES "companyGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "accountingBook_name_key" UNIQUE ("name", "companyGroupId"),
  CONSTRAINT "accountingBook_type_check" CHECK ("type" IN ('Primary','Adjustment')),
  CONSTRAINT "accountingBook_principle_check"
    CHECK ("accountingPrinciple" IN ('US-GAAP','IFRS','Local','Tax'))
);
-- Exactly one Primary per group
CREATE UNIQUE INDEX IF NOT EXISTS "accountingBook_one_primary_idx"
  ON "accountingBook" ("companyGroupId") WHERE "type" = 'Primary';
-- Seed: one Primary book per existing companyGroup (accountingPrinciple 'US-GAAP')

CREATE TABLE IF NOT EXISTS "accountingBookCompany" (
  "id" TEXT NOT NULL DEFAULT id('bkco'),
  "companyId" TEXT NOT NULL,
  "bookId" TEXT NOT NULL REFERENCES "accountingBook"("id") ON DELETE CASCADE,
  "effectiveFrom" DATE,                            -- book adoption date (see decision below)
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  CONSTRAINT "accountingBookCompany_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "accountingBookCompany_companyId_fkey" FOREIGN KEY ("companyId")
    REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "accountingBookCompany_book_company_key" UNIQUE ("bookId", "companyId")
);
-- Seed: Primary book enabled for every company in its group

ALTER TABLE "journal" ADD COLUMN IF NOT EXISTS "bookId" TEXT REFERENCES "accountingBook"("id");
CREATE INDEX IF NOT EXISTS "journal_bookId_idx" ON "journal" ("bookId", "companyId");
-- Backfill existing journals to the group's Primary book; then SET NOT NULL.
-- BEFORE INSERT trigger "journal_default_book": when NEW."bookId" IS NULL,
-- resolve the company's group Primary book (design decision 4).

-- ── This spec ─────────────────────────────────────────────────────────────
-- Guardrail trigger (SECURITY DEFINER, binds service role — period-close precedent):
-- on journal INSERT/UPDATE where the book is type 'Adjustment':
--   * sourceType must be IN ('Manual', 'Book Adjustment', 'Asset Depreciation')
--   * (bookId, companyId) must exist in "accountingBookCompany"
-- else RAISE EXCEPTION.

ALTER TYPE "journalEntrySourceType" ADD VALUE IF NOT EXISTS 'Book Adjustment';

CREATE TABLE IF NOT EXISTS "fixedAssetBook" (
  "id" TEXT NOT NULL DEFAULT id('fab'),
  "companyId" TEXT NOT NULL,
  "fixedAssetId" TEXT NOT NULL,
  "bookId" TEXT NOT NULL REFERENCES "accountingBook"("id") ON DELETE CASCADE,
  "depreciationMethod" "depreciationMethod" NOT NULL DEFAULT 'Straight Line',
  "usefulLifeMonths" INTEGER NOT NULL,
  "residualValuePercent" NUMERIC NOT NULL DEFAULT 0,
  "depreciationStartDate" DATE,
  "accumulatedDepreciation" NUMERIC NOT NULL DEFAULT 0,   -- full book-basis accumulated
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  "customFields" JSONB,
  CONSTRAINT "fixedAssetBook_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "fixedAssetBook_companyId_fkey" FOREIGN KEY ("companyId")
    REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "fixedAssetBook_asset_book_key" UNIQUE ("fixedAssetId", "bookId", "companyId")
);

ALTER TABLE "depreciationRun" ADD COLUMN IF NOT EXISTS "bookId" TEXT
  REFERENCES "accountingBook"("id");                -- NULL = Primary run (unchanged)

CREATE TABLE IF NOT EXISTS "bookAdjustmentRun" (
  "id" TEXT NOT NULL DEFAULT id('bar'),
  "companyId" TEXT NOT NULL,
  "bookId" TEXT NOT NULL REFERENCES "accountingBook"("id"),
  "accountingPeriodId" TEXT NOT NULL REFERENCES "accountingPeriod"("id"),
  "generatorKey" TEXT NOT NULL,                     -- registry key
  "status" TEXT NOT NULL DEFAULT 'Draft',           -- 'Draft' | 'Posted' | 'Skipped'
  "journalIds" TEXT[] NOT NULL DEFAULT '{}',
  "skippedReason" TEXT,
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  CONSTRAINT "bookAdjustmentRun_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "bookAdjustmentRun_companyId_fkey" FOREIGN KEY ("companyId")
    REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "bookAdjustmentRun_unique_key"
    UNIQUE ("accountingPeriodId", "bookId", "generatorKey", "companyId"),
  CONSTRAINT "bookAdjustmentRun_status_check" CHECK ("status" IN ('Draft','Posted','Skipped'))
);
```

RLS per conventions on all new tables; all are added to audit-log coverage (they are accounting entities — #1047's always-on synchronous class). RPC changes: `accountTreeBalancesByCompany` + `trialBalance` gain `p_book_id TEXT DEFAULT NULL, p_book_mode TEXT DEFAULT 'Primary'` (filter joins `journal."bookId"`; coordinate with the financial-reporting redefinition that adds `p_include_drafts`). **Book enablement mid-life:** enabling a book for a company sets `effectiveFrom`; divergence before that date enters as an opening catch-up — the statutory-depreciation generator's first run posts the accumulated delta as a flagged catch-up line, and other openings are book-scoped manual JEs.

## API / Service Changes

- `accounting.models.ts`: `accountingBookValidator`, `accountingBookCompanyValidator`, `fixedAssetBookValidator`, `bookAdjustmentRunValidator`; `bookModes` / `accountingPrinciples` const arrays.
- `accounting.service.ts`: book CRUD (`getAccountingBooks`, `upsertAccountingBook`, `getEnabledBooks(client, companyId)`), enablement toggle, `getFixedAssetBooks`/`upsertFixedAssetBook`, `getBookAdjustmentRuns`; balance/TB/GL-detail service callers pass `bookId`/`bookMode` through to the RPCs.
- `accounting.server.ts`: generator registry + `runBookAdjustmentGenerator(client, {companyId, bookId, periodId, key})` (Kysely transaction: idempotency check → `generate` → insert Draft journals + `bookAdjustmentRun`); `statutory-depreciation` generator (wraps `buildDepreciationLines` twice — book settings vs primary settings — and emits the per-asset delta as a `depreciationRun` with `bookId` + `'Book Adjustment'`-sourced draft journals); `postDepreciationRun` stamps `journal.bookId` from the run.
- `postJournalEntry`: accepts and preserves `bookId` (guardrail trigger backstops); approval gate (#1032) applies unchanged.
- Close: register `periodCloseTaskDefinition` rows per enabled (book × applicable generator) + the `book-balanced` auto-check in `getPeriodCloseReadiness`.
- Routes: `x+/accounting+/books.tsx` (+ `books.new`, `books.$bookId`), enablement intent actions; report loaders read `book`/`bookMode` search params.

## UI Changes

- **Settings → Accounting → Books**: list/create/edit books (name, principle, active), per-company enablement with `effectiveFrom`.
- **Journal entry form**: book `Select` (enabled adjustment books + Primary), badge on JE tables/detail for non-Primary journals.
- **Reports (TB/BS/IS/GL-detail)**: book picker + mode toggle (Primary / Book only / Combined) on the filter bars; report headers label the perspective and the book's accounting principle; drill-down drawer inherits parent parameters.
- **Fixed asset detail**: "Books" section listing per-book depreciation settings (add/edit `fixedAssetBook` rows).
- **Period close drawer**: generator tasks appear per enabled book with Generate/Skip actions and links to the produced draft journals.

## Acceptance Criteria

- [ ] With no adjustment books enabled, every report, RPC result, and posting path is byte-identical to pre-migration behavior (Primary default mode reproduces today's numbers; regression: TB/BS/IS snapshots match).
- [ ] An operational posting (e.g., `post-purchase-invoice`) lands on the Primary book with no code passing `bookId`; a direct service-role INSERT of an `'Purchase Invoice'`-sourced journal into an adjustment book is rejected by the guardrail trigger.
- [ ] A manual JE posted into an enabled IFRS adjustment book: appears in Book mode TB as the only rows; Combined TB = Primary TB + those rows per account; Primary TB unchanged. Posting into a non-enabled book is rejected at the DB.
- [ ] Book JEs respect the full control stack: approval rule gates posting, posted book journals are immutable (reversal-only), period-close trigger blocks book postings into a Closed period.
- [ ] An asset with `fixedAssetBook` settings (e.g., 60-month statutory life vs 120-month primary) gets a generator-created book depreciation run whose line amount equals bookDepreciation − primaryDepreciation for the period; posting it yields a Combined accumulated depreciation equal to the full statutory schedule; an asset with no `fixedAssetBook` row produces no delta line.
- [ ] Enabling a book mid-asset-life produces a flagged catch-up delta equal to the accumulated divergence through the prior period on the first generator run.
- [ ] Generator idempotency: re-running a Draft run regenerates (no duplicate drafts); re-running a Posted run is refused with a reversal-first error.
- [ ] Close checklist for a company with an enabled book shows the generator task(s); the task auto-passes only when the run is Posted/Skipped; `book-balanced` fails if an adjustment book's period delta ≠ 0 (constructible only pre-#1047-balance-trigger; test via fixture).
- [ ] Report headers label perspective + principle (e.g., "IFRS — Combined"); CSV/PDF exports carry the same label; JE export rows carry the correct book and filter by it.
- [ ] Consolidated statements and `translateTrialBalance` outputs are unchanged regardless of enabled books (v1 boundary).
- [ ] `pnpm exec turbo run typecheck --filter=erp` (+ database package) passes after `pnpm run generate:types`.

## Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| Contract drift with the parallel #1047 spec (shared `accountingBook`/`accountingBookCompany`/`journal.bookId` DDL) | High | This section is the canonical DDL; both specs cite it; idempotent IF NOT EXISTS guards; reconcile in whichever PR lands second |
| RPC redefinition collision (financial-reporting adds `p_include_drafts` to the same functions) | Med | Coordinate parameter order in one migration wave after #1035 lands (meta-spec coordination rule for shared surfaces) |
| Delta semantics misunderstood by users (Book-only TB "looks wrong") | Med | Default mode is Combined when a book is selected; Book-only labeled "Adjustments only"; docs + report captions |
| Statutory depreciation catch-up posts a large first-period delta | Med | Catch-up line flagged + surfaced in the run review before posting; `effectiveFrom` documented as "diverge from this date" |
| Existing tax-depreciation columns now overlap conceptually with a `Tax` book | Low | Untouched in v1; consolidation of the two models is a named follow-up, not silent behavior change |
| Report query cost of the extra `journal.bookId` join/filter | Low | `journal_bookId_idx (bookId, companyId)`; Primary mode uses the same plan shape as today |

## Open Questions

> HARD STOP: Do not proceed with implementation until these are answered.

Program-level resolutions (recorded — no re-litigation):

- [x] **Scope: minimal (manual book JEs only) vs ambitious (depreciation + generator framework + book reporting)?** — **Resolved (Brad, 2026-07-04): "yes / more ambitious."** Full cut as spec'd: adjustment books + book reporting modes, book-specific depreciation, the generator framework with three named consumers, book-aware close, principle labeling, and the PRIMARY-only guardrails.
- [x] **Ledger architecture** — **Resolved (readiness DD-5 + research §Pattern 2):** NetSuite adjustment-only books on header-level `journal.bookId`; SAP full-ledger fan-out rejected.
- [x] **Book scoping** — **Resolved (Brad, 2026-07-03):** group-scoped definitions with per-company enablement (`accountingBookCompany`), mirroring the shared-COA pattern.
- [x] **Accounting principle attribute** — **Resolved (program scope, 2026-07-04):** `accountingPrinciple ∈ (US-GAAP | IFRS | Local | Tax)` per book, driving report labeling and generator applicability.
- [x] **Consolidation boundary** — **Resolved (program scope, 2026-07-04):** v1 consolidation/translation reads PRIMARY only; consolidated book overlays deferred to #1050/#1058 with the RPC parameters as the ready substrate.

No genuinely new blocking questions — the two judgment calls surfaced while writing (mid-life book enablement catch-up mechanics; reuse of `depreciationRun` for book runs) are resolved as design decisions 7 and the `effectiveFrom` catch-up rule above, both reversible before implementation review.

## Changelog

- 2026-07-04: Created. Scope resolved "more ambitious" by Brad 2026-07-04; book scoping resolved 2026-07-03. Shared-seed DDL contract published for #1047 (parallel spec) to adopt. Generator consumers #1040 (IAS 2 NRV) and #1056 (IFRS 16) register against the contract defined here.
