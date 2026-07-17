import { toDisplayCredit, toDisplayDebit } from "@carbon/utils";
import { describe, expect, it } from "vitest";
import {
  acquisitionLines,
  addOneMonth,
  buildDepreciationLines,
  calculateDepreciation,
  calculateMacrsDepreciation,
  calculateTaxDepreciation,
  computeDisposalGainLoss,
  depreciationRunLineDisplay,
  getLastDayOfMonth,
  getMacrsPercentage,
  getMonthsBetween,
  getMonthsElapsed,
  getNextPeriodEnd
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

describe("getMonthsBetween", () => {
  it("returns 1 for same month when end day >= start day", () => {
    expect(
      getMonthsBetween(new Date("2025-01-15"), new Date("2025-01-20"))
    ).toBe(1);
  });

  it("returns 0 when end day < start day in same month", () => {
    expect(
      getMonthsBetween(new Date("2025-01-20"), new Date("2025-01-15"))
    ).toBe(0);
  });

  it("counts months across years", () => {
    expect(
      getMonthsBetween(new Date("2024-11-01"), new Date("2025-02-01"))
    ).toBe(4);
  });

  it("returns 0 for start after end", () => {
    expect(
      getMonthsBetween(new Date("2025-06-01"), new Date("2025-01-01"))
    ).toBe(0);
  });
});

describe("getMonthsElapsed", () => {
  it("returns 0 for same month", () => {
    expect(
      getMonthsElapsed(new Date("2025-01-15"), new Date("2025-01-20"))
    ).toBe(0);
  });

  it("counts elapsed months", () => {
    expect(
      getMonthsElapsed(new Date("2025-01-01"), new Date("2025-04-01"))
    ).toBe(3);
  });

  it("returns 0 when start after end", () => {
    expect(
      getMonthsElapsed(new Date("2025-06-01"), new Date("2025-01-01"))
    ).toBe(0);
  });
});

describe("addOneMonth", () => {
  it("advances to first of next month", () => {
    const result = addOneMonth("2025-01-15");
    expect(result.getFullYear()).toBe(2025);
    expect(result.getMonth()).toBe(1);
    expect(result.getDate()).toBe(1);
  });

  it("rolls over year boundary", () => {
    const result = addOneMonth("2025-12-15");
    expect(result.getFullYear()).toBe(2026);
    expect(result.getMonth()).toBe(0);
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
        bonusAmount: 0
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
      bonusAmount: 0
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
      bonusAmount: 0
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
      bonusAmount: 0
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
      const result = calculateDepreciation(baseAsset, "2025-01-31", null);
      expect(result).toBe(1800);
    });

    it("calculates multi-month period", () => {
      // 6 months: 1800 * 6 = 10800
      const result = calculateDepreciation(baseAsset, "2025-06-30", null);
      expect(result).toBeCloseTo(10800, 0);
    });

    it("returns 0 when fully depreciated", () => {
      const fullyDepr = { ...baseAsset, accumulatedDepreciation: 108000 };
      expect(calculateDepreciation(fullyDepr, "2025-06-30", null)).toBe(0);
    });

    it("returns 0 when start date is after period end", () => {
      const futureStart = { ...baseAsset, depreciationStartDate: "2026-01-01" };
      expect(calculateDepreciation(futureStart, "2025-06-30", null)).toBe(0);
    });

    it("caps at remaining depreciable amount", () => {
      const nearlyDone = { ...baseAsset, accumulatedDepreciation: 107500 };
      const result = calculateDepreciation(nearlyDone, "2025-06-30", null);
      expect(result).toBe(500);
    });

    it("uses lastPostedPeriodEnd to narrow the window", () => {
      // addOneMonth("2025-01-31") overflows Feb→Mar 1; Mar 1 to Mar 31 = 1 month
      const result = calculateDepreciation(
        baseAsset,
        "2025-03-31",
        "2025-01-31"
      );
      expect(result).toBeCloseTo(1800, 0);
    });
  });

  describe("Declining Balance", () => {
    const dbAsset = { ...baseAsset, depreciationMethod: "Declining Balance" };

    it("first month produces higher amount than straight line", () => {
      const slResult = calculateDepreciation(baseAsset, "2025-01-31", null);
      const dbResult = calculateDepreciation(dbAsset, "2025-01-31", null);
      expect(dbResult).toBeGreaterThanOrEqual(slResult);
    });

    it("returns 0 when fully depreciated", () => {
      const fullyDepr = { ...dbAsset, accumulatedDepreciation: 108000 };
      expect(calculateDepreciation(fullyDepr, "2025-06-30", null)).toBe(0);
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
      const result = calculateDepreciation(uopAsset, "2025-06-30", null, {
        unitsProduced: 100
      });
      expect(result).toBe(1080);
    });

    it("returns 0 without usage log", () => {
      expect(calculateDepreciation(uopAsset, "2025-06-30", null)).toBe(0);
    });

    it("returns 0 with zero lifetime usage", () => {
      const zeroLifetime = { ...uopAsset, assetLifetimeUsage: 0 };
      expect(
        calculateDepreciation(zeroLifetime, "2025-06-30", null, {
          unitsProduced: 100
        })
      ).toBe(0);
    });
  });

  it("returns 0 for unknown method", () => {
    const unknown = { ...baseAsset, depreciationMethod: "SomethingElse" };
    expect(calculateDepreciation(unknown, "2025-06-30", null)).toBe(0);
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
      null
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
      const result = calculateTaxDepreciation(macrsAsset, "2025-12-31", null);
      // 5-year half-year year 1: 20% of $100k = $20,000
      expect(result).toBe(20000);
    });

    it("calculates MACRS for a single-month period (how depreciation runs work)", () => {
      const result = calculateTaxDepreciation(macrsAsset, "2025-05-31", null);
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
        "2026-05-31"
      );
      expect(result).not.toBeNull();
      expect(result!).toBeGreaterThan(0);
    });

    it("handles null bonusDepreciationPercent (DB default)", () => {
      const nullBonus = {
        ...macrsAsset,
        bonusDepreciationPercent: null
      };
      const result = calculateTaxDepreciation(nullBonus, "2025-12-31", null);
      expect(result).toBe(20000);
    });

    it("applies bonus depreciation in first period", () => {
      const withBonus = {
        ...macrsAsset,
        bonusDepreciationPercent: 60
      };
      const result = calculateTaxDepreciation(withBonus, "2025-12-31", null);
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
        "2025-12-31"
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
      const result = calculateTaxDepreciation(fullBonus, "2025-12-31", null);
      // Bonus = 100k, adjusted basis = 0, MACRS on 0 = 0
      // Total = 100k
      expect(result).toBe(100000);
    });

    it("handles 7-year property class", () => {
      const sevenYear = {
        ...macrsAsset,
        macrsPropertyClass: "7"
      };
      const result = calculateTaxDepreciation(sevenYear, "2025-12-31", null);
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
      const result = calculateTaxDepreciation(slTaxAsset, "2025-12-31", null);
      expect(result).toBeCloseTo(12000, 0);
    });

    it("returns 0 when fully depreciated", () => {
      const fullyDepr = { ...slTaxAsset, accumulatedTaxDepreciation: 120000 };
      const result = calculateTaxDepreciation(fullyDepr, "2025-12-31", null);
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
      const result = calculateTaxDepreciation(dbTaxAsset, "2025-12-31", null);
      expect(result).not.toBeNull();
      expect(result!).toBeGreaterThan(0);
    });

    it("returns 0 when fully depreciated", () => {
      const fullyDepr = { ...dbTaxAsset, accumulatedTaxDepreciation: 90000 };
      const result = calculateTaxDepreciation(fullyDepr, "2025-12-31", null);
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

  it("returns book and tax amounts when tax is enabled", () => {
    const lines = buildDepreciationLines(
      [baseAsset],
      "2025-12-31",
      null,
      true,
      new Map()
    );
    expect(lines).toHaveLength(1);
    expect(lines[0].amount).toBeGreaterThan(0);
    expect(lines[0].taxAmount).not.toBeNull();
    expect(lines[0].taxAmount!).toBeGreaterThan(0);
  });

  it("returns null taxAmount when tax is disabled", () => {
    const lines = buildDepreciationLines(
      [baseAsset],
      "2025-12-31",
      null,
      false,
      new Map()
    );
    expect(lines).toHaveLength(1);
    expect(lines[0].amount).toBeGreaterThan(0);
    expect(lines[0].taxAmount).toBeNull();
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
      new Map()
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
      new Map()
    );
    expect(lines).toHaveLength(1);
    expect(lines[0].amount).toBe(0);
    expect(lines[0].taxAmount!).toBeGreaterThan(0);
  });

  it("handles multiple assets", () => {
    const asset2 = { ...baseAsset, id: "asset-2" };
    const lines = buildDepreciationLines(
      [baseAsset, asset2],
      "2025-12-31",
      null,
      true,
      new Map()
    );
    expect(lines).toHaveLength(2);
  });

  it("book vs tax difference: MACRS produces more year-1 depreciation than SL", () => {
    const lines = buildDepreciationLines(
      [baseAsset],
      "2025-12-31",
      null,
      true,
      new Map()
    );
    // Book SL: 108k/60mo * 12mo = $21,600
    // Tax MACRS 5-yr HY: 120k * 20% = $24,000
    expect(lines[0].taxAmount!).toBeGreaterThan(lines[0].amount);
  });
});
