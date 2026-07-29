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
