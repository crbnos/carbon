import { HOUR_MS } from "@carbon/utils";
import { getDayOfWeek, parseDate } from "@internationalized/date";
import { makeDurations } from "~/utils/duration";

type CapacityOperation = {
  workCenterId: string | null;
  dueDate: string | null;
  setupTime?: number;
  setupUnit?: string;
  laborTime?: number;
  laborUnit?: string;
  machineTime?: number;
  machineUnit?: string;
  operationQuantity: number | null;
};

type CapacityReservation = {
  resourceId: string;
  startAt: string;
  endAt: string;
  workHours: number | null;
};

/** A location shift reduced to its per-day hours and which weekdays it runs. */
type CapacityShift = {
  id: string;
  /** shift hours per day (start→end duration, or the location default). */
  hours: number;
  /** 7 weekday flags, Sunday-first (index 0 = Sunday … 6 = Saturday). */
  runsOn: boolean[];
};

// Rung 3 of the ladder: no shifts anywhere → stock Mon–Fri, 8h/day. Mirrors the
// engine's stock week (08:00–16:00 = 8h) so machine and people capacity assume
// the same default day.
const FALLBACK_SHIFT_HOURS = 8;

/**
 * DAY-granularity mirror of the engine's machine-availability ladder, for the
 * Capacity view's Available series. The engine (Deno,
 * `packages/database/supabase/functions/lib/scheduling/machine-availability.ts`)
 * owns the AUTHORITATIVE wall-clock ladder; this is DISPLAY math and resolves the
 * same rungs at day granularity.
 *
 * Per work center, per week date, resolved in order:
 *   1. `alwaysOn` → 24h (lights-out).
 *   2. explicit `workCenterShift` rows → Σ (shift hours whose weekday flag covers
 *      that date) over the work center's shifts.
 *   3. no WC rows but the location has shifts → the same Σ over the location's
 *      shifts.
 *   4. no shifts anywhere → 8h on Mon–Fri, 0 on the weekend.
 */
export function getWorkCenterCalendarHoursByDay(args: {
  workCenters: { id: string; alwaysOn: boolean }[];
  workCenterShifts: { workCenterId: string; shiftId: string }[];
  locationShifts: CapacityShift[];
  weekDates: string[];
}): Map<string, Map<string, number>> {
  const { workCenters, workCenterShifts, locationShifts, weekDates } = args;

  const shiftById = new Map(locationShifts.map((shift) => [shift.id, shift]));
  const shiftIdsByWorkCenter = new Map<string, string[]>();
  for (const link of workCenterShifts) {
    const list = shiftIdsByWorkCenter.get(link.workCenterId);
    if (list) list.push(link.shiftId);
    else shiftIdsByWorkCenter.set(link.workCenterId, [link.shiftId]);
  }

  // weekday index per week date — a plain calendar date, so timezone-independent
  const dowByDate = weekDates.map((day) =>
    getDayOfWeek(parseDate(day), "en-US")
  );

  const sumShiftHours = (shifts: CapacityShift[], dow: number) =>
    shifts.reduce(
      (sum, shift) => (shift.runsOn[dow] ? sum + shift.hours : sum),
      0
    );

  const result = new Map<string, Map<string, number>>();
  for (const workCenter of workCenters) {
    const wcShiftIds = shiftIdsByWorkCenter.get(workCenter.id) ?? [];
    const wcShifts = wcShiftIds.flatMap((id) => {
      const shift = shiftById.get(id);
      return shift ? [shift] : [];
    });
    const byDate = new Map<string, number>();
    weekDates.forEach((day, i) => {
      const dow = dowByDate[i] ?? 0;
      let hours: number;
      if (workCenter.alwaysOn) {
        hours = 24;
      } else if (wcShifts.length > 0) {
        hours = sumShiftHours(wcShifts, dow);
      } else if (locationShifts.length > 0) {
        hours = sumShiftHours(locationShifts, dow);
      } else {
        hours = dow === 0 || dow === 6 ? 0 : FALLBACK_SHIFT_HOURS;
      }
      byDate.set(day, hours);
    });
    result.set(workCenter.id, byDate);
  }
  return result;
}

/**
 * The Capacity view's week buckets.
 *
 * Demand = open job-operation hours by due date (overdue lands in `pastDue`,
 * like the classic capacity board's Past Weeks column). Scheduled = each
 * reservation's actual work content distributed across its wall-clock span —
 * a reservation holds the station for its full span (including idle
 * overnight stretches), so distributing `workHours` keeps a spanning op from
 * reading as 24h/day. Day boundaries come from the plant's calendar via
 * `CalendarDate.toDate(tz)` so DST weeks bucket correctly.
 */
export function buildPeopleCapacityBuckets(args: {
  weekDates: string[];
  timezone: string;
  operations: CapacityOperation[];
  reservations: CapacityReservation[];
  /** per-work-center calendar hours (the ladder above) — clamps null-workHours reservations. */
  calendarHoursByWorkCenter: Map<string, Map<string, number>>;
}): {
  demandByWorkCenter: Record<
    string,
    { pastDue: number; days: Record<string, number> }
  >;
  scheduledByWorkCenter: Record<string, Record<string, number>>;
} {
  const {
    weekDates,
    timezone,
    operations,
    reservations,
    calendarHoursByWorkCenter
  } = args;
  const weekStartDate = weekDates[0];

  const demandByWorkCenter: Record<
    string,
    { pastDue: number; days: Record<string, number> }
  > = {};
  for (const operation of operations) {
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

  // day boundaries on the plant's calendar, computed once (not per reservation)
  const dayBounds = weekDates.map((day) => {
    const dayDate = parseDate(day);
    return {
      day,
      startMs: dayDate.toDate(timezone).getTime(),
      endMs: dayDate.add({ days: 1 }).toDate(timezone).getTime()
    };
  });

  const scheduledByWorkCenter: Record<string, Record<string, number>> = {};
  for (const reservation of reservations) {
    const startMs = new Date(reservation.startAt).getTime();
    const endMs = new Date(reservation.endAt).getTime();
    const spanMs = endMs - startMs;
    if (spanMs <= 0) continue;

    let workMs: number;
    if (reservation.workHours != null) {
      workMs = reservation.workHours * HOUR_MS;
    } else {
      // Legacy rows carry no measured work content, so the old code counted the
      // full wall-clock span — which reads as 24h/day for an op that idles
      // overnight. Clamp to the calendar hours actually available at this work
      // center over the days the reservation spans.
      const dayHours = calendarHoursByWorkCenter.get(reservation.resourceId);
      let calendarMsWithinSpan = 0;
      for (const { day, startMs: dayStartMs, endMs: dayEndMs } of dayBounds) {
        const overlapMs =
          Math.min(endMs, dayEndMs) - Math.max(startMs, dayStartMs);
        if (overlapMs > 0) {
          calendarMsWithinSpan += (dayHours?.get(day) ?? 0) * HOUR_MS;
        }
      }
      workMs = Math.min(spanMs, calendarMsWithinSpan);
    }

    for (const { day, startMs: dayStartMs, endMs: dayEndMs } of dayBounds) {
      const overlapMs =
        Math.min(endMs, dayEndMs) - Math.max(startMs, dayStartMs);
      if (overlapMs > 0) {
        const byDay = (scheduledByWorkCenter[reservation.resourceId] ??= {});
        byDay[day] =
          (byDay[day] ?? 0) + (overlapMs / spanMs) * (workMs / HOUR_MS);
      }
    }
  }

  return { demandByWorkCenter, scheduledByWorkCenter };
}
