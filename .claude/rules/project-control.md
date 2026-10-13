---
paths:
  - "packages/ee/src/project-control/**"
  - "apps/erp/app/routes/x+/purchase-order+/$orderId.new.tsx"
  - "apps/erp/app/routes/x+/purchase-order+/$orderId.$lineId.details.tsx"
  - "apps/erp/app/routes/x+/purchase-order+/$orderId.finalize.tsx"
  - "apps/erp/app/routes/x+/projects+/issue.tsx"
  - "apps/erp/app/routes/x+/job+/new.tsx"
  - "apps/erp/app/routes/x+/job+/$jobId.details.tsx"
  - "apps/erp/app/modules/projects/ui/Costs/ProjectEarnedValue.ee.tsx"
---

# Project control (Government Contracting Phase 5c)

Budget control, earned value, the ACWP export and stop-work orders. Spec
`.ai/specs/implemented/2026-10-09-government-contracting.md` (Phase 5c, decisions C1–C17);
plan `.ai/plans/2026-10-09-government-contracting-phase-5c.md` (its *Execution
notes* record every deviation). Commercial: feature key `GOVERNMENT_CONTRACTING`.
The engine is in `packages/ee/src/project-control/`: `@carbon/ee/project-control`
(pure `compute.ts`, validators and types in `models.ts`) and
`@carbon/ee/project-control.server` (`service.server.ts`, `loaders.server.ts`).

## Gating

| Function | Gate |
|---|---|
| `checkBudgetAvailability`, `checkTimesheetBudget` | DEGRADE: without the feature, status `ok` and no reads |
| `getEarnedValue` | DEGRADE: `{ gated: true }` |
| `updateProjectControlSettings`, `updateElementEarnedValue`, `closeEarnedValuePeriod`, `buildAcwpExport`, `stopWork` | LOCK: `requireEntitlement` first |
| `resumeWork` | none, so a company that loses the feature can still release a stopped project |

The write routes call `requireFeature` and catch `EntitlementError`. The UI is
`.ee.tsx`. A gated company sees one compact upgrade row, not a full overlay:
`ProjectControlSettings` (project Settings page, `UpgradeOverlayRow`),
`ElementEarnedValue` (element page, a locked row), `ProjectEarnedValue` (Costs page,
`UpgradeOverlayRow`). `StopWorkModal` (header ⋯ menu) opens an upgrade dialog.

Where earned value shows (Layer 5 of the UI rebuild):

- **Costs page** (`$projectId.costs.tsx`, `loadEarnedValue`): only when the project has
  an element with `isControlAccount`. Without one the loader returns null before it
  checks the feature, so a company without the feature sees the upgrade row only on a
  project with a control account.
- **Element page** (`ElementSidebar`, the properties column of
  `$projectId.element.$elementId.tsx`): only with
  `companySettings.timekeepingControls = 'DCAA'`, and never on a Parameter. With the
  feature it sits in the Government contracting group; with DCAA on and the feature
  gated, only its locked row shows. The form keeps its **Save** button (no autosave):
  its fields depend on each other (control account and manager, technique and percent,
  base and factor) and the validator checks them together. The page route's action
  calls `updateElementEarnedValue`.

## Budget control

`project.budgetControl` (None, Warn, Block) and `budgetTolerancePercent` (a
fraction; null reads as 0). The check compares the nearest budgeted element (or
ancestor; a budget of 0 is a budget) with its commitments plus its direct actual
cost plus the new amount (C2, C3). It reads 5 grouped Kysely queries over every
charged project, never one RPC per project: projects, elements, open PO lines,
ledger cost without Burden rows, and Soft or Manual `projectPeg` rows on open PO
lines (as `get_project_cost_summary` counts them). A saved PO line's own
commitment is left out (`excludePurchaseOrderLineIds`).

Where it runs, through `checkProjectBudget` (`projects.server.ts`):

- PO line save (`$orderId.new.tsx`, `$orderId.$lineId.details.tsx`) and PO
  finalize (`$orderId.finalize.tsx`);
- Issue to Project (`projects+/issue.tsx`);
- a consume-to-project job (`job+/new.tsx`, `$jobId.details.tsx`): quantity ×
  `itemCost.unitCost`, less the job's ledger cost already posted (C5).

Block refuses the save; Warn saves and adds the overrun to the flash (C4).

**A timesheet is never refused for budget** (DCAAM 7641.90 §3.c(2); CAM
6-404.6(10)). `checkTimesheetBudget` costs hours at the labor category rate on the
entry date. Warn and Block both give a warning; Block also sends
`NotificationEvent.ProjectBudgetExceeded` to the project owner. Each app wraps it
in a `timesheetBudgetWarning` that never throws (ERP `projects.server.ts`, MES
`services/project-budget.server.ts`). The callers are My Time
(`timesheet.update.tsx`), Log time, the manager edit route
(`timesheets.$employeeId.tsx`), service time (`service-order+/$id.charge.tsx`,
checked after the save and before the entry posts) and the MES timesheet.

## Earned value

- A **control account** is an element with `isControlAccount` (and an optional
  `controlAccountManagerId`). It takes no technique (CHECK).
- A **work package** is a chargeable element with an `earnedValueTechnique` whose
  nearest ancestor is a control account (C7). `updateElementEarnedValue` refuses a
  technique on any other element and clears the fields the technique does not use.
- **BAC** is the work package's `budget` in the latest baseline with
  `formatVersion ≥ 2` taken on or before the date (C6). The baseline's `schedule`
  holds each element's `startDate` and `targetDate`. A project with work packages
  and no such baseline gets the warning "Take a baseline first" and no rows.

| Technique | BCWS | BCWP |
|---|---|---|
| 0/100 | all at the baseline end | all on Completed |
| 50/50 | half at the start, half at the end | half on Started, all on Completed |
| Percent Complete | spread by day | BAC × `earnedValuePercent` (a fraction, C8) |
| Milestone | each child's baseline `budget` at its baseline `targetDate` | the children in state group Completed (C9) |
| Level of Effort | spread by day | equals BCWS |
| Apportioned | spread by day | `apportionedFactor` × the base element's BCWP |

A Milestone work package with no budgeted child behaves as 0/100. A linear
package with its end before its start uses 0/100. ACWP is the DIRECT ledger cost
of the work package's subtree; `acwpByElement` keeps all 6 elements of cost,
burden included, for the export (C11: Labor; Material, Material Variance and
Payback Variance → Material; Outside Processing and Purchased Service →
Subcontract; Machine, Overhead, Other Direct → Other Direct; Burden → G&A for a
G&A pool, else Overhead). EAC = ACWP + (BAC − BCWP) ÷ CPI; with no CPI (or CPI
0), EAC = BAC (C17).

## The period snapshot

`closeEarnedValuePeriod` (close page **Close Earned Value**, Locked periods only)
replaces the period's `earnedValuePeriod` rows: one per work package of every
Released, On Hold or Technically Complete project, cumulative to the period end.
The trigger `check_earned_value_period_open` reads the period `FOR SHARE` and
refuses any write to a Closed period, so a close waits behind an in-flight
snapshot and the rows never change after it (C13, EIA-748 E24). The close task
"Close earned value for the period" (`earned-value-closed`, Warning) counts the
projects with a work package and no snapshot for the period (C14).

The snapshot FKs to the work package and the control account have no ON DELETE
action. `deleteProjectElement` and the change request apply refuse such a delete
first (`elementDeleteRefusal`). A hard delete of a project with a Closed-period
snapshot raises "…cannot be deleted. Deactivate it instead."

## Material point of measurement

`project.materialMeasurementPoint` is Receipt (default) or Issue (C12). Issue
matters only with `chargeAtReceipt`: `loadAcwp` holds back the project's Purchase
Receipt Material rows (not voided) until project-stock issues consume them, first
in first out by quantity (`holdUntilIssued`). The issues are the project stripe's
`itemLedger` Project Issue and Job Consumption rows, netted per item and day.

## The ACWP export

`api+/earned-value.acwp[.]csv.ts` (`path.to.api.earnedValueAcwpCsv`), shown as
**Export ACWP** on the Costs page for a Closed period. `buildAcwpExport` refuses an
Open or Locked period (C15). One row per charge number × element of cost, Direct
or Burden, hours on Labor rows. Without `projectId` it covers the Direct cost
objective projects.

## Stop-work orders

**Stop work** (`$projectId.stop-work.tsx`, intent `stop`) needs a Released Direct
project and sets On Hold with `stopWorkDate`; **Resume** (intent `resume`) clears
it and sets Released (C16, FAR 52.242-15). The CHECK `project_stopWork_check`
keeps `stopWorkDate` only on an On Hold project, and `updateProjectStatus`
refuses any other status while it is set (`stopWorkStatusRefusal`), so the status
menu and the MCP tool cannot bypass Resume. The header shows the order date, the
90-day end (`stopWorkEnd`) and the days left (`stopWorkDaysLeft`).

On Hold refuses new charges in two places: the charge-number picker lists only
Released projects, and `save-timesheet-entry` (`assertProjectTakesTime`) refuses
more hours on a row an On Hold project already has on a timesheet. Fewer hours
is a correction and is allowed.

## Known gaps

- Browser-verified 2026-10-12 (playbook `government-contracting-phase-5c.md`). Not verified
  in the browser: the snapshot freeze at period close and the Community upgrade overlay.
- On an Issue project, a receipt Material row of an item that never goes through
  project stock is never recognized.
- CPI and SPI show up to 5 decimals (`useQuantityFormatter`).
- The satellite dataset seeds ORBSEC Block 2's baseline 1 with work package
  budgets and dates; the other datasets seed no baseline.
