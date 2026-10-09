// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import {
  buildOpeningJournalLines,
  MIGRATION_CLEARING_DESCRIPTION,
  migrationClearingByAccount,
  type OpenItem,
  type OpeningJournalLine,
  planInventoryReset,
  recostOutbound,
  type TrialBalanceLine
} from "./accounting-cutover.ts";

const AR = "acct-ar";
const CASH = "acct-cash";
const EQUITY = "acct-equity";
const CLEARING = "acct-clearing";

function receivable(
  documentId: string,
  originalAmount: number,
  settledBeforeCutover = 0
): OpenItem {
  return {
    openItemType: "Receivable",
    accountId: AR,
    accountClass: "Asset",
    amount: originalAmount - settledBeforeCutover,
    originalAmount,
    settledBeforeCutover,
    documentType: "Invoice",
    documentId,
    documentLineReference: null,
    description: "Accounts Receivable"
  };
}

const classOf: Record<string, OpenItem["accountClass"]> = {
  [AR]: "Asset",
  [CASH]: "Asset",
  [EQUITY]: "Equity",
  [CLEARING]: "Equity"
};

/** Debits minus credits of a natural-balance-signed journal. */
function imbalance(lines: OpeningJournalLine[]) {
  return lines.reduce((sum, line) => {
    const accountClass = classOf[line.accountId];
    const debit =
      accountClass === "Asset" || accountClass === "Expense"
        ? line.amount
        : -line.amount;
    return sum + debit;
  }, 0);
}

const controls = new Set([AR]);

describe("buildOpeningJournalLines", () => {
  it("balances, and ties Migration Clearing to zero, when the trial balance matches the open invoices", () => {
    const items = [receivable("inv-1", 100), receivable("inv-2", 50)];
    const trialBalance: TrialBalanceLine[] = [
      { accountId: AR, accountClass: "Asset", debit: 150, credit: 0 },
      { accountId: CASH, accountClass: "Asset", debit: 25, credit: 0 },
      { accountId: EQUITY, accountClass: "Equity", debit: 0, credit: 175 }
    ];

    const lines = buildOpeningJournalLines(
      items,
      trialBalance,
      controls,
      CLEARING
    );

    expect(imbalance(lines)).toBeCloseTo(0, 6);
    expect(migrationClearingByAccount(items, trialBalance, controls)).toEqual({
      rows: [{ accountId: AR, trialBalance: 150, carbon: 150, difference: 0 }],
      total: 0
    });
  });

  it("keeps the original amount and books the part settled before the cutover on its own line", () => {
    const lines = buildOpeningJournalLines(
      [receivable("inv-1", 100, 40)],
      [],
      controls,
      CLEARING
    );

    const arLines = lines.filter((line) => line.accountId === AR);
    expect(arLines).toEqual([
      expect.objectContaining({
        amount: 100,
        description: "Accounts Receivable",
        documentId: "inv-1"
      }),
      expect.objectContaining({
        amount: -40,
        description: "Accounts Receivable (settled before cutover)",
        documentId: "inv-1"
      })
    ]);
    expect(arLines.reduce((sum, line) => sum + line.amount, 0)).toBe(60);
  });

  it("shows a 5.00 difference on the receivables row when the trial balance says 5.00 more", () => {
    const items = [receivable("inv-1", 100)];
    const trialBalance: TrialBalanceLine[] = [
      { accountId: AR, accountClass: "Asset", debit: 105, credit: 0 },
      { accountId: EQUITY, accountClass: "Equity", debit: 0, credit: 105 }
    ];

    const clearing = migrationClearingByAccount(items, trialBalance, controls);

    expect(clearing.rows).toEqual([
      { accountId: AR, trialBalance: 105, carbon: 100, difference: 5 }
    ]);
    expect(clearing.total).toBe(5);
  });

  it("books a trial balance row on cash as a cash line and a clearing line, and none for a control row", () => {
    const lines = buildOpeningJournalLines(
      [],
      [
        { accountId: CASH, accountClass: "Asset", debit: 30, credit: 0 },
        { accountId: AR, accountClass: "Asset", debit: 99, credit: 0 }
      ],
      controls,
      CLEARING
    );

    expect(lines).toEqual([
      expect.objectContaining({ accountId: CASH, amount: 30 }),
      expect.objectContaining({
        accountId: CLEARING,
        amount: 30,
        description: MIGRATION_CLEARING_DESCRIPTION
      })
    ]);
    expect(imbalance(lines)).toBeCloseTo(0, 6);
  });
});

describe("planInventoryReset", () => {
  it("closes every layer before the cutover and opens one layer per item with stock", () => {
    const plan = planInventoryReset(
      [
        { itemId: "item-a", quantity: 4 },
        { itemId: "item-b", quantity: 0 }
      ],
      new Map([
        ["item-a", 2.5],
        ["item-b", 9]
      ]),
      [
        { id: "layer-1", itemId: "item-a" },
        { id: "layer-2", itemId: "item-a" },
        { id: "layer-3", itemId: "item-b" }
      ]
    );

    expect(plan.layerIdsToClose).toEqual(["layer-1", "layer-2", "layer-3"]);
    expect(plan.openingLayers).toEqual([
      { itemId: "item-a", quantity: 4, cost: 10, remainingQuantity: 4 }
    ]);
  });
});

describe("recostOutbound", () => {
  it("relieves the opening layer first, then the next inbound layer", () => {
    const result = recostOutbound(
      [
        {
          key: "opening",
          itemId: "item-a",
          quantity: 2,
          cost: 20,
          remainingQuantity: 2
        },
        {
          key: "receipt",
          itemId: "item-a",
          quantity: 5,
          cost: 75,
          remainingQuantity: 5
        }
      ],
      [{ costLedgerId: "ship-1", itemId: "item-a", quantity: 3, cost: 33 }],
      new Map()
    );

    // 2 × 10 from the opening layer + 1 × 15 from the receipt.
    expect(result.movements).toEqual([
      { costLedgerId: "ship-1", newCost: 35, delta: 2 }
    ]);
    expect(result.remainingByLayer.get("opening")).toBe(0);
    expect(result.remainingByLayer.get("receipt")).toBe(4);
  });
});
