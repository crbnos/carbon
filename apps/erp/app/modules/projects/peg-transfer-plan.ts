// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Which supply each peg of an ordered planning action moves to. Pure —
// unit-tested by peg-transfer-plan.test.ts; `moveActionPegsToSupply` writes it.

import { round } from "@carbon/utils";

export type PegToTransfer = { quantity: number; needDate: string | null };

/** A PO line or job created for the action, and how much of it answers the
 *  action. */
export type SupplyShare = { supplyId: string; quantity: number };

/** A piece of the peg at `pegIndex`: onto `supplyId`, or left on the action
 *  (`null`). */
export type PegSplit = {
  pegIndex: number;
  supplyId: string | null;
  quantity: number;
};

/**
 * Splits an action's pegs across the supplies ordered for it: the earliest
 * need takes the first supply, and a peg larger than what a supply has left
 * is split across the next ones. What the supplies do not cover stays on the
 * action while it is still open for a remainder (`keepRemainder`); an action
 * ordered in full puts it on the last supply, so no peg is left on a settled
 * action.
 */
export function planPegTransfer(
  pegs: PegToTransfer[],
  supplies: SupplyShare[],
  keepRemainder: boolean
): PegSplit[] {
  const order = pegs
    .map((peg, pegIndex) => ({ ...peg, pegIndex }))
    .filter((peg) => peg.quantity > 0)
    .sort((a, b) => {
      if (a.needDate === b.needDate) return a.pegIndex - b.pegIndex;
      if (a.needDate === null) return 1;
      if (b.needDate === null) return -1;
      // ISO dates order as strings
      return a.needDate < b.needDate ? -1 : 1;
    });
  const left = supplies.map((supply) => ({ ...supply }));
  const lastSupplyId = supplies.at(-1)?.supplyId ?? null;

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
    let need = peg.quantity;
    while (need > 0 && s < left.length) {
      const supply = left[s]!;
      const take = round(Math.min(need, supply.quantity), 5);
      if (take > 0) {
        add(peg.pegIndex, supply.supplyId, take);
        need = round(need - take, 5);
        supply.quantity = round(supply.quantity - take, 5);
      }
      if (supply.quantity <= 0) s++;
    }
    if (need > 0) {
      add(peg.pegIndex, keepRemainder ? null : lastSupplyId, need);
    }
  }
  return splits;
}
