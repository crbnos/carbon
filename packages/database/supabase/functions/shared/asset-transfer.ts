import { credit, debit } from "../lib/utils.ts";
import { assertBalanced, EPSILON, round } from "./precision.ts";

/**
 * Pure journal-line builders for moving value between inventory and the fixed
 * asset register — capitalising stock / WIP / CIP into an asset, and returning
 * an asset to stock at its net book value.
 *
 * Every account these builders touch is class Asset, so a line's stored amount
 * is natural-balance-signed the way `journalLine.amount` is: `debit("asset", x)`
 * is +x and `credit("asset", x)` is −x. Each amount is rounded to the internal
 * scale before it is placed on a line, and every builder refuses to return an
 * unbalanced set of lines.
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
    lines.reduce((sum, line) => sum + line.amount, 0),
  );
  assertBalanced(signedDebitTotal, 0, EPSILON, label);
}

/**
 * Capitalise `cost` into a fixed asset: Dr the asset account, Cr the account
 * the value came from — a stock account (Finished Goods / Raw Materials), WIP,
 * or CIP — under `creditDescription`.
 */
export function buildCapitalizationLines(args: {
  cost: number;
  assetAccountId: string;
  creditAccountId: string;
  creditDescription: string;
}): PostingLine[] {
  const cost = ledgerAmount(args.cost, "Asset cost");
  // A cost that rounds to nothing at ledger precision has nothing to post.
  if (cost <= 0) throw new Error("Asset cost must be positive");

  const lines: PostingLine[] = [
    {
      accountId: args.assetAccountId,
      description: "Fixed Asset Acquisition",
      amount: debit("asset", cost),
    },
    {
      accountId: args.creditAccountId,
      description: args.creditDescription,
      amount: credit("asset", cost),
    },
  ];
  assertAssetLinesBalance(lines, "Asset capitalization journal");
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
    "Accumulated depreciation",
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
      amount: debit("asset", netBookValue),
    },
  ];
  if (accumulatedDepreciation !== 0) {
    lines.push({
      accountId: args.accounts.accumulatedDepreciationAccountId,
      description: "Accumulated Depreciation",
      amount: debit("asset", accumulatedDepreciation),
    });
  }
  lines.push({
    accountId: args.accounts.assetAccountId,
    description: "Fixed Asset Cost",
    amount: credit("asset", cost),
  });
  assertAssetLinesBalance(lines, "Asset return to inventory journal");
  return lines;
}
