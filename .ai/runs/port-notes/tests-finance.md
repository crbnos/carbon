# Port notes: tests-finance (plan Phase 8)

Agent `tests-finance`. Worktree `kelowna-port`. Nothing committed. **No module code changed.**
Every test ran against this worktree's stack (`source /tmp/port/env.sh`); none skipped.

## New files (branch FREEZE `50c4309a9c`, `packages/server-functions/src/…` → new home)

| Branch | New home | Result |
|---|---|---|
| `activate-accounting/fixed-asset-cip.test.ts` | `apps/erp/test/database/activate-accounting/fixed-asset-cip.test.ts` | 1/1 pass |
| `activate-accounting/project-recost.test.ts` | `apps/erp/test/database/activate-accounting/project-recost.test.ts` | 1/1 pass |
| `activate-accounting/project-stripes.test.ts` | `apps/erp/test/database/activate-accounting/project-stripes.test.ts` | 3/3 pass |
| `activate-accounting/project-wip.test.ts` | `apps/erp/test/database/activate-accounting/project-wip.test.ts` | 1/1 pass |
| `lib/right-to-invoice.test.ts` | `apps/erp/test/database/lib/right-to-invoice.test.ts` | 6/6 pass |
| `propose-revenue-recognition-run/synthesizer-order.test.ts` | `apps/erp/test/database/propose-revenue-recognition-run/synthesizer-order.test.ts` | 3/3 pass |
| `create-project-billing-invoices/clin.test.ts` (pure) | `apps/erp/app/modules/sales/contract-clin.test.ts` (next to `contract-clin.ts`) | 4/4 pass |
| `create-project-billing-invoices/create-project-billing-invoices.test.ts` | `apps/erp/test/database/create-project-billing-invoices/create-project-billing-invoices.test.ts` | 4/4 pass |
| `generate-contract-billable-items/generate-contract-billable-items.test.ts` | `apps/erp/test/database/generate-contract-billable-items/generate-contract-billable-items.test.ts` | 2/2 pass |

Plumbing only (fixtures.md): `postX(f.ctx, input)` → `invokePosting(handlesOf(f.ctx), "<kebab>", input, postX)`
with the bodies from `accounting.service` (`activateAccounting`, `postAssetTransfer`,
`proposeRevenueRecognitionRun`, `paybackRecostRefusal`), `projects.service` (`postProjectIssue`),
`sales.service` (`createProjectBillingInvoices`, `generateContractBillableItems`); `buildCostLedgerRow` /
`buildItemLedgerRow` from `shared.service`; `reverseProjectLedgerRows` from
`~/modules/projects/project-posting`; `dropRecognitionRuns` from `fixtures/run`. Every assertion is the
branch's, unchanged.

### `synthesizer-order.test.ts`: the one adapted test

The branch passed a fake synthesizer through `ServerFnContext.system({ revenueRunSynthesizers: [fake] })`.
Main has no such context field: `runRowSynthesizers(type)` always defaults `extra` to
`projectRevenueSynthesizers(projectRevenueWriters)` (accounting.md). The test now `vi.mock`s
`@carbon/ee/project-revenue.server`'s `projectRevenueSynthesizers` (the rest of the module is the real
one) to return the list the test controls. So:

- Test 1: `runRowSynthesizers("Revenue Recognition", [extra])` is unchanged. The branch's second
  assertion (`runRowSynthesizers("Revenue Recognition")` → no extras) now asserts main's default: the
  commercial list comes first, built from `projectRevenueWriters`.
- Test 2 (Lease): unchanged, plus a Lease run with no list given ignores the commercial list.
- Test 3 (DB): the fake runs as the commercial synthesizer; the same assertions (called once with the
  company and period, inside the transaction, claimed by the run, `lineCount` 1).

## Modified by the branch (main's copy)

| File | What I did | Result |
|---|---|---|
| `apps/erp/test/database/activate-accounting/reads.test.ts` | Already carried by the merge (`FEATURE_ACCOUNT_DEFAULTS`, `groupId`, the readiness test). No change. | 13/13 pass |
| `apps/erp/test/database/post-charge/post-charge-transaction.test.ts` | The merge carried the branch's test body but lost its import: added `projectPostingFixture` from `../fixtures/project-posting`. Body checked identical to the branch's. | 14/14 pass (see flake below) |
| `apps/erp/test/database/post-reimbursement/post-reimbursement-transaction.test.ts` | Same: added the `projectPostingFixture` import. Body identical. | 15/15 pass |
| `apps/erp/test/database/post-customer-contract/contract-lifecycle.test.ts` | Fixed the typecheck errors: `../lib/project-posting` → `../../../app/modules/projects/project-posting`; the branch's 3 `postCustomerContract(ctx, …)` calls → `invokePosting(handlesOf(ctx), "post-customer-contract", …, postCustomerContract)`, as main's own tests in the file. | 18/18 pass |

## ee tests → `apps/erp/test/database/ee/<feature>/`

All five are live-database tests, so all five moved (none was pure). The originals in `packages/ee/src`
are **deleted**.

| Was (`packages/ee/src/…`) | Now (`apps/erp/test/database/ee/…`) | Result |
|---|---|---|
| `indirect-rates/compute-indirect-rates.test.ts` | `indirect-rates/compute-indirect-rates.ee.test.ts` | 1/1 pass |
| `indirect-rates/compute-project-burden.test.ts` | `indirect-rates/compute-project-burden.ee.test.ts` | 3/3 pass |
| `indirect-rates/ice.server.test.ts` | `indirect-rates/ice.server.ee.test.ts` | 1/1 pass |
| `project-revenue/cutover-recost.test.ts` | `project-revenue/cutover-recost.ee.test.ts` | 1/1 pass |
| `project-revenue/percent-complete.test.ts` | `project-revenue/percent-complete.ee.test.ts` | 7/7 pass |

- **License:** I named them `.ee.test.ts` so they keep their `LicenseRef-Carbon-Commercial` header.
  Without `.ee.`, moving them out of `packages/ee` would relicense commercial test code as AGPL.
  Main has a precedent (`apps/erp/test/machine-time-*.ee.test.ts`). The fixer agrees: 5 commercial
  correct, 9 AGPL correct.
- Imports: `./service.server` / `./ice.server` / `./models` → `@carbon/ee/indirect-rates.server`,
  `@carbon/ee/indirect-rates`, `@carbon/ee/project-revenue.server`. `vi.mock("../plan.server")` →
  `vi.mock("@carbon/ee/plan.server")` (the same file, so the ee code sees the mock). The
  `@carbon/auth/client.server` mock is unchanged.
- `compute-project-burden`: `computeProjectBurden` now posts through `posting("post-project-burden", …)`
  (`@carbon/api/postings.server`), which throws until the app calls `registerPostings`. The test calls
  `registerPostings(postings)` with the ERP's `postings` (`app/modules/postings.server`), as
  `carbon.server.ts` does at start.
- **Percent Complete gate (the fixtures note asked to verify):** the test already stubs
  `companyHasFeature` (`plan.hasProjectRevenue`). With the commercial synthesizer now always in the run,
  the stub is all that is needed: I removed the `revenueRunSynthesizers: projectRevenueSynthesizers`
  fixture option (and its import). All 7 pass, including "degrade without PROJECT_REVENUE"
  (`hasProjectRevenue = false`) and the Percent Complete rows (`true`), so the stub controls both ways.
  No extra mock of `projectRevenueEnabledForCompany` is needed. A community test that proposes a run
  without any stub gets `companyHasFeature` → false (Community edition under vitest), so the commercial
  synthesizer writes nothing there. `right-to-invoice.test.ts` passes on that basis.

## Verification

- Final combined run (18 files): **98 passed, 0 failed, 0 skipped**.
- One earlier combined run had **1 failure, not reproducible**: `post-charge-transaction.test.ts` >
  "a failure after journal creation rolls the entire post back" hit `deadlock detected` in its
  `finally` (`DROP TRIGGER … ON public."charge"`) while other files ran in parallel on the same
  database. That is main's own test (not a branch addition): DDL on `charge` competes with concurrent
  writers. It passed alone twice and in the final combined run. It is a concurrency flake, not a port slip.
- ERP `npx tsgo --noEmit`: exit 0, **0 errors** (whole app, test dir included).
- `packages/ee` `tsgo --noEmit`: exit 0, 0 errors (it failed before only in the five moved tests).
- Biome ignores `apps/erp/test/**`. I formatted every file I touched through
  `biome check --write --stdin-file-path=apps/erp/app/x.test.ts` (import order and my rewritten call
  indentation only).

## Requests

- **Phase 9 / docs:** `packages/ee` no longer has the five database tests. If an ee `AGENTS.md`, rule or
  the commercial-licensing rule lists where the project-revenue / indirect-rates tests live, point it at
  `apps/erp/test/database/ee/`. Only historical `.ai/plans/*` name the old paths (not changed).
- **jobs owner (from accounting.md, not mine):** the jobs test that mocks `projectRevenueSynthesizers: []`
  should mock nothing now.
