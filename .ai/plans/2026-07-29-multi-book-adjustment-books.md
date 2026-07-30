# Plan — Multi-Book Adjustment Books (#1052)

Tracking spec: `.ai/specs/2026-07-04-multi-book.md`
Issue: crbnos/carbon#1052

## Environment constraint (drives scope)

- Only redis is running locally; **no Postgres**. `pnpm run generate:types` requires a
  local DB (`SUPABASE_DB_URL` localhost) and cannot run here.
- CI `typecheck` uses the **committed** `packages/database/src/types.ts` (it runs app
  `typegen`, not DB `generate:types`), and there is **no CI gate** verifying types match
  migrations. Hand-editing generated DB types is forbidden (AGENTS.md).
- Therefore any TS that references the new tables via Kysely/Supabase (`.from("accountingBook")`,
  service fns, RPC callers, generator runner, UI loaders) **cannot typecheck green** until
  #1047 + type regen land on a machine with a DB.
- #1047 (the shared `accountingBook`/`journal.bookId` seed) is **not merged**.

## Scope for THIS PR (green-CI deliverable)

1. **Migration** `20260729…_multi-book-adjustment-books.sql` — the shared book DDL contract
   this issue owns + this spec's tables. Idempotent (`IF NOT EXISTS`), forward-dated, RLS,
   triggers, seed. Self-contained SQL — no TS typecheck impact.
   - `accountingBook` (group-scoped) + one-Primary-per-group unique index + seed Primary per group
   - `accountingBookCompany` (per-company enablement) + seed Primary enabled per company
   - `journal.bookId` + index + backfill to group Primary + `journal_default_book` BEFORE INSERT trigger
   - guardrail trigger: adjustment-book journals limited to accounting sources + enabled book
   - `ALTER TYPE journalEntrySourceType ADD VALUE 'Book Adjustment'`
   - `fixedAssetBook`, `depreciationRun.bookId`, `bookAdjustmentRun`
   - RLS (4 named policies) on every new table; audit-log coverage
2. **Pure-TS models** in `accounting.models.ts` — const arrays + zod validators only
   (no generated-type dependency): `accountingBookTypes`, `accountingPrinciples`, `bookModes`,
   `accountingBookValidator`, `accountingBookCompanyValidator`, `fixedAssetBookValidator`,
   `bookAdjustmentRunValidator`; add `'Book Adjustment'` to `journalEntrySourceTypes`.
   Export from `index.ts` barrel.

## Deferred to follow-up (needs #1047 + DB type regen)

Service CRUD, RPC `p_book_id`/`p_book_mode` params + callers, `accounting.server.ts` generator
registry + `runBookAdjustmentGenerator` + `statutory-depreciation`, close-checklist registration,
UI (Books settings, JE book selector, report book picker, fixed-asset Books section). These are
recorded in the PR body as the remaining work; they fail typecheck without regenerated types.

## Verify

- `pnpm exec biome check` on changed files
- `pnpm exec turbo run typecheck --filter=erp` (models are pure zod → green)
- `pnpm --filter @carbon/erp test -- --testPathPattern=accounting` (accounting models + related)
- Migration reviewed for idempotency + RLS + forward timestamp
