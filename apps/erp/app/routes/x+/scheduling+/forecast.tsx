// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { error, hasPermission } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { Badge, Button, ClientOnly, cn, useDebounce } from "@carbon/react";
import { datetime, formatDate, redirect } from "@carbon/utils";
import type { CalendarDate } from "@internationalized/date";
import {
  CalendarDateTime,
  DateFormatter,
  fromAbsolute,
  getDayOfWeek,
  now,
  parseAbsolute,
  parseDate,
  startOfWeek,
  toCalendarDate
} from "@internationalized/date";
import { msg } from "@lingui/core/macro";
import { Plural, Trans } from "@lingui/react/macro";
import { useLocale } from "@react-aria/i18n";
import { useMemo } from "react";
import { LuBan, LuTriangleAlert } from "react-icons/lu";
import type { LoaderFunctionArgs, Location } from "react-router";
import { useLoaderData, useNavigate } from "react-router";
import { Empty } from "~/components";
import {
  Gantt,
  type GanttEvent,
  type GanttVisibility
} from "~/components/Gantt";
import { usePlanGate } from "~/hooks/usePlanGate";
import { useReplaceLocation } from "~/hooks/useReplaceLocation";
import {
  getDepartmentsList,
  getShiftsWithTimes,
  getShiftsWithTimesByIds
} from "~/modules/people/people.service";
import {
  getCapacityReservationsForResources,
  getForecastNonWorkingIntervals,
  getHolidayDates,
  getMaintenanceDowntimeForResources,
  getQualifiedPeopleByProcess,
  getWorkCenterNonWorkingIntervals
} from "~/modules/production/production.service";
import ForecastUpgradeOverlay from "~/modules/production/ui/ForecastUpgradeOverlay";
import type {
  ForecastRange,
  ForecastView
} from "~/modules/production/ui/Schedule/ForecastHeader";
import { ForecastHeader } from "~/modules/production/ui/Schedule/ForecastHeader";
import {
  buildResourceTimeline,
  collapseToLanes,
  forecastCounts,
  workCenterIdFromLaneId,
  workCenterLaneId
} from "~/modules/production/ui/Schedule/resourceTimeline";
import { TimelineDetail } from "~/modules/production/ui/Schedule/TimelineDetail";
import type { TimelineNodeDetail } from "~/modules/production/ui/Schedule/timeline";
import type {
  AvailabilityShift,
  WorkCenterAvailability
} from "~/modules/production/ui/Schedule/WorkCenterAvailabilityPopover";
import { WorkCenterAvailabilityPopover } from "~/modules/production/ui/Schedule/WorkCenterAvailabilityPopover";
import { getWorkCentersByLocation } from "~/modules/resources/resources.service";
import {
  getLocationTimeZone,
  resolveLocationId
} from "~/modules/shared/shared.service";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

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
  const { client, companyId, userId, permissions } = await requirePermissions(
    request,
    { view: "production" }
  );

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
      .select("name, requiresStaffing")
      .eq("id", locationId)
      .eq("companyId", companyId)
      .single()
  ]);

  const locationName = locationResult.data?.name ?? undefined;
  const locationRequiresStaffing =
    locationResult.data?.requiresStaffing ?? false;

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
  const [reservations, maintenanceResult, holidays] = await Promise.all([
    getCapacityReservationsForResources(client, companyId, locationId, {
      from: new Date(windowStartMs).toISOString(),
      to: new Date(windowEndMs).toISOString()
    }),
    getMaintenanceDowntimeForResources(client, companyId, locationId),
    getHolidayDates(client, companyId, {
      from: toCalendarDate(fromAbsolute(windowStartMs, timeZone)).toString(),
      to: toCalendarDate(fromAbsolute(windowEndMs, timeZone)).toString()
    })
  ]);
  if (holidays.error) {
    throw redirect(
      path.to.production,
      await flash(request, error(holidays.error, "Failed to load holidays"))
    );
  }
  const nonWorkingIntervals = getForecastNonWorkingIntervals({
    timeZone,
    shifts,
    windowStartMs,
    windowEndMs,
    holidayDates: holidays.data
  });

  // Open outages that take a work center offline, as [start, end) windows for
  // the resource lanes. Prefer actual times once work has started; fall back to
  // planned. Drop any without both bounds — there's nothing to draw.
  const maintenance = (maintenanceResult.data ?? [])
    .map((d) => {
      const startAt = d.actualStartTime ?? d.plannedStartTime;
      const endAt = d.actualEndTime ?? d.plannedEndTime;
      if (!d.workCenterId || !startAt || !endAt) return null;
      return {
        id: d.id,
        workCenterId: d.workCenterId,
        name: d.maintenanceDispatchId ?? "Maintenance",
        startAt,
        endAt
      };
    })
    .filter((m): m is NonNullable<typeof m> => m !== null);

  // Every active work center in the plant — seeded as a lane so a station with
  // no scheduled work still shows up on the board. Narrowed to the selected
  // department when one is chosen.
  const filteredWorkCenters = (locationWorkCenters.data ?? []).filter(
    (workCenter) => !departmentId || workCenter.departmentId === departmentId
  );
  const plantWorkCenters = filteredWorkCenters.map((workCenter) => ({
    id: workCenter.id as string,
    name: (workCenter.name ?? "Work Center") as string
  }));
  const departmentWorkCenterIds = new Set(plantWorkCenters.map((wc) => wc.id));

  // Which stations host ABILITY-GATED work — a process on them requires a
  // qualified operator (`process.requiresAbility`). Drives the popover's
  // "requires a qualified operator" line and, with the location's require-
  // staffing policy, explains why an unstaffed station schedules nothing.
  const gatedWorkCenterIds = new Set<string>();
  if (plantWorkCenters.length > 0) {
    const gatedRows = await client
      .from("workCenterProcess")
      .select("workCenterId, process!inner(requiresAbility)")
      .eq("companyId", companyId)
      .in(
        "workCenterId",
        plantWorkCenters.map((wc) => wc.id)
      );
    for (const row of gatedRows.data ?? []) {
      const process = row.process as { requiresAbility?: boolean } | null;
      if (process?.requiresAbility) gatedWorkCenterIds.add(row.workCenterId);
    }
  }

  // Per-work-center availability tier for the tree's info popover — which rung
  // of the scheduler's ladder (lights-out → work-center shifts → location shifts
  // → default Mon–Fri 8h) actually sets this station's hours. Mirrors the
  // resolveOne cascade in the scheduling engine; classification only, no window
  // math. `shifts` (getShiftsWithTimes) already holds the location's shifts.
  const workCenterShiftRows =
    plantWorkCenters.length > 0
      ? await client
          .from("workCenterShift")
          .select("workCenterId, shiftId")
          .eq("companyId", companyId)
          .in(
            "workCenterId",
            plantWorkCenters.map((wc) => wc.id)
          )
      : { data: [] as { workCenterId: string; shiftId: string }[] };

  // A station can be linked to a shift of another location.
  const locationShiftIds = new Set(shifts.map((shift) => shift.id));
  const linkedShiftIds = [
    ...new Set(
      (workCenterShiftRows.data ?? [])
        .map((row) => row.shiftId)
        .filter((id) => !locationShiftIds.has(id))
    )
  ];
  const linkedShifts =
    linkedShiftIds.length > 0
      ? await getShiftsWithTimesByIds(client, companyId, linkedShiftIds)
      : { data: [], error: null };
  if (linkedShifts.error) {
    throw redirect(
      path.to.production,
      await flash(request, error(linkedShifts.error, "Failed to load shifts"))
    );
  }
  const toShiftInfo = (shift: (typeof shifts)[number]): AvailabilityShift => ({
    name: shift.name,
    startTime: shift.startTime,
    endTime: shift.endTime,
    days: [
      shift.monday,
      shift.tuesday,
      shift.wednesday,
      shift.thursday,
      shift.friday,
      shift.saturday,
      shift.sunday
    ].map(Boolean)
  });

  const shiftInfoById = new Map(
    [...shifts, ...(linkedShifts.data ?? [])].map((shift) => [
      shift.id,
      toShiftInfo(shift)
    ])
  );
  // Shifts read in the order they run in a day.
  const byStart = (a: AvailabilityShift, b: AvailabilityShift) =>
    (a.startTime ?? "").localeCompare(b.startTime ?? "");
  const locationShiftInfos = shifts.map(toShiftInfo).sort(byStart);
  const shiftIdsByWorkCenter = new Map<string, string[]>();
  for (const row of workCenterShiftRows.data ?? []) {
    const existing = shiftIdsByWorkCenter.get(row.workCenterId) ?? [];
    existing.push(row.shiftId);
    shiftIdsByWorkCenter.set(row.workCenterId, existing);
  }

  const workCenterAvailability: Record<string, WorkCenterAvailability> = {};
  for (const workCenter of filteredWorkCenters) {
    const workCenterId = workCenter.id;
    if (!workCenterId) continue;
    const workCenterShiftInfos = (shiftIdsByWorkCenter.get(workCenterId) ?? [])
      .map((shiftId) => shiftInfoById.get(shiftId))
      .filter((info): info is AvailabilityShift => info !== undefined)
      .sort(byStart);
    const tier: WorkCenterAvailability["tier"] = workCenter.alwaysOn
      ? "alwaysOn"
      : workCenterShiftInfos.length > 0
        ? "workCenterShift"
        : locationShiftInfos.length > 0
          ? "locationShift"
          : "default";
    workCenterAvailability[workCenterId] = {
      tier,
      workCenterShifts: workCenterShiftInfos,
      locationShifts: locationShiftInfos,
      requiresQualifiedOperator: gatedWorkCenterIds.has(workCenterId),
      lightsOut: !!workCenter.alwaysOn,
      locationRequiresStaffing
    };
  }

  // Each station's lane is shaded and its bars split on its own hours (the
  // scheduler's ladder and the holidays), never the plant's.
  const nonWorkingIntervalsByLane = Object.fromEntries(
    [
      ...getWorkCenterNonWorkingIntervals({
        workCenters: filteredWorkCenters.flatMap((workCenter) =>
          workCenter.id
            ? [{ id: workCenter.id, alwaysOn: !!workCenter.alwaysOn }]
            : []
        ),
        workCenterShifts: workCenterShiftRows.data ?? [],
        shifts,
        linkedShifts: linkedShifts.data ?? [],
        timeZone,
        holidayDates: holidays.data,
        rangeStart: windowStartMs,
        rangeEnd: windowEndMs
      })
    ].map(([workCenterId, intervals]) => [
      workCenterLaneId(workCenterId),
      intervals
    ])
  );

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

  // A batch-tagged reservation is ONE coalesced hold for N member jobs — it
  // must read as the BATCH (BAT… · N jobs), not as its anchor member. Member
  // counts come from one grouped read over the visible batches.
  const visibleBatchIds = [
    ...new Set(
      rows
        .map((r) => r.jobOperationBatchId)
        .filter((id): id is string => Boolean(id))
    )
  ];
  // Who could run the work the scheduler could not place, and where the board
  // has them — the people to move.
  const unschedulableProcessIds = [
    ...new Set(
      rows.flatMap((r) =>
        r.isPlaceholder && r.jobOperation?.processId
          ? [r.jobOperation.processId]
          : []
      )
    )
  ];

  const [workCenters, abilities, operators, batchMemberRows, qualifiedPeople] =
    await Promise.all([
      workCenterIds.size > 0
        ? client
            .from("workCenter")
            .select("id, name")
            .in("id", Array.from(workCenterIds))
        : Promise.resolve({ data: [] as { id: string; name: string }[] }),
      abilityIds.size > 0
        ? client
            .from("abilities")
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
          }),
      visibleBatchIds.length > 0
        ? client
            .from("jobOperation")
            .select("jobOperationBatchId")
            .in("jobOperationBatchId", visibleBatchIds)
            .eq("companyId", companyId)
        : Promise.resolve({
            data: [] as { jobOperationBatchId: string | null }[]
          }),
      // Qualifications are readable with resources view only; without it the
      // list would read as "nobody is qualified", so it is left out.
      hasPermission(permissions, "resources", "view", companyId)
        ? getQualifiedPeopleByProcess(client, companyId, {
            processIds: unschedulableProcessIds,
            fromDate: toCalendarDate(now(timeZone)).toString()
          })
        : Promise.resolve({
            data: new Map<string, { name: string; stations: string[] }[]>(),
            error: null
          })
    ]);

  const batchMemberCounts = new Map<string, number>();
  for (const row of batchMemberRows.data ?? []) {
    if (!row.jobOperationBatchId) continue;
    batchMemberCounts.set(
      row.jobOperationBatchId,
      (batchMemberCounts.get(row.jobOperationBatchId) ?? 0) + 1
    );
  }

  if (qualifiedPeople.error) {
    throw redirect(
      path.to.production,
      await flash(
        request,
        error(qualifiedPeople.error, "Failed to load qualified people")
      )
    );
  }

  const workCenterNames = new Map(
    (workCenters.data ?? []).map((w) => [w.id, w.name])
  );
  const abilityNames = new Map(
    (abilities.data ?? []).map((a) => [a.id ?? "", a.name ?? ""])
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
      operationId: r.operationId,
      operationDescription: r.jobOperation?.description ?? null,
      itemReadableId:
        r.jobOperation?.jobMakeMethod?.item?.readableIdWithRevision ?? null,
      itemName: r.jobOperation?.jobMakeMethod?.item?.name ?? null,
      itemThumbnailPath:
        r.jobOperation?.jobMakeMethod?.item?.thumbnailPath ?? null,
      itemType: r.jobOperation?.jobMakeMethod?.item?.type ?? null,
      batchReadableId: r.jobOperationBatch?.readableId ?? null,
      batchId: r.jobOperationBatchId ?? null,
      batchMemberCount: r.jobOperationBatchId
        ? (batchMemberCounts.get(r.jobOperationBatchId) ?? null)
        : null,
      hasConflict: r.jobOperation?.hasConflict ?? false,
      conflictReason: r.jobOperation?.conflictReason ?? null,
      unschedulable: r.isPlaceholder ?? false,
      scheduleNote: r.scheduleNote,
      workHours: r.workHours,
      inProgress: r.jobOperation?.status === "In Progress",
      qualifiedPeople:
        r.isPlaceholder && r.jobOperation?.processId
          ? qualifiedPeople.data.get(r.jobOperation.processId)
          : undefined
    })),
    // Only outages on the work centers actually shown (respects the department
    // filter, and avoids conjuring a lane for a hidden station).
    maintenance: maintenance.filter((m) =>
      departmentWorkCenterIds.has(m.workCenterId)
    ),
    window: { start: windowStartMs, end: windowEndMs }
  });

  // When the visible window has NO work, the board reads as broken even though
  // work may simply be scheduled another week (forward-ASAP places a Ready job
  // at the next open shift). Find the nearest reservation OUTSIDE the window —
  // future first, else past — so the empty state can point the user to it.
  // A department narrows the search to its own stations; a department with no
  // station here never has work to point to.
  let nextScheduledDate: string | null = null;
  let nextScheduledDirection: "future" | "past" | null = null;
  if (rows.length === 0 && (!departmentId || plantWorkCenters.length > 0)) {
    const nearestReservation = async (
      bound: "future" | "past"
    ): Promise<string | null> => {
      let query = client
        .from("capacityReservation")
        .select("startAt, job!inner(locationId, status)")
        .eq("companyId", companyId)
        .is("scenarioId", null)
        .eq("job.locationId", locationId)
        .not("job.status", "in", '("Cancelled","Completed","Closed")')
        .limit(1);
      if (departmentId) {
        query = query
          .eq("resourceKind", "WorkCenter")
          .in("resourceId", [...departmentWorkCenterIds]);
      }
      query =
        bound === "future"
          ? query
              .gte("startAt", new Date(windowEndMs).toISOString())
              .order("startAt", { ascending: true })
          : query
              .lt("startAt", new Date(windowStartMs).toISOString())
              .order("startAt", { ascending: false });
      const result = await query;
      return result.data?.[0]?.startAt ?? null;
    };
    const future = await nearestReservation("future");
    const nearest = future ?? (await nearestReservation("past"));
    if (nearest) {
      nextScheduledDate = datetime.businessDay(nearest, timeZone).toString();
      nextScheduledDirection = future ? "future" : "past";
    }
  }

  return {
    locationId,
    locationName,
    departmentId,
    departmentName:
      departments.find((department) => department.value === departmentId)
        ?.label ?? null,
    departmentHasWorkCenters: plantWorkCenters.length > 0,
    departments,
    range,
    date,
    shiftId,
    timeZone,
    windowStartMs,
    nonWorkingIntervals,
    nonWorkingIntervalsByLane,
    shifts: shifts.map((shift) => ({ id: shift.id, name: shift.name })),
    reservationCount: rows.length,
    nextScheduledDate,
    nextScheduledDirection,
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
    workCenterAvailability
  };
}

function getSpanId(location: Location<any>): string | undefined {
  const search = new URLSearchParams(location.search);
  return search.get("span") ?? undefined;
}

function getView(location: Location<any>): ForecastView {
  const search = new URLSearchParams(location.search);
  return search.get("view") === "detailed" ? "detailed" : "compact";
}

export default function ResourceGanttView() {
  const {
    locationId,
    locationName,
    departmentId,
    departmentName,
    departmentHasWorkCenters,
    departments,
    range,
    date,
    shiftId,
    timeZone,
    windowStartMs,
    nonWorkingIntervals,
    nonWorkingIntervalsByLane,
    shifts,
    reservationCount,
    nextScheduledDate,
    nextScheduledDirection,
    trace,
    detailsById,
    workCenterAvailability
  } = useLoaderData<typeof loader>();

  const { isGated } = usePlanGate({ feature: "FORECAST" });

  const { locale } = useLocale();
  const navigate = useNavigate();
  const { location, replaceSearchParam } = useReplaceLocation();
  const selectedSpanId = getSpanId(location);
  const view = getView(location);

  // Compact (the default) puts each work center on one row with its operations
  // side by side; detailed is the full Location > Work Center > Operation >
  // People tree. Switched in the browser — both come from the same events.
  const events = useMemo(
    () =>
      trace
        ? view === "compact"
          ? collapseToLanes(trace.events)
          : trace.events
        : [],
    [trace, view]
  );

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

  const nextWorkDate = nextScheduledDate
    ? formatDate(
        nextScheduledDate,
        { weekday: "long", month: "short", day: "numeric" },
        locale
      )
    : null;
  // A department id from an old link may no longer name one: then each hint
  // below says "this department" in a sentence of its own.
  const nextWorkHint = nextWorkDate ? (
    departmentId ? (
      nextScheduledDirection === "future" ? (
        departmentName ? (
          <Trans>
            The next {departmentName} work at this location starts{" "}
            {nextWorkDate}.
          </Trans>
        ) : (
          <Trans>
            The next work for this department at this location starts{" "}
            {nextWorkDate}.
          </Trans>
        )
      ) : departmentName ? (
        <Trans>
          The most recent {departmentName} work at this location was{" "}
          {nextWorkDate}.
        </Trans>
      ) : (
        <Trans>
          The most recent work for this department at this location was{" "}
          {nextWorkDate}.
        </Trans>
      )
    ) : nextScheduledDirection === "future" ? (
      <Trans>
        The next scheduled work at this location starts {nextWorkDate}.
      </Trans>
    ) : (
      <Trans>
        The most recent scheduled work at this location was {nextWorkDate}.
      </Trans>
    )
  ) : departmentId ? (
    departmentName ? (
      <Trans>No {departmentName} work is scheduled at this location.</Trans>
    ) : (
      <Trans>No work for this department is scheduled at this location.</Trans>
    )
  ) : (
    <Trans>
      No jobs are scheduled at this location yet — release a job to see
      work-center load.
    </Trans>
  );
  const goToNextWork = nextScheduledDate ? (
    <Button
      variant="secondary"
      onClick={() => {
        const params = new URLSearchParams(location.search);
        params.set("range", "week");
        params.set("date", nextScheduledDate);
        navigate(`?${params.toString()}`);
      }}
    >
      <Trans>Go to that week</Trans>
    </Button>
  ) : null;

  if (isGated) {
    return (
      <ForecastUpgradeOverlay
        title={<Trans>Forecast</Trans>}
        description={
          <Trans>
            See a live capacity forecast of every work center — when each job is
            projected to run and finish across your shop.
          </Trans>
        }
      />
    );
  }

  return (
    <div className="flex flex-col h-[calc(100dvh-var(--topbar-height)-var(--content-inset))] overflow-hidden w-full bg-background">
      <ForecastHeader
        range={range}
        date={date}
        locationId={locationId}
        departmentId={departmentId}
        shiftId={shiftId}
        departments={departments}
        shifts={shifts}
        view={view}
        onViewChange={(nextView) =>
          replaceSearchParam(
            "view",
            nextView === "detailed" ? nextView : undefined
          )
        }
      />
      {reservationCount === 0 && trace && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-muted/40 px-4 py-2.5">
          <div className="flex flex-col">
            <span className="text-sm font-medium">
              <Trans>No scheduled work in this window</Trans>
            </span>
            <span className="text-xs text-muted-foreground text-pretty">
              {nextWorkHint}
            </span>
          </div>
          {goToNextWork}
        </div>
      )}
      {!trace ? (
        <div className="flex flex-1 items-center justify-center">
          {departmentId && !departmentHasWorkCenters ? (
            <Empty
              title={
                departmentName ? (
                  <Trans>No work centers in {departmentName}</Trans>
                ) : (
                  <Trans>No work centers in this department</Trans>
                )
              }
              description={
                departmentName && locationName ? (
                  <Trans>
                    {departmentName} has no work centers at {locationName}. Pick
                    another department or location.
                  </Trans>
                ) : departmentName ? (
                  <Trans>
                    {departmentName} has no work centers at this location. Pick
                    another department or location.
                  </Trans>
                ) : locationName ? (
                  <Trans>
                    This department has no work centers at {locationName}. Pick
                    another department or location.
                  </Trans>
                ) : (
                  <Trans>
                    This department has no work centers at this location. Pick
                    another department or location.
                  </Trans>
                )
              }
            />
          ) : (
            <Empty
              title={<Trans>No scheduled work in this window</Trans>}
              description={nextWorkHint}
            >
              {goToNextWork}
            </Empty>
          )}
        </div>
      ) : (
        <div
          className={cn(
            "grid flex-1 min-h-0 grid-cols-1 overflow-hidden bg-card"
          )}
        >
          <ClientOnly fallback={null}>
            {() => (
              <div className="flex h-full min-h-0">
                <div className="min-w-0 flex-1">
                  <Gantt
                    selectedId={selectedSpanId}
                    key={`${view}:${events[0]?.id ?? "-"}`}
                    events={events}
                    onSelectedIdChanged={(selectedSpan) => {
                      if (!selectedSpan) {
                        replaceSearchParam("span");
                        return;
                      }
                      changeToSpan(selectedSpan);
                    }}
                    toolbarAccessory={(visibility) => (
                      <ForecastCounts
                        events={events}
                        detailsById={detailsById}
                        visibility={visibility}
                      />
                    )}
                    renderNodeAside={(node) => {
                      const workCenterId = workCenterIdFromLaneId(node.id);
                      const availability = workCenterId
                        ? workCenterAvailability[workCenterId]
                        : undefined;
                      return availability ? (
                        <WorkCenterAvailabilityPopover
                          availability={availability}
                        />
                      ) : null;
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
                    nonWorkingIntervalsByRow={nonWorkingIntervalsByLane}
                    tickIntervalMs={tickIntervalMs}
                    axisTickMs={axisTickMs}
                    formatAxisTick={formatAxisTick}
                    nowMs={Date.now()}
                  />
                </div>
                {selectedSpanId && selectedDetail && (
                  <div className="h-full w-[360px] max-w-[360px] shrink-0">
                    <TimelineDetail
                      detail={selectedDetail}
                      timeZone={timeZone}
                      onClose={() => replaceSearchParam("span")}
                    />
                  </div>
                )}
              </div>
            )}
          </ClientOnly>
        </div>
      )}
    </div>
  );
}

/** The board's header counts and problem badges, for what is on screen. */
function ForecastCounts({
  events,
  detailsById,
  visibility
}: {
  events: GanttEvent[];
  detailsById: Record<string, TimelineNodeDetail>;
  visibility: GanttVisibility;
}) {
  const counts = useMemo(
    () => forecastCounts(events, detailsById, visibility),
    [events, detailsById, visibility]
  );
  return (
    <div className="flex items-center gap-2">
      <span className="whitespace-nowrap text-xs tabular-nums text-muted-foreground">
        <Plural value={counts.resources} one="# resource" other="# resources" />
        {" · "}
        <Plural
          value={counts.reservations}
          one="# reservation"
          other="# reservations"
        />
        {" · "}
        <Plural value={counts.jobs} one="# job" other="# jobs" />
      </span>
      {counts.unschedulable > 0 && (
        <Badge variant="red" className="gap-1 whitespace-nowrap tabular-nums">
          <LuBan className="size-3" />
          <Plural
            value={counts.unschedulable}
            one="# can't be scheduled"
            other="# can't be scheduled"
          />
        </Badge>
      )}
      {counts.conflicts > 0 && (
        <Badge variant="red" className="gap-1 whitespace-nowrap tabular-nums">
          <LuTriangleAlert className="size-3" />
          <Plural
            value={counts.conflicts}
            one="# conflict"
            other="# conflicts"
          />
        </Badge>
      )}
    </div>
  );
}
