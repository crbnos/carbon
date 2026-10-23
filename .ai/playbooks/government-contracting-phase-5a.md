# Government Contracting Phase 5a (DCAA timekeeping, unallowable cost, funding)

Last tested: 2026-10-12
Routes: /x/settings/timekeeping, /x/timesheet?week=N, /x/projects/approvals,
/x/projects/timesheets/:employeeId, /x/projects/reports/{late-entries,labor-distribution,labor-transfers},
/x/people/payroll-totals, /x/accounting/charts, /x/project/:id/{settings,costs},
/x/contract/:id/:lineId/billing, /x/person/:id/job, /x/projects/labor-categories

## Prerequisites
- Satellite dataset company, accounting on. Today in the run was Mon 2026-10-12
  (`?week=0` = Oct 12, `-1` = Oct 5, `-2` = Sep 28, `-3` = Sep 21).
- DCAA refuses to turn on while a Released Standard project has no cost objective
  ("Set a cost objective on 3 projects first"). Set one on each in the project's
  Settings → Accounting → Cost Objective (Expense projects take IR&D/B&P/Indirect),
  then requestSubmit the form whose action ends in `/details`.
- An exempt employee: Person → Job → FLSA status combobox (the empty one after
  Manager) → Exempt → Save.
- A labor category at 60.00: Projects → Labor Categories → "Add Labor Category"
  (a link; open it by clicking, the `/new` URL loaded directly may not render the
  drawer) → Name → Save (submit button uses `form=` attr) → then in the edit drawer
  Rates → "New" row → click "Enter a rate" cell, fill, press **Tab** (Enter does not
  save the draft row) → edit the date cell the same way (Tab commits).
- A second user for the manager-edit and labor-transfer flows: Users → Employees →
  new (email, names, Employee Type Admin) → Invite. Log the user in a SECOND
  agent-browser session: request a magic link at /login, read it from Inbucket
  (`docker port <stack>-inbucket-1` → `GET :PORT/api/v1/mailbox/<local-part>`), open
  it, then open `/invite/<invite.code>` and click "Join <company>". Set the user's
  Manager (Person → Job) to the manager.
- An Active contract with Cost Plus lines carrying CLINs (see contracts.md; Billing
  Method = Cost Plus, CLIN / SLIN textbox, Billing Element combobox lists only
  elements with the element switch "Billing element" on).

## Steps
### 1. DCAA on — /x/settings/timekeeping
Controls combobox → DCAA; the DCAA rules card appears: Entry window 1, Timecard
check → Block, both certification textareas filled → requestSubmit "Save".
Toast "Timekeeping settings updated".

### 2. Late entry + future date — /x/timesheet?week=-1
Click the day cell, fill the textbox, press Tab → dialog "Late Entry". Saving with
an empty reason shows "Give a reason for the late entry" (the label says Optional,
but it is required). Fill the reason → requestSubmit "Save". Report: Projects →
Reports → Late Entries (range defaults to the current period). Tomorrow's cell opens
no editor; a POST to `/x/timesheet/update` with tomorrow's date answers 400 "Time
cannot be entered for a future date".

### 3. Certification — Submit week
"Submit week" → dialog "Certify and Submit" quoting the exempt/non-exempt text →
tick "I certify this statement" → requestSubmit "Certify and submit". Row in
`timesheetCertification` (employeeId, certifiedAt, textHash = SHA-256 of the text).

### 4. Correction trail — change a saved Draft cell
Edit the cell (6 → 4), Tab → dialog "Change Time" → reason → Save. Row in
`timesheetEntryRevision` (before/after/revisedBy/revisedAt/reason).

### 5. Manager edit — /x/projects/timesheets/:employeeId (as the manager)
Edit the employee's cell → "Change Time" reason → entry goes Pending Employee
Review. The employee sees the banner "1 change to your timesheet waits for your
review" with "Accept changes"; submit is refused ("Review the changes to your
timesheet first"). After Accept the entry is Draft and posts on submit.

### 6. Timecard Block — submit a week whose entries are under its timecards
Flash "Your entries account for 26.5 h of 43.85 h on your timecards"; nothing
submitted, no certification row.

### 7. Dilution — 50 h at 60.00 for an exempt employee in one week
Posted rows: 5 × 10 h × 48.00 = 2,400.00, `dilutionFactor` 0.8.

### 8. Unallowable
Chart of Accounts → "Add Account" (Operating Expenses group, Allowability →
Expressly Unallowable, Unallowable reason) → Save. Set it as the project's Cost
Account (Settings → Accounting; type the number into the combobox to filter),
post one entry, clear the account again. `projectLedger.unallowable = true`; the
line's "Generate Billable Items" creates items for the allowable rows only; Costs
tab shows it in the Unallowable column.

### 9. Funding by ACRN — contract line Billing tab
"Add Funding" adds a grid row; click a cell, fill its textbox, Tab (Modification,
ACRN, Funded Cost). 50,000 + 30,000 → line fundedCost 80,000. The project billing
invoice is drafted only by the `recurring-billing` Inngest cron (no UI button):
invoke it from the Inngest dev server (`mutation { invokeFunction(functionSlug:
"carbon-recurring-billing", data: {}) }` on `/v0/gql`). The invoice has one line
per CLIN, each preceded by "CLIN 0001 — <description>: <amount> (ACRN AA <amount>)".

### 10. Labor transfer — My Time row "Action Menu" → "Correct <day>"
Switch "Move to another charge number" → Charge Number → Reason → "Submit
Correction". Approving as the requester flashes "A labor transfer needs an
approver other than the requester"; the second user's Approve posts it. Shows on
Reports → Labor Transfers.

### 11. Labor distribution — Reports → Labor Distribution
Payroll Totals: People → Payroll Totals → "Table actions" (⋮) → "Import Payroll
totals CSV" → upload a CSV with Employee, Period Start, Period End, Gross Wages,
Hours Paid (at least 2 data rows) → Next → **click** "Confirm Import" (a
requestSubmit did not import). "Download CSV" →
`/api/projects/reports/labor-distribution.csv?periodId=...` with Gross Wages and
Dollars Difference on the Total row.

### 12. Standard mode — Controls → Standard → Save
During the run the settings page moved: `/x/settings/timekeeping` now lands on
`/x/settings/time` (toast "Time settings updated"). In Standard mode a late cell and
a changed cell save with no dialog, the week button reads "Post", and it posts with
no certification dialog ("Week submitted and posted"); no revision or
certification row is written.

## Selector Notes
- Dialogs (Late Entry, Change Time, Certify and Submit, Add Row) appear in the full
  `snapshot`, not in `snapshot -i`.
- Grid cells: click the cell, the textbox appears inside it; Tab commits.
- The revision popover (history icon) opens only on a cell that is NOT editable:
  first click selects the cell, the second opens the popover.

## Common Failures
- Other agents editing code trigger Vite HMR; the page silently loses React
  (no `__react*` keys on nodes) and clicks do nothing. Reload and wait for ≥50%
  React-managed nodes before acting.
- "Approve all" on the Approvals page approves nothing when a group has more than one
  entry, yet flashes "Time approved and posted" — approve rows one by one.
