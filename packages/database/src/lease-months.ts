// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  addDays,
  daysBetweenInclusive,
  daysInMonth,
  formatIsoDate,
  parseIsoDate
} from "./revenue-schedule.ts";

// Lease months for the lessee lease (ASC 842): which month a date falls in and
// which month of the schedule a payment lands in. Pure, `YYYY-MM-DD` strings in.
// It lives here, not in `@carbon/utils` `lease-math` (which re-exports it), so
// the accounting cutover's open items count the payments the schedule counts.
//
// A lease month runs from the commencement day: month `m` covers
// `addMonths(commencement, m)` to the day before `addMonths(commencement, m + 1)`.
// A payment sits at a whole-month point `k` from commencement: an Advance rent
// row at the start of its period, an Arrears rent row at the end of its period,
// a purchase option or termination penalty at the end of its due date.

export type LeaseTiming = "Advance" | "Arrears";
export type LeasePaymentType =
  | "Rent"
  | "Purchase Option"
  | "Termination Penalty";

const MONTHS_PER_YEAR = 12;

/** `date` moved by whole calendar months, the day clamped to the target
 *  month's length: 2027-01-31 + 1 → 2027-02-28. */
export function addMonths(date: string, months: number): string {
  const { year, month, day } = parseIsoDate(date);
  const index = year * MONTHS_PER_YEAR + (month - 1) + months;
  const targetYear = (index - (index % MONTHS_PER_YEAR)) / MONTHS_PER_YEAR;
  const targetMonth = (index % MONTHS_PER_YEAR) + 1;
  return formatIsoDate(
    targetYear,
    targetMonth,
    Math.min(day, daysInMonth(targetYear, targetMonth))
  );
}

/** The lease months that have started by `date`, after the first: the
 *  largest `m` with `addMonths(commencementDate, m) <= date`, 0 before the
 *  commencement. Counted with `addMonths`, which clamps a day the month does
 *  not have (a lease from the 31st has its next month start on Feb 28), so
 *  every reader agrees with the rows `generateLeasePayments` cuts. */
export function leaseMonthsAt(commencementDate: string, date: string): number {
  if (date <= commencementDate) return 0;
  const start = parseIsoDate(commencementDate);
  const at = parseIsoDate(date);
  let months =
    (at.year - start.year) * MONTHS_PER_YEAR + (at.month - start.month);
  while (months > 0 && addMonths(commencementDate, months) > date) months -= 1;
  while (addMonths(commencementDate, months + 1) <= date) months += 1;
  return months;
}

/** Whole lease months from commencement to the END of `date`. */
export function leaseMonthsThrough(
  commencementDate: string,
  date: string
): number {
  if (date < commencementDate) return 0;
  return leaseMonthsAt(commencementDate, addDays(date, 1));
}

/** The last day of lease month `month`: the day before the next month starts. */
export function leaseMonthEnd(commencementDate: string, month: number): string {
  return addDays(addMonths(commencementDate, month + 1), -1);
}

/** The part of lease month `month` that falls on or before `endDate`, by days:
 *  1 for a whole month, 15/31 for a last month that ends on its 15th day.
 *  Throws when the month starts after `endDate`. */
export function leaseMonthShare(
  commencementDate: string,
  month: number,
  endDate: string
): number {
  const start = addMonths(commencementDate, month);
  const fullEnd = leaseMonthEnd(commencementDate, month);
  if (endDate >= fullEnd) return 1;
  return (
    daysBetweenInclusive(start, endDate) / daysBetweenInclusive(start, fullEnd)
  );
}

/** The whole-month point `k` a payment row sits at (plan decision P4). */
export function paymentMonthIndex(
  row: {
    periodStart: string;
    periodEnd: string;
    dueDate: string;
    paymentType: LeasePaymentType;
  },
  commencementDate: string,
  timing: LeaseTiming
): number {
  if (row.paymentType !== "Rent") {
    return leaseMonthsThrough(commencementDate, row.dueDate);
  }
  return timing === "Advance"
    ? leaseMonthsAt(commencementDate, row.periodStart)
    : leaseMonthsThrough(commencementDate, row.periodEnd);
}

/** The schedule month whose line pays a payment at point `monthIndex`, and
 *  whether it pays at the start or the end of that month: the start of month
 *  `k` in advance (and at commencement), else the end of month `k − 1`. A
 *  point at the end of the term (`k` = the schedule's months) is the end of
 *  its last month. `buildLesseeSchedule` places payments with it, and the
 *  accounting cutover asks it which payments a schedule line has paid. */
export function scheduleMonthOfPayment(
  monthIndex: number,
  timing: LeaseTiming,
  months: number = Number.POSITIVE_INFINITY
): { month: number; at: "start" | "end" } {
  return monthIndex < months && (timing === "Advance" || monthIndex === 0)
    ? { month: monthIndex, at: "start" }
    : { month: monthIndex - 1, at: "end" };
}
