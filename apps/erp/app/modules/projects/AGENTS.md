# Projects Module

Engineering and contract projects: a tree of typed elements, the charge numbers that
jobs, PO lines, invoices, time and issues post to, and the project ledger that sums them.

## Key Domain Concepts

- **Project** — `project` row with an `identifier` (`^[A-Z][A-Z0-9]{1,5}$`, unique per
  company). Status: Draft → Released → On Hold / Technically Complete → Closed
  (`projectStatusTransitions`, `canChangeProjectStatus`). Closed has no way back.
- **Element** — `projectElement`, typed System / Requirement / Function / Task / Test Case /
  Folder / Parameter. `readableId` is `<identifier>-<sequence>` from
  `project.nextElementSequence`; a move never changes it. A Parameter's children are
  Parameters. Any other element can link a part (`itemId`) and one serial of it
  (`trackedEntityId`).
- **State** — per-project `projectState` in five groups (Backlog, Unstarted, Started,
  Completed, Cancelled), one default per group. `defaultProjectStates` seeds six.
- **Charge number** — a project, or a project plus element (`ChargeNumber` picker,
  `getChargeNumbers`). Jobs, PO lines, purchase invoice lines, charge and reimbursement
  lines, timesheet entries and project issues carry one.
- **Cost treatment** — Statistical (no project account), Expense (Project Expense
  default), Contract (Project WIP default), Capitalize (the CIP asset of the nearest
  final-asset element, else the project's; `project.fixedAssetClassId` names the CIP
  class).
- **Trace link** — `projectElementLink`: satisfies, verifies, derives, implements,
  blocks, precedes, relates to, feeds. A change to a reviewed field marks incoming
  links suspect.
- **Verification** — `computeVerification` (pure) computes Parameters (Manual, Sum,
  Min, Max, Formula, Item) and Requirement status from the loaded rows.
- **Template** — a project with `isTemplate`; `copyProject` copies it, Build from part
  copies its elements into another project.
- **Baseline** — `projectBaseline`: a read-only JSONB snapshot of the plan layer
  (`PLAN_LAYER_FIELDS`), taken by hand, on milestone completion or by a change request.
- **Change request** — `projectChangeRequest` + `projectChangeRequestItem`: a draft of
  plan-layer edits made in the normal UI with `?cr=`, reviewed (comments, Viewed marks),
  approved through the approvals engine or by `update: projects`, then applied in one
  transaction. `project.lockPlanAfterMilestoneId` locks the plan after a milestone.
- **Timesheet entry** — `timesheetEntry`: Draft → Submitted → Approved → Posted, or
  Rejected (editable again). A Posted entry changes only by a correction (reversal +
  replacement).

## Safety

### Always
- MUST create a project with `createProject` (`projects.server.ts`) — it inserts the six
  states in the same transaction; `insertProjectElement` needs a default Unstarted state.
- MUST insert elements with `insertProjectElement` and move them with `moveProjectElement` —
  they allocate `readableId`, refuse a cycle, and refuse a non-Parameter child under a
  Parameter. Bulk inserts (`copyProject`, `buildElementsFromPart`) lock the project row
  and advance `nextElementSequence` in the same transaction.
- MUST call `ensureCapitalAssets` before a Capitalize project becomes Released — a
  Capitalize charge with no asset under construction is refused.
- MUST post time with `postTimesheetEntries` and issues with `postProjectIssue` — they call
  the `post-timesheet` / `post-project-issue` server functions with `serverFns.system`.
- MUST validate a document's charge number with `chargeNumberError` in the route action.
- MUST pass `db` (Kysely) from the route to `deleteProjectState`, `setProjectStateDefault`
  and the `projects.server.ts` functions.
- MUST route every plan-layer write through `readChangeRequestId` +
  `requireEditablePlanRoute`, and send the open change request from the UI with
  `withChangeRequest` — a write that skips them bypasses the draft and the plan lock.

### Ask First
- Changing `defaultProjectStates` — tier 09 `PROJECT_STATES` and the backfill migration copy it.
- Adding a cost treatment — `resolveProjectPostingAccount` and SQL `project_posting_account`
  must change together.
- Turning `CONSTRUCTION_IN_PROGRESS_ENABLED` on — project screens read CIP classes with
  `getCipFixedAssetClasses` instead.
- Changing the remaining-life Straight Line rule — it applies only to assets with a
  `postCapitalization` CIP row; applying it to all assets changes existing schedules.

### Never
- Never write `projectLedger` from the ERP — only the server functions and the job SQL do.
- Never update a Posted `timesheetEntry` — use `createTimesheetCorrection`.
- Never write a bare PostgREST embed from `job` or `purchaseOrderLine` — name the FK
  (`item!job_itemId_fkey`). The project FKs push bare embeds past TS2589.
- Never write a `feeds` link outside `saveParameterFormula` — the formula owns them.
- Never call projects code from `packages/ee` — the approvals engine only flips the change
  request status; the ERP route runs `applyChangeRequest`.

## Validation Commands
```bash
pnpm exec turbo run typecheck --filter=erp
pnpm --filter erp test   # apps/erp/test/projects-*.test.ts
pnpm --filter @carbon/server-functions test   # post-timesheet, post-project-issue, project-*.test.ts
```

## Key Data Model
| Table / Function | Purpose |
|---|---|
| `project` | Header: identifier, status, `costTreatment`, `costAccountId`, `nextElementSequence` |
| `projectState`, `projectLabel`, `projectMilestone` | Per-project workflow, labels, milestones |
| `projectElement` (+ `projectElementLabel`, `projectElementComment`) | The element tree |
| `projectElementMaterial` / `Labor` / `Cost` | Plan lines (budget) |
| `laborCategory`, `laborCategoryRate` | Effective-dated cost rates (`rateOn`) |
| `timesheetEntry` | Hours per employee, day, charge number, labor category |
| `projectLedger` | Actual cost rows; a void writes a negative row with `reversalOfId` |
| `projectElementLink` | Trace links with `suspectSince` / `reviewedAt` |
| `projectView`, `projectUserPreference` | Saved views and per-user layout, filters, display |
| `fixedAssetCipCost` (`projectId`, `projectElementId`, `postCapitalization`) | CIP rows of capital projects |
| `get_project_cost_summary` (RPC) | Plan, committed and actual per element |
| `get_element_history_by_item` (RPC) | Average hours and material cost of elements on one item |
| `projectBaseline` | Plan snapshots (`snapshot` JSONB, `formatVersion`) |
| `projectChangeRequest`, `projectChangeRequestItem` | Change requests and their row edits (`payload`, `baseRow`) |
| `projectChangeRequestComment`, `projectChangeRequestView` | Review comments (field-level) and per-user Viewed marks |

## Key Service Functions
- `getChargeNumbers` — Released projects and chargeable elements for the picker.
- `getProjectCostSummary` + `rollUpCostSummary` / `buildProjectCostFigures` — the Costs tab. `getChildServiceProjectCosts` (`get_child_service_project_costs`) adds the service orders of a contract project; their actual goes to the project total through `buildProjectCostFigures`'s third argument.
- `getProjectElementPage` (`.server`) — everything the element page loads, in parallel.
- `logTimesheetEntry` (`.server`) — Log time: one Submitted row; the route posts it when approval is off.
- `upsertTimesheetCell`, `submitTimesheetEntries`, `approveTimesheetEntries`,
  `rejectTimesheetEntries`, `createTimesheetCorrection` — the timesheet flow.
- `updateProjectStatus` — refuses Close while a PO or job of the project is open.
- `getProjectVerification` (`.server`) — links, item values (`getProjectItemValues`) and
  `computeVerification` for a project.
- `saveParameterFormula` (`.server`) — parses a formula, refuses a cycle, rewrites the
  `feeds` links.
- `ensureCapitalAssets`, `getProjectCapitalAssets`, `completeElementSubtrees` (`.server`) —
  capital project assets and Place in service.
- `copyProject` (`.server`) / `planProjectCopy` (models) — templates.
- `buildElementsFromPart`, `previewBuildFromPart` (`.server`) / `planElementsFromSource`
  (models) — Build from part.
- `getProjectViews`, `upsertProjectView`, `getProjectUserPreference`,
  `upsertProjectUserPreference` — saved views and preferences.
- `loadPlanSnapshot`, `createProjectBaseline` / `insertProjectBaseline` (`.server`),
  `getProjectBaselines`, `getProjectBaseline`, `diffPlanSnapshots` (models) — baselines.
- `createChangeRequest`, `upsertChangeRequestItems`, `loadChangeRequestOverlay`,
  `applyChangeRequest`, `reopenChangeRequest`, `setChangeRequestStatus`,
  `getChangeRequestReview` (`.server`); `applyChangeRequestItems`,
  `mergeChangeRequestItem`, `findConflicts`, `rebaseChangeRequestItems` (models) — change
  requests.
- `requireProjectPlanEditable`, `requireEditablePlanRoute` (`.server`),
  `isProjectPlanLocked` (models) — the plan lock.

## Related Modules
- **production** — `job.projectId/projectElementId/consumeToProject`; `getJobProjectCharge`.
- **purchasing / invoicing** — charge number on PO and invoice lines; `getLineChargeNumber`.
- **settings / ee approvals** — approval document type `projectChangeRequest`; the
  approvals engine flips the change request status.
- **accounting** — `Project` and `ProjectElement` dimensions; account defaults Project WIP and
  Project Expense; journal sources `Timesheet` and `Project Issue`; CIP assets, `capitalizeCip`
  and the remaining-life Straight Line for capital projects.
- **items / inventory** — part links, `getMethodTree` and the lineage RPCs for Build from part,
  `getMethodMaterialsByMakeMethod` for the Issue Material BOM picks.
- **MES** — `apps/mes/app/services/projects.service.ts` copies the timesheet functions.

## Rules References
- `.claude/rules/projects-system.md` — posting, charge gates, ids, consume-to-project jobs,
  capital projects, trace links, verification, layouts, templates, Build from part,
  baselines, change requests and the plan lock.
- `.claude/rules/fixed-asset-lifecycle.md` — the CIP side of capital projects.
- `.claude/rules/accounting-sync-handlers.md` — how the new journal sources sync.
- `.claude/rules/database-patterns.md` — Kysely transactions and server functions.
