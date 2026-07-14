# Record Integrity & Audit Hardening (Phase 0 Spec A)

> Status: in-progress (all open questions resolved pre-writing — program resolutions 2026-07-03/04)
> Author: Claude (with Brad Barbin)
> Date: 2026-07-04
> Tracking issue: crbnos/carbon#1047
> Program: `.ai/specs/2026-07-03-public-company-readiness.md` (MW-1 remainder + SD-1 remainder + GAP-5 step 1) · `.ai/plans/2026-07-03-public-company-readiness-roadmap.md` §Phase 0 Spec A
> Companions: `.ai/specs/2026-07-02-period-closing.md` (journal immutability fold-in — prerequisite trigger wave) · `.ai/specs/2026-07-04-document-approvals.md` (Spec B — preparedBy/approvedBy) · Spec C (gapless numbering — separate)

## TLDR

This spec completes the MW-1 material-weakness remediation that the period-closing fold-in started. Five deliverables, one theme — make the ledger evidence-grade for a SOX auditor: (1) SECURITY DEFINER immutability triggers freezing posted `payment`/`memo` rows (only `Posted → Voided` transitions) and `invoiceSettlement` rows once their funding source is posted, mirroring the period-closing journal trigger and binding the service role; (2) a deferred constraint trigger asserting Σ(signed `journalLine.amount`) = 0 per posted journal at COMMIT (±0.01), covering every writer including edge functions (SD-1 remainder); (3) audit hardening — **synchronous, trigger-based, in-transaction audit writes for accounting tables** (replacing the async PGMQ path for those tables only), always-on regardless of the company toggle, with append-only audit tables and a 7-year retention floor for accounting entities; (4) a full-population **JE export** (streaming, no row caps) that reconciles opening TB + export = closing TB — the SOX AS 2401 / FEC / SAF-T / GoBD workhorse; (5) the GAP-5 schema seed — `journal.bookId` + a group-scoped `accountingBook` table with per-company enablement (`accountingBookCompany`), seeded `PRIMARY` book, and book filtering on the balance RPCs. Plus the sanctioned data-fix channel: a `'Repair'` journal source type — permissioned, reason required, correcting-entries only, itself immutable.

## Problem Statement

The period-closing spec (§Enforcement item 4) makes posted `journal`/`journalLine` rows immutable, but the rest of the record-integrity surface from readiness finding MW-1 is still open:

- **Posted payments and memos are mutable.** `payment`/`memo` UPDATE RLS has no status condition (`20260630093809_ar-ap-payments.sql:274-280` — the migration's own comment says "App-side service rejects illegal transitions"). Any `invoicing_update` user via PostgREST, and any service-role writer unconditionally, can rewrite a posted payment's amount, bank account, or counterparty. `invoiceSettlement` write policies check the funding source is Draft — but the service role bypasses RLS entirely, so nothing at the DB actually freezes a posted settlement.
- **Nothing at the DB guarantees a journal balances.** Debits=credits is asserted only in app code (`postJournalEntry`, the payment journal builder); the invoice/receipt/shipment/production posting edge functions have no balance assertion at all. One unbalanced journal breaks the opening→closing TB identity every report and tie-out depends on.
- **The audit log cannot serve as ICFR evidence.** It is opt-in per company (default off), writes asynchronously through PGMQ (rows are lost if the pipeline fails — fatal for evidence), retains 30 days hot, has `USING (true)` policies on its own tables (tamperable), and its ~26-entity coverage (`packages/database/src/audit.config.ts`) excludes every accounting table: `journal`, `journalLine`, `account`, `accountingPeriod`, `payment`, `memo`, `invoiceSettlement`, `sequence`, `userPermission`, `apiKey`, `approvalRequest`/`approvalRule`, `accountDefault`, `paymentTerm`, `bankAccount`. The period-closing and approvals specs route their transition audit through this same system — their control trail inherits every weakness.
- **No JE population export.** An auditor cannot obtain the complete journal-entry population with preparer/approver/timestamps; France FEC requires it on 15 days' notice.
- **No book dimension.** `journal` has no `bookId`; retrofitting one after more posters/reports ship is the single most expensive retrofit in the readiness research (§Pattern 2).
- **No sanctioned repair path.** Once immutability lands, historical data fixes (e.g. the invoice/payment audit's deferred repairs) have no legal channel — teams would be tempted to bypass triggers with SQL.

## Proposed Solution

### 1. Posted-record immutability: `payment`, `memo`, `invoiceSettlement`

Same pattern as the period-closing journal trigger (`20260702044133` wave): `BEFORE UPDATE OR DELETE` row triggers whose functions are `SECURITY DEFINER`, so they bind PostgREST users, edge functions, and service-role jobs alike. Semantics derived from the actual void path (`packages/database/supabase/functions/post-payment/index.ts:150-207` — void posts a NEW reversing journal and updates only `status`/`voidedAt`/`voidedBy`/`updatedAt`/`updatedBy`):

| Table | Draft | Posted | Voided |
|---|---|---|---|
| `payment` | freely editable/deletable (existing RLS) | UPDATE allowed **only** for the transition `status: Posted → Voided` + `voidedAt`/`voidedBy`/`updatedAt`/`updatedBy`; every other column must be byte-identical. DELETE rejected. | Terminal — all UPDATE/DELETE rejected. |
| `memo` | same | same (`Posted → Voided` only) | same |
| `invoiceSettlement` | editable while funding source (`paymentId` → `payment.status` / `memoId` → `memo.status`) is `Draft` | frozen — all UPDATE/DELETE rejected once the source is `Posted` or `Voided` | frozen |

Settlement rows are **never deleted on void**: the derived invoice balance views already filter `p."status" = 'Posted'` (`20260630095023_invoice-derived-status.sql:64,167`), so voiding the source releases the invoices while the settlement history survives as evidence. The column-set comparison is implemented as `to_jsonb(OLD) - allowed_keys = to_jsonb(NEW) - allowed_keys` so future column additions are frozen by default. The Repair channel (§6) and reversal flows never need in-place edits — void/repair always post new documents.

### 2. DB-level double-entry enforcement (SD-1 remainder)

A **deferred constraint trigger** asserting per-journal balance at COMMIT, tolerance ±0.01 (base currency; matches the app-layer assertion in the manual-JE service):

- `AFTER INSERT OR UPDATE OR DELETE ON "journalLine"` — `CONSTRAINT TRIGGER ... DEFERRABLE INITIALLY DEFERRED`, re-checks the parent journal's Σ(`amount`) when the parent `journal.status = 'Posted'`. Deferral means posters that insert the header and lines across multiple statements in one transaction are validated once, at COMMIT, when all lines exist.
- `AFTER UPDATE OF "status" ON "journal"` — same deferred check when `NEW.status = 'Posted'`, catching the Draft→Posted transition of manual JEs (whose lines predate the flip and may legitimately be unbalanced while Draft).

Draft journals stay exempt (the draft editor saves lines incrementally); the period-close readiness blocker "TB balanced" remains as the report-level control. Both functions are `SECURITY DEFINER` and raise `EXCEPTION 'Journal % does not balance: sum of line amounts is %'` — every writer, including edge functions and Inngest service-role jobs, is covered. No existing data risk: an implementation pre-check `SELECT "journalId" FROM "journalLine" GROUP BY 1 HAVING abs(sum(amount)) >= 0.01` runs before the migration ships; any hits are repaired via the Repair channel first.

### 3. Audit hardening: synchronous, always-on, append-only, 7-year floor

**Resolved (program resolution 2026-07-03/04, Brad): synchronous trigger-based in-transaction audit writes for accounting tables**, replacing the async PGMQ path *for those tables only*. Operational entities keep the existing PGMQ → Inngest pipeline unchanged.

**Mechanism.** A new `SECURITY DEFINER` trigger function `audit_accounting_change()` + registration helper `attach_audit_trigger(table_name, entity_type, entity_id_column DEFAULT NULL)`:

- `AFTER INSERT OR UPDATE OR DELETE FOR EACH ROW`, computes the diff in SQL (`to_jsonb(OLD)`/`to_jsonb(NEW)`, skipping `updatedAt`/`updatedBy`/`embedding` per `auditConfig.skipFields`), resolves `entityId` (own PK for roots; the named column for children, e.g. `journalLine.journalId`), captures `actorId` from `auth.uid()` (NULL = service role/system), and INSERTs directly into `auditLog_{companyId}` **in the same transaction**. If the posting transaction rolls back, so does its audit row; if the audit insert fails, the posting fails — the trail can never be missing for a committed change. No snapshot-FK resolution in v1 sync path (that stays an async-path nicety); `metadata.origin = 'sync'` distinguishes provenance.
- Group-scoped tables without `companyId` (`account`, `accountingBook`) fan the row out to each company in the group (companies resolved inside the definer function) so per-company audit tables stay self-contained.

**Coverage** (triggers attached in the migration; the future-proof rows are registered by their own specs' migrations calling `attach_audit_trigger` when the tables land):

| Entity (audit.config key) | Tables (role) | When |
|---|---|---|
| `journalEntry` ("Journal Entry") | `journal` (root), `journalLine` (child via `journalId`) | now |
| `account` ("Account") | `account` (root, group-scoped fan-out) | now |
| `accountingPeriod` ("Accounting Period") | `accountingPeriod` (root), `periodCloseTask` (child via `accountingPeriodId`) | now (task table lands with period-closing) |
| `periodCloseTaskDefinition` | `periodCloseTaskDefinition` (root) | with period-closing |
| `payment` ("Payment") | `payment` (root), `invoiceSettlement` (child via `paymentId`) | now |
| `memo` ("Memo") | `memo` (root), `invoiceSettlement` (child via `memoId`) | now |
| `sequence` ("Sequence") | `sequence` (root) | now |
| `userPermission` ("User Permissions") | `userPermission` (root) | now |
| `apiKey` ("API Key") | `apiKey` (root) | now |
| `approval` ("Approval") | `approvalRequest` (root), `approvalRule` (root) | now |
| `accountDefault` ("Account Defaults") | `accountDefault` (root) | now |
| `paymentTerm` ("Payment Term") | `paymentTerm` (root) | now |
| `bankAccount` ("Bank Account") | `bankAccount` (root) | with bank-rec spec |
| `taxCode` ("Tax Code") | `taxCode` (root), `taxCodeComponent` (child) | with tax spec |
| `customerTax` / `supplierTax` | move from async extension coverage to sync roots | now |
| `accountingBook` ("Accounting Book") | `accountingBook` (root, fan-out), `accountingBookCompany` (child via `bookId`) | now (§5) |

`audit.config.ts` gains these entities plus a per-entity `mode: "sync"` flag and `retentionClass: "accounting"`; sync entities are excluded from `attach_event_trigger`/`syncAuditSubscriptions` (no double-write) but keep driving the UI (labels, entity drawer, `getEntityPath` prefixes `je`→journal entry, `pay`→payment). **`audit.config.ts` is ask-first per `packages/database/AGENTS.md` — this spec is the ask.**

**Always-on.** The accounting sync triggers are attached unconditionally in the migration and are NOT managed by `enableAuditLog`/`disableAuditLog` — the company toggle governs operational entities only. Consequence: `auditLog_{companyId}` must exist for every company — the migration runs `create_audit_log_table` for all companies missing one, and `seed-company` creates it at company creation.

**Append-only lockdown.** On all `auditLog_%` tables (existing + created): `REVOKE UPDATE, DELETE ON ... FROM authenticated, anon, service_role`; restrictive RLS policies denying UPDATE/DELETE for belt-and-braces; `create_audit_log_table` updated to apply both to future tables. INSERT flows only through the `SECURITY DEFINER` writers (`audit_accounting_change()`, `insert_audit_log_batch`). Deletion happens exclusively inside a hardened `delete_old_audit_logs` (SECURITY DEFINER, owner postgres), which now enforces retention classes internally.

**Retention.** Per-class: operational keeps `retentionDays: 30` → archive → delete. Accounting-class rows (`retentionClass: "accounting"`) have a **7-year floor (2,557 days)**: the nightly archive job (`audit-log-archive`) still archives them to the `private` bucket on the hot-retention schedule and may delete hot rows *only after* the archive row is recorded in `auditLogArchive`, and `delete_old_audit_logs` refuses to touch accounting-class rows younger than the floor when no verified archive exists. Archive objects for accounting entities are excluded from any cleanup for 7 years (config: `auditConfig.retentionByClass = { operational: 30, accounting: 2557 }`). The audit-settings UI loses the disable affordance for accounting entities, with explanatory copy.

### 4. JE population export

The single flat export behind SOX AS 2401 sampling, FEC (Phase 3 renders its 18-field layout over this), SAF-T, and GoBD data access. **Streaming, no row caps.**

- **Route:** `apps/erp/app/routes/x+/accounting+/exports.journal-entries.tsx` — loader gated `requirePermissions({ view: "accounting" })`; GET params `fiscalYear` or `fromDate`/`toDate`, `bookId` (default: the group's Primary book), `format` (`csv` default, `jsonl`), `status` (default `Posted,Reversed`; `all` includes Draft for internal review, flagged in the header row).
- **Service:** `getJournalEntryExportStream(client, companyId, options)` in `accounting.service.ts` — Kysely batched keyset pagination (via `fetchRecordsInBatches` semantics: order by `journal.postingDate, journal.id, journalLine.id`), piped into a `ReadableStream` returned as `Response` with `Content-Disposition: attachment`. Memory-flat at any population size.
- **Columns (one row per journal line):** `journalId`, `journalEntryId`, `journalLineId`, `accountId`, `accountNumber`, `accountName`, `amount` (signed, base currency), `debit`, `credit` (presentation split of `amount`), `postingDate`, `accountingPeriod` (FY·period), `createdAt`, `postedAt`, `createdBy` (line — from the period-closing fold-in), `preparedBy`, `approvedBy` (from Spec B; blank until it lands), `status`, `sourceType`, `documentType`, `documentId`, `externalDocumentId`, `documentLineReference`, `reversalOfId`, `reversedById`, `sourceCurrencyCode`, `sourceAmount`, `exchangeRate` (from the bank-rec fold-in; blank where predating it), `bookId`, `description`, `repairReason` (§6). Spec C later adds the `isBackdated` flag column.
- **Reconciliation contract:** for any `[from, to]` with default filters, per-account `openingBalance(from − 1 day)` + Σ(export `amount`) = `closingBalance(to)`, where both balances come from `accountTreeBalancesByCompany` with `p_include_drafts = false` (financial-reporting fold-in) and the same `p_book_id`. This identity is a shipped test, not documentation.
- **UI:** an Exports card on the accounting section (page `/x/accounting/exports/journal-entries`): fiscal-year/date-range picker, book picker, format toggle, download button; row-count preview via a cheap `count(*)` before streaming.

### 5. `journal.bookId` + `accountingBook` (GAP-5 step 1)

**Resolved scoping (program resolution 2026-07-03, Brad): group-scoped definitions with per-company enablement.** `accountingBook` mirrors the `account`/`currency`/`accountCategory` group-scoped master-data pattern (`20260228023426`): single-column PK, `companyGroupId NOT NULL`, group RLS helpers. `accountingBookCompany` is the standard company-scoped enablement table. Seeds: one `Primary`-type book named "Primary" per `companyGroup` (migration for existing groups; `seed-company` for new), enabled for every company in the group.

`journal.bookId` is added nullable → backfilled to the group's Primary book id → `SET NOT NULL`. A tiny `BEFORE INSERT` trigger fills `bookId` with the company's group Primary book when the poster passes none — every existing posting path keeps working unchanged, and adjustment-book posters (Phase 3) pass it explicitly. Balance RPCs (`accountTreeBalances`, `accountTreeBalancesByCompany`, `translateTrialBalance` — being redefined by the financial-reporting spec anyway) gain `p_book_id TEXT DEFAULT NULL`, where NULL resolves to the group's Primary book; the `journalLines` view exposes `bookId`. Index: `journal ("bookId", "companyId")`.

### 6. `'Repair'` journal source type — the only sanctioned data-fix channel

**Resolved (program resolution 2026-07-03, Brad): reversal-only plus a controlled repair channel — no in-place edits ever, for anyone including the service role.**

- `ALTER TYPE "journalEntrySourceType" ADD VALUE IF NOT EXISTS 'Repair';` — classified as an **accounting** source under the period-closing matrix (postable into Locked periods, never Closed ones).
- `journal.repairReason TEXT` + CHECK constraint: `sourceType = 'Repair'` ⟹ `repairReason IS NOT NULL` (and `repairReason` only on Repair journals). The reason lands in the JE export and audit log.
- **Permissioned:** posting a Repair journal requires `delete: "accounting"` — the de-facto module-admin tier, following the period-closing precedent (reopen = `delete: accounting`; no new RBAC action, which is ask-first territory).
- **Correcting-entries only:** a Repair journal is an ordinary balanced journal (the §2 trigger applies) posted through `postJournalEntry`; it never edits existing rows. Once posted it is immutable like any journal (period-closing trigger) — a wrong repair is itself corrected by reversal or another repair.
- The invoice/payment audit's deferred historical-repair work, and any future data-fix script (service role included), flows through this channel; direct SQL fixes on posted rows are physically blocked by the §1/§2 and period-closing triggers.
- UI: `sourceType = 'Repair'` selectable in the journal-entry form only for users with `delete: accounting`, revealing a required Reason field; Repair entries render a distinct badge in the journal list and GL detail.

### Design Decisions

| # | Decision | Choice | Rationale |
|---|----------|--------|-----------|
| 1 | Multi-tenancy heuristic | New tables: `accountingBookCompany` has `companyId` + composite PK + `id('abc')` + audit columns. **Deviations:** `accountingBook` is group-scoped (single PK + `companyGroupId`, like `account`); `payment`/`memo`/`invoiceSettlement`/`journal` keep their existing single-column PKs untouched | Group master data follows the `20260228023426` precedent, not the company template; churning existing PKs = high risk, zero gain (period-closing made the same call for `accountingPeriod`) |
| 2 | Service shape heuristic | All new functions in `accounting.service.ts` (`getJournalEntryExportStream`, `getAccountingBooks`, `upsertAccountingBook`, `setBookCompanyEnablement`), `(client, ...)` → `{data, error}`, never throw; the export loader consumes the stream variant | `.ai/rules/conventions-services.md`; one module service file |
| 3 | RLS coverage heuristic | `accountingBook`: SELECT `get_company_groups_for_employee()`, writes `get_company_groups_for_root_permission('accounting_*')` (the `account` pattern). `accountingBookCompany`: the four standard policies, SELECT role / writes `accounting_*`. Audit tables: existing permissive policies replaced by SELECT-only + restrictive deny on UPDATE/DELETE | Matches `20260228023426:781-804` exactly; audit tables must be tamper-evident |
| 4 | Permission scoping heuristic | Export + book read: `view: accounting`; book management: `update: accounting`; Repair posting: `delete: accounting`; audit settings unchanged (`settings_update`) | Follows the branch precedent of reusing `accounting_*` tiers; no new RBAC actions (ask-first) |
| 5 | Form pattern heuristic | Book settings + Repair reason use `ValidatedForm` + zod validators in `accounting.models.ts` + route actions with `intent`; export page is a GET form (no mutation) | `.ai/rules/conventions-forms.md` |
| 6 | Module layout heuristic | Everything in `modules/accounting` (`accounting.models.ts`/`accounting.service.ts`/`ui/`); DB-side helpers in migrations; `audit.config.ts` edits in `packages/database` | No new files outside existing module structure except routes |
| 7 | Backward compatibility heuristic | Additive schema only; no FROZEN surface touched. Behavior changes (frozen posted payments, balance rejection, always-on audit) activate for existing companies at the readiness cutover event; posting-function changes ship as coordinated PRs per the FX-spec precedent | Readiness spec Design Decision 15; the §1 semantics were reverse-engineered from the live void path so no legitimate flow breaks |
| 8 | Immutability mechanism | Status-transition-only `SECURITY DEFINER` triggers, all period states, JSONB column-set comparison | Period-close trigger precedent; RLS demonstrably failed (`WITH CHECK (true)`, service-role bypass); JSONB diff freezes future columns by default |
| 9 | Settlement void semantics | Settlements are never deleted/updated after source posts; void flips only the source status | Derived balance views already filter `status = 'Posted'` (`20260630095023`) — history survives, invoices release, no schema change |
| 10 | Balance enforcement point | Deferred constraint trigger at COMMIT, Posted journals only, ±0.01 | Drafts are legitimately unbalanced mid-edit; deferral tolerates multi-statement posters; COMMIT-time is the only point that binds every writer |
| 11 | Audit write mechanism | Synchronous DB trigger writing `auditLog_{companyId}` in-transaction; PGMQ retained for operational entities | Program resolution 2026-07-03/04 (Brad): never fire-and-forget for accounting entities; same-transaction = atomic with the change; outbox rejected as it re-introduces a loss window |
| 12 | Audit always-on + retention | Accounting entities non-disablable; per-class retention `{ operational: 30, accounting: 2557 }`; archives are the 7-year system of record; append-only via REVOKE + restrictive policies + hardened delete RPC | Program resolution: company toggle governs operational entities only; ICFR evidence must be complete and tamper-evident |
| 13 | Book scoping | Group-scoped `accountingBook` + `accountingBookCompany` enablement; seeded Primary per group; NULL `p_book_id` = Primary | Program resolution 2026-07-03 (Brad): matches the shared-COA pattern; a statutory book is defined once per group, enabled per entity |
| 14 | `bookId` population | Nullable→backfill→NOT NULL + BEFORE INSERT default-fill trigger; no poster signature changes in this spec | Minimal impact: zero coordinated poster PRs now; Phase 3 adjustment-book posters opt in explicitly |
| 15 | Export delivery | Streaming loader Response (keyset-batched Kysely), CSV/JSONL, Posted+Reversed default | No row caps is the auditor requirement; PostgREST 1000-row limit and in-memory CSV both disqualified |
| 16 | Repair channel | New `'Repair'` sourceType + required `repairReason` + `delete: accounting` gate; correcting entries only | Program resolution 2026-07-03 (Brad); enum value is additive; permission reuses the established admin tier |

## Data Model Changes

One migration wave (`pnpm db:migrate:new record-integrity-audit-hardening`, randomized HHMMSS; then `pnpm run generate:types`). Sketches (representative, idempotent like `20260630093809`):

```sql
-- 1. Payment/memo immutability (invoiceSettlement analogous, checking source status)
CREATE OR REPLACE FUNCTION enforce_posted_payment_immutability()
RETURNS TRIGGER SECURITY DEFINER SET search_path = public AS $$
DECLARE allowed CONSTANT TEXT[] := ARRAY['status','voidedAt','voidedBy','updatedAt','updatedBy'];
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD."status" <> 'Draft' THEN
      RAISE EXCEPTION '% % is %; posted records are immutable — void it instead', TG_TABLE_NAME, OLD."id", OLD."status";
    END IF;
    RETURN OLD;
  END IF;
  IF OLD."status" = 'Voided' THEN
    RAISE EXCEPTION '% % is Voided (terminal)', TG_TABLE_NAME, OLD."id";
  END IF;
  IF OLD."status" = 'Posted' THEN
    IF NOT (NEW."status" = 'Voided'
      AND to_jsonb(OLD) - allowed = to_jsonb(NEW) - allowed) THEN
      RAISE EXCEPTION '% % is Posted; only the Posted -> Voided transition is allowed', TG_TABLE_NAME, OLD."id";
    END IF;
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;

CREATE TRIGGER "payment_immutability" BEFORE UPDATE OR DELETE ON "payment"
  FOR EACH ROW EXECUTE FUNCTION enforce_posted_payment_immutability();
CREATE TRIGGER "memo_immutability" BEFORE UPDATE OR DELETE ON "memo"
  FOR EACH ROW EXECUTE FUNCTION enforce_posted_payment_immutability();
-- invoiceSettlement: enforce_settlement_immutability() rejects UPDATE/DELETE when
-- the funding source (payment/memo by paymentId/memoId) is not 'Draft'.

-- 2. Deferred double-entry constraint (±0.01), Posted journals only
CREATE OR REPLACE FUNCTION assert_journal_balanced()  -- shared by both constraint triggers
RETURNS TRIGGER SECURITY DEFINER SET search_path = public AS $$ ... $$; -- Σ(amount) check
CREATE CONSTRAINT TRIGGER "journalLine_balance" AFTER INSERT OR UPDATE OR DELETE ON "journalLine"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION assert_journal_balanced();
CREATE CONSTRAINT TRIGGER "journal_post_balance" AFTER UPDATE OF "status" ON "journal"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION assert_journal_balanced();

-- 3. Synchronous audit: attach_audit_trigger(...) + audit_accounting_change();
--    create_audit_log_table for companies missing one; on all auditLog_% tables:
--    REVOKE UPDATE, DELETE FROM authenticated, anon, service_role; restrictive
--    deny policies; delete_old_audit_logs gains per-class retention enforcement.
SELECT attach_audit_trigger('journal', 'journalEntry');
SELECT attach_audit_trigger('journalLine', 'journalEntry', 'journalId');
SELECT attach_audit_trigger('payment', 'payment');
-- ... (full coverage table in §3; account/accountingBook use the group fan-out variant)

-- 5. Books (group-scoped, mirrors "account" per 20260228023426)
CREATE TABLE IF NOT EXISTS "accountingBook" (
  "id" TEXT NOT NULL DEFAULT id('bk') PRIMARY KEY,
  "companyGroupId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "type" TEXT NOT NULL DEFAULT 'Primary',      -- 'Primary' | 'Adjustment' (Phase 3)
  "accountingPrinciple" TEXT,                   -- 'US-GAAP' | 'IFRS' | 'Local' | 'Tax'
  "baseBookId" TEXT REFERENCES "accountingBook"("id"),
  "active" BOOLEAN NOT NULL DEFAULT TRUE,
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  "customFields" JSONB,
  CONSTRAINT "accountingBook_companyGroupId_fkey" FOREIGN KEY ("companyGroupId")
    REFERENCES "companyGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "accountingBook_group_name_key" UNIQUE ("companyGroupId", "name")
);
CREATE UNIQUE INDEX "accountingBook_one_primary_per_group"
  ON "accountingBook" ("companyGroupId") WHERE "type" = 'Primary';
-- RLS: SELECT get_company_groups_for_employee();
--      writes get_company_groups_for_root_permission('accounting_*').

CREATE TABLE IF NOT EXISTS "accountingBookCompany" (
  "id" TEXT NOT NULL DEFAULT id('abc'),
  "companyId" TEXT NOT NULL,
  "bookId" TEXT NOT NULL REFERENCES "accountingBook"("id") ON DELETE CASCADE,
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  CONSTRAINT "accountingBookCompany_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "accountingBookCompany_companyId_fkey" FOREIGN KEY ("companyId")
    REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "accountingBookCompany_book_company_key" UNIQUE ("bookId", "companyId")
);
-- Standard four RLS policies: SELECT role; writes accounting_*.
-- Indexes on companyId, bookId, createdBy. Seed: Primary book per group,
-- enablement row per company; seed-company does both for new tenants.

-- journal.bookId: add nullable -> backfill to group Primary -> SET NOT NULL;
-- BEFORE INSERT default-fill trigger; index ("bookId","companyId");
-- balance RPCs gain p_book_id TEXT DEFAULT NULL (NULL = Primary).

-- 6. Repair channel
ALTER TYPE "journalEntrySourceType" ADD VALUE IF NOT EXISTS 'Repair';
ALTER TABLE "journal" ADD COLUMN IF NOT EXISTS "repairReason" TEXT;
ALTER TABLE "journal" ADD CONSTRAINT "journal_repairReason_check" CHECK (
  ("sourceType" = 'Repair') = ("repairReason" IS NOT NULL)
);
```

## API / Service Changes

- `accounting.service.ts`: `getJournalEntryExportStream(client, companyId, { fiscalYear?, fromDate?, toDate?, bookId?, format, status })`; `getAccountingBooks(client, companyGroupId)`; `upsertAccountingBook(client, ...)`; `setBookCompanyEnablement(client, ...)`; `postJournalEntry` gains the Repair gate (`sourceType === 'Repair'` ⟹ `requirePermissions` checked `delete: accounting` at the route + `repairReason` required in the validator) — all `(client, ...)` → `{data, error}`.
- `accounting.models.ts`: `journalEntryValidator` extended with optional `sourceType`/`repairReason` (zod refinement pairs them); `accountingBookValidator`; `journalEntryExportValidator`.
- Routes: `x+/accounting+/exports.journal-entries.tsx` (streaming loader, `view: accounting`); `x+/accounting+/books.tsx` (loader + action with `intent`: `upsert` | `enable` | `disable`, `update: accounting`).
- `packages/database`: `audit.config.ts` entity additions + `mode`/`retentionClass` knobs (this spec is the ask); `audit.ts` — `enableAuditLog`/`disableAuditLog`/`syncAuditSubscriptions` skip sync-mode entities; `packages/jobs` archive function reads `retentionByClass` and the archive-before-delete rule.
- Balance RPCs: `p_book_id` parameter (coordinated with the financial-reporting spec's `p_include_drafts` redefinition — one RPC rewrite, both parameters).
- No posting edge-function changes required by this spec (bookId defaults via trigger; balance/immutability are backstops). The tax and bank-rec specs each add one `attach_audit_trigger` call in their own migrations.

## UI Changes

- **JE export page** (`/x/accounting/exports/journal-entries`): date/fiscal-year picker, book picker, format toggle, Posted+Reversed default badge, download (streams).
- **Books settings** (`/x/accounting/books`): group-level book list (Primary badge, principle), per-company enablement toggles; Adjustment-type creation disabled with "Phase 3" hint.
- **Journal entry form:** Repair source option visible only with `delete: accounting`; required Reason field; Repair badge in journal list + GL detail drill-down.
- **Audit-log settings:** disable toggle removed for accounting entities with explanatory copy ("Accounting audit is always on and retained 7 years"); entity list shows sync/async + retention class.
- Flash messages on all mutations per `.ai/rules/flash-system.md`.

## Acceptance Criteria

- [ ] A Posted `payment` rejects, via PostgREST with `invoicing_update` credentials AND via a direct service-role UPDATE: any change to `totalAmount`, `bankAccount`, `customerId`, or `postingDate`; the void flow (post-payment edge function) still succeeds and the settlement rows remain untouched; a Voided payment rejects all further UPDATEs; DELETE of a Posted payment is rejected while Draft delete still works. Same matrix passes for `memo`.
- [ ] An `invoiceSettlement` UPDATE/DELETE succeeds while its funding payment is Draft and is rejected (all roles, including service role) once that payment is Posted; after voiding the payment, the target invoice's derived balance is restored without any settlement row changing.
- [ ] A transaction that inserts a Posted journal with lines summing to +0.02 fails at COMMIT with the balance error, from (a) SQL as service role, (b) the post-purchase-invoice edge function patched in a test to skew one line; the same transaction with |Σ| ≤ 0.01 commits. A Draft journal with unbalanced lines saves fine, and flipping it to Posted fails at COMMIT until balanced.
- [ ] With the company audit toggle OFF, an UPDATE to `journal`, `payment`, `account`, `sequence`, `accountDefault`, `paymentTerm`, and `userPermission` each produce an `auditLog_{companyId}` row with actor + field diff, visible in the same transaction's read (synchronous); rolling back the transaction leaves no audit row; an operational entity (e.g. `salesOrder`) writes nothing while the toggle is off.
- [ ] UPDATE and DELETE on `auditLog_{companyId}` fail for authenticated users AND for the service role; `delete_old_audit_logs` refuses accounting-class rows younger than 2,557 days without a recorded archive, and the archive job's uploaded object + `auditLogArchive` row precede any hot delete of accounting rows.
- [ ] The JE export for a fiscal year streams >100k lines without OOM, contains every journal line of every source type (manual, invoices, receipts, shipments, payments, memos, depreciation, Repair), and per account: opening TB (day before range, `p_include_drafts=false`, same book) + Σ(export amounts) = closing TB — asserted by an automated test on seeded data.
- [ ] Every `companyGroup` has exactly one Primary `accountingBook` after migration; every company has an enablement row; every existing and newly posted `journal` row carries that book's `bookId` without any poster change; `accountTreeBalancesByCompany(p_book_id => NULL)` equals pre-migration results exactly; a second (Adjustment) book's journals are excluded from default balances and included when its id is passed.
- [ ] A user with `update: accounting` but not `delete: accounting` cannot post a Repair journal (server-side rejection); with `delete: accounting`, posting without a reason fails validation, posting with a reason succeeds, the reason appears in the JE export and audit log, and the posted Repair journal is immutable (period-closing trigger) and reversal-correctable only.
- [ ] `pnpm run generate:types`, scoped `typecheck`, and `pnpm run lint` pass; the migration applies idempotently twice.

## Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| An unknown writer legitimately mutates Posted payments/memos beyond the void transition | Med | Writer inventory pre-implementation (`grep` posting/edge/Xero-sync surfaces); §1 semantics were derived from the live void path; Xero sync errors surface via the existing integration error queue (period-closing precedent) |
| Existing unbalanced journals in production make the constraint trigger a landmine on any later line UPDATE | Med | Pre-migration balance sweep; repairs posted via the Repair channel before triggers activate; migration NOTICE lists offenders |
| Synchronous audit writes slow posting hot paths | Med | One indexed INSERT per changed row in the same transaction; benchmark post-payment/post-invoice before+after in the plan; row-level JSONB diff is O(columns); accounting inserts are not high-frequency |
| Audit fan-out for group-scoped tables (`account`) multiplies rows across large groups | Low | Groups are small (subsidiary counts); COA edits are rare; measured in the same benchmark |
| REVOKE on `auditLog_%` breaks the Inngest archive/delete jobs | Med | Jobs already operate through SECURITY DEFINER RPCs (`get_audit_logs_for_archive`, `delete_old_audit_logs`); verify no direct table DML in `packages/jobs` before shipping |
| `bookId` NOT NULL backfill on a large `journal` table locks writes | Low | Add column nullable + backfill in batches + `SET NOT NULL` last (validated constraint pattern); journals table is moderate-sized |
| Interplay with in-flight branch specs (period-closing trigger wave, financial-reporting RPC rewrite, Spec B approval columns) | Med | Sequencing: this spec's migration lands after the period-closing migration; the RPC `p_book_id` addition is coordinated into the financial-reporting RPC rewrite PR; export columns tolerate NULL `preparedBy`/`approvedBy` until Spec B lands |
| Always-on audit surprises existing companies (storage growth) | Low | Accounting-entity write volume is modest; 30-day hot window unchanged (archives carry the 7 years); release note at the cutover event |

## Open Questions

> All resolved before writing — recorded per the spec lifecycle (resolutions carry the program decisions; this section is the audit trail, not a to-do list).

- [x] **Audit write mechanism for accounting tables (sync trigger vs transactional outbox vs hardened PGMQ)?** — **Answer: synchronous, trigger-based, in-transaction writes for accounting tables; operational tables keep PGMQ** — program resolution 2026-07-03/04 (Brad). Never fire-and-forget for ICFR evidence; the outbox alternative re-introduces a loss window between commit and drain.
- [x] **Is audit logging disablable for accounting entities, and what retention applies?** — **Answer: always-on for accounting entities (company toggle governs operational entities only); append-only tables; retention floor 7 years for accounting entities, 30-day default stays operational** — program resolution 2026-07-03/04 (Brad).
- [x] **`audit.config.ts` is an ask-first file (`packages/database/AGENTS.md`) — is the entity extension approved?** — **Answer: yes — this spec IS the ask**, per the roadmap Phase 0 Spec A item; coverage list fixed as §3's table (including future-proof `taxCode`/`taxCodeComponent`/`bankAccount` registered by their own specs).
- [x] **Sanctioned repair path under immutability?** — **Answer: reversal-only plus a controlled `'Repair'` journal source type — permissioned (`delete: accounting`), reason required, correcting-entries only, itself immutable and audit-logged; no in-place edits ever, including service role** — program resolution 2026-07-03 (Brad).
- [x] **Book scoping (company vs group)?** — **Answer: group-scoped `accountingBook` definitions with a per-company enablement table (`accountingBookCompany`), like the shared chart of accounts; seeded `PRIMARY` book per group enabled for all companies; balance RPCs filter by book with Primary as default** — program resolution 2026-07-03 (Brad).
- [x] **Payment/memo immutability semantics?** — **Answer: `Posted → Voided` status transitions only, SECURITY DEFINER binding the service role, mirroring the period-closing journal trigger** — program resolution 2026-07-03/04 (Brad); the allowed column set (`voidedAt`/`voidedBy`/`updatedAt`/`updatedBy`) verified against the live void path in `post-payment/index.ts`.
- [x] **Balance enforcement shape?** — **Answer: deferred constraint trigger asserting Σ(signed `journalLine.amount`) = 0 per journal at COMMIT, ±0.01 tolerance, all writers** — program resolution 2026-07-03/04 (Brad); Posted-only scoping (Drafts exempt) follows from the existing draft-editing workflow and the financial-reporting Posted-only fold-in.
- [x] **JE export scope?** — **Answer: streaming route + service, no row caps; columns per §4 (ids, account, signed amount + debit/credit presentation, posting date, createdAt/postedAt, createdBy/preparedBy/approvedBy, source type, document reference, reversal linkage, source currency/amount, bookId); must reconcile opening TB + export = closing TB** — program resolution 2026-07-03/04 (Brad).

## Changelog

- 2026-07-04: Created (Phase 0 Spec A, tracking crbnos/carbon#1047). All open questions resolved before writing via the 2026-07-03/04 program resolutions recorded in `.ai/specs/2026-07-03-public-company-readiness.md` §Open Questions and `.ai/plans/2026-07-03-public-company-readiness-roadmap.md` §Governing decision 5. Immutability semantics grounded in `20260630093809_ar-ap-payments.sql` + `post-payment/index.ts` void path; settlement freeze relies on the `status='Posted'` filter in `20260630095023_invoice-derived-status.sql`; book RLS mirrors `20260228023426_company-groups.sql:781-804`; audit design extends `20260212152709_audit_log_system.sql` + `packages/database/src/audit.config.ts`.
