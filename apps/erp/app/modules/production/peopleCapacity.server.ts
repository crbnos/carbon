import { HOUR_MS } from "@carbon/utils";
import { parseDate } from "@internationalized/date";
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
}): {
  demandByWorkCenter: Record<
    string,
    { pastDue: number; days: Record<string, number> }
  >;
  scheduledByWorkCenter: Record<string, Record<string, number>>;
} {
  const { weekDates, timezone, operations, reservations } = args;
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

  const scheduledByWorkCenter: Record<string, Record<string, number>> = {};
  for (const reservation of reservations) {
    const startMs = new Date(reservation.startAt).getTime();
    const endMs = new Date(reservation.endAt).getTime();
    const spanMs = endMs - startMs;
    if (spanMs <= 0) continue;
    const workMs =
      reservation.workHours != null ? reservation.workHours * HOUR_MS : spanMs;
    for (const day of weekDates) {
      const dayDate = parseDate(day);
      const dayStartMs = dayDate.toDate(timezone).getTime();
      const dayEndMs = dayDate.add({ days: 1 }).toDate(timezone).getTime();
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
