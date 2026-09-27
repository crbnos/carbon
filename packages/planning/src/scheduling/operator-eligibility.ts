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
