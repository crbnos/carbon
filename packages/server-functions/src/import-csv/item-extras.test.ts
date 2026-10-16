// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import {
  collectItemExtras,
  emptyItemExtras,
  itemExtrasError
} from "./item-extras";

describe("itemExtrasError", () => {
  it("accepts blank cells and numbers the columns can store", () => {
    expect(itemExtrasError({ leadTime: " 14 ", unitCost: "3.5" })).toBe(
      undefined
    );
    expect(itemExtrasError({ leadTime: "", unitCost: "" })).toBeUndefined();
  });

  it("refuses a fraction or an out-of-range value in a whole-number column", () => {
    expect(itemExtrasError({ leadTime: "2.5" })).toBe(
      "Lead Time (Days) must be a whole number"
    );
    expect(itemExtrasError({ leadTime: "2147483648" })).toBe(
      "Lead Time (Days) must be 2147483647 or less"
    );
  });

  it("refuses a value that is not a number", () => {
    expect(itemExtrasError({ unitCost: "12.50 USD" })).toBe(
      "Unit Cost must be a number"
    );
  });

  it("refuses a value below the form's minimum", () => {
    expect(itemExtrasError({ unitCost: "-1" })).toBe(
      "Unit Cost must be 0 or more"
    );
  });
});

describe("collectItemExtras", () => {
  it("queues the lead time and unit cost a row holds", () => {
    const extras = emptyItemExtras();
    collectItemExtras(extras, "item_1", { leadTime: "14", unitCost: "" });
    expect(extras).toEqual({
      purchasingLeadTimes: [{ itemId: "item_1", leadTime: "14" }],
      unitCosts: []
    });
  });
});
