// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Journal-line builders of a lessee lease (spec
// `.ai/specs/2026-10-11-lessee-leases.md` §4). The legs — which account, which
// side, how much — are the shared lifecycle math in `@carbon/utils`
// (`lesseeTerminationLegs` …), the same functions the app's previews call;
// this file resolves each leg's account role to the company's account and
// signs the amount by the account's class (`toStoredAmount`), so a debit to
// the Liability-class lease liability stores a negative amount. Every set is
// balanced or it throws.

import { type AccountClass, toStoredAmount } from "@carbon/database/ledger";
import { assertBalanced, EPSILON, round } from "@carbon/database/precision";
import {
  type LesseeLeg,
  type LesseeLegAccount,
  lesseeCommencementLegs,
  lesseeOpeningBalanceLegs,
  lesseePurchaseLegs,
  lesseeRemeasurementLegs,
  lesseeTerminationLegs,
  normalizeLesseeLegs
} from "@carbon/utils";
import { InvalidInputError } from "../errors";

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

/** The accounts of the roles a leg names. `fixedAsset` and
 *  `retainedEarnings` are not lease defaults: a purchase passes the asset
 *  class's account and an opening balance the retained earnings default. */
type LegAccounts = Partial<Record<LesseeLegAccount, LeaseAccount>>;

/** The shared legs posted to the company's accounts. A role with no account
 *  is a programming error, never a user's. */
function postLegs(
  legs: LesseeLeg[],
  accounts: LesseeAccounts,
  extra: LegAccounts,
  label: string
): PostingLine[] {
  const resolved: LegAccounts = { ...accounts, ...extra };
  return toPostingLines(
    normalizeLesseeLegs(legs).map((leg) => {
      const account = resolved[leg.account];
      if (!account) {
        throw new Error(`${label}: no account for ${leg.account}`);
      }
      return { ...leg, account };
    }),
    label
  );
}

/** Commencement: Dr ROU asset / Cr Lease liability, both at the PV. */
export function commencementLines(args: {
  liability: number;
  accounts: LesseeAccounts;
}): PostingLine[] {
  return postLegs(
    lesseeCommencementLegs({ liability: args.liability }),
    args.accounts,
    {},
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
  return postLegs(
    lesseeOpeningBalanceLegs(args),
    args.accounts,
    { retainedEarnings: args.retainedEarnings },
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
  return postLegs(
    lesseeRemeasurementLegs(args),
    args.accounts,
    {},
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
  const { legs, gainLoss } = lesseeTerminationLegs(args);
  return {
    lines: postLegs(legs, args.accounts, {}, "Lease termination journal"),
    gainLoss
  };
}

/** Purchase option exercise (ASC 842-20-40-2): not a termination. The ROU
 *  asset moves into PP&E at its net book value, adjusted by the price less
 *  the carrying liability; the price stays in the liability as a payment row
 *  the next invoice settles. A price that leaves the asset a negative cost
 *  is refused as a 400.
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
  const { legs, assetCost } = lesseePurchaseLegs(args);
  if (assetCost < 0) {
    throw new InvalidInputError(
      "The purchased asset would have a negative cost; check the purchase price"
    );
  }
  return {
    lines: postLegs(
      legs,
      args.accounts,
      { fixedAsset: args.assetAccount },
      "Lease purchase journal"
    ),
    assetCost
  };
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
