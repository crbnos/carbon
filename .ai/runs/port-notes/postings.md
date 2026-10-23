# Port notes: postings (plan Phase 5)

Agent `postings`. Worktree `kelowna-port`. Nothing committed. No `pnpm install` run.

## Method

Each branch `index.ts` (FREEZE `50c4309a9c`) was transformed by a script, not retyped:

- The `defineServerFn({ name, input, permissions, async run(ctx, x) { … } })` wrapper became
  `export const <name>Permission = <the branch's permissions, unchanged> satisfies
  PermissionRule<…>` plus `export async function <name>(ctx: ServiceContext, raw:
  z.input<typeof <name>Input>)`. The first line parses the input, binding it exactly as the
  branch's `run` parameter did (`input` or the same destructuring).
- `const { db, companyId, userId } = ctx` (or the destructured first parameter) became
  `ctx.asSystem.pg`, `ctx.company.id` and `ctx.auditUserId`. No body used `ctx` in any other way.
- `export default`, the `defineServerFn` import and the re-exports were removed. Imports were
  re-pointed (below) and merged into the module file's import block. Then `biome check --write`.
- Check: every non-import line of every branch `index.ts`, whitespace-normalized, is present in
  its new home. Only the wrapper lines, the imports and the `complete-service-order` re-exports
  are missing.

## Functions → new homes

| Branch (`packages/server-functions/src/…`) | New home | Permission (unchanged) |
|---|---|---|
| `post-timesheet/index.ts` | `projects.service.ts` `postTimesheet` | `{ update: "projects" }` |
| `post-timesheet/plan.ts` | `apps/erp/app/modules/projects/timesheet-posting-plan.ts` (plain file) | — |
| `save-timesheet-entry/index.ts` | `projects.service.ts` `saveTimesheetEntry` (+ `save`, `addEntry`, `saveStandard`, … helpers, unexported as before) | `{ update: "projects" }` |
| `submit-timesheet-week/index.ts` | `projects.service.ts` `submitTimesheetWeek` | `{ update: "projects" }` |
| `post-project-issue/index.ts` | `projects.service.ts` `postProjectIssue` | `{ update: "inventory" }` |
| `post-project-issue/service.ts` | `apps/erp/app/modules/projects/service-part-issue.ts` | — |
| `post-project-expense/index.ts` | `projects.service.ts` `postProjectExpense` | `{ update: "projects" }` |
| `post-project-stock-transfer/index.ts` | `projects.service.ts` `postProjectStockTransfer` | `{ update: "projects" }` |
| `post-project-stock-transfer/plan.ts` | `apps/erp/app/modules/projects/stock-transfer-plan.ts` | — |
| `reclass-project-coverage/index.ts` | `projects.service.ts` `reclassProjectCoverage` | `{ update: "projects" }` |
| `post-project-burden/index.ts` | `projects.service.ts` `postProjectBurden` (+ `postAppliedBurdenJournal`, `ACCOUNTING_PERIOD_CLOSED`) | `"system"` |
| `complete-service-order/index.ts` | `service.service.ts` `completeServiceOrder` | `{ update: "service" }` |
| `complete-service-order/load.ts` | `apps/erp/app/modules/service/refurbishment-completion-load.ts` | — |
| `complete-service-order/plan.ts` | `apps/erp/app/modules/service/refurbishment-completion-plan.ts` | — |
| `create-service-order-invoice/index.ts` | `service.service.ts` `createServiceOrderInvoice` | `{ update: "service", create: "invoicing" }` |
| `create-service-order-invoice/plan.ts` | `apps/erp/app/modules/service/service-invoice-plan.ts` | — |

Details:

- **Timesheet schemas and results are in `@carbon/api/postings`** (`packages/api/src/postings.ts`):
  `saveTimesheetEntryInput`, `SaveTimesheetEntryResult`, `submitTimesheetWeekInput`,
  `SubmitTimesheetWeekResult`, `postTimesheetInput`, `PostTimesheetResult`. This follows main's
  pattern for MES postings (`issueInput` lives there too, and `issueMaterial` imports it): MES
  types its calls from them. `projects.service.ts` imports them. The text is the branch's.
- `PostProjectBurdenResult` is in `@carbon/api/postings.server` (next to
  `ContractInvoiceGenerationResult`). `projects.service.ts` imports it.
- `postProjectBurdenPermission` is annotated (`: PermissionRule<…> = "system"`) and does not
  use `satisfies`. With `satisfies`, the literal widened to `string` in `postingPermissions`,
  and `invokePosting`'s `as` refused it. The value is `"system"`, as on the branch.
- `TimesheetRefusal` was declared in both `save-timesheet-entry` and `submit-timesheet-week`
  (the same class). It is declared once now.
- Import re-points: `../errors` → `@carbon/api/errors`; `../company-records`,
  `../lib/{get-accounting-period,get-posting-group,journal-line-ids,post-adjustment,plan-adjustment,calculate-cogs}`
  → `~/modules/shared/shared.service` (same signatures, checked); `../lib/project-{posting,cip,journal}`
  → `./project-*`; `../lib/stock-stripes` → `@carbon/api/stock-stripes`; `../lib/cost-layer-order`
  (`orderLayersForConsumption`) → `@carbon/database/cost-relief`; `weekStartOf` from
  `./projects.models`, which `projects.service.ts` already imported (the same code as
  `@carbon/utils`'s).
- `projects.service.ts` and `service.service.ts`: `import type { z }` became a value import
  (the input schemas need `z`).
- I did NOT add `defineServiceFn` operations for these. `projects` and `service` are not in
  `router.server.ts` yet, and the brief gives the operations to the next agent (Phase 6).

## Postings registry

- `packages/api/src/postings.server.ts` `PostingContract`: added `create-project-billing-invoices`
  (`{ asOf: string; customerContractId?: string }` → `ContractInvoiceGenerationResult`),
  `post-project-burden` (the input spelled out from `postProjectBurdenInput`; →
  `PostProjectBurdenResult`), `save-timesheet-entry`, `submit-timesheet-week`, `post-timesheet`
  (`z.input` of the `@carbon/api/postings` schemas → their result types).
- `packages/api/src/postings.ts` `MES_POSTINGS`: `"save-timesheet-entry": null`,
  `"submit-timesheet-week": null`, `"post-timesheet": null`. These inputs have no `type`.
- `apps/erp/app/modules/postings.server.ts`:
  - `postingPermissions` adds `create-project-billing-invoices` →
    `sales.createProjectBillingInvoicesPermission`, `post-project-burden` →
    `projects.postProjectBurdenPermission`, and `save-timesheet-entry` / `submit-timesheet-week` /
    `post-timesheet` → `projects.*Permission`.
  - `postings` adds the five entries, with the same shape as `create-contract-invoices` / `issue`
    (`as` + `schema`: `sales.createProjectBillingInvoicesInput`, `projects.postProjectBurdenInput`,
    and the three `@carbon/api/postings` schemas).
  - New namespace import `* as projects from "./projects/projects.service"`.

## Callers changed

| File | Change |
|---|---|
| `apps/erp/app/modules/projects/projects.server.ts` | The 6 `serverFns.system(…).invoke(…)` calls (`postTimesheetEntries`, `saveTimesheetEntry`, `submitTimesheetWeek`, `postProjectIssue`, `addProjectExpense`, `postProjectStockTransfer`) → `invokePosting({ db, companyId, userId }, name, input, service.<fn>)`. `import * as service from "./projects.service"` (the operation names are the same as the building blocks). Result types from `@carbon/api/postings`. Nothing else changed. |
| `apps/erp/app/modules/service/service.server.ts` | 4 calls (`complete-service-order`, `post-project-expense` ×2, `reclass-project-coverage`) → `invokePosting`. `loadRefurbishmentCompletion` / `planRefurbishmentCompletion` / `RefurbishmentCompletionError` / `RefurbishmentCompletionPlan` come from the two plain files. `insertServiceOrder` comes from `./service-orders` (the foundation agent asked for this). `ServiceOrderError` was not moved. |
| `apps/erp/app/routes/x+/service-order+/$id.invoice.tsx` | `invokePosting(…, "create-service-order-invoice", …, createServiceOrderInvoice)`. The rest of the action did not change. |
| `apps/mes/app/services/projects.service.ts` | `saveTimesheetEntry`, `submitTimesheetWeek`, `postTimesheetEntries` → `erpPosting(name, { companyId, userId }, input)`. There is no client, so the posting runs as the system, as the branch's `serverFns.system` did. The unused `db` parameter was dropped (and with it the `Kysely` imports). |
| `apps/mes/app/routes/x+/timesheet.tsx` | The 3 call sites no longer pass `db`. The `const db = getDatabaseClient()` that only fed them was removed. |
| `packages/ee/src/indirect-rates/service.server.ts` | `posting("post-project-burden", { db, companyId, userId }, …)` from `@carbon/api/postings.server`, per batch of `BURDEN_ROWS_PER_CALL`, the same as before. |
| `packages/jobs/.../recurring-billing.ts` | No change. The sales agent already wrote `postingOrThrow("create-project-billing-invoices", …)`. It typechecks now that the posting is registered. |

`git grep "@carbon/server-functions\|serverFns" -- apps packages`: the only remaining matches are
Phase 8 tests (`projects/move-action-pegs.test.ts`, `transfer-planning-actions.test.ts`, 5 ee
tests), the AGENTS.md files and main's own comments in `service-tools.server.ts`.

**package.json:** no `package.json` in the worktree lists `@carbon/server-functions`, and
`pnpm-lock.yaml` has no entry for it. Nothing to remove, and no `pnpm install` is needed for
this phase.

## Verification

- ERP `npx tsgo --noEmit`: 0 errors in every file I touched or created. 95 lines remain, all in
  other owners' files (`PlaceInServiceModal.tsx`, the project/service-order routes with
  `timezone.server`, `test/database/*`, `release-jobs.test.ts`).
- `pnpm exec turbo run typecheck --filter=@carbon/api --filter=@carbon/jobs --filter=@carbon/ee --filter=mes`:
  api, jobs and mes pass. ee fails only in the Phase 8 tests (`indirect-rates/*.test.ts`,
  `project-revenue/{cutover-recost,percent-complete}.test.ts`, which import
  `@carbon/server-functions/*`). `service.server.ts` is clean.
- `biome check --write` on all 17 files: clean.
- License-header fixer on the 6 new files: 6 correct AGPL.
- Conformance scanners (`no-raw-rounding`, `no-inline-fraction-digits`,
  `no-interpolated-error-log`, `no-local-timezone`, `no-unscoped-kysely-write`,
  `no-db-client-in-service`, `route-action-shape`, `no-server-code-in-client`,
  `no-unrounded-tracked-quantity`, `spdx-license-header`). I ran them on my files with a
  throwaway tsx runner (deleted afterwards). Findings:
  - `route-action-shape`: `x+/service-order+/$id.invoice.tsx:32` (the `invokePosting` write in
    the route). See the Phase 6 requests below.
  - `service-fn-file`: `projects.server.ts` / `service.server.ts` are not yet in main's shape.
    This was already true, and it is Phase 6.

## Open issues and requests

- **Phase 6 (projects/service agent):**
  - Add the operations (`run(ctx, "<name>", () => service.<fn>(ctx, input))`). Then
    `$id.invoice.tsx` should call `carbon(request).service.createServiceOrderInvoice`, and the
    `route-action-shape` finding goes away. Its permission is
    `service.createServiceOrderInvoicePermission`.
  - The `projects.server.ts` wrappers (`postTimesheetEntries`, `saveTimesheetEntry`, …) still
    flatten the error to a string, as on the branch. When they become operations, use
    `invokePosting(ctx, …)` or `run`.
- **Phase 8 (tests):** import from the new homes:
  - `post-timesheet/plan.test.ts` → `~/modules/projects/timesheet-posting-plan`;
  - `post-project-stock-transfer/plan.test.ts` → `~/modules/projects/stock-transfer-plan`;
  - `complete-service-order/plan.test.ts` → `~/modules/service/refurbishment-completion-plan`;
  - `create-service-order-invoice/plan.test.ts` → `~/modules/service/service-invoice-plan`;
  - the live tests call `invokePosting(handlesOf(f.ctx), "<name>", input, <module>.<fn>)`;
  - `post-project-burden.test.ts` imports `ACCOUNTING_PERIOD_CLOSED` from
    `~/modules/projects/projects.service`;
  - the ee tests `cutover-recost` / `percent-complete` import `postProjectIssue` (now
    `projects.service.postProjectIssue`), so they must move to `apps/erp/test/database/` (see the
    accounting note).
- **Phase 9:**
  - Update the `posting-permissions.test.ts` snapshot with `vitest -u`. It adds 8 `projects.*Permission`,
    2 `service.*Permission`, and the 5 new `postingPermissions` keys. Each value is the
    branch's (FREEZE `permissions-manifest.test.ts.snap` lines 20, 131, 139, 373–382, 402, 423,
    432, 436).
  - Docs that still name `@carbon/server-functions` for these functions:
    `apps/erp/app/modules/projects/AGENTS.md`, `apps/erp/app/modules/service/AGENTS.md`,
    `packages/jobs/AGENTS.md`.
- **Not done here (out of scope):** the branch's `revenueRunSynthesizers` wiring. The
  accounting agent solved it inside `runRowSynthesizers`, so no posting needs a context field.
