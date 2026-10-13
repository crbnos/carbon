---
paths:
  - "packages/utils/src/timekeeping.ts"
  - "packages/utils/src/contract-funding.ts"
  - "packages/utils/src/rd-tax.ts"
  - "packages/server-functions/src/save-timesheet-entry/**"
  - "packages/server-functions/src/submit-timesheet-week/**"
  - "apps/erp/app/modules/projects/ui/Timesheet/**"
---

# Government contracting (Phases 5a and 5d)

The accounting system a pre-award survey (SF 1408) checks: cost objectives,
unallowable cost, DCAA timekeeping, dilution, labor distribution, CLIN and ACRN
funding, and the reports. Spec `.ai/specs/implemented/2026-10-09-government-contracting.md`;
plan `.ai/plans/2026-10-09-government-contracting-phase-5a.md` (decisions P1–P10 and
an *Execution notes* entry for every deviation). 5a is community code: nothing is in
`packages/ee`. Phase 5b (indirect rates and burden, commercial) has its own rule:
`indirect-rates.md`. Phase 5c (budget control, earned value, stop-work orders,
commercial) has its own rule: `project-control.md`. Phase 5d (R&D tax, community; plan
`.ai/plans/2026-10-09-government-contracting-phase-5d.md`, decisions D1–D10) is the
*R&D tax* section below. Contract financing (progress payments, PBP, liquidation)
has its own rule: `contract-financing.md`.

## Off by default

Every timekeeping control waits for `companySettings.timekeepingControls = 'DCAA'`
(enum `timekeepingControls`: Standard, DCAA; default Standard). In Standard mode each
timesheet path keeps its Phase 1a behavior, and the tests pin that per path. Settings →
Time (`x+/settings+/time.tsx`; `/x/settings/timekeeping` redirects there;
`updateTimekeepingSettings`) holds the
mode and these `companySettings` columns. The page uses the `SettingsPage` /
`SettingsPageHeading` shell, like Settings → Inventory: a Controls card, then a DCAA
rules card. One `ValidatedForm` spans both cards, because the action saves every field
at once. The DCAA rules card follows the Controls picker before a save and is only
hidden (not unmounted) under Standard, so its fields still post.

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

**Where the fields show.** A company that does not use government contracting does
not see its fields. `useGovernmentContracting()`
(`apps/erp/app/modules/projects/ui/useGovernmentContracting.ts`) is true when
`timekeepingControls = 'DCAA'` or the company has the `GOVERNMENT_CONTRACTING` feature
(`usePlanGate`). It is display only; the server gates stay. Its callers: Cost Objective
in `ProjectForm` (the New Project drawer and the project Settings page; when hidden, a
`Hidden` field posts the saved value or the default), the Funding Actions card on a
contract line's billing page (also shown when DCAA owns the totals or the line has
actions), and People → Payroll Totals in the sidebar. The element page does not use
it: its Government contracting group shows only under DCAA (below).

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
  needs an Indirect project). The element page (`ElementSidebar`) shows the switches in
  its Government contracting group, with the charge number, the business component
  fields and earned value. The group shows only with `timekeepingControls = 'DCAA'` and
  the feature; with DCAA on and the feature gated, only earned value's locked row shows.
  A Parameter element shows none.
- `isUnallowableCharge(ctx, accountId)` (`lib/project-posting.ts`) is true when the
  account is not Allowable or the element or an ancestor is unallowable. Every posting
  path stamps `projectLedger.unallowable` with it; a reversal copies its original's
  flag. The ledger keeps the flag, so a later account edit never changes history.
- An unallowable row creates no billable item (`buildContractBillableItem` and the
  Cost Plus generator skip it).
- `get_project_cost_summary` returns `actualUnallowable`; the Costs page shows Allowable
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

`project.restrictCharging` with `projectMember` rows (project Settings page;
`ProjectMembers` shows while `restrictCharging` is on).
`assertChargeable(ctx, mode, timeEmployeeId)` refuses time from a non-member. `post-timesheet` passes the employee only in DCAA mode and only for a new
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
→ Payroll Totals (`x+/people+/payroll-totals.tsx`); the sidebar lists it only when
`useGovernmentContracting()` is true.

## Missing time

pg_cron `timesheet-missing-time-sweeper` (`0 12 * * *`) runs
`util.sweep_timesheet_missing_time()`, which sends `carbon/timesheet-missing-time.process`
while `util.timesheet_missing_time_has_work()` finds a DCAA company. The function
`timesheetMissingTimeFunction` (`scheduled/timesheet-missing-time.ts`) reads yesterday on
each company's calendar through `get_missing_timesheet_days` (shift days of active
employees, minus holidays, absences and days with any entry) in one query, and sends
`NotificationEvent.TimesheetMissing` to the employee and one notice per manager.

`get_missing_timesheet_days` (redefined in `20261012193140_missing-time-population.sql`)
is the one definition of the population, so the daily notice, the report and the close
check agree. It lists a shift day of an active employee only when:
`employeeJob.timesheetRequired` is on (default true; no job row counts as on), the day
is on or after `employeeJob.startDate`, the day has ended (never after
`company_today - 1`), and the day has no holiday, absence or entry. Research:
`.ai/research/missing-time-report.md`.

**Projects → Reports → Missing Time** (`reports.missing-time.tsx`) reads
`getMissingTimeByEmployee`: one row per employee with the missing dates
(`array_agg`), filtered in the loader by `search` and `filter=` on `employeeId`,
`managerId`, `departmentId` and `locationId`. Its action has three intents
(`missingTimeActionValidator`): `remind` sends `TimesheetMissing` to each selected
employee with the dates re-read from the database; `exclude` and `include` set
`timesheetRequired` through `updateTimesheetRequired` and need `update: people`.
`?excluded=true` lists the active employees with it off. The CSV stays one row per day.

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
  (`ContractFundingActions`, an inline-edit grid on the line billing page; route
  `$id.$lineId.funding-actions.tsx`). In DCAA mode
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

## R&D tax (Phase 5d)

Community code, no feature gate. The tags are columns
(`20261012005354_rd-tax-enums.sql`, `20261012005458_rd-tax-columns.sql`):

| Column | Meaning |
|---|---|
| `projectElement.isBusinessComponent`, `rdComponentType` (Product, Process, All Others), `rdSoftwareType` (Internal Use, Dual Function, Non-Internal Use, Excepted) | A business component; `projectElement_rdComponent_check` keeps the 2 types only on one |
| `timesheetEntry.rdActivityRole` (enum `rdActivityRole`: Direct Research, Direct Supervision, Direct Support, Not Qualified), `workLocationId` | The time's research role and where it took place; the FK is composite to `location ("id", "companyId")` |
| `laborCategory.rdActivityRole` | The default role of the category's time |
| `customerContract.researchFunded` (null = default), `paymentContingentOnSuccess`, `contractorRetainsRights` | Funded research (§41(d)(4)(H)) |
| `employeeJob.isOfficer` | Form 6765 Section E, line 38 |

**Defaults.** `save-timesheet-entry` resolves both fields before the cell lookup
(`resolveRdDefaults`): a field the input leaves out takes the employee's
`employeeJob.locationId` and the labor category's role; an explicit null is none. Both
are part of the cell's key, so two entries on one day may differ only by location or
role. A DCAA revision records both. `createTimesheetCorrection` copies both to the
reversal and the replacement (unless the correction names new values). Both grids
group rows by those two fields too and post each row's own values (`""` for none),
so a save edits the row's own entry. A new row starts at the defaults (the job
location and the category's role): the ERP from Add row, the MES from the loader's
`jobLocationId` and the category's `rdActivityRole`. Add row on My Time has a **More**
toggle with **Work location** and **Research role**.

**Pure rules** (`@carbon/utils` `rd-tax.ts`, pinned by `rd-tax.test.ts`):
`workCountryClass` (US, PR, GU, VI, AS, MP, UM are Domestic, D1; no code is Unknown,
D2), `taxYearBounds` (twelve months from the tax start month, named by the year it
starts in, D9), `isFundedResearch` (D10), `wageQres` (80 % or more of the hours
qualified counts all the wages), `section6765Rows` (descending QRE, rows while fewer
than 50 and below 80 % of the total, then one aggregate row named exactly
`SECTION_G_AGGREGATE_NAME`, "Aggregate Business Components"; contract research at
65 %), `section6765FilingRows` (the filing boundary: columns 50–52 and 54–56 rounded
to whole dollars with `irsWholeDollars` / `IRS_WHOLE_DOLLAR_SCALE = 0`, then 53, the
total and a Total row added from the rounded values; the Total row sums every row,
the aggregate row included, and feeds Section F lines 42–45) and
`section6765OfficerWages` (line 38 in whole dollars, capped at the Total row's
column 53).

**Reports** (`rd-section-174a`, `rd-form-6765-g`; `view: projects` and
`view: accounting`; query `taxYear`). `getRdLedgerRows` is one query: a recursive CTE
gives each ledger row its business component, down to the next one (D5); the work
country is the entry's work location for a Timesheet row, else the project's
location (D3); funded research is computed in SQL for Direct projects (D10).
`getRdEmployeeYear` gives Posted hours, payroll gross wages (null with none, D4) and
the Labor ledger amount per employee. The pure builders are in `projects.models.ts`:
`buildSection174ARows` (Domestic, Foreign, Unknown; Burden apart and out of the total;
"Of which funded", D6) and `buildSection6765Input` (qualified hours from Timesheet rows
that are qualified, unfunded and Domestic; supplies from Material rows; contract
research from Outside Processing and Purchased Service rows; computer rental 0, D7).
The Section G CSV writes column 53 as the sum of 50–52 (D8, confirmed against Form
6765 Rev. 12-2024 and its 12/2025 instructions). It has 49(a)–(f): 49(a) is the
company EIN on component rows only (the aggregate and Total rows leave 49(a), (b),
(d), (e) and (f) blank), 49(b) and 49(f) are always blank, and 49(e) takes the IRS
text from `rdSoftwareTypeIrsText` (`projects.models.ts`). Column 56 is "Applicable
Contract Research": 65 % of every Outside Processing and Purchased Service cost.
The notes after the rows: officers' wage QREs, the Total row, whole dollars, the
aggregate count, 49(b) (PBA code), 49(f) (amended returns only), column 55, the
65 % caveat for column 56 (75 % consortium, 100 % energy research, basic research to
line 46), Reg. §1.41-2(e) for contract research, depreciable property in column 54,
the estimated-wage count with the W-2 caveat, the hours of an unknown country. A
supplier-level contract research rate and a PBA code field need a schema change.

## Known gaps

- The browser verification of the plan (Task 35) is deferred, and so is 5d's (Task 16).
- The `customerContracts` view predates the 3 research columns; the contract page
  reads them from the table.
- The report reads load each report in one query and stream the encoded CSV in pages;
  they do not page the reads with a cursor as the Sync Activity export does.
