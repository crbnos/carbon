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
