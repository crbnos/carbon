import { distributeRoundingResidual } from "./precision.ts";

/** One straight-line cut: the slice of a service range that falls inside a
 *  single calendar month, recognized on the slice's last day. */
export type ScheduleRow = {
  periodStart: string;
  periodEnd: string;
  scheduledDate: string;
  amount: number;
};

export type IsoDateParts = { year: number; month: number; day: number };

// Calendar math on `YYYY-MM-DD` strings and integers only — a JS `Date` applies
// the runtime timezone and shifts a date-only value by a day (date-handling.md).
// Validated strings order chronologically, so `<` / `<=` on them is safe.
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Gregorian leap rule: every 4th year, except centuries, except every 400th. */
const isLeapYear = (year: number): boolean =>
  year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);

/** Exact quotient of two non-negative integers, written without Math.floor so
 *  calendar bookkeeping never reads as value rounding (`no-raw-rounding`). */
const wholeDiv = (n: number, d: number): number => (n - (n % d)) / d;

/** `month` is 1–12. */
export function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return month === 4 || month === 6 || month === 9 || month === 11 ? 30 : 31;
}

/** Parses a `YYYY-MM-DD` string, refusing anything that is not a real
 *  Gregorian calendar date (years 1–9999) — the shape alone accepts 2026-02-30. */
export function parseIsoDate(date: string): IsoDateParts {
  const match = ISO_DATE.exec(date);
  if (!match) throw new Error(`Expected a YYYY-MM-DD date, got "${date}"`);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (
    year < 1 ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > daysInMonth(year, month)
  ) {
    throw new Error(`"${date}" is not a calendar date`);
  }
  return { year, month, day };
}

export function formatIsoDate(year: number, month: number, day: number): string {
  const pad = (value: number, width: number) =>
    String(value).padStart(width, "0");
  return `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}`;
}

/** The last day of the month `date` falls in. */
export function monthEnd(date: string): string {
  const { year, month } = parseIsoDate(date);
  return formatIsoDate(year, month, daysInMonth(year, month));
}

/** Days from a fixed origin, so two dates subtract to a day count: every
 *  earlier year (365 days plus its leap day), then the months already passed
 *  this year, then the day itself. Proleptic Gregorian. */
function dayOrdinal({ year, month, day }: IsoDateParts): number {
  const priorYears = year - 1;
  const leapDaysBefore =
    wholeDiv(priorYears, 4) -
    wholeDiv(priorYears, 100) +
    wholeDiv(priorYears, 400);
  let dayOfYear = day;
  for (let m = 1; m < month; m += 1) dayOfYear += daysInMonth(year, m);
  return priorYears * 365 + leapDaysBefore + dayOfYear;
}

/** Both ends count: the same day twice is 1. Throws when `end` is before `start`. */
export function daysBetweenInclusive(start: string, end: string): number {
  const days =
    dayOrdinal(parseIsoDate(end)) - dayOrdinal(parseIsoDate(start)) + 1;
  if (days < 1) throw new Error(`"${end}" is before "${start}"`);
  return days;
}

/** `date` shifted by a whole number of days in either direction, rolling over
 *  month and year boundaries. */
export function addDays(date: string, days: number): string {
  if (!Number.isInteger(days)) {
    throw new Error(`Cannot add ${days} days to "${date}"`);
  }
  let { year, month, day } = parseIsoDate(date);
  day += days;
  while (day > daysInMonth(year, month)) {
    day -= daysInMonth(year, month);
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  while (day < 1) {
    month -= 1;
    if (month < 1) {
      month = 12;
      year -= 1;
    }
    day += daysInMonth(year, month);
  }
  return formatIsoDate(year, month, day);
}

/** Straight-line recognition of `amount` over `[startDate, endDate]`: the range
 *  is cut at calendar-month boundaries, each cut is weighted by its inclusive
 *  day count and recognized on its last day. Rows carry internal scale, like the
 *  journal lines they become, and sum to `amount` EXACTLY —
 *  `distributeRoundingResidual` rounds every part and places the residual one
 *  minor unit at a time, so no row is ever more than a unit from its exact
 *  share (numeric-precision.md: concentrating it on one row is the defect that
 *  rule exists to prevent). */
export function spreadStraightLine(args: {
  amount: number;
  startDate: string;
  endDate: string;
}): ScheduleRow[] {
  const { amount, startDate, endDate } = args;
  if (!Number.isFinite(amount)) {
    throw new Error(`Schedule amount must be finite, got ${amount}`);
  }
  // Validates both dates and refuses a range that ends before it starts.
  const totalDays = daysBetweenInclusive(startDate, endDate);

  const cuts: { periodStart: string; periodEnd: string; days: number }[] = [];
  let cursor = startDate;
  while (cursor <= endDate) {
    const end = monthEnd(cursor);
    const periodEnd = end < endDate ? end : endDate;
    cuts.push({
      periodStart: cursor,
      periodEnd,
      days: daysBetweenInclusive(cursor, periodEnd)
    });
    cursor = addDays(periodEnd, 1);
  }

  const amounts = distributeRoundingResidual(
    cuts.map(({ days }) => (amount * days) / totalDays),
    amount
  );
  return cuts.map(({ periodStart, periodEnd }, index) => ({
    periodStart,
    periodEnd,
    scheduledDate: periodEnd,
    amount: amounts[index]!
  }));
}
