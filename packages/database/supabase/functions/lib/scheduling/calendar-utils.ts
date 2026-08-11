/**
 * Availability-window + slot-walking utilities for finite scheduling.
 * Pure functions — no DB access.
 *
 * Work centers are always open (24/7) — availability constraints come from
 * PEOPLE: a qualified employee's assigned shifts (`employeeShift` ⋈ `shift`)
 * expand into concrete UTC working windows. An employee with no shift
 * assignment is treated as always available.
 */

import {
  CalendarDateTime,
  parseAbsolute,
  toCalendarDate,
  toZoned
} from "@internationalized/date";
import { DAY_MS, HOUR_MS } from "./date-utils.ts";

export type CalendarShiftRow = {
  dayOfWeek: number; // 0 = Sunday .. 6 = Saturday
  startTime: string; // "HH:MM" or "HH:MM:SS", local to the shift's timezone
  endTime: string;
};

export type CalendarWindow = {
  start: Date;
  end: Date;
};


/** Local calendar date (y/m/d) of a UTC instant in a timezone. */
function localDateParts(
  date: Date,
  timeZone: string
): { year: number; month: number; day: number } {
  const local = toCalendarDate(parseAbsolute(date.toISOString(), timeZone));
  return { year: local.year, month: local.month, day: local.day };
}

/**
 * Convert a local wall-clock time on a local calendar day to the UTC instant.
 * `dayDate` is UTC midnight representing the local calendar day (its UTC
 * y/m/d fields ARE the local date). `toZoned`'s default "compatible"
 * disambiguation handles DST: a time inside the spring-forward gap shifts to
 * the post-gap hour; a repeated fall-back time takes its first occurrence.
 */
export function shiftTimeToDate(
  dayDate: Date,
  time: string,
  timezone: string
): Date {
  const [h, m, s] = time.split(":").map((v) => Number(v));
  return toZoned(
    new CalendarDateTime(
      dayDate.getUTCFullYear(),
      dayDate.getUTCMonth() + 1,
      dayDate.getUTCDate(),
      h ?? 0,
      m ?? 0,
      s ?? 0
    ),
    timezone
  ).toDate();
}

/** Clip an interval to [rangeStart, rangeEnd); null if empty. */
function clip(
  start: number,
  end: number,
  rangeStart: number,
  rangeEnd: number
): { start: number; end: number } | null {
  const s = Math.max(start, rangeStart);
  const e = Math.min(end, rangeEnd);
  return e > s ? { start: s, end: e } : null;
}

/** Merge raw ms intervals into disjoint, chronologically sorted windows. */
function mergeIntervals(
  intervals: { start: number; end: number }[]
): CalendarWindow[] {
  const sorted = [...intervals].sort((a, b) => a.start - b.start);
  const result: CalendarWindow[] = [];
  for (const i of sorted) {
    const prev = result[result.length - 1];
    if (prev && i.start <= prev.end.getTime()) {
      if (i.end > prev.end.getTime()) {
        prev.end = new Date(i.end);
      }
    } else {
      result.push({ start: new Date(i.start), end: new Date(i.end) });
    }
  }
  return result;
}

/**
 * Expand a weekly shift pattern into concrete, disjoint, chronologically
 * sorted working windows over [rangeStart, rangeEnd).
 *
 * - Empty `shifts` => one 24x7 window covering the whole range (a person with
 *   no shift assignment is always available).
 * - An overnight shift row (endTime <= startTime) runs into the next day.
 */
export function expandCalendar(
  shifts: CalendarShiftRow[],
  rangeStart: Date,
  rangeEnd: Date,
  timezone = "UTC"
): CalendarWindow[] {
  const rangeStartMs = rangeStart.getTime();
  const rangeEndMs = rangeEnd.getTime();
  if (rangeEndMs <= rangeStartMs) {
    return [];
  }

  if (shifts.length === 0) {
    return [{ start: new Date(rangeStartMs), end: new Date(rangeEndMs) }];
  }

  // Iterate local calendar days covering the range (pad one day each side
  // so overnight shifts and tz offsets can't clip the boundary days).
  const intervals: { start: number; end: number }[] = [];
  const startLocal = localDateParts(rangeStart, timezone);
  let dayCursor = Date.UTC(
    startLocal.year,
    startLocal.month - 1,
    startLocal.day
  );
  dayCursor -= DAY_MS;
  const lastDay = rangeEndMs + DAY_MS;

  for (; dayCursor <= lastDay; dayCursor += DAY_MS) {
    const dayDate = new Date(dayCursor);
    const dow = dayDate.getUTCDay(); // weekday of the local calendar date
    for (const shift of shifts) {
      if (shift.dayOfWeek !== dow) continue;
      const start = shiftTimeToDate(dayDate, shift.startTime, timezone);
      let end = shiftTimeToDate(dayDate, shift.endTime, timezone);
      if (end.getTime() <= start.getTime()) {
        // overnight shift: ends the next local day
        end = shiftTimeToDate(
          new Date(dayCursor + DAY_MS),
          shift.endTime,
          timezone
        );
      }
      const clipped = clip(
        start.getTime(),
        end.getTime(),
        rangeStartMs,
        rangeEndMs
      );
      if (clipped) {
        intervals.push(clipped);
      }
    }
  }

  return mergeIntervals(intervals);
}

/**
 * Union several window lists (e.g. each pool member's availability) into one
 * disjoint sorted list: time where AT LEAST ONE member is available.
 */
export function unionWindows(windowLists: CalendarWindow[][]): CalendarWindow[] {
  const intervals: { start: number; end: number }[] = [];
  for (const list of windowLists) {
    for (const w of list) {
      intervals.push({ start: w.start.getTime(), end: w.end.getTime() });
    }
  }
  return mergeIntervals(intervals);
}

/** Whether an instant falls inside any window. */
export function coversInstant(windows: CalendarWindow[], at: number): boolean {
  for (const w of windows) {
    if (w.start.getTime() <= at && w.end.getTime() > at) {
      return true;
    }
  }
  return false;
}

/** Count reservations overlapping [start, end). */
export function countOverlaps(
  reservations: { startAt: Date; endAt: Date }[],
  start: Date,
  end: Date
): number {
  const s = start.getTime();
  const e = end.getTime();
  let count = 0;
  for (const r of reservations) {
    if (r.startAt.getTime() < e && r.endAt.getTime() > s) {
      count++;
    }
  }
  return count;
}

export type SlotResult = { start: Date; end: Date } | null;

/**
 * Find the earliest interval >= earliestStart inside `windows` that
 * accumulates `durationHours` of working time. An operation may span multiple
 * windows (gaps between windows are non-working time and do not count toward
 * the duration). `isFree(start, end)` is consulted per candidate placement;
 * on rejection the walk resumes from `nextTryAfter` (or the next window
 * boundary when absent).
 */
export function findSlot(args: {
  windows: CalendarWindow[];
  durationHours: number;
  earliestStart: Date;
  isFree: (start: Date, end: Date) => { free: boolean; nextTryAfter?: Date };
}): SlotResult {
  const { windows, durationHours, earliestStart, isFree } = args;
  if (windows.length === 0) {
    return null;
  }

  const durationMs = durationHours * HOUR_MS;
  let candidate = earliestStart.getTime();

  // Cap iterations as a runaway guard; each iteration advances the candidate.
  for (let guard = 0; guard < 100_000; guard++) {
    // snap candidate into a window
    const windowIndex = windows.findIndex((w) => w.end.getTime() > candidate);
    if (windowIndex === -1) {
      return null; // horizon exhausted
    }
    const startMs = Math.max(candidate, windows[windowIndex].start.getTime());

    // accumulate working time across windows from startMs
    let remaining = durationMs;
    let endMs = startMs;
    let i = windowIndex;
    while (remaining > 0) {
      if (i >= windows.length) {
        return null; // cannot fit before the end of the horizon
      }
      const from = i === windowIndex ? startMs : windows[i].start.getTime();
      const available = windows[i].end.getTime() - from;
      if (available >= remaining) {
        endMs = from + remaining;
        remaining = 0;
      } else {
        remaining -= Math.max(available, 0);
        i++;
      }
    }

    const start = new Date(startMs);
    const end = new Date(endMs);
    const check = isFree(start, end);
    if (check.free) {
      return { start, end };
    }

    // advance: explicit hint, else the next window boundary
    let next = check.nextTryAfter?.getTime() ?? null;
    if (next === null || next <= candidate) {
      const nextBoundary = windows
        .map((w) => w.start.getTime())
        .find((b) => b > startMs);
      next = nextBoundary ?? null;
      if (next === null) {
        return null;
      }
    }
    candidate = next;
  }

  return null;
}
