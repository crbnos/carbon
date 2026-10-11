// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import { describe, expect, it } from "vitest";
import { priceCostPlusItem } from "./pricing";

describe("priceCostPlusItem", () => {
  it("bills 1,000.00 of labor over 10 h at fee 8 % as 1,080.00", () => {
    expect(
      priceCostPlusItem({
        costType: "Labor",
        cost: 1000,
        hours: 10,
        feePercent: 0.08
      })
    ).toEqual({ quantity: 10, unitPrice: 108, amount: 1080 });
  });

  it("bills a 500.00 overhead row at fee 8 % as 540.00", () => {
    expect(
      priceCostPlusItem({
        costType: "Overhead",
        cost: 500,
        hours: null,
        feePercent: 0.08
      })
    ).toEqual({ quantity: 1, unitPrice: 540, amount: 540 });
  });
});
