// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// How a contract invoice line posts (plan D6): never to Sales and never as a
// Service deferral with schedule rows. The line moves its contract line's
// position (invoiced − recognized) by its own revenue: a normal line clears
// Contract Assets first (what the recognition run accrued ahead of billing)
// and defers the rest; a negative adjustment line releases Deferred Revenue
// first and adds the rest to Contract Assets. When the line's currency is not
// the base currency, the receivable is at the invoice's rate while the pool it
// clears is at its carried base, so the difference is realized FX — never
// revenue. Pure: index.ts reads the position and writes the ledger entry.

import {
  applyContractMovement,
  type ContractMovement,
  type ContractPosition,
  movementCredits
} from "@carbon/database/contract-position";
import { round } from "@carbon/database/precision";
import type {
  SalesPostingAccount,
  SalesRevenueLeg
} from "@carbon/database/sales-posting-amounts";

export type ContractPostingAccounts = {
  deferredRevenue: SalesPostingAccount;
  contractAsset: SalesPostingAccount;
  fxGain: SalesPostingAccount | null;
  fxLoss: SalesPostingAccount | null;
};

/** A journal line beyond the builder's revenue legs, as a signed credit
 *  (negative = debit) on `account`. */
export type ContractReclassLine = {
  account: SalesPostingAccount;
  accountClass: "Asset" | "Liability" | "Revenue" | "Expense";
  description: string;
  credit: number;
};

/**
 * One contract invoice line's revenue side.
 * - `revenueLegs` replace the Sales leg in `buildSalesPostingLines`: the pool
 *   the movement draws first (Contract Assets for a normal line, Deferred
 *   Revenue for a negative one), clipped to the line's revenue so it shares
 *   the line's sign, then the other pool as the remainder.
 * - `reclass` are the lines that bring each pool to exactly its ledger delta
 *   and book the FX difference; they sum to zero, so the entry still
 *   balances. Empty in the base-currency case.
 */
export function planContractInvoiceLine(args: {
  position: ContractPosition;
  /** The line's sales revenue in base, signed (`salesRevenueBase`). */
  revenueBase: number;
  /** The invoice's rate, foreign units per base unit. */
  rate: number;
  accounts: ContractPostingAccounts;
  customerContractId: string;
}): {
  movement: ContractMovement;
  revenueLegs: SalesRevenueLeg[];
  reclass: ContractReclassLine[];
} {
  const { position, revenueBase, rate, accounts, customerContractId } = args;
  // The line's revenue in the contract (document) currency: the base price
  // was derived from it at the invoice's rate.
  const amount = round(revenueBase * rate);
  const movement = applyContractMovement({
    position,
    amount,
    rate,
    counterpart: "receivable"
  });
  const credits = movementCredits(movement, revenueBase);

  const asset = {
    account: accounts.contractAsset,
    accountClass: "Asset" as const,
    description: "Contract Assets",
    target: credits.asset
  };
  const deferred = {
    account: accounts.deferredRevenue,
    accountClass: "Liability" as const,
    description: "Deferred Revenue",
    target: credits.deferred
  };
  const [first, second] =
    revenueBase >= 0 ? [asset, deferred] : [deferred, asset];
  // Clipped into [0, revenueBase] (or [revenueBase, 0]): an explicit leg
  // must carry the line's sign and cannot exceed it.
  const firstLeg =
    revenueBase >= 0
      ? Math.min(Math.max(first.target, 0), revenueBase)
      : Math.max(Math.min(first.target, 0), revenueBase);
  const secondLeg = round(revenueBase - firstLeg);
  const document = {
    documentType: "Contract" as const,
    documentId: customerContractId
  };
  const revenueLegs: SalesRevenueLeg[] = [
    {
      account: first.account,
      accountClass: first.accountClass,
      description: first.description,
      amount: firstLeg,
      ...document
    },
    {
      account: second.account,
      accountClass: second.accountClass,
      description: second.description,
      ...document
    }
  ];

  const reclass: ContractReclassLine[] = [];
  const push = (line: Omit<ContractReclassLine, "credit">, value: number) => {
    const amount = round(value);
    if (amount !== 0) reclass.push({ ...line, credit: amount });
  };
  push(first, first.target - firstLeg);
  push(second, second.target - secondLeg);
  if (credits.fx !== 0) {
    const gain = credits.fx > 0;
    const account = gain ? accounts.fxGain : accounts.fxLoss;
    if (!account) {
      throw new Error(
        `Map the realized exchange ${gain ? "gain" : "loss"} account (an active ${gain ? "Revenue" : "Expense"} leaf) in the accounting defaults; this contract invoice clears a balance carried at another rate`
      );
    }
    push(
      {
        account,
        accountClass: gain ? "Revenue" : "Expense",
        description: gain ? "Realized FX gain" : "Realized FX loss"
      },
      credits.fx
    );
  }
  return { movement, revenueLegs, reclass };
}
