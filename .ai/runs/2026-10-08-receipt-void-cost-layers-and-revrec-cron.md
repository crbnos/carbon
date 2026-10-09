# Bugfix run: purchase receipt void leaves cost layers; revenue recognition cron runs for companies with accounting off

- Date: 2026-10-08
- Mode: fully-autonomous
- Request: "great. make sure to fix the new bugs we found" — the 2 bugs recorded in `.ai/specs/implemented/2026-10-08-accounting-cutover.md` (Risks; section 1):
  1. A purchase receipt void reverses `itemLedger` and journal lines but never updates `costLedger`. The voided layer keeps its `remainingQuantity`.
  2. The `revenue-recognition-proposal` cron proposes Draft runs for companies with accounting off.
- Phase plan: root-cause [run] · instrument [resolved after root-cause] · fix [run] · test [skip — pure logic, the regression tests prove it] · commit [skip — no explicit ask]

## Decisions

- instrument: skip — both causes are HIGH confidence and visible in code — 2026-10-08
- regression test (bug 1): a pure planner `planReceiptVoidCostLedger` with a unit test. The live-database fixtures skip without a local `SUPABASE_DB_URL`, and none is running in this worktree — 2026-10-08
- consumed receipt layers: refuse the void, as the sales-return void already does (now `post-receipt/index.ts:436`) and as Business Central's Undo Receipt does — 2026-10-08

## Phase log

- root-cause: HIGH ×2. The `post-receipt` line numbers in this entry are from before the fix. Bug 1: the PO void path (`post-receipt/index.ts:581-1057`) never touches `costLedger`; posting writes `Purchase Receipt` layers by `documentId` (`:1738-1777`) and negative lines relieve layers FIFO (`:2114-2151`). Bug 2: the cron enumerates every `company` (`revenue-recognition-proposal.ts:42`); nothing reads `accountingEnabled`.

- fix bug 1: new pure planner `packages/server-functions/src/post-receipt/void-cost-ledger.ts`. The PO void transaction in `post-receipt/index.ts` reads the receipt's `Purchase Receipt` layers `FOR UPDATE`. It refuses when a later movement used part of one layer. Then it closes the layers and inserts a restoring layer for each negative row. Test `void-cost-ledger.test.ts`: 3 of 4 failed against the stub that copied today's behavior, 4 of 4 pass after.
- fix bug 2: `companiesToPropose` in `revenue-recognition-proposal.ts` keeps only companies whose `companySettings.accountingEnabled` is true. The first step reads those ids with `fetchAllFromTable`. Test: 2 new cases failed against the pass-through stub, 6 of 6 pass after. `packages/jobs/AGENTS.md` row updated. The cron no longer reads `accountingEnabled` (see Later changes).
- gates: biome PASS · typecheck(@carbon/server-functions, @carbon/jobs) PASS · test(@carbon/jobs) 935 passed, 31 skipped · test(@carbon/server-functions) 308 passed, 150 skipped with `SUPABASE_DB_URL` unset. With the worktree `.env` value, the same 150 database tests fail on `ECONNREFUSED 127.0.0.1:54322`: no local database runs here. This change does not cause those failures.
- test (browser): skipped — pure logic, the regression tests prove it.

## Later changes

- 2026-10-08 — bug 2: commit 3b9d4372e9 replaced the `accountingEnabled` filter with a filter on `companySettings.accountingCutoverDate`. The cutover spec retires the flag.
- 2026-10-09 — bug 2: commit 188a710e24 makes `companiesToPropose` one Kysely query (`packages/jobs/src/inngest/functions/scheduled/revenue-recognition-proposal.ts`). The query joins `company` to `companySettings` and keeps the rows where `accountingCutoverDate` is not null. The 2 `fetchAllFromTable` reads are gone. The test compiles the query and checks the join and the filter (`revenue-recognition-proposal.test.ts`).
- 2026-10-09 — bug 1, current locations: the planner `planReceiptVoidCostLedger` is at `packages/server-functions/src/post-receipt/void-cost-ledger.ts:39`. The PO void transaction in `packages/server-functions/src/post-receipt/index.ts` imports it at `:63` and calls it at `:941`. The sales return void refuses a consumed layer at `:436`.

## Outcome

- READY. Not committed: no explicit ask.
