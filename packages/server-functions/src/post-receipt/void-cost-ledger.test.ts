// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import {
  planReceiptVoidCostLedger,
  type ReceiptCostLedgerRow
} from "./void-cost-ledger";

function row(overrides: Partial<ReceiptCostLedgerRow>): ReceiptCostLedgerRow {
  return {
    id: "cl1",
    itemId: "item1",
    quantity: 10,
    remainingQuantity: 10,
    cost: 100,
    supplierId: "sup1",
    trackedEntityId: null,
    ...overrides
  };
}

describe("planReceiptVoidCostLedger", () => {
  it("closes every layer the receipt created while none of it was used", () => {
    const plan = planReceiptVoidCostLedger([
      row({ id: "a" }),
      row({ id: "b", itemId: "item2", quantity: 4, remainingQuantity: 4 })
    ]);

    expect(plan.consumed).toBe(false);
    expect(plan.layerIdsToClose).toEqual(["a", "b"]);
    expect(plan.restoringLayers).toEqual([]);
  });

  it("refuses when a layer the receipt created was partly used", () => {
    const plan = planReceiptVoidCostLedger([
      row({ id: "a" }),
      row({ id: "b", quantity: 4, remainingQuantity: 3 })
    ]);

    expect(plan.consumed).toBe(true);
  });

  it("ignores float noise in the remaining quantity", () => {
    const plan = planReceiptVoidCostLedger([
      row({ quantity: 0.3, remainingQuantity: 0.1 + 0.2 })
    ]);

    expect(plan.consumed).toBe(false);
  });

  it("restores the stock a negative receipt line relieved, at the relieved cost", () => {
    const plan = planReceiptVoidCostLedger([
      row({ id: "neg", quantity: -3, remainingQuantity: 0, cost: -27 })
    ]);

    expect(plan.consumed).toBe(false);
    expect(plan.layerIdsToClose).toEqual([]);
    expect(plan.restoringLayers).toEqual([
      {
        itemId: "item1",
        quantity: 3,
        cost: 27,
        supplierId: "sup1",
        trackedEntityId: null
      }
    ]);
  });
});
