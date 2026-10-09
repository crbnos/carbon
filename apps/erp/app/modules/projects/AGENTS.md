# Projects Module

Engineering and contract projects: a tree of typed elements, the charge numbers that
jobs, PO lines, invoices, time and issues post to, and the project ledger that sums them.

## Key Domain Concepts

- **Project** — `project` row with an `identifier` (`^[A-Z][A-Z0-9]{1,5}$`, unique per
  company). Status: Draft → Released → On Hold / Technically Complete → Closed
  (`projectStatusTransitions`, `canChangeProjectStatus`). Closed has no way back.
- **Element** — `projectElement`, typed System / Requirement / Function / Task / Test Case /
  Folder / Parameter. `readableId` is `<identifier>-<sequence>` from
  `project.nextElementSequence`; a move never changes it.
- **State** — per-project `projectState` in five groups (Backlog, Unstarted, Started,
  Completed, Cancelled), one default per group. `defaultProjectStates` seeds six.
- **Charge number** — a project, or a project plus element (`ChargeNumber` picker,
  `getChargeNumbers`). Jobs, PO lines, purchase invoice lines, charge and reimbursement
  lines, timesheet entries and project issues carry one.
- **Cost treatment** — Statistical (no project account), Expense (Project Expense
  default), Contract (Project WIP default). Capitalize exists in the enum; the
  validator refuses it until Phase 1b.
- **Timesheet entry** — `timesheetEntry`: Draft → Submitted → Approved → Posted, or
  Rejected (editable again). A Posted entry changes only by a correction (reversal +
  replacement).

## Safety

### Always
- MUST create a project with `createProject` (`projects.server.ts`) — it inserts the six
  states in the same transaction; `insertProjectElement` needs a default Unstarted state.
- MUST insert elements with `insertProjectElement` and move them with `moveProjectElement` —
  they allocate `readableId` and refuse a cycle or a Parameter parent.
- MUST post time with `postTimesheetEntries` and issues with `postProjectIssue` — they call
  the `post-timesheet` / `post-project-issue` server functions with `serverFns.system`.
- MUST validate a document's charge number with `chargeNumberError` in the route action.
- MUST pass `db` (Kysely) from the route to `deleteProjectState`, `setProjectStateDefault`
  and the `projects.server.ts` functions.

### Ask First
- Changing `defaultProjectStates` — tier 09 `PROJECT_STATES` and the backfill migration copy it.
- Adding a cost treatment — `resolveProjectPostingAccount` and SQL `project_posting_account`
  must change together.

### Never
- Never write `projectLedger` from the ERP — only the server functions and the job SQL do.
- Never update a Posted `timesheetEntry` — use `createTimesheetCorrection`.
- Never write a bare PostgREST embed from `job` or `purchaseOrderLine` — name the FK
  (`item!job_itemId_fkey`). The project FKs push bare embeds past TS2589.

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
| `get_project_cost_summary` (RPC) | Plan, committed and actual per element |

## Key Service Functions
- `getChargeNumbers` — Released projects and chargeable elements for the picker.
- `getProjectCostSummary` + `rollUpCostSummary` / `buildProjectCostFigures` — the Costs tab.
- `getProjectElementPage` (`.server`) — everything the element page loads, in parallel.
- `logTimesheetEntry` (`.server`) — Log time: one Submitted row; the route posts it when approval is off.
- `upsertTimesheetCell`, `submitTimesheetEntries`, `approveTimesheetEntries`,
  `rejectTimesheetEntries`, `createTimesheetCorrection` — the timesheet flow.
- `updateProjectStatus` — refuses Close while a PO or job of the project is open.

## Related Modules
- **production** — `job.projectId/projectElementId/consumeToProject`; `getJobProjectCharge`.
- **purchasing / invoicing** — charge number on PO and invoice lines; `getLineChargeNumber`.
- **accounting** — `Project` and `ProjectElement` dimensions; account defaults Project WIP and
  Project Expense; journal sources `Timesheet` and `Project Issue`.
- **MES** — `apps/mes/app/services/projects.service.ts` copies the timesheet functions.

## Rules References
- `.claude/rules/projects-system.md` — posting, charge gates, ids, consume-to-project jobs.
- `.claude/rules/accounting-sync-handlers.md` — how the new journal sources sync.
- `.claude/rules/database-patterns.md` — Kysely transactions and server functions.
