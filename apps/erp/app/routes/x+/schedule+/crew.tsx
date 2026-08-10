import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { ValidatedForm } from "@carbon/form";
import {
  Button,
  Calendar,
  Combobox,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuIcon,
  DropdownMenuItem,
  DropdownMenuTrigger,
  HStack,
  IconButton,
  Input,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Tabs,
  TabsList,
  TabsTrigger,
  VStack
} from "@carbon/react";
import {
  getLocalTimeZone,
  now,
  parseDate,
  toCalendarDate
} from "@internationalized/date";
import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { useLocale } from "@react-aria/i18n";
import { useMemo, useState } from "react";
import {
  LuBuilding2,
  LuCalendarDays,
  LuChevronDown,
  LuChevronLeft,
  LuChevronRight,
  LuClock,
  LuCopy,
  LuEllipsisVertical,
  LuMapPin,
  LuTimer,
  LuUserX
} from "react-icons/lu";
import type { LoaderFunctionArgs } from "react-router";
import {
  redirect,
  useFetcher,
  useLoaderData,
  useNavigate,
  useSearchParams,
  useSubmit
} from "react-router";
import { CrewEmployee, DatePicker, Hidden, Submit } from "~/components/Form";
import { useLocations } from "~/components/Form/Location";
import { usePermissions } from "~/hooks";
import {
  getEmployeeDepartments,
  getEmployeeShifts,
  getShiftsWithTimes
} from "~/modules/people";
import {
  crewAbsenceRangeValidator,
  getActiveEmployeeAbilities,
  getCrewAbsences,
  getCrewAbsencesRange,
  getCrewAssignments,
  getCrewAssignmentsRange,
  getCrewCapacityOperations,
  getCrewEmployees,
  getWorkCenterRequiredAbilities,
  getWorkCenterReservationsRange
} from "~/modules/production";
import { CrewBoard } from "~/modules/production/ui/Schedule/Crew/CrewBoard";
import { CrewCapacity } from "~/modules/production/ui/Schedule/Crew/CrewCapacity";
import { CrewFilter } from "~/modules/production/ui/Schedule/Crew/CrewFilter";
import { CrewMatrix } from "~/modules/production/ui/Schedule/Crew/CrewMatrix";
import { CrewWeekBoard } from "~/modules/production/ui/Schedule/Crew/CrewWeekBoard";
import { ScheduleNavigation } from "~/modules/production/ui/Schedule/Kanban/ScheuleNavigation";
import {
  getLocationsList,
  getWorkCentersByLocation
} from "~/modules/resources";
import { getUserDefaults } from "~/modules/users/users.server";
import { makeDurations } from "~/utils/duration";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

const HOUR_MS = 3_600_000;
const CREW_VIEWS = ["board", "matrix", "capacity"] as const;
type CrewView = (typeof CREW_VIEWS)[number];

// last-resort default when a location has no shifts configured
const FALLBACK_SHIFT_HOURS = 8;

const WEEKDAY_KEYS = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday"
] as const;

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
  breadcrumb: msg`Crew`,
  to: path.to.scheduleCrew,
  module: "production"
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {});

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const dateParam = searchParams.get("date");
  const shiftId = searchParams.get("shift") || null;

  // department scope: URL param wins, cookie remembers the last choice
  const departmentParam = searchParams.get("department");
  const cookieMatch = (request.headers.get("Cookie") ?? "").match(
    /(?:^|;\s*)crewDepartment=([^;]*)/
  );
  const cookieDepartment = cookieMatch
    ? decodeURIComponent(cookieMatch[1])
    : null;
  const requestedDepartment =
    departmentParam !== null ? departmentParam : cookieDepartment;

  const timezone = getLocalTimeZone();
  const date = (
    dateParam ? parseDate(dateParam) : toCalendarDate(now(timezone))
  ).toString();

  const viewParam = searchParams.get("view");
  const view: CrewView = CREW_VIEWS.includes(viewParam as CrewView)
    ? (viewParam as CrewView)
    : "board";

  // horizon: the board assigns per day or per whole week; matrix/capacity
  // always show the selected date's Monday-start week
  const rangeParam = searchParams.get("range");
  const range: "day" | "week" =
    view === "board" && rangeParam !== "week" ? "day" : "week";

  const weekStart = parseDate(date).subtract({
    days: (new Date(`${date}T00:00:00`).getDay() + 6) % 7
  });
  const weekDates = Array.from({ length: 7 }, (_, i) =>
    weekStart.add({ days: i }).toString()
  );

  let locationId = searchParams.get("location");

  if (!locationId) {
    const userDefaults = await getUserDefaults(client, userId, companyId);
    if (userDefaults.error) {
      throw redirect(
        path.to.production,
        await flash(
          request,
          error(userDefaults.error, "Failed to load default location")
        )
      );
    }
    locationId = userDefaults.data?.locationId ?? null;
  }

  if (!locationId) {
    const locations = await getLocationsList(client, companyId);
    if (locations.error || !locations.data?.length) {
      throw redirect(
        path.to.production,
        await flash(
          request,
          error(locations.error, "Failed to load any locations")
        )
      );
    }
    locationId = locations.data?.[0].id as string;
  }

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
    getCrewAssignments(client, companyId, { locationId, date, shiftId }),
    getCrewAbsences(client, companyId, date),
    getCrewEmployees(client, companyId, locationId),
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
  // the person's own shift — stamped onto assignments as they're created, so
  // the shift filter (an exact match on the assignment) can find them later
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
  // location shift calendar: total shift hours running on each week date —
  // the uncrewed station's machine window on the capacity view
  const calendarHoursByDate: Record<string, number> = {};
  for (const day of weekDates) {
    const weekday = WEEKDAY_KEYS[new Date(`${day}T00:00:00`).getDay()];
    if (shiftRows.length === 0) {
      calendarHoursByDate[day] =
        weekday === "saturday" || weekday === "sunday"
          ? 0
          : FALLBACK_SHIFT_HOURS;
      continue;
    }
    calendarHoursByDate[day] = shiftRows.reduce((sum, shift) => {
      if (!shift[weekday]) return sum;
      return sum + (shiftHoursById[shift.id] ?? defaultShiftHours);
    }, 0);
  }

  if (assignments.error) {
    throw redirect(
      path.to.production,
      await flash(
        request,
        error(assignments.error, "Failed to load crew assignments")
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
  const demandByWorkCenter: Record<
    string,
    { pastDue: number; days: Record<string, number> }
  > = {};
  const scheduledByWorkCenter: Record<string, Record<string, number>> = {};

  if (view !== "board" || range === "week") {
    const weekStartDate = weekDates[0];
    const weekEndDate = weekDates[weekDates.length - 1];
    // overdue open operations count toward a "Past due" bucket like the
    // classic capacity board's Past Weeks column
    const lookbackStart = weekStart.subtract({ days: 28 }).toString();
    // reservation window in server-local time, matching the day bucketing below
    const weekWindowStart = new Date(`${weekStartDate}T00:00:00`);
    const weekWindowEnd = new Date(
      new Date(`${weekEndDate}T00:00:00`).getTime() + 24 * HOUR_MS
    );

    const [rangeAssignments, rangeAbsences, capacityOperations, reservations] =
      await Promise.all([
        getCrewAssignmentsRange(client, companyId, {
          locationId,
          startDate: weekStartDate,
          endDate: weekEndDate
        }),
        getCrewAbsencesRange(client, companyId, {
          startDate: weekStartDate,
          endDate: weekEndDate
        }),
        // the week board doesn't show demand — skip the heavy operation scan
        view !== "board"
          ? getCrewCapacityOperations(client, companyId, {
              locationId,
              startDate: lookbackStart,
              endDate: weekEndDate
            })
          : Promise.resolve({ data: [], error: null }),
        view === "capacity"
          ? getWorkCenterReservationsRange(client, companyId, {
              startAt: weekWindowStart.toISOString(),
              endAt: weekWindowEnd.toISOString()
            })
          : Promise.resolve({ data: [], error: null })
      ]);

    weekAssignments = rangeAssignments.data ?? [];
    weekAbsences = rangeAbsences.data ?? [];

    for (const operation of capacityOperations.data ?? []) {
      if (!operation.workCenterId || !operation.dueDate) continue;
      const durations = makeDurations(operation);
      const hours =
        (durations.setupDuration +
          durations.laborDuration +
          durations.machineDuration) /
        HOUR_MS;
      if (hours <= 0) continue;
      const bucket = (demandByWorkCenter[operation.workCenterId] ??= {
        pastDue: 0,
        days: {}
      });
      if (operation.dueDate < weekStartDate) {
        bucket.pastDue += hours;
      } else {
        bucket.days[operation.dueDate] =
          (bucket.days[operation.dueDate] ?? 0) + hours;
      }
    }

    for (const reservation of reservations.data ?? []) {
      const startMs = new Date(reservation.startAt).getTime();
      const endMs = new Date(reservation.endAt).getTime();
      const spanMs = endMs - startMs;
      if (spanMs <= 0) continue;
      // a reservation holds the station for its full span (including idle
      // overnight stretches) — distribute its actual work content
      // (workHours) across the span so a spanning op doesn't read as 24h/day
      const workMs =
        reservation.workHours != null
          ? reservation.workHours * HOUR_MS
          : spanMs;
      for (const day of weekDates) {
        const dayStartMs = new Date(`${day}T00:00:00`).getTime();
        const overlapMs =
          Math.min(endMs, dayStartMs + 24 * HOUR_MS) -
          Math.max(startMs, dayStartMs);
        if (overlapMs > 0) {
          const byDay = (scheduledByWorkCenter[reservation.resourceId] ??= {});
          byDay[day] =
            (byDay[day] ?? 0) + (overlapMs / spanMs) * (workMs / HOUR_MS);
        }
      }
    }
  }

  return {
    locationId,
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
    employeeShiftHours,
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
    calendarHoursByDate
  };
}

export default function ScheduleCrewRoute() {
  const {
    locationId,
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
    assignments,
    absences,
    employees,
    workCenters,
    requiredAbilities,
    employeeAbilities,
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
    calendarHoursByDate
  } = useLoaderData<typeof loader>();
  const { t } = useLingui();
  const { locale } = useLocale();
  const permissions = usePermissions();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const submit = useSubmit();
  const locations = useLocations();

  const [overtimeOpen, setOvertimeOpen] = useState(false);
  const [overtimeDate, setOvertimeDate] = useState(date);
  const [overtimeHoursInput, setOvertimeHoursInput] = useState("2");
  const [absenceOpen, setAbsenceOpen] = useState(false);
  const [absenceFrom, setAbsenceFrom] = useState(date);
  const [absenceTo, setAbsenceTo] = useState(date);
  const absenceFetcher = useFetcher<{}>();
  const [dateOpen, setDateOpen] = useState(false);

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

  // overtime is per PERSON per day, so preview distinct people — not rows
  // (a split person has several assignment rows for the same day)
  // only the week on screen is loaded, so a count for any other week would be
  // invented — the dialog says so instead of showing a wrong number
  const overtimeWeekIsLoaded = overtimeDate === weekDates[0];
  const overtimePreviewCount = useMemo(() => {
    const source =
      range === "day"
        ? boardAssignments.filter(() => overtimeDate === date)
        : matrixAssignments.filter((assignment) =>
            weekDates.includes(assignment.date)
          );
    // one day = distinct people; a whole week = person-DAYS, since the same
    // person crewed Mon–Fri is five separate authorizations
    return new Set(
      source
        .filter((assignment) => !shiftId || assignment.shiftId === shiftId)
        .map((assignment) =>
          range === "day"
            ? assignment.employeeId
            : `${assignment.employeeId}:${assignment.date}`
        )
    ).size;
  }, [
    range,
    boardAssignments,
    matrixAssignments,
    overtimeDate,
    weekDates,
    date,
    shiftId
  ]);

  const parsedDate = parseDate(date);
  const shortDate = (value: string) =>
    new Date(`${value}T00:00:00`).toLocaleDateString(locale, {
      month: "short",
      day: "numeric"
    });
  // "03 Aug 2026" — the month name stays localized, but the order is fixed so
  // the date can't be misread as day/month or month/day on the shop floor
  const fullDate = (value: string) => {
    const parts = new Intl.DateTimeFormat(locale, {
      day: "2-digit",
      month: "short",
      year: "numeric"
    }).formatToParts(new Date(`${value}T00:00:00`));
    const part = (type: Intl.DateTimeFormatPartTypes) =>
      parts.find((p) => p.type === type)?.value ?? "";
    return `${part("day")} ${part("month")} ${part("year")}`;
  };
  const dateLabel =
    range === "day"
      ? new Date(`${date}T00:00:00`).toLocaleDateString(locale, {
          weekday: "short",
          month: "short",
          day: "numeric"
        })
      : `${shortDate(weekDates[0])} – ${shortDate(
          weekDates[weekDates.length - 1]
        )}`;

  const navigateDate = (direction: number) => {
    const newParams = new URLSearchParams(searchParams);
    const next = parsedDate.add({
      days: range === "day" ? direction : direction * 7
    });
    newParams.set("date", next.toString());
    navigate(`?${newParams.toString()}`);
  };

  // week-range date dropdown: pick a week span, like the schedule's week
  // columns — 4 weeks back through 11 ahead around the selected week
  const weekOptions = useMemo(() => {
    if (range === "day") return [];
    const selectedStart = weekDates[0];
    const now = new Date();
    const currentWeekStart = parseDate(now.toLocaleDateString("en-CA"))
      .subtract({ days: (now.getDay() + 6) % 7 })
      .toString();
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
  }, [range, weekDates, locale]);

  // Day | Week horizon on the board (assign per day or per whole week)
  const setPeriod = (value: string) => {
    const newParams = new URLSearchParams(searchParams);
    if (value === "week") {
      newParams.set("range", "week");
    } else {
      newParams.delete("range");
    }
    navigate(`?${newParams.toString()}`);
  };

  const setView = (value: string) => {
    const newParams = new URLSearchParams(searchParams);
    if (value === "board") {
      newParams.delete("view");
    } else {
      newParams.set("view", value);
    }
    navigate(`?${newParams.toString()}`);
  };

  const goToToday = () => {
    const newParams = new URLSearchParams(searchParams);
    newParams.delete("date");
    navigate(`?${newParams.toString()}`);
  };

  const setShift = (value: string) => {
    const newParams = new URLSearchParams(searchParams);
    if (value === "all") {
      newParams.delete("shift");
    } else {
      newParams.set("shift", value);
    }
    navigate(`?${newParams.toString()}`);
  };

  const setDepartment = (value: string) => {
    const next = value === "all" ? "" : value;
    document.cookie = `crewDepartment=${encodeURIComponent(
      next
    )}; path=/; max-age=31536000; samesite=lax`;
    const newParams = new URLSearchParams(searchParams);
    if (next) {
      newParams.set("department", next);
    } else {
      newParams.delete("department");
    }
    navigate(`?${newParams.toString()}`);
  };

  const openOvertime = () => {
    setOvertimeDate(range === "day" ? date : weekDates[0]);
    setOvertimeHoursInput("2");
    setOvertimeOpen(true);
  };

  const submitBulkOvertime = () => {
    const hours = Number(overtimeHoursInput);
    if (!Number.isFinite(hours) || hours < 0) return;
    submit(
      {
        intent: "overtime-bulk",
        locationId,
        date: overtimeDate,
        ...(range === "day"
          ? {}
          : {
              toDate: parseDate(overtimeDate).add({ days: 6 }).toString()
            }),
        hours: String(hours),
        ...(departmentId ? { departmentId } : {}),
        ...(shiftId ? { shiftId } : {})
      },
      {
        method: "post",
        action: path.to.scheduleCrewUpdate,
        navigate: false,
        fetcherKey: "crew:overtime-bulk"
      }
    );
    setOvertimeOpen(false);
  };

  const copyPreviousDay = () => {
    submit(
      {
        intent: "copy",
        locationId,
        fromDate: parsedDate.add({ days: -1 }).toString(),
        toDate: date,
        ...(shiftId ? { shiftId } : {})
      },
      {
        method: "post",
        action: path.to.scheduleCrewUpdate,
        navigate: false,
        fetcherKey: "crew:copy"
      }
    );
  };

  const copyPreviousWeek = () => {
    submit(
      {
        intent: "copy-week",
        locationId,
        fromWeekStart: parseDate(weekDates[0]).subtract({ days: 7 }).toString(),
        toWeekStart: weekDates[0],
        ...(shiftId ? { shiftId } : {})
      },
      {
        method: "post",
        action: path.to.scheduleCrewUpdate,
        navigate: false,
        fetcherKey: "crew:copy-week"
      }
    );
  };

  // same crews next week: push this week forward, then follow it
  const copyToNextWeek = () => {
    const nextWeekStart = parseDate(weekDates[0]).add({ days: 7 }).toString();
    submit(
      {
        intent: "copy-week",
        locationId,
        fromWeekStart: weekDates[0],
        toWeekStart: nextWeekStart,
        ...(shiftId ? { shiftId } : {})
      },
      {
        method: "post",
        action: path.to.scheduleCrewUpdate,
        navigate: false,
        fetcherKey: "crew:copy-week"
      }
    );
    const newParams = new URLSearchParams(searchParams);
    newParams.set("date", nextWeekStart);
    navigate(`?${newParams.toString()}`);
  };

  const openAbsence = () => {
    setAbsenceFrom(date);
    setAbsenceTo(date);
    setAbsenceOpen(true);
  };

  return (
    <div className="flex flex-col h-full max-h-full overflow-auto relative">
      <HStack className="px-4 py-2 flex flex-wrap gap-y-2 justify-between bg-card border-b border-border">
        <HStack className="flex-wrap gap-y-2">
          <ScheduleNavigation />
          <CrewFilter
            categories={[
              {
                key: "location",
                header: t`Location`,
                icon: <LuMapPin />,
                options: locations,
                value: locationId,
                clearable: false
              },
              ...(departments.length > 0
                ? [
                    {
                      key: "department",
                      header: t`Department`,
                      icon: <LuBuilding2 />,
                      options: departments,
                      value: departmentId,
                      clearable: true
                    }
                  ]
                : []),
              ...(view !== "capacity" && shifts.length > 1
                ? [
                    {
                      key: "shift",
                      header: t`Shift`,
                      icon: <LuClock />,
                      options: shifts.map((shift) => ({
                        value: shift.id,
                        label: shift.name
                      })),
                      value: shiftId,
                      clearable: true
                    }
                  ]
                : [])
            ]}
            onChange={(key, value) => {
              if (key === "location") {
                if (!value) return;
                const newParams = new URLSearchParams(searchParams);
                newParams.set("location", value);
                window.location.href = `${
                  path.to.scheduleCrew
                }?${newParams.toString()}`;
              } else if (key === "department") {
                setDepartment(value ?? "all");
              } else if (key === "shift") {
                setShift(value ?? "all");
              }
            }}
          />
          <Tabs value={view} onValueChange={setView}>
            <TabsList>
              <TabsTrigger value="board">
                <Trans>Board</Trans>
              </TabsTrigger>
              <TabsTrigger value="matrix">
                <Trans>Matrix</Trans>
              </TabsTrigger>
              <TabsTrigger value="capacity">
                <Trans>Capacity</Trans>
              </TabsTrigger>
            </TabsList>
          </Tabs>
          {view === "board" && (
            <Tabs value={range} onValueChange={setPeriod}>
              <TabsList>
                <TabsTrigger value="day">
                  <Trans>Day</Trans>
                </TabsTrigger>
                <TabsTrigger value="week">
                  <Trans>Week</Trans>
                </TabsTrigger>
              </TabsList>
            </Tabs>
          )}
        </HStack>

        <HStack className="flex-wrap gap-y-2">
          {range === "day" && permissions.can("update", "production") && (
            <Button
              variant="secondary"
              leftIcon={<LuCopy />}
              onClick={copyPreviousDay}
            >
              <Trans>Copy previous day</Trans>
            </Button>
          )}
          {range === "week" && permissions.can("update", "production") && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="secondary"
                  leftIcon={<LuCopy />}
                  rightIcon={<LuChevronDown />}
                >
                  <Trans>Copy week</Trans>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={copyPreviousWeek}>
                  <Trans>From previous week</Trans>
                </DropdownMenuItem>
                <DropdownMenuItem onClick={copyToNextWeek}>
                  <Trans>To next week</Trans>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          <HStack>
            <Button variant="secondary" onClick={goToToday}>
              <Trans>Today</Trans>
            </Button>
            <IconButton
              variant="secondary"
              onClick={() => navigateDate(-1)}
              icon={<LuChevronLeft />}
              aria-label={range === "day" ? t`Previous Day` : t`Previous Week`}
            />
            <Popover open={dateOpen} onOpenChange={setDateOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="secondary"
                  className="min-w-[150px]"
                  leftIcon={<LuCalendarDays />}
                >
                  {dateLabel}
                </Button>
              </PopoverTrigger>
              <PopoverContent
                className={range === "day" ? "w-auto p-4" : "w-64 p-2"}
              >
                {range === "day" ? (
                  <Calendar
                    value={parsedDate}
                    onChange={(value) => {
                      if (!value) return;
                      const newParams = new URLSearchParams(searchParams);
                      newParams.set("date", value.toString());
                      setDateOpen(false);
                      navigate(`?${newParams.toString()}`);
                    }}
                  />
                ) : (
                  <div className="flex max-h-80 flex-col gap-0.5 overflow-auto">
                    {weekOptions.map((week) => (
                      <button
                        key={week.start}
                        type="button"
                        className={cn(
                          "flex items-center justify-between rounded-md px-3 py-2 text-sm transition-colors hover:bg-muted",
                          week.isSelected && "bg-muted font-medium"
                        )}
                        onClick={() => {
                          const newParams = new URLSearchParams(searchParams);
                          newParams.set("date", week.start);
                          setDateOpen(false);
                          navigate(`?${newParams.toString()}`);
                        }}
                      >
                        <span className="tabular-nums">{week.label}</span>
                        {week.isCurrent && (
                          <span className="text-[11px] font-medium text-primary">
                            <Trans>This week</Trans>
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </PopoverContent>
            </Popover>
            <IconButton
              variant="secondary"
              onClick={() => navigateDate(1)}
              icon={<LuChevronRight />}
              aria-label={range === "day" ? t`Next Day` : t`Next Week`}
            />
            {permissions.can("update", "production") && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <IconButton
                    variant="secondary"
                    icon={<LuEllipsisVertical />}
                    aria-label={t`More options`}
                  />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={openOvertime}>
                    <DropdownMenuIcon icon={<LuTimer />} />
                    <Trans>Overtime</Trans>
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={openAbsence}>
                    <DropdownMenuIcon icon={<LuUserX />} />
                    <Trans>Time off</Trans>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </HStack>
        </HStack>
      </HStack>
      <div className="flex flex-grow h-full items-stretch overflow-hidden relative">
        {view === "board" &&
          (range === "week" ? (
            <CrewWeekBoard
              weekDates={weekDates}
              shiftId={shiftId}
              locationId={locationId}
              employees={employeesForMatrix}
              workCenters={displayedWorkCenters}
              assignments={matrixAssignments}
              absences={weekAbsences}
              employeeShiftId={employeeShiftId}
            />
          ) : (
            <CrewBoard
              date={date}
              shiftId={shiftId}
              locationId={locationId}
              employees={employeesForBoard}
              workCenters={displayedWorkCenters}
              assignments={boardAssignments}
              absences={absences}
              requiredAbilities={requiredAbilities}
              employeeAbilities={employeeAbilities}
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
          <CrewMatrix
            weekDates={weekDates}
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
          <CrewCapacity
            weekDates={weekDates}
            workCenters={displayedWorkCenters}
            assignments={matrixAssignments}
            absences={weekAbsences}
            demandByWorkCenter={demandByWorkCenter}
            scheduledByWorkCenter={scheduledByWorkCenter}
            shiftHoursById={shiftHoursById}
            employeeShiftHours={employeeShiftHours}
            defaultShiftHours={defaultShiftHours}
            calendarHoursByDate={calendarHoursByDate}
          />
        )}
      </div>

      <Modal
        open={overtimeOpen}
        onOpenChange={(open) => {
          if (!open) setOvertimeOpen(false);
        }}
      >
        <ModalContent>
          <ModalHeader>
            <ModalTitle>
              <Trans>Add overtime</Trans>
            </ModalTitle>
          </ModalHeader>
          <ModalBody>
            <VStack spacing={4}>
              <p className="text-sm text-muted-foreground text-pretty">
                {range === "day" ? (
                  <Trans>
                    Everyone working this day stays on past their shift by the
                    hours you set. Only the departments and shifts you're
                    filtering by are affected.
                  </Trans>
                ) : (
                  <Trans>
                    Everyone working any day of the week you pick stays on past
                    their shift by the hours you set. Only the departments and
                    shifts you're filtering by are affected.
                  </Trans>
                )}
              </p>
              {/* the horizon sets the unit: one visible day needs no picker, a
                  week horizon picks a WEEK — the same list the header uses */}
              {range === "day" ? (
                <span className="text-sm font-medium">
                  {fullDate(overtimeDate)}
                </span>
              ) : (
                <div className="w-full">
                  <Combobox
                    asButton
                    size="sm"
                    value={overtimeDate}
                    options={weekOptions.map((week) => ({
                      value: week.start,
                      label: week.isCurrent
                        ? `${week.label} · ${t`This week`}`
                        : week.label
                    }))}
                    onChange={(value) => setOvertimeDate(value || weekDates[0])}
                  />
                </div>
              )}
              <Input
                type="number"
                min={0}
                max={16}
                step={0.5}
                value={overtimeHoursInput}
                onChange={(event) => setOvertimeHoursInput(event.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                {range === "day" ? (
                  <Trans>
                    This will set +{overtimeHoursInput}h of overtime for{" "}
                    {overtimePreviewCount} people.
                  </Trans>
                ) : overtimeWeekIsLoaded ? (
                  // person-days, not people — the same person crewed Mon–Fri is
                  // five separate authorizations
                  <Trans>
                    This will set +{overtimeHoursInput}h of overtime on{" "}
                    {overtimePreviewCount} person-days.
                  </Trans>
                ) : (
                  // that week's crew isn't loaded, so any number here would be
                  // invented
                  <Trans>
                    This will set +{overtimeHoursInput}h of overtime for
                    everyone crewed that week.
                  </Trans>
                )}
              </p>
            </VStack>
          </ModalBody>
          <ModalFooter>
            <HStack>
              <Button
                variant="secondary"
                onClick={() => setOvertimeOpen(false)}
              >
                <Trans>Cancel</Trans>
              </Button>
              <Button onClick={submitBulkOvertime}>
                <Trans>Apply</Trans>
              </Button>
            </HStack>
          </ModalFooter>
        </ModalContent>
      </Modal>

      <Modal
        open={absenceOpen}
        onOpenChange={(open) => {
          if (!open) setAbsenceOpen(false);
        }}
      >
        <ModalContent>
          <ValidatedForm
            validator={crewAbsenceRangeValidator}
            method="post"
            action={path.to.scheduleCrewUpdate}
            fetcher={absenceFetcher}
            defaultValues={{
              employeeId: "",
              fromDate: absenceFrom,
              toDate: absenceTo
            }}
            onSubmit={() => setAbsenceOpen(false)}
          >
            <ModalHeader>
              <ModalTitle>
                <Trans>Time off</Trans>
              </ModalTitle>
            </ModalHeader>
            <ModalBody>
              <Hidden name="intent" value="absent-range" />
              <Hidden name="shiftId" value={shiftId ?? ""} />
              <VStack spacing={4}>
                <p className="text-sm text-muted-foreground text-pretty">
                  <Trans>
                    Marks the person off for every day in the range. They won't
                    be scheduled while they're away.
                  </Trans>
                </p>
                <CrewEmployee
                  name="employeeId"
                  label={t`Employee`}
                  locationId={locationId}
                />
                <HStack className="w-full items-start" spacing={4}>
                  <DatePicker
                    name="fromDate"
                    label={t`From`}
                    value={absenceFrom}
                    maxValue={parseDate(absenceTo)}
                    onChange={(value) => {
                      if (value) setAbsenceFrom(value);
                    }}
                  />
                  <DatePicker
                    name="toDate"
                    label={t`To`}
                    value={absenceTo}
                    minValue={parseDate(absenceFrom)}
                    onChange={(value) => {
                      if (value) setAbsenceTo(value);
                    }}
                  />
                </HStack>
              </VStack>
            </ModalBody>
            <ModalFooter>
              <HStack>
                <Button
                  variant="secondary"
                  onClick={() => setAbsenceOpen(false)}
                >
                  <Trans>Cancel</Trans>
                </Button>
                <Submit>
                  <Trans>Mark absent</Trans>
                </Submit>
              </HStack>
            </ModalFooter>
          </ValidatedForm>
        </ModalContent>
      </Modal>
    </div>
  );
}
