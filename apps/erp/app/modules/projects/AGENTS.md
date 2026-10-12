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
- **State** — company-wide `projectState` in five groups (Backlog, Unstarted, Started,
  Completed, Cancelled), one default per group per company, edited in Settings → Projects
  (`ProjectStatesGrid`). `seed-company` inserts the six `projectStates` of
  `@carbon/database/seed-data`; a project or service order seeds none. Labels
  (`projectLabel`) are company-wide too (`ProjectLabelsGrid`).
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
- **Project stock** — `project.projectStock` (set while Draft). The project owns the stock
  received for it: `itemLedger.projectId` / `costLedger.projectId` stripe it, NULL is
  common stock. `chargeAtReceipt` charges the project at receipt; `governmentFurnished`
  keeps the stock with the project's customer.
- **Project stock transfer** — `projectStockTransfer` + lines: Transfer, Borrow or Payback,
  Draft → Approved → Posted, or Cancelled. A Borrow opens a `projectBorrow`; a Payback
  settles it and charges the borrower the Payback Variance.
- **Netting segment** (Phase 2b) — MRP plans a project with project stock on its own
  (`planningSegmentId` = the project id). A **Transfer** planning action proposes common
  stock the common segment does not need; applying it creates a Draft transfer with
  `planningActionId`. An overdue Open borrow shows as a badge in `ProjectHeader`.
- **Planning group** (Phase 3, commercial `PLANNING_GROUPS`) — `planningGroup` pools
  projects with project stock at one location; members (`project.planningGroupId`,
  `planningPriority`) net in the group's segment. Grouped PO lines and jobs carry
  `planningGroupId` and no project. **Pegs** (`projectPeg`) say which member each piece of
  grouped supply is for: Soft (MRP moves them), Hard (received or completed; set only by
  `harden_pegs_for_supply`), Manual (a planner's override with a reason). A peg row is
  superseded, never updated, so the history stays.

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
- MUST post a project stock transfer with `postProjectStockTransfer` (`projects.server.ts`,
  `post-project-stock-transfer`) and approve or cancel it with
  `updateProjectStockTransferStatus` — Approve runs the government-furnished guard.
- MUST store common stock as a null owner: the owner pickers send `COMMON_STOCK_OWNER`
  (`common`), and the routes map it with `toStockOwner`.
- MUST pass `db` (Kysely) from the route to `deleteProjectState`, `setProjectStateDefault`
  and the `projects.server.ts` functions.
- MUST route every plan-layer write through `readChangeRequestId` +
  `requireEditablePlanRoute`, and send the open change request from the UI with
  `withChangeRequest` — a write that skips them bypasses the draft and the plan lock.

### Ask First
- Changing `projectStates` (`seed-data.ts`) — tier 09 `PROJECT_STATES` and the
  `20261012164218_project-states-company-wide.sql` backfill copy it.
- Adding a cost treatment — `resolveProjectPostingAccount` and SQL `project_posting_account`
  must change together.
- Turning `CONSTRUCTION_IN_PROGRESS_ENABLED` on — project screens read CIP classes with
  `getCipFixedAssetClasses` instead.
- Changing the remaining-life Straight Line rule — it applies only to assets with a
  `postCapitalization` CIP row; applying it to all assets changes existing schedules.

### Never
- Never write `projectLedger` from the ERP — only the server functions and the job SQL do.
- Never write `itemLedger` / `costLedger` rows of a project stock move from the ERP — only
  `post-project-stock-transfer` does. Never change `projectStock` past Draft.
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
| `laborCategory`, `laborCategoryRate` | Effective-dated cost rates (`rateOn`) and the default `billRate` |
| `projectBillableItem` (`customerContractLineId`) | Contract billable items of Time & Materials and Cost Plus lines (Phase 4a; `.claude/rules/project-billing.md`) |
| `timesheetEntry` | Hours per employee, day, charge number, labor category |
| `projectLedger` | Actual cost rows; a void writes a negative row with `reversalOfId` |
| `projectElementLink` | Trace links with `suspectSince` / `reviewedAt` |
| `projectView`, `projectUserPreference` | Unused since the Plan page lost saved views (2026-10-12); kept with no migration |
| `fixedAssetCipCost` (`projectId`, `projectElementId`, `postCapitalization`) | CIP rows of capital projects |
| `get_project_cost_summary` (RPC) | Plan, committed and actual per element |
| `get_element_history_by_item` (RPC) | Average hours and material cost of elements on one item |
| `projectBaseline` | Plan snapshots (`snapshot` JSONB, `formatVersion`) |
| `projectChangeRequest`, `projectChangeRequestItem` | Change requests and their row edits (`payload`, `baseRow`) |
| `projectChangeRequestComment`, `projectChangeRequestView` | Review comments (field-level) and per-user Viewed marks |
| `project.projectStock` / `chargeAtReceipt` / `governmentFurnished` | Project stock flags (Phase 2a) |
| `projectStockTransfer`, `projectStockTransferLine` | Transfer / Borrow / Payback documents; the line's `unitCost` is stamped at posting |
| `projectBorrow` | An open borrow: quantity, `quantityPaidBack`, `borrowedUnitCost`, due date |
| `planningGroup` | Location, excess rule (+ `exceptionProjectId`), priority rule, `active` (Phase 3) |
| `project.costObjective` / `restrictCharging`, `projectMember` | Cost objective and the charge restriction (Government Contracting 5a; `.claude/rules/government-contracting.md`) |
| `projectElement.isUnallowable` / `isPreproduction` / `isLeave` | Element flags (5a) |
| `timesheetEntryRevision`, `timesheetCertification` | DCAA correction trail and weekly certification (5a) |
| `get_missing_timesheet_days` (RPC) | Scheduled work days with no entry (5a) |
| `projectElement.isBusinessComponent` / `rdComponentType` / `rdSoftwareType`, `timesheetEntry.rdActivityRole` / `workLocationId`, `laborCategory.rdActivityRole` | R&D tax tags (Government Contracting 5d; `government-contracting.md` → *R&D tax*) |
| `projectPeg` | Versioned pegs: supply (`supplyType`, `supplyId`), member demand, `state`, `supersededAt`, `hardenedAt`, `itemLedgerId` |

## Key Service Functions
- `getChargeNumbers` — Released projects and chargeable elements for the picker.
- `getProjectCostSummary` + `rollUpCostSummary` / `buildProjectCostFigures` — the Costs tab. `getChildServiceProjectCosts` (`get_child_service_project_costs`) adds the service orders of a contract project; their actual goes to the project total through `buildProjectCostFigures`'s third argument.
- `getProjectElementPage` (`.server`) — everything the element page loads, in parallel.
- `getProjectElementCommentCounts` — the comment count per element for the Tree layout's cards (one paged read; no `@mcp` tag).
- `saveTimesheetEntry`, `submitTimesheetWeek` (`.server`) — the grid saves a cell and
  submits a week through the `save-timesheet-entry` and `submit-timesheet-week` server
  functions, which hold the DCAA rules for the ERP and the MES. Log time and service
  time call `saveTimesheetEntry` with `mode: "add"`: one new entry each time (Log time
  Submitted in Standard mode, service time Draft with its visit); the route posts it.
  In DCAA mode the server function saves the owner's Log time entry as Draft, so it
  waits for the weekly certification, and the route does not post it.
- `approveTimesheetEntries`, `rejectTimesheetEntries`, `createTimesheetCorrection` — the
  rest of the timesheet flow. A correction on another charge number is a labor transfer
  (`correctionOfId`); `assertCanApprove` refuses its requester as approver in DCAA mode.
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
- `parseElementFilters`, `canonicalElementsParams`, `elementLayoutFromParams`
  (models) — the Plan page's filters (`filter=type:eq:…` for the Type filter;
  the old `?type=` still reads) and its layouts (Table, Tree, Reader).
- `loadPlanSnapshot`, `createProjectBaseline` / `insertProjectBaseline` (`.server`),
  `getProjectBaselines`, `getProjectBaseline`, `diffPlanSnapshots` (models) — baselines.
- `createChangeRequest`, `upsertChangeRequestItems`, `loadChangeRequestOverlay`,
  `applyChangeRequest`, `reopenChangeRequest`, `setChangeRequestStatus`,
  `getChangeRequestReview` (`.server`); `applyChangeRequestItems`,
  `mergeChangeRequestItem`, `findConflicts`, `rebaseChangeRequestItems` (models) — change
  requests.
- `requireProjectPlanEditable`, `requireEditablePlanRoute` (`.server`),
  `isProjectPlanLocked` (models) — the plan lock.
- `getProjectStockTransfers`, `getProjectStockTransfer`, `getProjectStockTransferLines`,
  `upsertProjectStockTransfer` (Draft only), `upsertProjectStockTransferLine`,
  `deleteProjectStockTransferLine`, `updateProjectStockTransferStatus`, `getProjectBorrows`,
  `getStockOwnerProjects`; `postProjectStockTransfer`, `getProjectStockOnHand` (`.server`);
  `projectStockTransferValidator`, `projectStockTransferLineValidator`,
  `governmentFurnishedRefusal`, `isBorrowOverdue` (models) — project stock.
  `getProjectBorrows` filters by project, status, `locationId` and `dueBefore` (the
  overdue borrows of the header badge and the planning worklists).
- `applyTransferPlanningActions`, `createProjectStockTransfersFromActions` (`.server`) —
  Apply of Transfer planning actions from both planning routes: needs `update: projects`;
  one transaction claims the actions and creates one Draft transfer each, readable ids
  from the `projectStockTransfer` sequence. Kept out of the service so it is no MCP tool.
- `getPlanningGroups`, `getPlanningGroupsList`, `getPlanningGroup`, `getPlanningGroupMembers`,
  `deletePlanningGroup` (no plan check), `getProjectPegs` (current, or `asOf` for history),
  `getPlanningGroupOpenSupplies`; `planningGroupValidator`, `manualPegValidator` (models) —
  Phase 3. The commercial writes live in `@carbon/ee/pegging.server`: `upsertPlanningGroup`
  and `createManualPeg` call `requireEntitlement` first; routes call `requireFeature` and turn
  an `EntitlementError` into a flash.
- `getContractBillableItems` (rows typed `ContractBillableItemRow`), `getContractBillingLines`,
  `getProjectBillingElements`, `updateProjectBillableItems` (hold, release, write off,
  price; refuses Billed and Written Off items); `billableItemActionValidator` (models) —
  contract billing review (Phase 4a): Projects → **Billing** (`projects+/billing.tsx`,
  `billing.update.tsx`) and the project **Billing** tab (`$projectId.billing.tsx`,
  Contract projects only), UI in `ui/Billing/`.
- `getProjectContractRevenue` (`ProjectContractRevenue`) — per contract line, the revenue
  recognized to date and the latest month's progress, EAC and price (Phase 4b). The Billing
  tab passes it to `ProjectBillingLines` (**Percent Complete**, **Revenue Recognized**), and
  the contract page (`contract+/$id.details.tsx`) to `ContractProjectBilling`.
- `getProjectMembers`, `addProjectMember`, `removeProjectMember`;
  `getTimesheetRevisions`, `getPendingReviewEntries`, `acceptTimesheetReview`;
  `getTimesheetWeekView` (`.server`, shared by My Timesheet and the manager's employee
  timesheet page `projects+/timesheets.$employeeId.tsx`) — DCAA timekeeping (5a).
- `getLateTimesheetEntries`, `getMissingTimesheetDays`, `getLaborTransfers`,
  `getTimesheetAuditRows`, `getLaborDistributionRows`, `getLaborDistributionPeriods`,
  `getCostByClin` (Kysely, no `@mcp` tag); `buildLaborDistribution`, `projectReportKeys`
  (models) — Projects → **Reports** (`projects+/reports.tsx`) and its CSV route
  `api+/projects.reports.$reportKey[.]csv.ts`, which checks each report's permissions.
- `getRdLedgerRows`, `getRdEmployeeYear` (Kysely, no `@mcp` tag), `getRdComponents`
  (`@mcp read`); `buildSection174ARows`, `buildSection6765Input`, `rdTaxReportKeys`,
  `taxYearOf`, `monthNumber`, `rdActivityRoles`, `rdComponentTypes`, `rdSoftwareTypes`
  (models) — the R&D tax reports `rd-section-174a` and `rd-form-6765-g` by tax year
  (Government Contracting 5d). The role and type labels are hooks in
  `ui/RdTax/useRdTaxLabels.ts`; the element sidebar's type pickers use `ChoicePill`
  (`ui/Elements/ElementProperties.tsx`).
- `getPlanningSegmentOwners`, `moveActionPegsToSupply` (`.server`) — the planning routes'
  Apply in a group segment: the owner of each segment, and one transaction that moves an
  action's pegs onto the PO line or job it created.

## Related Modules
- **production** — `job.projectId/projectElementId/consumeToProject`; `getJobProjectCharge`;
  the planning worklists' Segment column, Transfer actions and Overdue borrows group
  (`.claude/rules/mrp-system.md` → *Project netting segments*).
- **purchasing / invoicing** — charge number on PO and invoice lines; `getLineChargeNumber`.
- **settings / ee approvals** — approval document type `projectChangeRequest`; the
  approvals engine flips the change request status.
- **accounting** — `Project` and `ProjectElement` dimensions; account defaults Project WIP and
  Project Expense; journal sources `Timesheet` and `Project Issue`; CIP assets, `capitalizeCip`
  and the remaining-life Straight Line for capital projects.
- **items / inventory** — part links, `getMethodTree` and the lineage RPCs for Build from part,
  `getMethodMaterialsByMakeMethod` for the Issue Material BOM picks; project stock stripes
  (`inventory-system.md` → *Project stock*), the quantities page's owner filter and the
  count lines' Stock Owner column.
- **MES** — saves and submits time through the same `save-timesheet-entry` and
  `submit-timesheet-week` server functions (`serverFns.system`).

## Rules References
- `.claude/rules/projects-system.md` — posting, charge gates, ids, consume-to-project jobs,
  capital projects, trace links, verification, layouts, templates, Build from part,
  baselines, change requests, the plan lock, project stock, and planning groups, pegging
  and distribution.
- `.claude/rules/mrp-system.md` → *Planning groups and pegging* — the group segment, the
  pegging run and the member moves.
- `.claude/rules/inventory-system.md` → *Project stock* — stripes, the stripe set of a
  demand, the key order.
- `.claude/rules/fixed-asset-lifecycle.md` — the CIP side of capital projects.
- `.claude/rules/government-contracting.md` — cost objectives, unallowable cost, DCAA
  timekeeping, dilution, labor transfers, payroll totals, CLIN funding and the reports.
- `.claude/rules/accounting-sync-handlers.md` — how the new journal sources sync.
- `.claude/rules/database-patterns.md` — Kysely transactions and server functions.
