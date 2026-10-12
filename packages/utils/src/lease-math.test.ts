// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";

import {
  addMonths,
  buildLesseeSchedule,
  classifyLesseeLease,
  generateLeasePayments,
  isTermWithinTwelveMonths,
  leaseMonthEnds,
  leaseMonthsAt,
  leaseTermMonths,
  paymentMonthIndex,
  presentValueOfPayments,
  remeasureLease
} from "./lease-math.ts";

// The spec's worked example: 36 months, 10,000 a month in arrears, 6 % a year.
const TERMS = {
  commencementDate: "2027-01-01",
  endDate: "2029-12-31",
  paymentAmount: 10000,
  frequency: "Monthly" as const,
  timing: "Arrears" as const,
  annualEscalationPercent: 0,
  purchaseOptionAmount: 0,
  decimals: 2
};
const THRESHOLDS = { majorPartPercent: 75, substantiallyAllPercent: 90 };

const points = (terms: typeof TERMS) =>
  generateLeasePayments(terms).map((row) => ({
    monthIndex: paymentMonthIndex(row, terms.commencementDate, terms.timing),
    amount: row.amount
  }));

const schedule = (
  classification: "Operating" | "Finance",
  terms = TERMS,
  amortizationMonths = 36
) => {
  const payments = points(terms);
  const liability = presentValueOfPayments({ payments, annualRate: 6 });
  return buildLesseeSchedule({
    openingLiability: liability,
    openingRouAsset: liability,
    payments,
    months: 36,
    annualRate: 6,
    timing: terms.timing,
    classification,
    amortizationMonths,
    periodDates: leaseMonthEnds(terms.commencementDate, 0, 36)
  });
};

const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);

describe("addMonths", () => {
  it("clamps the day to the target month", () => {
    expect(addMonths("2027-01-31", 1)).toBe("2027-02-28");
    expect(addMonths("2027-11-15", 3)).toBe("2028-02-15");
    expect(addMonths("2028-01-31", 1)).toBe("2028-02-29");
  });
});

describe("generateLeasePayments", () => {
  it("cuts one row per month, due at the period end in arrears", () => {
    const rows = generateLeasePayments(TERMS);
    expect(rows).toHaveLength(36);
    expect(rows[0]).toEqual({
      periodStart: "2027-01-01",
      periodEnd: "2027-01-31",
      dueDate: "2027-01-31",
      amount: 10000,
      paymentType: "Rent"
    });
    expect(rows[35]!.periodEnd).toBe("2029-12-31");
  });

  it("cuts quarterly and annual rows", () => {
    expect(
      generateLeasePayments({ ...TERMS, frequency: "Quarterly" })
    ).toHaveLength(12);
    expect(
      generateLeasePayments({ ...TERMS, frequency: "Annual" })
    ).toHaveLength(3);
  });

  it("escalates on each anniversary of commencement", () => {
    const rows = generateLeasePayments({
      ...TERMS,
      annualEscalationPercent: 3
    });
    expect(rows[11]!.amount).toBe(10000);
    expect(rows[12]!.amount).toBe(10300);
    expect(rows[23]!.amount).toBe(10300);
    expect(rows[24]!.amount).toBe(10609);
  });

  it("prorates a last period shorter than the frequency by days", () => {
    const rows = generateLeasePayments({ ...TERMS, endDate: "2027-02-14" });
    expect(rows).toHaveLength(2);
    expect(rows[1]).toMatchObject({
      periodStart: "2027-02-01",
      periodEnd: "2027-02-14",
      amount: 5000
    });
  });

  it("adds a purchase option row on the end date", () => {
    const rows = generateLeasePayments({
      ...TERMS,
      purchaseOptionAmount: 20000
    });
    expect(rows).toHaveLength(37);
    expect(rows[36]).toEqual({
      periodStart: "2029-12-31",
      periodEnd: "2029-12-31",
      dueDate: "2029-12-31",
      amount: 20000,
      paymentType: "Purchase Option"
    });
  });
});

describe("paymentMonthIndex", () => {
  it("places arrears rows at the end of their month and advance rows at the start", () => {
    const first = generateLeasePayments(TERMS)[0]!;
    expect(paymentMonthIndex(first, TERMS.commencementDate, "Arrears")).toBe(1);
    expect(paymentMonthIndex(first, TERMS.commencementDate, "Advance")).toBe(0);
  });

  it("places a purchase option at the end of the term", () => {
    const rows = generateLeasePayments({
      ...TERMS,
      purchaseOptionAmount: 20000
    });
    expect(
      paymentMonthIndex(rows[36]!, TERMS.commencementDate, "Arrears")
    ).toBe(36);
  });
});

describe("lease months from the 31st", () => {
  const terms = {
    ...TERMS,
    commencementDate: "2026-01-31",
    endDate: "2027-01-30"
  };

  it("counts a month that starts on a clamped day", () => {
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(leaseMonthsAt("2026-01-31", "2026-02-27")).toBe(0);
    expect(leaseMonthsAt("2026-01-31", "2026-02-28")).toBe(1);
    expect(leaseMonthsAt("2026-01-31", "2026-03-31")).toBe(2);
    expect(leaseTermMonths("2026-01-31", "2027-01-30")).toBe(12);
  });

  it("places every row one month apart, in arrears and in advance", () => {
    const rows = generateLeasePayments(terms);
    expect(rows).toHaveLength(12);
    rows.forEach((row, i) => {
      expect(paymentMonthIndex(row, terms.commencementDate, "Arrears")).toBe(
        i + 1
      );
      expect(paymentMonthIndex(row, terms.commencementDate, "Advance")).toBe(i);
    });
  });
});

describe("isTermWithinTwelveMonths", () => {
  it("is true through the day before the first anniversary", () => {
    expect(isTermWithinTwelveMonths("2026-01-31", "2027-01-30")).toBe(true);
    expect(isTermWithinTwelveMonths("2026-01-01", "2026-12-31")).toBe(true);
  });

  it("is false for 12 months and 15 days", () => {
    expect(isTermWithinTwelveMonths("2026-01-01", "2027-01-15")).toBe(false);
    expect(leaseTermMonths("2026-01-01", "2027-01-15")).toBe(12);
  });
});

describe("presentValueOfPayments", () => {
  it("values the worked example at 328,710.16", () => {
    expect(
      presentValueOfPayments({ payments: points(TERMS), annualRate: 6 })
    ).toBeCloseTo(328710.16, 2);
  });

  it("values advance payments one month earlier", () => {
    const arrears = presentValueOfPayments({
      payments: points(TERMS),
      annualRate: 6
    });
    const advance = presentValueOfPayments({
      payments: points({ ...TERMS, timing: "Advance" as never }),
      annualRate: 6
    });
    expect(advance).toBeCloseTo(arrears * 1.005, 1);
  });

  it("adds the purchase option discounted from the end of the term", () => {
    expect(
      presentValueOfPayments({
        payments: points({ ...TERMS, purchaseOptionAmount: 20000 }),
        annualRate: 6
      })
    ).toBeCloseTo(345423.06, 2);
  });

  it("is the undiscounted sum at a zero rate", () => {
    expect(
      presentValueOfPayments({ payments: points(TERMS), annualRate: 0 })
    ).toBe(360000);
  });
});

describe("buildLesseeSchedule", () => {
  it("matches the worked example and closes at zero", () => {
    const lines = schedule("Operating");
    expect(lines).toHaveLength(36);
    expect(lines[0]!.periodDate).toBe("2027-01-31");
    expect(lines[0]!.interestAmount).toBeCloseTo(1643.55, 2);
    expect(lines[0]!.principalAmount).toBeCloseTo(8356.45, 2);
    expect(lines[0]!.closingLiability).toBeCloseTo(320353.71, 2);
    expect(lines[35]!.closingLiability).toBe(0);
  });

  it("posts a single straight-line lease cost for an operating lease", () => {
    const lines = schedule("Operating");
    expect(lines[0]!.leaseCost).toBeCloseTo(10000, 5);
    expect(lines[0]!.rouAmortization).toBeCloseTo(8356.45, 2);
    expect(sum(lines.map((l) => l.leaseCost))).toBeCloseTo(360000, 4);
    expect(lines[35]!.closingRouAsset).toBe(0);
  });

  it("posts interest plus straight-line amortization for a finance lease", () => {
    const lines = schedule("Finance");
    expect(lines[0]!.rouAmortization).toBeCloseTo(9130.84, 2);
    expect(lines[0]!.leaseCost).toBeCloseTo(1643.55 + 9130.84, 1);
    expect(sum(lines.map((l) => l.leaseCost))).toBeCloseTo(360000, 4);
    expect(lines[35]!.closingRouAsset).toBe(0);
  });

  it("amortizes over the useful life when the purchase option is reasonably certain", () => {
    const terms = { ...TERMS, purchaseOptionAmount: 20000 };
    const lines = schedule("Finance", terms, 84);
    expect(lines[0]!.rouAmortization).toBeCloseTo(4112.18, 2);
    expect(lines[35]!.closingLiability).toBe(0);
    expect(lines[35]!.paymentAmount).toBeCloseTo(30000, 5);
    expect(lines[35]!.closingRouAsset).toBeGreaterThan(0);
  });

  it("closes an advance lease at zero", () => {
    const lines = schedule("Operating", {
      ...TERMS,
      timing: "Advance" as never
    });
    expect(lines[0]!.paymentAmount).toBe(10000);
    expect(lines[35]!.closingLiability).toBe(0);
    expect(lines[35]!.closingRouAsset).toBe(0);
  });
});

describe("classifyLesseeLease", () => {
  const base = {
    termMonths: 36,
    pvPayments: 328710.16,
    fairValue: null,
    economicLifeMonths: null,
    ownershipTransfers: false,
    purchaseOptionReasonablyCertain: false,
    specializedAsset: false,
    shortTermExpedient: true,
    withinTwelveMonths: false
  };

  it("is Operating when no test passes or has its inputs", () => {
    expect(classifyLesseeLease(base, THRESHOLDS).classification).toBe(
      "Operating"
    );
  });

  it("is Finance when the PV is substantially all of the fair value", () => {
    expect(
      classifyLesseeLease({ ...base, fairValue: 340000 }, THRESHOLDS)
        .classification
    ).toBe("Finance");
  });

  it("is Short-Term for 12 months or less with the election on", () => {
    expect(
      classifyLesseeLease(
        { ...base, termMonths: 12, withinTwelveMonths: true },
        THRESHOLDS
      ).classification
    ).toBe("Short-Term");
    expect(
      classifyLesseeLease(
        {
          ...base,
          termMonths: 12,
          withinTwelveMonths: true,
          shortTermExpedient: false
        },
        THRESHOLDS
      ).classification
    ).toBe("Operating");
  });

  it("is never Short-Term with a reasonably certain purchase option", () => {
    expect(
      classifyLesseeLease(
        {
          ...base,
          termMonths: 12,
          withinTwelveMonths: true,
          purchaseOptionReasonablyCertain: true
        },
        THRESHOLDS
      ).classification
    ).toBe("Finance");
  });
});

describe("remeasureLease", () => {
  it("moves the ROU asset by the liability change", () => {
    const result = remeasureLease({
      carryingLiability: 100000,
      carryingRouAsset: 90000,
      remainingPayments: [{ monthIndex: 0, amount: 120000 }],
      annualRate: 6
    });
    expect(result).toEqual({
      liability: 120000,
      adjustment: 20000,
      rouAsset: 110000,
      gain: 0
    });
  });

  it("turns a decrease larger than the ROU asset into a gain", () => {
    const result = remeasureLease({
      carryingLiability: 100000,
      carryingRouAsset: 10000,
      remainingPayments: [{ monthIndex: 0, amount: 85000 }],
      annualRate: 6
    });
    expect(result).toEqual({
      liability: 85000,
      adjustment: -15000,
      rouAsset: 0,
      gain: 5000
    });
  });
});
