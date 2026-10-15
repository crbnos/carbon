// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { expect, it } from "vitest";
import { buildItemIndex } from "./existing-item";
import { classifySalePriceRow } from "./item-sale-price-import";

const itemIndex = buildItemIndex([
  { id: "item-1", readableId: "GEAR-20", revision: "0", type: "Part" },
  { id: "item-svc", readableId: "CAL-SVC", revision: "0", type: "Service" },
  { id: "item-new", readableId: "GEAR-21", revision: "0", type: "Part" }
]);

const classify = (
  record: Record<string, string>,
  seenItemIds = new Set<string>()
) =>
  classifySalePriceRow({
    record,
    itemIndex,
    // GEAR-21 has lost its sale price row.
    pricedItemIds: new Set(["item-1", "item-svc"]),
    seenItemIds
  });

it("updates the item's sale price, rounded to the stored scale", () => {
  expect(
    classify({ readableId: "GEAR-20", unitSalePrice: "12.345678" })
  ).toEqual({ action: "update", itemId: "item-1", unitSalePrice: 12.34568 });
  expect(classify({ readableId: "CAL-SVC", unitSalePrice: "0" })).toEqual({
    action: "update",
    itemId: "item-svc",
    unitSalePrice: 0
  });
});

it("refuses what the sale price form refuses", () => {
  expect(classify({ readableId: "GEAR-20", unitSalePrice: "-1" })).toEqual({
    action: "error",
    reason: "Unit Sale Price must be a number of 0 or more"
  });
  expect(classify({ readableId: "GEAR-20", unitSalePrice: "" })).toEqual({
    action: "error",
    reason: "Missing required Unit Sale Price"
  });
  expect(classify({ readableId: "GEAR-20", unitSalePrice: "abc" })).toEqual({
    action: "error",
    reason: "Unit Sale Price must be a number of 0 or more"
  });
});

it("never inserts a sale price row", () => {
  expect(classify({ readableId: "GEAR-21", unitSalePrice: "5" })).toEqual({
    action: "error",
    reason: "Item GEAR-21 rev 0 has no sale price record"
  });
});

it("refuses the item's second row in the file", () => {
  expect(
    classify({ readableId: "GEAR-20", unitSalePrice: "5" }, new Set(["item-1"]))
  ).toEqual({
    action: "error",
    reason: "Duplicate sale price for GEAR-20 rev 0 in file"
  });
});
