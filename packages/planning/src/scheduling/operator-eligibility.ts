// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { parseDate } from "@internationalized/date";
import type { CalendarWindow } from "./calendar-utils.ts";
import { businessDayFromMs } from "./date-utils.ts";

export type QualifiedEmployee = {
  employeeId: string;
  expiresAt: string | null;
};

/**
 * Whether an employee counts toward a process ability's operator pool for an
 * operation starting at `earliestStart`. Qualification is presence-based: the
 * employee having an ability row is the qualification, subject only to expiry.
 * Expiry is compared against the operation's start DATE ("YYYY-MM-DD" strings —
 * `expiresAt` must be normalized, see date-utils.ts): expired-as-of-start is
 * excluded, expiring after the start still counts.
 */
export function isEligibleOperator(
  employee: QualifiedEmployee,
  earliestStart: number,
  timeZone = "UTC"
): boolean {
  // Expiry is a calendar date at the factory — compare against the start
  // instant's date in the factory's zone, not UTC's
  const startDateStr = businessDayFromMs(earliestStart, timeZone);
  return employee.expiresAt === null || employee.expiresAt > startDateStr;
}

/**
 * Cut a qualified person's availability at the start of the `expiresAt` day
 * (factory zone), the boundary `isEligibleOperator` and MES use. Eligibility at
 * the op's earliest start is not enough: the op may be placed days later.
 */
export function clipToQualification(
  windows: CalendarWindow[],
  expiresAt: string | null,
  timeZone = "UTC"
): CalendarWindow[] {
  if (expiresAt === null) return windows;
  const qualifiedUntil = parseDate(expiresAt.slice(0, 10))
    .toDate(timeZone)
    .getTime();
  return windows.flatMap((w) =>
    w.start >= qualifiedUntil
      ? []
      : [{ ...w, end: Math.min(w.end, qualifiedUntil) }]
  );
}
