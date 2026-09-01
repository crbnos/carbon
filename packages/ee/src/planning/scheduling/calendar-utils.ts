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
 *
 * Timeline instants (window bounds, slot ends, "now") are carried as
 * epoch-milliseconds `number`s — timezone-agnostic absolute instants, per
 * `.claude/rules/date-handling.md`. Calendar/wall-clock derivation goes through
 * `@internationalized/date`.
 */

import {
  type CalendarDate,
  CalendarDateTime,
  fromAbsolute,
  getDayOfWeek,
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
  /** epoch-ms */
  start: number;
  /** epoch-ms */
  end: number;
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

/**
 * Convert a local wall-clock time on a local calendar day to the UTC instant
 * (epoch-ms). `toZoned`'s default "compatible" disambiguation handles DST: a
 * time inside the spring-forward gap shifts to the post-gap hour; a repeated
 * fall-back time takes its first occurrence.
 */
export function shiftTimeToDate(
  day: CalendarDate,
  time: string,
  timezone: string
): number {
  const [h, m, s] = time.split(":").map((v) => Number(v));
  return toZoned(
    new CalendarDateTime(day.year, day.month, day.day, h ?? 0, m ?? 0, s ?? 0),
    timezone
  )
    .toDate()
    .getTime();
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
    if (prev && i.start <= prev.end) {
      if (i.end > prev.end) {
        prev.end = i.end;
      }
    } else {
      result.push({ start: i.start, end: i.end });
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
  rangeStart: number,
  rangeEnd: number,
  timezone = "UTC"
): CalendarWindow[] {
  if (rangeEnd <= rangeStart) {
    return [];
  }

  if (shifts.length === 0) {
    return [{ start: rangeStart, end: rangeEnd }];
  }

  // Iterate local calendar days covering the range (pad one day each side
  // so overnight shifts and tz offsets can't clip the boundary days).
  const intervals: { start: number; end: number }[] = [];
  const startLocal = toCalendarDate(fromAbsolute(rangeStart, timezone));
  let dayCursor: CalendarDate = startLocal.subtract({ days: 1 });
  const lastDay = rangeEnd + DAY_MS;

  for (
    ;
    dayCursor.toDate("UTC").getTime() <= lastDay;
    dayCursor = dayCursor.add({ days: 1 })
  ) {
    const dow = getDayOfWeek(dayCursor, "en-US"); // weekday of the local date
    for (const shift of shifts) {
      if (shift.dayOfWeek !== dow) continue;
      const start = shiftTimeToDate(dayCursor, shift.startTime, timezone);
      let end = shiftTimeToDate(dayCursor, shift.endTime, timezone);
      if (end <= start) {
        // overnight shift: ends the next local day
        end = shiftTimeToDate(
          dayCursor.add({ days: 1 }),
          shift.endTime,
          timezone
        );
      }
      const clipped = clip(start, end, rangeStart, rangeEnd);
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
      intervals.push({ start: w.start, end: w.end });
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
    const start = Math.max(ai.start, bj.start);
    const end = Math.min(ai.end, bj.end);
    if (end > start) {
      result.push({ start, end });
    }
    // advance whichever window ends first — the other may still overlap the next
    if (ai.end < bj.end) {
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
  from: number,
  durationMs: number,
  windows: CalendarWindow[]
): number | null {
  if (durationMs <= 0) {
    return from;
  }
  let remaining = durationMs;
  for (const w of windows) {
    const we = w.end;
    if (we <= from) continue; // window entirely at/behind `from`
    const segStart = Math.max(w.start, from);
    const available = we - segStart;
    if (available >= remaining) {
      return segStart + remaining;
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
    return windows.map((w) => ({ start: w.start, end: w.end }));
  }
  const result: CalendarWindow[] = [];
  for (const w of windows) {
    let segments = [{ start: w.start, end: w.end }];
    for (const o of outages) {
      const os = o.start;
      const oe = o.end;
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
        result.push({ start: seg.start, end: seg.end });
      }
    }
  }
  return result;
}

/** Whether an instant falls inside any window. */
export function coversInstant(windows: CalendarWindow[], at: number): boolean {
  for (const w of windows) {
    if (w.start <= at && w.end > at) {
      return true;
    }
  }
  return false;
}

/** Count reservations overlapping [start, end). */
export function countOverlaps(
  reservations: { startAt: number; endAt: number }[],
  start: number,
  end: number
): number {
  let count = 0;
  for (const r of reservations) {
    if (r.startAt < end && r.endAt > start) {
      count++;
    }
  }
  return count;
}

export type SlotResult = { start: number; end: number } | null;

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
  earliestStart: number;
  isFree: (
    start: number,
    end: number
  ) => { free: boolean; nextTryAfter?: number };
}): SlotResult {
  const { windows, durationHours, earliestStart, isFree } = args;
  if (windows.length === 0) {
    return null;
  }

  const durationMs = durationHours * HOUR_MS;
  let candidate = earliestStart;

  // Cap iterations as a runaway guard; each iteration advances the candidate.
  for (let guard = 0; guard < 100_000; guard++) {
    // snap candidate into a window
    const windowIndex = windows.findIndex((w) => w.end > candidate);
    if (windowIndex === -1) {
      return null; // horizon exhausted
    }
    const startMs = Math.max(candidate, windows[windowIndex]!.start);

    // accumulate working time across windows from startMs
    let remaining = durationMs;
    let endMs = startMs;
    let i = windowIndex;
    while (remaining > 0) {
      if (i >= windows.length) {
        return null; // cannot fit before the end of the horizon
      }
      const wi = windows[i]!;
      const from = i === windowIndex ? startMs : wi.start;
      const available = wi.end - from;
      if (available >= remaining) {
        endMs = from + remaining;
        remaining = 0;
      } else {
        remaining -= Math.max(available, 0);
        i++;
      }
    }

    const check = isFree(startMs, endMs);
    if (check.free) {
      return { start: startMs, end: endMs };
    }

    // advance: explicit hint, else the next window boundary
    let next = check.nextTryAfter ?? null;
    if (next === null || next <= candidate) {
      const nextBoundary = windows.map((w) => w.start).find((b) => b > startMs);
      next = nextBoundary ?? null;
      if (next === null) {
        return null;
      }
    }
    candidate = next;
  }

  return null;
}
