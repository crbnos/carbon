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
 * The ISO 8601 week (1-53) and the year it belongs to. Week 1 is the week with
 * the year's first Thursday, so up to three days at either end of a calendar
 * year belong to a week of the next or the previous year: Friday 1 January
 * 2027 is in week 53 of 2026.
 */
export function isoWeek(date: CalendarDate): { week: number; year: number } {
  // en-GB weeks start on Monday, so the day of week is Mon=0…Sun=6 and
  // `3 - dow` lands on the week's Thursday.
  const thursday = date.add({ days: 3 - getDayOfWeek(date, "en-GB") });
  const days = thursday.compare(new CalendarDate(thursday.year, 1, 1));
  return { week: (days - (days % 7)) / 7 + 1, year: thursday.year };
}

const twoDigits = (value: number) => value.toString().padStart(2, "0");

/**
 * A sequence prefix or suffix with its date tokens filled in, for `at` (now in
 * `timezone` by default). `%{yyyy}` and `%{yy}` are the calendar year;
 * `%{wyyyy}` and `%{wyy}` are the year of the ISO week, the one to pair with
 * `%{ww}`. Unknown tokens stay as written.
 */
export function interpolateSequenceDate(
  value: string | null | undefined,
  timezone = "UTC",
  at?: ZonedDateTime
): string {
  if (!value) return "";
  if (!value.includes("%{")) return value;

  const { year, month, day, hour, second } = at ?? now(timezone);
  const week = isoWeek(new CalendarDate(year, month, day));

  return value
    .replaceAll("%{wyyyy}", week.year.toString())
    .replaceAll("%{wyy}", week.year.toString().slice(-2))
    .replaceAll("%{yyyy}", year.toString())
    .replaceAll("%{yy}", year.toString().slice(-2))
    .replaceAll("%{mm}", twoDigits(month))
    .replaceAll("%{ww}", twoDigits(week.week))
    .replaceAll("%{dd}", twoDigits(day))
    .replaceAll("%{hh}", twoDigits(hour))
    .replaceAll("%{ss}", twoDigits(second));
}

/**
 * True when a format labels the ISO week with the calendar year (`%{yy}%{ww}`,
 * `%{yyyy}-W%{ww}`) and has no month or day for that year to belong to. Such a
 * format names the wrong year for up to three days around each new year; it
 * wants `%{wyy}` or `%{wyyyy}`. The SQL migration that moved existing formats
 * to the week year used the same test.
 */
export function usesCalendarYearForWeek(
  ...values: Array<string | null | undefined>
): boolean {
  const format = values.filter(Boolean).join("");
  return (
    format.includes("%{ww}") &&
    (format.includes("%{yyyy}") || format.includes("%{yy}")) &&
    !format.includes("%{mm}") &&
    !format.includes("%{dd}")
  );
}
