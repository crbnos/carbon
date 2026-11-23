# Port notes: tests-projects (plan Phase 8, projects + service tests)

Agent `tests-projects`. Worktree `kelowna-port`. Nothing committed. No module code changed.

## Files

Branch = FREEZE `50c4309a9c:packages/server-functions/src/<path>`.

| Branch test | New home | Kind |
|---|---|---|
| `post-timesheet/plan.test.ts` | `apps/erp/app/modules/projects/timesheet-posting-plan.test.ts` | pure |
| `post-project-stock-transfer/plan.test.ts` | `apps/erp/app/modules/projects/stock-transfer-plan.test.ts` | pure |
| `complete-service-order/plan.test.ts` | `apps/erp/app/modules/service/refurbishment-completion-plan.test.ts` | pure |
| `create-service-order-invoice/plan.test.ts` | `apps/erp/app/modules/service/service-invoice-plan.test.ts` | pure |
| `lib/project-cip.test.ts` | `apps/erp/app/modules/projects/project-cip.test.ts` | pure |
| `lib/stock-stripes.test.ts` | `packages/api/src/stock-stripes.test.ts` (the package's `@carbon/config/vitest`; no setup needed) | pure |
| `post-timesheet/post-timesheet.test.ts` | `apps/erp/test/database/post-timesheet/post-timesheet.test.ts` | live |
| `save-timesheet-entry/save-timesheet-entry.test.ts` | `apps/erp/test/database/save-timesheet-entry/save-timesheet-entry.test.ts` | live |
| `submit-timesheet-week/submit-timesheet-week.test.ts` | `apps/erp/test/database/submit-timesheet-week/submit-timesheet-week.test.ts` | live |
| `post-project-burden/post-project-burden.test.ts` | `apps/erp/test/database/post-project-burden/post-project-burden.test.ts` | live |
| `post-project-expense/post-project-expense.test.ts` | `apps/erp/test/database/post-project-expense/post-project-expense.test.ts` | live |
| `post-project-issue/post-project-issue.test.ts` | `apps/erp/test/database/post-project-issue/post-project-issue.test.ts` | live |
| `post-project-stock-transfer/post-project-stock-transfer.test.ts` | `apps/erp/test/database/post-project-stock-transfer/post-project-stock-transfer.test.ts` | live |
| `reclass-project-coverage/reclass-project-coverage.test.ts` | `apps/erp/test/database/reclass-project-coverage/reclass-project-coverage.test.ts` | live |
| `complete-service-order/complete-service-order.test.ts` | `apps/erp/test/database/complete-service-order/complete-service-order.test.ts` | live |
| `create-service-order-invoice/create-service-order-invoice.test.ts` | `apps/erp/test/database/create-service-order-invoice/create-service-order-invoice.test.ts` | live |
| `lib/project-always-post.test.ts` | `apps/erp/test/database/lib/project-always-post.test.ts` | live |
| `lib/project-posting.test.ts` | `apps/erp/test/database/lib/project-posting.test.ts` | mixed (pure `describe` + one `databaseTest`, uses `projectBillingTestFixture`), so it sits with main's other `lib/` tests |
| `lib/service-orders.test.ts` | `apps/erp/test/database/lib/service-orders.test.ts` | live |

Live tests sit in a folder per posting, as main's `post-receipt/`, `post-charge/` do.

Existing test rewritten: `apps/erp/app/routes/x+/service-order+/$id.charge.test.ts` (below).

## How the ports were made

By script (the same transform for every live file), then `biome check --write` through
`--stdin-file-path` (Biome ignores `apps/erp/test/**`):

- Imports: `../lib/project-posting-test-fixture` → `../fixtures/project-posting`,
  `./project-billing-test-fixture` → `../fixtures/project-billing`,
  `../local-database-test-fixture` → `../fixtures/local-database`;
  `../lib/{calculate-cogs,get-accounting-period,plan-adjustment,post-adjustment}` →
  `app/modules/shared/shared.service` (`calculateCOGS`, `resolveAccountingPeriod`,
  `buildAdjustmentJournalLines`, `createAdjustmentJournal`; same signatures, typecheck clean);
  `./project-posting` → `app/modules/projects/project-posting`; `./service-orders` →
  `app/modules/service/service-orders`; each default import of a server function → the named
  body from `projects.service` / `service.service` (plus the named constants the tests
  imported beside it: `TIMESHEET_*`, `ACCOUNTING_PERIOD_CLOSED`, `certificationTextHash`,
  `TIMESHEET_REVIEW_PENDING`, `timecardShortfallMessage`).
- Calls: `postX(ctx, input)` → `invokePosting(handlesOf(ctx), "<kebab name>", input, postX)`.
  Same `{ data, error }` shape, so no assertion changed.
- `save-timesheet-entry`: the second actor `ServerFnContext.system({ db, companyId, userId: managerId })`
  → the plain `{ db, companyId, userId: managerId }`, passed through `handlesOf`.
- Check: every file keeps the branch's test count and its exact count of `expect(` calls
  (e.g. save-timesheet-entry 14 tests / 90 expects, complete-service-order 5 / 53). The
  number of `invokePosting(` calls equals the branch's number of body calls in each file.
  No assertion was edited.

## `$id.charge.test.ts`

The route now calls `api.service.logServiceTime(...)`, and the save → budget check → post
order lives in that operation (`service.server.ts`). The test was split along that line:

- **Operation** (`logServiceTime(systemContext, input)`, called directly with a system
  `ServiceContext`): partial mocks (`importOriginal` + overrides) of `service.service`
  (`attemptServiceOrder`, `requireServiceVisitAccess`, `requireServiceOrderNode`),
  `shared.service` (`invokePosting` records "save" for `save-timesheet-entry`) and
  `projects.service` (`timesheetBudgetWarning`, `postTimesheetEntries`). Asserts the order
  `["save", "budget", "post"]` (the branch's assertion) and that the warning is returned.
- **Route**: `@carbon/api/carbon.server` mocked so `carbon()` returns
  `{ service: { logServiceTime } }`; asserts the flash `"Time logged. <warning>"` and the plain
  `"Time logged"` (the branch's two assertions), plus that the route forwards
  `serviceOrderId` / `projectId`.
- The old Lingui / glossary / `@carbon/auth` permission mocks were dropped: the vitest config
  now compiles macros, and nothing in the route reads permissions any more. `@carbon/auth` is
  a partial mock (only `success`), since the service graph needs its real exports.

## Results (env loaded: `source /tmp/port/env.sh`, stack `localhost:51853`)

| File | Result |
|---|---|
| `app/modules/projects/timesheet-posting-plan.test.ts` | 8 passed |
| `app/modules/projects/stock-transfer-plan.test.ts` | 3 passed |
| `app/modules/projects/project-cip.test.ts` | 4 passed |
| `app/modules/service/refurbishment-completion-plan.test.ts` | 8 passed |
| `app/modules/service/service-invoice-plan.test.ts` | 3 passed |
| `packages/api/src/stock-stripes.test.ts` | 5 passed |
| `test/database/post-timesheet/post-timesheet.test.ts` | 7 passed |
| `test/database/save-timesheet-entry/save-timesheet-entry.test.ts` | 14 passed |
| `test/database/submit-timesheet-week/submit-timesheet-week.test.ts` | 5 passed |
| `test/database/post-project-burden/post-project-burden.test.ts` | 5 passed |
| `test/database/post-project-expense/post-project-expense.test.ts` | 3 passed |
| `test/database/post-project-issue/post-project-issue.test.ts` | 5 passed |
| `test/database/post-project-stock-transfer/post-project-stock-transfer.test.ts` | 5 passed |
| `test/database/reclass-project-coverage/reclass-project-coverage.test.ts` | 1 passed |
| `test/database/complete-service-order/complete-service-order.test.ts` | 5 passed |
| `test/database/create-service-order-invoice/create-service-order-invoice.test.ts` | 1 passed |
| `test/database/lib/project-always-post.test.ts` | 4 passed |
| `test/database/lib/project-posting.test.ts` | 31 passed |
| `test/database/lib/service-orders.test.ts` | 4 passed |
| `app/routes/x+/service-order+/$id.charge.test.ts` (rewritten) | 4 passed |
| `app/modules/projects/move-action-pegs.test.ts` | 2 passed (no change needed) |
| `app/modules/projects/transfer-planning-actions.test.ts` | 4 passed (no change needed) |
| other `app/modules/projects/**` tests (`projects.{wbs,wbs-csv,mspdi}`, `ui/Element/{cost-cards,plan-rows}`, `ui/Milestones/schedule-scale`, `ui/Elements/graph/tree-{layout,viewport}`) | 73 passed (no change needed) |

No other `*.test.ts` exists under `modules/service`, `routes/x+/{project+,projects+,service-orders+,timesheet*}`.

Every live test ran against the database (none skipped; JSON reporter: 90 passed, 0 pending).

**Flake to know about:** run with file parallelism alongside the other test agents, 7 live
cases failed with Postgres `out of shared memory` (the lock table, not an assertion). Re-run
with `--no-file-parallelism`, all 90 pass. Run the live suite sequentially, or raise
`max_locks_per_transaction` on the local stack.

## Gates

- ERP `npx tsgo --noEmit`: 0 errors in the whole app (including `test/`) at the time of the run.
- `biome check --write`: clean on the app and `packages/api` files; the `test/database` files
  formatted through `--stdin-file-path`.
- SPDX fixer on all 19 new files: 19 correct AGPL.

## Requests

None. No port slip found: every ported assertion passed against the ported bodies without a
module change.
