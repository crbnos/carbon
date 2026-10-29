// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { formatDate, redirect } from "@carbon/utils";
import {
  fromAbsolute,
  getLocalTimeZone,
  now,
  parseDate,
  startOfWeek,
  toCalendarDate,
  today
} from "@internationalized/date";
import { msg } from "@lingui/core/macro";
import { useLocale } from "@react-aria/i18n";
import { useCallback, useMemo, useState } from "react";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import {
  getEmployeeDepartments,
  getEmployeeShifts,
  getShiftsWithTimes,
  getShiftsWithTimesByIds
} from "~/modules/people/people.service";
import {
  attendedHoursByDay,
  buildPeopleCapacityBuckets,
  getActiveEmployeeAbilities,
  getHolidayDates,
  getLocationEmployees,
  getOperationAttendedShares,
  getPeopleAbsences,
  getPeopleAbsencesRange,
  getPeopleAssignments,
  getPeopleAssignmentsRange,
  getPeopleCapacityOperations,
  getShiftWorkingWindows,
  getWorkCenterOutages,
  getWorkCenterRequiredAbilities,
  getWorkCenterReservationsRange,
  getWorkCenterShifts,
  getWorkCenterWorkingWindows,
  withoutOutages,
  workingHoursByDay
} from "~/modules/production/production.service";
import { OvertimeDialog } from "~/modules/production/ui/Schedule/People/OvertimeDialog";
import { PeopleBoard } from "~/modules/production/ui/Schedule/People/PeopleBoard";
import { PeopleCapacity } from "~/modules/production/ui/Schedule/People/PeopleCapacity";
import { PeopleHeader } from "~/modules/production/ui/Schedule/People/PeopleHeader";
import { PeopleMatrix } from "~/modules/production/ui/Schedule/People/PeopleMatrix";
import { PeopleWeekBoard } from "~/modules/production/ui/Schedule/People/PeopleWeekBoard";
import { assignmentMatchesShift } from "~/modules/production/ui/Schedule/People/peopleShared";
import { TimeOffDialog } from "~/modules/production/ui/Schedule/People/TimeOffDialog";
import { getWorkCentersByLocation } from "~/modules/resources/resources.service";
import {
  getLocationTimeZone,
  resolveLocationId
} from "~/modules/shared/shared.service";
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
  const requestedShiftId = searchParams.get("shift") || null;

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
  // An inactive, deleted or other-location shift from an old link reads as
  // All shifts, like the department: every view would otherwise count it
  // differently (Coverage as the whole day, the board as nobody).
  const shiftId =
    requestedShiftId && shiftRows.some((shift) => shift.id === requestedShiftId)
      ? requestedShiftId
      : null;
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
  let capacityHolidayDates: string[] = [];
  // hands-on hours booked per station per day — the Matrix's Coverage
  let attendedByWorkCenter: Record<string, Record<string, number>> = {};

  if (view !== "board" || range === "week") {
    // Capacity and Coverage both read the stations' working time.
    const needsCalendar = view === "capacity" || view === "matrix";
    const weekStartDate = weekDates[0];
    const weekEndDate = weekDates[weekDates.length - 1];
    // reservation window on the plant's calendar, matching the day bucketing
    // below — day boundaries via CalendarDate.toDate(tz) so DST weeks bucket
    // correctly
    const weekWindowStart = parseDate(weekStartDate).toDate(timezone);
    const weekWindowEnd = parseDate(weekEndDate)
      .add({ days: 1 })
      .toDate(timezone);

    const capacityWorkCenterIds = needsCalendar
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
      // only Capacity shows due-date demand — skip the heavy operation scan.
      // Null start = no floor: Past due spans back to the earliest open op.
      view === "capacity"
        ? getPeopleCapacityOperations(client, companyId, {
            locationId,
            startDate: null,
            endDate: weekEndDate
          })
        : Promise.resolve({ data: [], error: null }),
      needsCalendar
        ? getWorkCenterReservationsRange(client, companyId, {
            startAt: weekWindowStart.toISOString(),
            endAt: weekWindowEnd.toISOString()
          })
        : Promise.resolve({ data: [], error: null }),
      capacityWorkCenterIds.length > 0
        ? getWorkCenterShifts(client, companyId, capacityWorkCenterIds)
        : Promise.resolve({ data: [], error: null })
    ]);

    for (const [read, message] of [
      [rangeAssignments, "Failed to load people assignments"],
      [rangeAbsences, "Failed to load absences"],
      [capacityOperations, "Failed to load operations"],
      [reservations, "Failed to load the schedule"],
      [workCenterShiftRows, "Failed to load work center shifts"]
    ] as const) {
      if (read.error) {
        throw redirect(
          path.to.production,
          await flash(request, error(read.error, message))
        );
      }
    }
    weekAssignments = rangeAssignments.data ?? [];
    weekAbsences = rangeAbsences.data ?? [];

    // The stations' working windows, resolved by the scheduler's own ladder
    // (shifts, holidays, open maintenance downtime): Available, the share of
    // a booking each day gets, and Coverage all read them.
    let calendarHoursMap = new Map<string, Map<string, number>>();
    let workingWindowsByWorkCenter:
      | ReturnType<typeof getWorkCenterWorkingWindows>
      | undefined;
    // Only this location's stations: the read spans the company.
    const stationIds = new Set(capacityWorkCenterIds);
    const stationReservations = (reservations.data ?? []).filter(
      (reservation) => stationIds.has(reservation.resourceId)
    );
    if (needsCalendar) {
      const wcShiftLinks = workCenterShiftRows.data ?? [];
      // A booking can run past the week on either side; its working windows
      // (and holidays) are needed across its whole span to divide its hours.
      let spanStartMs = weekWindowStart.getTime();
      let spanEndMs = weekWindowEnd.getTime();
      for (const reservation of stationReservations) {
        spanStartMs = Math.min(spanStartMs, Date.parse(reservation.startAt));
        spanEndMs = Math.max(spanEndMs, Date.parse(reservation.endAt));
      }
      // A station can be linked to a shift of another location.
      const locationShiftIds = new Set(shiftRows.map((shift) => shift.id));
      const otherShiftIds = [
        ...new Set(
          wcShiftLinks
            .map((link) => link.shiftId)
            .filter((id) => !locationShiftIds.has(id))
        )
      ];
      const [holidays, otherShifts, outages, attendedShares] =
        await Promise.all([
          getHolidayDates(client, companyId, {
            from: toCalendarDate(
              fromAbsolute(spanStartMs, timezone)
            ).toString(),
            to: toCalendarDate(fromAbsolute(spanEndMs, timezone)).toString()
          }),
          otherShiftIds.length > 0
            ? getShiftsWithTimesByIds(client, companyId, otherShiftIds)
            : Promise.resolve({ data: [], error: null }),
          getWorkCenterOutages(client, companyId, {
            workCenterIds: capacityWorkCenterIds,
            rangeEnd: spanEndMs
          }),
          view === "matrix"
            ? getOperationAttendedShares(
                client,
                companyId,
                stationReservations.map((r) => r.operationId)
              )
            : Promise.resolve({
                data: new Map<string, { share: number; gated: boolean }>(),
                error: null
              })
        ]);
      for (const [read, message] of [
        [holidays, "Failed to load holidays"],
        [otherShifts, "Failed to load shifts"],
        [outages, "Failed to load maintenance downtime"],
        [attendedShares, "Failed to load operations"]
      ] as const) {
        if (read.error) {
          throw redirect(
            path.to.production,
            await flash(request, error(read.error, message))
          );
        }
      }
      const holidayDates = holidays.data;
      capacityHolidayDates = [...holidayDates];
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
      const windows = withoutOutages(
        getWorkCenterWorkingWindows({
          workCenters: ladderWorkCenters,
          workCenterShifts: wcShiftLinks,
          shifts: shiftRows,
          linkedShifts: otherShifts.data ?? [],
          timeZone: timezone,
          holidayDates,
          rangeStart: spanStartMs,
          rangeEnd: spanEndMs
        }),
        outages.data
      );
      workingWindowsByWorkCenter = windows;
      calendarHoursMap = workingHoursByDay({
        windowsByWorkCenter: windows,
        weekDates,
        timezone
      });
      const wcHasOwnShifts = new Set(
        wcShiftLinks.map((link) => link.workCenterId)
      );
      for (const workCenter of ladderWorkCenters) {
        capacityRungByWorkCenter[workCenter.id] =
          workCenter.alwaysOn || wcHasOwnShifts.has(workCenter.id)
            ? 1
            : shiftRows.length > 0
              ? 2
              : 3;
      }
      calendarHoursByWorkCenter = Object.fromEntries(
        [...calendarHoursMap].map(([wcId, byDay]) => [
          wcId,
          Object.fromEntries(byDay)
        ])
      );
      if (view === "matrix") {
        attendedByWorkCenter = attendedHoursByDay({
          weekDates,
          timezone,
          reservations: stationReservations,
          attendedShareByOperation: attendedShares.data,
          windowsByWorkCenter: windows,
          lightsOut: new Set(
            ladderWorkCenters.flatMap((wc) => (wc.alwaysOn ? [wc.id] : []))
          ),
          // A shift tab compares the shift's people with the work booked in
          // that shift's own hours, not the whole day's.
          within: shiftId
            ? (getShiftWorkingWindows({
                shiftId,
                shifts: shiftRows,
                linkedShifts: otherShifts.data ?? [],
                timeZone: timezone,
                holidayDates,
                rangeStart: spanStartMs,
                rangeEnd: spanEndMs
              }) ?? undefined)
            : undefined
        });
      }
    }

    const buckets = buildPeopleCapacityBuckets({
      weekDates,
      timezone,
      operations: capacityOperations.data ?? [],
      reservations: stationReservations,
      calendarHoursByWorkCenter: calendarHoursMap,
      workingWindowsByWorkCenter
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
    if (dayOperations.error) {
      throw redirect(
        path.to.production,
        await flash(
          request,
          error(dayOperations.error, "Failed to load operations")
        )
      );
    }
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
      // Expiring today = not qualified today, as in the scheduler and MES.
      if (row.expiresAt && row.expiresAt.slice(0, 10) <= date) continue;
      const ability = Array.isArray(row.ability) ? row.ability[0] : row.ability;
      // The ability's name IS the linked process's name.
      const process = Array.isArray(ability?.process)
        ? ability?.process[0]
        : ability?.process;
      const name = process?.name;
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
    // every shift: the board filters by shift, and its day editor needs the
    // person's own shift whatever the page shows
    assignments: assignments.data ?? [],
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
    capacityRungByWorkCenter,
    capacityHolidayDates,
    attendedByWorkCenter
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
    capacityRungByWorkCenter,
    capacityHolidayDates,
    attendedByWorkCenter
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

  // shift scope resolves through the ladder (the row's stamped shift, else the
  // person's own shift) — an exact match on the stamped shift alone would hide
  // every assignment created before the person's shift was set
  const boardAssignments = useMemo(
    () =>
      assignments.filter(
        (assignment) =>
          assignmentMatchesShift(assignment, shiftId, employeeShiftId) &&
          (!departmentId || displayedWorkCenterIds.has(assignment.workCenterId))
      ),
    [
      assignments,
      shiftId,
      employeeShiftId,
      departmentId,
      displayedWorkCenterIds
    ]
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

  // The department filter never HIDES people from the roster — it floats the
  // department's own people (employeeJob) to the top of the list and leaves
  // everyone else in place below them (a stable partition), so the whole roster
  // stays draggable. Only the shift filter still narrows the roster, and even
  // then anyone already assigned stays visible so a filter can't hide someone
  // you actually scheduled.
  const orderDepartmentFirst = useCallback(
    (list: typeof employees) =>
      departmentId
        ? [
            ...list.filter(
              (employee) => employeeDepartments[employee.id] === departmentId
            ),
            ...list.filter(
              (employee) => employeeDepartments[employee.id] !== departmentId
            )
          ]
        : list,
    [departmentId, employeeDepartments]
  );
  const filterByShift = useCallback(
    (list: typeof employees, assigned: Set<string>) =>
      shiftId
        ? list.filter(
            (employee) =>
              assigned.has(employee.id) ||
              fitsShiftFilter(employee.id, shiftId, employeeShiftId)
          )
        : list,
    [shiftId, employeeShiftId]
  );
  // Assigned in the shift at ANY station: someone booked only at stations the
  // department hides still shows (the board's "working at" card, the
  // Matrix's greyed chip).
  const assignedInShift = useCallback(
    (rows: { employeeId: string; shiftId: string | null }[]) =>
      new Set(
        rows
          .filter((row) =>
            assignmentMatchesShift(row, shiftId, employeeShiftId)
          )
          .map((row) => row.employeeId)
      ),
    [shiftId, employeeShiftId]
  );
  const employeesForBoard = useMemo(
    () =>
      orderDepartmentFirst(
        filterByShift(employees, assignedInShift(assignments))
      ),
    [
      employees,
      assignments,
      assignedInShift,
      filterByShift,
      orderDepartmentFirst
    ]
  );
  const employeesForMatrix = useMemo(
    () =>
      orderDepartmentFirst(
        filterByShift(employees, assignedInShift(weekAssignments))
      ),
    [
      employees,
      weekAssignments,
      assignedInShift,
      filterByShift,
      orderDepartmentFirst
    ]
  );

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
              assignmentsElsewhere={
                departmentId
                  ? weekAssignments.filter(
                      (assignment) =>
                        !displayedWorkCenterIds.has(assignment.workCenterId)
                    )
                  : undefined
              }
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
              dayAssignments={assignments}
              allWorkCenters={workCenters}
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
            departmentId={departmentId}
            employeeDepartments={employeeDepartments}
            workCenters={displayedWorkCenters}
            allWorkCenters={workCenters}
            assignments={weekAssignments}
            absences={weekAbsences}
            attendedByWorkCenter={attendedByWorkCenter}
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
            holidayDates={capacityHolidayDates}
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
