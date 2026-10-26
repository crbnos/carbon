// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { toDisplayCredit, toDisplayDebit } from "@carbon/utils";
import { parseDate } from "@internationalized/date";
import { describe, expect, it } from "vitest";
import {
  acquisitionLines,
  activationCutoverDates,
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
  generalLedgerCounterparty,
  getLastDayOfMonth,
  getMacrsPercentage,
  getMonthsBetween,
  getMonthsElapsed,
  getNextPeriodEnd,
  getNextRevenueRecognitionPeriodEnd,
  hasAccountingCutover,
  isFutureRunPeriod,
  monthEndOf,
  runPostingTargets,
  straightLineShortfall,
  usageKey
} from "./accounting.utils";

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

describe("computeDisposalGainLoss", () => {
  // A gain is a credit to the disposal account (stored negative), a loss a
  // debit (stored positive).
  it.each([
    ["a gain", 1000, 600, 400, -400],
    ["a loss", 250, 600, -350, 350],
    ["nothing at NBV", 600, 600, 0, 0],
    ["a scrap as a full loss of NBV", 0, 800, -800, 800]
  ])("books %s", (_, proceeds, nbv, gainLoss, disposalStoredAmount) => {
    expect(computeDisposalGainLoss(proceeds, nbv)).toEqual({
      gainLoss,
      disposalStoredAmount
    });
  });
});

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
});

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

// Months counted inclusively: a partial month at the start counts once the
// end day reaches the start day.
it.each([
  ["2025-01-15", "2025-01-20", 1],
  ["2025-01-20", "2025-01-15", 0],
  ["2024-11-01", "2025-02-01", 4],
  ["2025-06-01", "2025-01-01", 0]
])("getMonthsBetween(%s, %s) is %d", (start, end, months) => {
  expect(getMonthsBetween(parseDate(start), parseDate(end))).toBe(months);
});

it.each([
  ["2025-01-15", "2025-01-20", 0],
  ["2025-01-01", "2025-04-01", 3],
  ["2025-06-01", "2025-01-01", 0]
])("getMonthsElapsed(%s, %s) is %d", (start, end, months) => {
  expect(getMonthsElapsed(parseDate(start), parseDate(end))).toBe(months);
});

// A 31st must land on the 1st of the next month: overflowing "Sep 31" into
// Oct 1 left September with no depreciation after an August run.
it.each([
  ["2025-01-15", "2025-02-01"],
  ["2025-12-15", "2026-01-01"],
  ["2026-08-31", "2026-09-01"],
  ["2026-01-31", "2026-02-01"]
])("addOneMonth(%s) is %s", (date, next) => {
  expect(addOneMonth(date).toString()).toBe(next);
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

it.each([
  [2025, 1, "2025-02-28"],
  [2024, 1, "2024-02-29"],
  [2025, 0, "2025-01-31"]
])("getLastDayOfMonth(%d, %d) is %s", (year, monthIndex, expected) => {
  expect(getLastDayOfMonth(year, monthIndex)).toBe(expected);
});

describe("getNextPeriodEnd", () => {
  it("returns the month end after the previous period, across a year", () => {
    expect(getNextPeriodEnd("2025-01-31")).toBe("2025-02-28");
    expect(getNextPeriodEnd("2025-12-31")).toBe("2026-01-31");
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

describe("getMacrsPercentage", () => {
  it.each([
    ["27.5", 1, "Half-Year", undefined, null],
    ["39", 1, "Half-Year", undefined, null],
    ["5", 1, "Half-Year", undefined, 20],
    ["7", 1, "Half-Year", undefined, 14.29],
    ["3", 10, "Half-Year", undefined, 0],
    ["5", 1, "Mid-Quarter", 1, 35],
    ["7", 1, "Mid-Quarter", 4, 3.57]
  ] as const)(
    "%s-year property, year %d, %s (quarter %s) is %s%%",
    (propertyClass, year, convention, quarter, expected) => {
      expect(getMacrsPercentage(propertyClass, year, convention, quarter)).toBe(
        expected
      );
    }
  );

  it("half-year 5-year table sums to ~100%", () => {
    let total = 0;
    for (let y = 1; y <= 6; y++) {
      total += getMacrsPercentage("5", y, "Half-Year") ?? 0;
    }
    expect(total).toBeCloseTo(100, 0);
  });
});

describe("calculateMacrsDepreciation", () => {
  const macrs = (
    overrides: Partial<Parameters<typeof calculateMacrsDepreciation>[0]>
  ) =>
    calculateMacrsDepreciation({
      adjustedBasis: 100000,
      propertyClass: "5",
      convention: "Half-Year",
      depreciationStartDate: "2025-01-15",
      periodEnd: "2025-12-31",
      lastPostedPeriodEnd: null,
      accumulatedTaxDepreciation: 0,
      bonusAmount: 0,
      decimalPlaces: 2,
      ...overrides
    });

  it("returns 0 for zero basis", () => {
    expect(macrs({ adjustedBasis: 0 })).toBe(0);
  });

  it("takes the 20% year-1 percentage of a 5-year half-year asset", () => {
    expect(macrs({})).toBe(20000);
  });

  it("depreciates 39-year property straight line from mid-month", () => {
    // 468,000 / (39 × 12) = 1,000 a month; Jan 15 to Dec 31 is 11.5 months.
    expect(macrs({ adjustedBasis: 468000, propertyClass: "39" })).toBe(11500);
  });

  it("caps 39-year property at what is left of the basis", () => {
    expect(
      macrs({
        adjustedBasis: 468000,
        propertyClass: "39",
        accumulatedTaxDepreciation: 467000
      })
    ).toBe(1000);
  });
});

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
      expect(calculateDepreciation(baseAsset, "2025-06-30", null, 2)).toBe(
        10800
      );
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

    it("takes double the straight-line rate on the opening book value", () => {
      // 60 months = 20%/yr straight line, doubled to 40%/yr: 120,000 × 40% / 12.
      expect(calculateDepreciation(dbAsset, "2025-01-31", null, 2)).toBe(4000);
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

    it("spreads year 1 evenly over the months from January", () => {
      // 20,000 over Jan–Dec; through May is 5/12 of it.
      expect(calculateTaxDepreciation(macrsAsset, "2025-05-31", null, 2)).toBe(
        8333.33
      );
    });

    it("takes only the next month once the first month is posted", () => {
      // Placed in May: year 1's 20,000 spreads over May–Dec, 2,500 a month.
      expect(
        calculateTaxDepreciation(
          {
            ...macrsAsset,
            depreciationStartDate: "2026-05-24",
            acquisitionDate: "2026-05-24",
            accumulatedTaxDepreciation: 2500
          },
          "2026-06-30",
          "2026-05-31",
          2
        )
      ).toBe(2500);
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
      // Year 2 MACRS only: 32% of the 40,000 basis left after the bonus.
      expect(result).toBe(12800);
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
      expect(result).toBe(12000);
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

    it("compounds the doubled rate month by month", () => {
      // 40%/yr monthly is 1/30: 100,000 × (1 − (29/30)^12).
      expect(calculateTaxDepreciation(dbTaxAsset, "2025-12-31", null, 2)).toBe(
        33423.51
      );
    });

    it("returns 0 when fully depreciated", () => {
      const fullyDepr = { ...dbTaxAsset, accumulatedTaxDepreciation: 90000 };
      const result = calculateTaxDepreciation(fullyDepr, "2025-12-31", null, 2);
      expect(result).toBe(0);
    });
  });
});

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

  it("returns one line per month with book and tax amounts when tax is enabled", () => {
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
    // Book 108,000 / 60 = 1,800 a month; tax MACRS 20% of 120,000 over 12.
    expect(
      lines.every((line) => line.amount === 1800 && line.taxAmount === 2000)
    ).toBe(true);
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
    expect(lines).toHaveLength(12);
    expect(
      lines.every((line) => line.amount === 0 && line.taxAmount === 2000)
    ).toBe(true);
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
    // 1/30 of the opening value each month: 120,000, 116,000, 112,133.33.
    expect(lines.map((line) => line.amount)).toEqual([4000, 3866.67, 3737.78]);
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
    // 20% of the 60,000 basis spread over April–December, 1,333.33 a month;
    // each month takes cumulative-to-date less what is taken, so the cent
    // lands in May.
    expect(lines.map((line) => line.taxAmount)).toEqual([
      61333.33, 1333.34, 1333.33
    ]);
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

describe("activationCutoverDates", () => {
  const today = parseDate("2026-10-09");

  it("defaults to the first day of the current period", () => {
    expect(activationCutoverDates(null, today, 3)).toEqual({
      cutoverDate: "2026-10-01",
      earliestCutoverDate: "2026-07-01",
      latestCutoverDate: "2026-10-01"
    });
  });

  it("takes a calendar date from the search param", () => {
    expect(activationCutoverDates("2026-08-01", today, 3).cutoverDate).toBe(
      "2026-08-01"
    );
  });

  it("keeps a date outside the range, for the readiness check to refuse", () => {
    expect(activationCutoverDates("2026-03-15", today, 3).cutoverDate).toBe(
      "2026-03-15"
    );
  });

  it("ignores a param that is not a calendar date", () => {
    for (const param of ["", "2026-8-1", "2026-02-30", "tomorrow", "2026-08"]) {
      expect(activationCutoverDates(param, today, 3).cutoverDate).toBe(
        "2026-10-01"
      );
    }
  });

  it("crosses a year boundary going back", () => {
    expect(
      activationCutoverDates(null, parseDate("2026-02-28"), 3)
        .earliestCutoverDate
    ).toBe("2025-11-01");
  });
});

describe("hasAccountingCutover", () => {
  it("is true only with a cutover date", () => {
    expect(hasAccountingCutover({ accountingCutoverDate: "2026-10-01" })).toBe(
      true
    );
    expect(hasAccountingCutover({ accountingCutoverDate: null })).toBe(false);
    expect(hasAccountingCutover(null)).toBe(false);
  });
});

describe("generalLedgerCounterparty", () => {
  const document = {
    invoiceNumber: null,
    supplierInvoiceNumber: null,
    customerId: null,
    supplierId: null,
    merchantName: null
  };
  const documents = new Map([
    ["si1", { ...document, invoiceNumber: "INV000012", customerId: "cust1" }],
    [
      "pi1",
      {
        ...document,
        invoiceNumber: "PI000007",
        supplierInvoiceNumber: "ACME-4471",
        supplierId: "sup1"
      }
    ],
    ["pay1", { ...document, customerId: "cust1" }],
    ["ch1", { ...document, merchantName: "Hardware Store" }]
  ]);
  const partyNames = new Map([
    ["cust1", "Orbital Corp"],
    ["sup1", "Acme Metals"]
  ]);
  const line = (
    documentType: string | null,
    documentId: string | null,
    documentLineReference: string | null = null
  ) => ({ documentType, documentId, documentLineReference });

  it("names a sales invoice's customer and number", () => {
    expect(
      generalLedgerCounterparty(line("Invoice", "si1"), documents, partyNames)
    ).toEqual({
      party: "Orbital Corp",
      invoiceNumber: "INV000012",
      supplierInvoiceNumber: null
    });
  });

  it("names a purchase invoice's supplier and both numbers", () => {
    expect(
      generalLedgerCounterparty(line("Invoice", "pi1"), documents, partyNames)
    ).toEqual({
      party: "Acme Metals",
      invoiceNumber: "PI000007",
      supplierInvoiceNumber: "ACME-4471"
    });
  });

  it("reads a payment line's invoice from its line reference", () => {
    expect(
      generalLedgerCounterparty(
        line("Payment", "pay1", "si1"),
        documents,
        partyNames
      )
    ).toEqual({
      party: "Orbital Corp",
      invoiceNumber: "INV000012",
      supplierInvoiceNumber: null
    });
  });

  it("falls back to a charge's merchant when it has no supplier", () => {
    expect(
      generalLedgerCounterparty(line("Charge", "ch1"), documents, partyNames)
    ).toEqual({
      party: "Hardware Store",
      invoiceNumber: null,
      supplierInvoiceNumber: null
    });
  });

  it("leaves a line with no document blank", () => {
    expect(
      generalLedgerCounterparty(line(null, null), documents, partyNames)
    ).toEqual({
      party: null,
      invoiceNumber: null,
      supplierInvoiceNumber: null
    });
    expect(
      generalLedgerCounterparty(
        line("Job Receipt", "job1"),
        documents,
        partyNames
      )
    ).toEqual({
      party: null,
      invoiceNumber: null,
      supplierInvoiceNumber: null
    });
  });
});
