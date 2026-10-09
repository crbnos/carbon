// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { AccountType } from "@carbon/database/ledger";
import { assertBalanced, credit, debit, EPSILON, round } from "@carbon/utils";

/**
 * Pure journal-line builders for moving value between inventory and the fixed
 * asset register — capitalising stock / WIP / CIP into an asset, and returning
 * an asset to stock at its net book value.
 *
 * A line's stored amount is natural-balance-signed the way `journalLine.amount`
 * is: on an Asset account `debit("asset", x)` is +x and `credit("asset", x)` is
 * −x. Every account is class Asset except the offset of `buildOffsetLines`
 * (and an entered cost's credit), which is signed by its own class. Each
 * amount is rounded to the internal scale before it is placed on a line, and
 * every builder refuses to return an unbalanced set of lines.
 */

export type PostingLine = {
  accountId: string;
  description: string;
  amount: number;
};

export type AssetAccounts = {
  assetAccountId: string;
  accumulatedDepreciationAccountId: string;
};

/** A finite input, rounded to the internal scale the ledger stores. */
function ledgerAmount(value: number, label: string): number {
  if (!Number.isFinite(value)) throw new Error(`${label} must be finite`);
  return round(value);
}

// Every line here sits on an Asset-class account, so the stored amounts are
// already signed debits (+ debit, − credit) and a balanced journal sums to 0.
function assertAssetLinesBalance(lines: PostingLine[], label: string): void {
  const signedDebitTotal = round(
    lines.reduce((sum, line) => sum + line.amount, 0)
  );
  assertBalanced(signedDebitTotal, 0, EPSILON, label);
}

/** A stored, natural-balance-signed amount as a signed debit. */
function asSignedDebit(type: AccountType, amount: number): number {
  return amount * debit(type, 1);
}

/**
 * Capitalise `cost` into a fixed asset: Dr the asset account, Cr the account
 * the value came from — a stock account (Finished Goods / Raw Materials), WIP,
 * or CIP — under `creditDescription`. `creditAccountType` is that account's
 * class (default asset): an entered cost is credited to whatever account it
 * was spent from — Retained Earnings is Equity, so its credit is stored +x.
 */
export function buildCapitalizationLines(args: {
  cost: number;
  assetAccountId: string;
  creditAccountId: string;
  creditDescription: string;
  creditAccountType?: AccountType;
}): PostingLine[] {
  const cost = ledgerAmount(args.cost, "Asset cost");
  // A cost that rounds to nothing at ledger precision has nothing to post.
  if (cost <= 0) throw new Error("Asset cost must be positive");

  return buildOffsetLines({
    amount: cost,
    accountId: args.assetAccountId,
    description: "Fixed Asset Acquisition",
    offsetAccountId: args.creditAccountId,
    offsetDescription: args.creditDescription,
    offsetAccountType: args.creditAccountType ?? "asset",
    label: "Asset capitalization journal"
  });
}

/**
 * Raise (`amount` > 0) or lower (`amount` < 0) an Asset-class account against
 * an offset account of any class: Dr asset / Cr offset to raise, the reverse
 * to lower. Each line is signed by its own account's natural balance, and the
 * pair is checked as debits = credits.
 */
export function buildOffsetLines(args: {
  amount: number;
  accountId: string;
  description: string;
  offsetAccountId: string;
  offsetDescription: string;
  offsetAccountType: AccountType;
  label: string;
}): PostingLine[] {
  const amount = ledgerAmount(args.amount, args.label);
  if (amount === 0) throw new Error(`${args.label} has nothing to post`);
  const raise = amount > 0;
  const size = Math.abs(amount);
  const lines: PostingLine[] = [
    {
      accountId: args.accountId,
      description: args.description,
      amount: raise ? debit("asset", size) : credit("asset", size)
    },
    {
      accountId: args.offsetAccountId,
      description: args.offsetDescription,
      amount: raise
        ? credit(args.offsetAccountType, size)
        : debit(args.offsetAccountType, size)
    }
  ];
  const [assetLine, offsetLine] = lines as [PostingLine, PostingLine];
  assertBalanced(
    round(
      asSignedDebit("asset", assetLine.amount) +
        asSignedDebit(args.offsetAccountType, offsetLine.amount)
    ),
    0,
    EPSILON,
    args.label
  );
  return lines;
}

/**
 * Return a fixed asset to inventory at its net book value: Dr inventory for
 * `cost − accumulatedDepreciation`, Dr accumulated depreciation to clear it
 * (omitted when nothing has been depreciated), Cr the asset account at cost.
 */
export function buildReturnToInventoryLines(args: {
  cost: number;
  accumulatedDepreciation: number;
  inventoryAccountId: string;
  inventoryDescription: string;
  accounts: AssetAccounts;
}): PostingLine[] {
  const cost = ledgerAmount(args.cost, "Asset cost");
  const accumulatedDepreciation = ledgerAmount(
    args.accumulatedDepreciation,
    "Accumulated depreciation"
  );
  if (cost <= 0) throw new Error("Asset cost must be positive");
  if (accumulatedDepreciation < 0) {
    throw new Error("Accumulated depreciation must not be negative");
  }
  if (accumulatedDepreciation > cost) {
    throw new Error("Accumulated depreciation exceeds asset cost");
  }
  const netBookValue = round(cost - accumulatedDepreciation);

  const lines: PostingLine[] = [
    {
      accountId: args.inventoryAccountId,
      description: args.inventoryDescription,
      amount: debit("asset", netBookValue)
    }
  ];
  if (accumulatedDepreciation !== 0) {
    lines.push({
      accountId: args.accounts.accumulatedDepreciationAccountId,
      description: "Accumulated Depreciation",
      amount: debit("asset", accumulatedDepreciation)
    });
  }
  lines.push({
    accountId: args.accounts.assetAccountId,
    description: "Fixed Asset Cost",
    amount: credit("asset", cost)
  });
  assertAssetLinesBalance(lines, "Asset return to inventory journal");
  return lines;
}
