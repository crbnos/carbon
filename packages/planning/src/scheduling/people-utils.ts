/**
 * Pure helpers for people-assignment (manning board) scheduling inputs.
 * No DB imports — covered by deno tests (people-utils.test.ts).
 *
 * Date keys are local calendar dates ("YYYY-MM-DD") in the company/location
 * timezone; availability windows are UTC instants (CalendarWindow).
 */
import { parseDate } from "@internationalized/date";
import type { CalendarWindow } from "./calendar-utils.ts";
import { businessDayFromMs, HOUR_MS } from "./date-utils.ts";

/** A manning-board row: person assigned at a work center for a date. */
export type PeopleAssignmentRow = {
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
export type PeopleAbsenceRow = {
  employeeId: string;
  /** YYYY-MM-DD */
  date: string;
  shiftId: string | null;
};

/** Local calendar date (YYYY-MM-DD) of a UTC instant (epoch-ms) in a timezone. */
export function dateKeyInTimeZone(instant: number, timeZone: string): string {
  return businessDayFromMs(instant, timeZone);
}

/** dateKey + n days (pure calendar arithmetic). */
function addDaysToKey(dateKey: string, days: number): string {
  return parseDate(dateKey).add({ days }).toString();
}

/**
 * The UTC instant (epoch-ms) the local day starts on `dateKey` —
 * CalendarDate.toDate(tz) resolves a midnight skipped by DST to the day's true
 * first instant.
 */
function zonedMidnight(dateKey: string, timeZone: string): number {
  return parseDate(dateKey).toDate(timeZone).getTime();
}

type DaySegment = { start: number; end: number; dateKey: string };

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
  while (cursor < window.end && guard++ < 4000) {
    const dateKey = dateKeyInTimeZone(cursor, timeZone);
    const nextMidnight = zonedMidnight(addDaysToKey(dateKey, 1), timeZone);
    const segmentEnd = nextMidnight < window.end ? nextMidnight : window.end;
    if (segmentEnd > cursor) {
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
    if (prev && prev.end === segment.start) {
      prev.end = segment.end;
    } else {
      result.push({ start: segment.start, end: segment.end });
    }
  }
  return result;
}

/**
 * people rows -> workCenterId -> dateKey -> employeeIds.
 * Callers should exclude absent people from `rows` first.
 */
export function buildPeopleByWorkCenter(
  rows: PeopleAssignmentRow[]
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
 * employeeId -> dateKey -> the set of work centers the person is assigned at
 * that day. The manning board read: a person on the board that day is
 * "committed" to those stations. Empty when the board is blank (no
 * assignments in the horizon), which keeps blank-board scheduling identical to
 * pre-people behavior. Derived from the same rows as buildPeopleByWorkCenter
 * (absent people already removed by the caller).
 */
export function buildAssignmentsByEmployee(
  peopleByWorkCenter: Map<string, Map<string, string[]>>
): Map<string, Map<string, Set<string>>> {
  const map = new Map<string, Map<string, Set<string>>>();
  for (const [workCenterId, byDate] of peopleByWorkCenter) {
    for (const [dateKey, employeeIds] of byDate) {
      for (const employeeId of employeeIds) {
        let byDateForEmployee = map.get(employeeId);
        if (!byDateForEmployee) {
          byDateForEmployee = new Map();
          map.set(employeeId, byDateForEmployee);
        }
        let stations = byDateForEmployee.get(dateKey);
        if (!stations) {
          stations = new Set();
          byDateForEmployee.set(dateKey, stations);
        }
        stations.add(workCenterId);
      }
    }
  }
  return map;
}

/**
 * absence rows -> employeeId -> Set of absent dateKeys.
 * v1: a shift-scoped absence counts as the whole day.
 */
export function buildAbsencesByEmployee(
  rows: PeopleAbsenceRow[]
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
 * Remove the parts of an availability-window list that fall on the given local
 * dates. Empty `dates` returns the input untouched (byte-identical windows).
 * The primitive behind both absence subtraction and the "committed elsewhere"
 * clip in the any-qualified fallback.
 */
export function subtractDates(
  windows: CalendarWindow[],
  dates: Set<string>,
  timeZone: string
): CalendarWindow[] {
  if (dates.size === 0) return windows;
  const kept: DaySegment[] = [];
  for (const window of windows) {
    for (const segment of splitWindowByLocalDays(window, timeZone)) {
      if (!dates.has(segment.dateKey)) {
        kept.push(segment);
      }
    }
  }
  return mergeSegments(kept);
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
  return subtractDates(windows, absentDates, timeZone);
}

/**
 * Keep only window parts on the given dates (a people member "mans" a station
 * only on the dates they're actually assigned there).
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
  rows: PeopleAssignmentRow[]
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
    .sort((a, b) => a.start - b.start);
  const out: CalendarWindow[] = [];
  for (const window of sorted) {
    const prev = out[out.length - 1];
    if (prev && window.start <= prev.end) {
      if (window.end > prev.end) prev.end = window.end;
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
    const dateKey = dateKeyInTimeZone(window.end - 1, timeZone);
    const current = lastWindowIndexByDate.get(dateKey);
    if (current === undefined || window.end > windows[current]!.end) {
      lastWindowIndexByDate.set(dateKey, index);
    }
  });

  const extended = windows.map((window, index) => {
    for (const [dateKey, hours] of overtimeByDate) {
      if (hours > 0 && lastWindowIndexByDate.get(dateKey) === index) {
        return {
          start: window.start,
          end: window.end + hours * HOUR_MS
        };
      }
    }
    return window;
  });
  return normalizeWindows(extended);
}

/** One station's share of a person's day, in row order. */
export type PeopleDayRow = { workCenterId: string; hours: number | null };

/**
 * employeeId -> dateKey -> that day's station rows in input order (the
 * provider orders rows deterministically, so "the first rows get the first
 * hours" is stable across runs).
 */
export function buildPeopleBudgets(
  rows: PeopleAssignmentRow[]
): Map<string, Map<string, PeopleDayRow[]>> {
  const map = new Map<string, Map<string, PeopleDayRow[]>>();
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
 * A member's availability AT ONE STATION: windows clipped to their assigned
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
  dayRowsByDate: Map<string, PeopleDayRow[]> | undefined,
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
    segments.sort((a, b) => a.start - b.start);
    const dayRows = dayRowsByDate?.get(dateKey);
    const isWholeDay =
      !dayRows || (dayRows.length === 1 && dayRows[0]!.hours === null);
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
      const lengthMs = segment.end - segment.start;
      if (toSkip >= lengthMs) {
        toSkip -= lengthMs;
        continue;
      }
      if (toKeep <= 0) break;
      const startMs = segment.start + toSkip;
      toSkip = 0;
      const takeMs = Math.min(segment.end - startMs, toKeep);
      if (takeMs > 0) {
        kept.push({
          start: startMs,
          end: startMs + takeMs,
          dateKey
        });
        toKeep -= takeMs;
      }
    }
  }

  kept.sort((a, b) => a.start - b.start);
  return mergeSegments(kept);
}
