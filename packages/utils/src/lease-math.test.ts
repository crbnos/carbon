// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";

import {
  addMonths,
  buildLesseeSchedule,
  classifyLesseeLease,
  endedPaymentsAddBack,
  escalatedLeasePayment,
  generateLeasePayments,
  isPaidBeforeOpening,
  isTermWithinTwelveMonths,
  type LesseeLeg,
  leaseEscalationYears,
  leaseMonthEnds,
  leaseMonthShare,
  leaseMonthsAt,
  leaseTermMonths,
  lesseeCarryingAt,
  lesseeCommencementLegs,
  lesseeOpeningBalanceLegs,
  lesseePurchaseLegs,
  lesseeRemeasurementLegs,
  lesseeScheduleSpan,
  lesseeTerminationLegs,
  measureLesseeAsset,
  normalizeLesseeLegs,
  openEndedLeaseHorizon,
  paymentMonthIndex,
  presentValueOfPayments,
  remainingLeasePayments,
  remeasureLease
} from "./lease-math.ts";
import { presentValue } from "./lessor-lease.ts";

type Terms = Parameters<typeof generateLeasePayments>[0] & {
  endDate: string;
};

// The spec's worked example: 36 months, 10,000 a month in arrears, 6 % a year.
const TERMS: Terms = {
  commencementDate: "2027-01-01",
  endDate: "2029-12-31",
  paymentAmount: 10000,
  frequency: "Monthly",
  timing: "Arrears",
  annualEscalationPercent: 0,
  purchaseOptionAmount: 0,
  decimals: 2
};
const THRESHOLDS = { majorPartPercent: 75, substantiallyAllPercent: 90 };

const points = (terms: Terms) =>
  generateLeasePayments(terms).map((row) => ({
    monthIndex: paymentMonthIndex(row, terms.commencementDate, terms.timing),
    amount: row.amount
  }));

const schedule = (
  classification: "Operating" | "Finance",
  terms: Terms = TERMS,
  amortizationMonths = 36,
  openingRouAsset?: number
) => {
  const payments = points(terms);
  const liability = presentValueOfPayments({ payments, annualRate: 6 });
  return buildLesseeSchedule({
    openingLiability: liability,
    openingRouAsset: openingRouAsset ?? liability,
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

describe("open-ended leases", () => {
  const terms = {
    ...TERMS,
    commencementDate: "2027-01-15",
    endDate: null,
    frequency: "Quarterly" as const,
    purchaseOptionAmount: 20000
  };

  it("reaches one period past the one asOf falls in", () => {
    expect(openEndedLeaseHorizon("2027-01-15", "2027-05-01", "Quarterly")).toBe(
      "2027-07-15"
    );
    expect(openEndedLeaseHorizon("2027-01-15", "2027-01-10", "Monthly")).toBe(
      "2027-02-15"
    );
  });

  it("cuts whole periods through the horizon, never prorated, with no purchase option", () => {
    const rows = generateLeasePayments({
      ...terms,
      through: openEndedLeaseHorizon("2027-01-15", "2027-05-01", "Quarterly")
    });
    expect(rows.map((row) => [row.periodStart, row.periodEnd])).toEqual([
      ["2027-01-15", "2027-04-14"],
      ["2027-04-15", "2027-07-14"],
      ["2027-07-15", "2027-10-14"]
    ]);
    expect(rows.every((row) => row.amount === 10000)).toBe(true);
    expect(rows.some((row) => row.paymentType === "Purchase Option")).toBe(
      false
    );
  });

  it("needs a date to cut through", () => {
    expect(() => generateLeasePayments(terms)).toThrow();
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

  it("lets a lease from Feb 29 run through Feb 28 of the next year", () => {
    expect(isTermWithinTwelveMonths("2024-02-29", "2025-02-28")).toBe(true);
    expect(isTermWithinTwelveMonths("2024-02-29", "2025-03-01")).toBe(false);
    expect(leaseTermMonths("2024-02-29", "2025-02-28")).toBe(12);
  });

  it("ends a lease from Feb 28 in a leap year on Feb 27", () => {
    expect(isTermWithinTwelveMonths("2023-02-28", "2024-02-27")).toBe(true);
    expect(isTermWithinTwelveMonths("2023-02-28", "2024-02-28")).toBe(false);
  });
});

describe("leaseMonthShare", () => {
  it("is the days of a last part month over its full length", () => {
    expect(leaseMonthShare("2026-01-01", 12, "2027-01-15")).toBeCloseTo(
      15 / 31,
      10
    );
    expect(leaseMonthShare("2026-01-01", 11, "2027-01-15")).toBe(1);
    expect(leaseMonthShare("2026-01-15", 0, "2026-02-14")).toBe(1);
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
      payments: points({ ...TERMS, timing: "Advance" }),
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

  it("agrees with the lessor's annuity for level payments", () => {
    for (const timing of ["Arrears", "Advance"] as const) {
      expect(
        presentValueOfPayments({
          payments: points({ ...TERMS, timing }),
          annualRate: 6
        })
      ).toBeCloseTo(
        presentValue({ payment: 10000, periods: 36, annualRate: 6, timing })
          .pvRent,
        4
      );
    }
  });

  it("discounts escalated rows at their own month", () => {
    const rows = points({ ...TERMS, annualEscalationPercent: 3 });
    const expected =
      10000 * sumDiscounts(1, 12) +
      10300 * sumDiscounts(13, 24) +
      10609 * sumDiscounts(25, 36);
    expect(
      presentValueOfPayments({ payments: rows, annualRate: 6 })
    ).toBeCloseTo(expected, 2);
  });

  it("refuses a negative rate", () => {
    expect(() =>
      presentValueOfPayments({ payments: points(TERMS), annualRate: -1 })
    ).toThrow(/zero or more/);
  });
});

/** Σ 1.005^-k for k in [from, to]. */
function sumDiscounts(from: number, to: number): number {
  let total = 0;
  for (let k = from; k <= to; k += 1) total += 1.005 ** -k;
  return total;
}

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

  it("closes an escalating lease at zero, its cost straight-line over the total", () => {
    const terms = { ...TERMS, annualEscalationPercent: 3 };
    const lines = schedule("Operating", terms);
    const total = sum(generateLeasePayments(terms).map((row) => row.amount));
    expect(lines[35]!.closingLiability).toBe(0);
    expect(lines[35]!.closingRouAsset).toBe(0);
    expect(lines[0]!.leaseCost).toBeCloseTo(total / 36, 2);
    expect(lines[0]!.paymentAmount).toBe(10000);
    expect(lines[12]!.paymentAmount).toBe(10300);
    expect(sum(lines.map((l) => l.leaseCost))).toBeCloseTo(total, 4);
  });

  it("spreads initial direct costs in the ROU asset over the term", () => {
    const liability = presentValueOfPayments({
      payments: points(TERMS),
      annualRate: 6
    });
    const lines = schedule("Operating", TERMS, 36, liability + 3600);
    // 360,000 of rent and 3,600 of direct costs: 10,100 a month.
    expect(lines[0]!.leaseCost).toBeCloseTo(10100, 5);
    expect(sum(lines.map((l) => l.leaseCost))).toBeCloseTo(363600, 4);
    expect(lines[35]!.closingLiability).toBe(0);
    expect(lines[35]!.closingRouAsset).toBe(0);
  });

  it("pays a quarterly lease only in its payment months", () => {
    const terms = {
      ...TERMS,
      frequency: "Quarterly" as const,
      paymentAmount: 30000
    };
    const lines = schedule("Operating", terms);
    const paying = lines
      .map((line, m) => (line.paymentAmount > 0 ? m : null))
      .filter((m) => m !== null);
    // In arrears: the end of months 2, 5, …, 35.
    expect(paying).toEqual(Array.from({ length: 12 }, (_, i) => i * 3 + 2));
    expect(lines[2]!.paymentAmount).toBe(30000);
    expect(lines[35]!.closingLiability).toBe(0);
    expect(lines[0]!.leaseCost).toBeCloseTo(10000, 5);
  });

  it("amortizes a finance lease over a life longer than the term", () => {
    const lines = schedule("Finance", TERMS, 48);
    const rou = presentValueOfPayments({
      payments: points(TERMS),
      annualRate: 6
    });
    expect(lines[0]!.rouAmortization).toBeCloseTo(rou / 48, 2);
    expect(lines[35]!.closingLiability).toBe(0);
    // Twelve months of the life are left when the term ends.
    expect(lines[35]!.closingRouAsset).toBeCloseTo((rou * 12) / 48, 0);
  });

  it("gives a last part month its share of the cost by days", () => {
    const terms = {
      ...TERMS,
      commencementDate: "2026-01-01",
      endDate: "2027-01-15",
      timing: "Advance" as const,
      paymentAmount: 1000
    };
    const payments = points(terms);
    const liability = presentValueOfPayments({ payments, annualRate: 6 });
    const share = leaseMonthShare(terms.commencementDate, 12, terms.endDate);
    const periodDates = leaseMonthEnds(terms.commencementDate, 0, 13).map(
      (date) => (date > terms.endDate ? terms.endDate : date)
    );
    const build = (classification: "Operating" | "Finance") =>
      buildLesseeSchedule({
        openingLiability: liability,
        openingRouAsset: liability,
        payments,
        months: 13,
        annualRate: 6,
        timing: terms.timing,
        classification,
        amortizationMonths: 13,
        periodDates,
        lastMonthShare: share
      });
    const total = sum(payments.map((p) => p.amount));
    const perMonth = total / (12 + share);

    const operating = build("Operating");
    expect(operating[0]!.leaseCost).toBeCloseTo(perMonth, 2);
    expect(operating[12]!.leaseCost).toBeCloseTo(perMonth * share, 2);
    expect(sum(operating.map((l) => l.leaseCost))).toBeCloseTo(total, 4);
    expect(operating[12]!.closingRouAsset).toBe(0);

    const finance = build("Finance");
    expect(finance[0]!.rouAmortization).toBeCloseTo(
      liability / (12 + share),
      2
    );
    expect(finance[12]!.rouAmortization).toBeCloseTo(
      (liability / (12 + share)) * share,
      2
    );
    expect(finance[12]!.closingRouAsset).toBe(0);
  });

  it("refuses a schedule with no months, saying so", () => {
    expect(() =>
      buildLesseeSchedule({
        openingLiability: 0,
        openingRouAsset: 0,
        payments: [],
        months: 0,
        annualRate: 6,
        timing: "Arrears",
        classification: "Operating",
        amortizationMonths: 0,
        periodDates: []
      })
    ).toThrow("A lease schedule needs at least one month");
  });

  it("closes an advance lease at zero", () => {
    const lines = schedule("Operating", {
      ...TERMS,
      timing: "Advance"
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

// The lifecycle math the app's previews and `post-lease` share: carrying
// amounts, the add-back of an ended purchase option, the opening-balance
// split, the remeasured payments and the journal legs.
describe("escalatedLeasePayment", () => {
  it("steps up on each anniversary of the commencement", () => {
    expect(escalatedLeasePayment(10000, 3, 0)).toBe(10000);
    expect(escalatedLeasePayment(10000, 3, 11)).toBe(10000);
    expect(escalatedLeasePayment(10000, 3, 12)).toBeCloseTo(10300, 5);
    expect(escalatedLeasePayment(10000, 3, 25)).toBeCloseTo(10609, 5);
  });

  it("counts whole years only", () => {
    expect(leaseEscalationYears(0)).toBe(0);
    expect(leaseEscalationYears(23)).toBe(1);
    expect(leaseEscalationYears(24)).toBe(2);
  });
});

describe("remainingLeasePayments", () => {
  const terms = {
    commencementDate: "2027-01-01",
    endDate: "2029-12-31",
    timing: "Arrears" as const,
    purchaseOptionAmount: 0,
    decimals: 2
  };

  it("escalates on the commencement's anniversaries, from the rate at the date", () => {
    const { commencementPayment, rows } = remainingLeasePayments({
      ...terms,
      fromMonth: 18,
      paymentAtStart: 10300,
      frequency: "Monthly",
      annualEscalationPercent: 3
    });
    expect(commencementPayment).toBeCloseTo(10000, 5);
    expect(rows[0]).toMatchObject({
      periodStart: "2028-07-01",
      dueDate: "2028-07-31",
      amount: 10300
    });
    expect(rows.find((row) => row.dueDate === "2029-01-31")?.amount).toBe(
      10609
    );
    expect(rows).toHaveLength(18);
  });

  it("cuts a period the new frequency started earlier down to its days", () => {
    const { rows } = remainingLeasePayments({
      ...terms,
      fromMonth: 1,
      paymentAtStart: 3000,
      frequency: "Quarterly",
      annualEscalationPercent: 0
    });
    expect(rows[0]).toEqual({
      periodStart: "2027-02-01",
      periodEnd: "2027-03-31",
      dueDate: "2027-03-31",
      paymentType: "Rent",
      amount: 1966.67
    });
    expect(rows[1]?.periodStart).toBe("2027-04-01");
  });

  it("keeps the months of a lease from the 31st", () => {
    const { rows } = remainingLeasePayments({
      ...terms,
      commencementDate: "2027-01-31",
      endDate: "2030-01-30",
      fromMonth: 1,
      paymentAtStart: 1000,
      frequency: "Monthly",
      annualEscalationPercent: 0
    });
    expect(rows.slice(0, 3).map((row) => row.periodStart)).toEqual([
      "2027-02-28",
      "2027-03-31",
      "2027-04-30"
    ]);
  });
});

describe("lesseeScheduleSpan", () => {
  it("covers the whole months of the term", () => {
    const span = lesseeScheduleSpan("2027-01-01", "2029-12-31");
    expect(span.termMonths).toBe(36);
    expect(span.months).toBe(36);
    expect(span.withinTwelveMonths).toBe(false);
    expect(span.periodDates[0]).toBe("2027-01-31");
    expect(span.periodDates.at(-1)).toBe("2029-12-31");
  });

  it("adds a last part month clamped to the end date", () => {
    const span = lesseeScheduleSpan("2027-01-15", "2027-12-31");
    expect(span.termMonths).toBe(11);
    expect(span.months).toBe(12);
    expect(span.periodDates.at(-1)).toBe("2027-12-31");
    expect(span.withinTwelveMonths).toBe(true);
  });

  it("gives a last part month its share of a full month by days", () => {
    // The 12th month runs 2027-12-15 to 2027-12-31: 17 of its 31 days.
    expect(
      lesseeScheduleSpan("2027-01-15", "2027-12-31").lastMonthShare
    ).toBeCloseTo(17 / 31, 10);
    expect(lesseeScheduleSpan("2027-01-01", "2029-12-31").lastMonthShare).toBe(
      1
    );
    expect(
      lesseeScheduleSpan("2027-01-01", "2028-01-15", 6).lastMonthShare
    ).toBeCloseTo(15 / 31, 10);
  });

  it("starts at a later lease month", () => {
    const span = lesseeScheduleSpan("2027-01-01", "2029-12-31", 18);
    expect(span.termMonths).toBe(18);
    expect(span.months).toBe(18);
    expect(span.periodDates[0]).toBe("2028-07-31");
  });
});

describe("isPaidBeforeOpening", () => {
  const rent = (periodStart: string, periodEnd: string, dueDate: string) => ({
    periodStart,
    periodEnd,
    dueDate,
    paymentType: "Rent" as const
  });
  const monthly = lesseeScheduleSpan("2027-01-01", "2029-12-31").periodDates;

  it("holds the advance payments of the months before the as-of date", () => {
    const args = {
      commencementDate: "2027-01-01",
      timing: "Advance" as const,
      periodDates: monthly,
      asOf: "2027-04-01"
    };
    expect(
      isPaidBeforeOpening(rent("2027-03-01", "2027-03-31", "2027-03-01"), args)
    ).toBe(true);
    expect(
      isPaidBeforeOpening(rent("2027-04-01", "2027-04-30", "2027-04-01"), args)
    ).toBe(false);
  });

  it("holds the arrears payment of the month that ends before the date", () => {
    const args = {
      commencementDate: "2027-01-01",
      timing: "Arrears" as const,
      periodDates: monthly,
      asOf: "2027-04-01"
    };
    expect(
      isPaidBeforeOpening(rent("2027-03-01", "2027-03-31", "2027-03-31"), args)
    ).toBe(true);
    expect(
      isPaidBeforeOpening(rent("2027-04-01", "2027-04-30", "2027-04-30"), args)
    ).toBe(false);
  });

  it("keeps an advance payment due inside the as-of month in the liability", () => {
    // Lease months run from the 15th: the month of 2027-03-15 is not over
    // on 2027-04-01, so its payment is not in the opening balance.
    const periodDates = lesseeScheduleSpan(
      "2027-01-15",
      "2029-12-31"
    ).periodDates;
    expect(
      isPaidBeforeOpening(rent("2027-03-15", "2027-04-14", "2027-03-15"), {
        commencementDate: "2027-01-15",
        timing: "Advance",
        periodDates,
        asOf: "2027-04-01"
      })
    ).toBe(false);
  });
});

describe("lesseeCarryingAt", () => {
  const rows = [
    { periodDate: "2027-01-31", closingLiability: 900, rouAmortization: 80 },
    { periodDate: "2027-02-28", closingLiability: 800, rouAmortization: 81 },
    { periodDate: "2027-03-31", closingLiability: 700, rouAmortization: 82 }
  ];

  it("reads the liability of the last month before the date", () => {
    expect(
      lesseeCarryingAt({
        schedule: rows,
        startDate: "2027-03-01",
        initialLiability: 1000,
        rouAssetCost: 1000
      })
    ).toEqual({ liability: 800, accumulated: 161, rouAsset: 839 });
  });

  it("starts from the initial liability before any month", () => {
    expect(
      lesseeCarryingAt({
        schedule: rows,
        startDate: "2027-01-01",
        initialLiability: 1000,
        rouAssetCost: 1000
      })
    ).toEqual({ liability: 1000, accumulated: 0, rouAsset: 1000 });
  });
});

describe("endedPaymentsAddBack", () => {
  it("adds back only a Pending purchase option due by the last day", () => {
    const option = {
      paymentType: "Purchase Option" as const,
      status: "Pending",
      dueDate: "2029-12-31",
      amount: 5000
    };
    expect(endedPaymentsAddBack([option], "2029-12-31")).toBe(5000);
    expect(endedPaymentsAddBack([option], "2029-12-30")).toBe(0);
    expect(
      endedPaymentsAddBack([{ ...option, status: "Invoiced" }], "2029-12-31")
    ).toBe(0);
    expect(
      endedPaymentsAddBack(
        [{ ...option, paymentType: "Rent" as const }],
        "2029-12-31"
      )
    ).toBe(0);
  });
});

describe("lessee journal legs", () => {
  const byAccount = (legs: LesseeLeg[]) =>
    normalizeLesseeLegs(legs).map((leg) => [leg.side, leg.account, leg.amount]);

  it("normalizes a negative leg to the other side and drops a zero one", () => {
    expect(
      normalizeLesseeLegs([
        {
          side: "debit",
          account: "rightOfUseAsset",
          description: "",
          amount: -10
        },
        { side: "credit", account: "gain", description: "", amount: 0 }
      ])
    ).toEqual([
      {
        side: "credit",
        account: "rightOfUseAsset",
        description: "",
        amount: 10
      }
    ]);
  });

  it("derecognizes a terminated asset with a loss", () => {
    const { legs, gainLoss } = lesseeTerminationLegs({
      carryingLiability: 113000,
      penalty: 5000,
      rouAssetCost: 328710.16,
      accumulated: 219140.16
    });
    expect(gainLoss).toBeCloseTo(-1570, 5);
    expect(byAccount(legs)).toEqual([
      ["debit", "leaseLiability", 108000],
      ["debit", "accumulatedRightOfUseAmortization", 219140.16],
      ["credit", "rightOfUseAsset", 328710.16],
      ["debit", "loss", 1570]
    ]);
  });

  it("moves a purchased asset into PP&E at net ROU plus price less liability", () => {
    const { legs, assetCost } = lesseePurchaseLegs({
      carryingLiability: 20000,
      price: 20000,
      rouAssetCost: 345423.06,
      accumulated: 148038.48
    });
    expect(assetCost).toBeCloseTo(197384.58, 5);
    expect(byAccount(legs)).toEqual([
      ["debit", "fixedAsset", 197384.58],
      ["debit", "accumulatedRightOfUseAmortization", 148038.48],
      ["debit", "leaseLiability", 20000],
      ["credit", "rightOfUseAsset", 345423.06],
      ["credit", "leaseLiability", 20000]
    ]);
  });

  it("reports a negative cost rather than refusing it", () => {
    expect(
      lesseePurchaseLegs({
        carryingLiability: 50000,
        price: 0,
        rouAssetCost: 345423.06,
        accumulated: 340000
      }).assetCost
    ).toBeLessThan(0);
  });

  it("books a remeasurement decrease beyond the ROU asset as a gain", () => {
    expect(
      byAccount(lesseeRemeasurementLegs({ adjustment: -15000, gain: 5000 }))
    ).toEqual([
      ["credit", "rightOfUseAsset", 10000],
      ["debit", "leaseLiability", 15000],
      ["credit", "gain", 5000]
    ]);
  });

  it("books the commencement at the PV", () => {
    expect(byAccount(lesseeCommencementLegs({ liability: 1000 }))).toEqual([
      ["debit", "rightOfUseAsset", 1000],
      ["credit", "leaseLiability", 1000]
    ]);
  });

  it("puts the opening balance's difference to retained earnings", () => {
    expect(
      byAccount(
        lesseeOpeningBalanceLegs({
          rouAssetCost: 1000,
          accumulated: 300,
          carryingLiability: 650
        })
      )
    ).toEqual([
      ["debit", "rightOfUseAsset", 1000],
      ["credit", "accumulatedRightOfUseAmortization", 300],
      ["credit", "leaseLiability", 650],
      ["credit", "retainedEarnings", 50]
    ]);
  });
});

describe("measureLesseeAsset", () => {
  const inputs = {
    fairValue: null,
    economicLifeMonths: null,
    ownershipTransfers: false,
    purchaseOptionReasonablyCertain: false,
    specializedAsset: false
  };

  it("measures the liability at the PV of the rows and classifies", () => {
    const measured = measureLesseeAsset({
      commencementDate: TERMS.commencementDate,
      endDate: TERMS.endDate,
      timing: TERMS.timing,
      discountRate: 6,
      payments: generateLeasePayments(TERMS),
      inputs,
      shortTermExpedient: true,
      thresholds: THRESHOLDS
    });
    expect(measured.liability).toBe(
      presentValueOfPayments({ payments: points(TERMS), annualRate: 6 })
    );
    expect(measured.termMonths).toBe(36);
    expect(measured.classification).toBe("Operating");
  });

  it("is short-term for twelve months or less under the expedient", () => {
    const terms = { ...TERMS, endDate: "2027-12-31" };
    expect(
      measureLesseeAsset({
        commencementDate: terms.commencementDate,
        endDate: terms.endDate,
        timing: terms.timing,
        discountRate: 6,
        payments: generateLeasePayments(terms),
        inputs,
        shortTermExpedient: true,
        thresholds: THRESHOLDS
      }).classification
    ).toBe("Short-Term");
  });
});
