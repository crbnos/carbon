// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import { describe, expect, it } from "vitest";
import {
  buildPbpRequest,
  computeSf1443,
  expectedLiquidation,
  lossRatio,
  PBP_CAP_EXCEEDED,
  PBP_NOTHING_TO_BILL,
  type PbpEvent,
  rateOn,
  type Sf1443Input,
  unliquidatedBalance
} from "./compute";

const base: Sf1443Input = {
  contractPrice: 1_000_000,
  progressPaymentRate: 0.8,
  liquidationRate: 0.8,
  eligibleCost: 300_000,
  incurredCost: 300_000,
  estimateToComplete: 500_000,
  previousRequested: 0,
  deliveredPrice: 0,
  liquidated: 0
};

describe("computeSf1443", () => {
  it("requests 80 % of eligible cost before any delivery", () => {
    const { lines, hasSection3, lossRatio } = computeSf1443(base);
    expect(hasSection3).toBe(false);
    expect(lossRatio).toBe(1);
    expect(lines["13"]).toBe(240_000);
    expect(lines["16"]).toBe(800_000);
    expect(lines["17"]).toBe(240_000);
    expect(lines["19"]).toBe(240_000);
    expect(lines["26"]).toBe(240_000);
  });

  it("keeps unallowable cost in 12a and out of 11", () => {
    const { lines } = computeSf1443({ ...base, incurredCost: 310_000 });
    expect(lines["11"]).toBe(300_000);
    expect(lines["12a"]).toBe(310_000);
    expect(lines["26"]).toBe(240_000);
  });

  it("subtracts the earlier requests", () => {
    const { lines } = computeSf1443({ ...base, previousRequested: 200_000 });
    expect(lines["19"]).toBe(40_000);
    expect(lines["26"]).toBe(40_000);
  });

  it("applies the loss ratio of the FAR 32.503-6(g) example", () => {
    const { lines, lossRatio: ratio } = computeSf1443({
      ...base,
      contractPrice: 3_000_000,
      eligibleCost: 2_700_000,
      incurredCost: 2_700_000,
      estimateToComplete: 900_000
    });
    expect(ratio).toBeCloseTo(0.83333, 5);
    expect(lines["12c"]).toBe(3_600_000);
    // 2,700,000 × (3,000,000 ÷ 3,600,000) × 0.8. FAR rounds the ratio to
    // 83.3 % and gets 1,799,280; Carbon keeps the exact ratio.
    expect(lines["13"]).toBe(1_800_000);
  });

  it("limits the request by Section III once items are delivered", () => {
    const { lines, hasSection3 } = computeSf1443({
      ...base,
      eligibleCost: 500_000,
      incurredCost: 500_000,
      previousRequested: 300_000,
      deliveredPrice: 200_000,
      liquidated: 160_000
    });
    expect(hasSection3).toBe(true);
    // 20a suggested = 500,000 × 200,000 ÷ 1,000,000.
    expect(lines["20a"]).toBe(100_000);
    expect(lines["20c"]).toBe(320_000);
    expect(lines["21c"]).toBe(640_000);
    expect(lines["22"]).toBe(320_000);
    expect(lines["24"]).toBe(140_000);
    expect(lines["25"]).toBe(180_000);
    expect(lines["19"]).toBe(100_000);
    expect(lines["26"]).toBe(100_000);
  });

  it("lets an override of 20a feed the later lines", () => {
    const { lines } = computeSf1443({
      ...base,
      eligibleCost: 500_000,
      incurredCost: 500_000,
      deliveredPrice: 200_000,
      overrides: { "20a": 150_000 }
    });
    expect(lines["20a"]).toBe(150_000);
    expect(lines["20b"]).toBe(350_000);
    expect(lines["20c"]).toBe(280_000);
  });

  it("rounds every line to whole dollars", () => {
    const { lines } = computeSf1443({
      ...base,
      eligibleCost: 1234.56,
      incurredCost: 1234.56
    });
    expect(lines["11"]).toBe(1235);
    expect(lines["13"]).toBe(988);
  });
});

describe("lossRatio", () => {
  it("is 1 while the estimate stays within the price", () => {
    expect(lossRatio(100, 40, 60)).toBe(1);
    expect(lossRatio(100, 60, 60)).toBeCloseTo(0.83333, 5);
  });
});

describe("rateOn", () => {
  const rates = [
    {
      effectiveDate: "2026-01-01",
      progressPaymentRate: 0.8,
      liquidationRate: 0.8
    },
    {
      effectiveDate: "2026-07-01",
      progressPaymentRate: 0.8,
      liquidationRate: 0.723
    }
  ];

  it("takes the latest rate on or before the date", () => {
    expect(rateOn(rates, "2026-06-30")?.liquidationRate).toBe(0.8);
    expect(rateOn(rates, "2026-07-01")?.liquidationRate).toBe(0.723);
    expect(rateOn(rates, "2025-12-31")).toBeNull();
  });
});

describe("expectedLiquidation", () => {
  it("takes the rate of the invoice, capped by what is unliquidated", () => {
    const input = {
      liquidationRate: 0.8,
      invoiceAmount: 100_000,
      unliquidated: 240_000,
      earlierExpected: 0,
      currencyDecimals: 2
    };
    expect(expectedLiquidation(input)).toBe(80_000);
    expect(expectedLiquidation({ ...input, unliquidated: 50_000 })).toBe(
      50_000
    );
    expect(expectedLiquidation({ ...input, earlierExpected: 230_000 })).toBe(
      10_000
    );
    expect(expectedLiquidation({ ...input, earlierExpected: 300_000 })).toBe(0);
  });
});

describe("unliquidatedBalance", () => {
  it("is the deposits less their applications", () => {
    expect(unliquidatedBalance([240_000, 40_000], [80_000])).toBe(200_000);
  });
});

describe("buildPbpRequest", () => {
  const events: PbpEvent[] = [
    {
      id: "e1",
      sequence: 1,
      eventType: "Cumulative",
      amount: 100_000,
      completedDate: null
    },
    {
      id: "e2",
      sequence: 2,
      eventType: "Cumulative",
      amount: 200_000,
      completedDate: "2026-09-01"
    },
    {
      id: "e3",
      sequence: 3,
      eventType: "Severable",
      amount: 50_000,
      completedDate: "2026-09-02"
    }
  ];
  const input = {
    events,
    billedEventIds: new Set<string>(),
    contractPrice: 1_000_000,
    maximumShare: 0.9,
    previousBilled: 0,
    incurredCost: 420_000
  };

  it("bills a Cumulative event only after every earlier event", () => {
    const request = buildPbpRequest(input);
    expect(request).toEqual({
      eventIds: ["e3"],
      values: { "1a": 0, "1b": 50_000, "1c": 50_000, "2": 420_000 }
    });
  });

  it("bills the Cumulative event once its predecessor completes", () => {
    const request = buildPbpRequest({
      ...input,
      events: events.map((event) =>
        event.id === "e1" ? { ...event, completedDate: "2026-08-15" } : event
      ),
      billedEventIds: new Set(["e3"]),
      previousBilled: 50_000
    });
    expect(request).toEqual({
      eventIds: ["e1", "e2"],
      values: { "1a": 50_000, "1b": 300_000, "1c": 350_000, "2": 420_000 }
    });
  });

  it("refuses a request that takes the total above the maximum share", () => {
    expect(buildPbpRequest({ ...input, previousBilled: 880_000 })).toEqual({
      error: PBP_CAP_EXCEEDED
    });
  });

  it("refuses a request with nothing to bill", () => {
    expect(
      buildPbpRequest({ ...input, billedEventIds: new Set(["e3"]) })
    ).toEqual({ error: PBP_NOTHING_TO_BILL });
  });
});
