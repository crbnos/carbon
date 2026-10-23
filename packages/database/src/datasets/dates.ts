// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

/**
 * Dataset dates are day-offsets from the moment the dataset is applied, never
 * absolute strings — a template applied next year must not show last year's
 * orders. The anchor is today in the COMPANY's timezone (`Ctx.anchor`).
 *
 * Offsets were derived from the original literals against a reference date of
 * 2026-08-13, so every interval between two dates is preserved exactly.
 */

import {
  type CalendarDate,
  endOfMonth,
  getDayOfWeek,
  parseDateTime,
  startOfMonth,
  startOfWeek,
  toZoned
} from "@internationalized/date";
import type { DayOffset } from "./types.ts";

/** "YYYY-MM-DD" for a DATE column. */
export function resolveDate(anchor: CalendarDate, offset: DayOffset): string {
  return anchor.add({ days: offset }).toString();
}

/**
 * The working day `workdaysBack` working days before the anchor, skipping
 * Saturday and Sunday: 1 is the last weekday before today. A timecard seeded
 * by calendar offset landed on the weekend whenever the anchor was early in
 * the week.
 */
export function workdayBefore(
  anchor: CalendarDate,
  workdaysBack: number
): string {
  let day = anchor;
  let left = workdaysBack;
  while (left > 0) {
    day = day.subtract({ days: 1 });
    const weekday = getDayOfWeek(day, "en-US"); // 0 = Sunday, 6 = Saturday
    if (weekday !== 0 && weekday !== 6) left -= 1;
  }
  return day.toString();
}

/**
 * The ISO instant of a wall-clock time on a date in `timeZone`: "07:00:00"
 * is 7 am at the company, not 7 am UTC.
 */
export function resolveLocalTimestamp(
  date: string,
  timeOfDay: string,
  timeZone: string
): string {
  return toZoned(
    parseDateTime(`${date}T${timeOfDay}`),
    timeZone
  ).toAbsoluteString();
}

/**
 * Full ISO instant for a TIMESTAMPTZ column. `timeOfDay` is "HH:MM:SS" and is
 * treated as UTC, matching the `...Z` literals the seed used before.
 */
export function resolveTimestamp(
  anchor: CalendarDate,
  offset: DayOffset,
  timeOfDay: string
): string {
  return `${resolveDate(anchor, offset)}T${timeOfDay}Z`;
}

/** Last day of the month before the anchor's, as "YYYY-MM-DD". */
export function previousMonthEnd(anchor: CalendarDate): string {
  return endOfMonth(anchor.subtract({ months: 1 })).toString();
}

// Seeded accounting periods: trailing months ending with the anchor's. Close is
// sequential, so the oldest are Closed, the next Locked, the rest Open.
export const SEEDED_PERIOD_MONTHS = 12;
export const CLOSED_PERIOD_MONTHS_BACK = [11, 10] as const;
export const LOCKED_PERIOD_MONTHS_BACK = 9;
/**
 * Offsets ≥ this land in month anchor−9 or later, never a Closed period (whose
 * journals the period-open trigger rejects). Nine shortest months = 273 days.
 */
export const NOT_CLOSED_MIN_OFFSET = -273;
/** Offsets ≥ this land in an Open period (month anchor−8 or later; 8 shortest months = 242 days). */
export const OPEN_PERIOD_MIN_OFFSET = -242;

/** `monthsBack` 0 = the anchor's own month. */
export function monthBack(
  anchor: CalendarDate,
  monthsBack: number
): { start: CalendarDate; end: CalendarDate } {
  const month = anchor.subtract({ months: monthsBack });
  return { start: startOfMonth(month), end: endOfMonth(month) };
}

/**
 * `count` consecutive Sunday-start weeks beginning with the anchor's own week.
 * Mirrors getOrCreatePeriods' startOfWeek(today, "en-US") so the seeded periods
 * are the ones the projections loader looks up rather than duplicates.
 */
export function weekRangesFrom(
  anchor: CalendarDate,
  count: number
): { startDate: string; endDate: string }[] {
  const first = startOfWeek(anchor, "en-US");
  return Array.from({ length: count }, (_, week) => {
    const start = first.add({ weeks: week });
    return {
      startDate: start.toString(),
      endDate: start.add({ days: 6 }).toString()
    };
  });
}

/** Seeded labor rates start a year back, before every seeded timesheet day. */
export const LABOR_RATE_EFFECTIVE_OFFSET = -365;

/**
 * A timesheet day: `weekday` (0 = Monday) of the Monday-start week `week`
 * weeks from the anchor's, as the timesheet's `weekStartOf` counts weeks. A
 * day after the anchor is pulled back to the anchor, so no seeded hours are
 * in the future.
 */
export function resolveTimesheetDay(
  anchor: CalendarDate,
  week: number,
  weekday: number
): string {
  const day = startOfWeek(anchor, "en-GB").add({
    weeks: week,
    days: weekday
  });
  return (day.compare(anchor) > 0 ? anchor : day).toString();
}
