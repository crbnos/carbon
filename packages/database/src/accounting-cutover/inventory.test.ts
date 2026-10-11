// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import {
  type CutoverInventoryItem,
  cutoverInventoryValue,
  inventoryValueByAccount
} from "./inventory";

const item = (
  itemId: string,
  quantity: number,
  unitCost: number,
  inventoryAccountId: string
): CutoverInventoryItem => ({
  itemId,
  readableId: itemId,
  name: itemId,
  quantity,
  unitCost,
  costingMethod: "Average",
  inventoryAccountId
});

describe("cutoverInventoryValue", () => {
  it("rounds on-hand × unit cost once", () => {
    expect(cutoverInventoryValue({ quantity: 3, unitCost: 0.333333 })).toBe(1);
    expect(cutoverInventoryValue({ quantity: 2.5, unitCost: 4.2 })).toBe(10.5);
  });

  it("gives an item with no stock on hand no value", () => {
    expect(cutoverInventoryValue({ quantity: 0, unitCost: 10 })).toBe(0);
    expect(cutoverInventoryValue({ quantity: -2, unitCost: 10 })).toBe(0);
  });
});

describe("inventoryValueByAccount", () => {
  it("sums the item values per account and leaves out an empty account", () => {
    expect(
      inventoryValueByAccount([
        item("a", 1, 0.1, "raw"),
        item("b", 1, 0.2, "raw"),
        item("c", 2, 5, "finished"),
        item("d", 0, 7, "empty")
      ])
    ).toEqual([
      // 0.1 + 0.2 is 0.30000000000000004 until the sum is rounded.
      { accountId: "raw", value: 0.3 },
      { accountId: "finished", value: 10 }
    ]);
  });
});
