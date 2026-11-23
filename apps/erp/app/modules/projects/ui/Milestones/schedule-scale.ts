// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { RoundingMode, round } from "@carbon/utils";
import {
  type CalendarDate,
  parseDate,
  startOfWeek
} from "@internationalized/date";
import { dayIndex } from "../Elements/timeline-geometry";

/** The Schedule's zoom: the bottom header row shows weeks, months or quarters. */
export const scheduleScales = ["week", "month", "quarter"] as const;
export type ScheduleScale = (typeof scheduleScales)[number];

/** Pixels per day at each scale. */
export const SCHEDULE_DAY_WIDTH: Record<ScheduleScale, number> = {
  week: 20,
  month: 6,
  quarter: 2
};

/** One header cell: the first and the last day it covers, `YYYY-MM-DD`. */
export type ScheduleSpan = { start: string; end: string };

export type ScheduleLayout = {
  /** The window's first and last day. */
  start: string;
  end: string;
  days: number;
  /** The top header row: months, quarters or years, clipped to the window. */
  groups: ScheduleSpan[];
  /** The bottom header row: weeks, months or quarters. */
  columns: ScheduleSpan[];
};

type Unit = {
  startOf: (date: CalendarDate) => CalendarDate;
  next: (date: CalendarDate) => CalendarDate;
};

const month: Unit = {
  startOf: (date) => date.set({ day: 1 }),
  next: (date) => date.add({ months: 1 })
};
const quarter: Unit = {
  startOf: (date) =>
    date.set({
      month: round((date.month - 1) / 3, 0, RoundingMode.Down) * 3 + 1,
      day: 1
    }),
  next: (date) => date.add({ months: 3 })
};
const year: Unit = {
  startOf: (date) => date.set({ month: 1, day: 1 }),
  next: (date) => date.add({ years: 1 })
};
const week: Unit = {
  // en-GB starts the week on Monday, as ISO 8601 does.
  startOf: (date) => startOfWeek(date, "en-GB"),
  next: (date) => date.add({ weeks: 1 })
};

/** The bottom row's unit and the top row's unit at each scale. */
const UNITS: Record<ScheduleScale, { column: Unit; group: Unit }> = {
  week: { column: week, group: month },
  month: { column: month, group: quarter },
  quarter: { column: quarter, group: year }
};

function spans(
  unit: Unit,
  start: CalendarDate,
  end: CalendarDate
): ScheduleSpan[] {
  const result: ScheduleSpan[] = [];
  let cursor = unit.startOf(start);
  while (cursor.compare(end) <= 0) {
    const next = unit.next(cursor);
    const first = cursor.compare(start) < 0 ? start : cursor;
    const lastOfUnit = next.subtract({ days: 1 });
    const last = lastOfUnit.compare(end) > 0 ? end : lastOfUnit;
    result.push({ start: first.toString(), end: last.toString() });
    cursor = next;
  }
  return result;
}

/**
 * The Schedule's calendar at `scale`: whole top-row periods (months,
 * quarters or years) that hold every milestone date and today, with one
 * bottom-row period of margin on each side, and at least `minDays` days so
 * the timeline fills a wide screen. The bottom row tiles the window with no
 * gap.
 */
export function scheduleLayout(
  dates: (string | null)[],
  today: string,
  scale: ScheduleScale,
  minDays = 0
): ScheduleLayout {
  const { column, group } = UNITS[scale];
  let earliest = parseDate(today);
  let latest = parseDate(today);
  for (const date of dates) {
    if (!date) continue;
    const day = parseDate(date);
    if (day.compare(earliest) < 0) earliest = day;
    if (day.compare(latest) > 0) latest = day;
  }

  // One bottom-row period of margin, then out to whole top-row periods.
  const marginStart = column.startOf(earliest).subtract({ days: 1 });
  const start = column.startOf(group.startOf(marginStart));
  let groupEnd = group.next(group.startOf(column.next(column.startOf(latest))));
  const endOf = (boundary: CalendarDate) =>
    column.next(column.startOf(boundary.subtract({ days: 1 }))).subtract({
      days: 1
    });
  let end = endOf(groupEnd);
  while (dayIndex(end.toString(), start.toString()) + 1 < minDays) {
    groupEnd = group.next(groupEnd);
    end = endOf(groupEnd);
  }

  return {
    start: start.toString(),
    end: end.toString(),
    days: dayIndex(end.toString(), start.toString()) + 1,
    groups: spans(group, start, end),
    columns: spans(column, start, end)
  };
}

/** Whether `date` falls in `span`, both days included. */
export function spanHolds(span: ScheduleSpan, date: string): boolean {
  return span.start <= date && date <= span.end;
}

/**
 * A milestone's bar in days from the window start: from its start to its
 * end, both days included. A milestone with one date gets a 1-day bar; with
 * no date, none. An end before the start draws one day, at the start.
 */
export function scheduleBar(
  milestone: { startDate: string | null; endDate: string | null },
  windowStart: string
): { offset: number; length: number } | null {
  const first = milestone.startDate ?? milestone.endDate;
  const last = milestone.endDate ?? milestone.startDate;
  if (!first || !last) return null;
  const offset = dayIndex(first, windowStart);
  const to = Math.max(dayIndex(last, windowStart), offset);
  return { offset, length: to - offset + 1 };
}
