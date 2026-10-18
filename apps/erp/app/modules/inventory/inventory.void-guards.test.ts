// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { findVoidShortfalls } from "./inventory.service";

const at = (
  storageUnitId: string | null,
  trackedEntityId: string | null = null
) => ({ itemId: "item", locationId: "loc", storageUnitId, trackedEntityId });

const key = (
  storageUnitId: string | null,
  trackedEntityId: string | null = null
) => ["item", "loc", storageUnitId ?? "", trackedEntityId ?? ""].join("|");

describe("findVoidShortfalls", () => {
  it("passes when the received stock is still in its bin", () => {
    expect(
      findVoidShortfalls(
        [{ ...at("A1", "lot"), quantity: -4 }],
        new Map([[key("A1", "lot"), 4]])
      )
    ).toEqual([]);
  });

  it("refuses a lot that moved to another bin", () => {
    expect(
      findVoidShortfalls(
        [{ ...at("A1", "lot"), quantity: -4 }],
        new Map([
          [key("A1", "lot"), 0],
          [key("B2", "lot"), 4]
        ])
      )
    ).toEqual([{ ...at("A1", "lot"), required: 4, onHand: 0 }]);
  });

  it("checks a serial on its own, whatever else the bin holds", () => {
    expect(
      findVoidShortfalls(
        [{ ...at("A1", "sn-1"), quantity: -1 }],
        new Map([
          [key("A1", "sn-1"), 0],
          [key("A1", "sn-2"), 1],
          [key("A1"), 30]
        ])
      )
    ).toHaveLength(1);
  });

  it("adds up two lines of one item that went into the same bin", () => {
    expect(
      findVoidShortfalls(
        [
          { ...at("A1"), quantity: -3 },
          { ...at("A1"), quantity: -3 }
        ],
        new Map([[key("A1"), 5]])
      )
    ).toEqual([{ ...at("A1"), required: 6, onHand: 5 }]);
  });

  it("needs nothing for a row that puts stock back", () => {
    expect(
      findVoidShortfalls([{ ...at(null), quantity: 2 }], new Map())
    ).toEqual([]);
  });
});
