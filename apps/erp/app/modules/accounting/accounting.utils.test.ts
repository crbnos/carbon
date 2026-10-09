// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { toDisplayCredit, toDisplayDebit } from "@carbon/utils";
import { parseDate } from "@internationalized/date";
import { describe, expect, it } from "vitest";
import {
  acquisitionLines,
  addOneMonth,
  buildDepreciationLines,
  calculateDepreciation,
  calculateMacrsDepreciation,
  calculateTaxDepreciation,
  computeDisposalGainLoss,
  depreciationFloor,
  depreciationRunLineDisplay,
  depreciationRunLinesMatch,
  diffJournalLines,
  getLastDayOfMonth,
  getMacrsPercentage,
  getMonthsBetween,
  getMonthsElapsed,
  getNextPeriodEnd,
  getNextRevenueRecognitionPeriodEnd,
  isFutureRunPeriod,
  monthEndOf,
  runPostingTargets,
  straightLineShortfall,
  usageKey
} from "./accounting.utils";

// ---------------------------------------------------------------------------
// Acquisition (registration opening entry)
// ---------------------------------------------------------------------------

describe("acquisitionLines", () => {
  // Map each line's role to the account class its amount is stored against, so
  // we can assert the entry balances (display debits === display credits).
  const roleClass = {
    asset: "Asset",
    accumulatedDepreciation: "Asset",
    offset: "Equity"
  } as const;

  const totals = (lines: ReturnType<typeof acquisitionLines>) =>
    lines.reduce(
      (acc, line) => {
        const cls = roleClass[line.role];
        acc.debit += toDisplayDebit(line.amount, cls);
        acc.credit += toDisplayCredit(line.amount, cls);
        return acc;
      },
      { debit: 0, credit: 0 }
    );

  it("emits the original two-line entry when there is no prior depreciation", () => {
    const lines = acquisitionLines(100000);
    expect(lines).toHaveLength(2);
    // Dr Fixed Asset at gross cost, Cr owner equity at full cost (NBV === cost)
    expect(lines[0]).toMatchObject({ role: "asset", amount: 100000 });
    expect(lines[1]).toMatchObject({ role: "offset", amount: 100000 });

    const { debit, credit } = totals(lines);
    expect(debit).toBe(100000);
    expect(credit).toBe(100000);
  });

  it("defaults accumulatedDepreciation to 0 (backward compatible)", () => {
    expect(acquisitionLines(50000)).toEqual(acquisitionLines(50000, 0));
  });

  it("emits a three-line entry crediting opening accumulated depreciation", () => {
    // cost 100k, prior accum dep 40k → NBV 60k
    const lines = acquisitionLines(100000, 40000);
    expect(lines).toHaveLength(3);
    expect(lines[0]).toMatchObject({ role: "asset", amount: 100000 });
    // credit to a natural-debit (Asset contra) account is stored negative
    expect(lines[1]).toMatchObject({
      role: "accumulatedDepreciation",
      amount: -40000
    });
    // owner equity is credited only the net book value, not gross cost
    expect(lines[2]).toMatchObject({ role: "offset", amount: 60000 });

    const { debit, credit } = totals(lines);
    // Dr 100k === Cr (40k accum dep + 60k equity)
    expect(debit).toBe(100000);
    expect(credit).toBe(100000);
  });

  it("allows accumulated depreciation equal to acquisition cost (NBV 0)", () => {
    const lines = acquisitionLines(100000, 100000);
    const { debit, credit } = totals(lines);
    expect(debit).toBe(100000);
    expect(credit).toBe(100000);
  });

  it("throws when accumulated depreciation exceeds acquisition cost", () => {
    expect(() => acquisitionLines(100000, 120000)).toThrow(
      /Accumulated depreciation cannot exceed/
    );
  });
});

// ---------------------------------------------------------------------------
// Disposal gain/loss
// ---------------------------------------------------------------------------

describe("computeDisposalGainLoss", () => {
  it("books a gain as a credit (negative stored amount) to the disposal account", () => {
    // proceeds 1000, NBV 600 → gain 400 credited (income)
    const { gainLoss, disposalStoredAmount } = computeDisposalGainLoss(
      1000,
      600
    );
    expect(gainLoss).toBe(400);
    expect(disposalStoredAmount).toBe(-400);
  });

  it("books a loss as a debit (positive stored amount) to the disposal account", () => {
    // proceeds 250, NBV 600 → loss 350 debited (expense)
    const { gainLoss, disposalStoredAmount } = computeDisposalGainLoss(
      250,
      600
    );
    expect(gainLoss).toBe(-350);
    expect(disposalStoredAmount).toBe(350);
  });

  it("returns a zero stored amount when proceeds equal NBV (no line needed)", () => {
    const { gainLoss, disposalStoredAmount } = computeDisposalGainLoss(
      600,
      600
    );
    expect(gainLoss).toBe(0);
    expect(disposalStoredAmount).toBe(0);
  });

  it("treats a scrap (zero proceeds) as a full loss of the net book value", () => {
    const { gainLoss, disposalStoredAmount } = computeDisposalGainLoss(0, 800);
    expect(gainLoss).toBe(-800);
    expect(disposalStoredAmount).toBe(800);
  });
});

// ---------------------------------------------------------------------------
// Depreciation-run line display (NBV After)
// ---------------------------------------------------------------------------

describe("depreciationRunLineDisplay", () => {
  it("starts a later month from the earlier months of the same run", () => {
    // Two months of 1,800 on a 120,000 asset with 10,000 already depreciated.
    const draftSecond = depreciationRunLineDisplay({
      acquisitionCost: 120000,
      accumulatedDepreciation: 10000,
      amount: 1800,
      isPosted: false,
      earlierAmount: 1800,
      runAmount: 3600
    });
    const postedSecond = depreciationRunLineDisplay({
      acquisitionCost: 120000,
      accumulatedDepreciation: 13600,
      amount: 1800,
      isPosted: true,
      earlierAmount: 1800,
      runAmount: 3600
    });
    const expected = {
      accumulatedDepreciationBefore: 11800,
      netBookValueAfter: 106400
    };
    expect(draftSecond).toEqual(expected);
    expect(postedSecond).toEqual(expected);
  });

  // cost 100k, 20k already depreciated, this run adds 4k → NBV after = 76k.
  const cost = 100_000;
  const amount = 4_000;
  const priorAccumulated = 20_000;

  it("computes accumulated-before and NBV-after for a Draft run", () => {
    // Draft: the asset's live accumulated depreciation is still the pre-run
    // balance (this run has not posted yet).
    const { accumulatedDepreciationBefore, netBookValueAfter } =
      depreciationRunLineDisplay({
        acquisitionCost: cost,
        accumulatedDepreciation: priorAccumulated,
        amount,
        isPosted: false
      });
    expect(accumulatedDepreciationBefore).toBe(20_000);
    expect(netBookValueAfter).toBe(76_000);
  });

  it("shows the same figures once Posted (no double-count of the amount)", () => {
    // After posting, postDepreciationRun has folded this run's amount into the
    // asset's accumulated depreciation (20k + 4k = 24k). NBV After must stay
    // 76k — the pre-posting value — not drop to 72k.
    const { accumulatedDepreciationBefore, netBookValueAfter } =
      depreciationRunLineDisplay({
        acquisitionCost: cost,
        accumulatedDepreciation: priorAccumulated + amount,
        amount,
        isPosted: true
      });
    expect(accumulatedDepreciationBefore).toBe(20_000);
    expect(netBookValueAfter).toBe(76_000);
  });

  it("keeps the row arithmetic cost − accumulated − amount = NBV after", () => {
    for (const isPosted of [false, true]) {
      const accumulatedDepreciation = isPosted
        ? priorAccumulated + amount
        : priorAccumulated;
      const { accumulatedDepreciationBefore, netBookValueAfter } =
        depreciationRunLineDisplay({
          acquisitionCost: cost,
          accumulatedDepreciation,
          amount,
          isPosted
        });
      expect(cost - accumulatedDepreciationBefore - amount).toBe(
        netBookValueAfter
      );
    }
  });
});

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------

describe("depreciationRunLinesMatch", () => {
  const P = "2026-09-30";
  const computed = [
    { fixedAssetId: "fa1", periodEnd: P, amount: 100, taxAmount: null },
    { fixedAssetId: "fa2", periodEnd: P, amount: 50.5, taxAmount: null }
  ];

  it("matches the same assets and amounts in any order, numeric strings included", () => {
    expect(
      depreciationRunLinesMatch(
        [
          {
            fixedAssetId: "fa2",
            periodEnd: P,
            amount: "50.50",
            taxAmount: null
          },
          { fixedAssetId: "fa1", periodEnd: P, amount: 100, taxAmount: null }
        ],
        computed
      )
    ).toBe(true);
  });

  it("is stale when an asset was disposed since the draft", () => {
    expect(
      depreciationRunLinesMatch(
        [
          ...computed,
          { fixedAssetId: "fa3", periodEnd: P, amount: 10, taxAmount: null }
        ],
        computed
      )
    ).toBe(false);
  });

  it("is stale when an asset was added since the draft", () => {
    expect(depreciationRunLinesMatch(computed.slice(0, 1), computed)).toBe(
      false
    );
  });

  it("is stale when an amount changed", () => {
    expect(
      depreciationRunLinesMatch(
        [computed[0], { ...computed[1], amount: 40 }],
        computed
      )
    ).toBe(false);
  });

  it("is stale when tax depreciation was switched on or the tax amount moved", () => {
    const taxed = computed.map((line) => ({ ...line, taxAmount: 80 }));
    expect(depreciationRunLinesMatch(computed, taxed)).toBe(false);
    expect(
      depreciationRunLinesMatch(
        taxed.map((line) => ({ ...line, taxAmount: 70 })),
        taxed
      )
    ).toBe(false);
    expect(depreciationRunLinesMatch(taxed, taxed)).toBe(true);
  });

  it("is stale when the same asset's line is for a different month", () => {
    expect(
      depreciationRunLinesMatch(
        [computed[0], { ...computed[1], periodEnd: "2026-08-31" }],
        computed
      )
    ).toBe(false);
  });
});

describe("isFutureRunPeriod", () => {
  it("allows the current month and earlier ones", () => {
    expect(isFutureRunPeriod("2026-10-31", "2026-10-04")).toBe(false);
    expect(isFutureRunPeriod("2026-09-30", "2026-10-04")).toBe(false);
  });

  it("refuses a month that has not started", () => {
    expect(isFutureRunPeriod("2026-11-30", "2026-10-04")).toBe(true);
  });
});

describe("monthEndOf", () => {
  it("returns the last day of the date's month, leap years included", () => {
    expect(monthEndOf("2026-10-04")).toBe("2026-10-31");
    expect(monthEndOf("2024-02-10T12:00:00Z")).toBe("2024-02-29");
  });
});

describe("runPostingTargets", () => {
  it("posts each month in its own period, and a Closed month in the run's", () => {
    expect(
      runPostingTargets({
        months: ["2026-08-31", "2026-09-30", "2026-10-31"],
        runPeriodEnd: "2026-10-31",
        closedMonths: new Set(["2026-08-31"])
      })
    ).toEqual(
      new Map([
        ["2026-08-31", "2026-10-31"],
        ["2026-09-30", "2026-09-30"],
        ["2026-10-31", "2026-10-31"]
      ])
    );
  });
});

describe("getMonthsBetween", () => {
  it("returns 1 for same month when end day >= start day", () => {
    expect(
      getMonthsBetween(parseDate("2025-01-15"), parseDate("2025-01-20"))
    ).toBe(1);
  });

  it("returns 0 when end day < start day in same month", () => {
    expect(
      getMonthsBetween(parseDate("2025-01-20"), parseDate("2025-01-15"))
    ).toBe(0);
  });

  it("counts months across years", () => {
    expect(
      getMonthsBetween(parseDate("2024-11-01"), parseDate("2025-02-01"))
    ).toBe(4);
  });

  it("returns 0 for start after end", () => {
    expect(
      getMonthsBetween(parseDate("2025-06-01"), parseDate("2025-01-01"))
    ).toBe(0);
  });
});

describe("getMonthsElapsed", () => {
  it("returns 0 for same month", () => {
    expect(
      getMonthsElapsed(parseDate("2025-01-15"), parseDate("2025-01-20"))
    ).toBe(0);
  });

  it("counts elapsed months", () => {
    expect(
      getMonthsElapsed(parseDate("2025-01-01"), parseDate("2025-04-01"))
    ).toBe(3);
  });

  it("returns 0 when start after end", () => {
    expect(
      getMonthsElapsed(parseDate("2025-06-01"), parseDate("2025-01-01"))
    ).toBe(0);
  });
});

describe("addOneMonth", () => {
  it("advances to first of next month", () => {
    expect(addOneMonth("2025-01-15").toString()).toBe("2025-02-01");
  });

  it("rolls over year boundary", () => {
    expect(addOneMonth("2025-12-15").toString()).toBe("2026-01-01");
  });

  // Aug 31 + 1 month used to overflow "Sep 31" into Oct 1, so September got
  // no depreciation after an August run.
  it("advances a 31st into a shorter month without skipping it", () => {
    expect(addOneMonth("2026-08-31").toString()).toBe("2026-09-01");
    expect(addOneMonth("2026-01-31").toString()).toBe("2026-02-01");
  });
});

describe("month arithmetic after a posted run", () => {
  const straightLine = {
    acquisitionCost: 120000,
    accumulatedDepreciation: 0,
    residualValuePercent: 10,
    depreciationMethod: "Straight Line",
    usefulLifeMonths: 60,
    depreciationStartDate: "2025-01-01",
    acquisitionDate: "2025-01-01",
    assetLifetimeUsage: null
  };

  it("charges every month after a run for a 31-day month", () => {
    for (const [lastPosted, periodEnd] of [
      ["2026-01-31", "2026-02-28"],
      ["2026-03-31", "2026-04-30"],
      ["2026-05-31", "2026-06-30"],
      ["2026-08-31", "2026-09-30"],
      ["2026-10-31", "2026-11-30"]
    ]) {
      expect(
        calculateDepreciation(straightLine, periodEnd, lastPosted, 2)
      ).toBe(1800);
    }
  });

  it("takes a Jan 1 MACRS asset's year-1 percentage in January, whatever the server's timezone", () => {
    // 5-year half-year property: year 1 is 20%, spread over Jan–Dec.
    expect(
      calculateMacrsDepreciation({
        adjustedBasis: 120000,
        propertyClass: "5",
        convention: "Half-Year",
        depreciationStartDate: "2025-01-01",
        periodEnd: "2025-01-31",
        lastPostedPeriodEnd: null,
        accumulatedTaxDepreciation: 0,
        bonusAmount: 0,
        decimalPlaces: 2
      })
    ).toBe(2000);
  });
});

describe("getLastDayOfMonth", () => {
  it("returns 28 for Feb 2025", () => {
    expect(getLastDayOfMonth(2025, 1)).toBe("2025-02-28");
  });

  it("returns 29 for Feb 2024 (leap year)", () => {
    expect(getLastDayOfMonth(2024, 1)).toBe("2024-02-29");
  });

  it("returns 31 for January", () => {
    expect(getLastDayOfMonth(2025, 0)).toBe("2025-01-31");
  });
});

describe("getNextPeriodEnd", () => {
  it("returns next month's last day when given a previous period", () => {
    const result = getNextPeriodEnd("2025-01-31");
    expect(result).toBe("2025-02-28");
  });

  it("handles year rollover", () => {
    const result = getNextPeriodEnd("2025-12-31");
    expect(result).toBe("2026-01-31");
  });

  it("defaults to the end of the current month of the given business date", () => {
    expect(getNextPeriodEnd(null, "2026-02-10")).toBe("2026-02-28");
    expect(getNextPeriodEnd(null, "2024-02-01")).toBe("2024-02-29");
  });
});

describe("getNextRevenueRecognitionPeriodEnd", () => {
  it("returns the month end after the last run", () => {
    expect(getNextRevenueRecognitionPeriodEnd("2026-09-30", "2026-11-03")).toBe(
      "2026-10-31"
    );
    expect(getNextRevenueRecognitionPeriodEnd("2025-12-31", "2026-03-01")).toBe(
      "2026-01-31"
    );
  });

  it("defaults to the month just closed, not the month in progress", () => {
    expect(getNextRevenueRecognitionPeriodEnd(null, "2026-11-01")).toBe(
      "2026-10-31"
    );
    expect(getNextRevenueRecognitionPeriodEnd(null, "2026-01-15")).toBe(
      "2025-12-31"
    );
    expect(getNextRevenueRecognitionPeriodEnd(null, "2026-03-31")).toBe(
      "2026-02-28"
    );
  });

  // A month that has not started cannot run, so after a run for the current
  // month the default stays on it — a second run picks up rows that fell due
  // after the first posted.
  it("never proposes a month that has not started", () => {
    expect(getNextRevenueRecognitionPeriodEnd("2026-10-31", "2026-10-04")).toBe(
      "2026-10-31"
    );
    expect(getNextRevenueRecognitionPeriodEnd("2026-09-30", "2026-10-04")).toBe(
      "2026-10-31"
    );
  });
});

// ---------------------------------------------------------------------------
// MACRS table lookups
// ---------------------------------------------------------------------------

describe("getMacrsPercentage", () => {
  it("returns null for 27.5-year property", () => {
    expect(getMacrsPercentage("27.5", 1, "Half-Year")).toBeNull();
  });

  it("returns null for 39-year property", () => {
    expect(getMacrsPercentage("39", 1, "Half-Year")).toBeNull();
  });

  it("returns correct half-year 5-year year-1 percentage", () => {
    expect(getMacrsPercentage("5", 1, "Half-Year")).toBe(20.0);
  });

  it("returns correct half-year 7-year year-1 percentage", () => {
    expect(getMacrsPercentage("7", 1, "Half-Year")).toBe(14.29);
  });

  it("returns 0 when year exceeds table length", () => {
    expect(getMacrsPercentage("3", 10, "Half-Year")).toBe(0);
  });

  it("returns correct mid-quarter Q1 5-year year-1 percentage", () => {
    expect(getMacrsPercentage("5", 1, "Mid-Quarter", 1)).toBe(35.0);
  });

  it("returns correct mid-quarter Q4 7-year year-1 percentage", () => {
    expect(getMacrsPercentage("7", 1, "Mid-Quarter", 4)).toBe(3.57);
  });

  it("half-year 5-year table sums to ~100%", () => {
    let total = 0;
    for (let y = 1; y <= 6; y++) {
      total += getMacrsPercentage("5", y, "Half-Year") ?? 0;
    }
    expect(total).toBeCloseTo(100, 0);
  });
});

// ---------------------------------------------------------------------------
// calculateMacrsDepreciation
// ---------------------------------------------------------------------------

describe("calculateMacrsDepreciation", () => {
  it("returns 0 for zero basis", () => {
    expect(
      calculateMacrsDepreciation({
        adjustedBasis: 0,
        propertyClass: "5",
        convention: "Half-Year",
        depreciationStartDate: "2025-01-15",
        periodEnd: "2025-12-31",
        lastPostedPeriodEnd: null,
        accumulatedTaxDepreciation: 0,
        bonusAmount: 0,
        decimalPlaces: 2
      })
    ).toBe(0);
  });

  it("calculates year-1 half-year 5-year depreciation on $100,000 asset", () => {
    const result = calculateMacrsDepreciation({
      adjustedBasis: 100000,
      propertyClass: "5",
      convention: "Half-Year",
      depreciationStartDate: "2025-01-15",
      periodEnd: "2025-12-31",
      lastPostedPeriodEnd: null,
      accumulatedTaxDepreciation: 0,
      bonusAmount: 0,
      decimalPlaces: 2
    });
    // Year 1 at 20% of $100k = $20,000
    expect(result).toBe(20000);
  });

  it("calculates 39-year property monthly depreciation", () => {
    const result = calculateMacrsDepreciation({
      adjustedBasis: 468000,
      propertyClass: "39",
      convention: "Half-Year",
      depreciationStartDate: "2025-01-15",
      periodEnd: "2025-12-31",
      lastPostedPeriodEnd: null,
      accumulatedTaxDepreciation: 0,
      bonusAmount: 0,
      decimalPlaces: 2
    });
    // $468,000 / (39*12) = $1,000/month; 11.5 months for first period
    expect(result).toBeCloseTo(11500, -1);
  });

  it("caps at remaining depreciable amount", () => {
    const result = calculateMacrsDepreciation({
      adjustedBasis: 10000,
      propertyClass: "5",
      convention: "Half-Year",
      depreciationStartDate: "2025-01-15",
      periodEnd: "2025-12-31",
      lastPostedPeriodEnd: null,
      accumulatedTaxDepreciation: 9500,
      bonusAmount: 0,
      decimalPlaces: 2
    });
    expect(result).toBeLessThanOrEqual(500);
  });
});

// ---------------------------------------------------------------------------
// calculateDepreciation (book)
// ---------------------------------------------------------------------------

describe("calculateDepreciation", () => {
  const baseAsset = {
    acquisitionCost: 120000,
    accumulatedDepreciation: 0,
    residualValuePercent: 10,
    depreciationMethod: "Straight Line",
    usefulLifeMonths: 60,
    depreciationStartDate: "2025-01-01",
    acquisitionDate: "2025-01-01",
    assetLifetimeUsage: null
  };

  describe("Straight Line", () => {
    it("calculates monthly depreciation correctly", () => {
      // Cost 120k, residual 10% = 12k, depreciable = 108k, monthly = 1800
      // Jan 1 to Jan 31 = 1 month
      const result = calculateDepreciation(baseAsset, "2025-01-31", null, 2);
      expect(result).toBe(1800);
    });

    it("calculates multi-month period", () => {
      // 6 months: 1800 * 6 = 10800
      const result = calculateDepreciation(baseAsset, "2025-06-30", null, 2);
      expect(result).toBeCloseTo(10800, 0);
    });

    it("returns 0 when fully depreciated", () => {
      const fullyDepr = { ...baseAsset, accumulatedDepreciation: 108000 };
      expect(calculateDepreciation(fullyDepr, "2025-06-30", null, 2)).toBe(0);
    });

    it("returns 0 when start date is after period end", () => {
      const futureStart = { ...baseAsset, depreciationStartDate: "2026-01-01" };
      expect(calculateDepreciation(futureStart, "2025-06-30", null, 2)).toBe(0);
    });

    it("caps at remaining depreciable amount", () => {
      const nearlyDone = { ...baseAsset, accumulatedDepreciation: 107500 };
      const result = calculateDepreciation(nearlyDone, "2025-06-30", null, 2);
      expect(result).toBe(500);
    });

    it("uses lastPostedPeriodEnd to narrow the window", () => {
      // After a Jan 31 run, a Mar 31 run covers February and March. This
      // test used to expect one month: Jan 31 + 1 month overflowed to Mar 1.
      const result = calculateDepreciation(
        baseAsset,
        "2025-03-31",
        "2025-01-31",
        2
      );
      expect(result).toBe(3600);
    });
  });

  describe("Declining Balance", () => {
    const dbAsset = { ...baseAsset, depreciationMethod: "Declining Balance" };

    it("first month produces higher amount than straight line", () => {
      const slResult = calculateDepreciation(baseAsset, "2025-01-31", null, 2);
      const dbResult = calculateDepreciation(dbAsset, "2025-01-31", null, 2);
      expect(dbResult).toBeGreaterThanOrEqual(slResult);
    });

    it("returns 0 when fully depreciated", () => {
      const fullyDepr = { ...dbAsset, accumulatedDepreciation: 108000 };
      expect(calculateDepreciation(fullyDepr, "2025-06-30", null, 2)).toBe(0);
    });
  });

  describe("Units of Production", () => {
    const uopAsset = {
      ...baseAsset,
      depreciationMethod: "Units of Production",
      assetLifetimeUsage: 10000
    };

    it("calculates based on units produced", () => {
      // depreciable 108k / 10k units = $10.80/unit, 100 units = $1080
      const result = calculateDepreciation(uopAsset, "2025-06-30", null, 2, {
        unitsProduced: 100
      });
      expect(result).toBe(1080);
    });

    it("returns 0 without usage log", () => {
      expect(calculateDepreciation(uopAsset, "2025-06-30", null, 2)).toBe(0);
    });

    it("returns 0 with zero lifetime usage", () => {
      const zeroLifetime = { ...uopAsset, assetLifetimeUsage: 0 };
      expect(
        calculateDepreciation(zeroLifetime, "2025-06-30", null, 2, {
          unitsProduced: 100
        })
      ).toBe(0);
    });
  });

  it("returns 0 for unknown method", () => {
    const unknown = { ...baseAsset, depreciationMethod: "SomethingElse" };
    expect(calculateDepreciation(unknown, "2025-06-30", null, 2)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// calculateTaxDepreciation
// ---------------------------------------------------------------------------

describe("calculateTaxDepreciation", () => {
  it("returns null when no tax method configured", () => {
    const result = calculateTaxDepreciation(
      {
        acquisitionCost: 100000,
        accumulatedTaxDepreciation: 0,
        depreciationStartDate: "2025-01-01",
        acquisitionDate: "2025-01-01",
        taxDepreciationMethod: null,
        taxUsefulLifeMonths: null,
        taxResidualValuePercent: null,
        macrsPropertyClass: null,
        macrsConvention: null,
        bonusDepreciationPercent: null
      },
      "2025-12-31",
      null,
      2
    );
    expect(result).toBeNull();
  });

  describe("MACRS", () => {
    const macrsAsset = {
      acquisitionCost: 100000,
      accumulatedTaxDepreciation: 0,
      depreciationStartDate: "2025-01-15",
      acquisitionDate: "2025-01-15",
      taxDepreciationMethod: "MACRS",
      taxUsefulLifeMonths: null,
      taxResidualValuePercent: null,
      macrsPropertyClass: "5",
      macrsConvention: "Half-Year",
      bonusDepreciationPercent: 0
    };

    it("calculates year-1 MACRS without bonus", () => {
      const result = calculateTaxDepreciation(
        macrsAsset,
        "2025-12-31",
        null,
        2
      );
      // 5-year half-year year 1: 20% of $100k = $20,000
      expect(result).toBe(20000);
    });

    it("calculates MACRS for a single-month period (how depreciation runs work)", () => {
      const result = calculateTaxDepreciation(
        macrsAsset,
        "2025-05-31",
        null,
        2
      );
      expect(result).not.toBeNull();
      expect(result!).toBeGreaterThan(0);
    });

    it("calculates MACRS for second monthly period with lastPostedPeriodEnd", () => {
      // Asset placed 2026-05-24, first run posted with periodEnd 2026-05-31
      // Second run for periodEnd 2026-06-30
      const result = calculateTaxDepreciation(
        {
          ...macrsAsset,
          depreciationStartDate: "2026-05-24",
          acquisitionDate: "2026-05-24"
        },
        "2026-06-30",
        "2026-05-31",
        2
      );
      expect(result).not.toBeNull();
      expect(result!).toBeGreaterThan(0);
    });

    it("handles null bonusDepreciationPercent (DB default)", () => {
      const nullBonus = {
        ...macrsAsset,
        bonusDepreciationPercent: null
      };
      const result = calculateTaxDepreciation(nullBonus, "2025-12-31", null, 2);
      expect(result).toBe(20000);
    });

    it("applies bonus depreciation in first period", () => {
      const withBonus = {
        ...macrsAsset,
        bonusDepreciationPercent: 60
      };
      const result = calculateTaxDepreciation(withBonus, "2025-12-31", null, 2);
      // Bonus: 100k * 60% = 60k
      // Adjusted basis: 40k, MACRS year 1: 40k * 20% = 8k
      // Total: 60k + 8k = 68k
      expect(result).toBe(68000);
    });

    it("does not re-apply bonus after first period", () => {
      const withBonus = {
        ...macrsAsset,
        accumulatedTaxDepreciation: 68000,
        bonusDepreciationPercent: 60
      };
      const result = calculateTaxDepreciation(
        withBonus,
        "2026-12-31",
        "2025-12-31",
        2
      );
      // Bonus should NOT be applied again (accumulatedTax > 0)
      // Only MACRS on the $40k adjusted basis
      expect(result).not.toBeNull();
      expect(result!).toBeGreaterThan(0);
      expect(result!).toBeLessThan(60000);
    });

    it("handles 100% bonus depreciation", () => {
      const fullBonus = {
        ...macrsAsset,
        bonusDepreciationPercent: 100
      };
      const result = calculateTaxDepreciation(fullBonus, "2025-12-31", null, 2);
      // Bonus = 100k, adjusted basis = 0, MACRS on 0 = 0
      // Total = 100k
      expect(result).toBe(100000);
    });

    it("handles 7-year property class", () => {
      const sevenYear = {
        ...macrsAsset,
        macrsPropertyClass: "7"
      };
      const result = calculateTaxDepreciation(sevenYear, "2025-12-31", null, 2);
      // 7-year half-year year 1: 14.29% of $100k = $14,290
      expect(result).toBe(14290);
    });
  });

  describe("Straight Line (tax)", () => {
    const slTaxAsset = {
      acquisitionCost: 120000,
      accumulatedTaxDepreciation: 0,
      depreciationStartDate: "2025-01-01",
      acquisitionDate: "2025-01-01",
      taxDepreciationMethod: "Straight Line",
      taxUsefulLifeMonths: 120,
      taxResidualValuePercent: 0,
      macrsPropertyClass: null,
      macrsConvention: null,
      bonusDepreciationPercent: null
    };

    it("calculates tax straight-line depreciation", () => {
      // $120k / 120 months = $1k/month; Jan to Dec = 12 months = $12k
      const result = calculateTaxDepreciation(
        slTaxAsset,
        "2025-12-31",
        null,
        2
      );
      expect(result).toBeCloseTo(12000, 0);
    });

    it("returns 0 when fully depreciated", () => {
      const fullyDepr = { ...slTaxAsset, accumulatedTaxDepreciation: 120000 };
      const result = calculateTaxDepreciation(fullyDepr, "2025-12-31", null, 2);
      expect(result).toBe(0);
    });
  });

  describe("Declining Balance (tax)", () => {
    const dbTaxAsset = {
      acquisitionCost: 100000,
      accumulatedTaxDepreciation: 0,
      depreciationStartDate: "2025-01-01",
      acquisitionDate: "2025-01-01",
      taxDepreciationMethod: "Declining Balance",
      taxUsefulLifeMonths: 60,
      taxResidualValuePercent: 10,
      macrsPropertyClass: null,
      macrsConvention: null,
      bonusDepreciationPercent: null
    };

    it("produces a positive result", () => {
      const result = calculateTaxDepreciation(
        dbTaxAsset,
        "2025-12-31",
        null,
        2
      );
      expect(result).not.toBeNull();
      expect(result!).toBeGreaterThan(0);
    });

    it("returns 0 when fully depreciated", () => {
      const fullyDepr = { ...dbTaxAsset, accumulatedTaxDepreciation: 90000 };
      const result = calculateTaxDepreciation(fullyDepr, "2025-12-31", null, 2);
      expect(result).toBe(0);
    });
  });
});

// ---------------------------------------------------------------------------
// buildDepreciationLines
// ---------------------------------------------------------------------------

describe("buildDepreciationLines", () => {
  const baseAsset = {
    id: "asset-1",
    acquisitionCost: 120000,
    accumulatedDepreciation: 0,
    residualValuePercent: 10,
    depreciationMethod: "Straight Line",
    usefulLifeMonths: 60,
    depreciationStartDate: "2025-01-01",
    acquisitionDate: "2025-01-01",
    assetLifetimeUsage: null,
    accumulatedTaxDepreciation: 0,
    taxDepreciationMethod: "MACRS",
    taxUsefulLifeMonths: null,
    taxResidualValuePercent: null,
    macrsPropertyClass: "5",
    macrsConvention: "Half-Year",
    bonusDepreciationPercent: 0
  };

  const total = (lines: { amount: number; taxAmount: number | null }[]) =>
    lines.reduce<{ amount: number; taxAmount: number }>(
      (sum, line) => ({
        amount: sum.amount + line.amount,
        taxAmount: sum.taxAmount + (line.taxAmount ?? 0)
      }),
      { amount: 0, taxAmount: 0 }
    );

  it("returns one line per month, each with book and tax amounts when tax is enabled", () => {
    const lines = buildDepreciationLines(
      [baseAsset],
      "2025-12-31",
      null,
      true,
      new Map(),
      2
    );
    expect(lines).toHaveLength(12);
    expect(lines.map((line) => line.periodEnd)).toEqual([
      "2025-01-31",
      "2025-02-28",
      "2025-03-31",
      "2025-04-30",
      "2025-05-31",
      "2025-06-30",
      "2025-07-31",
      "2025-08-31",
      "2025-09-30",
      "2025-10-31",
      "2025-11-30",
      "2025-12-31"
    ]);
    for (const line of lines) {
      expect(line.amount).toBeGreaterThan(0);
      expect(line.taxAmount!).toBeGreaterThan(0);
    }
  });

  it("returns null taxAmount when tax is disabled", () => {
    const lines = buildDepreciationLines(
      [baseAsset],
      "2025-12-31",
      null,
      false,
      new Map(),
      2
    );
    expect(lines).toHaveLength(12);
    expect(lines.every((line) => line.taxAmount === null)).toBe(true);
  });

  it("skips assets with zero depreciation", () => {
    const fullyDepr = {
      ...baseAsset,
      accumulatedDepreciation: 108000,
      accumulatedTaxDepreciation: 120000
    };
    const lines = buildDepreciationLines(
      [fullyDepr],
      "2025-12-31",
      null,
      true,
      new Map(),
      2
    );
    expect(lines).toHaveLength(0);
  });

  it("includes line when only tax amount is positive", () => {
    const bookDone = {
      ...baseAsset,
      accumulatedDepreciation: 108000,
      accumulatedTaxDepreciation: 0
    };
    const lines = buildDepreciationLines(
      [bookDone],
      "2025-12-31",
      null,
      true,
      new Map(),
      2
    );
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.every((line) => line.amount === 0)).toBe(true);
    expect(total(lines).taxAmount).toBeGreaterThan(0);
  });

  it("handles multiple assets", () => {
    const asset2 = { ...baseAsset, id: "asset-2" };
    const lines = buildDepreciationLines(
      [baseAsset, asset2],
      "2025-12-31",
      null,
      true,
      new Map(),
      2
    );
    expect(lines).toHaveLength(24);
    expect(new Set(lines.map((line) => line.fixedAssetId))).toEqual(
      new Set(["asset-1", "asset-2"])
    );
  });

  it("book vs tax difference: MACRS produces more year-1 depreciation than SL", () => {
    const lines = buildDepreciationLines(
      [baseAsset],
      "2025-12-31",
      null,
      true,
      new Map(),
      2
    );
    // Book SL: 108k/60mo * 12mo = $21,600
    // Tax MACRS 5-yr HY: 120k * 20% = $24,000
    expect(total(lines)).toEqual({ amount: 21600, taxAmount: 24000 });
  });

  it("splits a 3-month straight-line catch-up into 3 equal months", () => {
    const lines = buildDepreciationLines(
      [baseAsset],
      "2025-12-31",
      "2025-09-30",
      false,
      new Map(),
      2
    );
    expect(
      lines.map(({ periodEnd, amount }) => ({ periodEnd, amount }))
    ).toEqual([
      { periodEnd: "2025-10-31", amount: 1800 },
      { periodEnd: "2025-11-30", amount: 1800 },
      { periodEnd: "2025-12-31", amount: 1800 }
    ]);
  });

  it("declines month by month on declining balance", () => {
    const lines = buildDepreciationLines(
      [{ ...baseAsset, depreciationMethod: "Declining Balance" }],
      "2025-03-31",
      null,
      false,
      new Map(),
      2
    );
    expect(lines).toHaveLength(3);
    expect(lines[1].amount).toBeLessThan(lines[0].amount);
    expect(lines[2].amount).toBeLessThan(lines[1].amount);
  });

  it("charges units of production only in the months with logged usage", () => {
    const lines = buildDepreciationLines(
      [
        {
          ...baseAsset,
          depreciationMethod: "Units of Production",
          assetLifetimeUsage: 10000
        }
      ],
      "2025-03-31",
      null,
      false,
      new Map([
        [usageKey("asset-1", "2025-01-31"), 100],
        [usageKey("asset-1", "2025-03-31"), 50]
      ]),
      2
    );
    // 108,000 / 10,000 units = 10.80 a unit.
    expect(
      lines.map(({ periodEnd, amount }) => ({ periodEnd, amount }))
    ).toEqual([
      { periodEnd: "2025-01-31", amount: 1080 },
      { periodEnd: "2025-03-31", amount: 540 }
    ]);
  });

  it("takes MACRS bonus depreciation in the first month only", () => {
    const lines = buildDepreciationLines(
      [{ ...baseAsset, bonusDepreciationPercent: 50 }],
      "2025-03-31",
      null,
      true,
      new Map(),
      2
    );
    // Bonus 60,000 in January, then 20% of the 60,000 basis over 12 months.
    expect(lines.map((line) => line.taxAmount)).toEqual([61000, 1000, 1000]);
  });

  it("never depreciates before an asset placed in service after the last posted run", () => {
    const lines = buildDepreciationLines(
      [
        {
          ...baseAsset,
          depreciationStartDate: "2025-04-15",
          acquisitionDate: "2025-04-15",
          bonusDepreciationPercent: 50
        }
      ],
      "2025-06-30",
      "2025-01-31",
      true,
      new Map(),
      2
    );
    // Nothing for February or March: the bonus lands in April, the month the
    // asset went into service, not in the month after the last posted run.
    expect(lines.map((line) => line.periodEnd)).toEqual([
      "2025-04-30",
      "2025-05-31",
      "2025-06-30"
    ]);
    expect(lines[0].taxAmount).toBeGreaterThanOrEqual(60000);
    expect(lines.slice(1).every((line) => line.taxAmount! < 60000)).toBe(true);
  });
});

describe("diffJournalLines", () => {
  const stored = [
    {
      id: "jl_a",
      accountId: "acct_cash",
      description: "Rent",
      amount: 1000,
      dimensions: [{ dimensionId: "dim_loc", valueId: "loc_hq" }]
    },
    {
      id: "jl_b",
      accountId: "acct_rent",
      description: null,
      amount: -1000,
      dimensions: []
    }
  ];

  it("keeps lines nothing changed on, and deletes nothing", () => {
    const { changes, deleteIds } = diffJournalLines(stored, [
      {
        id: "jl_a",
        accountId: "acct_cash",
        description: "Rent",
        amount: 1000,
        dimensions: [{ dimensionId: "dim_loc", valueId: "loc_hq" }]
      },
      {
        id: "jl_b",
        accountId: "acct_rent",
        description: "",
        amount: -1000,
        dimensions: []
      }
    ]);
    expect(changes.map((c) => c.op)).toEqual(["keep", "keep"]);
    expect(changes.every((c) => !c.dimensionsChanged)).toBe(true);
    expect(deleteIds).toEqual([]);
  });

  it("updates a line in place when its account, description or amount changes", () => {
    const { changes } = diffJournalLines(stored, [
      {
        id: "jl_a",
        accountId: "acct_cash",
        description: "Office rent",
        amount: 1000,
        dimensions: stored[0].dimensions
      },
      {
        id: "jl_b",
        accountId: "acct_other",
        description: null as unknown as string,
        amount: -1000,
        dimensions: []
      }
    ]);
    expect(changes.map((c) => [c.op, c.id])).toEqual([
      ["update", "jl_a"],
      ["update", "jl_b"]
    ]);
  });

  it("ignores float noise in amounts", () => {
    const { changes } = diffJournalLines(stored.slice(0, 1), [
      {
        id: "jl_a",
        accountId: "acct_cash",
        description: "Rent",
        amount: 1000.0000000001,
        dimensions: stored[0].dimensions
      }
    ]);
    expect(changes[0].op).toBe("keep");
  });

  it("inserts a line with no id or an unknown id, and deletes stored lines not submitted", () => {
    const { changes, deleteIds } = diffJournalLines(stored, [
      {
        id: "jl_a",
        accountId: "acct_cash",
        description: "Rent",
        amount: 1000,
        dimensions: stored[0].dimensions
      },
      { accountId: "acct_fee", amount: 5, dimensions: [] },
      {
        id: "client-xyz",
        accountId: "acct_fee",
        amount: -5,
        dimensions: [{ dimensionId: "d", valueId: "v" }]
      }
    ]);
    expect(changes.map((c) => c.op)).toEqual(["keep", "insert", "insert"]);
    expect(changes[1].dimensionsChanged).toBe(false);
    expect(changes[2].dimensionsChanged).toBe(true);
    expect(deleteIds).toEqual(["jl_b"]);
  });

  it("matches a stored id once — a repeat is inserted, never a second update of the same row", () => {
    const { changes, deleteIds } = diffJournalLines(stored, [
      {
        id: "jl_a",
        accountId: "acct_cash",
        description: "Rent",
        amount: 1000,
        dimensions: stored[0].dimensions
      },
      {
        id: "jl_a",
        accountId: "acct_cash",
        description: "Rent",
        amount: 1000,
        dimensions: stored[0].dimensions
      }
    ]);
    expect(changes.map((c) => [c.op, c.id])).toEqual([
      ["keep", "jl_a"],
      ["insert", undefined]
    ]);
    expect(deleteIds).toEqual(["jl_b"]);
  });

  it("flags a dimension change regardless of order, and only a real change", () => {
    const twoDims = [
      { dimensionId: "d1", valueId: "v1" },
      { dimensionId: "d2", valueId: "v2" }
    ];
    const withDims = [{ ...stored[1], dimensions: twoDims }];
    const reordered = diffJournalLines(withDims, [
      {
        id: "jl_b",
        accountId: "acct_rent",
        amount: -1000,
        dimensions: [...twoDims].reverse()
      }
    ]);
    expect(reordered.changes[0].dimensionsChanged).toBe(false);

    const changed = diffJournalLines(withDims, [
      {
        id: "jl_b",
        accountId: "acct_rent",
        amount: -1000,
        dimensions: [twoDims[0]]
      }
    ]);
    expect(changed.changes[0]).toMatchObject({
      op: "keep",
      dimensionsChanged: true
    });
  });

  it("replaces every line for a caller that sends no ids", () => {
    const { changes, deleteIds } = diffJournalLines(stored, [
      { accountId: "acct_cash", amount: 1000, dimensions: [] },
      { accountId: "acct_rent", amount: -1000, dimensions: [] }
    ]);
    expect(changes.map((c) => c.op)).toEqual(["insert", "insert"]);
    expect(deleteIds).toEqual(["jl_a", "jl_b"]);
  });
});

describe("cost adjustment catch-up", () => {
  // Capitalized at zero on Jan 1, depreciated (at nothing) through March,
  // then raised to 6,000: 100 a month over 60 months.
  const adjusted = {
    id: "asset-adjusted",
    acquisitionCost: 6000,
    accumulatedDepreciation: 0,
    residualValuePercent: 0,
    depreciationMethod: "Straight Line",
    usefulLifeMonths: 60,
    depreciationStartDate: "2025-01-01",
    acquisitionDate: "2025-01-01",
    assetLifetimeUsage: null,
    accumulatedTaxDepreciation: 0,
    taxDepreciationMethod: "Straight Line",
    taxUsefulLifeMonths: 36,
    taxResidualValuePercent: 0,
    macrsPropertyClass: null,
    macrsConvention: null,
    bonusDepreciationPercent: null,
    costAdjusted: true
  };

  it("adds the months taken at the old cost to the run's first month", () => {
    const lines = buildDepreciationLines(
      [adjusted],
      "2025-05-31",
      "2025-03-31",
      true,
      new Map(),
      2
    );
    expect(lines).toEqual([
      // 100 for April + 300 for Jan–Mar; tax 6,000 / 36 = 166.67 a month.
      {
        fixedAssetId: "asset-adjusted",
        periodEnd: "2025-04-30",
        amount: 400,
        taxAmount: 666.67
      },
      {
        fixedAssetId: "asset-adjusted",
        periodEnd: "2025-05-31",
        amount: 100,
        taxAmount: 166.67
      }
    ]);
  });

  it("catches up once: the next run is back on schedule", () => {
    const lines = buildDepreciationLines(
      [
        {
          ...adjusted,
          accumulatedDepreciation: 500,
          accumulatedTaxDepreciation: 833.34
        }
      ],
      "2025-06-30",
      "2025-05-31",
      true,
      new Map(),
      2
    );
    expect(lines.map((line) => [line.amount, line.taxAmount])).toEqual([
      [100, 166.67]
    ]);
  });

  it("leaves an asset without a cost adjustment on its usual schedule", () => {
    const lines = buildDepreciationLines(
      [{ ...adjusted, costAdjusted: false }],
      "2025-04-30",
      "2025-03-31",
      false,
      new Map(),
      2
    );
    expect(lines.map((line) => line.amount)).toEqual([100]);
  });

  it("never takes back depreciation from an asset ahead of schedule", () => {
    expect(
      straightLineShortfall({
        acquisitionCost: 6000,
        residualValuePercent: 0,
        usefulLifeMonths: 60,
        startDate: "2025-01-01",
        through: "2025-03-31",
        accumulated: 1000,
        decimalPlaces: 2
      })
    ).toEqual(0);
  });

  it("is nothing before the asset's first month has been depreciated", () => {
    expect(
      straightLineShortfall({
        acquisitionCost: 6000,
        residualValuePercent: 0,
        usefulLifeMonths: 60,
        startDate: "2025-04-01",
        through: "2025-03-31",
        accumulated: 0,
        decimalPlaces: 2
      })
    ).toEqual(0);
  });

  it("never catches up past the depreciable base", () => {
    const lines = buildDepreciationLines(
      [
        {
          ...adjusted,
          residualValuePercent: 20,
          usefulLifeMonths: 12,
          depreciationStartDate: "2024-01-01",
          acquisitionDate: "2024-01-01",
          taxDepreciationMethod: null
        }
      ],
      "2025-04-30",
      "2025-03-31",
      false,
      new Map(),
      2
    );
    // 6,000 less a 20 % residual is 4,800 — all of it, in one line.
    expect(lines.map((line) => line.amount)).toEqual([4800]);
  });
});

describe("depreciationFloor", () => {
  it("starts a company with no posted run at its accounting cutover", () => {
    expect(depreciationFloor(null, "2026-10-01")).toBe("2026-09-30");
  });

  it("keeps a run posted after the cutover", () => {
    expect(depreciationFloor("2026-11-30", "2026-10-01")).toBe("2026-11-30");
  });

  it("moves a run posted before the cutover up to the cutover", () => {
    expect(depreciationFloor("2026-03-31", "2026-10-01")).toBe("2026-09-30");
  });

  it("changes nothing for a company with no cutover", () => {
    expect(depreciationFloor("2026-03-31", null)).toBe("2026-03-31");
    expect(depreciationFloor(null, null)).toBeNull();
  });
});
