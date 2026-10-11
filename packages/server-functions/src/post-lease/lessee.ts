// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Pure journal-line builders of a lessee lease (spec
// `.ai/specs/2026-10-11-lessee-leases.md` §4). Every set is balanced or it
// throws. Amounts are signed by the account's class (`toStoredAmount`), so a
// debit to the Liability-class lease liability stores a negative amount.

import { type AccountClass, toStoredAmount } from "@carbon/database/ledger";
import { assertBalanced, EPSILON, round } from "@carbon/database/precision";

export type LeaseAccount = { id: string; class: AccountClass };

export type LesseeAccounts = {
  rightOfUseAsset: LeaseAccount;
  accumulatedRightOfUseAmortization: LeaseAccount;
  leaseLiability: LeaseAccount;
  operatingLeaseExpense: LeaseAccount;
  rightOfUseAmortizationExpense: LeaseAccount;
  leaseInterestExpense: LeaseAccount;
  gain: LeaseAccount;
  loss: LeaseAccount;
};

/** A journal line with its amount in the account's natural balance. */
export type PostingLine = {
  accountId: string;
  description: string;
  amount: number;
};

type Leg = {
  side: "debit" | "credit";
  account: LeaseAccount;
  description: string;
  amount: number;
};

/** Legs → natural-balance-signed journal lines, dropping zero legs and
 *  refusing an unbalanced set. A negative leg amount flips its side. */
export function toPostingLines(legs: Leg[], label: string): PostingLine[] {
  let debits = 0;
  let credits = 0;
  const lines: PostingLine[] = [];
  for (const leg of legs) {
    const amount = round(leg.amount);
    if (amount === 0) continue;
    const side =
      amount > 0 ? leg.side : leg.side === "debit" ? "credit" : "debit";
    const value = Math.abs(amount);
    if (side === "debit") debits += value;
    else credits += value;
    lines.push({
      accountId: leg.account.id,
      description: leg.description,
      amount:
        side === "debit"
          ? toStoredAmount(value, 0, leg.account.class)
          : toStoredAmount(0, value, leg.account.class)
    });
  }
  assertBalanced(round(debits), round(credits), EPSILON, label);
  return lines;
}

/** Commencement: Dr ROU asset / Cr Lease liability, both at the PV. */
export function commencementLines(args: {
  liability: number;
  accounts: LesseeAccounts;
}): PostingLine[] {
  const { liability, accounts } = args;
  return toPostingLines(
    [
      {
        side: "debit",
        account: accounts.rightOfUseAsset,
        description: "Right-of-use asset",
        amount: liability
      },
      {
        side: "credit",
        account: accounts.leaseLiability,
        description: "Lease liability",
        amount: liability
      }
    ],
    "Lease commencement journal"
  );
}

/** Opening balance of a lease that commenced before the accounting cutover
 *  (spec Q8): the balances its schedule reaches on the as-of date, with the
 *  difference — the lease cost of the months before it, already in the
 *  opening equity — to retained earnings.
 *
 *   Dr ROU asset                       cost
 *       Cr Accumulated ROU amortization        amortization before the date
 *       Cr Lease liability                     carrying liability on the date
 *       Cr / Dr Retained earnings              the difference
 */
export function openingBalanceLines(args: {
  rouAssetCost: number;
  accumulated: number;
  carryingLiability: number;
  retainedEarnings: LeaseAccount;
  accounts: LesseeAccounts;
}): PostingLine[] {
  const { rouAssetCost, accumulated, carryingLiability, accounts } = args;
  return toPostingLines(
    [
      {
        side: "debit",
        account: accounts.rightOfUseAsset,
        description: "Right-of-use asset",
        amount: rouAssetCost
      },
      {
        side: "credit",
        account: accounts.accumulatedRightOfUseAmortization,
        description: "Accumulated right-of-use amortization",
        amount: accumulated
      },
      {
        side: "credit",
        account: accounts.leaseLiability,
        description: "Lease liability",
        amount: carryingLiability
      },
      {
        side: "credit",
        account: args.retainedEarnings,
        description: "Lease cost before the opening date",
        amount: round(rouAssetCost - accumulated - carryingLiability)
      }
    ],
    "Lease opening balance journal"
  );
}

/** Remeasurement (Modify): the ROU asset moves by the liability change; a
 *  decrease larger than the ROU asset leaves it at zero and the rest is a
 *  gain. `adjustment` = new liability − carrying liability. */
export function remeasurementLines(args: {
  adjustment: number;
  gain: number;
  accounts: LesseeAccounts;
}): PostingLine[] {
  const { adjustment, gain, accounts } = args;
  return toPostingLines(
    [
      {
        side: "debit",
        account: accounts.rightOfUseAsset,
        description: "Right-of-use asset remeasured",
        amount: round(adjustment + gain)
      },
      {
        side: "credit",
        account: accounts.leaseLiability,
        description: "Lease liability remeasured",
        amount: adjustment
      },
      {
        side: "credit",
        account: accounts.gain,
        description: "Gain on lease modification",
        amount: gain
      }
    ],
    "Lease remeasurement journal"
  );
}

/** Early termination (ASC 842-20-40-1): the liability and the ROU asset
 *  leave the books, and the difference is a gain or loss. A penalty stays in
 *  the liability as a payment row the next invoice settles.
 *
 *   Dr Lease liability                 carrying − penalty
 *   Dr Accumulated ROU amortization    accumulated
 *       Cr ROU asset                           cost
 *       Cr / Dr gain or loss                   the difference
 */
export function terminationLines(args: {
  carryingLiability: number;
  penalty: number;
  rouAssetCost: number;
  accumulated: number;
  accounts: LesseeAccounts;
}): { lines: PostingLine[]; gainLoss: number } {
  const { carryingLiability, penalty, rouAssetCost, accumulated, accounts } =
    args;
  const gainLoss = round(
    carryingLiability - penalty - (rouAssetCost - accumulated)
  );
  const lines = toPostingLines(
    [
      {
        side: "debit",
        account: accounts.leaseLiability,
        description: "Lease liability derecognized",
        amount: round(carryingLiability - penalty)
      },
      {
        side: "debit",
        account: accounts.accumulatedRightOfUseAmortization,
        description: "Accumulated amortization derecognized",
        amount: accumulated
      },
      {
        side: "credit",
        account: accounts.rightOfUseAsset,
        description: "Right-of-use asset derecognized",
        amount: rouAssetCost
      },
      gainLoss >= 0
        ? {
            side: "credit",
            account: accounts.gain,
            description: "Gain on lease termination",
            amount: gainLoss
          }
        : {
            side: "debit",
            account: accounts.loss,
            description: "Loss on lease termination",
            amount: -gainLoss
          }
    ],
    "Lease termination journal"
  );
  return { lines, gainLoss };
}

/** Purchase option exercise (ASC 842-20-40-2): not a termination. The ROU
 *  asset moves into PP&E at its net book value, adjusted by the price less
 *  the carrying liability; the price stays in the liability as a payment row
 *  the next invoice settles.
 *
 *   Dr Fixed asset class asset account  net ROU + price − carrying liability
 *   Dr Accumulated ROU amortization     accumulated
 *   Dr Lease liability                  carrying liability
 *       Cr ROU asset                            cost
 *       Cr Lease liability                      price
 */
export function purchaseLines(args: {
  carryingLiability: number;
  price: number;
  rouAssetCost: number;
  accumulated: number;
  assetAccount: LeaseAccount;
  accounts: LesseeAccounts;
}): { lines: PostingLine[]; assetCost: number } {
  const { carryingLiability, price, rouAssetCost, accumulated, accounts } =
    args;
  const assetCost = round(
    rouAssetCost - accumulated + price - carryingLiability
  );
  if (assetCost < 0) {
    throw new Error(
      "The purchased asset would have a negative cost; check the purchase price"
    );
  }
  const lines = toPostingLines(
    [
      {
        side: "debit",
        account: args.assetAccount,
        description: "Leased asset purchased",
        amount: assetCost
      },
      {
        side: "debit",
        account: accounts.accumulatedRightOfUseAmortization,
        description: "Accumulated amortization derecognized",
        amount: accumulated
      },
      {
        side: "debit",
        account: accounts.leaseLiability,
        description: "Lease liability derecognized",
        amount: carryingLiability
      },
      {
        side: "credit",
        account: accounts.rightOfUseAsset,
        description: "Right-of-use asset derecognized",
        amount: rouAssetCost
      },
      {
        side: "credit",
        account: accounts.leaseLiability,
        description: "Purchase price payable",
        amount: price
      }
    ],
    "Lease purchase journal"
  );
  return { lines, assetCost };
}

/** The accounts of one month's two schedule rows (spec §3): an operating
 *  lease books both to the lease cost; a finance lease books interest and
 *  amortization separately. */
export function scheduleRowAccounts(
  classification: "Operating" | "Finance",
  accounts: LesseeAccounts
): {
  interest: { debitAccountId: string; creditAccountId: string };
  amortization: { debitAccountId: string; creditAccountId: string };
} {
  return {
    interest: {
      debitAccountId:
        classification === "Operating"
          ? accounts.operatingLeaseExpense.id
          : accounts.leaseInterestExpense.id,
      creditAccountId: accounts.leaseLiability.id
    },
    amortization: {
      debitAccountId:
        classification === "Operating"
          ? accounts.operatingLeaseExpense.id
          : accounts.rightOfUseAmortizationExpense.id,
      creditAccountId: accounts.accumulatedRightOfUseAmortization.id
    }
  };
}
