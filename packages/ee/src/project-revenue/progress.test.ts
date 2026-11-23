// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import { describe, expect, it } from "vitest";
import {
  lossProvisionBalance,
  percentCompletePrice,
  percentCompleteRevenue
} from "./progress";

const costPlus = {
  billingMethod: "Cost Plus" as const,
  scheduledTotal: 0,
  feePercent: 0.08,
  ceilingAmount: null
};

describe("Percent Complete", () => {
  it("earns 27,000.00 of a 108,000.00 Cost Plus price at 25,000.00 of a 100,000.00 EAC", () => {
    const price = percentCompletePrice({
      ...costPlus,
      estimateAtCompletion: 100000
    });
    expect(price).toBe(108000);
    expect(
      percentCompleteRevenue({
        price,
        estimateAtCompletion: 100000,
        actualToDate: 25000,
        recognizedToDate: 0
      })
    ).toEqual({ progress: 0.25, earnedToDate: 27000, month: 27000 });
  });

  it("catches up 16,200.00 when the EAC rises to 120,000.00 at 40,000.00 actual", () => {
    const price = percentCompletePrice({
      ...costPlus,
      estimateAtCompletion: 120000
    });
    expect(price).toBe(129600);
    const result = percentCompleteRevenue({
      price,
      estimateAtCompletion: 120000,
      actualToDate: 40000,
      recognizedToDate: 27000
    });
    expect(result.earnedToDate).toBe(43200);
    expect(result.month).toBe(16200);
  });

  it("caps a Cost Plus price at the ceiling", () => {
    expect(
      percentCompletePrice({
        ...costPlus,
        estimateAtCompletion: 120000,
        ceilingAmount: 115000
      })
    ).toBe(115000);
  });

  it("provides 6,000.00 for a 10,000.00 forecast loss at 40 % progress", () => {
    expect(
      lossProvisionBalance({
        price: 100000,
        estimateAtCompletion: 110000,
        progress: 0.4
      })
    ).toBe(6000);
  });

  it("carries no provision at 100 % progress", () => {
    expect(
      lossProvisionBalance({
        price: 100000,
        estimateAtCompletion: 110000,
        progress: 1
      })
    ).toBe(0);
  });

  it("reads 0 progress with no EAC and no cost", () => {
    expect(
      percentCompleteRevenue({
        price: 100000,
        estimateAtCompletion: 0,
        actualToDate: 0,
        recognizedToDate: 0
      })
    ).toEqual({ progress: 0, earnedToDate: 0, month: 0 });
  });
});
