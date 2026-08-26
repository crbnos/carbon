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
  startOfWeek
} from "@internationalized/date";

/** Signed days relative to the dataset anchor. Negative = in the past. */
export type DayOffset = number;

/** "YYYY-MM-DD" for a DATE column. */
export function resolveDate(anchor: CalendarDate, offset: DayOffset): string {
  return anchor.add({ days: offset }).toString();
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
