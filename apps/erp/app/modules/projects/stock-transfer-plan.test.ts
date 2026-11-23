// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { paybackVariance, planBorrowMatching } from "./stock-transfer-plan";

describe("project stock transfer plan", () => {
  it("settles a payback against the open borrows in order", () => {
    expect(
      planBorrowMatching(
        [
          { id: "b1", quantity: 5, quantityPaidBack: 0, borrowedUnitCost: 10 },
          { id: "b2", quantity: 4, quantityPaidBack: 0, borrowedUnitCost: 9 }
        ],
        7
      )
    ).toEqual([
      { borrowId: "b1", quantity: 5, borrowedUnitCost: 10, paidBack: true },
      { borrowId: "b2", quantity: 2, borrowedUnitCost: 9, paidBack: false }
    ]);
  });

  it("charges the borrower the difference to the borrowed cost", () => {
    expect(paybackVariance(10, 11, 5)).toEqual(5);
    expect(paybackVariance(10, 9.5, 2)).toEqual(-1);
  });

  it("refuses a payback larger than the open borrows", () => {
    expect(() =>
      planBorrowMatching(
        [{ id: "b1", quantity: 5, quantityPaidBack: 2, borrowedUnitCost: 10 }],
        4
      )
    ).toThrow("The payback of 4 is more than the 3 still borrowed");
  });
});
