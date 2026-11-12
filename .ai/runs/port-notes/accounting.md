# Port notes: accounting (plan Phase 4)

Agent `accounting`. Worktree `kelowna-port`. Nothing committed.

## Decision: one home for `lib/project-revenue.ts`

**Home: `apps/erp/app/modules/accounting/project-revenue.ts`** (a plain server-only file in
the module). `@carbon/ee` receives the shared writers as an argument.

Why not `@carbon/api/project-revenue`: the file runs raw `sql` from `kysely` (`SUM`, the
`get_contract_line_subtree(...)` set-returning function). `@carbon/api` has no `kysely`
dependency, and adding one needs `pnpm install`. Rewriting the queries to avoid `sql`
would change the code. Its two helpers (`lockContractPositions`,
`syncDraftRecognitionRuns`) already live in `shared.service.ts`, so the ERP is the
natural home.

How ee reaches it:

- `packages/ee/src/project-revenue/service.server.ts` declares the contract types
  (`RunProposalContext`, `RunRowSynthesizer`, `ProgressLine`, `ProgressMonth`,
  `UnrelievedCost`, `ProjectRevenueWriters`). It no longer imports `@carbon/server-functions`.
- `synthesizeCommercialProjectRevenue(writers)` and `projectRevenueSynthesizers(writers)`
  are now factories (they were a const synthesizer and a const array). The body is
  unchanged, and it still degrades with `projectRevenueEnabledForCompany`.
- The ERP file exports `projectRevenueWriters` (the 8 writers). The one call site,
  `runRowSynthesizers` in `accounting.service.ts`, passes the writers in, so TypeScript
  checks there that the two type declarations match.
- The type shapes are declared in both files, but the code exists once.

## Revenue run synthesizers (`revenueRunSynthesizers`)

- `runRowSynthesizers(type, extra = projectRevenueSynthesizers(projectRevenueWriters))`.
  The order is the branch's: `[...extra, synthesizeProjectRevenue, synthesizeContractRevenue]`.
  A lease run is `[synthesizeRentalAccruals]` only.
- `synthesizeContractRevenue`'s orphan query is limited to `type in (Deferral, Accrual)`
  (the branch did this).
- `proposeRevenueRecognitionRun`, `previewRevenueRecognitionRun` and
  `recalculateRevenueRecognitionRun` call `runRowSynthesizers(type)`, so every caller now
  gets the commercial synthesizer: routes, MCP/API, and the jobs proposal through the
  posting. The ERP service may import `@carbon/ee/project-revenue.server`. No caller or
  context field passes synthesizers any more.
- `getPeriodRunPreview` and `runPreviewer` lost their `revenueRunSynthesizers` argument.
- **Behaviour change (deliberate):** on the branch, MCP and the API previewed the close
  checklist without the Percent Complete rows (`[]`), because the old architecture could
  not reach ee code. That limit is gone, so a tool now does what the button does.

## Carry list lines carried

| Carry line | New home |
|---|---|
| A `accounting.server.ts` (`getCurrentFiscalYear`) | `getCurrentFiscalYear` → `accounting.service.ts` (a building block, not an operation). The three `indirect-rates*.tsx` routes import it from there. |
| A `accounting.server.ts` (`projectElement` dimension) | `RevenueRecognitionDimensionIds.projectElement`, `ccl.projectElementId` in the select and `ProjectElement` in the dimension map → `postRevenueRecognitionRun` (service). The operation `postRevenueRecognitionRun` (server) passes `projectElement: dimensionId("ProjectElement")`. |
| A `accounting.service.ts` hunk 1 (imports) | `getTimesheetCloseReadiness` import restored. `RunRowSynthesizer` is main's local type. |
| A `accounting.service.ts` hunk 2 (`getPeriodRunPreview`) | Kept main's `invokePosting(…, previewRevenueRecognitionRun)`. Synthesizers as above. |
| A `accounting.service.ts` hunk 3 (project CRUD deleted) | Deleted `deleteProject`, `getProject`, `getProjects` and `upsertProject` from the service, as the branch did. Also deleted main's 5 operations (`accounting.deleteProject/getProject/getProjects/createProject/updateProject`) from `accounting.server.ts`. No caller used them. Projects live in the projects module. |
| B `modules/accounting/period-runs.server.ts` | Now `routes/x+/accounting+/period-runs.server.ts` (main). The branch's only edit (pass `revenueRunSynthesizers`) is no longer needed, because the service includes them. No change. |
| B `activate-accounting/recost.ts` | `resetAndRecostInventory` / `postRecostJournals` (service): `poolKey`; opening layers split per stripe (`splitOpeningLayersByStripe`, project on-hand before cutover); `projectId` on cost rows and opening layers; Transfer/Borrow layers take `costOf` and book no journal; `paybackRecostRefusal` → `ServerFnError` 409; `postRecostJournals` returns `PostedRecost[]` (the offset line found by `journalLineReference`); new `recostProjectIssues` writes the projectLedger adjustment rows and CIP rows. |
| B `activate-accounting/legacy/runs.ts` | `contractLine.projectElementId` in `loadRecognitionRows` (service). |
| B `post-charge/build-charge-journal.ts` | `buildChargeJournal` and its types: `projectElementId`, `projectAccountId`, `sourceLineIndex`, `postingAccountOf`. |
| B `post-charge/post-charge-post.ts` | `postChargeJournal`: `resolveProjectLineCharges`, project account validation, the ProjectElement dimension, projectLedger rows (sign by type), CIP rows. |
| B `post-charge/post-charge-void.ts` | `voidCharge`: the branch's inline reversal in place of `insertNegatedJournal` (it needs the original → reversal line map). Journal sequence via `getNextSequenceInTransaction`, then `reverseProjectLedgerRows` and `reverseProjectCipRows`. |
| B `post-reimbursement/*` (build, post, void) | The same pattern in `buildReimbursementJournal`, `postReimbursementJournal` (also the `postingAccountOf` line check, the element dimension merge, `employeeId` on ledger rows) and `voidReimbursement`. `insertNegatedJournal` is no longer imported by accounting. |
| B `propose-/preview-/recalculate-revenue-recognition-run` | See "Revenue run synthesizers". |
| A `routes/x+/accounting+/periods.$periodId.close.tsx` | The loader is main's `getPeriodCloseChecklist` again. It and `closePeriodWithChecklist` now read `periodCloseEntitlements(client, companyId)` (new service helper, `companyHasFeature` GOVERNMENT_CONTRACTING) and pass it to the checks. `closeAccountingPeriod` / `loadPeriodCloseChecklist` keep `entitlements = {}` as the seam the tests use. `getPeriodCloseReadiness` reads it too. Route intents → operations in `accounting.server.ts`: `lock` → `lockPeriod` (now sends `indirect-rates` when an active project pool exists; logs a warning and never fails the lock); `compute-burden` → new `computePeriodBurden` (`{ create, update: accounting }`, ee `runIndirectRatePeriod`, `EntitlementError` → `entitlement`); `close-earned-value` → new `closePeriodEarnedValue` (`update: accounting`, ee `closeEarnedValuePeriod`). The toasts (Burden computed / Earned value closed, warnings as error) are in the row's `useAction`. The new operations are NOT `@mcp` (no new public tools). |
| A `routes/x+/accounting+/projects.tsx` | Restored to the branch's redirect to `path.to.projects`. |
| A `routes/x+/accounting+/reports.tsx` | Added `import { PinnedCard, PinToggle } from "~/components/ReportPin"` next to main's `reportPinValidator` import. |
| A `routes/x+/accounting+/revenue-recognition-runs.new.tsx` | No change. It calls `createPeriodRun`, and the service includes the synthesizers. |
| A `revenue-recognition-run+/$runId.post.tsx` | Covered by the operation (`projectElement` dimension). The route is main's. |
| A `revenue-recognition-run+/$runId.recalculate.tsx`, `$runId.repeat.tsx` | No change. They call operations, and the service includes the synthesizers. |
| A `routes/x+/settings+/accounting.tsx` | Loader: `getBurdenSettings` (`@carbon/ee/indirect-rates.server`) and its logger. Action: a `burdenSettings` variant in the form union → new operation `accounting.updateBurdenSettings` (`update: settings`, ee `updateBurdenSettings`, `EntitlementError` → "Upgrade to use indirect rates"; returns `{ success, message }` for the form's toast). `BurdenSettingsForm` is imported from its file. The trailing-zeros toast skips the burden result. |
| A `packages/jobs/.../revenue-recognition-proposal.ts` | No change. It is already main's `postingOrThrow("propose-revenue-recognition-run", …)`, and the ERP body adds the synthesizers. No new posting is needed. |
| `packages/ee/src/project-revenue/**` | `service.server.ts` rewired as above. `index.ts`, `pricing.ts` and `progress.ts` unchanged. |

## Not carried, and why

- Tests (Phase 8): `post-charge-transaction.test.ts`, `post-reimbursement-transaction.test.ts`,
  `activate-accounting/*` tests and fixture, `synthesizer-order.test.ts`, `right-to-invoice.test.ts`,
  `test/database/lib/project-revenue.ts`.
  - **The ee tests `percent-complete.test.ts` and `cutover-recost.test.ts`** import
    `@carbon/server-functions/*` and pass `projectRevenueSynthesizers` as an array. Under
    this design they need the ERP's `projectRevenueWriters`, which ee cannot import. Move
    them to `apps/erp/test/database/` and call `projectRevenueSynthesizers(projectRevenueWriters)`
    (or `runRowSynthesizers(type)`).
  - The jobs test mocks `projectRevenueSynthesizers: []`. It should now mock nothing.
- `routes/x+/accounting+/indirect-pools*.tsx` and `indirect-rates*.tsx` (branch-added) still
  call ee functions from route actions. Only their `getCurrentFiscalYear` import was fixed.
  Rewriting them as operations is Phase 6.

## Requests for other owners

- **invoicing / reimbursements owner:** `routes/x+/reimbursements+/$reimbursementId.edit.tsx`
  (carry A) needs the branch's `chargeNumbersError` check before posting, and
  `projectElementId` in `toClientLines`. The check belongs in the operation.
- **orchestrator:**
  - Run `pnpm run generate:mcp`. Five tools were removed (`accounting_createProject`,
    `accounting_deleteProject`, `accounting_getProject`, `accounting_getProjects`,
    `accounting_updateProject`), and `tool-manifest.digest.json` still lists them. Add
    the removal to the changelog.
  - `lockPeriod`'s description changed.
- **docs (Phase 9):** `accounting/AGENTS.md` "Project revenue" still says every run call
  site passes `revenueRunSynthesizers`, that `getPeriodRunPreview` is browser-bundled, and
  that the code lives in `@carbon/server-functions/lib/project-revenue`. The new truth:
  `runRowSynthesizers` builds the list itself from `projectRevenueSynthesizers(projectRevenueWriters)`,
  and the shared code is in `accounting/project-revenue.ts`. `.claude/rules/project-billing.md`
  / `commercial-licensing.md` (Project revenue bullet) say the same.

## Verification

- ERP `npx tsgo --noEmit`: no errors in `modules/accounting/**`, `routes/x+/accounting+/**`,
  `revenue-recognition-run+/**` or `settings+/accounting.tsx`. At the start there were 30
  errors in these files. The repo total went from 236 to 106 (other agents work in
  parallel).
- `packages/ee` tsgo: `project-revenue/service.server.ts` is clean. The only errors are in
  the two Phase 8 test files above.
- `packages/jobs` tsgo: no errors in the proposal.
- `vitest run accounting.utils.test.ts`: 119 passed. `accounting.periods.test.ts` cannot
  load, because `projects.server.ts` still imports `@carbon/server-functions` (Phase 6).
- `biome check --write` on every touched file: clean. License-header fixer on
  `project-revenue.ts`: correct AGPL.
- The conformance checks (`module-shape`, `service-fn-file`, `route-action-shape`) were
  not run. The `@carbon/checks` vitest needs `@carbon/config/dist`, which is not built
  in this worktree.
