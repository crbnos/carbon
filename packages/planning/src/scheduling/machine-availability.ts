// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

/**
 * Machine-availability ladder — pure resolution of a work center's operating
 * windows from shift data. No DB access (the provider does the reads and hands
 * the rows in), so the engine consumes one snapshot and the ladder is unit
 * testable without a database (§7 serializable-snapshot invariant).
 *
 * Per work center, resolved in order:
 *   1. `alwaysOn` → one continuous window across the range (lights-out 24×7).
 *   2. Explicit `workCenterShift` rows → the union of those shifts' windows.
 *   3. No WC rows but the location has shifts → the union of the location's
 *      shifts' windows.
 *   4. No shifts anywhere → the stock Mon–Fri 08:00–16:00 (8h) week in the
 *      location's timezone.
 *
 * Downtime (open maintenance dispatches flagged `takesWorkCenterOffline`) is
 * subtracted from the resolved windows by the caller, using `downtimeOutages`.
 */

import {
  type CalendarShiftRow,
  type CalendarWindow,
  expandCalendar,
  STOCK_WEEK_SHIFTS,
  unionWindows
} from "./calendar-utils.ts";
import { toInstantMs } from "./date-utils.ts";
import { subtractDates } from "./people-utils.ts";

/** One weekday window of a shift, with the timezone it is expressed in. */
export type LadderShiftRow = {
  dayOfWeek: number; // 0 = Sunday .. 6 = Saturday
  startTime: string;
  endTime: string;
  timezone: string;
};

/** A work center plus its lights-out flag and location timezone. */
export type WorkCenterAvailabilityInput = {
  id: string;
  alwaysOn: boolean;
  locationId: string | null;
  /** Location IANA timezone; "UTC" when the location has none. */
  timezone: string;
};

/** Group ladder shift rows by their timezone, expand each group, union. */
function expandLadderShifts(
  rows: LadderShiftRow[],
  rangeStart: number,
  rangeEnd: number
): CalendarWindow[] {
  const byTz = new Map<string, CalendarShiftRow[]>();
  for (const r of rows) {
    const list = byTz.get(r.timezone) ?? [];
    list.push({
      dayOfWeek: r.dayOfWeek,
      startTime: r.startTime,
      endTime: r.endTime
    });
    byTz.set(r.timezone, list);
  }
  const lists = Array.from(byTz.entries()).map(([tz, shifts]) =>
    expandCalendar(shifts, rangeStart, rangeEnd, tz)
  );
  return unionWindows(lists);
}

function resolveOne(
  wc: WorkCenterAvailabilityInput,
  wcShifts: LadderShiftRow[],
  locationShifts: LadderShiftRow[],
  rangeStart: number,
  rangeEnd: number
): CalendarWindow[] {
  // rung 1a — lights-out: one continuous window
  if (wc.alwaysOn) {
    return [
      {
        start: rangeStart,
        end: rangeEnd
      }
    ];
  }
  // rung 1b — explicit work-center shifts
  if (wcShifts.length > 0) {
    return expandLadderShifts(wcShifts, rangeStart, rangeEnd);
  }
  // rung 2 — the location's shifts
  if (locationShifts.length > 0) {
    return expandLadderShifts(locationShifts, rangeStart, rangeEnd);
  }
  // rung 3 — stock Mon–Fri 08:00–16:00 (8h) in the location timezone
  return expandCalendar(
    STOCK_WEEK_SHIFTS,
    rangeStart,
    rangeEnd,
    wc.timezone || "UTC"
  );
}

/**
 * Resolve the machine-availability ladder for a set of work centers. Returns a
 * map of work-center id → its open windows over [rangeStart, rangeEnd).
 */
export function resolveWorkCenterWindows(args: {
  workCenters: WorkCenterAvailabilityInput[];
  workCenterShiftRows: (LadderShiftRow & { workCenterId: string })[];
  locationShiftRows: (LadderShiftRow & { locationId: string })[];
  rangeStart: number;
  rangeEnd: number;
}): Map<string, CalendarWindow[]> {
  const {
    workCenters,
    workCenterShiftRows,
    locationShiftRows,
    rangeStart,
    rangeEnd
  } = args;

  const wcShiftsByWc = new Map<string, LadderShiftRow[]>();
  for (const r of workCenterShiftRows) {
    const list = wcShiftsByWc.get(r.workCenterId) ?? [];
    list.push(r);
    wcShiftsByWc.set(r.workCenterId, list);
  }
  const locShiftsByLoc = new Map<string, LadderShiftRow[]>();
  for (const r of locationShiftRows) {
    const list = locShiftsByLoc.get(r.locationId) ?? [];
    list.push(r);
    locShiftsByLoc.set(r.locationId, list);
  }

  const result = new Map<string, CalendarWindow[]>();
  for (const wc of workCenters) {
    const locShifts =
      wc.locationId != null ? (locShiftsByLoc.get(wc.locationId) ?? []) : [];
    result.set(
      wc.id,
      resolveOne(
        wc,
        wcShiftsByWc.get(wc.id) ?? [],
        locShifts,
        rangeStart,
        rangeEnd
      )
    );
  }
  return result;
}

/**
 * Resolve rung 2/3 of the ladder for a single location — the default calendar
 * for people with no `employeeShift` rows (they default to plant hours, not
 * 24×7). Location shifts if any, else the stock Mon–Fri week in `timezone`.
 */
export function resolveLocationWindows(args: {
  timezone: string;
  locationShiftRows: LadderShiftRow[];
  rangeStart: number;
  rangeEnd: number;
}): CalendarWindow[] {
  const { timezone, locationShiftRows, rangeStart, rangeEnd } = args;
  if (locationShiftRows.length > 0) {
    return expandLadderShifts(locationShiftRows, rangeStart, rangeEnd);
  }
  return expandCalendar(
    STOCK_WEEK_SHIFTS,
    rangeStart,
    rangeEnd,
    timezone || "UTC"
  );
}

/**
 * Close every work center on the company's holidays (whole local days in the
 * work center's own timezone). A lights-out (`alwaysOn`) station keeps running.
 */
export function closeHolidays(args: {
  windowsByWorkCenter: Map<string, CalendarWindow[]>;
  workCenters: WorkCenterAvailabilityInput[];
  holidayDates: Set<string>;
}): Map<string, CalendarWindow[]> {
  const { windowsByWorkCenter, workCenters, holidayDates } = args;
  if (holidayDates.size === 0) return windowsByWorkCenter;
  const result = new Map(windowsByWorkCenter);
  for (const wc of workCenters) {
    const windows = result.get(wc.id);
    if (!windows || wc.alwaysOn) continue;
    result.set(wc.id, subtractDates(windows, holidayDates, wc.timezone));
  }
  return result;
}

type Instant = Date | string;

/**
 * Outage windows per work center from open maintenance dispatches flagged
 * `takesWorkCenterOffline`. A dispatch is down from (actualStartTime ??
 * plannedStartTime ?? createdAt) to (actualEndTime ?? plannedEndTime ??
 * `rangeEnd`: no end estimate means down until further notice), on its own
 * work center and every work center joined to it. Only `workCenterIds` are
 * returned. An `alwaysOn` station is not exempt: a broken lights-out machine
 * is still down.
 */
export function downtimeOutages(args: {
  dispatches: {
    id: string;
    workCenterId: string | null;
    plannedStartTime: Instant | null;
    plannedEndTime: Instant | null;
    actualStartTime: Instant | null;
    actualEndTime: Instant | null;
    createdAt: Instant;
  }[];
  dispatchWorkCenters: {
    maintenanceDispatchId: string;
    workCenterId: string;
  }[];
  workCenterIds: string[];
  rangeEnd: number;
}): Map<string, CalendarWindow[]> {
  const joined = new Map<string, string[]>();
  for (const row of args.dispatchWorkCenters) {
    const list = joined.get(row.maintenanceDispatchId) ?? [];
    list.push(row.workCenterId);
    joined.set(row.maintenanceDispatchId, list);
  }
  const wanted = new Set(args.workCenterIds);
  const outages = new Map<string, CalendarWindow[]>();
  for (const dispatch of args.dispatches) {
    const start = toInstantMs(
      dispatch.actualStartTime ??
        dispatch.plannedStartTime ??
        dispatch.createdAt
    );
    const endAt = dispatch.actualEndTime ?? dispatch.plannedEndTime;
    const end = endAt ? toInstantMs(endAt) : args.rangeEnd;
    const affected = new Set(
      [dispatch.workCenterId, ...(joined.get(dispatch.id) ?? [])].filter(
        (id): id is string => id !== null && wanted.has(id)
      )
    );
    for (const workCenterId of affected) {
      const list = outages.get(workCenterId) ?? [];
      list.push({ start, end });
      outages.set(workCenterId, list);
    }
  }
  return outages;
}
