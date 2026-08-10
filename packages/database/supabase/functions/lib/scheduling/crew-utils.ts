/**
 * Pure helpers for crew-assignment (manning board) scheduling inputs.
 * No DB imports — covered by deno tests (crew-utils.test.ts).
 *
 * Date keys are local calendar dates ("YYYY-MM-DD") in the company/location
 * timezone; availability windows are UTC instants (CalendarWindow).
 */
import type { CalendarWindow } from "./calendar-utils.ts";

/** A manning-board row: person crewed at a work center for a date. */
export type CrewAssignmentRow = {
  workCenterId: string;
  employeeId: string;
  /** YYYY-MM-DD */
  date: string;
  shiftId: string | null;
  /** authorized extra hours on top of the shift for this station/date */
  overtimeHours?: number;
  /** partial-day hours at this station; null/undefined = the whole shift */
  hours?: number | null;
};

/** Person out for a date (shift-scoped absences count as the whole day). */
export type CrewAbsenceRow = {
  employeeId: string;
  /** YYYY-MM-DD */
  date: string;
  shiftId: string | null;
};

/** Local calendar date (YYYY-MM-DD) of a UTC instant in a timezone. */
export function dateKeyInTimeZone(instant: Date, timeZone: string): string {
  // en-CA formats as YYYY-MM-DD
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(instant);
}

/** Timezone offset (ms to ADD to a UTC instant to get local wall time). */
function tzOffsetMs(date: Date, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = dtf.formatToParts(date);
  const get = (t: string) =>
    Number(parts.find((p) => p.type === t)?.value ?? 0);
  const asUTC = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour") % 24,
    get("minute"),
    get("second")
  );
  return asUTC - date.getTime();
}

/** dateKey + n days (pure calendar arithmetic). */
function addDaysToKey(dateKey: string, days: number): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + days));
  return next.toISOString().slice(0, 10);
}

/** The UTC instant of local midnight on `dateKey` (two-pass DST correction). */
function zonedMidnight(dateKey: string, timeZone: string): Date {
  const [y, m, d] = dateKey.split("-").map(Number);
  const naive = Date.UTC(y, m - 1, d);
  const offset1 = tzOffsetMs(new Date(naive), timeZone);
  const corrected = new Date(naive - offset1);
  const offset2 = tzOffsetMs(corrected, timeZone);
  return new Date(naive - offset2);
}

type DaySegment = { start: Date; end: Date; dateKey: string };

/** Split a window at local-midnight boundaries into per-day segments. */
function splitWindowByLocalDays(
  window: CalendarWindow,
  timeZone: string
): DaySegment[] {
  const segments: DaySegment[] = [];
  let cursor = window.start;
  // Guard against pathological loops on broken tz data: a window never spans
  // more than ~10 years of days in practice
  let guard = 0;
  while (cursor.getTime() < window.end.getTime() && guard++ < 4000) {
    const dateKey = dateKeyInTimeZone(cursor, timeZone);
    const nextMidnight = zonedMidnight(addDaysToKey(dateKey, 1), timeZone);
    const segmentEnd =
      nextMidnight.getTime() < window.end.getTime() ? nextMidnight : window.end;
    if (segmentEnd.getTime() > cursor.getTime()) {
      segments.push({ start: cursor, end: segmentEnd, dateKey });
    }
    cursor = segmentEnd;
  }
  return segments;
}

/** Re-join adjacent kept segments into windows. */
function mergeSegments(segments: DaySegment[]): CalendarWindow[] {
  const result: CalendarWindow[] = [];
  for (const segment of segments) {
    const prev = result[result.length - 1];
    if (prev && prev.end.getTime() === segment.start.getTime()) {
      prev.end = segment.end;
    } else {
      result.push({ start: segment.start, end: segment.end });
    }
  }
  return result;
}

/**
 * crew rows -> workCenterId -> dateKey -> employeeIds.
 * Callers should exclude absent people from `rows` first.
 */
export function buildCrewByWorkCenter(
  rows: CrewAssignmentRow[]
): Map<string, Map<string, string[]>> {
  const map = new Map<string, Map<string, string[]>>();
  for (const row of rows) {
    let byDate = map.get(row.workCenterId);
    if (!byDate) {
      byDate = new Map();
      map.set(row.workCenterId, byDate);
    }
    let employees = byDate.get(row.date);
    if (!employees) {
      employees = [];
      byDate.set(row.date, employees);
    }
    if (!employees.includes(row.employeeId)) {
      employees.push(row.employeeId);
    }
  }
  return map;
}

/**
 * absence rows -> employeeId -> Set of absent dateKeys.
 * v1: a shift-scoped absence counts as the whole day.
 */
export function buildAbsencesByEmployee(
  rows: CrewAbsenceRow[]
): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  for (const row of rows) {
    let dates = map.get(row.employeeId);
    if (!dates) {
      dates = new Set();
      map.set(row.employeeId, dates);
    }
    dates.add(row.date);
  }
  return map;
}

/**
 * Remove the parts of an employee's availability windows that fall on absent
 * dates. Empty `absentDates` returns the input untouched (empty-board /
 * no-absence guarantee: byte-identical windows).
 */
export function subtractAbsences(
  windows: CalendarWindow[],
  absentDates: Set<string>,
  timeZone: string
): CalendarWindow[] {
  if (absentDates.size === 0) return windows;
  const kept: DaySegment[] = [];
  for (const window of windows) {
    for (const segment of splitWindowByLocalDays(window, timeZone)) {
      if (!absentDates.has(segment.dateKey)) {
        kept.push(segment);
      }
    }
  }
  return mergeSegments(kept);
}

/**
 * Keep only window parts on the given dates (a crew member "mans" a station
 * only on the dates they're actually crewed there).
 */
export function clipWindowsToDates(
  windows: CalendarWindow[],
  dates: Set<string>,
  timeZone: string
): CalendarWindow[] {
  if (dates.size === 0) return [];
  const kept: DaySegment[] = [];
  for (const window of windows) {
    for (const segment of splitWindowByLocalDays(window, timeZone)) {
      if (dates.has(segment.dateKey)) {
        kept.push(segment);
      }
    }
  }
  return mergeSegments(kept);
}

const HOUR_MS = 3_600_000;

/**
 * employeeId -> dateKey -> authorized overtime hours that day.
 *
 * Overtime is a property of the person's DAY, not of a station: 2h of overtime
 * is 2h however many stations they split across. The column lives on every
 * assignment row (writers stamp the same day value on each), so this takes the
 * MAX across a day's rows rather than summing them — summing would multiply a
 * split person's overtime by their station count.
 * Callers should exclude absent people's rows first.
 */
export function buildOvertimeByEmployee(
  rows: CrewAssignmentRow[]
): Map<string, Map<string, number>> {
  const map = new Map<string, Map<string, number>>();
  for (const row of rows) {
    const overtime = row.overtimeHours ?? 0;
    if (overtime <= 0) continue;
    let byDate = map.get(row.employeeId);
    if (!byDate) {
      byDate = new Map();
      map.set(row.employeeId, byDate);
    }
    byDate.set(row.date, Math.max(byDate.get(row.date) ?? 0, overtime));
  }
  return map;
}

/** Sort + merge overlapping/touching windows (never mutates the input). */
function normalizeWindows(windows: CalendarWindow[]): CalendarWindow[] {
  const sorted = windows
    .map((w) => ({ start: w.start, end: w.end }))
    .sort((a, b) => a.start.getTime() - b.start.getTime());
  const out: CalendarWindow[] = [];
  for (const window of sorted) {
    const prev = out[out.length - 1];
    if (prev && window.start.getTime() <= prev.end.getTime()) {
      if (window.end.getTime() > prev.end.getTime()) prev.end = window.end;
    } else {
      out.push(window);
    }
  }
  return out;
}

/**
 * Authorized overtime = a longer day: each overtime date's LAST window is
 * extended by that day's hours (an extension that reaches into a following
 * window merges with it). Dates where the person has no window (absent, not
 * working) get no extension. Empty map returns the input untouched.
 */
export function extendWindowsByOvertime(
  windows: CalendarWindow[],
  overtimeByDate: Map<string, number>,
  timeZone: string
): CalendarWindow[] {
  if (overtimeByDate.size === 0) return windows;

  // the window "belongs" to the local date it ends on (end - 1ms so a window
  // ending exactly at midnight counts toward the day before)
  const lastWindowIndexByDate = new Map<string, number>();
  windows.forEach((window, index) => {
    const dateKey = dateKeyInTimeZone(
      new Date(window.end.getTime() - 1),
      timeZone
    );
    const current = lastWindowIndexByDate.get(dateKey);
    if (
      current === undefined ||
      window.end.getTime() > windows[current].end.getTime()
    ) {
      lastWindowIndexByDate.set(dateKey, index);
    }
  });

  const extended = windows.map((window, index) => {
    for (const [dateKey, hours] of overtimeByDate) {
      if (hours > 0 && lastWindowIndexByDate.get(dateKey) === index) {
        return {
          start: window.start,
          end: new Date(window.end.getTime() + hours * HOUR_MS)
        };
      }
    }
    return window;
  });
  return normalizeWindows(extended);
}

/** One station's share of a person's day, in row order. */
export type CrewDayRow = { workCenterId: string; hours: number | null };

/**
 * employeeId -> dateKey -> that day's station rows in input order (the
 * provider orders rows deterministically, so "the first rows get the first
 * hours" is stable across runs).
 */
export function buildCrewBudgets(
  rows: CrewAssignmentRow[]
): Map<string, Map<string, CrewDayRow[]>> {
  const map = new Map<string, Map<string, CrewDayRow[]>>();
  for (const row of rows) {
    let byDate = map.get(row.employeeId);
    if (!byDate) {
      byDate = new Map();
      map.set(row.employeeId, byDate);
    }
    let dayRows = byDate.get(row.date);
    if (!dayRows) {
      dayRows = [];
      byDate.set(row.date, dayRows);
    }
    dayRows.push({ workCenterId: row.workCenterId, hours: row.hours ?? null });
  }
  return map;
}

/**
 * A member's availability AT ONE STATION: windows clipped to their crewed
 * dates there and, on split days, to their hours budget at that station.
 * The day's attended time is dealt out sequentially in row order — the first
 * row gets the first hours of the day, the next row the following hours.
 * A sole whole-shift row keeps the full day (identical to
 * clipWindowsToDates), so unsplit boards behave exactly as before.
 */
export function clipWindowsToStation(
  windows: CalendarWindow[],
  workCenterId: string,
  dates: Set<string>,
  dayRowsByDate: Map<string, CrewDayRow[]> | undefined,
  timeZone: string
): CalendarWindow[] {
  if (dates.size === 0) return [];

  // chronological day segments, grouped per local date
  const segmentsByDate = new Map<string, DaySegment[]>();
  for (const window of windows) {
    for (const segment of splitWindowByLocalDays(window, timeZone)) {
      if (!dates.has(segment.dateKey)) continue;
      const list = segmentsByDate.get(segment.dateKey) ?? [];
      list.push(segment);
      segmentsByDate.set(segment.dateKey, list);
    }
  }

  const kept: DaySegment[] = [];
  for (const [dateKey, segments] of segmentsByDate) {
    segments.sort((a, b) => a.start.getTime() - b.start.getTime());
    const dayRows = dayRowsByDate?.get(dateKey);
    const isWholeDay =
      !dayRows || (dayRows.length === 1 && dayRows[0].hours === null);
    if (isWholeDay) {
      kept.push(...segments);
      continue;
    }

    // walk earlier rows to find this station's slice of the attended day
    let offsetMs = 0;
    let budgetMs: number | null = null;
    let found = false;
    for (const row of dayRows) {
      if (row.workCenterId === workCenterId) {
        budgetMs = row.hours === null ? null : row.hours * HOUR_MS;
        found = true;
        break;
      }
      if (row.hours === null) {
        // an earlier whole-shift row consumes the rest of the day
        offsetMs = Number.POSITIVE_INFINITY;
        break;
      }
      offsetMs += row.hours * HOUR_MS;
    }
    if (!found && offsetMs !== Number.POSITIVE_INFINITY) {
      // dates come from this station's rows, so this shouldn't happen —
      // fall back to the whole day rather than silently dropping the person
      kept.push(...segments);
      continue;
    }

    let toSkip = offsetMs;
    let toKeep = budgetMs === null ? Number.POSITIVE_INFINITY : budgetMs;
    for (const segment of segments) {
      const lengthMs = segment.end.getTime() - segment.start.getTime();
      if (toSkip >= lengthMs) {
        toSkip -= lengthMs;
        continue;
      }
      if (toKeep <= 0) break;
      const startMs = segment.start.getTime() + toSkip;
      toSkip = 0;
      const takeMs = Math.min(segment.end.getTime() - startMs, toKeep);
      if (takeMs > 0) {
        kept.push({
          start: new Date(startMs),
          end: new Date(startMs + takeMs),
          dateKey
        });
        toKeep -= takeMs;
      }
    }
  }

  kept.sort((a, b) => a.start.getTime() - b.start.getTime());
  return mergeSegments(kept);
}
