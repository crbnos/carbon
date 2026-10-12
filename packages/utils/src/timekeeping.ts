// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Timekeeping controls for timesheets: the entry window, the status a saved
// change gives, the ISO week, dilution for exempt staff and the timecard
// check. Pure, so the timesheet server functions, posting and their tests
// agree.
// Spec: `.ai/specs/implemented/2026-10-09-government-contracting.md` (Phase 5a)

import type { Database } from "@carbon/database";
import { round } from "@carbon/database/precision";
import { parseDate, startOfWeek } from "@internationalized/date";

export type TimekeepingControls =
  Database["public"]["Enums"]["timekeepingControls"];
export type TimesheetEntryStatus =
  Database["public"]["Enums"]["timesheetEntryStatus"];

export const TIMESHEET_REFUSAL_NOT_DRAFT = "Only a Draft entry can change";
export const TIMESHEET_REFUSAL_POSTED =
  "A posted entry changes only by correction";

/**
 * Whether time can be entered for `entryDate` (all dates `YYYY-MM-DD`).
 * A date after today is refused, except on a leave element. A date before
 * today − `windowDays` is allowed but late, so it needs a late reason.
 */
export function isEntryDateAllowed(args: {
  entryDate: string;
  today: string;
  windowDays: number;
  isLeave: boolean;
}): { allowed: true; late: boolean } | { allowed: false; reason: "future" } {
  const { entryDate, today, windowDays, isLeave } = args;
  if (entryDate > today && !isLeave) {
    return { allowed: false, reason: "future" };
  }
  const windowStart = parseDate(today)
    .subtract({ days: Math.max(0, windowDays) })
    .toString();
  return { allowed: true, late: entryDate < windowStart };
}

/**
 * The status a saved change gives an entry. `current` null means a new entry.
 *
 * - Standard mode keeps Phase 1a: the owner edits a new, Draft or Rejected
 *   entry, which becomes Draft. Anything else refuses.
 * - DCAA mode: a Posted entry refuses (it changes by correction). A change by
 *   anyone other than the owner goes to Pending Employee Review. The owner's
 *   change returns any other entry to Draft, so it needs approval again.
 */
export function nextEntryStatus(args: {
  mode: TimekeepingControls;
  current: TimesheetEntryStatus | null;
  actorIsOwner: boolean;
}): TimesheetEntryStatus | { refuse: string } {
  const { mode, current, actorIsOwner } = args;
  if (mode === "Standard") {
    if (
      actorIsOwner &&
      (current === null || current === "Draft" || current === "Rejected")
    ) {
      return "Draft";
    }
    return { refuse: TIMESHEET_REFUSAL_NOT_DRAFT };
  }
  if (current === "Posted") return { refuse: TIMESHEET_REFUSAL_POSTED };
  if (!actorIsOwner) return "Pending Employee Review";
  return "Draft";
}

/** The ISO week's Monday of `date`, as `YYYY-MM-DD`. */
export function weekStartOf(date: string): string {
  // en-GB starts the week on Monday, as ISO 8601 does.
  return startOfWeek(parseDate(date), "en-GB").toString();
}

/**
 * The effective-rate factor for an exempt employee's week (CAM 6-410.4a):
 * min(1, standard ÷ recorded hours). A week with no hours keeps factor 1.
 */
export function dilutionFactor(
  standardWeeklyHours: number,
  weekHours: number
): number {
  if (weekHours <= 0) return 1;
  return round(Math.min(1, standardWeeklyHours / weekHours));
}

/** The timecard hours that the timesheet entries do not account for. */
export function timecardShortfall(
  entryHours: number,
  timecardHours: number
): number {
  return round(Math.max(0, timecardHours - entryHours));
}
