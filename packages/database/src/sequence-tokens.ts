// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Client-safe: the ERP's sequence and serial number forms preview with it, and
// `./sequence` formats document numbers with it. Its SQL twin is
// interpolate_sequence_date (document numbers through get_next_sequence, serial
// numbers through interpolate_serial_segment), and util.document_sequence_pattern
// reads a saved number back. A token added here is added to all three.
import {
  CalendarDate,
  getDayOfWeek,
  now,
  type ZonedDateTime
} from "@internationalized/date";

/**
 * How `%{ww}` counts weeks (`companySettings.sequenceWeekNumbering`). The SQL
 * CHECK on the column lists the same values.
 */
export const weekNumberings = ["iso", "us"] as const;
export type WeekNumbering = (typeof weekNumberings)[number];

export function asWeekNumbering(value: unknown): WeekNumbering {
  return weekNumberings.find((numbering) => numbering === value) ?? "iso";
}

// Whole weeks in a non-negative number of days.
const weeksIn = (days: number) => (days - (days % 7)) / 7;

/**
 * The week of `date` and the year it belongs to.
 *
 * - `iso` (ISO 8601): weeks start on Monday, and week 1 is the week with the
 *   year's first Thursday. Up to three days at either end of a calendar year
 *   belong to a week of the next or the previous year: Friday 1 January 2027
 *   is in week 53 of 2026.
 * - `us`: weeks start on Sunday, week 1 is the week of 1 January, and the last
 *   week ends on 31 December. The year is the calendar year, and the weeks
 *   around a new year are short: 1–2 January 2027 is week 1, and 31 December
 *   2028 is week 54.
 */
export function weekOfYear(
  date: CalendarDate,
  numbering: WeekNumbering = "iso"
): { week: number; year: number } {
  if (numbering === "us") {
    const january1 = new CalendarDate(date.year, 1, 1);
    // en-US weeks start on Sunday, so the day of week is Sun=0…Sat=6.
    const daysBeforeJanuary1 = getDayOfWeek(january1, "en-US");
    return {
      week: weeksIn(date.compare(january1) + daysBeforeJanuary1) + 1,
      year: date.year
    };
  }
  // en-GB weeks start on Monday, so the day of week is Mon=0…Sun=6 and
  // `3 - dow` lands on the week's Thursday.
  const thursday = date.add({ days: 3 - getDayOfWeek(date, "en-GB") });
  const days = thursday.compare(new CalendarDate(thursday.year, 1, 1));
  return { week: weeksIn(days) + 1, year: thursday.year };
}

/**
 * Whether `%{yyyy}` and `%{yy}` in a format are the year its week belongs to:
 * the format has `%{ww}` and no `%{mm}` or `%{dd}`. Beside a month or a day
 * they are the calendar year, so a date stays a date.
 */
export function yearFollowsWeek(format: string): boolean {
  return (
    format.includes("%{ww}") &&
    !format.includes("%{mm}") &&
    !format.includes("%{dd}")
  );
}

const twoDigits = (value: number) => value.toString().padStart(2, "0");

export type SequenceDateOptions = {
  /** Now in this timezone, when `at` is not given. */
  timezone?: string;
  at?: ZonedDateTime;
  weekNumbering?: WeekNumbering;
  /** The whole format, prefix and suffix, for `yearFollowsWeek`. Defaults to the value. */
  format?: string;
};

/**
 * A sequence prefix or suffix with its date tokens filled in, for `at` (now in
 * `timezone` by default). Unknown tokens stay as written. Use
 * `interpolateSequenceFormat` for a prefix and suffix, so both take their year
 * from the whole format.
 */
export function interpolateSequenceDate(
  value: string | null | undefined,
  {
    timezone = "UTC",
    at,
    weekNumbering = "iso",
    format
  }: SequenceDateOptions = {}
): string {
  if (!value) return "";
  if (!value.includes("%{")) return value;

  const { year, month, day, hour, second } = at ?? now(timezone);
  const week = weekOfYear(new CalendarDate(year, month, day), weekNumbering);
  const tokenYear = (
    yearFollowsWeek(format ?? value) ? week.year : year
  ).toString();

  return value
    .replaceAll("%{yyyy}", tokenYear)
    .replaceAll("%{yy}", tokenYear.slice(-2))
    .replaceAll("%{mm}", twoDigits(month))
    .replaceAll("%{ww}", twoDigits(week.week))
    .replaceAll("%{dd}", twoDigits(day))
    .replaceAll("%{hh}", twoDigits(hour))
    .replaceAll("%{ss}", twoDigits(second));
}

/** A sequence's prefix and suffix with their date tokens filled in. */
export function interpolateSequenceFormat(
  prefix: string | null | undefined,
  suffix: string | null | undefined,
  options: Omit<SequenceDateOptions, "format"> = {}
): { prefix: string; suffix: string } {
  const format = `${prefix ?? ""}${suffix ?? ""}`;
  return {
    prefix: interpolateSequenceDate(prefix, { ...options, format }),
    suffix: interpolateSequenceDate(suffix, { ...options, format })
  };
}
