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
 * subtracted from the resolved windows by the caller (see Task 17).
 */

import {
  type CalendarShiftRow,
  type CalendarWindow,
  expandCalendar,
  STOCK_WEEK_SHIFTS,
  unionWindows
} from "./calendar-utils.ts";

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
