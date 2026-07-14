# Gapless Numbering & Legal Series

> Status: in-progress
> Author: Claude (Phase 0 Spec C), for brad@carbonos.dev
> Date: 2026-07-04
> Tracking issue: [crbnos/carbon#1038](https://github.com/crbnos/carbon/issues/1038)
> Program: `.ai/specs/2026-07-03-public-company-readiness.md` finding **SD-2**; roadmap `.ai/plans/2026-07-03-public-company-readiness-roadmap.md` Phase 0 Spec C
> Coordinates with: #1047 record-integrity spec (audit coverage + JE export), #1032 document approvals (`.ai/specs/2026-07-04-document-approvals.md`), #1054 e-invoicing (`.ai/specs/2026-07-04-e-invoicing.md`, written in parallel)

## TLDR

Accounting document numbers (journals `JE-`, payments `PAY-`, memos `CR-`/`DR-`, sales invoices, purchase invoices) become **gapless from a per-company cutover date forward**: the final number is assigned **inside the posting transaction** by an atomic, per-company-per-sequence serialized counter, so a failed post leaves no hole and concurrent posts cannot duplicate. Drafts carry no legal number — they display a placeholder derived from the internal id until posted. `sequence` rows for accounting documents become **immutable after first use** (format frozen, counter monotonic, no delete) via a trigger that binds every role, and their changes are audit-logged. A new **`legalSeries`** table (company × country × document type) provides the statutory gapless-series substrate for customer-facing sales invoices and credit memos in EU/LatAm jurisdictions; the e-invoicing spec wires it to documents. Existing documents are **never renumbered** — historical gaps before the cutover date are documented, not rewritten.

## Problem Statement

SD-2: numbering and dating are not audit-grade. Concretely, in today's code:

1. **Gaps by pre-allocation.** Manual journals get `journalEntryId` at *draft creation* (`functions/create/index.ts:2665`); sales/purchase invoices, payments, and memos get their numbers at draft creation too (`apps/erp/app/modules/invoicing/invoicing.service.ts:431,799`, `accounting.service.ts:2068`). Delete the draft — or fail the insert after the standalone `get_next_sequence` RPC has already committed its increment in its own transaction — and the number is consumed forever. FEC/SAF-T validators and audit JE-population procedures test sequential completeness; every hole is an exception to explain.
2. **Duplicates by race.** Both `functions/shared/get-next-sequence.ts` and the `get_next_sequence` RPC (`20241115101526`) do an unlocked SELECT followed by an UPDATE. Two concurrent posters can read the same `next`, and the second blindly writes the same computed value — **duplicate document numbers under concurrency**, the opposite failure of gapless.
3. **Rewind → reuse.** The `sequence` table is editable by any `settings_update` user (`updateSequence` in `settings.service.ts:1113` — plain UPDATE, no guard). Rewinding `next` mints duplicates of already-issued numbers; changing `prefix`/`size` silently forks the number space. None of it is audit-logged (`sequence` is absent from `audit.config.ts`).
4. **No legal series.** EU/LatAm statutory rules require gapless, per-series numbering of *customer-facing* invoices/credit memos (per establishment/country/document type; Portugal adds ATCUD + registered series). Carbon has one flat `salesInvoice` sequence per company and no series concept.
5. **Backdating is invisible.** `postingDate ≪ createdAt` within an open period is unrestricted and unflagged anywhere an auditor looks.

**Resolved constraints baked in** (program resolutions 2026-07-03, readiness spec Open Questions): forward-only fix — the `JE-%{yyyy}-%{mm}-` format stays and **existing documents are never renumbered** (retroactive renumbering is itself an audit red flag); gapless applies to **all accounting document sequences in one pass** (Brad accepted the recommendation): `journalEntry`, `payment`, `creditMemo`, `debitMemo`, `salesInvoice`, `purchaseInvoice`.

## Proposed Solution

### 1. Posting-time assignment with a draft placeholder

The legal number is born when the document is posted — never before.

- **System-generated journals** (post-receipt, post-shipment, post-sales-invoice, post-purchase-invoice, post-payment, post-memo, post-production-event, issue, close-job, and the SQL posters in `20260630092517`) already allocate inside their posting transaction. They keep that shape and just switch to the atomic allocator (§2) — the sequence increment commits or rolls back with the journal.
- **Manual journals, payments, memos, sales invoices, purchase invoices** stop allocating at draft creation. The number column becomes NULL-able while Draft (and while `Pending Approval`, per the approvals spec); the posting path (edge function or `postJournalEntry`) calls the allocator inside its transaction, immediately before flipping status.
- **Draft display**: drafts render `Draft-{last 6 of internal id}` plus the existing status badge, everywhere the number shows today (document lists, detail headers, related-document links, search). Route URLs already use the internal `id`, so no URL changes. Draft PDFs (sales invoice preview) render a `DRAFT` watermark and the placeholder — a legal number never appears on an unposted artifact.

**Why not keep draft-time allocation and re-assign the legal number at post?** Rejected: (a) a re-assigned number means the reference a user already emailed/quoted changes at post — two identities per document is a reconciliation and support hazard; (b) draft-time allocation still burns numbers on deleted/abandoned drafts, so the sequence is *not* gapless and the whole point is lost; (c) statutory series rules define the number as assigned at issuance — before posting there is legally no document. Posting-time + placeholder gives each document exactly one number for life. (Xero's approve-time invoice numbers and SAP's park→post flow are the reference behaviors.)

### 2. Atomic per-company-per-sequence allocation

Replace read-then-write with a **single-statement atomic increment**; the ordinary row lock taken by `UPDATE` is the serialization point (equivalent to `SELECT ... FOR UPDATE` but race-free by construction and one round trip):

```sql
-- get_next_sequence_atomic(sequence_name text, company_id text) RETURNS text
-- SECURITY DEFINER, search_path = public; same permission preamble as
-- get_next_sequence (has_role('employee') / valid API key).
UPDATE "sequence"
   SET "next" = "next" + "step",
       "firstUsedAt" = COALESCE("firstUsedAt", NOW()),
       "updatedAt" = NOW(), "updatedBy" = 'system'
 WHERE "table" = sequence_name AND "companyId" = company_id
 RETURNING "prefix", "suffix", "next", "size" INTO STRICT ...;
-- format: interpolated prefix || lpad(next, size, '0') || interpolated suffix
-- (reuses the %{yyyy}/%{mm}/... interpolation from 20241115101526)
```

- **Gapless semantics**: called only *inside the posting transaction* (Kysely `trx` in edge functions; the plpgsql posters; `postJournalEntry`). Rollback reverts the increment with the document — no gap. The shared TS helper `functions/shared/get-next-sequence.ts` is rewritten to issue this single statement on the caller's `trx`.
- **Serialization scope**: the lock is one `sequence` row = one company × one document type. Concurrent posts in the same company/type queue behind each other for the remainder of the posting transaction; different companies (or different document types) touch different rows — **zero cross-company contention**. To keep the hold window short, posters allocate as the **last step** before the status flip, after all lines/validation are written.
- **Advisory-lock key scheme** (documented for any future path that cannot ride the row lock, e.g. multi-document batch posting that must avoid lock-order deadlocks): `pg_advisory_xact_lock(hashtextextended('sequence:' || company_id || ':' || sequence_name, 0))`, taken before the first allocation in the batch. Not used in v1 — the row lock suffices; single allocation per transaction cannot deadlock on it.
- **Throughput**: measure before/after with the plan's benchmark (N concurrent `post-payment` + `post-sales-invoice` calls, same company vs. spread across companies). Expected cost is the sequence-row lock held for the tail of a posting transaction (~tens of ms). Per-company serialization of posting is acceptable and is exactly what NetSuite/SAP do per numbering range; record the measured numbers in the run log.
- The **existing `get_next_sequence` RPC** stays for operational sequences (quotes, jobs, POs, fixed assets, …) but gains a guard: it RAISEs for the six accounting sequences ("allocated at posting") so no PostgREST path can burn an accounting number in a standalone transaction.
- **Monthly prefix, continuous counter**: `%{yyyy}-%{mm}` interpolation is cosmetic labeling of issuance date; the integer never resets (no reset logic exists today — confirmed). Interpolation keeps using allocation wall-clock time, so numbers are issued in strictly chronological order — the property sequential-issuance checks actually test. `JE-2026-07-000124` following `JE-2026-06-000123` is correct and expected.

### 3. `sequence` immutable-after-first-use

New columns: `firstUsedAt` (stamped by the allocator), `isLegalSequence` (true for the six accounting tables), `gaplessFrom` (the per-company cutover stamp, §6). A plain trigger (fires for **every** role — service role and `SECURITY DEFINER` functions included, following the period-close backstop precedent `20260702044133`):

- Once `isLegalSequence AND firstUsedAt IS NOT NULL`: reject any change to `prefix`, `suffix`, `size`, `step`, `table`, `companyId`; reject any decrease of `next` (**rewind→duplicate hole closed**); `next` increases only.
- DELETE on a used legal sequence is rejected outright.
- Operational sequences keep today's editability.
- The sequences settings UI disables format fields for used accounting sequences with explanatory copy; `updateSequence` returns the trigger error as a form error.
- **Audit**: `sequence` joins `audit.config.ts` coverage via the record-integrity spec (#1047 owns the `audit.config.ts` ask); this spec's acceptance depends on rejected edits *and* successful pre-first-use edits both appearing there. Allocator increments (`updatedBy = 'system'`) are exempted from audit noise by diff config.

### 4. `legalSeries` — statutory series substrate

Per company × country × document type series for **customer-facing** documents (sales invoices, credit memos — not journals; program resolution). This spec ships the table, the allocator, and nullable document columns; series *selection*, issuance rules, ATCUD/hash-chaining, and format rendering are the e-invoicing spec's job (#1054, `.ai/specs/2026-07-04-e-invoicing.md`).

- One series = one independent gapless counter, allocated by `get_next_legal_series_number(series_id, company_id)` — same atomic UPDATE…RETURNING mechanism, same posting-transaction rule, same immutable-after-first-use trigger (format frozen, `next` monotonic, no delete; retirement is `validTo`/`isActive`, never removal).
- `salesInvoice` and `memo` (per the memo-refactor model) gain nullable `legalSeriesId` + `legalNumber`. Companies with no series configured are unaffected: `invoiceId` (now gapless) remains the document number, `legalNumber` stays NULL.
- Per-country validation content (which countries *require* a series, registration formats) is e-invoicing scope; this table stores `registrationRef` opaquely.

### 5. Backdating flag

The rule is defined here; the surface lives in the record-integrity spec's JE population export (#1047): a journal is flagged `isBackdated` when `postingDate < (createdAt AT TIME ZONE company tz)::date - 1 day`. Computed in the export query (no stored column); the export adds the boolean plus the day-delta so auditors can filter materiality themselves. No posting-time restriction in this spec — the period-close trigger already bounds how far back a posting can land.

### 6. Cutover — forward-only

Per program resolution: historical gaps are **documented, never repaired**, and nothing is renumbered.

- Migration stamps `sequence."gaplessFrom" = NOW()` on the six accounting sequences for companies that are accounting-active today; for everyone else, the accounting cutover event (#1057) stamps it at activation.
- `gaplessFrom` is the auditable assertion: "numbers in this sequence are gapless from this timestamp forward; earlier gaps predate the control." The JE export (#1047) includes it per sequence so an FEC/completeness reviewer sees the boundary instead of discovering it.
- Existing draft documents that already carry numbers keep them (the CHECK constraints allow numbered drafts); only *new* drafts are born number-less.

### Design Decisions

| # | Decision | Choice | Rationale |
|---|----------|--------|-----------|
| 1 | Assignment moment | Posting-time, inside the posting transaction; drafts carry a placeholder | Only construction that is actually gapless; one number per document for life; rejected draft-time+reassign (two identities, still gaps on deleted drafts) — §1 |
| 2 | Serialization mechanism | Single-statement atomic `UPDATE … RETURNING` on the sequence row | Race-free by construction (kills the current SELECT-then-UPDATE duplicate race); row lock = per-company-per-type scope; simpler than FOR UPDATE or advisory locks; advisory-lock key scheme documented for future batch posters — §2 |
| 3 | Scope | All six accounting sequences in one pass (JE, PAY, CR/DR, sales + purchase invoices) | Program resolution (Brad, recommendation accepted); one allocator, one trigger, one cutover — no second migration wave |
| 4 | History | Forward-only; never renumber; `gaplessFrom` documents the boundary | Program resolution 2026-07-03: retroactive renumbering is itself an audit red flag; `JE-yyyy-mm-` format is not a violation |
| 5 | Counter reset | No monthly reset; `%{yyyy}-%{mm}` labels issuance date, interpolated at allocation time | Continuous integer is what completeness checks test; chronological issuance order preserved; matches existing behavior (no reset logic exists) |
| 6 | Draft placeholder | `Draft-{last 6 of internal id}`, `DRAFT` watermark on preview PDFs | Stable, searchable, unmistakably non-legal; URLs already use internal ids so routing is untouched |
| 7 | Sequence lockdown mechanism | Trigger (all roles), not RLS | RLS is role-scoped and demonstrably leaky (MW-1 precedent); trigger binds service role and SECURITY DEFINER posters; period-close backstop precedent |
| 8 | `legalSeries` write permission | `accounting_update` (not `settings_update`) | SD-2's complaint is exactly that settings users control legal numbering; statutory series are an accounting control surface |
| 9 | Multi-tenancy (H1) | `legalSeries` has `companyId`, composite PK `("id","companyId")`, `id('ls')`; `sequence` keeps its existing shape (columns added only) | Convention; altering `sequence`'s PK is out of scope |
| 10 | Service shape (H2) | New/changed functions in existing `settings.service.ts` (sequences) and `sales`/`invoicing` services (series CRUD); `client` first, `{data,error}`, never throw | Convention; no new service files needed beyond the module rule |
| 11 | RLS (H3) | `legalSeries`: 4 policies — SELECT `get_companies_with_employee_role()`, writes `get_companies_with_employee_permission('accounting_*')` | `.ai/rules/conventions-database.md`; trigger provides the immutability layer RLS cannot |
| 12 | Permissions (H4) | Series routes `requirePermissions({ view: "accounting" })` / `{ update: "accounting" }` | Decision 8 |
| 13 | Forms (H5) | `LegalSeriesForm` = ValidatedForm + zod validator + route action, per conventions; sequence form gains disabled-state handling | Convention |
| 14 | Module layout (H6) | Series models/service in `modules/accounting` (`accounting.models.ts` / `accounting.service.ts`); no new module | One service/models file per module rule |
| 15 | Backward compat (H7) | Additive schema; NOT NULL relaxed only where drafts need it, backstopped by CHECKs; posting edge functions change in one coordinated PR wave (FX-spec precedent); MCP/API create-document tools return the placeholder until post | FROZEN surfaces untouched; existing numbers byte-for-byte stable (acceptance-tested) |

## Data Model Changes

```sql
-- 1) sequence hardening
ALTER TABLE "sequence"
  ADD COLUMN "isLegalSequence" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "firstUsedAt" TIMESTAMP WITH TIME ZONE,
  ADD COLUMN "gaplessFrom" TIMESTAMP WITH TIME ZONE;

UPDATE "sequence" SET "isLegalSequence" = true
WHERE "table" IN ('journalEntry','payment','creditMemo','debitMemo',
                  'salesInvoice','purchaseInvoice');
-- gaplessFrom stamped now for accounting-active companies; else at cutover (#1057)

CREATE OR REPLACE FUNCTION "sequenceImmutabilityCheck"() RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD."isLegalSequence" AND OLD."firstUsedAt" IS NOT NULL THEN
      RAISE EXCEPTION 'Used accounting sequences cannot be deleted';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD."isLegalSequence" AND OLD."firstUsedAt" IS NOT NULL THEN
    IF NEW."prefix"    IS DISTINCT FROM OLD."prefix"
    OR NEW."suffix"    IS DISTINCT FROM OLD."suffix"
    OR NEW."size"      IS DISTINCT FROM OLD."size"
    OR NEW."step"      IS DISTINCT FROM OLD."step"
    OR NEW."table"     IS DISTINCT FROM OLD."table"
    OR NEW."companyId" IS DISTINCT FROM OLD."companyId" THEN
      RAISE EXCEPTION 'Sequence format is immutable after first use';
    END IF;
    IF NEW."next" < OLD."next" THEN
      RAISE EXCEPTION 'Sequence cannot be rewound (next % -> %)', OLD."next", NEW."next";
    END IF;
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER "sequenceImmutability" BEFORE UPDATE OR DELETE ON "sequence"
  FOR EACH ROW EXECUTE FUNCTION "sequenceImmutabilityCheck"();

-- 2) atomic allocators: get_next_sequence_atomic(text, text) per §2;
--    get_next_sequence gains: IF sequence is legal THEN RAISE 'allocated at posting'.

-- 3) drafts carry no number (existing numbered drafts remain valid)
ALTER TABLE "journal" ALTER COLUMN "journalEntryId" DROP NOT NULL;
ALTER TABLE "journal" ADD CONSTRAINT "journal_posted_requires_number"
  CHECK ("status" = 'Draft' OR "journalEntryId" IS NOT NULL);  -- approvals spec adds its parked status here
CREATE UNIQUE INDEX "journal_journalEntryId_key"
  ON "journal" ("companyId","journalEntryId") WHERE "journalEntryId" IS NOT NULL;
-- payment.paymentId, memo id columns, salesInvoice.invoiceId, purchaseInvoice.invoiceId:
-- same DROP NOT NULL + status CHECK (number required to leave Draft) + partial unique index.

-- 4) legal series substrate
CREATE TABLE "legalSeries" (
    "id" TEXT NOT NULL DEFAULT id('ls'),
    "companyId" TEXT NOT NULL,
    "countryCode" TEXT NOT NULL,                    -- ISO 3166-1 alpha-2
    "documentType" TEXT NOT NULL,                   -- 'salesInvoice' | 'creditMemo' (CHECK)
    "code" TEXT NOT NULL,                           -- series code, e.g. 'FT2026A'
    "name" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "size" INTEGER NOT NULL DEFAULT 6 CHECK ("size" >= 1),
    "next" INTEGER NOT NULL DEFAULT 0 CHECK ("next" >= 0),
    "validFrom" DATE NOT NULL,
    "validTo" DATE,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "firstUsedAt" TIMESTAMP WITH TIME ZONE,
    "registrationRef" TEXT,                         -- e.g. PT ATCUD validation code (opaque here)
    "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "updatedBy" TEXT REFERENCES "user"("id"),
    "updatedAt" TIMESTAMP WITH TIME ZONE,
    "customFields" JSONB,
    CONSTRAINT "legalSeries_pkey" PRIMARY KEY ("id", "companyId"),
    CONSTRAINT "legalSeries_unique" UNIQUE ("companyId","countryCode","documentType","code"),
    CONSTRAINT "legalSeries_companyId_fkey" FOREIGN KEY ("companyId")
      REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "legalSeries_default_key" ON "legalSeries"
  ("companyId","countryCode","documentType") WHERE "isDefault" AND "isActive";
ALTER TABLE "legalSeries" ENABLE ROW LEVEL SECURITY;
-- SELECT: get_companies_with_employee_role(); INSERT/UPDATE/DELETE:
-- get_companies_with_employee_permission('accounting_create'/'_update'/'_delete')::text[]
-- Same immutability trigger family: format frozen + next monotonic + no delete after firstUsedAt.

ALTER TABLE "salesInvoice" ADD COLUMN "legalSeriesId" TEXT, ADD COLUMN "legalNumber" TEXT;
ALTER TABLE "memo"         ADD COLUMN "legalSeriesId" TEXT, ADD COLUMN "legalNumber" TEXT;
CREATE UNIQUE INDEX "salesInvoice_legalNumber_key"
  ON "salesInvoice" ("companyId","legalSeriesId","legalNumber") WHERE "legalNumber" IS NOT NULL;
-- get_next_legal_series_number(series_id, company_id): atomic UPDATE…RETURNING, §4.
```

`pnpm run generate:types` after the migration, before typechecking.

## API / Service Changes

- `functions/shared/get-next-sequence.ts` → single-statement atomic increment on the caller's `trx` (same signature; all ten edge-function call sites unchanged except moving the call to just before the status flip where it isn't already).
- `create/index.ts` `journalEntry` case: stop allocating; insert Draft with NULL `journalEntryId`. Same for draft-creation paths of payments/memos (`accounting.service.ts`) and sales/purchase invoices (`invoicing.service.ts` — drop the `get_next_sequence` RPC calls).
- Posting paths (`post-payment`, `post-memo`, `post-sales-invoice`, `post-purchase-invoice`, `postJournalEntry`, and void/reverse flows which mint *new* journal numbers) allocate in-transaction via the atomic helper/RPC. Void/reversal documents get fresh numbers as today — never reuse.
- `get_next_sequence` RPC: RAISE on legal sequences; unchanged for operational ones.
- `updateSequence` surfaces the trigger error; sequence loader returns `firstUsedAt`/`isLegalSequence` for UI disabling.
- New in `accounting.models.ts`/`accounting.service.ts`: `legalSeriesValidator`, `getLegalSeries`, `getLegalSeriesList`, `upsertLegalSeries` (deactivate-only after use), barrel-exported.
- Audit coverage for `sequence` + `legalSeries` and the JE export's `isBackdated` column land via the record-integrity spec (#1047); this spec's migration must merge before or with its audit-config PR.

## UI Changes

- Sequences settings page: format fields disabled once a legal sequence is used ("locked after first use" copy); `next` field hidden for legal sequences.
- New **Legal Series** section under accounting settings: table + `LegalSeriesForm` (country, document type, code, prefix, size, validity, default toggle); used series show frozen format.
- Draft placeholder rendering (`Draft-{id6}`) in journal/payment/memo/invoice lists, detail headers, and document-reference links; `DRAFT` watermark on unposted sales-invoice PDFs.
- No changes to posted-document UI: numbers appear exactly where they do today, just later in the lifecycle.

## Acceptance Criteria

- [ ] **No gap on failure**: a posting transaction forced to fail *after* allocation (simulated error before COMMIT) rolls back the increment; the next successful post of the same document type in that company receives the number the failed attempt would have had.
- [ ] **Concurrency, same company**: N parallel posts of the same document type produce N distinct, consecutive numbers with no duplicates and no gaps (the SELECT-then-UPDATE duplicate race is demonstrably dead — regression test at the allocator level).
- [ ] **Concurrency, cross-company**: parallel posts in different companies show no lock contention (benchmark recorded in the run log; per-company serialization cost measured and documented).
- [ ] **Sequence lockdown**: after first use, updating `prefix`/`suffix`/`size`/`step`, rewinding `next`, or deleting an accounting sequence is rejected for every role including service role; the rejected attempt and any permitted pre-first-use edit both appear in the audit log (with #1047's coverage) with actor and before/after.
- [ ] **Draft lifecycle**: a new manual JE/payment/memo/invoice draft has a NULL number and renders the `Draft-{id6}` placeholder; posting assigns the number in-transaction; the CHECK constraint makes a number-less non-Draft row impossible; pre-existing numbered drafts still post keeping their original numbers.
- [ ] **History untouched**: after migration, every existing document's number is byte-for-byte identical; `gaplessFrom` is stamped on the six sequences of accounting-active companies.
- [ ] **Legal series**: allocation from a series is gapless per series under the same failure/concurrency tests; a second active default series for the same company+country+type is rejected; a used series' format is frozen and it cannot be deleted.
- [ ] **RPC guard**: `get_next_sequence` via PostgREST refuses the six accounting sequences; operational sequences (e.g. `job`, `purchaseOrder`) behave exactly as before.
- [ ] **Backdating**: the JE export (#1047) flags a journal posted with `postingDate` more than one day before `createdAt` and shows the day delta.

## Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| Per-company serialization slows high-volume posting | Med | Lock scope is company × document type only; allocate last in the transaction; benchmark in acceptance; advisory-lock scheme documented for future batch posters |
| A missed writer keeps draft-time allocation (10+ edge functions + app services touch sequences) | High | Grep-enumerable call sites (`getNextSequence`/`get_next_sequence`); the RPC guard turns any missed accounting-path caller into a loud failure, not a silent gap |
| Draft placeholder confuses users who reference draft numbers today | Med | Placeholder is stable and searchable; release note; posted behavior unchanged |
| Interplay with approvals spec (#1032): parked documents must stay number-less | Med | CHECK constraints written status-aware; approvals spec adds `Pending Approval` to the Draft side of each CHECK — coordinated in that PR |
| External sync (Xero) or MCP tools read the number pre-post | Med | Inventory readers of the five number columns; syncs already operate on posted documents; MCP create tools return the placeholder |
| `NOT NULL` relaxation weakens integrity if CHECKs are wrong | Low | Partial unique indexes + status CHECKs tested; DB-level, not app-level |

## Open Questions

> HARD STOP: Do not proceed with implementation until these are answered.

- [x] **Renumber history to close existing gaps?** — Resolved (program, 2026-07-03): **No — forward-only.** Existing documents are never renumbered; `JE-yyyy-mm-` format stays; historical gaps documented via per-company `gaplessFrom` cutover. (Readiness spec, Open Question "Gapless numbering domain".)
- [x] **Which sequences go gapless?** — Resolved (Brad, recommendation accepted): **all accounting document sequences in one pass** — journals, payments, credit/debit memos, sales invoices, purchase invoices. (Roadmap Phase 0 Spec C; this spec's Decision 3.)
- [x] **Draft numbering model?** — Resolved (program direction for this spec): **posting-time assignment with a draft placeholder**, not draft-time allocation with re-assignment at post; justification and UI implications in §1/Decision 1/6.
- [x] **Do journals need statutory legal series?** — Resolved (program, 2026-07-03): no — legal series apply to customer-facing sales invoices/credit memos only; journals need gaplessness, not series. `legalSeries` is the e-invoicing substrate and is wired to documents by #1054.
- [x] **Where do the JE export and backdating flag live?** — Resolved: the export (and therefore the `isBackdated` surface) belongs to the record-integrity spec (#1047); this spec defines the rule only (§5).

No new blocking questions — every remaining choice is recorded in Design Decisions.

## Changelog

- 2026-07-04: Created (Phase 0 Spec C, tracking crbnos/carbon#1038) with all program resolutions baked in; coordinates with #1047 (audit coverage, JE export), #1032 (parked-status CHECKs), #1054 (legal-series wiring).
