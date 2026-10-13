# Accounting PR review corrections

- PR: https://github.com/crbnos/carbon/pull/1599
- Branch: assess-issue-against-code; base: origin/main
- Request: after making the PR, wait for the coderabbit review, and then solve the problems
- Status: corrections validated and pushed in de7ab3bbdb; refreshed remote checks pending
- Scope: approved accounting posting corrections, confirmed nuclear-review findings, and verified CodeRabbit findings
- Exclusions remain: France/e-invoicing, historical cutover machinery, live provider writes, new production dependencies, database reset/rebuild

## Progress

- [x] Create PR and push reviewed branch
- [x] Restore existing workspace PostgreSQL container without changing its data volume
- [x] Establish live baseline: 84 report cases and 15 payment/memo/concurrency tests pass
- [x] Capture completed CodeRabbit review and classify every finding against code
- [x] Signed original control amounts, exhaustive invoice posting roles, and shared remaining-balance arithmetic (M1, M7, R4)
- [x] Complete invoice reads and preserve manual memo principal (M4, M5)
- [x] Original provider accounts, canonical invoice source loader, provider contract fixes and errors (M2, M3, M7, R1/R2/R3, S2)
- [x] Narrow subsidiary CTA resolution, atomic defaults update, and historical chart completeness (M6, M8, R5, S3)
- [x] Address additional confirmed CodeRabbit findings
- [x] Update docs/test runner and remove duplicate SQL regression ownership where warranted (D1-D4, S1)
- [x] Run ordered scoped validation, review integrated diff, commit and push fixes
- [x] Check resulting PR review/check state and update PR description with final evidence

## Implementation slices

- Invoicing: `apps/erp/app/modules/invoicing/invoicing.service.ts` and its settlement/component tests. Page invoice, settlement and control reads with stable ordering and ID batches; preserve manual document principal; reuse the shared reducers while retaining Draft reservation eligibility at query boundaries.
- Providers: `packages/ee/src/accounting/core/sales-invoice-source.ts`, `document-costing.ts`, and Xero/QBO/Rillet invoice/bill adapters and tests. Normalize invoice sources once, preserve original shipping/AP account roles, represent Xero lines as exact monetary units with native tax and explicit foreign 1:1 rates, recover failed QBO tax cache reads, and retain structured missing-account warnings.
- Reporting: `apps/erp/app/modules/accounting/accounting.ee.{service,server}.ts`, defaults/balance-sheet routes and tests. Write defaults in one statement, resolve only the authorized group's root CTA configuration, and preserve inactive historical accounts with complete chart/RPC paging.
- Root: pure edge utilities, payment/memo transactions, both unshipped SQL migrations, database regressions, tracked verification runner and documentation. Existing role vocabulary is exhaustive; tenant/source/status filters remain in transport queries.

Behavior changes require failing regressions followed by the same tests passing. Scoped commands: `pnpm --filter @carbon/ee test`, `pnpm --filter @carbon/ee typecheck`, and `pnpm --dir apps/erp exec vitest run app/modules/invoicing app/modules/accounting/accounting.defaults.test.ts app/modules/accounting/accounting.translation.test.ts app/routes/x+/reports+/balance-sheet.test.ts`. Expected: all scoped tests and typechecks pass; unauthorized CTA roots, malformed source principal, late-page failures and invalid mapping writes fail without partial state.

## Root slice implementation and verification

1. Extend `packages/database/supabase/functions/post-payment/post-payment-transaction.test.ts` and `packages/database/supabase/tests/accounting-balances-and-reports.test.sql` with mixed positive/negative AR/AP originals and IC original-account fixtures; assert actual original GL relief, no invented FX, correct open/aging balances, and correct account after defaults change.
2. Run new tests red before changing the production reducer or SQL; use the existing local wrapper until a tracked safe runner is introduced.
3. Add a pure exhaustive invoice posting-role selector under `packages/database/supabase/functions/shared/`, with a `packages/utils/src/` re-export and barrel entry; share the existing immutable journal description vocabulary across readers and keep company/source/status filtering in transport queries.
4. Extend the existing `shared/payment-funding.ts` with canonical settlement effectiveness, invoice remaining amounts, and funding-source remaining amounts; remove duplicate economic reductions from edge and ERP call sites while preserving Draft reservation policy separately.
5. Replace magnitude sums in the unshipped branch report migration with signed natural sums and include exhaustive IC controls; reapply only the existing read-model definitions locally, reload PostgREST if needed, and regenerate DB types before typechecking. No schema/role column or legacy calculation mode is required.
6. Run corrected SQL and actual posting transaction suites green, then validate remaining edge helpers and utility exports.

Commands (from repository root):

```sh
pnpm exec tsx scripts/run-local-accounting-check.ts psql -X -v ON_ERROR_STOP=1 -f packages/database/supabase/tests/accounting-balances-and-reports.test.sql
pnpm exec tsx scripts/run-local-accounting-check.ts deno test --no-lock --no-check --allow-env --allow-net --config packages/database/supabase/functions/deno.json packages/database/supabase/functions/post-payment/post-payment-transaction.test.ts packages/database/supabase/functions/post-payment/post-payment-concurrency.test.ts packages/database/supabase/functions/post-memo/post-memo-transaction.test.ts
pnpm run generate:types
pnpm exec tsx scripts/run-local-accounting-check.ts psql -X -v ON_ERROR_STOP=1 -f packages/database/supabase/tests/accounting-defaults-report-access.test.sql
pnpm --filter @carbon/database typecheck
pnpm --filter @carbon/utils typecheck
pnpm --filter @carbon/utils test
pnpm db:check:datasets
pnpm exec tsx scripts/run-local-accounting-check.ts pnpm db:check:backups
```

Expected: new economic regressions fail for their claimed amounts before the fix, then pass through actual production paths; generated types are untouched manually; database compatibility checks inspect the existing local schema and pass. Pure Deno helpers are typechecked separately from the known Node/Deno Postgres typing baseline.

## Integration gate

Follow check-and-commit: generated types/catalog if required, scoped Biome, package typechecks, scoped meaningful tests, build only when export changes require it, i18n extraction/verification, then explicit-file conventional commits and push. Record every command/outcome in the run log; do not mark unresolved provider sandbox evidence as passed.
