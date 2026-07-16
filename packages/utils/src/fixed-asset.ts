import { toStoredAmount } from "./accounting";

// GAAP-correct fixed-asset GL posting math. Pure — no DB, no side effects — so the
// app-side poster (`accounting.server.ts`) and the `post-shipment` /
// `post-sales-invoice` edge functions can share one source of truth for the
// arithmetic, and it can be unit-tested without a database.
//
// Lines here are in TRUE double-entry form: `amount > 0` is a debit, `amount < 0`
// is a credit, and a balanced entry sums to exactly zero. Convert to the stored,
// natural-balance-signed `journalLine.amount` with `toStoredFixedAssetAmount`.
//
// Whether a role hits the Balance Sheet or the P&L is a property of the account it
// maps to (see `.ai/rules/fixed-asset-lifecycle.md`):
//   asset / accumulatedDepreciation / disposalClearing / accountsReceivable → Balance Sheet
//   acquisitionSource (GR/IR clearing)                                       → Balance Sheet
//   disposal (gain/loss on disposal)                                        → P&L (non-operating)
export type FixedAssetPostingRole =
  | "asset" // fixedAssetClass.assetAccountId
  | "accumulatedDepreciation" // fixedAssetClass.accumulatedDepreciationAccountId
  | "disposalClearing" // accountDefault.assetAquisitionCostOnDisposalAccount (BS holding)
  | "disposal" // fixedAssetClass.disposalAccountId (P&L gain/loss)
  | "accountsReceivable" // accountDefault.receivablesAccount
  | "acquisitionSource"; // accountDefault.goodsReceivedNotInvoicedAccount (GR/IR)

export interface FixedAssetPostingLine {
  role: FixedAssetPostingRole;
  // TRUE debit(+)/credit(-) amount; a balanced entry sums to 0.
  amount: number;
}

// Account class used to convert each role's true debit/credit into the stored,
// natural-balance-signed amount. Mirrors how the existing posters classify these
// accounts (accumulated depreciation is signed as an Asset; the gain/loss account
// as an Expense so a loss debits and a gain credits it).
const ROLE_ACCOUNT_CLASS: Record<
  FixedAssetPostingRole,
  "Asset" | "Liability" | "Expense"
> = {
  asset: "Asset",
  accumulatedDepreciation: "Asset",
  disposalClearing: "Asset",
  disposal: "Expense",
  accountsReceivable: "Asset",
  acquisitionSource: "Liability"
};

export function fixedAssetNetBookValue(
  acquisitionCost: number,
  accumulatedDepreciation: number
): number {
  return acquisitionCost - accumulatedDepreciation;
}

// Convert a true debit/credit posting line to the stored `journalLine.amount`.
export function toStoredFixedAssetAmount(line: FixedAssetPostingLine): number {
  const cls = ROLE_ACCOUNT_CLASS[line.role];
  return line.amount >= 0
    ? toStoredAmount(line.amount, 0, cls)
    : toStoredAmount(0, -line.amount, cls);
}

// Manual registration / acquisition: Dr Fixed Asset / Cr acquisition source
// (GR/IR clearing), so no capitalized asset exists without a GL entry. Mirrors the
// goods-receipt acquisition (Dr asset / Cr GR/IR) and reconciles if a purchase
// invoice later arrives.
export function acquisitionLines(
  acquisitionCost: number
): FixedAssetPostingLine[] {
  return [
    { role: "asset", amount: acquisitionCost },
    { role: "acquisitionSource", amount: -acquisitionCost }
  ];
}

// Two-step disposal, SHIPMENT leg (the asset physically leaves). Balance-sheet
// only: clear accumulated depreciation, park the net book value in Disposal
// Clearing (a balance-sheet holding account), and remove the asset at cost. No
// gain/loss and no write-off are recognized here, so a shipped-but-uninvoiced
// asset has ZERO P&L impact.
export function disposalShipmentLines(
  acquisitionCost: number,
  accumulatedDepreciation: number
): FixedAssetPostingLine[] {
  const nbv = fixedAssetNetBookValue(acquisitionCost, accumulatedDepreciation);
  const lines: FixedAssetPostingLine[] = [];
  if (accumulatedDepreciation > 0) {
    lines.push({
      role: "accumulatedDepreciation",
      amount: accumulatedDepreciation
    });
  }
  if (nbv > 0) lines.push({ role: "disposalClearing", amount: nbv });
  lines.push({ role: "asset", amount: -acquisitionCost });
  return lines;
}

// Two-step disposal, INVOICE leg (proceeds recognized). Book AR, DRAIN the net book
// value out of Disposal Clearing, and route the net gain/(loss) to the disposal
// (gain/loss) P&L account. gainLoss = proceeds − NBV: a gain credits the disposal
// account, a loss debits it. The write-off account is never touched, so it nets to
// zero across the completed disposal.
export function disposalInvoiceLines(
  netBookValue: number,
  saleProceeds: number
): FixedAssetPostingLine[] {
  const gainLoss = saleProceeds - netBookValue;
  const lines: FixedAssetPostingLine[] = [
    { role: "accountsReceivable", amount: saleProceeds }
  ];
  if (netBookValue > 0) {
    lines.push({ role: "disposalClearing", amount: -netBookValue });
  }
  if (gainLoss !== 0) lines.push({ role: "disposal", amount: -gainLoss });
  return lines;
}

// One-step disposal: invoice with no prior shipment, or a manual scrap (proceeds 0).
// The classic combined entry — clear accumulated depreciation, book proceeds (if
// any), remove the asset at cost, and net the gain/(loss) to the disposal account.
// The write-off account is never touched.
export function disposalCombinedLines(
  acquisitionCost: number,
  accumulatedDepreciation: number,
  saleProceeds: number
): FixedAssetPostingLine[] {
  const nbv = fixedAssetNetBookValue(acquisitionCost, accumulatedDepreciation);
  const gainLoss = saleProceeds - nbv;
  const lines: FixedAssetPostingLine[] = [];
  if (accumulatedDepreciation > 0) {
    lines.push({
      role: "accumulatedDepreciation",
      amount: accumulatedDepreciation
    });
  }
  if (saleProceeds > 0) {
    lines.push({ role: "accountsReceivable", amount: saleProceeds });
  }
  lines.push({ role: "asset", amount: -acquisitionCost });
  if (gainLoss !== 0) lines.push({ role: "disposal", amount: -gainLoss });
  return lines;
}

// Sum of true debit/credit amounts — 0 for a balanced entry.
export function sumPostingLines(lines: FixedAssetPostingLine[]): number {
  return lines.reduce((total, line) => total + line.amount, 0);
}
