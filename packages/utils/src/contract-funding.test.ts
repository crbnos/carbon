// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import {
  allocateToAcrns,
  parseLineItemNumber,
  sumFunding
} from "./contract-funding";

const acrns = (billedAA: number, billedAB: number) => [
  {
    acrn: "AB",
    firstFundedDate: "2026-03-01",
    funded: 30_000,
    billed: billedAB
  },
  {
    acrn: "AA",
    firstFundedDate: "2026-01-15",
    funded: 50_000,
    billed: billedAA
  }
];

describe("parseLineItemNumber", () => {
  it("reads a CLIN, a priced SLIN and an informational SLIN", () => {
    expect(parseLineItemNumber("0001")).toEqual({
      clin: "0001",
      suffix: null,
      type: "CLIN"
    });
    expect(parseLineItemNumber("0001AA")).toEqual({
      clin: "0001",
      suffix: "AA",
      type: "Priced SLIN"
    });
    expect(parseLineItemNumber("000101")).toEqual({
      clin: "0001",
      suffix: "01",
      type: "Informational SLIN"
    });
    expect(parseLineItemNumber("001")).toBeNull();
  });
});

describe("sumFunding", () => {
  it("sums the funding actions of a line", () => {
    expect(
      sumFunding([
        { fundedCost: 50_000, fundedFee: 0 },
        { fundedCost: 30_000, fundedFee: 0 }
      ])
    ).toEqual({ fundedCost: 80_000, fundedAmount: 80_000 });
  });
});

describe("allocateToAcrns", () => {
  it("fills the oldest ACRN first", () => {
    expect(allocateToAcrns(60_000, acrns(0, 0))).toEqual({
      allocations: [
        { acrn: "AA", amount: 50_000 },
        { acrn: "AB", amount: 10_000 }
      ],
      unallocated: 0
    });
  });

  it("takes only the remainder of a partly billed ACRN", () => {
    expect(allocateToAcrns(10_000, acrns(45_000, 0))).toEqual({
      allocations: [
        { acrn: "AA", amount: 5_000 },
        { acrn: "AB", amount: 5_000 }
      ],
      unallocated: 0
    });
  });

  it("leaves what the funding does not cover unallocated", () => {
    expect(allocateToAcrns(90_000, acrns(0, 0))).toEqual({
      allocations: [
        { acrn: "AA", amount: 50_000 },
        { acrn: "AB", amount: 30_000 }
      ],
      unallocated: 10_000
    });
  });

  it("takes a credit back from the newest ACRN first", () => {
    expect(allocateToAcrns(-5_000, acrns(50_000, 10_000))).toEqual({
      allocations: [{ acrn: "AB", amount: -5_000 }],
      unallocated: 0
    });
  });
});
