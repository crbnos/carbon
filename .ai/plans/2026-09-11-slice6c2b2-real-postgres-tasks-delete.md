# Slice 6C.2B2 — real PostgreSQL Impact tasks and deletion

## Goal

Add real-PostgreSQL evidence for the implemented Change Notice Operational Impact task lifecycle, task-gated resolution, parent-delete cascades, and rollback after the parent delete statement. This is a test-only slice: production behavior, existing tests/configuration, schema, RLS, MCP, routes, and UI remain unchanged.

## Allowlisted files

- `.ai/plans/2026-09-11-slice6c2b2-real-postgres-tasks-delete.md`
- `apps/erp/app/modules/items/items.impact.tasks.postgres.test.ts`

## Test boundary

The PostgreSQL test will contain exactly five PostgreSQL tests and will call the production Kysely functions directly:

1. Bootstrap an Action Required decision and Impact follow-up task, inject a failure only after the bound `Task linked` history event executes, prove the transaction rolled back, and retry cleanly.
2. Link one ordinary task to two valid Impact decisions, designate it as Impact follow-up while both links exist, then unlink the first relationship and prove the second relationship and Impact follow-up origin remain. Duplicate link/unlink and repeated designation remain no-ops, with exact feature-history identities.
3. Block resolution while any linked task is non-terminal, then allow explicit resolution once linked tasks are Completed or Skipped without treating task completion as automatic decision resolution.
4. Delete a Change Notice and prove PostgreSQL cascades its Impact task graph while the production cleanup path removes both a referenced inactive Draft Item and a standalone CO-owned Draft Make Method; source fixtures remain available for teardown.
5. Inject a post-write failure on the exact normalized production parent delete statement, prove an independent reader sees the complete pre-delete state including both draft-reference categories, then retry the parent delete and prove zero residue.

Each test will use a unique company and exact fixture IDs. The harness will validate a loopback PostgreSQL target against the current worktree `.env.local`, verify the required Carbon schema tables before importing the service, use independent reader and failure pools, track partial setup, close all pools, restore `SUPABASE_DB_URL`, and verify zero residue including generated per-company relations. It will not use sleeps, probabilistic retries, concurrent writers, production failure hooks, or shared helper files.

## Correction checklist

- [x] Reorder the two-decision relationship test so it links A, links B, designates while both links exist, and unlinks A last. Assert that both decision conclusions stay unchanged at every relationship step, and scope each feature-history check to the decision, task, event type, and creator.
- [x] Replace draft-reference count snapshots with a normalized graph snapshot. Include both affected-item rows, the inactive Draft Item ownership fields, and both Change Notice-owned Draft Make Methods with their item, status, version, and ownership fields.
- [x] Capture that graph before the injected parent-delete failure, compare it after rollback, and assert an empty graph after the retry. Track every affected-item ID in teardown and keep the source-row checks exact.

## Verification record

- The focused PostgreSQL test passed with `pnpm --filter erp exec vitest run --disableConsoleIntercept --config vitest.postgres.config.ts app/modules/items/items.impact.tasks.postgres.test.ts`: 1 file, 5 tests, 5 passed, 0 skipped. The successful-delete test proved the complete Draft Item and Make Method graph existed before deletion and was absent after the committed deletion. The rollback-delete test proved the complete graph was unchanged after the injected post-parent-delete failure and absent after the successful retry. Both deletion tests proved the original source Item and Job remained. Every fixture, Impact row, action-task row, source row, draft row, and generated-relation residue check reported 0.
- The aggregate dedicated PostgreSQL suite passed with `pnpm --filter erp exec vitest run --disableConsoleIntercept --config vitest.postgres.config.ts`: 3 files, 10 tests, 10 passed, 0 skipped. The existing writer and scope harnesses also remained clean.
- The focused ordinary suite passed with `pnpm --filter erp exec vitest run --config vitest.config.ts app/modules/items/items.impact.test.ts app/modules/items/items.impact.reconciliation.test.ts app/modules/items/items.impact.task.test.ts app/modules/items/items.service.test.ts`: 4 files, 241 tests, 241 passed, 0 skipped.
- ERP typechecking passed with `pnpm --filter erp typecheck` (`tsgo --noEmit`). Targeted Biome passed with `pnpm exec biome check apps/erp/app/modules/items/items.impact.tasks.postgres.test.ts`.
- Dedicated discovery listed exactly the existing writer/scope files plus `items.impact.tasks.postgres.test.ts`, for 10 tests total. The ordinary Vitest config still explicitly excludes `**/*.postgres.test.ts`. Unfiltered ordinary `vitest list` was attempted and stopped at the known unrelated missing `packages/database/supabase/migrations/20260821024449_job-operation-batching.sql` import (the second batching test also references the absent `20260904151137_batch-member-fk-set-null-companyid.sql`); this is not introduced by the allowlisted files.
- Secret inspection found no credential assignment, URL userinfo, non-loopback database URL, token, or private-key material. The only database URL literal is the existing unit-test placeholder used to reject it. The harness retains loopback-only target validation, exact `.env.local` target matching, Carbon schema sentinels, independent readers after injected failures, exact/generated-table cleanup, pool closure, environment restoration, and no skipped/focused tests.
- `git diff --check` and both no-index whitespace checks reported no whitespace errors (the no-index checks returned their expected difference status 1). Final Git status is exactly the two untracked allowlisted files; nothing is staged, committed, or pushed, and no production/configuration/existing-test file was changed.
