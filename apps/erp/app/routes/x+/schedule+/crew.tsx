import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import {
  Button,
  Combobox,
  HStack,
  IconButton,
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
import {
  LuChevronLeft,
  LuChevronRight,
  LuClock,
  LuCopy,
  LuSettings2
} from "react-icons/lu";
import type { LoaderFunctionArgs } from "react-router";
import {
  redirect,
  useLoaderData,
  useNavigate,
  useSearchParams,
  useSubmit
} from "react-router";
import { useLocations } from "~/components/Form/Location";
import { usePermissions } from "~/hooks";
import { getEmployeeShifts, getShiftsWithTimes } from "~/modules/people";
import {
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
import { CrewMatrix } from "~/modules/production/ui/Schedule/Crew/CrewMatrix";
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

  const timezone = getLocalTimeZone();
  const date = (
    dateParam ? parseDate(dateParam) : toCalendarDate(now(timezone))
  ).toString();

  const viewParam = searchParams.get("view");
  const view: CrewView = CREW_VIEWS.includes(viewParam as CrewView)
    ? (viewParam as CrewView)
    : "board";

  // Monday-start week containing the selected date (matrix + capacity views)
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
    shifts
  ] = await Promise.all([
    getCrewAssignments(client, companyId, { locationId, date, shiftId }),
    getCrewAbsences(client, companyId, date),
    getCrewEmployees(client, companyId, locationId),
    getWorkCentersByLocation(client, locationId),
    getWorkCenterRequiredAbilities(client, companyId, locationId),
    getActiveEmployeeAbilities(client, companyId),
    getShiftsWithTimes(client, companyId, locationId)
  ]);

  const shiftRows = shifts.data ?? [];
  const shiftHoursById: Record<string, number> = {};
  for (const shift of shiftRows) {
    const hours = shiftDurationHours(shift.startTime, shift.endTime);
    if (hours !== null) shiftHoursById[shift.id] = hours;
  }
  // last-resort duration for a person with no shift anywhere: the most
  // common shift length at the location (not alphabetical-first)
  const durationCounts = new Map<number, number>();
  for (const hours of Object.values(shiftHoursById)) {
    durationCounts.set(hours, (durationCounts.get(hours) ?? 0) + 1);
  }
  const defaultShiftHours =
    [...durationCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ??
    FALLBACK_SHIFT_HOURS;
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
  }[] = [];
  let weekAbsences: { id: string; employeeId: string; date: string }[] = [];
  const employeeShiftHours: Record<string, number> = {};
  const demandByWorkCenter: Record<
    string,
    { pastDue: number; days: Record<string, number> }
  > = {};
  const scheduledByWorkCenter: Record<string, Record<string, number>> = {};

  if (view !== "board") {
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

    const [
      rangeAssignments,
      rangeAbsences,
      employeeShifts,
      capacityOperations,
      reservations
    ] = await Promise.all([
      getCrewAssignmentsRange(client, companyId, {
        locationId,
        startDate: weekStartDate,
        endDate: weekEndDate
      }),
      getCrewAbsencesRange(client, companyId, {
        startDate: weekStartDate,
        endDate: weekEndDate
      }),
      getEmployeeShifts(client, companyId),
      getCrewCapacityOperations(client, companyId, {
        locationId,
        startDate: lookbackStart,
        endDate: weekEndDate
      }),
      view === "capacity"
        ? getWorkCenterReservationsRange(client, companyId, {
            startAt: weekWindowStart.toISOString(),
            endAt: weekWindowEnd.toISOString()
          })
        : Promise.resolve({ data: [], error: null })
    ]);

    weekAssignments = rangeAssignments.data ?? [];
    weekAbsences = rangeAbsences.data ?? [];

    // each person's own shift (employeeShift) — the honest source for
    // all-day assignments that carry no shift of their own
    for (const row of employeeShifts.data ?? []) {
      const hours = shiftHoursById[row.shiftId];
      if (hours !== undefined) {
        employeeShiftHours[row.employeeId] = hours;
      }
    }

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

  const parsedDate = parseDate(date);
  const shortDate = (value: string) =>
    new Date(`${value}T00:00:00`).toLocaleDateString(locale, {
      month: "short",
      day: "numeric"
    });
  const dateLabel =
    view === "board"
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
    const days = view === "board" ? direction : direction * 7;
    newParams.set("date", parsedDate.add({ days }).toString());
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

  return (
    <div className="flex flex-col h-full max-h-full overflow-auto relative">
      <HStack className="px-4 py-2 flex flex-wrap gap-y-2 justify-between bg-card border-b border-border">
        <HStack className="flex-wrap gap-y-2">
          <ScheduleNavigation />
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
        </HStack>

        <HStack className="flex-wrap gap-y-2">
          {view === "board" && permissions.can("update", "production") && (
            <Button
              variant="secondary"
              leftIcon={<LuCopy />}
              onClick={copyPreviousDay}
            >
              <Trans>Copy previous day</Trans>
            </Button>
          )}
          <HStack>
            <Button variant="secondary" onClick={goToToday}>
              <Trans>Today</Trans>
            </Button>
            <IconButton
              variant="secondary"
              onClick={() => navigateDate(-1)}
              icon={<LuChevronLeft />}
              aria-label={view === "board" ? t`Previous Day` : t`Previous Week`}
            />
            <Button variant="secondary" className="min-w-[140px]">
              {dateLabel}
            </Button>
            <IconButton
              variant="secondary"
              onClick={() => navigateDate(1)}
              icon={<LuChevronRight />}
              aria-label={view === "board" ? t`Next Day` : t`Next Week`}
            />
          </HStack>

          {view !== "capacity" && shifts.length > 1 && (
            <Popover>
              <PopoverTrigger asChild>
                <div className="relative">
                  <IconButton
                    aria-label={t`Shift`}
                    icon={<LuClock />}
                    variant="secondary"
                    className="border-dashed border-border"
                  />
                  {shiftId && (
                    <span
                      aria-hidden
                      className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-primary"
                    />
                  )}
                </div>
              </PopoverTrigger>
              <PopoverContent className="w-64">
                <VStack spacing={3}>
                  <span className="text-xs font-medium text-muted-foreground">
                    <Trans>Shift</Trans>
                  </span>
                  <div className="w-full">
                    <Combobox
                      asButton
                      size="sm"
                      value={shiftId ?? "all"}
                      options={[
                        { value: "all", label: t`All shifts` },
                        ...shifts.map((shift) => ({
                          value: shift.id,
                          label: shift.name
                        }))
                      ]}
                      onChange={(value) => setShift(value || "all")}
                    />
                  </div>
                </VStack>
              </PopoverContent>
            </Popover>
          )}

          <Popover>
            <PopoverTrigger asChild>
              <IconButton
                aria-label={t`Settings`}
                icon={<LuSettings2 />}
                variant="secondary"
                className="border-dashed border-border"
              />
            </PopoverTrigger>
            <PopoverContent className="w-64">
              <VStack spacing={3}>
                <span className="text-xs font-medium text-muted-foreground">
                  <Trans>Location</Trans>
                </span>
                <div className="w-full">
                  <Combobox
                    asButton
                    size="sm"
                    value={locationId ?? undefined}
                    options={locations}
                    onChange={(selected) => {
                      const newParams = new URLSearchParams(searchParams);
                      newParams.set("location", selected);
                      window.location.href = `${
                        path.to.scheduleCrew
                      }?${newParams.toString()}`;
                    }}
                  />
                </div>
              </VStack>
            </PopoverContent>
          </Popover>
        </HStack>
      </HStack>
      <div className="flex flex-grow h-full items-stretch overflow-hidden relative">
        {view === "board" && (
          <CrewBoard
            date={date}
            shiftId={shiftId}
            locationId={locationId}
            employees={employees}
            workCenters={workCenters}
            assignments={assignments}
            absences={absences}
            requiredAbilities={requiredAbilities}
            employeeAbilities={employeeAbilities}
          />
        )}
        {view === "matrix" && (
          <CrewMatrix
            weekDates={weekDates}
            employees={employees}
            workCenters={workCenters}
            assignments={weekAssignments}
            absences={weekAbsences}
            demandByWorkCenter={demandByWorkCenter}
            shiftId={shiftId}
            shiftHoursById={shiftHoursById}
            employeeShiftHours={employeeShiftHours}
            defaultShiftHours={defaultShiftHours}
          />
        )}
        {view === "capacity" && (
          <CrewCapacity
            weekDates={weekDates}
            workCenters={workCenters}
            assignments={weekAssignments}
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
    </div>
  );
}
