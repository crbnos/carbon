// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { formatDate, redirect, richTextToPlainText } from "@carbon/utils";
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
import { useMemo } from "react";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import {
  getDepartmentsList,
  getEmployeeDepartments,
  getEmployeeShifts,
  getShiftsWithTimes
} from "~/modules/people/people.service";
import {
  getLocationEmployees,
  getPeopleAbsencesRange
} from "~/modules/production/production.service";
import {
  getServiceBacklog,
  getServiceJobAssignmentsRange
} from "~/modules/service/service.service";
import type {
  ScheduleAssignment,
  ScheduleBacklogJob
} from "~/modules/service/ui/Schedule/ServiceSchedule";
import { ServiceSchedule } from "~/modules/service/ui/Schedule/ServiceSchedule";
import { ServiceScheduleHeader } from "~/modules/service/ui/Schedule/ServiceScheduleHeader";
import {
  getLocationTimeZone,
  resolveLocationId
} from "~/modules/shared/shared.service";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

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

/** A to-one embed, whichever shape PostgREST types it as. */
function one<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

export const handle: Handle = {
  breadcrumb: msg`Schedule`,
  to: path.to.serviceSchedule
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {
    view: "service",
    role: "employee"
  });

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const dateParam = searchParams.get("date");

  // department scope: URL param wins, cookie remembers the last choice
  const departmentParam = searchParams.get("department");
  const cookieMatch = (request.headers.get("Cookie") ?? "").match(
    /(?:^|;\s*)serviceScheduleDepartment=([^;]*)/
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
    onDefaultsError: path.to.serviceJobs,
    onNoLocations: path.to.serviceJobs
  });

  // The grid's "today" belongs to the location being dispatched, not the server.
  const timezone = await getLocationTimeZone(client, locationId, companyId);
  const date = (
    dateParam ? parseDate(dateParam) : toCalendarDate(now(timezone))
  ).toString();

  const weekStart = startOfWeek(parseDate(date), "en-GB"); // en-GB uses Monday as first day
  const weekDates = Array.from({ length: 7 }, (_, i) =>
    weekStart.add({ days: i }).toString()
  );
  const startDate = weekDates[0];
  const endDate = weekDates[weekDates.length - 1];

  const [
    employees,
    absences,
    employeeJobs,
    departmentRows,
    employeeShiftRows,
    shifts,
    assignments,
    backlog
  ] = await Promise.all([
    getLocationEmployees(client, companyId, locationId),
    getPeopleAbsencesRange(client, companyId, { startDate, endDate }),
    getEmployeeDepartments(client, companyId),
    getDepartmentsList(client, companyId),
    getEmployeeShifts(client, companyId),
    getShiftsWithTimes(client, companyId, locationId),
    getServiceJobAssignmentsRange(client, companyId, {
      startDate,
      endDate,
      locationId
    }),
    getServiceBacklog(client, companyId, locationId)
  ]);

  if (assignments.error || backlog.error) {
    throw redirect(
      path.to.serviceJobs,
      await flash(
        request,
        error(
          assignments.error ?? backlog.error,
          "Failed to load the service schedule"
        )
      )
    );
  }

  const locationEmployees = (employees.data ?? []).flatMap((employee) =>
    employee.id
      ? [
          {
            id: employee.id,
            name: employee.name,
            avatarUrl: employee.avatarUrl
          }
        ]
      : []
  );

  // The department filter offers the departments this location's people are in.
  const employeeDepartments: Record<string, string | null> = {};
  for (const row of employeeJobs.data ?? []) {
    employeeDepartments[row.id] = row.departmentId;
  }
  const locationDepartmentIds = new Set(
    locationEmployees.flatMap((employee) => {
      const departmentId = employeeDepartments[employee.id];
      return departmentId ? [departmentId] : [];
    })
  );
  const departments = (departmentRows.data ?? [])
    .filter((department) => locationDepartmentIds.has(department.id))
    .map((department) => ({ value: department.id, label: department.name }));
  const departmentId =
    requestedDepartment &&
    requestedDepartment !== "all" &&
    locationDepartmentIds.has(requestedDepartment)
      ? requestedDepartment
      : null;

  // The shift-hours ladder the People board uses: the person's own shift, else
  // the location's most common shift length.
  const shiftHoursById: Record<string, number> = {};
  for (const shift of shifts.data ?? []) {
    const hours = shiftDurationHours(shift.startTime, shift.endTime);
    if (hours !== null) shiftHoursById[shift.id] = hours;
  }
  const durationCounts = new Map<number, number>();
  for (const hours of Object.values(shiftHoursById)) {
    durationCounts.set(hours, (durationCounts.get(hours) ?? 0) + 1);
  }
  const defaultShiftHours =
    [...durationCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ??
    FALLBACK_SHIFT_HOURS;
  const employeeShiftHours: Record<string, number> = {};
  for (const row of employeeShiftRows.data ?? []) {
    const hours = shiftHoursById[row.shiftId];
    if (hours !== undefined) employeeShiftHours[row.employeeId] = hours;
  }

  const scheduleAssignments: ScheduleAssignment[] = (
    assignments.data ?? []
  ).map((assignment) => {
    const job = one(assignment.serviceJob);
    return {
      id: assignment.id,
      serviceJobId: assignment.serviceJobId,
      jobReadableId: job?.serviceJobId ?? "",
      customerName: one(job?.customer)?.name ?? null,
      status: job?.status ?? null,
      employeeId: assignment.employeeId,
      date: assignment.scheduledDate,
      plannedHours:
        assignment.plannedHours === null
          ? null
          : Number(assignment.plannedHours),
      note: assignment.note
    };
  });

  const backlogJobs: ScheduleBacklogJob[] = (backlog.data ?? []).map((job) => ({
    id: job.id,
    jobReadableId: job.serviceJobId,
    customerName: one(job.customer)?.name ?? null,
    status: job.status,
    priority: job.priority,
    dueDate: job.dueDate,
    problem: richTextToPlainText(job.problem) || null
  }));

  return {
    locationId,
    locationTimeZone: timezone,
    date,
    weekDates,
    departmentId,
    departments,
    employeeDepartments,
    employees: locationEmployees,
    absences: absences.data ?? [],
    assignments: scheduleAssignments,
    backlog: backlogJobs,
    shiftHoursById,
    employeeShiftHours,
    defaultShiftHours
  };
}

export default function ServiceScheduleRoute() {
  const {
    locationId,
    locationTimeZone,
    date,
    weekDates,
    departmentId,
    departments,
    employeeDepartments,
    employees,
    absences,
    assignments,
    backlog,
    shiftHoursById,
    employeeShiftHours,
    defaultShiftHours
  } = useLoaderData<typeof loader>();
  const { locale } = useLocale();

  const shortDate = (value: string) =>
    formatDate(value, { month: "short", day: "numeric" }, locale);
  const dateLabel = `${shortDate(weekDates[0])} – ${shortDate(
    weekDates[weekDates.length - 1]
  )}`;

  // 4 weeks back through 11 ahead around the selected week, as on People
  const weekOptions = useMemo(() => {
    const label = (value: string) =>
      formatDate(value, { month: "short", day: "numeric" }, locale);
    const selectedStart = weekDates[0];
    const currentWeekStart = startOfWeek(
      today(locationTimeZone ?? getLocalTimeZone()),
      "en-GB"
    ).toString();
    const base = parseDate(selectedStart);
    return Array.from({ length: 16 }, (_, i) => {
      const start = base.add({ days: (i - 4) * 7 });
      const startString = start.toString();
      return {
        start: startString,
        label: `${label(startString)} – ${label(
          start.add({ days: 6 }).toString()
        )}`,
        isSelected: startString === selectedStart,
        isCurrent: startString === currentWeekStart
      };
    });
  }, [weekDates, locale, locationTimeZone]);

  return (
    <div className="flex flex-col h-full max-h-full overflow-auto relative">
      <ServiceScheduleHeader
        date={date}
        dateLabel={dateLabel}
        weekOptions={weekOptions}
        locationId={locationId}
        departmentId={departmentId}
        departments={departments}
      />
      <div className="flex flex-grow h-full items-stretch overflow-hidden relative">
        <ServiceSchedule
          weekDates={weekDates}
          locationTimeZone={locationTimeZone}
          employees={employees}
          departmentId={departmentId}
          employeeDepartments={employeeDepartments}
          assignments={assignments}
          absences={absences}
          backlog={backlog}
          shiftHoursById={shiftHoursById}
          employeeShiftHours={employeeShiftHours}
          defaultShiftHours={defaultShiftHours}
        />
      </div>
    </div>
  );
}
