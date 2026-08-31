import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { formatDate } from "@carbon/utils";
import {
  getLocalTimeZone,
  now,
  parseDate,
  startOfWeek,
  toCalendarDate,
  today
} from "@internationalized/date";
import { msg } from "@lingui/core/macro";
import { useLocale } from "@react-aria/i18n";
import { useMemo, useState } from "react";
import type { LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData } from "react-router";
import {
  getEmployeeDepartments,
  getEmployeeShifts,
  getShiftsWithTimes
} from "~/modules/people";
import {
  getActiveEmployeeAbilities,
  getLocationEmployees,
  getPeopleAbsences,
  getPeopleAbsencesRange,
  getPeopleAssignments,
  getPeopleAssignmentsRange,
  getPeopleCapacityOperations,
  getWorkCenterRequiredAbilities,
  getWorkCenterReservationsRange,
  getWorkCenterShifts
} from "~/modules/production";
import {
  buildPeopleCapacityBuckets,
  getWorkCenterCalendarHoursByDay
} from "~/modules/production/peopleCapacity.server";
import { OvertimeDialog } from "~/modules/production/ui/Schedule/People/OvertimeDialog";
import { PeopleBoard } from "~/modules/production/ui/Schedule/People/PeopleBoard";
import { PeopleCapacity } from "~/modules/production/ui/Schedule/People/PeopleCapacity";
import { PeopleHeader } from "~/modules/production/ui/Schedule/People/PeopleHeader";
import { PeopleMatrix } from "~/modules/production/ui/Schedule/People/PeopleMatrix";
import { PeopleWeekBoard } from "~/modules/production/ui/Schedule/People/PeopleWeekBoard";
import { assignmentMatchesShift } from "~/modules/production/ui/Schedule/People/peopleShared";
import { TimeOffDialog } from "~/modules/production/ui/Schedule/People/TimeOffDialog";
import { getWorkCentersByLocation } from "~/modules/resources";
import { resolveLocationId } from "~/modules/shared/location.server";
import { getLocationTimeZone } from "~/modules/shared/timezone.server";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

const PEOPLE_VIEWS = ["board", "matrix", "capacity"] as const;
type PeopleView = (typeof PEOPLE_VIEWS)[number];

// last-resort default when a location has no shifts configured
const FALLBACK_SHIFT_HOURS = 8;

function shiftDurationHours(
  startTime: string | null,
  endTime: string | null
): number | null {
  if (!startTime || !endTime) return null;
  const toMinutes = (time: string) => {
    const [hours, minutes] = time.split(":").map(Number);
    return (hours ?? 0) * 60 + (minutes ?? 0);
  };
  let minutes = toMinutes(endTime) - toMinutes(startTime);
  if (minutes <= 0) minutes += 24 * 60; // overnight shift wraps midnight
  return minutes / 60;
}

/**
 * Is this person on the shift being filtered by?
 *
 * Strict, and strict on purpose — it mirrors the department filter, where
 * someone with no department does not match every department. Letting a
 * shift-less person match every shift makes the filter useless the moment most
 * of the roster has no `employeeShift` row: picking "Weekend" would list the
 * whole location. An empty column is the honest answer to "nobody is on this
 * shift"; the remedy is assigning shifts in People, not loosening this.
 */
function fitsShiftFilter(
  employeeId: string,
  shiftId: string | null,
  employeeShiftId: Record<string, string>
) {
  if (!shiftId) return true;
  return employeeShiftId[employeeId] === shiftId;
}

export const handle: Handle = {
  breadcrumb: msg`Resource Planning`,
  to: path.to.priorityPeople,
  module: "production"
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {
    view: "production"
  });

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const dateParam = searchParams.get("date");
  const shiftId = searchParams.get("shift") || null;

  // department scope: URL param wins, cookie remembers the last choice
  const departmentParam = searchParams.get("department");
  const cookieMatch = (request.headers.get("Cookie") ?? "").match(
    /(?:^|;\s*)peopleDepartment=([^;]*)/
  );
  const cookieDepartment = cookieMatch
    ? decodeURIComponent(cookieMatch[1])
    : null;
  const requestedDepartment =
    departmentParam !== null ? departmentParam : cookieDepartment;

  const locationId = await resolveLocationId(client, request, {
    searchParams,
    userId,
    companyId,
    onDefaultsError: path.to.production,
    onNoLocations: path.to.production
  });

  // The board's "today" belongs to the plant being assigned, not the server —
  // resolved after locationId settles.
  const timezone = await getLocationTimeZone(client, locationId, companyId);
  const date = (
    dateParam ? parseDate(dateParam) : toCalendarDate(now(timezone))
  ).toString();

  const viewParam = searchParams.get("view");
  const view: PeopleView = PEOPLE_VIEWS.includes(viewParam as PeopleView)
    ? (viewParam as PeopleView)
    : "board";

  // horizon: the board assigns per day or per whole week; matrix/capacity
  // always show the selected date's Monday-start week. Week is the default —
  // only an explicit ?range=day narrows the board to a single day.
  const rangeParam = searchParams.get("range");
  const range: "day" | "week" =
    view === "board" && rangeParam === "day" ? "day" : "week";

  const weekStart = startOfWeek(parseDate(date), "en-GB"); // en-GB uses Monday as first day
  const weekDates = Array.from({ length: 7 }, (_, i) =>
    weekStart.add({ days: i }).toString()
  );

  const [
    assignments,
    absences,
    employees,
    workCenters,
    requiredAbilities,
    employeeAbilities,
    shifts,
    employeeJobs,
    employeeShiftRows
  ] = await Promise.all([
    getPeopleAssignments(client, companyId, { locationId, date }),
    getPeopleAbsences(client, companyId, date),
    getLocationEmployees(client, companyId, locationId),
    getWorkCentersByLocation(client, locationId),
    getWorkCenterRequiredAbilities(client, companyId, locationId),
    getActiveEmployeeAbilities(client, companyId),
    getShiftsWithTimes(client, companyId, locationId),
    getEmployeeDepartments(client, companyId),
    getEmployeeShifts(client, companyId)
  ]);

  // resolve the requested department against this location's real departments
  const validDepartments = new Set(
    (workCenters.data ?? []).flatMap((workCenter) =>
      workCenter.departmentId ? [workCenter.departmentId as string] : []
    )
  );
  const departmentId =
    requestedDepartment &&
    requestedDepartment !== "all" &&
    validDepartments.has(requestedDepartment)
      ? requestedDepartment
      : null;
  const employeeDepartments: Record<string, string | null> = {};
  for (const row of employeeJobs.data ?? []) {
    employeeDepartments[row.id] = row.departmentId;
  }

  const shiftRows = shifts.data ?? [];
  const shiftHoursById: Record<string, number> = {};
  const shiftStartById: Record<string, string> = {};
  const shiftEndById: Record<string, string> = {};
  for (const shift of shiftRows) {
    const hours = shiftDurationHours(shift.startTime, shift.endTime);
    if (hours !== null) shiftHoursById[shift.id] = hours;
    if (shift.startTime) {
      shiftStartById[shift.id] = shift.startTime.slice(0, 5);
    }
    if (shift.endTime) {
      shiftEndById[shift.id] = shift.endTime.slice(0, 5);
    }
  }
  // most-common start time at the location — the day-editor's time echo
  // anchor for people without a shift
  const startCounts = new Map<string, number>();
  for (const start of Object.values(shiftStartById)) {
    startCounts.set(start, (startCounts.get(start) ?? 0) + 1);
  }
  const defaultShiftStart =
    [...startCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "08:00";
  // end of the most common window (same-start shifts), for the shift line
  const defaultShiftEnd =
    shiftRows
      .filter((shift) => shift.startTime?.slice(0, 5) === defaultShiftStart)
      .map((shift) => shift.endTime?.slice(0, 5))
      .find(Boolean) ?? null;
  // last-resort duration for a person with no shift anywhere: the most
  // common shift length at the location (not alphabetical-first)
  const durationCounts = new Map<number, number>();
  for (const hours of Object.values(shiftHoursById)) {
    durationCounts.set(hours, (durationCounts.get(hours) ?? 0) + 1);
  }
  const defaultShiftHours =
    [...durationCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ??
    FALLBACK_SHIFT_HOURS;
  // each person's own shift (employeeShift) — the honest source for
  // assignments that carry no shift of their own
  const employeeShiftHours: Record<string, number> = {};
  const employeeShiftStart: Record<string, string> = {};
  const employeeShiftEnd: Record<string, string> = {};
  // the person's own shift — stamped onto assignments as they're created, and
  // the shift filter's fallback for rows created before the person had one
  const employeeShiftId: Record<string, string> = {};
  for (const row of employeeShiftRows.data ?? []) {
    employeeShiftId[row.employeeId] = row.shiftId;
    const hours = shiftHoursById[row.shiftId];
    if (hours !== undefined) {
      employeeShiftHours[row.employeeId] = hours;
    }
    const start = shiftStartById[row.shiftId];
    if (start !== undefined) {
      employeeShiftStart[row.employeeId] = start;
    }
    const end = shiftEndById[row.shiftId];
    if (end !== undefined) {
      employeeShiftEnd[row.employeeId] = end;
    }
  }
  if (assignments.error) {
    throw redirect(
      path.to.production,
      await flash(
        request,
        error(assignments.error, "Failed to load people assignments")
      )
    );
  }

  // shift scope resolves through the ladder (the row's stamped shift, else the
  // person's own shift) — an exact match on the stamped shift alone would hide
  // every assignment created before the person's shift was set
  const dayAssignments = (assignments.data ?? []).filter((assignment) =>
    assignmentMatchesShift(assignment, shiftId, employeeShiftId)
  );

  // week-scoped data for the matrix and capacity views
  let weekAssignments: {
    id: string;
    workCenterId: string;
    employeeId: string;
    shiftId: string | null;
    date: string;
    note: string | null;
    overtimeHours: number;
    hours: number | null;
  }[] = [];
  let weekAbsences: { id: string; employeeId: string; date: string }[] = [];
  let demandByWorkCenter: Record<
    string,
    { pastDue: number; days: Record<string, number> }
  > = {};
  let scheduledByWorkCenter: Record<string, Record<string, number>> = {};
  // per-work-center calendar hours (the Available series) and the ladder rung
  // each work center resolved via (the assumption banner) — Capacity view only
  let calendarHoursByWorkCenter: Record<string, Record<string, number>> = {};
  const capacityRungByWorkCenter: Record<string, number> = {};

  if (view !== "board" || range === "week") {
    const weekStartDate = weekDates[0];
    const weekEndDate = weekDates[weekDates.length - 1];
    // reservation window on the plant's calendar, matching the day bucketing
    // below — day boundaries via CalendarDate.toDate(tz) so DST weeks bucket
    // correctly
    const weekWindowStart = parseDate(weekStartDate).toDate(timezone);
    const weekWindowEnd = parseDate(weekEndDate)
      .add({ days: 1 })
      .toDate(timezone);

    const capacityWorkCenterIds =
      view === "capacity"
        ? (workCenters.data ?? []).flatMap((workCenter) =>
            workCenter.id ? [workCenter.id as string] : []
          )
        : [];

    const [
      rangeAssignments,
      rangeAbsences,
      capacityOperations,
      reservations,
      workCenterShiftRows
    ] = await Promise.all([
      getPeopleAssignmentsRange(client, companyId, {
        locationId,
        startDate: weekStartDate,
        endDate: weekEndDate
      }),
      getPeopleAbsencesRange(client, companyId, {
        startDate: weekStartDate,
        endDate: weekEndDate
      }),
      // the week board doesn't show demand — skip the heavy operation scan.
      // Null start = no floor: Past due spans back to the earliest open op.
      view !== "board"
        ? getPeopleCapacityOperations(client, companyId, {
            locationId,
            startDate: null,
            endDate: weekEndDate
          })
        : Promise.resolve({ data: [], error: null }),
      view === "capacity"
        ? getWorkCenterReservationsRange(client, companyId, {
            startAt: weekWindowStart.toISOString(),
            endAt: weekWindowEnd.toISOString()
          })
        : Promise.resolve({ data: [], error: null }),
      view === "capacity" && capacityWorkCenterIds.length > 0
        ? getWorkCenterShifts(client, companyId, capacityWorkCenterIds)
        : Promise.resolve({ data: [], error: null })
    ]);

    weekAssignments = rangeAssignments.data ?? [];
    weekAbsences = rangeAbsences.data ?? [];

    // The engine (Deno) owns the authoritative machine-availability ladder;
    // this resolves the same rungs at day granularity for display.
    let calendarHoursMap = new Map<string, Map<string, number>>();
    if (view === "capacity") {
      const wcShiftLinks = workCenterShiftRows.data ?? [];
      const ladderWorkCenters = (workCenters.data ?? []).flatMap(
        (workCenter) =>
          workCenter.id
            ? [
                {
                  id: workCenter.id as string,
                  alwaysOn: (workCenter.alwaysOn ?? false) as boolean
                }
              ]
            : []
      );
      const locationLadderShifts = shiftRows.map((shift) => ({
        id: shift.id,
        hours: shiftHoursById[shift.id] ?? defaultShiftHours,
        runsOn: [
          shift.sunday,
          shift.monday,
          shift.tuesday,
          shift.wednesday,
          shift.thursday,
          shift.friday,
          shift.saturday
        ]
      }));
      calendarHoursMap = getWorkCenterCalendarHoursByDay({
        workCenters: ladderWorkCenters,
        workCenterShifts: wcShiftLinks,
        locationShifts: locationLadderShifts,
        weekDates
      });
      const wcHasOwnShifts = new Set(
        wcShiftLinks.map((link) => link.workCenterId)
      );
      for (const workCenter of ladderWorkCenters) {
        capacityRungByWorkCenter[workCenter.id] =
          workCenter.alwaysOn || wcHasOwnShifts.has(workCenter.id)
            ? 1
            : locationLadderShifts.length > 0
              ? 2
              : 3;
      }
      calendarHoursByWorkCenter = Object.fromEntries(
        [...calendarHoursMap].map(([wcId, byDay]) => [
          wcId,
          Object.fromEntries(byDay)
        ])
      );
    }

    const buckets = buildPeopleCapacityBuckets({
      weekDates,
      timezone,
      operations: capacityOperations.data ?? [],
      reservations: reservations.data ?? [],
      calendarHoursByWorkCenter: calendarHoursMap
    });
    demandByWorkCenter = buckets.demandByWorkCenter;
    scheduledByWorkCenter = buckets.scheduledByWorkCenter;
  }

  // Day board: operation-hours each work center needs on the selected date, so
  // the manning board shows where the workload is (who to put where).
  let requiredHoursByWorkCenter: Record<string, number> = {};
  if (view === "board" && range === "day") {
    const dayOperations = await getPeopleCapacityOperations(client, companyId, {
      locationId,
      startDate: date,
      endDate: date
    });
    const { demandByWorkCenter: dayDemand } = buildPeopleCapacityBuckets({
      weekDates: [date],
      timezone,
      operations: dayOperations.data ?? [],
      reservations: [],
      calendarHoursByWorkCenter: new Map()
    });
    requiredHoursByWorkCenter = Object.fromEntries(
      Object.entries(dayDemand).map(([workCenterId, bucket]) => [
        workCenterId,
        bucket.days[date] ?? 0
      ])
    );
  }

  // Per-person ability names for the card badges: presence-based, non-expired
  // (same expiry rule the board uses for qualification), deduped and sorted.
  const employeeAbilityNames: Record<string, string[]> = {};
  {
    const byEmployee = new Map<string, Set<string>>();
    for (const row of employeeAbilities.data ?? []) {
      if (row.expiresAt && row.expiresAt.slice(0, 10) < date) continue;
      const ability = Array.isArray(row.ability) ? row.ability[0] : row.ability;
      const name = ability?.name;
      if (!name) continue;
      const set = byEmployee.get(row.employeeId) ?? new Set<string>();
      set.add(name);
      byEmployee.set(row.employeeId, set);
    }
    for (const [employeeId, names] of byEmployee) {
      employeeAbilityNames[employeeId] = [...names].sort((a, b) =>
        a.localeCompare(b)
      );
    }
  }

  return {
    locationId,
    locationTimeZone: timezone,
    date,
    shiftId,
    view,
    range,
    departmentId,
    employeeDepartments,
    weekDates,
    weekAssignments,
    weekAbsences,
    demandByWorkCenter,
    scheduledByWorkCenter,
    requiredHoursByWorkCenter,
    employeeShiftHours,
    assignments: dayAssignments,
    absences: absences.data ?? [],
    employees: (employees.data ?? []).flatMap((employee) =>
      employee.id
        ? [
            {
              id: employee.id,
              name: employee.name,
              avatarUrl: employee.avatarUrl
            }
          ]
        : []
    ),
    workCenters: (workCenters.data ?? []).map((workCenter) => ({
      id: workCenter.id as string,
      name: (workCenter.name ?? "") as string,
      departmentId: (workCenter.departmentId ?? null) as string | null,
      departmentName: (workCenter.departmentName ?? null) as string | null
    })),
    requiredAbilities: requiredAbilities.data ?? [],
    employeeAbilities: employeeAbilities.data ?? [],
    employeeAbilityNames,
    shifts: shiftRows.map((shift) => ({ id: shift.id, name: shift.name })),
    shiftHoursById,
    shiftStartById,
    shiftEndById,
    employeeShiftStart,
    employeeShiftEnd,
    employeeShiftId,
    defaultShiftStart,
    defaultShiftEnd,
    defaultShiftHours,
    calendarHoursByWorkCenter,
    capacityRungByWorkCenter
  };
}

export default function SchedulePeopleRoute() {
  const {
    locationId,
    locationTimeZone,
    date,
    shiftId,
    view,
    range,
    departmentId,
    employeeDepartments,
    weekDates,
    weekAssignments,
    weekAbsences,
    employeeShiftHours,
    demandByWorkCenter,
    scheduledByWorkCenter,
    requiredHoursByWorkCenter,
    assignments,
    absences,
    employees,
    workCenters,
    requiredAbilities,
    employeeAbilities,
    employeeAbilityNames,
    shifts,
    shiftHoursById,
    shiftStartById,
    shiftEndById,
    employeeShiftStart,
    employeeShiftEnd,
    employeeShiftId,
    defaultShiftStart,
    defaultShiftEnd,
    defaultShiftHours,
    calendarHoursByWorkCenter,
    capacityRungByWorkCenter
  } = useLoaderData<typeof loader>();
  const { locale } = useLocale();
  const [overtimeOpen, setOvertimeOpen] = useState(false);
  const [timeOffOpen, setTimeOffOpen] = useState(false);

  const departments = useMemo(() => {
    const seen = new Map<string, string>();
    for (const workCenter of workCenters) {
      if (workCenter.departmentId && workCenter.departmentName) {
        seen.set(workCenter.departmentId, workCenter.departmentName);
      }
    }
    return [...seen.entries()].map(([value, label]) => ({ value, label }));
  }, [workCenters]);

  const displayedWorkCenters = useMemo(
    () =>
      departmentId
        ? workCenters.filter(
            (workCenter) => workCenter.departmentId === departmentId
          )
        : workCenters,
    [workCenters, departmentId]
  );
  const displayedWorkCenterIds = useMemo(
    () => new Set(displayedWorkCenters.map((workCenter) => workCenter.id)),
    [displayedWorkCenters]
  );

  const boardAssignments = useMemo(
    () =>
      departmentId
        ? assignments.filter((assignment) =>
            displayedWorkCenterIds.has(assignment.workCenterId)
          )
        : assignments,
    [assignments, departmentId, displayedWorkCenterIds]
  );
  const matrixAssignments = useMemo(
    () =>
      departmentId
        ? weekAssignments.filter((assignment) =>
            displayedWorkCenterIds.has(assignment.workCenterId)
          )
        : weekAssignments,
    [weekAssignments, departmentId, displayedWorkCenterIds]
  );

  // the department's own people (employeeJob) and the shift's own people
  // (employeeShift), plus anyone already assigned — so a filter can never hide
  // someone you actually scheduled
  const employeesForBoard = useMemo(() => {
    if (!departmentId && !shiftId) return employees;
    const assigned = new Set(boardAssignments.map((a) => a.employeeId));
    return employees.filter(
      (employee) =>
        assigned.has(employee.id) ||
        ((!departmentId || employeeDepartments[employee.id] === departmentId) &&
          fitsShiftFilter(employee.id, shiftId, employeeShiftId))
    );
  }, [
    employees,
    departmentId,
    employeeDepartments,
    boardAssignments,
    shiftId,
    employeeShiftId
  ]);
  const employeesForMatrix = useMemo(() => {
    if (!departmentId && !shiftId) return employees;
    const assigned = new Set(matrixAssignments.map((a) => a.employeeId));
    return employees.filter(
      (employee) =>
        assigned.has(employee.id) ||
        ((!departmentId || employeeDepartments[employee.id] === departmentId) &&
          fitsShiftFilter(employee.id, shiftId, employeeShiftId))
    );
  }, [
    employees,
    departmentId,
    employeeDepartments,
    matrixAssignments,
    shiftId,
    employeeShiftId
  ]);

  const shortDate = (value: string) =>
    formatDate(value, { month: "short", day: "numeric" }, locale);
  const dateLabel =
    range === "day"
      ? formatDate(
          date,
          { weekday: "short", month: "short", day: "numeric" },
          locale
        )
      : `${shortDate(weekDates[0])} – ${shortDate(
          weekDates[weekDates.length - 1]
        )}`;

  // week-range date dropdown: pick a week span, like the schedule's week
  // columns — 4 weeks back through 11 ahead around the selected week
  const weekOptions = useMemo(() => {
    if (range === "day") return [];
    const selectedStart = weekDates[0];
    const currentWeekStart = startOfWeek(
      today(getLocalTimeZone()),
      "en-GB"
    ).toString();
    const base = parseDate(selectedStart);
    return Array.from({ length: 16 }, (_, i) => {
      const start = base.add({ days: (i - 4) * 7 });
      const startString = start.toString();
      return {
        start: startString,
        label: `${shortDate(startString)} – ${shortDate(
          start.add({ days: 6 }).toString()
        )}`,
        isSelected: startString === selectedStart,
        isCurrent: startString === currentWeekStart
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range, weekDates, shortDate]);

  return (
    <div className="flex flex-col h-full max-h-full overflow-auto relative">
      <PeopleHeader
        view={view}
        range={range}
        date={date}
        dateLabel={dateLabel}
        weekDates={weekDates}
        weekOptions={weekOptions}
        locationId={locationId}
        departmentId={departmentId}
        shiftId={shiftId}
        departments={departments}
        shifts={shifts}
        onOpenOvertime={() => setOvertimeOpen(true)}
        onOpenTimeOff={() => setTimeOffOpen(true)}
      />
      <div className="flex flex-grow h-full items-stretch overflow-hidden relative">
        {view === "board" &&
          (range === "week" ? (
            <PeopleWeekBoard
              weekDates={weekDates}
              shiftId={shiftId}
              locationId={locationId}
              employees={employeesForMatrix}
              workCenters={displayedWorkCenters}
              assignments={matrixAssignments}
              absences={weekAbsences}
              employeeShiftId={employeeShiftId}
              employeeAbilityNames={employeeAbilityNames}
            />
          ) : (
            <PeopleBoard
              date={date}
              shiftId={shiftId}
              locationId={locationId}
              locationTimeZone={locationTimeZone}
              employees={employeesForBoard}
              workCenters={displayedWorkCenters}
              assignments={boardAssignments}
              absences={absences}
              requiredAbilities={requiredAbilities}
              requiredHoursByWorkCenter={requiredHoursByWorkCenter}
              employeeAbilities={employeeAbilities}
              employeeAbilityNames={employeeAbilityNames}
              shiftHoursById={shiftHoursById}
              employeeShiftHours={employeeShiftHours}
              defaultShiftHours={defaultShiftHours}
              shiftStartById={shiftStartById}
              shiftEndById={shiftEndById}
              employeeShiftStart={employeeShiftStart}
              employeeShiftEnd={employeeShiftEnd}
              employeeShiftId={employeeShiftId}
              defaultShiftStart={defaultShiftStart}
              defaultShiftEnd={defaultShiftEnd}
            />
          ))}
        {view === "matrix" && (
          <PeopleMatrix
            weekDates={weekDates}
            locationTimeZone={locationTimeZone}
            employees={employeesForMatrix}
            workCenters={displayedWorkCenters}
            assignments={matrixAssignments}
            absences={weekAbsences}
            demandByWorkCenter={demandByWorkCenter}
            shiftId={shiftId}
            locationId={locationId}
            shiftHoursById={shiftHoursById}
            employeeShiftHours={employeeShiftHours}
            defaultShiftHours={defaultShiftHours}
            shiftStartById={shiftStartById}
            shiftEndById={shiftEndById}
            employeeShiftStart={employeeShiftStart}
            employeeShiftEnd={employeeShiftEnd}
            employeeShiftId={employeeShiftId}
            defaultShiftStart={defaultShiftStart}
            defaultShiftEnd={defaultShiftEnd}
          />
        )}
        {view === "capacity" && (
          <PeopleCapacity
            weekDates={weekDates}
            locationTimeZone={locationTimeZone}
            workCenters={displayedWorkCenters}
            assignments={matrixAssignments}
            absences={weekAbsences}
            demandByWorkCenter={demandByWorkCenter}
            scheduledByWorkCenter={scheduledByWorkCenter}
            shiftHoursById={shiftHoursById}
            employeeShiftHours={employeeShiftHours}
            defaultShiftHours={defaultShiftHours}
            calendarHoursByWorkCenter={calendarHoursByWorkCenter}
            capacityRungByWorkCenter={capacityRungByWorkCenter}
          />
        )}
      </div>

      {overtimeOpen && (
        <OvertimeDialog
          onClose={() => setOvertimeOpen(false)}
          range={range}
          date={date}
          weekDates={weekDates}
          weekOptions={weekOptions}
          locationId={locationId}
          locationTimeZone={locationTimeZone}
          departmentId={departmentId}
          shiftId={shiftId}
          employeeShiftId={employeeShiftId}
          dayAssignments={boardAssignments}
          weekAssignments={matrixAssignments}
        />
      )}
      {timeOffOpen && (
        <TimeOffDialog
          onClose={() => setTimeOffOpen(false)}
          date={date}
          locationId={locationId}
          shiftId={shiftId}
        />
      )}
    </div>
  );
}
