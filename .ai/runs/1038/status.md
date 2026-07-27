# 1038 — Gapless Numbering & Legal Series: run status

Branch: `feature/gapless-numbering`
Spec: `.ai/specs/2026-07-04-gapless-numbering-legal-series.md`

This branch rebases the deferred foundation (draft PR #1182 / `loop/1038`) onto
current `origin/main` and adds the safe, verifiable next layer. The **atomic
allocator, immutability triggers, `legalSeries` substrate, nullable-draft columns,
and the `gaplessFrom` cutover already ship in the foundation migration**; this
branch adds the service/UI/hardening around it. The one genuinely risky,
DB-only-verifiable step — moving document-number allocation from draft-creation
to posting time and enabling the `get_next_sequence` RPC guard — remains the
documented "coordinated wave" (Decision 15) and is mapped below.

## In this branch

### DB (already-shipped foundation, unchanged)
- `20260721162233_gapless-numbering-legal-series.sql` — `sequence` hardening
  (`isLegalSequence`/`firstUsedAt`/`gaplessFrom` + `sequenceImmutabilityCheck`
  trigger for every role), atomic allocators `get_next_sequence_atomic` /
  `get_next_legal_series_number`, `legalSeries` table + RLS + immutability
  trigger, nullable draft number columns behind status CHECKs, per-company
  `gaplessFrom` cutover stamp. Idempotent (`IF NOT EXISTS` / `DROP … IF EXISTS`).
- `functions/shared/get-next-sequence.ts` — the shared edge helper is a single
  atomic `UPDATE … RETURNING` on the caller's `trx`, so every ~18 in-transaction
  poster is already race-free and gap-free on rollback.

### DB (new this branch)
- `20260724161500_gapless-allocator-revoke.sql` — REVOKE EXECUTE on both atomic
  allocators from `PUBLIC`/`anon`/`authenticated`. A `SECURITY DEFINER` function
  is granted to PUBLIC by default, which would expose the allocators as PostgREST
  RPCs and let any client burn an accounting number in a standalone transaction —
  the exact SD-2 gap source. They must only run inside a posting transaction on
  the service-role/superuser connection. Confirmed no app/edge caller invokes
  them via PostgREST.

### App
- `accounting.models.ts` — `legalSeriesValidator` + `legalSeriesDocumentTypes`
  (foundation).
- `accounting.service.ts` — `getLegalSeries`, `getLegalSeriesById`,
  `getLegalSeriesList`, `upsertLegalSeries`, `deleteLegalSeries` (+ exported
  `LegalSeries` row type). The `legalSeries` table is not yet in generated types,
  so these use an `any`-typed client and return hand-written row shapes; regen
  types once the migration is applied.
- `@carbon/utils` `accounting.ts` — `getDocumentReadableId(number, id)` /
  `getDraftDocumentPlaceholder(id)` → `Draft-{last6}`, with unit tests. The
  reusable primitive for rendering number-less drafts.
- Legal Series accounting-settings CRUD UI (routes/form/table/nav) mirroring
  Payment Terms; used series show frozen format fields.
- Sequences settings form: format fields disabled once
  `isLegalSequence && firstUsedAt` (mirrors the DB trigger — avoids a confusing
  500 on a rejected edit).

## Verification here
- `@carbon/utils`: test + typecheck green (placeholder helpers).
- `@carbon/erp` / `@carbon/database`: typecheck green.
- **No Postgres/stack in this environment** — the migration was not applied and
  `generate:types` was not run. Everything DB-level (SQL syntax, triggers,
  CHECKs, the REVOKE, and every concurrency/rollback acceptance criterion) is
  **unproven at runtime** and must be verified against a live DB before merge.

## Remaining — the posting-time wave (Decision 15, DB-gated)

Enabling the `get_next_sequence` RPC RAISE guard for the six accounting
sequences requires first moving every draft-creation allocator to posting time,
or those callers throw. Full call-site map (verified against the code):

Draft-creation sites to move to posting time (the six sequences):
- `apps/erp/app/modules/invoicing/invoicing.service.ts:431` purchaseInvoice (standalone RPC)
- `apps/erp/app/modules/invoicing/invoicing.service.ts:799` salesInvoice (standalone RPC)
- `apps/erp/app/routes/x+/payments+/new.tsx:129` payment (standalone)
- `apps/erp/app/routes/x+/credits+/new.tsx:50` creditMemo/debitMemo (standalone)
- `apps/erp/app/modules/inventory/inventory.service.ts:391` journalEntry — allocated OUTSIDE its own trx (leaks on rollback)
- `apps/erp/app/modules/accounting/accounting.service.ts:2977` createIntercompanyTransaction
- `packages/database/supabase/functions/create/index.ts:2669` journalEntry draft (in trx, atomic)
- `packages/database/supabase/functions/convert/index.ts:354/847/1434` purchase/sales invoice (in trx, atomic)
- `packages/ee/src/accounting/providers/xero/entities/bill.ts:571` purchaseInvoice (raw SELECT RPC in a Kysely tx)
- `apps/erp/app/routes/api+/settings.sequence.next.ts:21` burner endpoint — mints with no document (pure gap source)

Posting paths that must allocate the number in-transaction, right before the
status flip (each already calls `getNextSequence(trx, "journalEntry", …)` at the
top of the same trx — mirror it for the document sequence, only when the draft's
number is null so pre-existing numbered drafts keep theirs):
- `post-sales-invoice` (flip `salesInvoice.status = "Submitted"`, ~L1274)
- `post-purchase-invoice` (flip `purchaseInvoice.status = "Open"`, ~L2026)
- `post-payment` (flip `payment.status = "Posted"`, ~L779)
- `post-memo` (flip `memo.status = "Posted"`, ~L415; sequence = `creditMemo`/`debitMemo` by `direction`)
- `accounting.service.ts postJournalEntry` (~L3356) and `reverseJournalEntry`
  (~L3459) are supabase-js, not Kysely — refactor onto a Kysely transaction to
  allocate atomically with `getNextSequence(trx, …)`.

Also fold the legacy non-atomic `accounting.server.ts:6` `getNextSequence`
(SELECT-then-UPDATE, no `firstUsedAt` stamp) into the atomic path.

Then: regenerate `packages/database/src/types.ts` (`pnpm run generate:types`);
enable the `get_next_sequence` RPC guard; wire `getDocumentReadableId` into the
five list columns + five detail headers (numbers are non-null until this wave, so
the placeholder is inert before it); add the `sequence`/`legalSeries` audit
coverage + `isBackdated` JE-export column (owned by #1047); run the allocator
concurrency + rollback acceptance tests against a live DB.
