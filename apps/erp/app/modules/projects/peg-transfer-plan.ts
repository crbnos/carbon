// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Which supply each peg of an ordered planning action moves to. Pure —
// unit-tested by peg-transfer-plan.test.ts; `moveActionPegsToSupply` writes it.

import { round } from "@carbon/utils";

export type PegToTransfer = { quantity: number; needDate: string | null };

/** A PO line or job created for the action, how much of it answers the
 *  action, and when it is due. */
export type SupplyShare = {
  supplyId: string;
  quantity: number;
  dueDate: string | null;
};

/** A piece of the peg at `pegIndex`: onto `supplyId`, or left on the action
 *  (`null`). */
export type PegSplit = {
  pegIndex: number;
  supplyId: string | null;
  quantity: number;
};

/** ISO dates order as strings; a missing date sorts last. */
function compareDates(a: string | null, b: string | null): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a < b ? -1 : 1;
}

/**
 * Splits an action's pegs across the supplies ordered for it: the earliest
 * need takes the earliest supply, and a peg larger than what a supply has
 * left is split across the next ones. What the supplies do not cover stays
 * on the action while it is still open for a remainder (`keepRemainder`); an
 * action ordered in full puts it on the last supply, so no peg is left on a
 * settled action.
 */
export function planPegTransfer(
  pegs: PegToTransfer[],
  supplies: SupplyShare[],
  keepRemainder: boolean
): PegSplit[] {
  const order = pegs
    .map((peg, pegIndex) => ({ ...peg, pegIndex }))
    .filter((peg) => peg.quantity > 0)
    .sort(
      (a, b) => compareDates(a.needDate, b.needDate) || a.pegIndex - b.pegIndex
    );
  // A supply too small to hold 5 places takes nothing: skipped up front, so
  // the walk below always advances.
  const byDueDate = supplies
    .map((supply, index) => ({ ...supply, index }))
    .sort((a, b) => compareDates(a.dueDate, b.dueDate) || a.index - b.index);
  const left = byDueDate
    .map((supply) => ({ ...supply, quantity: round(supply.quantity, 5) }))
    .filter((supply) => supply.quantity > 0);
  const overflowSupplyId = keepRemainder
    ? null
    : (byDueDate.at(-1)?.supplyId ?? null);

  const splits: PegSplit[] = [];
  const add = (pegIndex: number, supplyId: string | null, quantity: number) => {
    const previous = splits.at(-1);
    if (
      previous &&
      previous.pegIndex === pegIndex &&
      previous.supplyId === supplyId
    ) {
      previous.quantity = round(previous.quantity + quantity, 5);
    } else {
      splits.push({ pegIndex, supplyId, quantity });
    }
  };

  let s = 0;
  for (const peg of order) {
    // A peg too small to split at 5 places moves whole, unrounded, so it is
    // neither lost nor written as 0 (projectPeg_quantity_check).
    if (round(peg.quantity, 5) <= 0) {
      add(peg.pegIndex, left[s]?.supplyId ?? overflowSupplyId, peg.quantity);
      continue;
    }
    let need = peg.quantity;
    while (need > 0 && s < left.length) {
      const supply = left[s]!;
      const take = round(Math.min(need, supply.quantity), 5);
      add(peg.pegIndex, supply.supplyId, take);
      need = round(need - take, 5);
      supply.quantity = round(supply.quantity - take, 5);
      if (supply.quantity <= 0) s++;
    }
    if (need > 0) add(peg.pegIndex, overflowSupplyId, need);
  }
  return splits;
}

/**
 * The peg moves for the actions an order settled, for a planning group's
 * actions only: each action's pegs go to the supplies at `orderIndexes` (the
 * order's place in `supplies`), and what they leave stays on an action still
 * open for a remainder.
 */
export function pegMovesForSettledActions(
  settled: {
    id: string;
    planningSegmentId: string;
    status: string;
    orderIndexes: number[];
  }[],
  supplies: SupplyShare[],
  supplyType: "Purchase Order Line" | "Job",
  planningGroupIds: Set<string>
) {
  return settled
    .filter((action) => planningGroupIds.has(action.planningSegmentId))
    .map((action) => ({
      planningActionId: action.id,
      supplyType,
      supplies: action.orderIndexes.map((index) => supplies[index]!),
      keepRemainder: action.status !== "Actioned"
    }));
}
