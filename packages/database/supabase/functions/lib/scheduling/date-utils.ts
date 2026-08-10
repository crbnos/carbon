import { parseAbsolute, toCalendarDate } from "@internationalized/date";
/**
 * Normalize a Postgres DATE column value to "YYYY-MM-DD".
 *
 * The `pg` driver returns DATE columns as JS Date objects (constructed at
 * LOCAL midnight). `String(date)` yields "Tue Jul 07 2026 ..." which compares
 * lexicographically GREATER than any "YYYY-MM-DD" string — silently breaking
 * every date comparison downstream (operator-pool expiry, capacity-override
 * effectivity). Local getters are used for Date inputs to match the driver's
 * local-midnight construction; string inputs are passed through.
 */
export function toIsoDate(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value.slice(0, 10);
  const d = value as Date;
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${month}-${day}`;
}

const isoDateFormatters = new Map<string, Intl.DateTimeFormat>();

/**
 * The calendar date ("YYYY-MM-DD") of an INSTANT in a given IANA time zone.
 *
 * The engine judges lateness, words conflict messages, and persists operation
 * dates in the FACTORY's day, not UTC's — an op ending 03:04 IST on the 21st
 * must not be recorded as finishing "2026-07-20". Use this only for real
 * timestamps (slot ends, "now"); date-only strings already ARE calendar dates
 * and must not be re-interpreted through a zone (see formatDate in
 * date-calculator.ts, which round-trips date strings in pure date space).
 */
export function toIsoDateInTimeZone(date: Date, timeZone: string): string {
  let formatter = isoDateFormatters.get(timeZone);
  if (!formatter) {
    // en-CA formats as YYYY-MM-DD
    formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    isoDateFormatters.set(timeZone, formatter);
  }
  return formatter.format(date);
}

/**
 * The business day a UTC instant falls on in the given timezone, as
 * "YYYY-MM-DD". Same implementation as lib/datetime.ts `datetime.businessDay`
 * (parseAbsolute -> toCalendarDate) — duplicated here because the scheduling
 * modules are deliberately pure: importing lib/datetime.ts would drag the DB
 * client graph into every allocator unit test.
 */
export function businessDay(instant: string, timeZone: string): string {
  return toCalendarDate(parseAbsolute(instant, timeZone)).toString();
}
