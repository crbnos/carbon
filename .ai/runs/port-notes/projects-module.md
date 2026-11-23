# Port notes: projects-module (plan Phase 6, projects)

Agent `projects-module`. Worktree `kelowna-port`. Nothing committed. The work ran in two
sessions; the first ended while five of its six group sub-agents were finishing, so their
own reports were lost. Everything below was re-checked against the tree in the second
session (typecheck, checks, tool manifest, a grep for writes in routes).

## Result

- `apps/erp/app/modules/projects/projects.server.ts` is in main's shape: imports, two zod
  constants, one `logger`, and **131 `defineServiceFn` operations**. Nothing else
  (`service-fn-file`: clean).
- Every helper, class and type that was in `projects.server.ts` is in
  `projects.service.ts`. A new client-safe `projects.utils.ts` holds the two reads that a
  component runs in the browser.
- `projects` and `service` are in `apps/erp/app/modules/router.server.ts`. `service` was
  added because `service/service.server.ts` has `defineServiceFn` exports.
- Every action in the routes I own calls an operation through `carbon(request)`. No route
  of mine has a direct write or `invokePosting` (`route-action-shape`: clean).
- The published tool set is the branch's set: all 86 `projects_*` tools in the branch's
  digest (FREEZE `tool-manifest.digest.json`), plus `projects_updateProjectElementBilling`
  (see Tools).

## Helpers moved (`projects.server.ts` → `projects.service.ts`)

The whole body moved by script, apart from the import block, which was merged and
de-duplicated. That covers about 115 exports: `createProject`, `copyProject`, the WBS,
baseline and change-request engines, `ProjectChangeRequestError`,
`ProjectChangeConflictError`, `readChangeRequestId`, `requireProjectPlanEditable`,
`requireEditablePlanRoute`, `getJobChargeTarget`, `ensureCapitalAssets`, the build-from-part
helpers, `getProjectElementPage*`, `getElementTimeAndMaterials`, `ElementLedgerRow`,
`chargeNumbersError`, `chargeNumberError`, `checkProjectBudget`, `timesheetBudgetWarning`,
`applyTransferPlanningActions`, `createProjectStockTransfersFromActions`,
`getPlanningSegmentOwners`, `moveActionPegsToSupply`, `getTimesheetWeekView`, the
approval and billing counts, and the report helpers.

Changes made because a service file may not build a DB client (`no-db-client-in-service`):

| Function | Change |
|---|---|
| `getChangeRequestReview(client, db, args)` | new `db` argument |
| `getProjectElementPage(client, db, args)` | new `db` argument |
| `getProjectElementPageInChangeRequest(client, db, args)` | new `db` argument |
| `timesheetBudgetWarning(client, db, args)` | new `db` argument |
| `applyTransferPlanningActions({ db, companyId, userId, planningActionIds })` | new `db` field. I updated both callers (`production.server.ts` `applyPlanningActions`, `purchasing.server.ts` `applyPlanningActions`) to pass `ctx.asSystem.pg`. |

The old posting wrappers now take a `ServiceContext`. Four of them had the same name as
a building block:

| Old (`projects.server.ts`) | New (`projects.service.ts`) |
|---|---|
| `postTimesheetEntries({ timesheetEntryIds, companyId, userId })` | `postTimesheetEntries(ctx, { timesheetEntryIds })` |
| `saveTimesheetEntry({ …, companyId, userId })` | `invokeSaveTimesheetEntry(ctx, args)` + `saveTimesheetEntryPostingInput` ('' → null) + type `SaveTimesheetEntryArgs` |
| `submitTimesheetWeek({ … })` | removed: the operation runs the body |
| `postProjectIssue({ … })` | `invokePostProjectIssue(ctx, input)` + `projectIssuePostingInput` |
| `addProjectExpense(db, { …, companyId, userId })` | `addProjectExpense(ctx, args)` |
| `postProjectStockTransfer({ … })` | removed: the operation runs the body |

The service module already uses the new shapes. Its files typecheck.

Two more changes:

- **No server code in the client.** `getCipFixedAssetClasses` and `getPlanningGroupsList`
  moved to `projects.utils.ts`, because `ui/Projects/ProjectForm.tsx` runs them in the
  browser. The `getPlanningGroupsList` operation calls `utils.getPlanningGroupsList`.
  `ui/Element/IssueMaterialModal.tsx` imported `getMethodMaterialsByMakeMethod` from
  `items.service`; it now runs the same read inline (`methodMaterial`, `itemId, methodType`,
  by `makeMethodId` and `companyId`, in BOM order).
- **Search filters.** `no-raw-or-search` found three template `.or()` searches in branch
  code: `getProjects`, the element search, and `getProjectStockTransfers`. They now use
  `searchFilter(...)` (`@carbon/utils`).

The 87 branch `@mcp` tags were removed from `projects.service.ts`. They are on the
operations now.

## Importers repointed

There were 78 files that imported `projects/projects.server` (or `../../projects.server`,
`./projects.server`). Their import lines now name `projects.service`, and duplicate
imports were merged.

- **Outside my routes:**
  - modules: `invoicing.server.ts`, `production.server.ts`, `production.service.ts`,
    `purchasing.server.ts`, `service/service.server.ts`;
  - the purchase-invoice and purchase-order routes;
  - the service-order / service-work / service-orders template routes;
  - `file+/project+/$id[.]pdf.tsx`;
  - `$id.charge.test.ts`;
  - the two projects tests;
  - 11 type-only imports in `projects/ui/**`.
- **Outside the import lines:** only the two `applyTransferPlanningActions` calls above.

## Routes changed

There are 74 route files under `x+/project+`, `x+/projects+`, `x+/project-stock-transfer+`,
`x+/timesheet*`, `api+/projects*` and `x+/accounting+/indirect-*`. Every action now:

1. parses the request;
2. calls one operation;
3. maps the result to the response its component already reads (the same flash texts,
   `{ success, error: { message } }`, and `validationError` field errors where the branch
   had them).

The logic the branch put in route actions now lives in the operations:

- plan-lock checks and change-request routing;
- Closed-project checks;
- charge-number, budget and company-record checks;
- milestone baselines;
- the save→post, submit→post and approve→post sequences;
- the change-request approval lifecycle and its notifications;
- the WBS row limits;
- the transfer status and posting;
- the indirect pools and rates ee calls.

Stale imports fixed:

| Old import | Now from | Routes |
|---|---|---|
| `~/modules/shared/timezone.server` | `shared.service` / `@carbon/database` | `_index`, `billing`, `costs`, `place-in-service` |
| `getRecordIssueLinks` | `shared.service` | `element.$elementId` |
| `getUnreleasedChangeOrderIssue` | `items.service` | `create-job` |
| `requireCompanyRecord` | `shared.service` | `create-job` |
| `getUserDefaults` | `users.service` | `transfers.new` |

The 10 errors in `PlaceInServiceModal.tsx` are fixed.

## Operations created

The permission of a route operation is the route's `requirePermissions` grant. A posting
operation takes the body's `<name>Permission` constant, unchanged. `read`, `destructive`
and `(write)` are the `@mcp` modifier; `—` means the operation is not published. The
operations are listed in file order.

| Operation | Permission | @mcp | Route(s) |
|---|---|---|---|
| `getProject` | `{ view: "projects" }` | read | x+/project+/$projectId.details.tsx |
| `getProjectSwitcherOptions` | `{ view: "projects" }` | read | — |
| `getProjects` | `{ view: "projects" }` | read | — |
| `createProject` | `{ create: "projects" }` | — | x+/projects+/new.tsx |
| `upsertProject` | `{ create: "projects", update: "projects" }` | (write) | — |
| `updateProject` | `{ update: "projects" }` | (write) | x+/project+/$projectId.details.tsx |
| `updateProjectTemplate` | `{ update: "projects" }` | — | x+/project+/$projectId.template.tsx |
| `updateProjectStatus` | `{ update: "projects" }` | (write) | x+/project+/$projectId.status.tsx |
| `deleteProject` | `{ delete: "projects" }` | destructive | — |
| `stopProjectWork` | `{ update: "projects" }` | — | x+/project+/$projectId.stop-work.tsx |
| `resumeProjectWork` | `{ update: "projects" }` | — | x+/project+/$projectId.stop-work.tsx |
| `updateProjectControlSettings` | `{ update: "projects" }` | — | x+/project+/$projectId.settings.tsx |
| `getProjectMembers` | `{ view: "projects" }` | read | — |
| `addProjectMember` | `{ update: "projects" }` | (write) | x+/project+/$projectId.settings.tsx |
| `removeProjectMember` | `{ update: "projects" }` | destructive | x+/project+/$projectId.settings.tsx |
| `getChargeNumbers` | `{ view: "projects" }` | read | — |
| `getProjectStates` | `{ view: "projects" }` | read | — |
| `upsertProjectState` | `{ update: "settings" }` | (write) | — |
| `deleteProjectState` | `{ update: "settings" }` | destructive | — |
| `setProjectStateDefault` | `{ update: "settings" }` | (write) | — |
| `getProjectLabels` | `{ view: "projects" }` | read | — |
| `upsertProjectLabel` | `{ update: "settings" }` | (write) | — |
| `deleteProjectLabel` | `{ update: "settings" }` | destructive | — |
| `getProjectMilestones` | `{ view: "projects" }` | read | — |
| `upsertProjectMilestone` | `{ update: "projects" }` | (write) | x+/project+/$projectId.milestones.tsx |
| `completeProjectMilestone` | `{ update: "projects" }` | (write) | x+/project+/$projectId.milestones.tsx |
| `deleteProjectMilestone` | `{ update: "projects" }` | destructive | x+/project+/$projectId.milestones.tsx |
| `getProjectLedger` | `{ view: "projects" }` | read | — |
| `getProjectElementCosts` | `{ view: "projects" }` | read | — |
| `getProjectOpenTimesheetEntries` | `{ view: "projects" }` | read | — |
| `getProjectCostSummary` | `{ view: "projects" }` | read | — |
| `getProjectBurdenSummary` | `{ view: "projects" }` | read | — |
| `getRdComponents` | `{ view: "projects" }` | read | — |
| `upsertProjectReportPin` | `{ view: "projects" }` | — | x+/projects+/reports._index.tsx |
| `getProjectBaselines` | `{ view: "projects" }` | read | — |
| `getProjectBaseline` | `{ view: "projects" }` | read | — |
| `createProjectBaseline` | `{ update: "projects" }` | — | x+/project+/$projectId.baselines.tsx |
| `getProjectChangeRequests` | `{ view: "projects" }` | read | — |
| `getProjectChangeRequest` | `{ view: "projects" }` | read | — |
| `createProjectChangeRequest` | `{ update: "projects" }` | — | x+/project+/$projectId.change-requests.new.tsx |
| `updateProjectChangeRequestStatus` | `{ update: "projects" }` | — | x+/project+/$projectId.change-requests.$crId.status.tsx |
| `createProjectChangeRequestComment` | `{ view: "projects" }` | — | x+/project+/$projectId.change-requests.$crId.comments.tsx |
| `resolveProjectChangeRequestComment` | `{ update: "projects" }` | — | x+/project+/$projectId.change-requests.$crId.comments.tsx |
| `deleteProjectChangeRequestComment` | `{ view: "projects" }` | — | x+/project+/$projectId.change-requests.$crId.comments.tsx |
| `updateProjectChangeRequestView` | `{ view: "projects" }` | — | x+/project+/$projectId.change-requests.$crId.viewed.tsx |
| `importProjectWbs` | `{ create: "projects", update: "projects" }` | — | x+/project+/$projectId.wbs.import.tsx |
| `pinProjectWbsCodes` | `{ update: "projects" }` | — | x+/project+/$projectId.wbs.pin.tsx |
| `renumberProjectWbsSubtree` | `{ update: "projects" }` | — | x+/project+/$projectId.wbs.renumber.tsx |
| `getProjectElements` | `{ view: "projects" }` | read | — |
| `getProjectElementDescriptions` | `{ view: "projects" }` | read | — |
| `getProjectElement` | `{ view: "projects" }` | read | — |
| `createProjectElement` | `{ create: "projects" }` | — | x+/project+/$projectId.elements.new.tsx |
| `updateProjectElementField` | `{ update: "projects" }` | — | x+/project+/$projectId.elements.update.tsx |
| `updateProjectElementBilling` | `{ update: "projects" }` | (write) | x+/project+/$projectId.elements.update.tsx |
| `setProjectElementLabels` | `{ update: "projects" }` | destructive | x+/project+/$projectId.elements.update.tsx |
| `moveProjectElement` | `{ update: "projects" }` | — | x+/project+/$projectId.elements.move.tsx |
| `updateProjectElementOrder` | `{ update: "projects" }` | (write) | x+/project+/$projectId.elements.move.tsx |
| `deleteProjectElement` | `{ delete: "projects" }` | destructive | x+/project+/$projectId.elements.$elementId.delete.tsx |
| `updateProjectElementEarnedValue` | `{ update: "projects" }` | — | x+/project+/$projectId.element.$elementId.tsx |
| `getProjectElementLinks` | `{ view: "projects" }` | read | — |
| `upsertProjectElementLink` | `{ update: "projects" }` | (write) | x+/project+/$projectId.elements.links.tsx |
| `deleteProjectElementLink` | `{ update: "projects" }` | destructive | x+/project+/$projectId.elements.links.tsx |
| `clearSuspectLink` | `{ update: "projects" }` | (write) | x+/project+/$projectId.elements.links.tsx |
| `saveParameterFormula` | `{ update: "projects" }` | — | x+/project+/$projectId.elements.links.tsx |
| `getProjectElementComments` | `{ view: "projects" }` | read | — |
| `insertProjectElementComment` | `{ view: "projects" }` | (write) | x+/project+/$projectId.elements.$elementId.comments.tsx |
| `deleteProjectElementComment` | `{ view: "projects" }` | destructive | x+/project+/$projectId.elements.$elementId.comments.tsx |
| `getProjectElementPlanLines` | `{ view: "projects" }` | read | — |
| `upsertProjectElementMaterial` | `{ update: "projects" }` | (write) | x+/project+/$projectId.elements.$elementId.plan.tsx |
| `deleteProjectElementMaterial` | `{ update: "projects" }` | destructive | x+/project+/$projectId.elements.$elementId.plan.tsx |
| `upsertProjectElementLabor` | `{ update: "projects" }` | (write) | x+/project+/$projectId.elements.$elementId.plan.tsx |
| `deleteProjectElementLabor` | `{ update: "projects" }` | destructive | x+/project+/$projectId.elements.$elementId.plan.tsx |
| `upsertProjectElementCost` | `{ update: "projects" }` | (write) | x+/project+/$projectId.elements.$elementId.plan.tsx |
| `deleteProjectElementCost` | `{ update: "projects" }` | destructive | x+/project+/$projectId.elements.$elementId.plan.tsx |
| `getProjectItemValues` | `{ view: "projects" }` | read | — |
| `getElementHistoryByItem` | `{ view: "projects" }` | read | — |
| `getItemNumericCustomFields` | `{ view: "projects" }` | read | — |
| `buildElementsFromPart` | `{ update: "projects" }` | — | x+/project+/$projectId.elements.build.tsx |
| `createJobFromMaterial` | `{ create: "production", view: "projects" }` | — | x+/project+/$projectId.elements.$elementId.create-job.tsx |
| `createPurchaseOrderLineFromMaterial` | `{ create: "purchasing", view: "projects" }` | — | x+/project+/$projectId.elements.$elementId.create-po-line.tsx |
| `createManualPeg` | `{ update: "projects" }` | — | x+/project+/$projectId.pegging.manual.tsx |
| `placeProjectAssetsInService` | `{ update: "projects", create: "accounting" }` | — | x+/project+/$projectId.place-in-service.tsx |
| `getLaborCategories` | `{ view: "projects" }` | read | — |
| `getLaborCategory` | `{ view: "projects" }` | read | — |
| `getLaborCategoriesList` | `{ view: "projects" }` | read | — |
| `upsertLaborCategory` | `{}` | (write) | x+/projects+/labor-categories.$id.tsx, x+/projects+/labor-categories.new.tsx |
| `getLaborCategoryRates` | `{ view: "projects" }` | read | — |
| `upsertLaborCategoryRate` | `{ update: "projects" }` | (write) | x+/projects+/labor-categories.$id.tsx |
| `getTimesheetWeek` | `{ view: "projects" }` | read | — |
| `saveTimesheetEntry` | `{}` | — | x+/projects+/timesheets.$employeeId.tsx, x+/timesheet.update.tsx |
| `logTimesheetEntry` | `{}` | — | x+/projects+/log-time.tsx |
| `submitTimesheetWeek` | `{}` | — | x+/timesheet.submit.tsx |
| `postTimesheet` | `service.postTimesheetPermission` | — | — |
| `approveTimesheetEntries` | `{ update: "projects" }` | (write) | x+/projects+/approvals.tsx |
| `rejectTimesheetEntries` | `{ update: "projects" }` | (write) | x+/projects+/approvals.tsx |
| `createTimesheetCorrection` | `{}` | (write) | x+/timesheet.correct.tsx |
| `acceptTimesheetReview` | `{}` | — | x+/timesheet.review.tsx |
| `getTimesheetRevisions` | `{ view: "projects" }` | read | — |
| `getPendingReviewEntries` | `{ view: "projects" }` | read | — |
| `getTimesheetApprovalCount` | `{ view: "projects" }` | read | — |
| `getTimesheetApprovals` | `{ view: "projects" }` | read | — |
| `sendMissingTimeReminders` | `{ view: ["projects"] }` | — | x+/projects+/reports.missing-time.tsx |
| `updateTimesheetRequired` | `{ view: ["projects"], update: "people" }` | — | x+/projects+/reports.missing-time.tsx |
| `createProjectExpense` | `{ update: "projects" }` | — | x+/projects+/expense.tsx |
| `postProjectIssue` | `{ update: ["inventory", "projects"] }` | — | x+/projects+/issue.tsx |
| `getProjectBillingElements` | `{ view: "projects" }` | read | — |
| `getContractBillableItems` | `{ view: ["projects", "sales"] }` | read | — |
| `getContractBillingLines` | `{ view: ["projects", "sales"] }` | read | — |
| `updateProjectBillableItems` | `{ update: "projects", view: "sales" }` | (write) | x+/projects+/billing.update.tsx |
| `getPlanningGroups` | `{ view: "projects" }` | read | — |
| `getPlanningGroup` | `{ view: "projects" }` | read | — |
| `getPlanningGroupsList` | `{ view: "projects" }` | read | — |
| `getPlanningGroupMembers` | `{ view: "projects" }` | read | — |
| `upsertPlanningGroup` | `{}` | — | x+/projects+/planning-groups.$id.tsx, x+/projects+/planning-groups.new.tsx |
| `deletePlanningGroup` | `{ delete: "projects" }` | destructive | x+/projects+/planning-groups.delete.$id.tsx |
| `getProjectStockTransfers` | `{ view: "projects" }` | read | — |
| `getProjectStockTransfer` | `{ view: "projects" }` | read | — |
| `getProjectStockTransferLines` | `{ view: "projects" }` | read | — |
| `upsertProjectStockTransfer` | `{ update: "projects" }` | (write) | x+/project-stock-transfer+/$id.tsx, x+/projects+/transfers.new.tsx |
| `upsertProjectStockTransferLine` | `{ update: "projects" }` | (write) | x+/project-stock-transfer+/$id.lines.tsx |
| `deleteProjectStockTransferLine` | `{ update: "projects" }` | destructive | x+/project-stock-transfer+/$id.lines.tsx |
| `postProjectStockTransfer` | `service.postProjectStockTransferPermission` | — | — |
| `updateProjectStockTransferStatus` | `{ update: "projects" }` | (write) | x+/project-stock-transfer+/$id.status.tsx |
| `getProjectBorrows` | `{ view: "projects" }` | read | — |
| `upsertIndirectPool` | `{}` | — | x+/accounting+/indirect-pools.$poolId.tsx, x+/accounting+/indirect-pools.new.tsx |
| `deleteIndirectPool` | `{ delete: "accounting" }` | — | x+/accounting+/indirect-pools.delete.$poolId.tsx |
| `upsertIndirectPoolAccount` | `{ update: "accounting" }` | — | x+/accounting+/indirect-pools.$poolId.tsx |
| `deleteIndirectPoolAccount` | `{ update: "accounting" }` | — | x+/accounting+/indirect-pools.$poolId.tsx |
| `setIndirectRate` | `{ update: "accounting" }` | — | x+/accounting+/indirect-rates.tsx |
| `runIndirectRatePeriod` | `{ update: "accounting" }` | — | x+/accounting+/indirect-rates.tsx |
| `runFinalTrueUp` | `{ update: "accounting" }` | — | x+/accounting+/indirect-rates.tsx |

Totals: 131 operations, 87 published (47 READ, 14 DESTRUCTIVE, 26 WRITE).

## Tools (MCP)

I checked the manifest read-only with `buildManifest()` from `scripts/lib/service-fn-metadata.ts`.
It did not throw, and it lists 87 `projects_*` tools.

- All 86 branch tools are carried, with the same names.
- **Added: `projects_updateProjectElementBilling`.** Its service function had a
  `@mcp update` tag in the port tree (one of the 87), but the branch's digest at FREEZE does
  not list it. Remove the tag if the set must equal the digest exactly.
- **Not published on purpose:** `updateProjectElementField` and `postProjectStockTransfer`.
  The branch did not publish them. `updateProjectStockTransferStatus` (`action: "post"`) is
  the published path for posting a transfer.
- **Tools not carried:** none.
- Phase 9 still has to run `pnpm generate:mcp`. The digest then gains 87 `projects_*` tools
  and every `service_*` operation the service agent tagged.

## Gates

- `cd apps/erp && npx tsgo --noEmit`: 0 errors under `app/`. 31 errors remain in `test/database/**`
  (Phase 8 tests on the old fixtures).
- `pnpm --filter @carbon/config build` (built `dist/`), then
  `pnpm --filter @carbon/checks exec vitest run src/run.test.ts`: no `module-shape`,
  `service-fn-file`, `route-action-shape`, `no-server-code-in-client`,
  `no-db-client-in-service` or `no-raw-or-search` violation in any file. The gate still
  fails on 17 `no-integration-id-branching` violations (`ee/issue-sync/engine.server.ts`,
  `shared.service.ts:1415`) and 2 `document-sequence-synced` violations (`seed-data.ts`
  `serviceOrder`, `projectStockTransfer`). Those files are not mine. `baseline.json` was not
  edited.
- `npx biome check --write` on every file I own: clean.
- SPDX fixer on `projects.utils.ts`: correct AGPL.

## Behaviour notes

These come from the `plan` group's report. The other groups' notes were lost; the items
below them are what I re-verified.

- **WBS import:** the rows are parsed before the project, Closed and lock checks, so an
  unreadable file is reported first. Every refusal comes back as `{ success: false, message }`.
  The modal reads `message ?? error.message`.
- **WBS pin / renumber:** every refusal also carries `error: { message }`, which is a
  superset of the old shape.
- **Change-request status:** the pending approval request is read once, up front.
  - A `ProjectChangeConflictError` becomes a `conflict` refusal and a
    `ProjectChangeRequestError` a `rule` refusal, with the same texts.
  - Comment create validates the form before it checks that the change request belongs to
    the project.
- **Indirect pools and rates:** these operations live in the projects namespace
  (`api.projects.upsertIndirectPool` and the others). They are not published.
  - `upsertIndirectPool` uses `permission: {}` plus `ctx.can({ create | update: "accounting" })`,
    because the route granted create or update by whether an id was sent.
  - An `EntitlementError` becomes an `entitlement` refusal.
  - They could move to `accounting.server.ts` later. That file belongs to the accounting
    owner.
- Every refusal the branch flashed keeps its text. A data-layer failure is `internal`; the
  gate logs it and the route shows its own fallback text.

## Requests for other owners

- **`x+/settings+/projects.tsx` (shared agent):** it still writes through building blocks.
  Replace each write with the matching operation (permission `update: settings`):
  - `upsertProjectState(client, …)` → `api.projects.upsertProjectState({ id?, …state })`;
  - `deleteProjectState(getDatabaseClient(), …)` → `api.projects.deleteProjectState({ id })`;
  - `setProjectStateDefault(getDatabaseClient(), …)` → `api.projects.setProjectStateDefault({ id })`;
  - `upsertProjectLabel(client, …)` → `api.projects.upsertProjectLabel({ id?, …label })`;
  - `deleteProjectLabel(…)` → `api.projects.deleteProjectLabel({ id })`.
- **Phase 8 tests:**
  - `projects/move-action-pegs.test.ts` and `transfer-planning-actions.test.ts` now import
    `./projects.service`, and `applyTransferPlanningActions` takes `db`.
  - `service-order+/$id.charge.test.ts` mocks `projects.service` with the old wrapper names
    (`postTimesheetEntries`, `saveTimesheetEntry`, `postProjectIssue`). Those are now
    ctx-based or renamed (`invokeSaveTimesheetEntry`, `invokePostProjectIssue`).
- **Phase 9 docs:** `modules/projects/AGENTS.md` and `modules/service/AGENTS.md` still name
  `projects.server.ts` for `postTimesheetEntries`, `saveTimesheetEntry`, `postProjectIssue`,
  `postProjectStockTransfer` and `getProjectStockOnHand`. These are now
  `projects.service.ts` helpers or operations.
- **Orchestrator:** the `@carbon/config` `dist/` build exists in the worktree and is
  gitignored.

## Open issues

- The five lost group reports mean there is no per-route behaviour log for the core,
  elements, plan-lines, time and stock routes. What I verified:
  - typecheck and the checks above;
  - every action goes through `api.projects.*`;
  - a grep for writes outside `api.` in the actions;
  - a read of `log-time.tsx`.

  It deserves a browser pass in Phase 10: timesheet save, submit and post; project issue;
  expense; transfer approve and post; change request approve and apply; create job and PO
  line from an element.
