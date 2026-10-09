// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import {
  buildOpeningJournalLines,
  dayBeforeCutover,
  isMigrationClearingZero,
  MIGRATION_CLEARING_DESCRIPTION,
  type MigrationClearingAccount,
  migrationClearingByAccount,
  type OpenItem,
  type OpeningJournalLine,
  planInventoryReset,
  type RecostEvent,
  type RecostLayer,
  recostOutbound,
  type TrialBalanceLine,
  unitCostAtCutover
} from "./accounting-cutover.ts";

const AR = "acct-ar";
const AP = "acct-ap";
const CASH = "acct-cash";
const EQUITY = "acct-equity";
const ACCUMULATED_DEPRECIATION = "acct-accumulated-depreciation";
const CLEARING = "acct-clearing";
const CLEARING_ACCOUNT: MigrationClearingAccount = {
  accountId: CLEARING,
  accountClass: "Equity"
};

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
  [AP]: "Liability",
  [CASH]: "Asset",
  [EQUITY]: "Equity",
  [ACCUMULATED_DEPRECIATION]: "Asset",
  [CLEARING]: "Equity",
  "acct-grni": "Liability"
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
      CLEARING_ACCOUNT
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
      CLEARING_ACCOUNT
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

  it("keys received-not-invoiced by reference: received on receipt:, cleared on purchase-invoice:", () => {
    const GRNI = "acct-grni";
    const lines = buildOpeningJournalLines(
      [
        {
          openItemType: "Received Not Invoiced",
          accountId: GRNI,
          accountClass: "Liability",
          amount: 60,
          originalAmount: 100,
          settledBeforeCutover: 40,
          documentType: null,
          documentId: null,
          documentLineReference: "receipt:po-line-1",
          description: "Goods Received Not Invoiced",
          quantity: 10,
          settled: {
            documentLineReference: "purchase-invoice:po-line-1",
            description: "GR/IR Clearing",
            quantity: 4
          }
        }
      ],
      [],
      new Set([GRNI]),
      CLEARING_ACCOUNT
    );

    expect(lines).toEqual([
      {
        accountId: GRNI,
        amount: 100,
        description: "Goods Received Not Invoiced",
        documentType: null,
        documentId: null,
        documentLineReference: "receipt:po-line-1",
        quantity: 10
      },
      {
        accountId: GRNI,
        amount: -40,
        description: "GR/IR Clearing",
        documentType: null,
        documentId: null,
        documentLineReference: "purchase-invoice:po-line-1",
        quantity: 4
      },
      {
        accountId: CLEARING,
        amount: -60,
        description: MIGRATION_CLEARING_DESCRIPTION,
        documentType: null,
        documentId: null,
        documentLineReference: GRNI,
        quantity: null
      }
    ]);
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
      CLEARING_ACCOUNT
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

  it("signs a payable, accumulated depreciation and their clearing lines by each account's class", () => {
    const items: OpenItem[] = [
      receivable("inv-1", 100),
      {
        openItemType: "Payable",
        accountId: AP,
        accountClass: "Liability",
        amount: 70,
        originalAmount: 70,
        settledBeforeCutover: 0,
        documentType: "Invoice",
        documentId: "pinv-1",
        documentLineReference: null,
        description: "Accounts Payable"
      },
      {
        // A credit balance on an asset-class contra account.
        openItemType: "Accumulated Depreciation",
        accountId: ACCUMULATED_DEPRECIATION,
        accountClass: "Asset",
        amount: -30,
        originalAmount: -30,
        settledBeforeCutover: 0,
        documentType: null,
        documentId: null,
        documentLineReference: null,
        description: "Accumulated Depreciation"
      }
    ];
    const lines = buildOpeningJournalLines(
      items,
      [],
      new Set([AR, AP, ACCUMULATED_DEPRECIATION]),
      CLEARING_ACCOUNT
    );

    const clearing = (accountId: string) =>
      lines.find(
        (line) =>
          line.accountId === CLEARING &&
          line.documentLineReference === accountId
      )?.amount;
    // Receivables debit 100: Migration Clearing credit 100 (+100 on equity).
    expect(clearing(AR)).toBe(100);
    // Payables credit 70: Migration Clearing debit 70 (−70 on equity).
    expect(clearing(AP)).toBe(-70);
    // Accumulated depreciation credit 30: Migration Clearing debit 30.
    expect(clearing(ACCUMULATED_DEPRECIATION)).toBe(-30);
    expect(imbalance(lines)).toBeCloseTo(0, 6);
    expect(migrationClearingByAccount(items, [], new Set([AR, AP])).total).toBe(
      0
    );
  });

  it("refuses a Migration Clearing account that is not Equity", () => {
    expect(() =>
      buildOpeningJournalLines([receivable("inv-1", 100)], [], controls, {
        accountId: CLEARING,
        accountClass: "Liability"
      })
    ).toThrow(/Migration Clearing must be an Equity account/);
  });

  it("refuses an opening journal that does not balance", () => {
    // The amount open disagrees with the original less the settled part, so
    // the clearing line offsets 90 against a receivable line of 100.
    const item = { ...receivable("inv-1", 100), amount: 90 };
    expect(() =>
      buildOpeningJournalLines([item], [], controls, CLEARING_ACCOUNT)
    ).toThrow(/Opening journal does not balance/);
  });
});

describe("planInventoryReset", () => {
  it("refuses stock with no unit cost", () => {
    expect(() =>
      planInventoryReset([{ itemId: "item-a", quantity: 1 }], new Map())
    ).toThrow(/no unit cost/);
  });

  it("opens one layer per item with stock", () => {
    const openingLayers = planInventoryReset(
      [
        { itemId: "item-a", quantity: 4 },
        { itemId: "item-b", quantity: 0 }
      ],
      new Map([
        ["item-a", 2.5],
        ["item-b", 9]
      ])
    );

    expect(openingLayers).toEqual([
      { itemId: "item-a", quantity: 4, cost: 10 }
    ]);
  });
});

describe("recostOutbound", () => {
  const layer = (
    id: string,
    quantity: number,
    cost: number,
    children: RecostLayer["children"] = []
  ): RecostEvent => ({
    layer: {
      id,
      itemId: "item-a",
      quantity,
      cost,
      remainingQuantity: quantity,
      trackedEntityId: null,
      children
    }
  });
  const ship = (id: string, quantity: number, cost: number): RecostEvent => ({
    outbound: {
      costLedgerId: id,
      itemId: "item-a",
      quantity,
      cost,
      trackedEntityIds: []
    }
  });
  const fifo = new Map([["item-a", "FIFO" as const]]);

  it("relieves the opening layer first, then the next inbound layer", () => {
    const result = recostOutbound(
      [layer("opening", 2, 20), layer("receipt", 5, 75), ship("ship-1", 3, 33)],
      fifo,
      new Map([["item-a", 0]])
    );

    // 2 × 10 from the opening layer + 1 × 15 from the receipt.
    expect(result.movements).toEqual([
      { costLedgerId: "ship-1", newCost: 35, delta: 2 }
    ]);
    expect(result.remainingById.get("opening")).toBe(0);
    expect(result.remainingById.get("receipt")).toBe(4);
  });

  it("never takes a layer posted after the movement", () => {
    const result = recostOutbound(
      [layer("opening", 2, 20), ship("ship-1", 3, 30), layer("receipt", 5, 75)],
      fifo,
      new Map([["item-a", 11]])
    );

    // 2 × 10 from the opening layer + 1 × 11 at the fallback: the receipt
    // posted after the shipment was not in stock for it.
    expect(result.movements).toEqual([
      { costLedgerId: "ship-1", newCost: 31, delta: 1 }
    ]);
    expect(result.remainingById.get("receipt")).toBe(5);
  });

  it("takes the newest layer first for a LIFO item", () => {
    const result = recostOutbound(
      [layer("opening", 2, 20), layer("receipt", 5, 75), ship("ship-1", 3, 30)],
      new Map([["item-a", "LIFO" as const]]),
      new Map([["item-a", 0]])
    );

    expect(result.movements).toEqual([
      { costLedgerId: "ship-1", newCost: 45, delta: 15 }
    ]);
    expect(result.remainingById.get("opening")).toBe(2);
    expect(result.remainingById.get("receipt")).toBe(2);
  });

  it("costs a layer's units with its invoice write-up, replayed from its full quantity", () => {
    // 5 at 15 after the cutover, written up by 1 on each of its 5 units.
    const result = recostOutbound(
      [
        layer("receipt", 5, 75, [
          { id: "write-up", quantity: 5, cost: 5, remainingQuantity: 5 }
        ]),
        ship("ship-1", 2, 30),
        ship("ship-2", 2, 30)
      ],
      fifo,
      new Map([["item-a", 0]])
    );

    expect(result.movements).toEqual([
      { costLedgerId: "ship-1", newCost: 32, delta: 2 },
      { costLedgerId: "ship-2", newCost: 32, delta: 2 }
    ]);
    expect(result.remainingById.get("receipt")).toBe(1);
    expect(result.remainingById.get("write-up")).toBe(1);
  });

  it("relieves a serial unit from its own layer", () => {
    const result = recostOutbound(
      [
        layer("opening", 2, 20),
        {
          layer: {
            id: "unit-layer",
            itemId: "item-a",
            quantity: 1,
            cost: 60,
            remainingQuantity: 1,
            trackedEntityId: "unit-1",
            children: []
          }
        },
        {
          outbound: {
            costLedgerId: "ship-1",
            itemId: "item-a",
            quantity: 1,
            cost: 10,
            trackedEntityIds: ["unit-1"]
          }
        }
      ],
      fifo,
      new Map([["item-a", 0]])
    );

    expect(result.movements).toEqual([
      { costLedgerId: "ship-1", newCost: 60, delta: 50 }
    ]);
    expect(result.remainingById.get("opening")).toBe(2);
    expect(result.remainingById.get("unit-layer")).toBe(0);
  });
});

describe("unitCostAtCutover", () => {
  // Oldest first: 4 at 10, then 4 at 20.
  const layers = [
    { quantity: 4, cost: 40 },
    { quantity: 4, cost: 80 }
  ];

  it("values FIFO stock from the newest layers", () => {
    // 5 on hand: 4 × 20 + 1 × 10.
    expect(unitCostAtCutover(layers, 5, "FIFO", 0)).toBe(18);
  });

  it("values LIFO stock from the oldest layers", () => {
    // 5 on hand: 4 × 10 + 1 × 20.
    expect(unitCostAtCutover(layers, 5, "LIFO", 0)).toBe(12);
  });

  it("values the quantity no layer covers at the fallback cost", () => {
    // 10 on hand: 80 + 40 + 2 × 15.
    expect(unitCostAtCutover(layers, 10, "FIFO", 15)).toBe(15);
  });
});

describe("cutover constants", () => {
  it("treats Migration Clearing within 0.01 of zero as zero", () => {
    expect(isMigrationClearingZero(0.01)).toBe(true);
    expect(isMigrationClearingZero(-0.01)).toBe(true);
    expect(isMigrationClearingZero(0.02)).toBe(false);
  });

  it("dates the opening journal the day before the cutover", () => {
    expect(dayBeforeCutover("2026-03-01")).toBe("2026-02-28");
  });
});
