// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The pure rules of a project stock transfer (Projects Phase 2a): how a
// Payback settles open borrows, and what it costs the borrower.

import { round } from "@carbon/utils";
import { InvalidInputError } from "../errors";

export interface OpenBorrow {
  id: string;
  quantity: number;
  quantityPaidBack: number;
  borrowedUnitCost: number;
}

export interface BorrowSettlement {
  borrowId: string;
  /** The quantity this payback settles of the borrow. */
  quantity: number;
  borrowedUnitCost: number;
  /** True when the borrow is fully paid back after this settlement. */
  paidBack: boolean;
}

/**
 * Settles `quantity` against open borrows, in the order given (the borrow the
 * payback names first, then the oldest). Refuses a payback larger than what
 * the borrows still owe.
 */
export function planBorrowMatching(
  openBorrows: readonly OpenBorrow[],
  quantity: number
): BorrowSettlement[] {
  const owed = openBorrows.reduce(
    (sum, borrow) =>
      sum + Math.max(0, borrow.quantity - borrow.quantityPaidBack),
    0
  );
  if (round(quantity) > round(owed)) {
    throw new InvalidInputError(
      `The payback of ${round(quantity)} is more than the ${round(owed)} still borrowed`
    );
  }
  const settlements: BorrowSettlement[] = [];
  let left = quantity;
  for (const borrow of openBorrows) {
    if (round(left) <= 0) break;
    const open = Math.max(0, borrow.quantity - borrow.quantityPaidBack);
    const take = Math.min(left, open);
    if (take <= 0) continue;
    settlements.push({
      borrowId: borrow.id,
      quantity: take,
      borrowedUnitCost: borrow.borrowedUnitCost,
      paidBack: round(open - take) <= 0
    });
    left -= take;
  }
  return settlements;
}

/**
 * What a payback costs the borrower beyond what it borrowed: positive when
 * the units it pays back carry more cost than the borrowed units did, and
 * negative when they carry less. The lender is made whole at the borrowed
 * cost; the borrower's project takes the difference.
 */
export function paybackVariance(
  borrowedUnitCost: number,
  paybackUnitCost: number,
  quantity: number
): number {
  return round((paybackUnitCost - borrowedUnitCost) * quantity);
}
