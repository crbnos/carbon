# Slice 6C.2B1 — real PostgreSQL Impact scope evidence

## Approved scenarios

- Provenance replacement, injected reconciliation-history failure/rollback, and normal retry through `reconcileChangeNoticeImpactProvenance`.
- Affected-item removal, injected post-`DELETE FROM changeOrderAffectedItem` failure/rollback, and normal retry through `removeChangeNoticeAffectedItem`.
- Deterministic two-connection assessment-versus-removal race through `writeChangeNoticeImpactDecision` and `removeChangeNoticeAffectedItem`, accepting either serialized winner.

## Boundaries

The test creates isolated per-run companies, users, Items, locations, units of measure, Jobs, Change Notices, affected-item rows, and Impact rows. It records exact generated IDs, uses raw-pool independent readers, and cleans exact rows plus generated per-company relations with zero-residue checks. Failure drivers target only the intended PostgreSQL history insert or affected-item delete. The race rendezvous is installed immediately before each service's Change Notice `FOR UPDATE` query; no sleeps or probabilistic retries are used.

Explicit exclusions: task bootstrap/link/unlink/designation; terminal-task resolution; parent Change Notice deletion; reconciliation route/caller wiring; parent-delete `assertIsPost`; draft-cleanup hardening; generic source deletion; schema/RLS/MCP/UI/browser work; Slice 6C.2B2 and later slices.

## Verification record

- The scope test (`pnpm --filter erp exec vitest run --disableConsoleIntercept --config vitest.postgres.config.ts app/modules/items/items.impact.scope.postgres.test.ts`) passed: 1 file, 4 tests, 0 skipped. Every fixture and generated-relation residue count was 0.
- The aggregate dedicated suite (`pnpm --filter erp exec vitest run --disableConsoleIntercept --config vitest.postgres.config.ts`) passed: 2 files (`items.impact.writers.postgres.test.ts` and `items.impact.scope.postgres.test.ts`), 5 tests, 0 skipped. Both files reported 0 residue for every fixture and generated relation.
- The focused ordinary suite (`pnpm --filter erp exec vitest run --config vitest.config.ts app/modules/items/items.impact.test.ts app/modules/items/items.impact.reconciliation.test.ts app/modules/items/items.service.test.ts`) passed: 3 files, 197 tests, 0 skipped.
- The race uses the bounded `ParentLockRendezvous(2, 3_000)` timeout, below Vitest's confirmed 5,000 ms default. The provenance replacement test now uses `includeSecondaryTarget: true`, creates both decisions before the source change, identifies them by `targetId`, and proves rollback plus unchanged secondary decision/provenance/history state; the retry proves exactly the two primary provenance history events, one open interval per decision, and no duplicate current provenance.
- ERP typecheck (`pnpm --filter erp typecheck`, the `erp` package's canonical `tsgo --noEmit` script) passed.
- Targeted Biome (`pnpm exec biome check apps/erp/app/modules/items/items.impact.scope.postgres.test.ts`) passed without automatic fixes.
- Discovery verification passed for the dedicated config: `app/**/*.postgres.test.ts` is included, `passWithNoTests: false` is retained, repository enumeration found exactly the writer and scope `*.postgres.test.ts` files, and found 0 `*.postgres.test.tsx` files. The ordinary config explicitly excludes `**/*.postgres.test.ts`. Ordinary `vitest list` did not complete because unchanged, pre-existing batching tests import the absent `20260821024449_job-operation-batching.sql` (and the second also references absent `20260904151137_batch-member-fk-set-null-companyid.sql`); this was not claimed as a successful ordinary discovery.
- Secret inspection of both untracked files found no credential assignments, URL userinfo, non-loopback database URL, or copied environment contents; no actual environment value was printed. Existing safety behavior remains present: loopback-only target, exact `.env.local` target match, Carbon schema check, unique per-run fixture identities, exact/generated-table cleanup, pool closure, environment restoration, no `vi.resetModules()`, and no skipped or focused tests.
- Whitespace checks passed: `git diff --check` and both no-index `git diff --no-index --check -- /dev/null <file>` checks reported no whitespace errors (the no-index commands returned their expected difference status 1).
- Final status is exactly two untracked files: `.ai/plans/2026-09-11-slice6c2b1-real-postgres-scope.md` and `apps/erp/app/modules/items/items.impact.scope.postgres.test.ts`; nothing is staged, committed, or pushed. Production code, existing tests/configuration, schema, RLS, MCP, tasks, and parent deletion remain untouched.
