/**
 * Availability-window + slot-walking utilities for finite scheduling.
 * Pure functions — no DB access.
 *
 * Work centers are no longer "always open": machine availability comes from the
 * machine-availability ladder (explicit `workCenterShift` rows → the location's
 * shifts → a stock Mon–Fri 08:00–16:00 week), or one continuous window for an
 * `alwaysOn` (lights-out) machine. People windows (`employeeShift` ⋈ `shift`)
 * refine the machine calendar for attended operations — a person can't run a
 * closed machine, so member windows are intersected with the machine's.
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

/**
 * Stock default operating week (availability-ladder rung 3): Mon–Fri
 * 08:00–16:00 in the location's timezone, used when a work center has no
 * explicit shifts and its location has none either. An 8-hour working day
 * (no break carve-out), matching the people views' FALLBACK_SHIFT_HOURS = 8 so
 * machine and people capacity assume the same default day.
 */
export const STOCK_WEEK_SHIFTS: CalendarShiftRow[] = [1, 2, 3, 4, 5].map(
  (dayOfWeek) => ({ dayOfWeek, startTime: "08:00", endTime: "16:00" })
);

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
export function unionWindows(
  windowLists: CalendarWindow[][]
): CalendarWindow[] {
  const intervals: { start: number; end: number }[] = [];
  for (const list of windowLists) {
    for (const w of list) {
      intervals.push({ start: w.start.getTime(), end: w.end.getTime() });
    }
  }
  return mergeIntervals(intervals);
}

/**
 * Intersect two disjoint, chronologically sorted window lists into the time
 * where BOTH are available (standard two-pointer sweep). Used to clip a
 * person's availability to their machine's open hours — a person can't run a
 * closed machine. Inputs must be disjoint + sorted (as produced by
 * `expandCalendar`/`unionWindows`); the output is too.
 */
export function intersectWindows(
  a: CalendarWindow[],
  b: CalendarWindow[]
): CalendarWindow[] {
  const result: CalendarWindow[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    const ai = a[i]!;
    const bj = b[j]!;
    const start = Math.max(ai.start.getTime(), bj.start.getTime());
    const end = Math.min(ai.end.getTime(), bj.end.getTime());
    if (end > start) {
      result.push({ start: new Date(start), end: new Date(end) });
    }
    // advance whichever window ends first — the other may still overlap the next
    if (ai.end.getTime() < bj.end.getTime()) {
      i++;
    } else {
      j++;
    }
  }
  return result;
}

/**
 * Advance `from` by `durationMs` of IN-WINDOW time, skipping the gaps between
 * windows (non-working time doesn't count). Returns the finish instant, or null
 * when the windows run out before the duration accumulates. A zero (or
 * negative) duration returns `from` unchanged — so an unattended remainder of 0
 * finishes exactly at the attended end.
 */
export function addWorkingTime(
  from: Date,
  durationMs: number,
  windows: CalendarWindow[]
): Date | null {
  if (durationMs <= 0) {
    return new Date(from.getTime());
  }
  const fromMs = from.getTime();
  let remaining = durationMs;
  for (const w of windows) {
    const we = w.end.getTime();
    if (we <= fromMs) continue; // window entirely at/behind `from`
    const segStart = Math.max(w.start.getTime(), fromMs);
    const available = we - segStart;
    if (available >= remaining) {
      return new Date(segStart + remaining);
    }
    remaining -= available;
  }
  return null; // windows exhausted before the duration was reached
}

/**
 * Subtract outage intervals from availability windows — pure interval
 * subtraction. Each window is split around every overlapping outage; empty
 * remainders are dropped. Used to remove machine-downtime windows (open
 * maintenance dispatches) from the ladder's resolved windows. Inputs need not
 * be sorted relative to each other; the output preserves window order.
 */
export function subtractIntervals(
  windows: CalendarWindow[],
  outages: CalendarWindow[]
): CalendarWindow[] {
  if (outages.length === 0) {
    return windows.map((w) => ({
      start: new Date(w.start.getTime()),
      end: new Date(w.end.getTime())
    }));
  }
  const result: CalendarWindow[] = [];
  for (const w of windows) {
    let segments = [{ start: w.start.getTime(), end: w.end.getTime() }];
    for (const o of outages) {
      const os = o.start.getTime();
      const oe = o.end.getTime();
      const next: { start: number; end: number }[] = [];
      for (const seg of segments) {
        if (oe <= seg.start || os >= seg.end) {
          next.push(seg); // no overlap
          continue;
        }
        if (os > seg.start) next.push({ start: seg.start, end: os });
        if (oe < seg.end) next.push({ start: oe, end: seg.end });
      }
      segments = next;
    }
    for (const seg of segments) {
      if (seg.end > seg.start) {
        result.push({ start: new Date(seg.start), end: new Date(seg.end) });
      }
    }
  }
  return result;
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
    const startMs = Math.max(candidate, windows[windowIndex]!.start.getTime());

    // accumulate working time across windows from startMs
    let remaining = durationMs;
    let endMs = startMs;
    let i = windowIndex;
    while (remaining > 0) {
      if (i >= windows.length) {
        return null; // cannot fit before the end of the horizon
      }
      const wi = windows[i]!;
      const from = i === windowIndex ? startMs : wi.start.getTime();
      const available = wi.end.getTime() - from;
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
