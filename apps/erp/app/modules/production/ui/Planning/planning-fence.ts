// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Pure helpers for the planning horizon (time fence). No JSX, no lingui —
// unit-tested by apps/erp/test/planning-fence.test.ts.
//
// MRP generates actions and suggested orders over the whole planning window.
// The fence is a READ-TIME lens: a row surfaces only what falls on or before
// its fence date (today + the item's planning horizon). `null` is "no fence".
//
// The grid RPC applies the SAME comparison in SQL for the Actions filter
// (`a."horizonDate" <= as_of + days`), using the saved horizon. These helpers
// apply it on screen, where a planner may have widened one row's fence without
// saving — so keep the two in step: one inclusive `<=` on ISO dates.

/** ISO `YYYY-MM-DD` strings order chronologically, so `<=` is a date compare. */
export function isInsideFence(
  date: string | null | undefined,
  fenceDate: string | null
): boolean {
  if (!fenceDate) return true;
  // an undated suggestion cannot be placed outside a fence — keep it visible
  if (!date) return true;
  return date <= fenceDate;
}

/**
 * The row's effective fence: the planner's on-screen override when there is
 * one, else the saved horizon the RPC resolved (`timeFenceDate`), else none.
 */
export function effectiveFenceDate(
  savedFenceDate: string | null | undefined,
  override: string | null | undefined
): string | null {
  return override ?? savedFenceDate ?? null;
}

/** The actions a row surfaces under its fence (open and dismissed alike). */
export function actionsInsideFence<A extends { horizonDate: string }>(
  actions: A[],
  fenceDate: string | null
): A[] {
  if (!fenceDate) return actions;
  return actions.filter((action) =>
    isInsideFence(action.horizonDate, fenceDate)
  );
}

/**
 * Suggested new orders split at the fence by the date they are REQUIRED:
 * `inside` is what the grid offers to order, `beyond` is what a planner can
 * still pull in from the order drawer.
 */
export function splitOrdersByFence<O extends { dueDate?: string | null }>(
  orders: O[],
  fenceDate: string | null
): { inside: O[]; beyond: O[] } {
  if (!fenceDate) return { inside: orders, beyond: [] };
  const inside: O[] = [];
  const beyond: O[] = [];
  for (const order of orders) {
    if (isInsideFence(order.dueDate, fenceDate)) inside.push(order);
    else beyond.push(order);
  }
  return { inside, beyond };
}
