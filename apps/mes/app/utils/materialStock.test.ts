// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { materialStockShortages } from "./materialStock";

const material = (
  id: string,
  itemId: string,
  required: number,
  issued = 0,
  methodType = "Pull from Inventory"
) => ({
  id,
  itemId,
  methodType,
  quantity: required,
  estimatedQuantity: required,
  quantityIssued: issued
});

describe("materialStockShortages", () => {
  it("lists a material the stock cannot fully issue", () => {
    expect(
      materialStockShortages(
        [material("m1", "bolt", 10, 4)],
        new Map([["bolt", 5]])
      )
    ).toEqual(new Map([["m1", { available: 5, needed: 6 }]]));
  });

  it("does not list a material the stock covers", () => {
    expect(
      materialStockShortages(
        [material("m1", "bolt", 10, 4)],
        new Map([["bolt", 6]])
      ).size
    ).toBe(0);
  });

  it("treats an item with no stock row as out of stock", () => {
    expect(
      materialStockShortages([material("m1", "bolt", 2)], new Map())
    ).toEqual(new Map([["m1", { available: 0, needed: 2 }]]));
  });

  it("compares one item's stock with all its materials together", () => {
    const shortages = materialStockShortages(
      [material("m1", "bolt", 4), material("m2", "bolt", 4)],
      new Map([["bolt", 6]])
    );
    expect(shortages.get("m1")).toEqual({ available: 6, needed: 8 });
    expect(shortages.get("m2")).toEqual({ available: 6, needed: 8 });
  });

  it("skips a fully issued material and a part the job makes", () => {
    expect(
      materialStockShortages(
        [
          material("done", "bolt", 4, 4),
          material("made", "bracket", 2, 0, "Make to Order")
        ],
        new Map()
      ).size
    ).toBe(0);
  });
});
