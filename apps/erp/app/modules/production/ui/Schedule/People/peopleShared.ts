/**
 * Logic and styling shared by the people views (Board, Matrix, Capacity, the
 * Working-hours editor). The shift ladders here are BUSINESS rules — every
 * view must resolve a person-day the same way or the boards disagree about
 * the same person.
 */

/** Inputs of the shift-hours ladder, as the people loader ships them. */
export type ShiftHoursLadder = {
  shiftHoursById: Record<string, number>;
  employeeShiftHours: Record<string, number>;
  defaultShiftHours: number;
};

/**
 * The shift-hours ladder: the given shift → the person's own shift
 * (employeeShift) → the most-common shift length at the location.
 */
export function ladderShiftHours(
  shiftId: string | null | undefined,
  employeeId: string,
  ladder: ShiftHoursLadder
): number {
  return (
    (shiftId ? ladder.shiftHoursById[shiftId] : undefined) ??
    ladder.employeeShiftHours[employeeId] ??
    ladder.defaultShiftHours
  );
}

/** Explicit split-day hours win; otherwise the shift-hours ladder. */
export function assignmentHours(
  assignment: {
    hours?: number | null;
    shiftId: string | null;
    employeeId: string;
  },
  ladder: ShiftHoursLadder
): number {
  return (
    assignment.hours ??
    ladderShiftHours(assignment.shiftId, assignment.employeeId, ladder)
  );
}

/** One side (start OR end) of the shift-time ladder. */
export type ShiftTimeLadder = {
  byShift: Record<string, string>;
  byEmployee: Record<string, string>;
  fallback: string | null;
};

/** Same ladder as hours, for a "HH:MM" wall-clock time. */
export function ladderShiftTime(
  shiftId: string | null | undefined,
  employeeId: string,
  ladder: ShiftTimeLadder
): string | null {
  return (
    (shiftId ? ladder.byShift[shiftId] : undefined) ??
    ladder.byEmployee[employeeId] ??
    ladder.fallback
  );
}

/**
 * Does this assignment belong to the shift being filtered by? The assignment's
 * own stamped shift wins; a shift-less row (created under "All shifts", or
 * before the person had an `employeeShift`) falls back to the person's own
 * shift — the same ladder the hours resolve through, so the filter can never
 * hide a row whose hours it would attribute to that shift.
 */
export function assignmentMatchesShift(
  assignment: { shiftId: string | null; employeeId: string },
  shiftId: string | null,
  employeeShiftId: Record<string, string>
): boolean {
  if (!shiftId) return true;
  return (
    (assignment.shiftId ?? employeeShiftId[assignment.employeeId]) === shiftId
  );
}

/**
 * Overtime is one value for the DAY, stamped on each of the day's rows —
 * take the max, never the sum, or a split person's overtime multiplies.
 */
export function dayOvertime(rows: { overtimeHours?: number | null }[]): number {
  return rows.reduce((max, row) => Math.max(max, row.overtimeHours ?? 0), 0);
}

/** `${employeeId}:${date}` membership set for absence checks. */
export function buildAbsentSet(
  absences: { employeeId: string; date: string }[]
): Set<string> {
  return new Set(
    absences.map((absence) => `${absence.employeeId}:${absence.date}`)
  );
}

/** "8" / "7.5" — whole hours without a trailing ".0". */
export function formatHours(hours: number): string {
  return Number.isInteger(hours) ? String(hours) : hours.toFixed(1);
}

export const STICKY_HEADER =
  "sticky top-0 z-10 bg-card shadow-[0_1px_0_0_hsl(var(--border))]";
export const STICKY_FIRST_COL = "sticky left-0 z-[1] bg-card";

/** Sortable column id of the Unassigned pool on the people board. */
export const UNASSIGNED = "unassigned";

export type PeopleEmployee = {
  id: string;
  name: string | null;
  avatarUrl: string | null;
};

export type PeopleAssignment = {
  id: string;
  workCenterId: string;
  employeeId: string;
  shiftId: string | null;
  note: string | null;
  date: string;
  overtimeHours: number;
  /** partial-day hours at this station; null = the whole shift */
  hours: number | null;
};

export type PeopleAbsence = {
  id: string;
  employeeId: string;
  shiftId: string | null;
  note: string | null;
  date: string;
};
