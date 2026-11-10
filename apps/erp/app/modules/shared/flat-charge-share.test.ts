// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it, vi } from "vitest";

// shared.utils' graph loads @carbon/content/glossary, whose module-load Lingui
// `msg` macro is not transformed under plain vitest.
vi.mock("@carbon/content/glossary", () => ({
  terms: {},
  getEntry: vi.fn(),
  lookupEntry: vi.fn(),
  hasEntry: vi.fn(),
  termSlug: vi.fn()
}));

const { flatChargeShare } = await import("./shared.utils");

/** Bills `charge` over invoices of the given quantities, the way a conversion does. */
function billInParts(charge: number, ordered: number, parts: number[]) {
  let billed = 0;
  let invoiced = 0;
  return parts.map((quantity) => {
    const share = flatChargeShare({
      charge,
      billed,
      quantity,
      remainingQuantity: ordered - invoiced,
      orderedQuantity: ordered,
      decimals: 2
    });
    billed += share;
    invoiced += quantity;
    return share;
  });
}

describe("flatChargeShare", () => {
  it("bills a charge once across partial invoices", () => {
    expect(billInParts(50, 10, [4, 6])).toEqual([20, 30]);
  });

  it("rounds each share to the currency and gives the last the remainder", () => {
    const shares = billInParts(50, 3, [1, 1, 1]);
    expect(shares).toEqual([16.67, 16.67, 16.66]);
    expect(shares.reduce((a, b) => a + b, 0)).toBeCloseTo(50, 10);
  });

  it("bills the whole charge on a full invoice", () => {
    expect(billInParts(50, 10, [10])).toEqual([50]);
  });

  it("bills only what an earlier invoice left after it was edited", () => {
    // Invoice A billed all 50 for 10, then was edited down to 4; B bills 6.
    expect(
      flatChargeShare({
        charge: 50,
        billed: 50,
        quantity: 6,
        remainingQuantity: 6,
        orderedQuantity: 10,
        decimals: 2
      })
    ).toBe(0);
  });

  it("bills the whole charge when no quantity was ordered", () => {
    expect(
      flatChargeShare({
        charge: 50,
        billed: 0,
        quantity: 1,
        remainingQuantity: 0,
        orderedQuantity: 0,
        decimals: 2
      })
    ).toBe(50);
  });

  it("bills a negative charge (a credit) the same way", () => {
    expect(billInParts(-30, 3, [1, 2])).toEqual([-10, -20]);
  });
});
