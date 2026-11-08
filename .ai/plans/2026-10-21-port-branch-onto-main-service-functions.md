# Port `projects-wbs-research-spec` onto main's service-function architecture

Status: **in progress**. Author: Claude, 2026-10-21. Worktree `kelowna-port`, branch
`projects-port-main`. FREEZE = `50c4309a9c`, main = `0a1bd961b2`, MB = `23bd5d6e0b`.

Decisions (Brad, 2026-10-21: "go ahead - decide. this branch hasn't been applied to
production"):
- **D1:** re-date every branch migration after main's newest, keeping their order.
- **D2:** `project-posting`, `stock-stripes`, `project-revenue` (and their Kysely-only helpers)
  become `@carbon/database` subpaths; ERP-only helpers go to module `*.service.ts`.
- **D3:** frozen at `50c4309a9c`; later branch commits are cherry-picked at the end.
- **D4:** run with agents, fanned out by module.

## Why this is a port and not a merge

`git merge origin/main` into the branch gives 204 conflicted files, but the conflict count
understates the work. Main merged #1937 (`6984e529d8`, 2,716 files), which:

- deleted `packages/server-functions` (`serverFns`, `defineServerFn`, `invoke.ts`) and pasted
  every server function into the ERP modules as building blocks
  (`<module>.service.ts`, `fn(ctx: ServiceContext, raw)` + `fnInput` + `fnPermission`) behind
  `defineServiceFn` operations in `<module>.server.ts`;
- removed all 17 module barrels (`modules/<m>/index.ts`); imports name the defining file;
- moved route logic into operations: an action is `validator(v).request(args)` →
  `carbon(request).<module>.<op>(…)` → return or `respond(…).redirect(…)`;
- replaced `serverFns.system(...)` with `invokePosting` (ERP), `posting()` from
  `@carbon/api/postings.server` (jobs, ee) and a signed HTTP call `erpPosting` (MES, allowlist
  `MES_POSTINGS`);
- added checks that refuse the old shapes (`module-shape`, `service-fn-file`,
  `route-action-shape` with an 11-entry baseline, `no-server-code-in-client`,
  `function-redefinition-keeps-changes`).

The branch (556 commits since merge-base `23bd5d6e0b`, 1,277 files) is written against the old
shapes. In particular:

| Branch content | Size | Fate on main |
|---|---|---|
| 54 modified server-function files (post-receipt, issue, recost, post-customer-contract, post-shipment, post-purchase-invoice, post-production-event, post-charge, post-reimbursement, post-picking, …) | ~4k lines of behaviour | the files are deleted; the changes must be re-applied to the bodies' new homes |
| 79 new server-function files (12 new functions, 6 libs, 8 helpers, 44 tests) | ~30k lines | must become building blocks + operations + postings |
| `serverFns` callers | 93 ERP files, MES `projects.service.ts`, jobs (3), ee (2) | rewrite to `invokePosting` / `posting()` / `erpPosting` |
| Barrel imports | 135 files import a removed barrel; 126 use the branch's own `projects`/`service` barrels | rewrite to file imports; delete the two barrels |
| `projects.server.ts`, `service.server.ts` | plain async functions + 87 `@mcp` tags in `projects.service.ts` | must become `defineServiceFn` operations and join `router.server.ts` |
| Route actions in job+, contract+, planning, payments, settings | branch logic inside routes main reduced to one call | move the logic into operations |
| Migrations | 93 branch, 41 main; 3 SQL functions redefined on both sides | re-fork the redefinitions after main's (D1) |

A git merge alone would leave main's receipt, issue, shipment and invoice bodies without the
branch's project behaviour (stripes, project accounts, project ledger, CIP). Typecheck would not
catch that loss.

The detailed maps behind this plan (old file → new body, by line) are in the research notes of
the session that wrote it. Re-derive them with:
`git show origin/main:apps/erp/app/modules/<m>/<m>.service.ts` and
`git diff 23bd5d6e0b <branch-sha> -- packages/server-functions/src/<fn>`.

## Decisions needed before Phase 1

- **D1 — Migration dates.** Re-date every branch migration after main's newest
  (`20261020051356`), keeping their order. *Recommended* if the branch has never been applied to
  a shared or production database, because then nothing depends on the old timestamps.
  Otherwise re-fork only the clobbered functions in new migrations and apply the rest out of
  order with `--include-all`.
- **D2 — Home of the project posting libraries.** `lib/project-posting.ts` (1,986 lines),
  `lib/stock-stripes.ts`, `lib/project-revenue.ts` and `lib/project-journal.ts` are used by the
  ERP, `@carbon/ee` (indirect-rates, project-revenue) and the MES (`trackedEntityStripe`). `ee`
  and the MES cannot import `apps/erp`. *Recommended:* Kysely-only libraries go into
  `@carbon/database` subpaths (`@carbon/database/project-posting`, `/stock-stripes`,
  `/project-revenue`), next to `strict-backflush.ts` and `supersession-pick.ts`. ERP-only
  helpers go into module `*.service.ts` files. The alternative is
  `shared.service.ts` plus a posting for every ee call.
- **D3 — Freeze.** A second session is committing to this branch now (project contracts,
  02:55–03:17). The port runs in its own worktree from a frozen branch SHA. Branch commits made
  after the freeze are cherry-picked onto the port at the end. The other session stops
  committing to the branch while Phase 1 runs.
- **D4 — Scale.** The phases below fan out by module. This is roughly 8–10 agents across
  phases, plus review. It needs your go-ahead to run as a workflow.

## Phases

Each phase ends with a commit on the port branch. Phase 1 commits the merge itself, with no
conflict markers but not typechecking. Every later phase moves the build closer to green. Never
regenerate the conformance baseline to bless new violations.

### Phase 0 — Set up
- [x] Freeze the branch at a SHA (`FREEZE`) and record it here.
- [x] `git worktree add ../kelowna-port -b projects-port-main $FREEZE`; set
      `AGENT_BROWSER_SESSION` per worktree; `crbn up` in the port worktree only.
- [ ] Run `pnpm --filter @carbon/checks clobbers` on the frozen branch to confirm the three
      clobbered functions: `backflush_job_materials`, `complete_job_to_inventory`,
      `dispatch_event_batch`.

### Phase 1 — Merge commit: resolve every marker, keep both histories
Rules, applied per conflict type:
- [ ] **packages/server-functions (UD, 44 + 79 branch-only files):** accept main's
      deletion. The branch versions stay readable at `$FREEZE`; Phases 3–5 port from there.
- [ ] **file-location conflicts (38 AU files):** rename detection guessed wrong for the source
      files (`lib/project-posting.ts` and others landed under `apps/erp/test/database/lib/`).
      Delete these. Phases 3–6 re-create them in their real homes. Keep only the `*.test.ts`
      and `*-fixture.ts` files where they landed, for Phase 8.
- [ ] **Module `*.server.ts` / `*.service.ts` and the routes main rewrote:** take main's side.
      Record each branch hunk that was dropped in `.ai/runs/<date>-port-carry-list.md`, as file,
      hunk summary and destination. This carry list drives Phases 4 and 6. Nothing is dropped
      without a carry-list line.
- [ ] **Import-only and list-union conflicts** (contract+ details, `path.ts`, `Form/index.ts`,
      `react/index.tsx`, `ee/package.json`, glossary, lessons, docs and rules): keep both sides.
      Take main's import style.
- [ ] **Deleted on the branch, modified on main** (`accounting+/projects*.tsx`, jira/linear
      `issue.sync-notes`): delete them, and apply main's import style to the branch's moved copies.
- [ ] **Deleted on main, modified on the branch** (`period-runs.server.ts`,
      `quality-disposition.server.ts`, `production.mcp.server.ts`, `registry.server.ts`,
      `mcp-exposure.ts`, `service-metadata.ts`, three tests): delete them and add each edit to
      the carry list. Examples: `runMRP` with `planningGroupMrpDeps`, and `revenueRunSynthesizers`
      in main's `routes/x+/accounting+/period-runs.server.ts`.
- [ ] **`packages/planning/src/mrp/mrp.ts`:** take the branch's side (the body moved to
      `plan-company.ts`), then apply main's `bomChildren()` (#1968) at `plan-company.ts:~413`.
- [ ] **Generated files** (`types.ts`, `swagger-docs-schema.ts`, `tool-manifest.digest.json`,
      `jobs/manifests/schema.json`, `posting-permissions.test.ts.snap`): take main's side.
      Phase 9 regenerates them.
- [ ] `git grep -n '^<<<<<<<\|^>>>>>>>'` is empty; commit the merge. The commit message names
      the carry list.

### Phase 2 — Migrations (per D1)
- [ ] Re-date the branch migrations (D1), or keep them and use `--include-all`.
- [ ] New migration `…_merge-main-strict-backflush-and-projects.sql`, dated after
      `20261020051356`. Re-fork `backflush_job_materials` from main's `20261015163040` (strict
      backflush: `requireBackflushStorageUnit`, `preventNegativeBackflush`) and add the branch's
      consume-to-project, stripes, stamped-layer children and grouped completion from
      `20261021010900`. Re-fork `complete_job_to_inventory` from main's `20261015161847`
      (production-event lock, serial units issued before receipt) and add the branch's
      project, CIP, grouped and project-stock changes. Follow the header pattern of
      `20261021010900`.
- [ ] Regenerate the `dispatch_event_batch` authz file with the authz generator. Don't hand-merge it.
- [ ] `pnpm db:migrate` on the port stack, then `pnpm generate:types`.
- [ ] Gates: `pnpm --filter @carbon/checks clobbers` passes, and
      `function-redefinition-keeps-changes` passes with no new baseline entries.

### Phase 3 — Shared project libraries (per D2)
Dependency order: `project-posting` + `stock-stripes` → `project-cip`, `project-journal`,
`service-orders` → `project-revenue`, together with the `propose-revenue-recognition-run` change.
- [ ] Move each library to its D2 home, re-pointing its imports from the old `lib/*` to main's
      equivalents. Most are in `shared.service.ts`: `bookAdjustment`/`valueMovement` (:15274+),
      `resolveAccountingPeriod`, `journal-line-ids`, `calculateCOGS`, storage units.
- [ ] Re-apply the branch's changes to main's copies of the shared libraries:
      `calculateCOGS` gains a `projectId` filter; `post-adjustment` and `plan-adjustment` carry
      the `projectId` stripe plus the Project Issue and Project Transfer document types;
      `storage-units` changes to an object signature returning `{storageUnitId, projectId}`.
      Update every main caller of `getStorageUnitId` and
      `getStorageUnitWithHighestQuantity`.
- [ ] Gate: `pnpm exec turbo run typecheck --filter=@carbon/database` and the libraries' pure tests.

### Phase 4 — Re-apply the branch's changes to main's existing bodies (carry list)
One agent per module. Each reads `git diff 23bd5d6e0b $FREEZE -- packages/server-functions/src/<fn>`
and applies it to the body's new home.
- [ ] **inventory.service.ts:** `postReceipt` (+654: project routes, project stock, grouped
      receipts/pegs, consume-at-receipt, CIP, void reversal, Depot Repair, plus the
      `posting-lines`, `grouped-receipt`, `project-routes`, `repair` and `void-cost-ledger`
      changes), `issueMaterial` (+619: stripes, consume-to-project), `postShipment` (+284:
      common-stock draws, customer assets, repair ship-back), `postPicking`,
      `postInventoryAdjustment`, `postStockMovementCorrection`, `postInventoryCount`,
      `postStockTransfer`.
- [ ] **invoicing.service.ts:** `postPurchaseInvoice` and `buildPurchaseInvoicePostingLines`
      (+383: project debits, receipt-charged variance, member-stripe Material Variance,
      `project-charges.ts`), `postSalesInvoice` (+56: service invoice lines, billable items on void).
- [ ] **accounting.service.ts:** `resetAndRecostInventory` and recost (+384: per-stripe pools,
      transfer/borrow recost, payback refusal, projectLedger and CIP adjustments),
      `postCharge`/`voidCharge` and `postReimbursement` (+~480: project account, ledger and CIP rows),
      `proposeRevenueRecognitionRun` (synthesizers), the `postRevenueRecognitionRun` dimension,
      legacy runs.
- [ ] **production.service.ts:** `postProductionEvent` (+159: consume-to-project), `getMethod`
      (+37: job stripes), `runMRP` with `planningGroupMrpDeps` as a `defineServiceFn` in
      `production.server.ts` (main's service files cannot import `.server`).
- [ ] **sales.service.ts:** `postCustomerContract` (+323: billing-line validation, T&M backfill),
      the schedule-writes columns, `createContractInvoices` and the `insert-invoice` split.
- [ ] **shared / quality / settings / others:** `createDocument` (RMA repair lines),
      `convertDocument` (charge numbers), `importCsv` (`payrollPeriodTotal`), `seedCompany`
      (projectState rows), `postNonconformance` (stripes), `company-records` tables,
      `post-payment` deposit rule, and `trackedEntityStripe` in quality disposition.
- [ ] Gate per module: scoped typecheck, and a re-read of the carry-list lines for that module,
      each ticked.

### Phase 5 — The 12 new server functions
Each becomes a building block (`fn(ctx, raw)`, `fnInput`, `fnPermission` with the branch's
permission, unchanged) plus a `defineServiceFn` operation, and a posting when jobs, ee or the
MES call it.
- [ ] **projects:** `postTimesheet` (+plan), `saveTimesheetEntry`, `submitTimesheetWeek`,
      `postProjectIssue` (+service part), `postProjectExpense`, `postProjectStockTransfer`
      (+plan), `reclassProjectCoverage`, `postProjectBurden` (permission `"system"`, posting only).
- [ ] **service:** `completeServiceOrder` (+load, plan), `createServiceOrderInvoice` (+plan).
- [ ] **sales:** `createProjectBillingInvoices` (+clin), `generateContractBillableItems`.
- [ ] Postings: add `post-project-burden`, `create-project-billing-invoices`,
      `save-timesheet-entry`, `submit-timesheet-week` and `post-timesheet` to `PostingContract`
      and to `apps/erp/app/modules/postings.server.ts`. Add the three timesheet postings to
      `MES_POSTINGS`. Carry `revenueRunSynthesizers` through the run postings, following how
      main wires context today.
- [ ] Gate: `pnpm exec turbo run typecheck --filter=erp --filter=@carbon/api`.

### Phase 6 — Projects and service modules in main's shape; routes
- [ ] Split `projects.server.ts` and `service.server.ts`: operations stay in `.server.ts` as
      `defineServiceFn`; helpers, `ServiceOrderError` and building blocks go to `.service.ts`.
      Move the 87 `@mcp` TSDoc tags onto the operations, and add `projects` and `service` to
      `router.server.ts`.
- [ ] Delete the branch's `projects/index.ts` and `service/index.ts`. Codemod every
      `~/modules/<m>` import (both the removed barrels and these two) to the defining file.
- [ ] Rewrite branch-added and branch-changed route actions to main's shape. Branch logic
      inside route actions moves into the operations: company-record checks, charge-number
      validation, budget checks and make-to-asset checks in job+; the `projectRevenueRefusal`
      gate in contract+; planning; payments; settings. Work from the carry list.
- [ ] Jira/Linear issue routes: combine main's `carbon()` move with the branch's `issue-sync`.
- [ ] Gates: `module-shape`, `service-fn-file`, `route-action-shape` and
      `no-server-code-in-client` pass with no new baseline entries; ERP typecheck is green.

### Phase 7 — Jobs, ee, MES
- [ ] jobs: in `recurring-billing.ts`, `revenue-recognition-proposal.ts` and `indirect-rates.ts`,
      switch to `posting()` / `postingOrThrow()`. Remove `@carbon/server-functions` from
      `package.json`. Rewrite `packages/jobs/AGENTS.md` line 80.
- [ ] ee: indirect-rates calls `posting("post-project-burden")`. project-revenue imports the D2
      libraries and types. Remove the package dependency.
- [ ] MES: `projects.service.ts` switches to `erpPosting(...)`; `inventory.service.ts` gets
      `trackedEntityStripe` from its D2 home. Remove the package dependency.
- [ ] Gate: `pnpm exec turbo run typecheck --filter=mes --filter=@carbon/jobs --filter=@carbon/ee`.

### Phase 8 — Tests
- [ ] Move the branch's 44 tests: pure tests go to `apps/erp/app/modules/<m>/<m>.<topic>.test.ts`;
      live-DB tests go to `apps/erp/test/database/<area>/`. Port the fixtures
      (`project-posting-test-fixture`, `project-billing-test-fixture`, `sales-return-test-fixture`,
      the activation project helper) onto `fixtures/local-database.ts`, `always-post.ts` and
      `handles.ts`. Calls become `invokePosting(handlesOf(f.ctx), name, input, body)`.
- [ ] ee tests (indirect-rates, project-revenue) use the new fixtures through a test-only path.
- [ ] Gates: `pnpm --filter erp test` with the DB tests against the port stack; `pnpm --filter @carbon/ee test`.

### Phase 9 — Generated files, data, docs
- [ ] `pnpm generate:types`, `pnpm generate:swagger`, `pnpm generate:mcp`. Diff the published
      tool names against main and the branch, and explain every addition and removal (main's
      lessons require this). Also `pnpm check:manifest`.
- [ ] Run `pnpm --filter erp exec vitest run test/posting-permissions.test.ts -u`, then review the
      snapshot: every branch permission must be unchanged.
- [ ] `pnpm db:check:backups -- --stage`, starting from main's `schema.json`.
- [ ] `pnpm db:check:datasets`. `preventNegativeBackflush` defaults to `true` and only acts with
      strict backflush on. Confirm that no tier backflushes below zero under strict mode.
- [ ] `pnpm lingui:extract`, then `/translate`.
- [ ] Refresh the rules and AGENTS.md files that name `@carbon/server-functions`, `serverFns` or
      the old paths: `projects-system`, `project-billing`, `field-service`,
      `government-contracting`, `inventory-system`, `supersession-system`, and the
      server-functions content now in `packages/api/AGENTS.md`.

### Phase 10 — Verification
- [ ] Full gates: typecheck for every package (scoped), Biome, `pnpm run test`, the checks suite
      (`pnpm --filter @carbon/checks exec vitest run src/run.test.ts`) and `pnpm run build`.
- [ ] `/smoke-test`, then `/test` for: a project issue, a timesheet post from the ERP and from
      the MES, a project receipt into project stock, a T&M invoice run, a service order
      completion and invoice, and the revenue run with Percent Complete.
- [ ] Cherry-pick the branch commits made after `FREEZE`. Repeat the gates.
- [ ] `/self-review` on the port branch, then open a PR into main.

### After the port — the original request
- [ ] `postProjectIssue`: allow on-hand below zero unless `getStrictBackflushSettings(db,
      companyId, locationId)` returns both `strict` and `preventNegative`. Always refuse a unit
      with no cost. Name the item and the on-hand amount in the refusal.

## Risks
- **Silent loss of the branch's posting behaviour** when a branch hunk is not carried into
  main's body. Mitigation: the carry list (Phase 1) and a per-module tick-off (Phase 4). The
  live-DB tests (Phase 8) are the real proof.
- **Out-of-order migrations** in an environment that already applied branch migrations (D1).
- **Permission drift** while restating 12 functions. The posting-permissions snapshot pins it.
- **Ongoing work on the branch during the port.** D3 freeze plus cherry-picks.
