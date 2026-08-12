import {
  CalendarDate,
  getDayOfWeek,
  now,
  parseAbsolute,
  startOfWeek,
  toCalendarDate,
  today
} from "@internationalized/date";

/**
 * ISO 8601 week number (1-53). Week 1 is the week containing the year's first
 * Thursday. Pure calendar arithmetic: en-GB is Monday-first, so getDayOfWeek
 * gives Mon=0…Sun=6 and `3 - dow` lands on the week's Thursday;
 * CalendarDate.compare returns whole days.
 */
function weekNumber(date: CalendarDate): number {
  const thursday = date.add({ days: 3 - getDayOfWeek(date, "en-GB") });
  return (
    Math.floor(thursday.compare(new CalendarDate(thursday.year, 1, 1)) / 7) + 1
  );
}

/**
 * The one sanctioned way to derive dates and times in server code.
 *
 * Every derivation method takes a mandatory IANA timezone — resolved from
 * `company.timezone` (ledger-scoped: accounting periods, posting dates,
 * sequence date tokens) or `location.timezone` (operational: scheduling,
 * shifts, MES) — so "which calendar day is it?" is never answered implicitly
 * by the process timezone. Client components displaying dates in the user's
 * browser timezone keep using `@internationalized/date` directly.
 */
export const datetime = {
  /** UTC instant string for timestamp columns (createdAt/updatedAt). The only timezone-free method. */
  timestamp: () => new Date().toISOString(),

  /** Current moment as a ZonedDateTime in the given business timezone. */
  now: (tz: string) => now(tz),

  /** Today as a CalendarDate in the given business timezone. */
  today: (tz: string) => today(tz),

  /** The business day a stored UTC instant falls on in the given timezone. */
  businessDay: (instant: string, tz: string) =>
    toCalendarDate(parseAbsolute(instant, tz)),

  /**
   * The ISO week (Monday 00:00 → Sunday 23:59:59.999) containing `anchor`
   * (default: today on the given business calendar) as UTC instant strings.
   * `offset` shifts whole weeks (-1 = last week).
   *
   * DST-safe by construction: boundaries are derived per-day via
   * `CalendarDate.toDate(tz)`, so a transition week is genuinely 167h/169h
   * (Lord Howe: ±30min) rather than a fixed 168, consecutive weeks tile with
   * no gap or double-count, and in zones that spring forward AT midnight
   * (America/Santiago) a boundary that lands on the skipped midnight resolves
   * to that day's true first instant (01:00) instead of crashing or drifting
   * a day.
   */
  weekBounds: (
    tz: string,
    offset = 0,
    anchor?: CalendarDate
  ): { from: string; to: string } => {
    const monday = startOfWeek(
      (anchor ?? today(tz)).add({ weeks: offset }),
      "en-GB"
    );
    const nextMonday = monday.add({ weeks: 1 }).toDate(tz);
    return {
      from: monday.toDate(tz).toISOString(),
      to: new Date(nextMonday.getTime() - 1).toISOString()
    };
  },

  weekNumber
};
