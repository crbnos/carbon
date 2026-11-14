// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The planning time fence (MRP v2 Phase 2a): one rule for the MRP engine and
// the planning drawers, so the drawer's Fence marker always matches what MRP
// holds. Calendar days from today.

import { parseDate } from "@internationalized/date";

/**
 * The fence of an item at a location, in days: the item's value, else the
 * location's, else 0 (no fence). An explicit item 0 opts the item out of the
 * location's fence. A negative or unreadable value counts as 0.
 */
export function resolvePlanningTimeFenceDays(
  itemFenceDays: number | null | undefined,
  locationFenceDays: number | null | undefined
): number {
  return Math.max(0, Number(itemFenceDays ?? locationFenceDays ?? 0) || 0);
}

/** The last date the fence holds: today plus the fence days. */
export function planningTimeFenceDate(
  todayDate: string,
  fenceDays: number
): string {
  return parseDate(todayDate).add({ days: fenceDays }).toString();
}

/**
 * Does MRP hold this planned order still? A Firm order always; a Planned order
 * when the fence is set and its release date is on or before the fence date.
 * A held order keeps its quantity and dates and counts as supply.
 */
export function isPlannedOrderHeld(
  order: { status: string; releaseDate: string },
  fenceDays: number,
  todayDate: string
): boolean {
  if (order.status === "Firm") return true;
  if (order.status !== "Planned" || fenceDays <= 0) return false;
  return (
    parseDate(order.releaseDate).compare(
      parseDate(planningTimeFenceDate(todayDate, fenceDays))
    ) <= 0
  );
}

/**
 * The week a planned order counts in, as supply and in its week's Order or
 * Make action: an overdue order (due before today) counts in the first week;
 * otherwise the week that holds its due date; past the last week, none
 * (null). `weeks` are consecutive and the first holds today. The MRP engine,
 * the planning drawers and the conversion all use this one rule, so an order
 * is offered in the same week its action counts it.
 */
export function plannedOrderWeekIndex(
  dueDate: string,
  weeks: { startDate: string; endDate: string }[],
  todayDate: string
): number | null {
  const due = parseDate(dueDate);
  if (weeks.length === 0) return null;
  if (due.compare(parseDate(todayDate)) < 0) return 0;
  const index = weeks.findIndex(
    (week) =>
      parseDate(week.startDate).compare(due) <= 0 &&
      parseDate(week.endDate).compare(due) >= 0
  );
  return index < 0 ? null : index;
}
