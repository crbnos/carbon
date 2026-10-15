// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { round } from "@carbon/database/precision";
import {
  buildLessorSchedule,
  generateRentalBillingPeriods,
  netInvestmentExceedsFairValue
} from "@carbon/utils";
import { expect, it } from "vitest";
import {
  activationBillingThrough,
  buildCommencementLines,
  buildResidualReturnLines,
  certainPurchaseOption,
  classifyRentalLine,
  commencementAmounts,
  interestRows,
  leaseClosingTarget,
  leasePaymentTerms,
  netInvestmentAt,
  salesTypeRequirementError,
  salesTypeReturnError,
  scheduleBillingPeriods,
  settledClassification,
  wholeMonthsInTerm
} from "./lessor";

/** USD: rent is billed, and so valued, in cents. */
const DECIMALS = 2;

const THRESHOLDS = { majorPartPercent: 75, substantiallyAllPercent: 90 };
const MONTHLY = { rateUnit: "Month", rate: 1000 } as const;
// The plan's worked example: 36 × 1,000 in arrears at 6 %, a reasonably
// certain 5,000 purchase option, fair value 38,000.
const AGREEMENT = {
  ownershipTransfers: false,
  specializedAsset: false,
  purchaseOptionAmount: 5000,
  purchaseOptionReasonablyCertain: true
};
const LINE = {
  fairValue: 38000,
  economicLifeMonths: 120,
  guaranteedResidualValue: 0,
  unguaranteedResidualValue: 0
};
const ACCOUNTS = {
  netInvestmentInLeasesAccountId: "1160",
  costOfGoodsSoldAccountId: "5010",
  leaseRevenueAccountId: "4070",
  assetAccountId: "1370",
  accumulatedDepreciationAccountId: "1380"
};

it("a term counts whole calendar months, both ends inclusive", () => {
  expect(wholeMonthsInTerm("2027-01-01", "2029-12-31")).toEqual(36);
  expect(wholeMonthsInTerm("2027-01-15", "2028-01-14")).toEqual(12);
  expect(wholeMonthsInTerm("2027-01-15", "2028-01-13")).toEqual(11);
  expect(wholeMonthsInTerm("2027-01-15", "2027-02-10")).toEqual(0);
  expect(() => wholeMonthsInTerm("2027-02-01", "2027-01-31")).toThrow();
});

it("a Calendar Month line pays the month rate once per whole month at the agreement's rate", () => {
  expect(
    leasePaymentTerms({
      decimals: DECIMALS,
      cycle: "Calendar Month",
      ...MONTHLY,
      discountRate: 6,
      startDate: "2027-01-01",
      endDate: "2029-12-31"
    })
  ).toEqual({ termMonths: 36, payment: 1000, periods: 36, annualRate: 6 });
});

it("an open-ended or sub-month line is valued over one period", () => {
  const openEnded = leasePaymentTerms({
    decimals: DECIMALS,
    cycle: "Calendar Month",
    ...MONTHLY,
    discountRate: 6,
    startDate: "2027-01-01",
    endDate: null
  });
  expect(openEnded.termMonths).toEqual(null);
  expect(openEnded.periods).toEqual(1);

  const short = leasePaymentTerms({
    decimals: DECIMALS,
    cycle: "28 Days",
    ...MONTHLY,
    discountRate: 6,
    startDate: "2027-01-01",
    endDate: "2027-01-20"
  });
  expect(short.termMonths).toEqual(0);
  expect(short.periods).toEqual(1);
});

it("a 28 Days line pays the 28-day charge per whole 28 days, at the rate scaled to 28/365 a period", () => {
  const terms = leasePaymentTerms({
    decimals: DECIMALS,
    cycle: "28 Days",
    ...MONTHLY,
    discountRate: 6,
    startDate: "2027-01-01",
    // 364 days: thirteen 28-day periods
    endDate: "2027-12-30"
  });
  // A Monthly unit pays one month per 28-day period.
  expect(terms.payment).toEqual(1000);
  expect(terms.periods).toEqual(13);
  expect(terms.termMonths).toEqual(11);
  // 6 × 12 × 28 / 365 = 5.52329, so presentValue's annual/100/12 is
  // 0.0046027 a period = 6 % × 28 / 365.
  expect(terms.annualRate).toEqual(5.52329);
  expect(
    Math.abs(terms.annualRate / 100 / 12 - (0.06 * 28) / 365) < 1e-7
  ).toBeTruthy();

  // One day short of the thirteenth period: twelve whole periods.
  expect(
    leasePaymentTerms({
      decimals: DECIMALS,
      cycle: "28 Days",
      ...MONTHLY,
      discountRate: 6,
      startDate: "2027-01-01",
      endDate: "2027-12-29"
    }).periods
  ).toEqual(12);
});

it("a Weekly 28 Days line pays four weeks a period", () => {
  expect(
    leasePaymentTerms({
      decimals: DECIMALS,
      cycle: "28 Days",
      rateUnit: "Week",
      rate: 300,
      discountRate: 6,
      startDate: "2027-01-01",
      endDate: "2027-12-30"
    }).payment
  ).toEqual(1200);
});

it("a Daily or Weekly unit on a Calendar Month agreement is valued at its average month", () => {
  const terms = {
    cycle: "Calendar Month" as const,
    discountRate: 6,
    startDate: "2027-01-01",
    endDate: "2029-12-31"
  };
  // 365 days a year at 50, over twelve months.
  expect(
    leasePaymentTerms({
      decimals: DECIMALS,
      ...terms,
      rateUnit: "Day",
      rate: 50
    }).payment
  ).toEqual(1520.83);
  // Whole weeks per month: five in every month but February's four — 59 a
  // year at 300, over twelve months.
  expect(
    leasePaymentTerms({
      decimals: DECIMALS,
      ...terms,
      rateUnit: "Week",
      rate: 300
    }).payment
  ).toEqual(1475);
});

it("a rate carrying the storage scale is valued at the cents it bills", () => {
  const terms = {
    cycle: "Calendar Month" as const,
    rateUnit: "Month" as const,
    discountRate: 6,
    startDate: "2027-01-01",
    endDate: "2029-12-31"
  };
  expect(
    leasePaymentTerms({ decimals: DECIMALS, ...terms, rate: 1000.12345 })
      .payment
  ).toEqual(1000.12);
  expect(
    leasePaymentTerms({
      decimals: DECIMALS,
      ...terms,
      cycle: "28 Days",
      endDate: "2027-12-30",
      rateUnit: "Week",
      rate: 300.00125
    }).payment
  ).toEqual(1200.01);
});

it("only a reasonably certain purchase option counts", () => {
  expect(certainPurchaseOption(AGREEMENT)).toEqual(5000);
  expect(
    certainPurchaseOption({
      ...AGREEMENT,
      purchaseOptionReasonablyCertain: false
    })
  ).toEqual(0);
  expect(
    certainPurchaseOption({ ...AGREEMENT, purchaseOptionAmount: null })
  ).toEqual(0);
});

it("classification stores its inputs, thresholds, tests and present values", () => {
  const terms = {
    termMonths: 36,
    payment: 1000,
    periods: 36,
    annualRate: 6
  };
  const { classification, record } = classifyRentalLine({
    terms,
    timing: "Arrears",
    agreement: AGREEMENT,
    line: LINE,
    thresholds: THRESHOLDS
  });
  expect(classification).toEqual("Sale");
  expect(record).toEqual({
    inputs: {
      ownershipTransfers: false,
      purchaseOptionReasonablyCertain: true,
      termMonths: 36,
      economicLifeMonths: 120,
      pvPayments: 37049.24083,
      fairValue: 38000,
      specializedAsset: false
    },
    thresholds: { majorPartPercent: 75, substantiallyAllPercent: 90 },
    tests: { a: false, b: true, c: false, d: true, e: false },
    pvToFairValuePercent: 97.498,
    termToLifePercent: 30,
    pv: {
      pvRent: 32871.01624,
      pvPayments: 37049.24083,
      pvResidual: 0,
      netInvestment: 37049.24083
    },
    payment: 1000,
    periods: 36,
    annualRate: 6,
    timing: "Arrears"
  });
});

it("an uncertain option on a 60,000 unit is Rental", () => {
  const { classification, record } = classifyRentalLine({
    terms: { termMonths: 36, payment: 1000, periods: 36, annualRate: 6 },
    timing: "Arrears",
    agreement: { ...AGREEMENT, purchaseOptionReasonablyCertain: false },
    line: { ...LINE, fairValue: 60000 },
    thresholds: THRESHOLDS
  });
  expect(classification).toEqual("Rental");
  expect(record.pv.pvPayments).toEqual(32871.01624);
});

it("the net investment is the sum of the two rounded present values", () => {
  const { record } = classifyRentalLine({
    terms: { termMonths: 36, payment: 1000, periods: 36, annualRate: 6 },
    timing: "Advance",
    agreement: AGREEMENT,
    line: { ...LINE, unguaranteedResidualValue: 2000 },
    thresholds: THRESHOLDS
  });
  expect(record.pv.netInvestment).toEqual(
    round(record.pv.pvPayments + record.pv.pvResidual)
  );
});

it("an override keeps its stored classification; otherwise the tests decide", () => {
  expect(
    settledClassification("Sale", {
      classificationOverride: true,
      lessorClassification: "Rental"
    })
  ).toEqual("Rental");
  expect(
    settledClassification("Sale", {
      classificationOverride: false,
      lessorClassification: "Rental"
    })
  ).toEqual("Sale");
  // An override with nothing stored falls back to the tests.
  expect(
    settledClassification("Rental", {
      classificationOverride: true,
      lessorClassification: null
    })
  ).toEqual("Rental");
});

it("a sales-type line needs an end date and a fair value", () => {
  const base = {
    name: "FA-1",
    cycle: "Calendar Month" as const,
    rateUnit: "Month" as const,
    startDate: "2027-01-01",
    endDate: "2029-12-31",
    fairValue: 38000,
    today: "2026-12-15"
  };
  expect(salesTypeRequirementError(base)).toEqual(null);
  expect(
    salesTypeRequirementError({ ...base, endDate: null })?.includes("end date")
  ).toBeTruthy();
  expect(
    salesTypeRequirementError({ ...base, fairValue: null })?.includes(
      "fair value"
    )
  ).toBeTruthy();
  expect(
    salesTypeRequirementError({ ...base, fairValue: 0 })?.includes("fair value")
  ).toBeTruthy();
});

it("a sales-type lease cannot start before the month it is activated in", () => {
  const base = {
    name: "FA-1",
    cycle: "Calendar Month" as const,
    rateUnit: "Month" as const,
    startDate: "2026-12-01",
    endDate: "2027-11-30",
    fairValue: 38000,
    today: "2026-12-15"
  };
  // Earlier in the activation month is fine: the commencement and the first
  // interest land in the same period.
  expect(salesTypeRequirementError(base)).toEqual(null);
  expect(
    salesTypeRequirementError({ ...base, startDate: "2027-01-01" })
  ).toEqual(null);
  // A start in an earlier month would post interest before the commencement.
  expect(
    salesTypeRequirementError({ ...base, startDate: "2026-11-01" })
  ).toEqual(
    "FA-1 is treated as a sale, which commences when the agreement is activated: start it in 2026-12 or later (it starts 2026-11-01)"
  );
});

it("a Calendar Month sales-type lease starts on the first and ends on a month end", () => {
  const base = {
    name: "FA-1",
    cycle: "Calendar Month" as const,
    rateUnit: "Month" as const,
    startDate: "2027-01-01",
    endDate: "2029-12-31",
    fairValue: 38000,
    today: "2026-12-15"
  };
  const message =
    "FA-1 is treated as a sale, which runs whole billing periods: start on the first of a month and end on a month end";
  // A mid-month start bills a pro-rata first and last month the level
  // payment valuation does not contain.
  expect(
    salesTypeRequirementError({
      ...base,
      startDate: "2027-01-15",
      endDate: "2028-01-14"
    })
  ).toEqual(message);
  expect(salesTypeRequirementError({ ...base, endDate: "2029-12-30" })).toEqual(
    message
  );
  expect(
    salesTypeRequirementError({ ...base, startDate: "2027-01-02" })
  ).toEqual(message);
  // February's month end, leap year or not.
  expect(salesTypeRequirementError({ ...base, endDate: "2028-02-29" })).toEqual(
    null
  );
  expect(salesTypeRequirementError({ ...base, endDate: "2027-02-28" })).toEqual(
    null
  );
  // A Daily or Weekly unit bills a different amount each month, which a
  // level-payment sale cannot match.
  expect(salesTypeRequirementError({ ...base, rateUnit: "Week" })).toEqual(
    "FA-1 is treated as a sale, which on a Calendar Month agreement needs a monthly rate"
  );
});

it("a 28 Days sales-type lease runs a whole number of 28-day periods", () => {
  const base = {
    name: "FA-1",
    cycle: "28 Days" as const,
    rateUnit: "Week" as const,
    startDate: "2027-01-01",
    // 364 days: thirteen periods
    endDate: "2027-12-30",
    fairValue: 38000,
    today: "2026-12-15"
  };
  // Any frequency bills the same amount every 28 days.
  expect(salesTypeRequirementError(base)).toEqual(null);
  // A 28 Days term need not start on the first.
  expect(
    salesTypeRequirementError({
      ...base,
      startDate: "2027-01-15",
      endDate: "2027-02-11"
    })
  ).toEqual(null);
  expect(salesTypeRequirementError({ ...base, endDate: "2027-12-31" })).toEqual(
    "FA-1 is treated as a sale, which runs whole billing periods: the term must be a whole number of 28-day periods (it is 365 days)"
  );
  expect(
    salesTypeRequirementError({ ...base, endDate: "2027-12-29" })?.includes(
      "whole number of 28-day periods"
    )
  ).toBeTruthy();
});

it("activation cuts an operating line to the horizon and a sales-type line to its end date", () => {
  const args = {
    cycle: "Calendar Month" as const,
    today: "2027-01-10",
    endDate: "2027-01-31"
  };
  // Rental: the billing horizon (end of next month), holdover and all.
  expect(
    activationBillingThrough({ ...args, classification: "Rental" })
  ).toEqual("2027-02-28");
  // Sale: capped at the end date.
  expect(activationBillingThrough({ ...args, classification: "Sale" })).toEqual(
    "2027-01-31"
  );
  // An end date beyond the horizon: the horizon, and the term is still cut
  // in full because the generator runs a fixed term to its end.
  expect(
    activationBillingThrough({
      ...args,
      classification: "Sale",
      endDate: "2029-12-31"
    })
  ).toEqual("2027-02-28");
  expect(() =>
    activationBillingThrough({
      ...args,
      classification: "Sale",
      endDate: null
    })
  ).toThrow();
});

it("a sales-type line whose term ends inside the horizon bills nothing past its end date", () => {
  const generate = (classification: "Rental" | "Sale") =>
    generateRentalBillingPeriods({
      decimals: DECIMALS,
      cycle: "28 Days",
      timing: "Arrears",
      ...MONTHLY,
      startDate: "2027-01-01",
      // Two whole 28-day periods, ending before today + 28.
      endDate: "2027-02-25",
      returnedAt: null,
      through: activationBillingThrough({
        classification,
        cycle: "28 Days",
        today: "2027-02-20",
        endDate: "2027-02-25"
      }),
      existing: []
    }).create;

  const salesType = generate("Sale");
  expect(salesType.map((period) => period.periodEnd)).toEqual([
    "2027-01-28",
    "2027-02-25"
  ]);
  // The operating line keeps its holdover period, as before.
  const operating = generate("Rental");
  expect(operating.length > salesType.length).toBeTruthy();
  expect(
    operating.some((period) => period.periodStart > "2027-02-25")
  ).toBeTruthy();
});

it("a whole-period sales-type lease bills exactly payment × periods", () => {
  const cases = [
    {
      cycle: "Calendar Month" as const,
      ...MONTHLY,
      startDate: "2027-01-01",
      endDate: "2029-12-31"
    },
    {
      cycle: "Calendar Month" as const,
      ...MONTHLY,
      // Through two Februaries, one of them a leap year.
      startDate: "2027-02-01",
      endDate: "2028-03-31"
    },
    {
      cycle: "28 Days" as const,
      ...MONTHLY,
      startDate: "2027-01-01",
      endDate: "2027-12-30"
    },
    {
      cycle: "28 Days" as const,
      rateUnit: "Week" as const,
      rate: 300,
      startDate: "2027-03-17",
      endDate: "2027-06-08"
    }
  ];
  for (const lease of cases) {
    expect(
      salesTypeRequirementError({
        name: "FA-1",
        fairValue: 38000,
        today: lease.startDate,
        ...lease
      })
    ).toEqual(null);
    const terms = leasePaymentTerms({
      decimals: DECIMALS,
      ...lease,
      discountRate: 6
    });
    for (const timing of ["Advance", "Arrears"] as const) {
      const { create } = generateRentalBillingPeriods({
        decimals: DECIMALS,
        ...lease,
        timing,
        returnedAt: null,
        through: activationBillingThrough({
          classification: "Sale",
          cycle: lease.cycle,
          today: lease.startDate,
          endDate: lease.endDate
        }),
        existing: []
      });
      expect(create.length).toEqual(terms.periods);
      expect(create[create.length - 1]!.periodEnd).toEqual(lease.endDate);
      expect(
        create.every((period) => period.amount === terms.payment)
      ).toBeTruthy();
      expect(
        round(create.reduce((sum, period) => sum + period.amount, 0))
      ).toEqual(round(terms.payment * terms.periods));
      // The schedule follows every one of them.
      expect(scheduleBillingPeriods(create, terms.periods).length).toEqual(
        create.length
      );
    }
  }
});

it("the schedule closes on the option plus both residuals", () => {
  expect(
    leaseClosingTarget({
      purchaseOption: 5000,
      guaranteedResidualValue: 1000,
      unguaranteedResidualValue: 500
    })
  ).toEqual(6500);
});

it("schedule periods are the first regular billing periods, in date order", () => {
  // A mid-month start cuts 13 calendar periods for a 12-month term; the
  // schedule follows the first twelve.
  const { create } = generateRentalBillingPeriods({
    decimals: DECIMALS,
    cycle: "Calendar Month",
    timing: "Arrears",
    ...MONTHLY,
    startDate: "2027-01-15",
    endDate: "2028-01-14",
    returnedAt: null,
    through: "2027-02-28",
    existing: []
  });
  expect(create.length).toEqual(13);
  const spans = scheduleBillingPeriods([...create].reverse(), 12);
  expect(spans.length).toEqual(12);
  expect(spans[0]).toEqual({
    periodStart: "2027-01-15",
    periodEnd: "2027-01-31"
  });
  expect(spans[11]!.periodEnd).toEqual("2027-12-31");

  const withAdjustment = scheduleBillingPeriods(
    [
      {
        periodStart: "2027-01-01",
        periodEnd: "2027-01-31",
        isAdjustment: true
      },
      ...create
    ],
    12
  );
  expect(withAdjustment[0]!.periodStart).toEqual("2027-01-15");
  expect(() => scheduleBillingPeriods(create, 14)).toThrow();
});

it("each interest-earning schedule line spawns one Interest row on its billing period", () => {
  const spans = Array.from({ length: 3 }, (_, i) => ({
    periodStart: `2027-0${i + 1}-01`,
    periodEnd: `2027-0${i + 1}-28`
  }));
  const schedule = buildLessorSchedule({
    netInvestment: 3000,
    payment: 1000,
    periods: 3,
    annualRate: 12,
    timing: "Arrears",
    closingTarget: 0,
    periodDates: spans.map((span) => span.periodEnd)
  });
  const rows = interestRows(schedule, spans);
  expect(rows.length).toEqual(3);
  expect(rows[0]).toEqual({
    index: 0,
    periodStart: "2027-01-01",
    periodEnd: "2027-01-28",
    scheduledDate: "2027-01-28",
    amount: 30
  });

  // A zero rate earns nothing: no rows at all.
  const free = buildLessorSchedule({
    netInvestment: 3000,
    payment: 1000,
    periods: 3,
    annualRate: 0,
    timing: "Arrears",
    closingTarget: 0,
    periodDates: spans.map((span) => span.periodEnd)
  });
  expect(interestRows(free, spans)).toEqual([]);
  expect(() => interestRows(schedule, spans.slice(1))).toThrow();

  // An Advance lease closing on zero: the last line absorbs −0.00001 of
  // rounding drift. That is not interest, so it gets no row.
  const drift = [
    { ...schedule[0]!, interestAmount: 20 },
    { ...schedule[1]!, interestAmount: 10 },
    { ...schedule[2]!, interestAmount: -0.00001 }
  ];
  expect(interestRows(drift, spans).map((row) => row.index)).toEqual([0, 1]);
});

it("commencement books NI, COGS at C − PVres, lease revenue at PVpay and the fleet legs", () => {
  const amounts = commencementAmounts({
    pvPayments: 37049.24083,
    pvResidual: 2000,
    acquisitionCost: 30000,
    accumulatedDepreciation: 6000
  });
  expect(amounts).toEqual({
    netInvestment: 39049.24083,
    carryingAmount: 24000,
    costOfGoodsSold: 22000,
    sellingProfit: 15049.24083
  });

  const lines = buildCommencementLines({
    pvPayments: 37049.24083,
    pvResidual: 2000,
    acquisitionCost: 30000,
    accumulatedDepreciation: 6000,
    accounts: ACCOUNTS
  });
  // Natural-balance signs: asset / expense debits +, revenue credit +,
  // asset credit −.
  expect(lines).toEqual([
    {
      accountId: "1160",
      description: "Net Investment in Leases",
      amount: 39049.24083
    },
    { accountId: "5010", description: "Cost of Goods Sold", amount: 22000 },
    { accountId: "4070", description: "Lease Revenue", amount: 37049.24083 },
    {
      accountId: "1380",
      description: "Accumulated Depreciation",
      amount: 6000
    },
    { accountId: "1370", description: "Fixed Asset Cost", amount: -30000 }
  ]);
  // Debits (1160 + 5010 + 1380) equal credits (4070 + 1370).
  expect(round(39049.24083 + 22000 + 6000)).toEqual(round(37049.24083 + 30000));
});

it("a stand-in lease account carries its own role on the line that uses it", () => {
  // Both lease defaults empty before the cutover: both lines stand in on
  // retained earnings, and each names the default it wanted.
  const lines = buildCommencementLines({
    pvPayments: 37049.24083,
    pvResidual: 2000,
    acquisitionCost: 30000,
    accumulatedDepreciation: 6000,
    accounts: {
      ...ACCOUNTS,
      netInvestmentInLeasesAccountId: "3000",
      leaseRevenueAccountId: "3000"
    },
    accountDefaultRoles: {
      netInvestmentInLeases: "netInvestmentInLeasesAccount",
      leaseRevenue: "leaseRevenueAccount"
    }
  });
  expect(
    lines.map((line) => [line.amount, line.accountDefaultRole ?? null])
  ).toEqual([
    [39049.24083, "netInvestmentInLeasesAccount"],
    [22000, null],
    [37049.24083, "leaseRevenueAccount"],
    [6000, null],
    [-30000, null]
  ]);
  expect(
    buildResidualReturnLines({
      closing: 5000,
      debitAccountId: "1370",
      debitDescription: "Fixed Asset Acquisition",
      netInvestmentInLeasesAccountId: "3000",
      accountDefaultRoles: {
        netInvestmentInLeases: "netInvestmentInLeasesAccount"
      }
    }).map((line) => line.accountDefaultRole ?? null)
  ).toEqual([null, "netInvestmentInLeasesAccount"]);
});

it("an undepreciated unit posts no accumulated depreciation leg", () => {
  const lines = buildCommencementLines({
    pvPayments: 37049.24083,
    pvResidual: 0,
    acquisitionCost: 30000,
    accumulatedDepreciation: 0,
    accounts: ACCOUNTS
  });
  expect(lines.map((line) => line.accountId)).toEqual([
    "1160",
    "5010",
    "4070",
    "1370"
  ]);
});

it("a residual worth more than the carrying amount credits COGS", () => {
  const lines = buildCommencementLines({
    pvPayments: 20000,
    pvResidual: 5000,
    acquisitionCost: 10000,
    accumulatedDepreciation: 7000,
    accounts: ACCOUNTS
  });
  // C = 3,000; C − PVres = −2,000 → a 2,000 credit on an expense account.
  expect(lines.find((line) => line.accountId === "5010")?.amount).toEqual(
    -2000
  );
  expect(
    commencementAmounts({
      pvPayments: 20000,
      pvResidual: 5000,
      acquisitionCost: 10000,
      accumulatedDepreciation: 7000
    }).sellingProfit
  ).toEqual(22000);
});

it("commencement refuses depreciation beyond cost and non-finite amounts", () => {
  expect(() =>
    commencementAmounts({
      pvPayments: 1000,
      pvResidual: 0,
      acquisitionCost: 100,
      accumulatedDepreciation: 200
    })
  ).toThrow();
  expect(() =>
    commencementAmounts({
      pvPayments: Number.NaN,
      pvResidual: 0,
      acquisitionCost: 100,
      accumulatedDepreciation: 0
    })
  ).toThrow();
});

// The worked example's term, cut the way activation cuts it: 36 month-end
// periods, 1,000 in arrears at 6 %, closing on the 5,000 option.
function workedExampleSchedule() {
  const { create } = generateRentalBillingPeriods({
    decimals: DECIMALS,
    cycle: "Calendar Month",
    timing: "Arrears",
    ...MONTHLY,
    startDate: "2027-01-01",
    endDate: "2029-12-31",
    returnedAt: null,
    through: activationBillingThrough({
      classification: "Sale",
      cycle: "Calendar Month",
      today: "2027-01-01",
      endDate: "2029-12-31"
    }),
    existing: []
  });
  const spans = scheduleBillingPeriods(create, 36);
  return buildLessorSchedule({
    netInvestment: 37049.24083,
    payment: 1000,
    periods: 36,
    annualRate: 6,
    timing: "Arrears",
    closingTarget: 5000,
    periodDates: spans.map((span) => span.periodEnd)
  });
}

it("a residual return closes on the schedule, not on what has posted", () => {
  const schedule = workedExampleSchedule();
  expect(schedule[35]!.periodDate).toEqual("2029-12-31");
  const last = schedule[35]!;
  expect(last.interestAmount > 0).toBeTruthy();

  // Returned on the end date with 35 months of interest posted and the last
  // month's still Planned: the residual is the closing target, 5,000.
  const closing = netInvestmentAt({
    initialNetInvestment: 37049.24083,
    schedule,
    asOf: "2029-12-31"
  });
  expect(closing).toEqual(5000);

  // Netting only POSTED principal (the old rule) would have overstated it by
  // the last line's principal and dropped that month's interest.
  const postedPrincipal = schedule
    .slice(0, 35)
    .reduce((sum, line) => sum + line.principalAmount, 0);
  expect(round(37049.24083 - postedPrincipal)).toEqual(
    round(5000 + last.principalAmount)
  );

  // Once the last month's interest posts after the return, Net Investment
  // in Leases is exactly zero: initial + Σ interest − Σ rent − closing.
  const interest = schedule.reduce((sum, line) => sum + line.interestAmount, 0);
  const rent = schedule.reduce((sum, line) => sum + line.paymentAmount, 0);
  expect(round(37049.24083 + interest - rent - closing)).toEqual(0);

  // A holdover return is still the closing target.
  expect(
    netInvestmentAt({
      initialNetInvestment: 37049.24083,
      schedule,
      asOf: "2030-01-15"
    })
  ).toEqual(5000);
});

it("the net investment on a date is the last schedule line's closing on or before it", () => {
  const schedule = workedExampleSchedule();
  // Unordered input: the latest date on or before asOf wins.
  const shuffled = [...schedule].reverse();
  expect(
    netInvestmentAt({
      initialNetInvestment: 37049.24083,
      schedule: shuffled,
      asOf: "2027-01-31"
    })
  ).toEqual(schedule[0]!.closingNetInvestment);
  // Between two lines: the earlier one's closing.
  expect(
    netInvestmentAt({
      initialNetInvestment: 37049.24083,
      schedule: shuffled,
      asOf: "2027-02-27"
    })
  ).toEqual(schedule[0]!.closingNetInvestment);
  // Before the first line, or no schedule at all: the initial NI.
  expect(
    netInvestmentAt({
      initialNetInvestment: 37049.24083,
      schedule,
      asOf: "2027-01-30"
    })
  ).toEqual(37049.24083);
  expect(
    netInvestmentAt({
      initialNetInvestment: 37049.24083,
      schedule: [],
      asOf: "2029-12-31"
    })
  ).toEqual(37049.24083);
});

it("a residual return debits where the unit went and credits the net investment", () => {
  expect(
    buildResidualReturnLines({
      closing: 5000,
      debitAccountId: "1370",
      debitDescription: "Fixed Asset Acquisition",
      netInvestmentInLeasesAccountId: "1160"
    })
  ).toEqual([
    {
      accountId: "1370",
      description: "Fixed Asset Acquisition",
      amount: 5000
    },
    {
      accountId: "1160",
      description: "Net Investment in Leases",
      amount: -5000
    }
  ]);
  expect(
    buildResidualReturnLines({
      closing: 0,
      debitAccountId: "1220",
      debitDescription: "Finished Goods Account",
      netInvestmentInLeasesAccountId: "1160"
    })
  ).toEqual([]);
  expect(() =>
    buildResidualReturnLines({
      closing: -1,
      debitAccountId: "1220",
      debitDescription: "Finished Goods Account",
      netInvestmentInLeasesAccountId: "1160"
    })
  ).toThrow();
});

it("a sales-type return needs a destination, the end of the term, and no maintenance from stock", () => {
  const base = {
    classification: "Sale",
    residualDestination: "Fleet" as const,
    returnedAt: "2029-12-31",
    endDate: "2029-12-31",
    takeOutOfService: false
  };
  expect(salesTypeReturnError(base)).toEqual(null);
  expect(
    salesTypeReturnError({ ...base, residualDestination: undefined })
  ).toEqual(
    "Choose where the returned unit goes: back to the fleet or into inventory"
  );
  expect(salesTypeReturnError({ ...base, returnedAt: "2029-06-30" })).toEqual(
    "Ending a rental treated as a sale early is a manual journal"
  );
  // A holdover past the end is still an end-of-term return.
  expect(salesTypeReturnError({ ...base, returnedAt: "2030-01-15" })).toEqual(
    null
  );
  expect(
    salesTypeReturnError({
      ...base,
      residualDestination: "Inventory",
      takeOutOfService: true
    })?.includes("inventory")
  ).toBeTruthy();
  expect(
    salesTypeReturnError({
      ...base,
      residualDestination: "Fleet",
      takeOutOfService: true
    })
  ).toEqual(null);
});

it("an operating return ignores the destination entirely", () => {
  for (const classification of ["Rental", null]) {
    expect(
      salesTypeReturnError({
        classification,
        residualDestination: undefined,
        returnedAt: "2027-03-01",
        endDate: "2029-12-31",
        takeOutOfService: true
      })
    ).toEqual(null);
  }
});

it("flags a net investment worth more than the unit's fair value", () => {
  // 2 × 12,000 at 0.5 % a month plus a 2,000 residual is 25,801.34 — above a
  // 24,000 fair value, so the entered rate is below the rate implicit in
  // the lease.
  expect(
    netInvestmentExceedsFairValue({
      netInvestment: 25801.34,
      fairValue: 24000,
      decimals: DECIMALS
    })
  ).toBe(true);
  expect(
    netInvestmentExceedsFairValue({
      netInvestment: 23816.24,
      fairValue: 24000,
      decimals: DECIMALS
    })
  ).toBe(false);
  // Equal at settlement precision is not above it.
  expect(
    netInvestmentExceedsFairValue({
      netInvestment: 24000.00001,
      fairValue: 24000,
      decimals: DECIMALS
    })
  ).toBe(false);
  // No fair value: nothing to compare (activation refuses it separately).
  expect(
    netInvestmentExceedsFairValue({
      netInvestment: 1,
      fairValue: null,
      decimals: DECIMALS
    })
  ).toBe(false);
});
