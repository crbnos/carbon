# Timecards: Auto Punch, Breaks, Weekly Summaries, and End-of-Day Closeout

## Summary
Extend the current timecard feature so the first successful MES or ERP login each day automatically starts the employee’s workday, breaks are explicit records started only from MES’s break/lunch action, and weekly ERP summaries report worked time, breaks, and overtime. End-of-day is handled by explicit break/logout when used, ERP/admin correction when needed, and a strengthened auto-close job as the official missed-punch safety net.

## Key Changes
- Keep `timeCardEntry` as work-session rows and add explicit `timeCardBreak` rows.
  - `timeCardBreak` should store `employeeId`, `companyId`, optional parent `timeCardEntryId`, `breakType` (`Break` / `Lunch`), `startTime`, `endTime`, `startedBy`, `endedBy`, note, and timestamps.
  - A day may contain multiple work sessions separated by break records.
- Add core service methods for:
  - `ensureDailyAutoClockIn(client, { employeeId, companyId, createdBy, loginAt })`
  - `startBreak(client, { employeeId, companyId, breakType, startedBy, startTime })`
  - `endOpenBreakOnLogin(client, { employeeId, companyId, endedBy, endTime })`
  - `autoCloseOpenShift(client, { entryId, clockOut, autoCloseReason, autoCloseShiftId })`
  - `getWeeklyTimecardSummary(client, { companyId, employeeId?, weekStart })`
- Trigger the automatic first punch from the existing successful auth callback flow used by MES and ERP.
  - On successful login, first close any open break for that employee.
  - Then create a work session only if there is no open `timeCardEntry` and no session already started for that employee on that local day.
- Replace MES `Clock Out` with an explicit break/lunch action.
  - Starting a break should close the current work session immediately, create a `timeCardBreak`, end the employee’s active MES `productionEvent` rows, destroy the auth session, and return the user to login/root.
  - After the next successful login, the open break is closed and the employee remains off-task until they manually resume work.
- Keep ERP manual timecard editing as the correction path.
  - Supervisors/admins can still add, edit, and delete raw work sessions.
  - Add equivalent support for editing/deleting break rows if back-office payroll correction is needed.
- Add weekly reporting in ERP.
  - Company-level weekly summary grouped by employee.
  - Per-person weekly summary on the existing person timecard page.
  - Metrics: total worked hours, regular hours, overtime hours, break count, total break time, average break duration, average first punch time, average break start time, longest break, and missed-punch anomalies.

## End-of-Day / Shift-End Behavior
- A shift ends when the current open work session is closed.
- There are three valid close paths:
  - `Explicit break/lunch in MES`: closes the current session at break start; if the employee never returns, the day simply ends on that last closed segment.
  - `ERP/admin correction`: supervisors can close or adjust a missed punch manually.
  - `Automatic close job`: this is the official fallback for forgotten end-of-day punches.
- Update the existing `packages/jobs/trigger/timecard-auto-close.ts` job so it closes stale open work sessions daily, not just in a Sunday sweep.
  - For employees with an assigned shift, close the session at scheduled shift end based on the shift duration already used today.
  - Add a small grace window before closing, recommended `15 minutes`, to avoid chopping active end-of-shift activity.
  - For employees without a shift, fall back to `clockIn + 8 hours`.
  - Mark auto-closed rows distinctly with `autoCloseShiftId`, `updatedAt`, and a structured note/reason such as `Auto-closed by system at scheduled shift end`.
- Keep the weekly sweep logic only as a secondary cleanup pass for rare leftovers, not the primary end-of-day mechanism.
- Auto-close should only close open work sessions.
  - It should also close any open break still attached to that workday if one exists, using the same close timestamp, so payroll has no dangling records.

## Public Interfaces / Behavior
- Login behavior:
  - First successful MES or ERP login each local day auto-starts the employee’s workday.
  - Login after a break ends the break and starts the next work session if needed.
- Logout behavior:
  - Generic logout does not start a break.
  - Only the explicit MES break/lunch action starts a break and logs the user out.
- Payroll/reporting defaults:
  - Weeks run Monday-Sunday.
  - Overtime begins after 40 worked hours in the week.
  - Worked time excludes all recorded break intervals.

## Test Plan
- First successful login creates one work session for the day; repeated logins the same day do not duplicate it.
- MES break action:
  - closes the active work session,
  - creates an open break,
  - ends active `productionEvent` rows for that employee,
  - logs the user out.
- Login after break closes the break and creates the next work session without overlap.
- Manual logout outside the break action does not create a break.
- Daily auto-close closes stale open work sessions at scheduled shift end plus grace window.
- Employees without a shift are auto-closed at `clockIn + 8h`.
- Weekly summary excludes break minutes and splits regular vs overtime correctly at 40 hours.
- Cross-midnight cases:
  - overnight shifts,
  - break spanning midnight,
  - open prior-day sessions,
  - auto-close and next-day login interaction.
- ERP corrections recalculate weekly aggregates and anomaly flags correctly.

## Assumptions
- Auto punch applies to successful MES and ERP logins.
- Breaks are modeled as first-class records, not implicit gaps.
- Only the explicit MES break/lunch action starts a break.
- MES paused work is implemented by ending active production events; resumption is manual.
- The recommended default grace window for scheduled auto-close is 15 minutes.



=====

end to end summary
--
Implemented the timeclock upgrade end to end.

The main behavior changes are in callback.tsx, callback.tsx, people.service.ts, people.service.ts, and the new migration 20260326120000_timecard-breaks-and-summary.sql. First successful MES/ERP login now auto-punches for the day, login after a break closes the break and starts a new work session when needed, MES break/lunch actions close the active session and log the user out, and the auto-close job now runs every 15 minutes to close stale open shifts based on shift length plus the 15 minute grace window.

On the UI side, I updated timecard.tsx, TimeCardButton.tsx, timecard.tsx, and $personId.timecard.tsx. MES now exposes break/lunch flows instead of the old employee clock-out button, both MES and ERP show weekly summary metrics, and ERP person timecards now support viewing/editing/deleting break rows alongside work sessions.

Verification: npm run -w mes build passed, and npm run -w erp build passed. I also ran Biome on the touched route/service files. One follow-up I’d still recommend is regenerating DB types/swagger after applying the migration, since I did not update the generated database type artifacts in this change set.