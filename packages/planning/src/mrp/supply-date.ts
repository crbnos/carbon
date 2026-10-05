// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// When open supply (a purchase order line, a job) arrives, for planning purposes.
//
// ONE definition each, used by the projection (`runMrp`) and by the reschedule
// check (`generatePlanningActions`). They used to answer this separately — the
// projection ignored the line's required date, the check read it first — so
// applying an Expedite (which writes the required date) moved the action and
// left the projected shortage where it was. Jobs drifted the same way: the
// projection dated an undated job, the check skipped it.

import { parseDate } from "@internationalized/date";

/** Lead time assumed for a line whose item has none recorded. */
const DEFAULT_LEAD_TIME_DAYS = 7;

export type PurchaseOrderLineDates = {
  /** The supplier's confirmed date (line, else the order's delivery). */
  promisedDate?: string | null;
  /** The date we asked for: `purchaseOrderLine.requiredDate`. */
  dueDate?: string | null;
  orderDate?: string | null;
  leadTime?: number | null;
};

/**
 * The ISO date supply from a PO line is expected, most reliable source first:
 * what the supplier promised, else what we required, else order date + lead
 * time (today + lead time when the order has no date yet).
 *
 * A promise outranks the requirement because it is when the goods actually
 * come; a line still being planned has no promise, so its required date — the
 * field the planning grid writes and edits — is what moves it.
 */
export function purchaseOrderLineArrivalDate(
  line: PurchaseOrderLineDates,
  todayIso: string
): string {
  if (line.promisedDate) return line.promisedDate;
  if (line.dueDate) return line.dueDate;
  return parseDate(line.orderDate ?? todayIso)
    .add({ days: line.leadTime ?? DEFAULT_LEAD_TIME_DAYS })
    .toString();
}

/** How far out a job with no deadline is assumed to finish. */
const NO_DEADLINE_DAYS = 30;

export type JobDates = {
  dueDate?: string | null;
  deadlineType?: string | null;
};

/**
 * The ISO date a job's output is expected: its due date, else today + 30 days
 * for a "No Deadline" job (the default on a new job), else today (an ASAP or
 * hard-deadline job that has not been given its date yet).
 */
export function jobCompletionDate(job: JobDates, todayIso: string): string {
  if (job.dueDate) return job.dueDate;
  if (job.deadlineType === "No Deadline") {
    return parseDate(todayIso).add({ days: NO_DEADLINE_DAYS }).toString();
  }
  return todayIso;
}
