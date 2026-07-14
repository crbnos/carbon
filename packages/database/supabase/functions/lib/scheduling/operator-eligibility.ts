export type QualifiedEmployee = {
  employeeId: string;
  active: boolean;
  trainingCompleted: boolean | null;
  expiresAt: string | null;
};

/**
 * Whether an employee counts toward a process ability's operator pool for an
 * operation starting at `earliestStart`. Qualification is binary: active,
 * training completed, and not expired. Expiry is compared against the
 * operation's start DATE ("YYYY-MM-DD" strings — `expiresAt` must be
 * normalized, see date-utils.ts): expired-as-of-start is excluded, expiring
 * after the start still counts.
 */
export function isEligibleOperator(
  employee: QualifiedEmployee,
  earliestStart: Date
): boolean {
  const startDateStr = earliestStart.toISOString().slice(0, 10);
  return (
    employee.active &&
    !!employee.trainingCompleted &&
    (employee.expiresAt === null || employee.expiresAt > startDateStr)
  );
}
