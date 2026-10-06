// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { parseDate } from "@internationalized/date";

export type DueUrgency = "late" | "dueSoon";

type UrgencyInput = {
  hasConflict?: boolean | null;
  dueDate?: string | null; // YYYY-MM-DD
  deadlineType?: string | null;
  status?: string | null;
};

const FINISHED_STATUSES = new Set(["Done", "Canceled", "Cancelled"]);

/**
 * How urgent a schedule card is. `late` = already past its due date, or the
 * scheduler projects it to finish after its job's due date; `dueSoon` = due
 * today or tomorrow. `today` is the location's `YYYY-MM-DD` — date-only
 * strings compare as strings.
 */
export function getDueUrgency(
  item: UrgencyInput,
  today: string
): DueUrgency | null {
  if (item.hasConflict) return "late";
  if (FINISHED_STATUSES.has(item.status ?? "")) return null;
  // Only Hard and Soft Deadline carry a due date; an ASAP job can still hold a
  // stale one (deadlineRequiresDueDate in production.models).
  if (
    !item.dueDate ||
    item.deadlineType === "ASAP" ||
    item.deadlineType === "No Deadline"
  )
    return null;
  if (item.dueDate < today) return "late";
  const tomorrow = parseDate(today).add({ days: 1 }).toString();
  return item.dueDate <= tomorrow ? "dueSoon" : null;
}

/** A batch runs as one: it is as urgent as its most urgent member. */
export function getBatchDueUrgency(
  members: UrgencyInput[],
  today: string
): DueUrgency | null {
  let result: DueUrgency | null = null;
  for (const member of members) {
    const urgency = getDueUrgency(member, today);
    if (urgency === "late") return "late";
    if (urgency) result = urgency;
  }
  return result;
}

// Last in `cn(...)` so it wins over the status variant's border colour, and
// solid in dark mode, where the card shell drops the border.
export const DUE_URGENCY_BORDER: Record<DueUrgency, string> = {
  late: "border-2 border-red-500 dark:border-solid",
  dueSoon: "border-2 border-orange-500 dark:border-solid"
};
