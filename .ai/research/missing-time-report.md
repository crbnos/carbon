# Missing Time Report Research: Best Practices Survey

## Summary

This survey covers how 10 timekeeping products keep a missing-time report useful. It asks 6 questions: who must record time, what one row is, which days count, the filters, the actions, and the term. The products agree on 5 points:

1. The population is a setting on the person or on a group. It is not a hide on the report.
2. The main row is one person for one period. A per-day check exists in addition, as the floor check.
3. Only scheduled workdays between the hire date and today count.
4. The filters are org unit, manager, person and status.
5. The report can send reminders.

Carbon's Missing Time report breaks 4 of these 5 points today, so it is noisy.

## Carbon today

`get_missing_timesheet_days` (migration `20261011151313`) feeds 3 consumers:

| Consumer | Use |
|---|---|
| Projects → Reports → Missing Time | One row per employee per missing day |
| `timesheetMissingTimeFunction` (daily, DCAA companies only) | Sends `NotificationEvent.TimesheetMissing` for yesterday to the employee and the manager |
| Close checklist task **Timesheets complete** | Counts the period's missing days in DCAA mode |

The function returns a day when all of these are true:

1. The employee is `active`.
2. The employee has an `employeeShift` on an active `shift` that works that weekday.
3. The day is not a `holiday`.
4. The day has no `peopleAbsence` row.
5. The day has no `timesheetEntry` at all.

The 5 causes of noise:

| # | Cause | Effect |
|---|---|---|
| 1 | Every active employee with a shift is in the population. Carbon has no "must record time" setting. | A shop-floor worker who never charges a project shows up on every workday. |
| 2 | The report does not stop at today. The default range is "This Month" to the last day of the month. | Days that have not happened yet show as missing. |
| 3 | The function ignores `employeeJob.startDate`. | Days before the hire date show as missing. |
| 4 | One row is one day. | One person who enters nothing for 2 weeks gives 10 rows. |
| 5 | The report has no search and no filter. | A manager cannot find the team. |

`employeeJob` already has `locationId`, `departmentId`, `managerId`, `startDate` and `flsaStatus`. `employee` has `employeeTypeId`. So the filters have data, and the hire date is available. Carbon has no termination date. It has only `employee.active`.

## Competitors Surveyed

- **SAP S/4HANA (CATS, `CATC`) and SAP SuccessFactors Time Tracking** — the enterprise reference.
- **Deltek Costpoint Time & Expense and Deltek Vantagepoint** — the reference for US government contractors under DCAA.
- **Unanet GovCon** — a project ERP for government contractors.
- **Workday Time Tracking** — the HCM leader.
- **Oracle Fusion Time and Labor and Oracle NetSuite** — HCM and mid-market ERP.
- **Harvest, Replicon, QuickBooks Time, BambooHR, Clockify** — timesheet point solutions.

## Key Consensus Patterns

### 1. The population is a setting on the person or a group, not a hide on the report

- **SAP**: The infotype 0315 field "Required Time Recording in Time Sheet" marks who must record time. `CATC` has the checkbox "Employees required to record times in time sheet". SuccessFactors sets a Time Recording Profile on the job information.
- **Deltek Costpoint**: The floor check includes a person only if 5 conditions are true. The person is in the selected group and class, is active and has Deltek Time access. The person was hired on or before the date and was not terminated. To exclude a person, remove the Time access or give the person a schedule with zero standard hours.
- **Unanet**: You exclude a person with the Inactive status. Report filters on person status and classification remove people for one run only.
- **Workday**: A worker must meet every eligibility rule of a Time Entry Template. The rules read the pay rate type, the exempt status, the time type and the job profile.
- **Oracle Fusion**: An HCM group with inclusion and exclusion conditions links people to a time entry profile. A separate "manually maintained exclusion group" stops approval reminders.
- **Point solutions**: Replicon excludes a user with the timesheet template `<None>`. BambooHR turns time tracking on per person or per group. Harvest lets each person turn off the weekly team reminder.
- **Rationale**: A hide on one report does not stop the reminders or the close check. The population must be one setting that every consumer reads. I found no product with an exclusion for one period only.

### 2. The main row is one person for one period, with a per-day floor check beside it

- **SAP**: `CATC` shows one row per employee per period, with target hours and recorded hours. The option "Apply selection criteria to each day" changes the check to each workday.
- **Deltek Costpoint**: Timesheet Status has one row per employee per period. The Daily Floor Check has one row per employee for one date, with the result Failed, Passed or Off.
- **Unanet**: The Timesheet Status report has one row per person per period, with "Out of" hours and a % completed.
- **Workday**: The delivered report "Workers with No Time Entry" returns 1 row per worker.
- **Oracle Fusion**: One compliance rule checks if a time card exists for the period. Another rule flags each scheduled day with no entries.
- **Rationale**: A person-level row shows who to chase. The day-level view proves daily recording, which DCAA tests with unannounced floor checks.

### 3. Only scheduled workdays from the hire date to today count

- **SAP**: Target hours come from the infotype 0007 work schedule. SuccessFactors lets the holiday calendar win over the work schedule.
- **Deltek Costpoint**: A work schedule sets the standard hours per day. The system expects no hours on a day with 0 standard hours. Holidays come from the schedule.
- **Oracle Fusion**: The missing-day rule checks only days the person is scheduled to work. A day with an absence and no entry gives no exception. No time card can exist before the hire date.
- **Clockify**: A full day off sets the target to 0. A half day halves it.
- **Rationale**: A day that has not ended, a day before the hire date and a day off are not missing. Each one is noise.

### 4. A partial day is a second signal: under expected hours

- **SAP**: `CATC` with "Too few hours recorded" finds partial days, with tolerance percentages.
- **Deltek Costpoint**: The reminder has the option "Send if Hours are Less Than Scheduled". Vantagepoint can show only people with "other than expected hours".
- **Unanet**: The "Timesheet Minimum Hour" reminder fires when a person has fewer hours than the Business Week.
- **Oracle Fusion**: "Compare Schedule to Reported Hours" flags a total outside the scheduled hours plus or minus a variance.
- **Rationale**: SAP, Deltek, Unanet and Oracle keep "nothing entered" apart from "too little entered". Workday's delivered reports check only whether any time exists. Carbon counts a day with a 0.5-hour entry as complete.

### 5. The filters are org unit, manager, person and status

- **SAP**: `CATC` filters by personnel number, employment status, personnel area, cost center, organizational unit and time recording administrator.
- **Deltek Costpoint**: Filters are group, class, supervisor function and status. It sorts by status, name or class. I found no location or department filter in Costpoint T&E.
- **Unanet**: "Report on" offers My Primary Approvees, My Primary and Alternate Approvees, or All people I can see. Other filters are person, person status, approval group, classification and period.
- **Workday**: Customer reports add a supervisory organization prompt. A manager sees a count per manager and drills into the workers.
- **BambooHR**: Team View filters by manager and status. Bulk setup filters by department, location and pay type.
- **Rationale**: A manager first wants "my people". The org filters come second.

### 6. The report sends reminders, on demand and on a schedule

- **SAP**: `CATC` has "Send mail", and it runs as a background job. In S/4HANA Cloud, the app Notify Missing Times has "Send Reminder" for the selected members.
- **Deltek Costpoint**: Timesheet Status sends a task, an alert or an email to the employees or their supervisors. It can send them when the report runs. The Timesheet Reminder process runs as a batch job.
- **Unanet**: Admin → Reminders sends the Timesheet Submit and the Timesheet Minimum Hour reminders on a schedule. The manager gets a summary email.
- **Harvest**: Select people on the Unsubmitted list, then choose "Send email reminders".
- **Clockify**: "Remind to submit" and "Remind to approve" on the approval screen.
- **Rationale**: The report exists to make people enter their time. A list with no action makes the manager copy names into an email.

## Answers to Research Questions

1. **Who is in the population, and how do you exclude a person?** Every product uses a setting on the person or on a group. Examples: SAP infotype 0315, Deltek Time access, Workday eligibility rules, Oracle HCM groups, Replicon templates. None of them hides a person on one report run only. Unanet's report filters come closest, and they are per run.
2. **What is one row?** One person for one period (SAP `CATC`, Deltek Timesheet Status, Unanet, Workday, Harvest). The per-day floor check is a second view (Deltek Daily Floor Check, Oracle missing-day rule, SAP day option).
3. **What counts as missing?** A scheduled workday that has ended, after the hire date, with no holiday and no absence (Oracle, Deltek, SAP). "Under expected hours" is a separate signal (SAP, Deltek, Unanet, Oracle).
4. **Which filters?** Manager or "my approvees" first (Unanet, Workday, BambooHR). Then org unit, location and department (SAP, BambooHR), person, status and period.
5. **Which actions?** A reminder to the person and a summary to the manager. Both run on demand from the report and on a schedule (SAP, Deltek, Unanet, Harvest, Clockify). I found no automatic escalation for missing time in any product. Oracle escalates only approvals.
6. **Which term?** "Missing" (Deltek, Unanet, SAP Notify Missing Times, NetSuite). "Unsubmitted" means an entry that exists but is not submitted (Harvest, Workday). Keep "Missing Time".

## Competitor-Specific Details

### SAP

- `CATC` (report `RCATSCMP`, "Time Leveling") totals target and recorded hours per employee. It has upward and downward tolerance percentages.
- `CATC` counts only approved hours. Released hours that wait for approval do not count.
- S/4HANA Cloud has the scheduled job "Email Missing Timesheet Entries". It also has the app Notify Missing Times (F2556), which shows Planned Effort, Recorded Hours and Missing Hours per project member.

### Deltek

- Costpoint has two missing-time views: Timesheet Status (per period) and the Daily Floor Check (per day). The Daily Floor Check exists because DCAA expects time recorded every day.
- The Costpoint Labor module has a "Print Missing Timesheet Report" with checkboxes for Salaried, Hourly, Part-Time, Temporary, FMLA leave and Shop Floor employees.
- Vantagepoint's floor check shows the expected hours in red when they do not match the hours entered.

### Unanet

- The status `MISSING` is one of 8 timesheet statuses. A timesheet that exists but is not submitted is `INUSE`.
- The Business Week sets the hours per day for each person. A part-time person gets a part-time Business Week.
- The Minimum Hour reminder does not read the holiday schedule.

### Workday and Oracle

- Workday delivers "Workers with No Time Entry" and "Workers with Unsubmitted Time". Its delivered reports check only whether any time exists. They do not compare it to the schedule.
- Oracle Fusion has no delivered report. A customer configures workforce compliance rules and schedules the process that runs them.
- Oracle's time consumer set has "Required Time Card Status". "No" is for people who submit time cards only now and then.

### Point solutions

- Harvest has one weekly capacity per person (0 to 60 hours). The reminder rule is "tracked less than X% of capacity" or "has not submitted".
- QuickBooks Time reminders skip a person who has PTO that day.
- Clockify reduces the target by approved time off. A full day off sets it to 0. Hourly time off reduces it by the approved hours.

## Recommended Approach for Carbon

1. **Add one population setting on the employee, and make all 3 consumers read it.** Follow SAP infotype 0315 and Deltek Time access. Store it on `employeeJob`, for example `timesheetRequired`. The report, the daily notification and the close check all use `get_missing_timesheet_days`, so the filter goes in that function. A hide on the report alone would leave the reminders and the close check noisy.
2. **Make "Hide from report" an action that turns the setting off.** The report row gets a menu item that sets `timesheetRequired = false` for the person. A toggle "Show excluded" lists those people so that a user can turn the setting back on. In DCAA mode, an exclusion hides non-compliance, so it needs `update: people`.
3. **Count only days that have ended, on or after the hire date.** Cap the range at yesterday on the company's calendar, as the daily notification does. Skip days before `employeeJob.startDate` (Deltek, Oracle).
4. **Make the row one employee, and put the days behind it.** Follow Deltek Timesheet Status and SAP `CATC`. Show the missing days, the first and the last missing date, and the manager. An expanded row lists the days, which is the floor check view (Deltek Daily Floor Check).
5. **Add search and 4 filters: employee, manager, department and location.** Default to the user's own direct reports when the user is a manager (Unanet "My Primary Approvees").
6. **Add "Send reminder" for the selected employees.** Reuse `NotificationEvent.TimesheetMissing`, which the daily job already sends (SAP Notify Missing Times, Harvest).
7. **Add "under expected hours" later, as a second signal.** It needs expected hours per day from the shift. Keep it out of the first change (SAP `CATC`, Unanet Minimum Hour, Oracle).

### Open questions for the spec

1. What is the default of `timesheetRequired` for existing employees: true for everyone (no change in behavior) or true only for people with a `laborCategoryId`?
2. Is a filter by employee type (`employeeTypeId`) needed beside the per-person setting (Workday and Unanet filter by classification)?
3. Should Standard (non-DCAA) companies also get the daily notification once the population is clean?

## Sources

- https://www.bu.edu/tech/files/2016/02/Missing_Timesheets_Hours_Review-Report.pdf
- https://support.hrms.wa.gov/sites/default/files/public/PDFProcedures/Time%20Leveling%20(CATC).pdf
- https://support.hrms.wa.gov/sites/default/files/public/HRMSReports/Time%20Leveling.pdf
- https://www.ncosc.gov/training/hr-payroll-system-training/hr-payroll-help-documents/tm-06-catc-report
- https://www.integratedcg.com/cats-profiles/
- https://help.sap.com/docs/SAP_S4HANA_CLOUD/0bebd08dffca45afa67b1f751199afd0/f3be0d588d9ab244e10000000a4450e5.html
- https://help.sap.com/docs/SAP_S4HANA_CLOUD_BEST_PRACTICES/3003346ecd29489440730ec72a00e8c9/38462bdedd274099a259f542e55c160d.html
- https://help.sap.com/docs/SAP_SUCCESSFACTORS_EMPLOYEE_CENTRAL/5b9fbaed634b4004a8befcc2dad2fc1f/43980ea1df74448b9187fe7afebd5baa.html
- https://help.sap.com/docs/successfactors-employee-central/implementing-time-management-in-sap-successfactors/time-recording-methods
- https://help.sap.com/docs/successfactors-employee-central/implementing-time-management-in-sap-successfactors/planned-working-time
- https://leanx.eu/en/sap/table/bapihr0315.html
- https://help.deltek.com/product/costpoint/8.2/GA/TMRTSSTATUS_Contents_of_the_Timesheet_Status_Screen.html
- https://help.deltek.com/Product/CostpointSuite/TS%20Status%20Notifications%20Tab.html
- https://help.deltek.com/Product/CostpointSuite/Daily%20Floor%20Check%20Criteria%20Tab.html
- https://help.deltek.com/product/costpoint/8.2/GA/TMRTSREMINDER_Contents_of_the_Timesheet_Reminder_Screen.html
- https://help.deltek.com/Product/CostpointSuite/TMMWORKSCHEDULE.html
- https://help.deltek.com/product/Costpoint/8.2/SMB/GA/LDRMIS_Contents_of_the_Print_Missing_Timesheet_Report_Screen.html
- https://help.deltek.com/Product/Vantagepoint/7.2/vp_mystuff_dashboards_timesheet_floor_check.html
- https://help.deltek.com/Product/Vantagepoint/3.0/timesettings_Checking_Timesheet_Hours_Against_Expected_Hours.html
- https://www.cbh.com/insights/articles/dcaa-timekeeping-requirements-for-government-contractors/
- https://unanet.quantum-intl.com/unanet/docs/unanet_menu/reports/people_reports/status/rpt_people_timesheet_status.htm
- https://unanet.quantum-intl.com/unanet/docs/unanet_menu/misc/sel_criteria/sel_crit_statuses_time_-_rpt.htm
- https://unanet.quantum-intl.com/unanet/docs/unanet_menu/misc/statuses.htm
- https://unanet.quantum-intl.com/unanet/docs/unanet_menu/admin/admin_reminders.htm
- https://unanet.quantum-intl.com/unanet/docs/unanet_menu/misc/sel_criteria/sel_crit_report_on_-_people.htm
- https://unanet.quantum-intl.com/unanet/docs/unanet_menu/admin/setup/setup_business_week.htm
- https://unanet.quantum-intl.com/unanet/docs/unanet_menu/misc/field_desc/fld_active_-_user.htm
- https://doc.workday.com/admin-guide/en-us/human-capital-management/time-tracking/reviewing-and-approving-time/qlu1597184217600.html
- https://doc.workday.com/admin-guide/en-us/human-capital-management/time-tracking/time-entry-setup/time-entry-templates/qdn1648576154116.html
- https://web.sas.upenn.edu/sas-fiscal-operations/workday-instructions-reporting-workday/
- https://kognitivinc.com/blog/how-to-manage-multi-position-time-tracking-eligibility-in-workday
- https://dallascityhall.com/departments/humanresources/workday/DCH%20Documents/Workday%20Manager%20Reports%20for%20Timesheets.pdf
- https://docs.oracle.com/en/cloud/saas/human-resources/faitl/implementing-time-and-labor.pdf
- https://docs.oracle.com/en/cloud/saas/human-resources/fautl/generate-time-exceptions-from-compliance-rules.html
- https://docs.oracle.com/en/cloud/saas/human-resources/ftlff/identify-missing-time-entries-for-scheduled-day.html
- https://docs.oracle.com/en/cloud/saas/human-resources/ftlff/compare-reported-hours-to-published-or-hr-schedule.html
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N1209079.html
- https://support.getharvest.com/hc/en-us/articles/360058596112-Timesheet-reminders
- https://support.getharvest.com/hc/en-us/articles/27570699929229-Timesheet-submission-reports
- https://support.getharvest.com/hc/en-us/articles/360048181752-Setting-and-editing-capacity
- https://learning.deltek.com/bundle/Replicon/page/how-do-we-remove-timesheet-access-from-users.html
- https://learning.deltek.com/bundle/Replicon/page/setting-up-automated-mobile-and-email-notifications.html
- https://quickbooks.intuit.com/r/manage-employees/timesheet-reminders/
- https://help.bamboohr.com/s/article/899228
- https://help.bamboohr.com/s/article/2125211
- https://clockify.me/help/administration/targets-reminders
- https://clockify.me/help/track-time-and-expenses/approval
