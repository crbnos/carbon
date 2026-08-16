import { requirePermissions } from "@carbon/auth/auth.server";
import {
  ClientOnly,
  cn,
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
  useDebounce
} from "@carbon/react";
import type { CalendarDate } from "@internationalized/date";
import {
  CalendarDateTime,
  DateFormatter,
  getDayOfWeek,
  now,
  parseAbsolute,
  parseDate,
  startOfWeek,
  toCalendarDate
} from "@internationalized/date";
import { msg } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useLocale } from "@react-aria/i18n";
import { useMemo } from "react";
import type { LoaderFunctionArgs, Location } from "react-router";
import { useLoaderData } from "react-router";
import { Empty } from "~/components";
import { Gantt } from "~/components/Gantt";
import { useReplaceLocation } from "~/hooks/useReplaceLocation";
import { getDepartmentsList, getShiftsWithTimes } from "~/modules/people";
import { getCapacityReservationsForResources } from "~/modules/production";
import { getForecastNonWorkingIntervals } from "~/modules/production/forecastCalendar.server";
import type { ForecastRange } from "~/modules/production/ui/Schedule/ForecastHeader";
import { ForecastHeader } from "~/modules/production/ui/Schedule/ForecastHeader";
import { buildResourceTimeline } from "~/modules/production/ui/Schedule/resourceTimeline";
import { TimelineDetail } from "~/modules/production/ui/Schedule/TimelineDetail";
import type { TimelineNodeDetail } from "~/modules/production/ui/Schedule/timeline";
import { getWorkCentersByLocation } from "~/modules/resources";
import { resolveLocationId } from "~/modules/shared/location.server";
import { getLocationTimeZone } from "~/modules/shared/timezone.server";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import {
  getResizableGanttSettings,
  setResizableGanttSettings
} from "~/utils/resizable-panels";

const WEEKDAY_KEYS = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday"
] as const;

/** Resolve the [start, end) instant window (epoch ms) for a forecast view. */
function resolveForecastWindow(input: {
  range: ForecastRange;
  calendarDate: CalendarDate;
  timeZone: string;
  shift: { startTime: string; endTime: string } | null;
}): { windowStartMs: number; windowEndMs: number } {
  const { range, calendarDate, timeZone, shift } = input;

  if (range === "week") {
    const weekStart = startOfWeek(calendarDate, "en-GB");
    return {
      windowStartMs: weekStart.toDate(timeZone).getTime(),
      windowEndMs: weekStart.add({ days: 7 }).toDate(timeZone).getTime()
    };
  }

  if (range === "shift" && shift) {
    const [sh, sm] = shift.startTime.split(":").map(Number);
    const [eh, em] = shift.endTime.split(":").map(Number);
    const start = new CalendarDateTime(
      calendarDate.year,
      calendarDate.month,
      calendarDate.day,
      sh,
      sm
    );
    // An end at or before the start wraps past midnight into the next day.
    const endDay =
      eh * 60 + em <= sh * 60 + sm
        ? calendarDate.add({ days: 1 })
        : calendarDate;
    const end = new CalendarDateTime(
      endDay.year,
      endDay.month,
      endDay.day,
      eh,
      em
    );
    return {
      windowStartMs: start.toDate(timeZone).getTime(),
      windowEndMs: end.toDate(timeZone).getTime()
    };
  }

  // day (also the shift view when the plant has no shifts defined)
  return {
    windowStartMs: calendarDate.toDate(timeZone).getTime(),
    windowEndMs: calendarDate.add({ days: 1 }).toDate(timeZone).getTime()
  };
}

export const handle: Handle = {
  breadcrumb: msg`Forecast`,
  to: path.to.scheduleForecast,
  module: "production"
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {
    view: "production"
  });

  const resizeSettings = await getResizableGanttSettings(request);

  const url = new URL(request.url);
  const searchParams = url.searchParams;
  const locationId = await resolveLocationId(client, request, {
    searchParams,
    userId,
    companyId,
    onDefaultsError: path.to.production,
    onNoLocations: path.to.production
  });

  const departmentId = searchParams.get("department");
  const rangeParam = searchParams.get("range");
  const range: ForecastRange =
    rangeParam === "week" || rangeParam === "shift" ? rangeParam : "day";
  const dateParam = searchParams.get("date");
  const shiftParam = searchParams.get("shift");

  // Times on the forecast axis belong to the plant we're viewing; the resolver
  // falls back to the company timezone when the location sets none of its own.
  const [
    timeZone,
    shiftsResult,
    locationWorkCenters,
    departmentsList,
    locationResult
  ] = await Promise.all([
    getLocationTimeZone(client, locationId, companyId),
    getShiftsWithTimes(client, companyId, locationId),
    getWorkCentersByLocation(client, locationId),
    getDepartmentsList(client, companyId),
    client
      .from("location")
      .select("name")
      .eq("id", locationId)
      .eq("companyId", companyId)
      .single()
  ]);

  const locationName = locationResult.data?.name ?? undefined;

  const shifts = shiftsResult.data ?? [];

  // "Today" belongs to the plant's calendar, not the server's.
  const date = (
    dateParam ? parseDate(dateParam) : toCalendarDate(now(timeZone))
  ).toString();
  const calendarDate = parseDate(date);

  // Shift view needs a concrete shift: the URL's when valid, else the first
  // active shift that runs on the selected weekday, else the first shift.
  // getDayOfWeek("en-US") is 0 (Sun) … 6 (Sat) — always a valid index.
  const weekdayKey =
    WEEKDAY_KEYS[getDayOfWeek(calendarDate, "en-US")] ?? "sunday";
  const shiftId =
    range === "shift"
      ? ((shiftParam && shifts.some((s) => s.id === shiftParam)
          ? shiftParam
          : (shifts.find((s) => s[weekdayKey]) ?? shifts[0])?.id) ?? null)
      : null;

  const { windowStartMs, windowEndMs } = resolveForecastWindow({
    range,
    calendarDate,
    timeZone,
    shift: shifts.find((s) => s.id === shiftId) ?? null
  });

  // The plant's non-working intervals (nights/weekends) over the visible window,
  // from the SAME availability ladder the scheduler uses — so the shaded
  // background can't disagree with the bars. Shades the axis so a reservation
  // spanning several days no longer reads as 24h/day.
  const nonWorkingIntervals = getForecastNonWorkingIntervals({
    timeZone,
    shifts,
    windowStartMs,
    windowEndMs
  });

  const reservations = await getCapacityReservationsForResources(
    client,
    companyId,
    locationId,
    {
      from: new Date(windowStartMs).toISOString(),
      to: new Date(windowEndMs).toISOString()
    }
  );

  // Every active work center in the plant — seeded as a lane so a station with
  // no scheduled work still shows up on the board. Narrowed to the selected
  // department when one is chosen.
  const plantWorkCenters = (locationWorkCenters.data ?? [])
    .filter(
      (workCenter) => !departmentId || workCenter.departmentId === departmentId
    )
    .map((workCenter) => ({
      id: workCenter.id as string,
      name: (workCenter.name ?? "Work Center") as string
    }));
  const departmentWorkCenterIds = new Set(plantWorkCenters.map((wc) => wc.id));

  // A department scopes the board to its work centers and their reservations —
  // employee/operator-pool lanes are not department-scoped, so they drop out
  // while a department filter is active.
  const rows = departmentId
    ? (reservations.data ?? []).filter(
        (r) =>
          r.resourceKind === "WorkCenter" &&
          departmentWorkCenterIds.has(r.resourceId)
      )
    : (reservations.data ?? []);

  const departments = (departmentsList.data ?? []).map((department) => ({
    value: department.id,
    label: department.name
  }));

  // Resolve resource names: work centers + named operators + legacy
  // ability (operator pool) rows
  const workCenterIds = new Set<string>();
  const abilityIds = new Set<string>();
  const employeeIds = new Set<string>();
  for (const r of rows) {
    if (r.resourceKind === "WorkCenter") workCenterIds.add(r.resourceId);
    else if (r.resourceKind === "Employee") employeeIds.add(r.resourceId);
    else abilityIds.add(r.resourceId);
  }

  const [workCenters, abilities, operators] = await Promise.all([
    workCenterIds.size > 0
      ? client
          .from("workCenter")
          .select("id, name")
          .in("id", Array.from(workCenterIds))
      : Promise.resolve({ data: [] as { id: string; name: string }[] }),
    abilityIds.size > 0
      ? client
          .from("ability")
          .select("id, name")
          .in("id", Array.from(abilityIds))
      : Promise.resolve({ data: [] as { id: string; name: string }[] }),
    employeeIds.size > 0
      ? client
          .from("user")
          .select("id, fullName")
          .in("id", Array.from(employeeIds))
      : Promise.resolve({
          data: [] as { id: string; fullName: string | null }[]
        })
  ]);

  const workCenterNames = new Map(
    (workCenters.data ?? []).map((w) => [w.id, w.name])
  );
  const abilityNames = new Map(
    (abilities.data ?? []).map((a) => [a.id, a.name])
  );
  const operatorNames = new Map(
    (operators.data ?? []).map((u) => [u.id, u.fullName])
  );

  const timeline = buildResourceTimeline({
    workCenters: plantWorkCenters,
    locationName,
    reservations: rows.map((r) => ({
      id: r.id,
      resourceKind: r.resourceKind,
      resourceId: r.resourceId,
      resourceName:
        r.resourceKind === "WorkCenter"
          ? (workCenterNames.get(r.resourceId) ?? "Work Center")
          : r.resourceKind === "Employee"
            ? (operatorNames.get(r.resourceId) ?? "Operator")
            : (abilityNames.get(r.resourceId) ?? "Operator Pool"),
      startAt: r.startAt,
      endAt: r.endAt,
      jobId: r.jobId,
      jobReadableId: r.job?.jobId ?? r.jobId,
      operationDescription: r.jobOperation?.description ?? null,
      hasConflict: r.jobOperation?.hasConflict ?? false,
      conflictReason: r.jobOperation?.conflictReason ?? null,
      scheduleNote: r.scheduleNote,
      workHours: r.workHours
    })),
    window: { start: windowStartMs, end: windowEndMs }
  });

  const jobCount = new Set(rows.map((r) => r.jobId)).size;
  const conflictCount = new Set(
    rows.filter((r) => r.jobOperation?.hasConflict).map((r) => r.operationId)
  ).size;

  // Count every station shown, not just the ones carrying reservations —
  // include plant work centers, plus any resource a reservation references.
  const shownWorkCenterIds = new Set<string>([
    ...plantWorkCenters.map((workCenter) => workCenter.id),
    ...workCenterIds
  ]);

  return {
    locationId,
    departmentId,
    departments,
    range,
    date,
    shiftId,
    timeZone,
    windowStartMs,
    nonWorkingIntervals,
    shifts: shifts.map((shift) => ({ id: shift.id, name: shift.name })),
    resourceCount: shownWorkCenterIds.size + abilityIds.size + employeeIds.size,
    reservationCount: rows.length,
    jobCount,
    conflictCount,
    trace:
      timeline.events.length > 1
        ? {
            events: timeline.events,
            duration: timeline.totalDuration,
            rootSpanStatus: "completed" as const,
            rootStartedAt: timeline.windowStart
          }
        : null,
    detailsById: timeline.detailsById as Record<string, TimelineNodeDetail>,
    resizeSettings
  };
}

function getSpanId(location: Location<any>): string | undefined {
  const search = new URLSearchParams(location.search);
  return search.get("span") ?? undefined;
}

export default function ResourceGanttView() {
  const {
    locationId,
    departmentId,
    departments,
    range,
    date,
    shiftId,
    timeZone,
    windowStartMs,
    nonWorkingIntervals,
    shifts,
    resourceCount,
    reservationCount,
    jobCount,
    conflictCount,
    trace,
    detailsById,
    resizeSettings
  } = useLoaderData<typeof loader>();

  const { locale } = useLocale();
  const { location, replaceSearchParam } = useReplaceLocation();
  const selectedSpanId = getSpanId(location);

  // Axis labels are 24-hour clock times for a day/shift and dates for a week,
  // both in the plant's timezone (the company fallback is resolved server-side).
  const formatAxisTick = useMemo(() => {
    const timeFormatter = new DateFormatter(locale, {
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
      timeZone
    });
    if (range !== "week") {
      return (absoluteMs: number) => timeFormatter.format(new Date(absoluteMs));
    }
    // Week view: one tick per day (see axisTickMs), each at local midnight, so
    // it reads as the day name ("Mon 17"). The time formatter is only a
    // fallback should a tick ever land off-midnight.
    const dayFormatter = new DateFormatter(locale, {
      weekday: "short",
      day: "numeric",
      timeZone
    });
    return (absoluteMs: number) => {
      const instant = new Date(absoluteMs);
      const local = parseAbsolute(instant.toISOString(), timeZone);
      return local.hour === 0 && local.minute === 0
        ? dayFormatter.format(instant)
        : timeFormatter.format(instant);
    };
  }, [range, locale, timeZone]);

  // Clean, clock-aligned axis divisions: 1h on a shift, 4h on a day. The week
  // view uses explicit per-day ticks instead (axisTickMs).
  const tickIntervalMs =
    range === "shift"
      ? 60 * 60 * 1000
      : range === "week"
        ? undefined
        : 4 * 60 * 60 * 1000;

  // Week view: exactly one tick per day, placed at each day's REAL local
  // midnight (not a fixed 24h interval, which would drift an hour across a DST
  // change) so the axis reads as seven days spread across the full width.
  const axisTickMs = useMemo(() => {
    if (range !== "week") return undefined;
    const weekStart = startOfWeek(parseDate(date), "en-GB");
    return Array.from(
      { length: 7 },
      (_, i) =>
        weekStart.add({ days: i }).toDate(timeZone).getTime() - windowStartMs
    );
  }, [range, date, timeZone, windowStartMs]);

  const changeToSpan = useDebounce((selectedSpan: string) => {
    replaceSearchParam("span", selectedSpan);
  }, 250);

  const selectedDetail = selectedSpanId
    ? detailsById[selectedSpanId]
    : undefined;

  return (
    <div className="flex flex-col h-[calc(100dvh-49px)] overflow-hidden w-full bg-background">
      <ForecastHeader
        range={range}
        date={date}
        locationId={locationId}
        departmentId={departmentId}
        shiftId={shiftId}
        departments={departments}
        shifts={shifts}
        resourceCount={resourceCount}
        reservationCount={reservationCount}
        jobCount={jobCount}
        conflictCount={conflictCount}
      />
      {!trace ? (
        <div className="flex flex-1 items-center justify-center">
          <Empty>
            <Trans>
              No capacity reservations to visualize. Schedule a job to see
              work-center load.
            </Trans>
          </Empty>
        </div>
      ) : (
        <div
          className={cn(
            "grid flex-1 min-h-0 grid-cols-1 overflow-hidden bg-background"
          )}
        >
          <ClientOnly fallback={null}>
            {() => (
              <ResizablePanelGroup
                direction="horizontal"
                className="h-full max-h-full"
                onLayout={(layout) => {
                  if (layout.length !== 2) return;
                  if (!selectedSpanId) return;
                  setResizableGanttSettings(document, layout);
                }}
              >
                <ResizablePanel
                  order={1}
                  minSize={30}
                  defaultSize={resizeSettings.layout?.[0]}
                >
                  <Gantt
                    selectedId={selectedSpanId}
                    key={trace.events[0]?.id ?? "-"}
                    events={trace.events}
                    onSelectedIdChanged={(selectedSpan) => {
                      if (!selectedSpan) {
                        replaceSearchParam("span");
                        return;
                      }
                      changeToSpan(selectedSpan);
                    }}
                    totalDuration={trace.duration}
                    rootSpanStatus={trace.rootSpanStatus}
                    rootStartedAt={
                      trace.rootStartedAt
                        ? new Date(trace.rootStartedAt)
                        : undefined
                    }
                    axis="absolute"
                    windowStartMs={windowStartMs}
                    nonWorkingIntervals={nonWorkingIntervals}
                    tickIntervalMs={tickIntervalMs}
                    axisTickMs={axisTickMs}
                    formatAxisTick={formatAxisTick}
                    nowMs={Date.now()}
                  />
                </ResizablePanel>
                {selectedSpanId && selectedDetail && (
                  <>
                    <ResizableHandle withHandle />
                    <ResizablePanel
                      order={2}
                      minSize={25}
                      defaultSize={resizeSettings.layout?.[1]}
                    >
                      <TimelineDetail
                        detail={selectedDetail}
                        timeZone={timeZone}
                        onClose={() => replaceSearchParam("span")}
                      />
                    </ResizablePanel>
                  </>
                )}
              </ResizablePanelGroup>
            )}
          </ClientOnly>
        </div>
      )}
    </div>
  );
}
