import {
  fromAbsolute,
  parseAbsolute,
  toCalendarDate
} from "@internationalized/date";

/** Milliseconds per second/minute/hour/day — for instant arithmetic. */
export const SECOND_MS = 1000;
export const MINUTE_MS = 60 * SECOND_MS;
export const HOUR_MS = 60 * MINUTE_MS;
export const DAY_MS = 24 * HOUR_MS;
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

/**
 * The business day a UTC instant falls on in the given timezone, as
 * "YYYY-MM-DD". Same implementation as lib/datetime.ts `datetime.businessDay`
 * (parseAbsolute -> toCalendarDate) — duplicated here because the scheduling
 * modules are deliberately pure: importing lib/datetime.ts would drag the DB
 * client graph into every allocator unit test.
 *
 * The engine judges lateness, words conflict messages, and persists operation
 * dates in the FACTORY's day, not UTC's — an op ending 03:04 IST on the 21st
 * must not be recorded as finishing "2026-07-20". Use this only for real
 * timestamps (slot ends, "now"); date-only strings already ARE calendar dates
 * and must not be re-interpreted through a zone (see formatDate in
 * date-calculator.ts, which round-trips date strings in pure date space).
 */
export function businessDay(instant: string, timeZone: string): string {
  return toCalendarDate(parseAbsolute(instant, timeZone)).toString();
}

/**
 * The business day an epoch-ms instant falls on in the given timezone, as
 * "YYYY-MM-DD". The ms-taking sibling of `businessDay` — the engine carries
 * timeline instants as epoch-ms (`.claude/rules/date-handling.md`: raw epoch-ms
 * is acceptable for timezone-agnostic absolute instants), so most callers reach
 * for this rather than round-tripping through an ISO string. `fromAbsolute` is
 * the library's sanctioned epoch→calendar bridge.
 */
export function businessDayFromMs(ms: number, timeZone: string): string {
  return toCalendarDate(fromAbsolute(ms, timeZone)).toString();
}

/**
 * Normalize a Postgres timestamptz column value to epoch-milliseconds. The pg
 * driver decodes timestamptz to JS Date objects (its type is often declared as
 * `string`); this is the instant-carrying sibling of `toIsoDate` — an
 * unavoidable driver boundary. `Date.parse` on an ISO string is the sanctioned
 * absolute-instant parse (`.claude/rules/date-handling.md` narrow exception).
 */
export function toInstantMs(value: Date | string): number {
  return value instanceof Date ? value.getTime() : Date.parse(value);
}

/**
 * Normalize a Postgres timestamptz column value to an ISO instant string
 * ("...Z"). The string-producing sibling of `toInstantMs` — the same driver
 * boundary — used where a column value flows straight back out as an ISO
 * instant (e.g. a forecast timestamp or a FIFO tiebreak key).
 */
export function toInstantIso(value: Date | string): string {
  return value instanceof Date
    ? value.toISOString()
    : new Date(value).toISOString();
}

/**
 * An epoch-ms instant as an ISO instant string ("...Z") — for a DB timestamptz
 * comparison/write. `fromAbsolute` is the library's sanctioned epoch→instant
 * bridge; Postgres parses the result identically to a JS ISO string.
 */
export function msToInstantIso(ms: number): string {
  return fromAbsolute(ms, "UTC").toAbsoluteString();
}
