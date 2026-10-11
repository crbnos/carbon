---
paths:
  - "packages/utils/src/timekeeping.ts"
  - "packages/utils/src/contract-funding.ts"
  - "packages/server-functions/src/save-timesheet-entry/**"
  - "packages/server-functions/src/submit-timesheet-week/**"
  - "apps/erp/app/modules/projects/ui/Timesheet/**"
---

# Government contracting (Phase 5a)

The accounting system a pre-award survey (SF 1408) checks: cost objectives,
unallowable cost, DCAA timekeeping, dilution, labor distribution, CLIN and ACRN
funding, and the reports. Spec `.ai/specs/2026-10-09-government-contracting.md`;
plan `.ai/plans/2026-10-09-government-contracting-phase-5a.md` (decisions P1–P10 and
an *Execution notes* entry for every deviation). 5a is community code: nothing is in
`packages/ee`. Phases 5b (indirect rates), 5c (control, earned value) and 5d (R&D tax)
are not built.

## Off by default

Every timekeeping control waits for `companySettings.timekeepingControls = 'DCAA'`
(enum `timekeepingControls`: Standard, DCAA; default Standard). In Standard mode each
timesheet path keeps its Phase 1a behavior, and the tests pin that per path. Settings →
Timekeeping (`x+/settings+/timekeeping.tsx`, `updateTimekeepingSettings`) holds the
mode and these `companySettings` columns:

| Column | Default | Used by |
|---|---|---|
| `timesheetEntryWindowDays` | 1 | `isEntryDateAllowed`: an older entry needs a late reason |
| `timesheetTimecardCheck` | Warn | `submit-timesheet-week`: Off, Warn or Block on a timecard shortfall |
| `certificationTextExempt` / `certificationTextNonExempt` | null | The certification dialog; `timekeepingSettingsValidator` requires both in DCAA mode |
| `standardWeeklyHours` | 40 | `dilutionFactor` |

Turning DCAA on is refused while a Released Standard project has no
`costObjective` ("Set a cost objective on N projects first"). A Service project has no
cost objective field, so it is not counted.

Unallowable cost, cost objectives, CLIN numbers and funding actions work in both modes.
In DCAA mode the funding actions own the line's funded totals (below).

## Cost objectives and unallowable cost

- `project.costObjective` (`projectCostObjective`: Direct, IR&D, B&P, Indirect,
  Commercial). An Expense project takes IR&D, B&P or Indirect
  (`project_costObjective_treatment_check`, `costObjectivesForTreatment`). In DCAA mode
  both project save actions refuse an empty one (`COST_OBJECTIVE_REQUIRED`).
- `account.allowability` (`accountAllowability`: Allowable, Expressly Unallowable,
  Mutually Agreed Unallowable, Directly Associated Unallowable), `unallowableReason`
  and `elementOfCost` (Labor, Material, Subcontract, Other Direct, Travel), on posting
  accounts only (`ChartOfAccountForm`). `accountValidator` keeps all 3 optional with no
  default, so a form or MCP call without them does not reset an unallowable account.
- `projectElement.isUnallowable`, `isPreproduction`, `isLeave` (P1: a leave element
  needs an Indirect project). The element sidebar shows the switches; a Parameter
  element shows none.
- `isUnallowableCharge(ctx, accountId)` (`lib/project-posting.ts`) is true when the
  account is not Allowable or the element or an ancestor is unallowable. Every posting
  path stamps `projectLedger.unallowable` with it; a reversal copies its original's
  flag. The ledger keeps the flag, so a later account edit never changes history.
- An unallowable row creates no billable item (`buildContractBillableItem` and the
  Cost Plus generator skip it).
- `get_project_cost_summary` returns `actualUnallowable`; the Costs tab shows Allowable
  and Unallowable columns, and `preproductionActual` counts a preproduction subtree
  once.

## DCAA timekeeping

The pure rules are in `@carbon/utils` (`timekeeping.ts`): `isEntryDateAllowed` (no
future date unless the element is leave; older than the window is `late`),
`nextEntryStatus`, `weekStartOf` (ISO Monday), `dilutionFactor`,
`timecardShortfall`. Both server functions below use them; the ERP and the MES call the
server functions, so the rules live in one place (P9).

**`save-timesheet-entry`** (`update: projects`). `mode: "cell"` edits the one entry of
a cell; `mode: "add"` always inserts (Log time, service time). In DCAA mode
`checkDcaaEntry` applies the window, the future-date rule, the late reason
(`lateReason`, P2) and the charge restriction. A change by anyone but the owner needs
`reason`, writes a `timesheetEntryRevision` (before, after, who, when, why) and sets
the entry to `Pending Employee Review`; another user may add time only on a day of
recorded absence (`peopleAbsence`). The owner's own Log time entry is saved as Draft,
so it waits for the weekly certification. A refusal is a `ServerFnError` with status
422 (`TIMESHEET_FUTURE_DATE`, `TIMESHEET_LATE_REASON_REQUIRED`,
`TIMESHEET_CHANGE_REASON_REQUIRED`, `TIMESHEET_SUPERVISOR_ENTRY_REFUSED`,
`TIMESHEET_HOURS_REQUIRED`).

**`submit-timesheet-week`** (`update: projects`) submits the week's Draft entries of
Standard projects. In DCAA mode it first refuses a week with a Pending Employee Review
entry, runs the timecard check (closed `timeCardEntry` hours with `clockIn` in the week
on the company's calendar, against all the week's entry hours), refuses a certification
text that is not the current one, and writes a `timesheetCertification` row
(`textHash` = SHA-256, `certificationTextHash`). The table has no unique key; the latest
row of a week is current (P6).

`timesheetEntryRevision.timesheetEntryId` has no FK, so the trail outlives a deleted
Draft entry (P5). Its RLS lets the owner (`employeeId`) or a `projects_view` user read;
nobody writes it through PostgREST. `timesheetCertification` has the same rule.

UI (`ui/Timesheet/`): `TimesheetChangeModal` (the change and late reasons),
`CertificationModal` (**Certify and Submit**), `TimesheetReviewBanner` (**Accept
changes**, `acceptTimesheetReview`), `TimesheetRevisionsPopover`. A manager edits on
`x+/projects+/timesheets.$employeeId.tsx` (`path.to.employeeTimesheet`); access is the
employee's manager or `update: projects` (`canManageTimesheet`). In Standard mode the
server refuses another user's save, so that page is read-only.

## Charge restrictions

`project.restrictCharging` with `projectMember` rows (project Settings tab,
`ProjectMembers`). `assertChargeable(ctx, mode, timeEmployeeId)` refuses time from a
non-member. `post-timesheet` passes the employee only in DCAA mode and only for a new
entry; a reversal is never refused.

## Dilution

In DCAA mode an `Exempt` employee's week (`employeeJob.flsaStatus`) posts at factor
`min(1, standardWeeklyHours ÷ week hours)` (`planDilution`, `post-timesheet/plan.ts`).
`timesheetEntry.dilutionFactor` stores the factor an entry posted at (P4, null = 1). A
later correction re-dilutes the week's other posted entries and posts the difference
(`planRedilutionPostings`) in the same transaction. A dilution adjustment changes cost,
never hours, so it adds no Time & Materials billable item.

## Labor transfers

A correction whose charge number changes (P3): the replacement carries
`correctionOfId`. In DCAA mode `assertCanApprove` refuses the requester as approver
(`LABOR_TRANSFER_SAME_APPROVER`), the approvals action counts the reversal as part of
the transfer (`laborTransferRefusal`), and a transfer never posts without approval, even
with approvals off. The approvals list shows a **Transfer** badge.

## Payroll totals

`payrollPeriodTotal` (employee, `periodStart`, `periodEnd`, `grossWages`, `hoursPaid`;
unique per employee and period) is filled by the CSV import wizard (P8): import key
`payrollPeriodTotal`, permission `people`, importer
`import-csv/payroll-total-import.ts` (`readPayrollTotalRow`, `importPayrollTotals`;
an upsert per employee and period, a repeated row in one file is skipped). List: People
→ Payroll Totals (`x+/people+/payroll-totals.tsx`).

## Missing time

pg_cron `timesheet-missing-time-sweeper` (`0 12 * * *`) runs
`util.sweep_timesheet_missing_time()`, which sends `carbon/timesheet-missing-time.process`
while `util.timesheet_missing_time_has_work()` finds a DCAA company. The function
`timesheetMissingTimeFunction` (`scheduled/timesheet-missing-time.ts`) reads yesterday on
each company's calendar through `get_missing_timesheet_days` (shift days of active
employees, minus holidays, absences and days with any entry) in one query, and sends
`NotificationEvent.TimesheetMissing` to the employee and one notice per manager.

The close checklist task **Timesheets complete** (`timesheets-complete`, Warning) counts,
in DCAA mode, the period's entries that are not Posted plus its missing days.
`getTimesheetCloseReadiness` (`@carbon/database/timesheet-readiness`) reads with the
privileged Kysely client, so the count does not depend on the closing user's access.

## CLIN and ACRN funding

- `customerContractLine.lineItemNumber` (`^[0-9]{4}([A-Z]{2}|[0-9]{2})?$`) and
  `parentLineId`; `parseLineItemNumber` (CLIN, priced SLIN, informational SLIN). A
  SubCLIN's parent is a CLIN of the same contract with the same first 4 digits.
- `customerContractFunding`: funding actions of a billing line (P10), each with
  modification number, date, ACRN, funded cost, funded fee and expiry
  (`ContractFundingActions`, route `$id.$lineId.funding-actions.tsx`). In DCAA mode
  `syncContractLineFunding` writes the line's `fundedCost` and `fundedAmount` as their
  sums (`sumFunding`), and the line form stops writing them.
- A Cost Plus or Time & Materials invoice with numbered lines gets a Comment line per
  CLIN and `salesInvoiceFundingAllocation` rows (P7): `planClinSections` and
  `acrnPositions` (`create-project-billing-invoices/clin.ts`) allocate each CLIN's amount
  oldest funds first (`allocateToAcrns`), net of the allocations of invoices that are not
  Voided.

## Reports

Projects → Reports (`x+/projects+/reports.tsx`) links to
`api+/projects.reports.$reportKey[.]csv.ts` (`projectReportKeys`). The reads take the
Kysely client, so the route's permission check is the gate: `view: projects` for late
entries, missing time, labor transfers and the timesheet audit export;
`projects` + `people` for labor distribution (by accounting period); `sales` for cost by
CLIN. `buildLaborDistribution` puts allowable dollars in Direct (Direct, Commercial),
Indirect (Indirect, IR&D, B&P) or Unclassified, unallowable dollars in Unallowable, and
reconciles each employee's hours to timecards and dollars to payroll ("No payroll
imported" when there is none).

## Known gaps

- The browser verification of the plan (Task 35) is deferred.
- The report reads load each report in one query and stream the encoded CSV in pages;
  they do not page the reads with a cursor as the Sync Activity export does.
