// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Pure helper for the Increase actions MRP folds new supply into.
// No JSX, no lingui — unit-tested by apps/erp/test/planning-increase.test.ts.
//
// When an open order lands in the same window as a new-supply suggestion, MRP
// folds the suggestion INTO that order: one Increase replaces the Order / Make
// (`convertOrdersToIncreases`, @carbon/planning). The drawer's suggested
// orders come from the Order / Make actions, so the folded one is not among
// them; the chart still has to count the Increase on the existing order.

type IncreaseLike = {
  type: string;
  status: string;
  periodId: string;
};

function isOpenIncrease(action: IncreaseLike) {
  return action.type === "Increase" && action.status === "Open";
}

/**
 * The quantity the drawer's chart draws an existing order at, in inventory
 * units. An open Increase on it stands in for the new order it replaced, so
 * "if ordered" counts it — unless the planner has changed the order's
 * quantity in the drawer since it loaded, which is their answer to it.
 */
export function chartedOrderQuantity(args: {
  quantity: number;
  loadedQuantity: number;
  increase: (IncreaseLike & { suggestedQuantity: number | string }) | null;
}): number {
  const { quantity, loadedQuantity, increase } = args;
  if (!increase || !isOpenIncrease(increase) || quantity !== loadedQuantity) {
    return quantity;
  }
  return Math.max(quantity, Number(increase.suggestedQuantity) || 0);
}
