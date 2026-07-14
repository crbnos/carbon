# Bank Reconciliation & Cash Management

> Status: in-progress
> Author: Claude (with Brad Barbin)
> Date: 2026-07-02
> Research notes: `.ai/research/bank-reconciliation.md`

## TLDR

Carbon can now record cash (`payment`/`memo`/`invoiceSettlement`, shipped 2026-06-30) but cannot prove it: no bank-account master data, no statement ingestion, no reconciliation, no visibility into what the bank actually says. This spec builds a full banking layer in the accounting module — and aims past NetSuite parity, not at it. A `bankAccount` master (depository **and credit card**, base **and foreign currency**) links 1:1 to a GL account; immutable `bankTransaction` statement lines arrive via **Plaid** (Link → `/transactions/sync`, webhook-driven, plus daily balance snapshots) or **file upload in all five industry formats** (CSV, OFX/QFX, BAI2, MT940, CAMT.053 — the NetSuite import matrix). Matching is layered: a conservative deterministic core (exact amount + date window + NetSuite's exactly-one-candidate rule, many-to-many match groups, class-aware sign normalization so credit cards work), a **bank rules engine** (condition → coding, suggest or auto-post — NetSuite auto-create rules), configurable **tolerance auto-adjustment** (Xero's minor adjustment), **cross-account transfer detection**, and an **intelligence layer** that leapfrogs the incumbents: counterparty resolution against existing pgvector embeddings, LLM-suggested coding for unrecognized lines, and one-click "memorize as rule". Foreign-currency accounts are supported properly by adding source-currency amount columns to `journalLine` (the root-cause fix, not a workaround). The close-out is statement-based with a difference-must-be-zero gate, an optional **preparer→approver workflow** (segregation of duties), a generated **PDF reconciliation report** for the audit binder, and a one-click auto-complete when a period fully ties. A cash position page shows bank-vs-GL drift per account daily — so reconciliation drift surfaces the day it happens, not at month-end. Ships in four independently valuable phases.

## Problem Statement

A controller using Carbon today cannot answer "does our GL cash balance match the bank?" without exporting the journal to a spreadsheet:

- The month-end close (period-close lifecycle spec, in flight) has no cash-verification step. A check recorded at $4,530 that cleared at $4,350, a duplicate ACH, or an unrecorded bank fee sits silently in the GL bank account forever — discovered, if ever, at year-end audit.
- `payment.bankAccount` points at a GL `account` row (`accountType = 'Bank'`), but there is no bank-account entity — no bank name, masked number, currency, feed connection, or opening balance. There is nothing to reconcile *against*.
- There is no ingestion path for bank data (no feed, no statement upload), no matching, no reconciliation artifact for auditors, and no cash visibility beyond a trial-balance line.

Every serious ERP treats this as core accounting: SAP EBS imports MT940/BAI/CAMT.053 and clears GL items via code-driven posting rules; NetSuite pairs aggregator bank feeds and file import (CAMT.053/MT940/BAI2/OFX) with Intelligent Transaction Matching, rule tiers, and a two-stage Match → Reconcile flow; Xero/QBO made match-create-exclude the small-business standard. Meanwhile the modern fintech stack (Ramp, Mercury, Digits) shows what those incumbents lack: live feeds with drift alerts, ML counterparty resolution, and continuous close. Carbon should ship the mid-market ERP core *and* the modern layer — it already has the ingredients (pgvector embeddings with match functions, an AI SDK, an event system, a PDF pipeline).

## Proposed Solution

### Entity model

New tables in the accounting module (full SQL below):

| Entity | Purpose | Identity |
|--------|---------|----------|
| `bankAccount` | Master record: name, bank, last-4, type (Checking/Savings/**Credit Card**/Other), currency, **1:1 GL account link**, opening balance, feed linkage + health | `id('bka')` |
| `bankStatementImport` | One row per uploaded file: format, storage path, counts, statement balances when the format carries them | `id('bsi')` |
| `bankTransaction` | One immutable statement line: date, signed amount in **account currency** (positive = inflow), description, reference, provider-stable `externalId`, resolved counterparty, status lifecycle | `id('btx')` |
| `bankMatchGroup` (+ two membership tables) | **Many-to-many** match: N bank lines ↔ M journal lines, with match type (Auto/Rule/Manual), optional tolerance-adjustment journal reference | `id('bmg')` |
| `bankRule` | Ordered coding rules: conditions (description pattern, direction, amount range, account scope) → action (GL account, counterparty, memo; suggest or auto-post) | `id('brl')` |
| `bankReconciliation` | Statement close-out: statement date, starting/ending balance, Draft → In Review → Completed → Voided, preparer/approver, generated report path, readable ID (`REC-`) | `id('brc')` |
| `bankAccountBalance` | Daily balance snapshot per account (from Plaid or statement close) powering the drift view | `xid()` |

The match target is the **journal line**, not the business document: everything that touches the bank GL account — payments, manual JEs, any future source — is a posted `journalLine` on `bankAccount.glAccountId`, so matching covers all sources uniformly (SAP clears at GL level; NetSuite matches "account transactions"). Sign comparison is **class-aware**: for Asset accounts, positive `journalLine.amount` = debit = inflow, matching `bankTransaction.amount` directly; for Liability accounts (credit cards), the comparison inverts (positive = credit = new charge = negative statement direction). One normalization helper, used everywhere, makes credit-card accounts first-class instead of a special case.

### Foreign currency, fixed at the root

Carbon posts journal lines in base currency only, which makes accurate matching against a EUR statement impossible today. Rather than restricting to base-currency accounts (NetSuite's hard constraint — it fails imports on currency mismatch), fix the root cause:

- Add nullable `sourceAmount NUMERIC` + `sourceCurrencyCode TEXT` to `journalLine`. **Population is mandatory for every posting path, not best-effort** (upgraded per the public-company readiness audit, `.ai/specs/2026-07-03-public-company-readiness.md` SD-4: France FEC and SAF-T exports require the transaction-currency amount on every journal line, and ASC 830 remeasurement needs it — retrofitting universal population later means touching every poster twice). Every `post-*` edge function and app-side posting service writes the document currency + amount on every line it creates (base-currency documents write the base amount + base currency code — cheap and explicit); the manual JE form gains optional FX entry defaulting to base. Columns stay nullable only for pre-migration history, which backfills to NULL (unknown, honest).
- Matching compares in the **bank account's currency**: `sourceAmount` when `sourceCurrencyCode` equals the account currency, base `amount` when the account is base-currency. Lines with no source amount on a foreign-currency account fall back to suggestion-only (rate-converted via `exchangeRateHistory`, ±1% band) — never auto-matched.
- Existing rows backfill to NULL (unknown), which is honest; history reconciles manually or by suggestion.
- This also lays the schema groundwork for future FX revaluation of monetary accounts — a known gap that would otherwise force this same migration later.

### Statement line lifecycle

```
                    ┌─ Excluded ─(restore)─┐
Pending ──(posts)──▶ Unmatched ⇄ Matched ──▶ Reconciled
   └─(removed by feed: row deleted)          (via completed reconciliation;
                                              terminal unless rec is voided)
```

- **Pending** (Plaid): visible, unmatched-able, excluded from tie-outs. Posted replacement swaps in via `pending_transaction_id`; feed-removed pending rows are deleted.
- **Excluded**: feed noise/duplicates (QBO pattern); restorable; never blocks reconciliation.
- A feed that removes or restates an already-**Matched** line sets `needsReview` instead of deleting — surfaced prominently, resolved by a human.
- **Reconciled** lines and their match groups are immutable until their reconciliation is voided.

### Ingestion path 1 — Plaid bank feed

Xero-integration precedent throughout (registry in `packages/ee`, per-Item credentials in `companyIntegration.metadata`, webhook route, Inngest jobs):

1. **Connect**: server action creates a `link_token` (products `["transactions"]`); Plaid Link runs client-side; the exchange route swaps `public_token` → `access_token`/`item_id`, stores the access token in **Supabase Vault**, and appends `{ itemId, tokenSecretId, institutionName, cursor, status }` to `metadata.items[]` (no secret material in metadata). The user maps each Plaid account to a new or existing `bankAccount` (`plaidItemId`/`plaidAccountId`, `source = 'Plaid'`); account type and currency prefill from Plaid metadata.
2. **Transaction sync**: Inngest `bank-feed-sync` runs the `/transactions/sync` cursor loop (`added`/`modified`/`removed`, until `has_more = false`), upserts on `(bankAccountId, externalId = transaction_id)`, **inverts Plaid's sign** (Plaid positive = outflow), handles pending swaps and removals, persists the cursor, then runs the matching pipeline for affected accounts.
3. **Balance sync**: the same job records `/accounts/balance` into `bankAccountBalance` (one snapshot/day/account) — this powers the cash position page and drift alerts.
4. **Triggers**: `api+/webhook.plaid.ts` (JWT-verified via `Plaid-Verification`) fires sync on `SYNC_UPDATES_AVAILABLE` and initial/historical updates; a daily scheduled catch-up covers webhook loss; "Sync now" button for humans.
5. **Re-auth**: `ITEM_LOGIN_REQUIRED`/`ERROR` set the Item and its accounts to `Requires Reauth`; banner reopens Link in update mode.
6. **Backfill**: initial window 90 days by default, user-selectable up to Plaid's 24-month maximum at connect time.

### Ingestion path 2 — file upload, full format matrix

**v1 formats: CSV, OFX/QFX, BAI2, MT940, CAMT.053** — the NetSuite import matrix, and (via CAMT.053/MT940) SAP's EBS staples. Parsers are pure functions in the new `import-bank-statement` edge function, one fixture-tested module per format (the `post-payment.test.ts` Deno-test pattern), all emitting one normalized shape: `{ date, signedAmount, description, reference, externalId, balance? }`.

- Upload drawer per bank account: dropzone → format auto-detected by extension/content, CSV gets a column-mapping step (date, amount or debit/credit pair, description, reference) reusing the `ImportCSVModal` mapping UX → edge function downloads from `private/${companyId}/bank-statements/`, parses, dedupes, inserts transactionally, writes counts to `bankStatementImport`, runs the matching pipeline.
- **Dedupe**: `externalId` = OFX `FITID` / BAI2-MT940-CAMT bank reference when present; CSV falls back to `sha256(date|amount|description|reference)` + occurrence counter (identical legitimate rows within one file stay distinct; overlapping re-uploads skip). Unique on `(bankAccountId, externalId)`; duplicates count, never error.
- Statement opening/closing balances (MT940 field 60F/62F, BAI2 account trailers, CAMT.053 `Bal`, OFX ledger balance) are stored on the import and prefill the reconciliation drawer — and validate continuity against the previous statement's close.

### Matching pipeline

Layered, in strict order, after every sync/import and on demand. Deterministic layers are authoritative; intelligence only ever *suggests*.

1. **Deterministic auto-match** (Postgres function `run_bank_matching`, callable from app/jobs/edge — RPC precedent: `translateCompanyBalances`): candidates are posted, unmatched journal lines on the account's GL within ±7 days; amount exactly equal in the comparison currency; references must agree when both sides have one. **Exactly one candidate → match** (`matchType = 'Auto'`); two or more → nothing (NetSuite's ambiguity refusal). 1:1 only at this layer.
2. **Bank rules** (ordered, first-match-wins): a matching rule stamps the suggested coding (account + counterparty + memo) on the line; rules with `autoPost = true` **create-and-match** the JE immediately (NetSuite auto-create; intended for deterministic recurring items — bank fees, interest, loan payments). Auto-posted JEs go through the normal period gates.
3. **Tolerance adjustment** (off by default): when `companySettings.bankMatchToleranceAmount > 0`, a near-miss within tolerance auto-matches and books the difference to `accountDefault.bankFeesAccount` as a linked adjustment JE referenced on the match group (Xero minor adjustment / SAP tolerance groups). Every adjustment is visible on the group and the report.
4. **Transfer detection**: opposite-signed lines of equal amount within ±3 days across two of the company's bank accounts propose a transfer — accepting creates one JE (debit receiving GL / credit sending GL) and matches both statement lines to its two legs.
5. **Intelligence (suggest-only)**:
   - **Counterparty resolution**: statement descriptors ("AMZN MKTP US*Z1234") resolve to customers/suppliers via the existing pgvector embeddings (384-dim, `match_*` functions already in place) + trigram fallback; resolved counterparties narrow match candidates (payments to that supplier rank first) and prefill quick-create.
   - **LLM coding suggestions**: for unrecognized lines, an Inngest task proposes GL account + counterparty + memo from the chart of accounts and this account's match history (AI SDK, batch, cached on the line as `suggestion JSONB` with confidence + provenance). One-click accept codes the line; **"memorize as rule"** promotes an accepted suggestion into a `bankRule` prefilled from the line — the QBO "remember this" loop, but explicit and auditable. LLM suggestions sit behind the company's existing AI enablement setting; embeddings-based counterparty resolution ships core (it's near-free).
   - AI writes nothing to the GL by itself: acceptance is always a human action, and every accepted suggestion records provenance.

Manual matching remains fully general: select N bank lines + M GL lines; the group must sum equal (or within tolerance, booking the adjustment). A GL line can belong to at most one group (a line clears once); suggestions surface in both panes of the workspace.

### Quick-create from a bank line

For lines with no GL counterpart (Xero's Create leg):

- **Journal entry**: popover (GL account + memo, prefilled by rules/AI when available) → creates and posts a balanced JE dated the bank-line date (`sourceType = 'Manual'`, period-gated) and matches it, one transaction.
- **Payment**: opens the payment form prefilled (type from sign, amount, date, bank GL, resolved counterparty); on post, the payment's bank-side journal line auto-matches the originating statement line.
- **Transfer**: the transfer-detection flow, invocable manually.

### Reconciliation close-out

- "Finish reconciliation" drawer: statement date + ending balance (prefilled from the newest statement-carrying import). `startingBalance` stamps from the previous completed reconciliation (or the account's opening balance). Continuity mismatch against imported statement balances is flagged.
- **Gate**: every non-excluded line dated ≤ statement date must be Matched, and `starting + Σ(lines) − ending = 0`. Blockers are listed live; there are no warning-overrides — this is arithmetic.
- **Workflow**: with `bankRecRequireApproval` off (default), Complete finishes directly. With it on, the preparer **submits** (Draft → In Review) and a different user with `accounting_update` approves (→ Completed) — preparer ≠ approver enforced. Approvers are notified through the existing notifications package.
- **Auto-complete assist**: when a statement period ties completely with zero human touches (all auto/rule matches), the account row offers one-click "Complete reconciliation through {date}" — continuous-close ergonomics with the same gate and workflow.
- On completion (single Kysely transaction): lines flip `Reconciled` + `reconciliationId`, a **PDF reconciliation report** renders via `@carbon/documents` (statement balance → cleared summary → outstanding checks / deposits in transit → GL book balance) into the private bucket (`reportDocumentPath`), audit-log entry written.
- **Sequential per account; void latest-only** (QBO undo model). Voiding reverts lines to Matched, keeps match groups, clears the report reference. Completing/voiding posts nothing to the GL — GL impact only ever comes from underlying journals.
- Reconciliations get readable IDs (`REC-%{yyyy}-%{mm}-`, existing sequence infrastructure) — they're referenced in audit binders.

### Cash position page

The Banking landing page: per account — feed/statement balance (latest `bankAccountBalance`), GL balance, **drift** (their difference net of unmatched-but-dated items), unmatched count, days since last reconciliation, connection health; 30-day balance sparkline. Drift that exceeds the unmatched explanation is the "your books are wrong" signal, surfaced daily instead of at month-end. (Forecasting is a non-goal — this is observed cash only.)

### Period close interaction

- Quick-create/rule/tolerance JEs post through the existing period gates — nothing new to enforce.
- The period-close readiness checklist gains a **warning**: "bank accounts with unreconciled statement lines dated in the period" (warning, not blocker — feeds lag). Coordinated with the in-flight `20260702044133_period-close-lifecycle` work.

### Non-goals (v1, explicit)

Money movement of any kind (payment initiation, ACH origination, Plaid Transfer), cash-flow *forecasting*, intraday statements (camt.052/MT942), direct bank APIs (EBICS/FDX), bank-fee contract auditing, sweep/pooling structures, and AI auto-posting without human acceptance.

### Phasing (each independently shippable)

| Phase | Scope | Value shipped |
|-------|-------|---------------|
| **1 — Foundations** | Schema (incl. `journalLine` FX columns), bank accounts UI, CSV + OFX import, deterministic matching + match groups, reconcile workspace, close-out + approval + PDF report, period-close warning | Manual bank rec end-to-end, audit-ready |
| **2 — Plaid** | Link/exchange/webhooks/sync/re-auth, balance snapshots, cash position page, pending handling, transfer detection | Feeds + daily drift visibility |
| **3 — Depth** | BAI2 + MT940 + CAMT.053 parsers, bank rules engine (suggest + auto-post), tolerance adjustment | Enterprise formats + hands-off recurring items |
| **4 — Intelligence** | Counterparty resolution (embeddings), LLM coding suggestions, memorize-as-rule | The leapfrog layer |

### Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Multi-tenancy | Single-column PK (`id('prefix')`/`xid()`) + `companyId` FK + RLS on all new tables; business keys include scoping columns | Matches `payment`/`memo`/`invoiceSettlement` (newest sibling tables) per pattern-recency rule; flagged for review since AGENTS.md documents composite PKs |
| Match target | `journalLine` on the bank's GL account | SAP/NetSuite precedent; uniform across all posting sources |
| Match cardinality | N:M **match groups** (group + two membership tables), Σbank = ΣGL (± recorded tolerance); a GL line clears at most once | Deposit batches (M GL : 1 bank) and split settlements (N bank : 1 GL) are both real; per-pair rows can't express group sum invariants |
| Bank ↔ GL link | `bankAccount.glAccountId` unique per company; account must be `accountType IN ('Bank','Cash')` — or a Liability card account for type Credit Card (service-validated) | SAP house-bank model; prevents two bank accounts sharing GL lines |
| Currency | Foreign-currency accounts supported via `journalLine.sourceAmount`/`sourceCurrencyCode`; auto-match requires exact source-currency agreement, rate-converted comparison is suggest-only | Root-cause fix over NetSuite's hard restriction; groundwork for FX revaluation |
| Credit cards | Supported via class-aware sign normalization in one shared helper | First-class, not a special case; Plaid returns credit accounts anyway |
| Sign convention | `bankTransaction.amount` signed, account currency, positive = inflow; Plaid inverted at ingest | Aligns with Asset-class GL lines; one documented convention |
| Statement lines | Immutable after import; corrections via Exclude; feed restatements of matched lines set `needsReview` | Xero model; evidential value |
| Auto-match rule | Exact amount + ±7d + reference agreement + exactly one candidate | NetSuite ambiguity refusal; a wrong auto-match is worse than none |
| Rules engine | Ordered first-match-wins `bankRule` rows; `autoPost` opt-in per rule; auto-posted JEs period-gated | NetSuite user-rule tiers / Xero bank rules; deterministic and auditable |
| AI boundary | Intelligence suggests; humans accept; provenance recorded; promotion to rules is explicit | Audit safety — the GL never moves on model output alone |
| Matching implementation | Deterministic core as Postgres RPC; rules/tolerance/transfer layers in `accounting.server.ts` (Kysely); AI suggestions as Inngest task | One authoritative implementation per layer, callable from app/jobs/edge |
| Reconciliation model | Continuous matching + statement close-out; Draft → In Review → Completed → Voided; sequential per account; void-latest-only; approval + segregation via `companySettings.bankRecRequireApproval` (default off) | NetSuite two-stage + QBO zero-difference + SOX-friendly control that small shops can ignore |
| Report artifact | PDF via `@carbon/documents` on completion, stored in private bucket | The thing auditors actually ask for |
| Plaid credentials | Access tokens in **Supabase Vault**, referenced by secret id from `companyIntegration.metadata.items[]`; cursors + non-secret Item state stay in metadata | Bank credentials warrant stronger handling than the Xero plaintext precedent; a follow-up migrates Xero tokens to the same pattern |
| Feed sync | Webhook-triggered Inngest + daily scheduled catch-up + manual button; balances snapshotted daily | Xero job pattern; webhook-loss insurance |
| Service shape | All functions in `accounting.service.ts` / `accounting.server.ts`, `(client, ...)` → `{ data, error }` | Module conventions; no new service/models files |
| RLS / permissions | `accounting_view/create/update/delete`, simple policy names + `::text[]` casts; no new permission | Existing accounting pattern; reconciliation is the controller's job |
| Forms / UI | `ValidatedForm` + zod in `accounting.models.ts`; drawers for detail views; **full-page** reconcile workspace | Module conventions; workspace ≠ detail view (Xero/NetSuite precedent) |
| Readable IDs | `REC-` sequence for reconciliations only | Referenced by auditors; other entities are internal |
| Backward compatibility | `payment.bankAccount` untouched; `journalLine` gains two nullable columns (additive); no behavior change to existing posting paths beyond populating them | Zero churn on the 2-day-old payments surface |

## Data Model Changes

One idempotent migration (`pnpm db:migrate:new bank-reconciliation`, randomized HHMMSS), then `pnpm run generate:types` before typechecking. Sketch (RLS shown once; every new table gets the same four `accounting_*` policies):

```sql
DO $$ BEGIN
  CREATE TYPE "bankAccountType" AS ENUM ('Checking', 'Savings', 'Credit Card', 'Other');
  CREATE TYPE "bankAccountSource" AS ENUM ('Manual', 'Plaid');
  CREATE TYPE "bankConnectionStatus" AS ENUM ('Connected', 'Requires Reauth', 'Error');
  CREATE TYPE "bankTransactionSource" AS ENUM ('Plaid', 'Import');
  CREATE TYPE "bankTransactionStatus" AS ENUM ('Pending', 'Unmatched', 'Matched', 'Excluded', 'Reconciled');
  CREATE TYPE "bankMatchType" AS ENUM ('Auto', 'Rule', 'Manual');
  CREATE TYPE "bankStatementFormat" AS ENUM ('CSV', 'OFX', 'BAI2', 'MT940', 'CAMT053');
  CREATE TYPE "bankReconciliationStatus" AS ENUM ('Draft', 'In Review', 'Completed', 'Voided');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Root-cause FX support: source-currency amounts on journal lines (nullable, additive)
ALTER TABLE "journalLine"
  ADD COLUMN IF NOT EXISTS "sourceAmount" NUMERIC,
  ADD COLUMN IF NOT EXISTS "sourceCurrencyCode" TEXT REFERENCES "currencyCode"("code");

CREATE TABLE IF NOT EXISTS "bankAccount" (
  "id" TEXT NOT NULL PRIMARY KEY DEFAULT id('bka'),
  "name" TEXT NOT NULL,
  "bankName" TEXT,
  "accountNumberLastFour" TEXT,
  "type" "bankAccountType" NOT NULL DEFAULT 'Checking',
  "currencyCode" TEXT NOT NULL REFERENCES "currencyCode"("code"),
  "glAccountId" TEXT NOT NULL REFERENCES "account"("id") ON DELETE RESTRICT,
  "openingBalance" NUMERIC NOT NULL DEFAULT 0,
  "openingDate" DATE,
  "source" "bankAccountSource" NOT NULL DEFAULT 'Manual',
  "plaidItemId" TEXT,
  "plaidAccountId" TEXT,
  "connectionStatus" "bankConnectionStatus",
  "lastSyncedAt" TIMESTAMP WITH TIME ZONE,
  "active" BOOLEAN NOT NULL DEFAULT TRUE,
  "companyId" TEXT NOT NULL REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  "customFields" JSONB
);
CREATE UNIQUE INDEX IF NOT EXISTS "bankAccount_glAccount_idx" ON "bankAccount" ("glAccountId", "companyId");
CREATE UNIQUE INDEX IF NOT EXISTS "bankAccount_plaid_idx" ON "bankAccount" ("plaidAccountId", "companyId")
  WHERE "plaidAccountId" IS NOT NULL;

ALTER TABLE "bankAccount" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "SELECT" ON "bankAccount" FOR SELECT USING (
  "companyId" = ANY (get_companies_with_employee_permission('accounting_view')::text[])
);
-- INSERT/UPDATE/DELETE: same shape with accounting_create / accounting_update / accounting_delete

CREATE TABLE IF NOT EXISTS "bankStatementImport" (
  "id" TEXT NOT NULL PRIMARY KEY DEFAULT id('bsi'),
  "bankAccountId" TEXT NOT NULL REFERENCES "bankAccount"("id") ON DELETE CASCADE,
  "fileName" TEXT NOT NULL,
  "filePath" TEXT NOT NULL,
  "format" "bankStatementFormat" NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'Pending',           -- Pending | Completed | Failed
  "error" TEXT,
  "importedCount" INTEGER,
  "duplicateCount" INTEGER,
  "statementOpeningBalance" NUMERIC,                   -- MT940 60F / BAI2 trailer / CAMT Bal / OFX ledger
  "statementEndingBalance" NUMERIC,
  "companyId" TEXT NOT NULL REFERENCES "company"("id") ON DELETE CASCADE,
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS "bankReconciliation" (
  "id" TEXT NOT NULL PRIMARY KEY DEFAULT id('brc'),
  "reconciliationId" TEXT NOT NULL,                    -- readable: REC-2026-06-000001
  "bankAccountId" TEXT NOT NULL REFERENCES "bankAccount"("id") ON DELETE CASCADE,
  "statementDate" DATE NOT NULL,
  "startingBalance" NUMERIC NOT NULL,
  "statementEndingBalance" NUMERIC NOT NULL,
  "status" "bankReconciliationStatus" NOT NULL DEFAULT 'Draft',
  "notes" TEXT,
  "submittedAt" TIMESTAMP WITH TIME ZONE,              -- preparer, when approval flow is on
  "submittedBy" TEXT REFERENCES "user"("id"),
  "completedAt" TIMESTAMP WITH TIME ZONE,
  "completedBy" TEXT REFERENCES "user"("id"),          -- approver when flow is on, else completer
  "voidedAt" TIMESTAMP WITH TIME ZONE,
  "voidedBy" TEXT REFERENCES "user"("id"),
  "reportDocumentPath" TEXT,                           -- generated PDF in private bucket
  "companyId" TEXT NOT NULL REFERENCES "company"("id") ON DELETE CASCADE,
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE
);
CREATE UNIQUE INDEX IF NOT EXISTS "bankReconciliation_statement_idx"
  ON "bankReconciliation" ("bankAccountId", "statementDate") WHERE "status" <> 'Voided';
CREATE UNIQUE INDEX IF NOT EXISTS "bankReconciliation_readable_idx"
  ON "bankReconciliation" ("reconciliationId", "companyId");

CREATE TABLE IF NOT EXISTS "bankTransaction" (
  "id" TEXT NOT NULL PRIMARY KEY DEFAULT id('btx'),
  "bankAccountId" TEXT NOT NULL REFERENCES "bankAccount"("id") ON DELETE CASCADE,
  "transactionDate" DATE NOT NULL,
  "amount" NUMERIC NOT NULL,                           -- signed, account currency, positive = inflow
  "description" TEXT NOT NULL,
  "counterparty" TEXT,                                 -- raw descriptor name
  "counterpartyCustomerId" TEXT,                       -- resolved (composite FK to customer)
  "counterpartySupplierId" TEXT,                       -- resolved (composite FK to supplier)
  "reference" TEXT,
  "externalId" TEXT NOT NULL,                          -- plaid txn id | FITID | bank ref | csv hash
  "pendingExternalId" TEXT,
  "source" "bankTransactionSource" NOT NULL,
  "importId" TEXT REFERENCES "bankStatementImport"("id") ON DELETE SET NULL,
  "status" "bankTransactionStatus" NOT NULL DEFAULT 'Unmatched',
  "reconciliationId" TEXT REFERENCES "bankReconciliation"("id") ON DELETE SET NULL,
  "needsReview" BOOLEAN NOT NULL DEFAULT FALSE,
  "suggestion" JSONB,                                  -- rule/AI coding suggestion + confidence + provenance
  "raw" JSONB,
  "companyId" TEXT NOT NULL REFERENCES "company"("id") ON DELETE CASCADE,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE
);
CREATE UNIQUE INDEX IF NOT EXISTS "bankTransaction_external_idx"
  ON "bankTransaction" ("bankAccountId", "externalId");
CREATE INDEX IF NOT EXISTS "bankTransaction_account_status_idx"
  ON "bankTransaction" ("bankAccountId", "status", "transactionDate");

-- N:M match groups
CREATE TABLE IF NOT EXISTS "bankMatchGroup" (
  "id" TEXT NOT NULL PRIMARY KEY DEFAULT id('bmg'),
  "bankAccountId" TEXT NOT NULL REFERENCES "bankAccount"("id") ON DELETE CASCADE,
  "matchType" "bankMatchType" NOT NULL DEFAULT 'Manual',
  "toleranceJournalId" TEXT REFERENCES "journal"("id"),  -- adjustment JE when tolerance applied
  "companyId" TEXT NOT NULL REFERENCES "company"("id") ON DELETE CASCADE,
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS "bankMatchGroupTransaction" (
  "groupId" TEXT NOT NULL REFERENCES "bankMatchGroup"("id") ON DELETE CASCADE,
  "bankTransactionId" TEXT NOT NULL UNIQUE REFERENCES "bankTransaction"("id") ON DELETE CASCADE,
  PRIMARY KEY ("groupId", "bankTransactionId")
);
CREATE TABLE IF NOT EXISTS "bankMatchGroupJournalLine" (
  "groupId" TEXT NOT NULL REFERENCES "bankMatchGroup"("id") ON DELETE CASCADE,
  "journalLineId" TEXT NOT NULL UNIQUE REFERENCES "journalLine"("id") ON DELETE RESTRICT,
  PRIMARY KEY ("groupId", "journalLineId")
);

-- Rules engine
CREATE TABLE IF NOT EXISTS "bankRule" (
  "id" TEXT NOT NULL PRIMARY KEY DEFAULT id('brl'),
  "name" TEXT NOT NULL,
  "bankAccountId" TEXT REFERENCES "bankAccount"("id") ON DELETE CASCADE,  -- NULL = all accounts
  "priority" INTEGER NOT NULL DEFAULT 0,
  "active" BOOLEAN NOT NULL DEFAULT TRUE,
  "descriptionPattern" TEXT,                           -- ILIKE pattern
  "direction" TEXT,                                    -- 'Inflow' | 'Outflow' | NULL
  "minAmount" NUMERIC,
  "maxAmount" NUMERIC,
  "accountId" TEXT NOT NULL REFERENCES "account"("id"),-- code-to GL account
  "counterpartyCustomerId" TEXT,
  "counterpartySupplierId" TEXT,
  "memoTemplate" TEXT,
  "autoPost" BOOLEAN NOT NULL DEFAULT FALSE,           -- create-and-match JE vs suggest-only
  "companyId" TEXT NOT NULL REFERENCES "company"("id") ON DELETE CASCADE,
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE
);

-- Daily balance snapshots (drift view)
CREATE TABLE IF NOT EXISTS "bankAccountBalance" (
  "id" TEXT NOT NULL PRIMARY KEY DEFAULT xid(),
  "bankAccountId" TEXT NOT NULL REFERENCES "bankAccount"("id") ON DELETE CASCADE,
  "date" DATE NOT NULL,
  "balance" NUMERIC NOT NULL,                          -- account currency
  "source" TEXT NOT NULL,                              -- 'Plaid' | 'Statement'
  "companyId" TEXT NOT NULL REFERENCES "company"("id") ON DELETE CASCADE,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS "bankAccountBalance_day_idx"
  ON "bankAccountBalance" ("bankAccountId", "date");

-- Company settings & account defaults
ALTER TABLE "companySettings"
  ADD COLUMN IF NOT EXISTS "bankMatchToleranceAmount" NUMERIC NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "bankRecRequireApproval" BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE "accountDefault"
  ADD COLUMN IF NOT EXISTS "bankFeesAccount" TEXT REFERENCES "account"("id");
-- bankFeesAccount backfill: COALESCE to interestAccount fallback so it's never NULL for existing companies

-- Sequence for readable reconciliation IDs (all existing companies)
-- INSERT INTO "sequence" ("table","name","prefix","next","size","step","companyId") ... 'REC-%{yyyy}-%{mm}-'

-- Matching engine core (deterministic layer)
CREATE OR REPLACE FUNCTION run_bank_matching(bank_account_id TEXT, company_id TEXT)
RETURNS TABLE ("matchedCount" INTEGER) ...
-- exact amount (class/currency-normalized), ±7d, reference agreement, unique-candidate; SECURITY DEFINER
```

Notes:
- `journalLine` columns are additive/nullable; posting paths populate go-forward (`post-payment`, `build-payment-journal.ts` first). Views over `journalLine`, if any select-star views exist, get DROP/recreate per convention (verify at implementation).
- `companySettings`/`accountDefault` changes are guarded/backfilled idempotently (migrations-must-be-idempotent rule).
- Plaid Item state lives outside these tables: access tokens in Supabase Vault (`vault.create_secret`), secret ids + cursors + institution metadata in `companyIntegration.metadata.items[]`.

## API / Service Changes

Services in `accounting.service.ts` (zod in `accounting.models.ts`; transactions in `accounting.server.ts`), all `(client, ...)` → `{ data, error }`:

```ts
// Master data
getBankAccounts(client, companyId)                        // + unmatched counts, drift, health
upsertBankAccount(client, data)                           // validates GL type/class per bank type, 1:1, currency
deactivateBankAccount(client, { id, companyId, userId })

// Statement lines & matching
getBankTransactions(client, companyId, { bankAccountId, status?, dateRange?, needsReview? })
getMatchCandidates(client, companyId, bankTransactionId)   // deterministic + counterparty-ranked suggestions
createBankMatchGroup(client, { bankTransactionIds, journalLineIds, userId })  // Σ=Σ or within tolerance
deleteBankMatchGroup(client, { groupId, userId })          // blocked when Reconciled
excludeBankTransaction / restoreBankTransaction(client, { bankTransactionId, userId })
createJournalEntryFromBankTransaction(client, { bankTransactionId, accountId, memo, userId })
acceptSuggestion(client, { bankTransactionId, userId })    // applies rule/AI suggestion via the JE path
createBankRuleFromTransaction(client, { bankTransactionId, ...ruleFields, userId })  // memorize-as-rule
detectTransfers(client, { companyId })                     // proposes cross-account pairs
runBankMatching(client, { bankAccountId, companyId })      // full pipeline: RPC core → rules → tolerance

// Rules
getBankRules / upsertBankRule / deleteBankRule / reorderBankRules

// Imports
createBankStatementImport(client, data)                    // edge fn import-bank-statement does the work

// Reconciliation
getBankReconciliations(client, companyId, { bankAccountId? })
getBankReconciliationSummary(client, companyId, { bankAccountId, statementDate, statementEndingBalance })
  // → { startingBalance, clearedTotal, difference, unmatchedLines, outstandingGlLines, continuityWarning }
createBankReconciliation(client, data)                     // Draft; stamps startingBalance + REC- id
submitBankReconciliation(client, { reconciliationId, userId })     // → In Review (approval flow on)
completeBankReconciliation(client, { reconciliationId, userId })   // gate re-validated; preparer≠approver enforced
voidBankReconciliation(client, { reconciliationId, userId })       // latest-completed only

// Cash position
getCashPosition(client, companyId)                         // balances + GL + drift + sparkline data
```

Plaid provider (`packages/ee/src/plaid/`): `config.tsx` (registry entry, hidden unless `PLAID_CLIENT_ID`/`PLAID_SECRET` set), `hooks.server.ts` (install/uninstall/healthcheck), shared Plaid client + sync used by jobs (Xero syncer precedent).

Routes:
- `api+/integrations.plaid.link-token.ts`, `api+/integrations.plaid.exchange.ts`, `api+/webhook.plaid.ts` (JWT-verified → `trigger("bank-feed-sync")`).
- `x+/accounting+/`: `banking.tsx` (cash position landing), `bank-accounts.tsx` + `.new` / `.$bankAccountId` / `.$bankAccountId.import` drawers, `reconcile.$bankAccountId.tsx` (workspace; intents: `match` | `unmatch` | `exclude` | `restore` | `create-journal` | `accept-suggestion` | `memorize-rule` | `transfer` | `run-matching` | `sync`), `reconcile.$bankAccountId.finish.tsx` (drawer), `reconciliations.tsx` + `.$reconciliationId` (history + report + PDF download), `bank-rules.tsx` + drawers.

Jobs: `bank-feed-sync` (`carbon/bank-feed-sync`) + daily scheduled catch-up; `bank-suggest-coding` (`carbon/bank-suggest-coding`, batch LLM suggestions, Phase 4). Registered in `packages/lib/src/trigger.ts` + `events.ts`. Env: `PLAID_CLIENT_ID`, `PLAID_SECRET`, `PLAID_ENV` in `packages/env`.

Edge function: `import-bank-statement` — format parsers (CSV/OFX/BAI2/MT940/CAMT.053) as pure, fixture-tested modules; transaction-wrapped insert; then matching pipeline.

## UI Changes

- **Sidebar**: "Banking" group in `useAccountingSubmodules.tsx` (between General Ledger and Fixed Assets): Cash Position, Bank Accounts, Reconciliations, Bank Rules. Gated by `accountingEnabled` + `accounting_view`.
- **Cash position** (`/x/accounting/banking`): per-account cards/rows — bank balance, GL balance, drift, unmatched count, days since last rec, connection badge, 30-day sparkline; company-total header.
- **Bank accounts list**: name, bank, GL account, currency, type, source + connection badges, unmatched count (plain number, no parentheses), last synced/imported. Row actions: Reconcile, Import statement, Sync now, Edit. Header: "New Bank Account", "Connect bank" (Plaid Link; hidden when env unset). Requires-reauth banner.
- **Reconcile workspace** (full page): left pane statement lines (status filter, `needsReview` filter, inline suggestion chips with accept / memorize-as-rule, Exclude, Add: JE popover / payment / transfer); right pane unmatched GL lines (outstanding checks/deposits view) with multi-select match; header running totals (cleared vs statement), Run matching, Finish reconciliation. Transfer proposals surface as paired-line banners.
- **Finish drawer**: statement date + ending balance (import prefill + continuity check), live difference, blocker list; Complete (or Submit for review when approval flow on).
- **Reconciliations**: history list; detail drawer with the report (statement balance → cleared summary → outstanding items → book balance), PDF download, Approve (when In Review, non-preparer only), Void (latest only).
- **Bank rules**: list + drawer form (conditions, coding, autoPost toggle with an explicit "posts to the GL automatically" warning), drag-reorder priority.
- **Settings**: tolerance amount + approval toggle on the accounting settings page; `bankFeesAccount` in Default Accounts.
- Flash messages on all mutations; `ValidatedForm` + zod; ERP `size="md"`.

## Acceptance Criteria

Phase 1
- [ ] Creating a bank account validates GL account class/type per bank type (Bank/Cash for depository, Liability for Credit Card), enforces 1:1 GL linkage, and allows a non-base currency.
- [ ] OFX upload with 20 transactions → 20 lines; identical re-upload → 0 new, 20 duplicates reported. CSV with debit/credit columns imports correctly signed; overlapping re-upload dedupes.
- [ ] A posted supplier payment of −$4,530 within 7 days auto-matches; two same-amount candidates → no auto-match, both suggested (ambiguity refusal).
- [ ] One $12,000 bank deposit matches three GL lines summing exactly; a mismatched selection is rejected; with tolerance $1.00 configured, an $11,999.40 selection matches and books a $0.60 adjustment JE to `bankFeesAccount`, linked on the group.
- [ ] Quick-create JE from a bank-fee line posts (period-gated per the close lifecycle) and matches atomically.
- [ ] Completion is blocked while any non-excluded line ≤ statement date is Unmatched or the difference ≠ 0; on completion lines flip Reconciled, a PDF report lands in the private bucket, and unmatch on reconciled lines is rejected. With approval on, the preparer cannot approve their own reconciliation.
- [ ] Reconciliations complete sequentially per account; only the latest can be voided; voiding reverts lines to Matched and preserves groups.
- [ ] A foreign-currency (EUR) bank account matches a EUR payment exactly via `journalLine.sourceAmount`; base-only legacy lines appear as rate-converted suggestions, never auto-matches.
- [ ] Reconciliation report shows outstanding GL items tying statement balance to GL book balance at the statement date.

Phase 2
- [ ] Plaid sandbox: connect, map accounts, initial sync (90-day default) with inverted signs; `SYNC_UPDATES_AVAILABLE` triggers incremental sync; pending lines are unmatchable and swap correctly on posting; `ITEM_LOGIN_REQUIRED` → Requires Reauth banner → update-mode relink clears it.
- [ ] Balance snapshots record daily; cash position shows drift = bank balance − GL balance net of dated unmatched items; a matched-line feed removal sets `needsReview` and surfaces in the workspace.
- [ ] Two opposite $5,000 lines across two bank accounts within 3 days propose a transfer; accepting creates one JE matched to both lines.

Phase 3
- [ ] BAI2, MT940, and CAMT.053 fixture files each parse to correct normalized lines (Deno unit tests per parser), including statement opening/closing balances used for continuity checks.
- [ ] A bank rule ("description ILIKE '%WIRE FEE%'", outflow, autoPost → Bank Fees) auto-creates and matches the JE on the next sync; suggest-only rules stamp suggestions without posting.

Phase 4
- [ ] "AMZN MKTP" descriptor resolves to supplier Amazon via embeddings; candidates for that line rank Amazon payments first.
- [ ] An unrecognized line shows an LLM coding suggestion with confidence + provenance; accepting posts the JE; "memorize as rule" creates a prefilled `bankRule`; the GL never changes without explicit acceptance.

All phases
- [ ] Migration applies idempotently twice; `pnpm run generate:types` then `pnpm run typecheck` and `pnpm run lint` pass.

## Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| Vault-backed token storage adds infra surface (pgsodium/Vault across local dev, Docker, cloud) | Med | Supabase ships Vault in all environments; decryption is server-side service-role-only; tokens are read-only Transactions scope (no money movement) either way |
| `journalLine` schema change on the core GL table | Med | Two nullable, additive columns; no reads change behavior; backfill is NULL (honest "unknown"); coordinated with in-flight period-close work touching the same module |
| `autoPost` rules write to the GL unattended | Med | Opt-in per rule with explicit UI warning, period-gated, `sourceType='Manual'` journals fully audit-trailed, rule provenance on the match group; rules are deterministic (no AI in the posting path) |
| Wrong auto-match misstates the reconciliation | Med | Exact+unique-candidate core; tolerance layer books visible adjustments; unmatch until Reconciled; match provenance recorded |
| LLM suggestion cost/quality at volume | Med | Batch Inngest task, cached on the line, only for lines rules/deterministic layers didn't resolve; suggest-only by design |
| BAI2/MT940/CAMT.053 parser edge cases (bank dialects) | Med | Pure-function parsers with per-bank fixtures; failures fail the import row loudly, never partial-insert (transaction-wrapped) |
| Feed restatements/removals of matched lines | Med | `needsReview` flag + workspace surfacing instead of silent deletion |
| CSV content-hash dedupe misfires on description drift | Med | Occurrence counter for legit same-day duplicates; drift creates a visible duplicate the user Excludes |
| Approval workflow friction for one-person accounting teams | Low | `bankRecRequireApproval` default off; segregation only enforced when on |
| Initial Plaid backfill floods history | Low | 90-day default, user-selectable window at connect |
| Webhook loss → stale feeds | Low | Daily scheduled catch-up + manual sync + drift view makes staleness visible |

## Open Questions

> ✅ All resolved 2026-07-02 — recommendations accepted verbatim by Brad ("accept all"). Implementation may proceed.

- [x] **`journalLine` FX columns** — additive change to the core GL table. — **Answer: Approved.** Add nullable `sourceAmount`/`sourceCurrencyCode`, populated go-forward by posting paths (post-payment first); NULL backfill; suggest-only matching for legacy lines on FX accounts.
- [x] **Production dependencies** — **Answer:** `plaid` Node SDK in `@carbon/ee` + Plaid Link via script-tag loader (no client package) + hand-rolled, fixture-tested pure parsers for OFX/BAI2/MT940/CAMT.053 (formats are stable and well-specified; libraries in this space are mostly unmaintained).
- [x] **Token storage** — **Answer: Supabase Vault** for Plaid access tokens (secret id referenced from `companyIntegration.metadata.items[]`); follow-up task migrates Xero tokens to the same pattern. Design decisions, ingestion flow, and risks updated accordingly.
- [x] **AI feature gating** — **Answer:** embeddings-based counterparty resolution ships core; LLM coding suggestions sit behind the existing per-company AI enablement setting.
- [x] **Approval defaults** — **Answer:** `bankRecRequireApproval` defaults off; preparer ≠ approver enforced when on; surfaced in settings copy.
- [x] **Credit-card statement semantics** — **Answer:** cycle-date-driven reconciliation (statement date = cycle close) is sufficient for v1; no statement-period metadata (cycle open/close, payment due) in schema.
- [x] **Period-close checklist wiring** — **Answer:** land this spec independently of the in-flight period-close implementation; wire the "unreconciled bank lines dated in period" readiness warning as a small follow-up PR once both are merged.
- [x] **Phase-1 cut line** — **Answer:** approval workflow + PDF reconciliation report stay in Phase 1 — they are what makes the feature audit-credible.

## Changelog

- 2026-07-02: Created — grounded in codebase exploration (ar-ap-payments tables, journal/journalLine structure, Xero integration + CSV import pipelines) and adversarially verified ERP research (SAP EBS formats/posting chain, NetSuite ITM two-stage flow + ambiguity refusal + 1:1 currency constraint, Xero two-sided reconcile); Plaid mechanics from public docs (verification pass hit usage limits). See `.ai/research/bank-reconciliation.md`.
- 2026-07-02: Expanded scope per review ("more ambitious"): all five statement formats in v1; foreign-currency accounts via `journalLine` source-currency columns (root-cause fix replacing the base-currency restriction); credit-card accounts via class-aware sign normalization; N:M match groups; bank rules engine with opt-in auto-post; tolerance auto-adjustment; cross-account transfer detection; preparer→approver workflow + PDF reconciliation report; cash position page with daily balance snapshots and drift; intelligence layer (embeddings counterparty resolution + LLM coding suggestions + memorize-as-rule). Reorganized into four shippable phases.
- 2026-07-02: Phase 2 (Plaid feeds + cash position) spec split out to `.ai/specs/2026-07-02-plaid-bank-feeds.md` with directly verified Plaid mechanics; note there that Supabase Vault is unverified in this stack (probe + AES-GCM fallback proposed).
- 2026-07-02: All open questions resolved — recommendations accepted verbatim ("accept all"): `journalLine` FX columns approved; `plaid` SDK + script-tag Link + hand-rolled parsers; Vault-backed Plaid token storage (Xero migration as follow-up); LLM suggestions behind AI enablement flag, embeddings resolution core; approval default off; CC cycle-date reconciliation; period-close warning wired post-merge; Phase 1 keeps approval + PDF. Status → in-progress; ready for `/plan`.
- 2026-07-03: `journalLine.sourceAmount`/`sourceCurrencyCode` population upgraded from best-effort to **mandatory on every posting path** per the public-company readiness audit (`2026-07-03-public-company-readiness.md` SD-4, roadmap `.ai/plans/2026-07-03-public-company-readiness-roadmap.md`) — the same columns serve FEC/SAF-T exports and ASC 830 remeasurement, which need universal coverage. Update the bank-reconciliation plan's posting-path tasks accordingly.
