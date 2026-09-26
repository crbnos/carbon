import {
  assert,
  assertEquals,
  assertThrows,
} from "https://deno.land/std@0.175.0/testing/asserts.ts";
import { buildLessorSchedule } from "../shared/lessor-lease.ts";
import { round } from "../shared/precision.ts";
import { generateRentalBillingPeriods } from "../shared/rental-billing.ts";
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
  wholeMonthsInTerm,
} from "./lessor.ts";

const THRESHOLDS = { majorPartPercent: 75, substantiallyAllPercent: 90 };
const LADDER = { dayRate: 50, weekRate: 300, monthRate: 1000 };
// The plan's worked example: 36 × 1,000 in arrears at 6 %, a reasonably
// certain 5,000 purchase option, fair value 38,000.
const AGREEMENT = {
  ownershipTransfers: false,
  specializedAsset: false,
  purchaseOptionAmount: 5000,
  purchaseOptionReasonablyCertain: true,
};
const LINE = {
  fairValue: 38000,
  economicLifeMonths: 120,
  guaranteedResidualValue: 0,
  unguaranteedResidualValue: 0,
};
const ACCOUNTS = {
  netInvestmentInLeasesAccountId: "1160",
  costOfGoodsSoldAccountId: "5010",
  leaseRevenueAccountId: "4070",
  assetAccountId: "1370",
  accumulatedDepreciationAccountId: "1380",
};

Deno.test("a term counts whole calendar months, both ends inclusive", () => {
  assertEquals(wholeMonthsInTerm("2027-01-01", "2029-12-31"), 36);
  assertEquals(wholeMonthsInTerm("2027-01-15", "2028-01-14"), 12);
  assertEquals(wholeMonthsInTerm("2027-01-15", "2028-01-13"), 11);
  assertEquals(wholeMonthsInTerm("2027-01-15", "2027-02-10"), 0);
  assertThrows(() => wholeMonthsInTerm("2027-02-01", "2027-01-31"));
});

Deno.test("a Calendar Month line pays the month rate once per whole month at the agreement's rate", () => {
  assertEquals(
    leasePaymentTerms({
      cycle: "Calendar Month",
      rateMode: "Best Rate",
      rateUnit: null,
      rates: LADDER,
      discountRate: 6,
      startDate: "2027-01-01",
      endDate: "2029-12-31",
    }),
    { termMonths: 36, payment: 1000, periods: 36, annualRate: 6 },
  );
});

Deno.test("an open-ended or sub-month line is valued over one period", () => {
  const openEnded = leasePaymentTerms({
    cycle: "Calendar Month",
    rateMode: "Best Rate",
    rateUnit: null,
    rates: LADDER,
    discountRate: 6,
    startDate: "2027-01-01",
    endDate: null,
  });
  assertEquals(openEnded.termMonths, null);
  assertEquals(openEnded.periods, 1);

  const short = leasePaymentTerms({
    cycle: "28 Days",
    rateMode: "Best Rate",
    rateUnit: null,
    rates: LADDER,
    discountRate: 6,
    startDate: "2027-01-01",
    endDate: "2027-01-20",
  });
  assertEquals(short.termMonths, 0);
  assertEquals(short.periods, 1);
});

Deno.test("a 28 Days line pays the 28-day charge per whole 28 days, at the rate scaled to 28/365 a period", () => {
  const terms = leasePaymentTerms({
    cycle: "28 Days",
    rateMode: "Best Rate",
    rateUnit: null,
    rates: LADDER,
    discountRate: 6,
    startDate: "2027-01-01",
    // 364 days: thirteen 28-day periods
    endDate: "2027-12-30",
  });
  // Best rate for 28 days: one month tier (1,000) beats 4 weeks (1,200).
  assertEquals(terms.payment, 1000);
  assertEquals(terms.periods, 13);
  assertEquals(terms.termMonths, 11);
  // 6 × 12 × 28 / 365 = 5.52329, so presentValue's annual/100/12 is
  // 0.0046027 a period = 6 % × 28 / 365.
  assertEquals(terms.annualRate, 5.52329);
  assert(Math.abs(terms.annualRate / 100 / 12 - (0.06 * 28) / 365) < 1e-7);

  // One day short of the thirteenth period: twelve whole periods.
  assertEquals(
    leasePaymentTerms({
      cycle: "28 Days",
      rateMode: "Best Rate",
      rateUnit: null,
      rates: LADDER,
      discountRate: 6,
      startDate: "2027-01-01",
      endDate: "2027-12-29",
    }).periods,
    12,
  );
});

Deno.test("a Fixed 28 Days line pays its own tier over 28 days", () => {
  assertEquals(
    leasePaymentTerms({
      cycle: "28 Days",
      rateMode: "Fixed",
      rateUnit: "Week",
      rates: LADDER,
      discountRate: 6,
      startDate: "2027-01-01",
      endDate: "2027-12-30",
    }).payment,
    1200,
  );
});

Deno.test("only a reasonably certain purchase option counts", () => {
  assertEquals(certainPurchaseOption(AGREEMENT), 5000);
  assertEquals(
    certainPurchaseOption({
      ...AGREEMENT,
      purchaseOptionReasonablyCertain: false,
    }),
    0,
  );
  assertEquals(
    certainPurchaseOption({ ...AGREEMENT, purchaseOptionAmount: null }),
    0,
  );
});

Deno.test("classification stores its inputs, thresholds, tests and present values", () => {
  const terms = {
    termMonths: 36,
    payment: 1000,
    periods: 36,
    annualRate: 6,
  };
  const { classification, record } = classifyRentalLine({
    terms,
    timing: "Arrears",
    agreement: AGREEMENT,
    line: LINE,
    thresholds: THRESHOLDS,
  });
  assertEquals(classification, "Sales-Type");
  assertEquals(record, {
    inputs: {
      ownershipTransfers: false,
      purchaseOptionReasonablyCertain: true,
      termMonths: 36,
      economicLifeMonths: 120,
      pvPayments: 37049.24083,
      fairValue: 38000,
      specializedAsset: false,
    },
    thresholds: { majorPartPercent: 75, substantiallyAllPercent: 90 },
    tests: { a: false, b: true, c: false, d: true, e: false },
    pvToFairValuePercent: 97.49800,
    termToLifePercent: 30,
    pv: {
      pvRent: 32871.01624,
      pvPayments: 37049.24083,
      pvResidual: 0,
      netInvestment: 37049.24083,
    },
    payment: 1000,
    periods: 36,
    annualRate: 6,
    timing: "Arrears",
  });
});

Deno.test("an uncertain option on a 60,000 unit is Operating", () => {
  const { classification, record } = classifyRentalLine({
    terms: { termMonths: 36, payment: 1000, periods: 36, annualRate: 6 },
    timing: "Arrears",
    agreement: { ...AGREEMENT, purchaseOptionReasonablyCertain: false },
    line: { ...LINE, fairValue: 60000 },
    thresholds: THRESHOLDS,
  });
  assertEquals(classification, "Operating");
  assertEquals(record.pv.pvPayments, 32871.01624);
});

Deno.test("the net investment is the sum of the two rounded present values", () => {
  const { record } = classifyRentalLine({
    terms: { termMonths: 36, payment: 1000, periods: 36, annualRate: 6 },
    timing: "Advance",
    agreement: AGREEMENT,
    line: { ...LINE, unguaranteedResidualValue: 2000 },
    thresholds: THRESHOLDS,
  });
  assertEquals(
    record.pv.netInvestment,
    round(record.pv.pvPayments + record.pv.pvResidual),
  );
});

Deno.test("an override keeps its stored classification; otherwise the tests decide", () => {
  assertEquals(
    settledClassification("Sales-Type", {
      classificationOverride: true,
      lessorClassification: "Operating",
    }),
    "Operating",
  );
  assertEquals(
    settledClassification("Sales-Type", {
      classificationOverride: false,
      lessorClassification: "Operating",
    }),
    "Sales-Type",
  );
  // An override with nothing stored falls back to the tests.
  assertEquals(
    settledClassification("Operating", {
      classificationOverride: true,
      lessorClassification: null,
    }),
    "Operating",
  );
});

Deno.test("a sales-type line needs an end date and a fair value", () => {
  const base = {
    name: "FA-1",
    cycle: "Calendar Month" as const,
    startDate: "2027-01-01",
    endDate: "2029-12-31",
    fairValue: 38000,
  };
  assertEquals(salesTypeRequirementError(base), null);
  assert(
    salesTypeRequirementError({ ...base, endDate: null })?.includes("end date"),
  );
  assert(
    salesTypeRequirementError({ ...base, fairValue: null })?.includes(
      "fair value",
    ),
  );
  assert(
    salesTypeRequirementError({ ...base, fairValue: 0 })?.includes(
      "fair value",
    ),
  );
});

Deno.test("a Calendar Month sales-type lease starts on the first and ends on a month end", () => {
  const base = {
    name: "FA-1",
    cycle: "Calendar Month" as const,
    startDate: "2027-01-01",
    endDate: "2029-12-31",
    fairValue: 38000,
  };
  const message =
    "FA-1 is a sales-type lease, which runs whole billing periods: start on the first of a month and end on a month end";
  // A mid-month start bills a pro-rata first and last month the level
  // payment valuation does not contain.
  assertEquals(
    salesTypeRequirementError({
      ...base,
      startDate: "2027-01-15",
      endDate: "2028-01-14",
    }),
    message,
  );
  assertEquals(
    salesTypeRequirementError({ ...base, endDate: "2029-12-30" }),
    message,
  );
  assertEquals(
    salesTypeRequirementError({ ...base, startDate: "2027-01-02" }),
    message,
  );
  // February's month end, leap year or not.
  assertEquals(
    salesTypeRequirementError({ ...base, endDate: "2028-02-29" }),
    null,
  );
  assertEquals(
    salesTypeRequirementError({ ...base, endDate: "2027-02-28" }),
    null,
  );
});

Deno.test("a 28 Days sales-type lease runs a whole number of 28-day periods", () => {
  const base = {
    name: "FA-1",
    cycle: "28 Days" as const,
    startDate: "2027-01-01",
    // 364 days: thirteen periods
    endDate: "2027-12-30",
    fairValue: 38000,
  };
  assertEquals(salesTypeRequirementError(base), null);
  // A 28 Days term need not start on the first.
  assertEquals(
    salesTypeRequirementError({
      ...base,
      startDate: "2027-01-15",
      endDate: "2027-02-11",
    }),
    null,
  );
  assertEquals(
    salesTypeRequirementError({ ...base, endDate: "2027-12-31" }),
    "FA-1 is a sales-type lease, which runs whole billing periods: the term must be a whole number of 28-day periods (it is 365 days)",
  );
  assert(
    salesTypeRequirementError({ ...base, endDate: "2027-12-29" })?.includes(
      "whole number of 28-day periods",
    ),
  );
});

Deno.test("activation cuts an operating line to the horizon and a sales-type line to its end date", () => {
  const args = {
    cycle: "Calendar Month" as const,
    today: "2027-01-10",
    endDate: "2027-01-31",
  };
  // Operating: the billing horizon (end of next month), holdover and all.
  assertEquals(
    activationBillingThrough({ ...args, classification: "Operating" }),
    "2027-02-28",
  );
  // Sales-Type: capped at the end date.
  assertEquals(
    activationBillingThrough({ ...args, classification: "Sales-Type" }),
    "2027-01-31",
  );
  // An end date beyond the horizon: the horizon, and the term is still cut
  // in full because the generator runs a fixed term to its end.
  assertEquals(
    activationBillingThrough({
      ...args,
      classification: "Sales-Type",
      endDate: "2029-12-31",
    }),
    "2027-02-28",
  );
  assertThrows(() =>
    activationBillingThrough({
      ...args,
      classification: "Sales-Type",
      endDate: null,
    })
  );
});

Deno.test("a sales-type line whose term ends inside the horizon bills nothing past its end date", () => {
  const generate = (classification: "Operating" | "Sales-Type") =>
    generateRentalBillingPeriods({
      cycle: "28 Days",
      timing: "Arrears",
      rateMode: "Best Rate",
      rateUnit: null,
      rates: LADDER,
      startDate: "2027-01-01",
      // Two whole 28-day periods, ending before today + 28.
      endDate: "2027-02-25",
      returnedAt: null,
      through: activationBillingThrough({
        classification,
        cycle: "28 Days",
        today: "2027-02-20",
        endDate: "2027-02-25",
      }),
      existing: [],
    }).create;

  const salesType = generate("Sales-Type");
  assertEquals(salesType.map((period) => period.periodEnd), [
    "2027-01-28",
    "2027-02-25",
  ]);
  // The operating line keeps its holdover period, as before.
  const operating = generate("Operating");
  assert(operating.length > salesType.length);
  assert(operating.some((period) => period.periodStart > "2027-02-25"));
});

Deno.test("a whole-period sales-type lease bills exactly payment × periods", () => {
  const cases = [
    {
      cycle: "Calendar Month" as const,
      rateMode: "Best Rate" as const,
      rateUnit: null,
      startDate: "2027-01-01",
      endDate: "2029-12-31",
    },
    {
      cycle: "Calendar Month" as const,
      rateMode: "Best Rate" as const,
      rateUnit: null,
      // Through two Februaries, one of them a leap year.
      startDate: "2027-02-01",
      endDate: "2028-03-31",
    },
    {
      cycle: "28 Days" as const,
      rateMode: "Best Rate" as const,
      rateUnit: null,
      startDate: "2027-01-01",
      endDate: "2027-12-30",
    },
    {
      cycle: "28 Days" as const,
      rateMode: "Fixed" as const,
      rateUnit: "Week" as const,
      startDate: "2027-03-17",
      endDate: "2027-06-08",
    },
  ];
  for (const lease of cases) {
    assertEquals(
      salesTypeRequirementError({ name: "FA-1", fairValue: 38000, ...lease }),
      null,
    );
    const terms = leasePaymentTerms({
      ...lease,
      rates: LADDER,
      discountRate: 6,
    });
    for (const timing of ["Advance", "Arrears"] as const) {
      const { create } = generateRentalBillingPeriods({
        ...lease,
        timing,
        rates: LADDER,
        returnedAt: null,
        through: activationBillingThrough({
          classification: "Sales-Type",
          cycle: lease.cycle,
          today: lease.startDate,
          endDate: lease.endDate,
        }),
        existing: [],
      });
      assertEquals(create.length, terms.periods);
      assertEquals(create[create.length - 1].periodEnd, lease.endDate);
      assert(create.every((period) => period.amount === terms.payment));
      assertEquals(
        round(create.reduce((sum, period) => sum + period.amount, 0)),
        round(terms.payment * terms.periods),
      );
      // The schedule follows every one of them.
      assertEquals(scheduleBillingPeriods(create, terms.periods).length, create.length);
    }
  }
});

Deno.test("the schedule closes on the option plus both residuals", () => {
  assertEquals(
    leaseClosingTarget({
      purchaseOption: 5000,
      guaranteedResidualValue: 1000,
      unguaranteedResidualValue: 500,
    }),
    6500,
  );
});

Deno.test("schedule periods are the first regular billing periods, in date order", () => {
  // A mid-month start cuts 13 calendar periods for a 12-month term; the
  // schedule follows the first twelve.
  const { create } = generateRentalBillingPeriods({
    cycle: "Calendar Month",
    timing: "Arrears",
    rateMode: "Best Rate",
    rateUnit: null,
    rates: LADDER,
    startDate: "2027-01-15",
    endDate: "2028-01-14",
    returnedAt: null,
    through: "2027-02-28",
    existing: [],
  });
  assertEquals(create.length, 13);
  const spans = scheduleBillingPeriods([...create].reverse(), 12);
  assertEquals(spans.length, 12);
  assertEquals(spans[0], { periodStart: "2027-01-15", periodEnd: "2027-01-31" });
  assertEquals(spans[11].periodEnd, "2027-12-31");

  const withAdjustment = scheduleBillingPeriods([
    {
      periodStart: "2027-01-01",
      periodEnd: "2027-01-31",
      isAdjustment: true,
    },
    ...create,
  ], 12);
  assertEquals(withAdjustment[0].periodStart, "2027-01-15");
  assertThrows(() => scheduleBillingPeriods(create, 14));
});

Deno.test("each interest-earning schedule line spawns one Interest row on its billing period", () => {
  const spans = Array.from({ length: 3 }, (_, i) => ({
    periodStart: `2027-0${i + 1}-01`,
    periodEnd: `2027-0${i + 1}-28`,
  }));
  const schedule = buildLessorSchedule({
    netInvestment: 3000,
    payment: 1000,
    periods: 3,
    annualRate: 12,
    timing: "Arrears",
    closingTarget: 0,
    periodDates: spans.map((span) => span.periodEnd),
  });
  const rows = interestRows(schedule, spans);
  assertEquals(rows.length, 3);
  assertEquals(rows[0], {
    index: 0,
    periodStart: "2027-01-01",
    periodEnd: "2027-01-28",
    scheduledDate: "2027-01-28",
    amount: 30,
  });

  // A zero rate earns nothing: no rows at all.
  const free = buildLessorSchedule({
    netInvestment: 3000,
    payment: 1000,
    periods: 3,
    annualRate: 0,
    timing: "Arrears",
    closingTarget: 0,
    periodDates: spans.map((span) => span.periodEnd),
  });
  assertEquals(interestRows(free, spans), []);
  assertThrows(() => interestRows(schedule, spans.slice(1)));

  // An Advance lease closing on zero: the last line absorbs −0.00001 of
  // rounding drift. That is not interest, so it gets no row.
  const drift = [
    { ...schedule[0], interestAmount: 20 },
    { ...schedule[1], interestAmount: 10 },
    { ...schedule[2], interestAmount: -0.00001 },
  ];
  assertEquals(
    interestRows(drift, spans).map((row) => row.index),
    [0, 1],
  );
});

Deno.test("commencement books NI, COGS at C − PVres, lease revenue at PVpay and the fleet legs", () => {
  const amounts = commencementAmounts({
    pvPayments: 37049.24083,
    pvResidual: 2000,
    acquisitionCost: 30000,
    accumulatedDepreciation: 6000,
  });
  assertEquals(amounts, {
    netInvestment: 39049.24083,
    carryingAmount: 24000,
    costOfGoodsSold: 22000,
    sellingProfit: 15049.24083,
  });

  const lines = buildCommencementLines({
    pvPayments: 37049.24083,
    pvResidual: 2000,
    acquisitionCost: 30000,
    accumulatedDepreciation: 6000,
    accounts: ACCOUNTS,
  });
  // Natural-balance signs: asset / expense debits +, revenue credit +,
  // asset credit −.
  assertEquals(lines, [
    {
      accountId: "1160",
      description: "Net Investment in Leases",
      amount: 39049.24083,
    },
    { accountId: "5010", description: "Cost of Goods Sold", amount: 22000 },
    { accountId: "4070", description: "Lease Revenue", amount: 37049.24083 },
    {
      accountId: "1380",
      description: "Accumulated Depreciation",
      amount: 6000,
    },
    { accountId: "1370", description: "Fixed Asset Cost", amount: -30000 },
  ]);
  // Debits (1160 + 5010 + 1380) equal credits (4070 + 1370).
  assertEquals(round(39049.24083 + 22000 + 6000), round(37049.24083 + 30000));
});

Deno.test("an undepreciated unit posts no accumulated depreciation leg", () => {
  const lines = buildCommencementLines({
    pvPayments: 37049.24083,
    pvResidual: 0,
    acquisitionCost: 30000,
    accumulatedDepreciation: 0,
    accounts: ACCOUNTS,
  });
  assertEquals(lines.map((line) => line.accountId), [
    "1160",
    "5010",
    "4070",
    "1370",
  ]);
});

Deno.test("a residual worth more than the carrying amount credits COGS", () => {
  const lines = buildCommencementLines({
    pvPayments: 20000,
    pvResidual: 5000,
    acquisitionCost: 10000,
    accumulatedDepreciation: 7000,
    accounts: ACCOUNTS,
  });
  // C = 3,000; C − PVres = −2,000 → a 2,000 credit on an expense account.
  assertEquals(
    lines.find((line) => line.accountId === "5010")?.amount,
    -2000,
  );
  assertEquals(
    commencementAmounts({
      pvPayments: 20000,
      pvResidual: 5000,
      acquisitionCost: 10000,
      accumulatedDepreciation: 7000,
    }).sellingProfit,
    22000,
  );
});

Deno.test("commencement refuses depreciation beyond cost and non-finite amounts", () => {
  assertThrows(() =>
    commencementAmounts({
      pvPayments: 1000,
      pvResidual: 0,
      acquisitionCost: 100,
      accumulatedDepreciation: 200,
    })
  );
  assertThrows(() =>
    commencementAmounts({
      pvPayments: Number.NaN,
      pvResidual: 0,
      acquisitionCost: 100,
      accumulatedDepreciation: 0,
    })
  );
});

// The worked example's term, cut the way activation cuts it: 36 month-end
// periods, 1,000 in arrears at 6 %, closing on the 5,000 option.
function workedExampleSchedule() {
  const { create } = generateRentalBillingPeriods({
    cycle: "Calendar Month",
    timing: "Arrears",
    rateMode: "Best Rate",
    rateUnit: null,
    rates: LADDER,
    startDate: "2027-01-01",
    endDate: "2029-12-31",
    returnedAt: null,
    through: activationBillingThrough({
      classification: "Sales-Type",
      cycle: "Calendar Month",
      today: "2027-01-01",
      endDate: "2029-12-31",
    }),
    existing: [],
  });
  const spans = scheduleBillingPeriods(create, 36);
  return buildLessorSchedule({
    netInvestment: 37049.24083,
    payment: 1000,
    periods: 36,
    annualRate: 6,
    timing: "Arrears",
    closingTarget: 5000,
    periodDates: spans.map((span) => span.periodEnd),
  });
}

Deno.test("a residual return closes on the schedule, not on what has posted", () => {
  const schedule = workedExampleSchedule();
  assertEquals(schedule[35].periodDate, "2029-12-31");
  const last = schedule[35];
  assert(last.interestAmount > 0);

  // Returned on the end date with 35 months of interest posted and the last
  // month's still Planned: the residual is the closing target, 5,000.
  const closing = netInvestmentAt({
    initialNetInvestment: 37049.24083,
    schedule,
    asOf: "2029-12-31",
  });
  assertEquals(closing, 5000);

  // Netting only POSTED principal (the old rule) would have overstated it by
  // the last line's principal and dropped that month's interest.
  const postedPrincipal = schedule
    .slice(0, 35)
    .reduce((sum, line) => sum + line.principalAmount, 0);
  assertEquals(
    round(37049.24083 - postedPrincipal),
    round(5000 + last.principalAmount),
  );

  // Once the last month's interest posts after the return, Net Investment
  // in Leases is exactly zero: initial + Σ interest − Σ rent − closing.
  const interest = schedule.reduce((sum, line) => sum + line.interestAmount, 0);
  const rent = schedule.reduce((sum, line) => sum + line.paymentAmount, 0);
  assertEquals(round(37049.24083 + interest - rent - closing), 0);

  // A holdover return is still the closing target.
  assertEquals(
    netInvestmentAt({
      initialNetInvestment: 37049.24083,
      schedule,
      asOf: "2030-01-15",
    }),
    5000,
  );
});

Deno.test("the net investment on a date is the last schedule line's closing on or before it", () => {
  const schedule = workedExampleSchedule();
  // Unordered input: the latest date on or before asOf wins.
  const shuffled = [...schedule].reverse();
  assertEquals(
    netInvestmentAt({
      initialNetInvestment: 37049.24083,
      schedule: shuffled,
      asOf: "2027-01-31",
    }),
    schedule[0].closingNetInvestment,
  );
  // Between two lines: the earlier one's closing.
  assertEquals(
    netInvestmentAt({
      initialNetInvestment: 37049.24083,
      schedule: shuffled,
      asOf: "2027-02-27",
    }),
    schedule[0].closingNetInvestment,
  );
  // Before the first line, or no schedule at all: the initial NI.
  assertEquals(
    netInvestmentAt({
      initialNetInvestment: 37049.24083,
      schedule,
      asOf: "2027-01-30",
    }),
    37049.24083,
  );
  assertEquals(
    netInvestmentAt({
      initialNetInvestment: 37049.24083,
      schedule: [],
      asOf: "2029-12-31",
    }),
    37049.24083,
  );
});

Deno.test("a residual return debits where the unit went and credits the net investment", () => {
  assertEquals(
    buildResidualReturnLines({
      closing: 5000,
      debitAccountId: "1370",
      debitDescription: "Fixed Asset Acquisition",
      netInvestmentInLeasesAccountId: "1160",
    }),
    [
      {
        accountId: "1370",
        description: "Fixed Asset Acquisition",
        amount: 5000,
      },
      {
        accountId: "1160",
        description: "Net Investment in Leases",
        amount: -5000,
      },
    ],
  );
  assertEquals(
    buildResidualReturnLines({
      closing: 0,
      debitAccountId: "1220",
      debitDescription: "Finished Goods Account",
      netInvestmentInLeasesAccountId: "1160",
    }),
    [],
  );
  assertThrows(() =>
    buildResidualReturnLines({
      closing: -1,
      debitAccountId: "1220",
      debitDescription: "Finished Goods Account",
      netInvestmentInLeasesAccountId: "1160",
    })
  );
});

Deno.test("a sales-type return needs a destination, the end of the term, and no maintenance from stock", () => {
  const base = {
    classification: "Sales-Type",
    residualDestination: "Fleet" as const,
    returnedAt: "2029-12-31",
    endDate: "2029-12-31",
    takeOutOfService: false,
  };
  assertEquals(salesTypeReturnError(base), null);
  assertEquals(
    salesTypeReturnError({ ...base, residualDestination: undefined }),
    "Choose where the returned unit goes: back to the fleet or into inventory",
  );
  assertEquals(
    salesTypeReturnError({ ...base, returnedAt: "2029-06-30" }),
    "Early termination of a sales-type lease is a manual journal",
  );
  // A holdover past the end is still an end-of-term return.
  assertEquals(salesTypeReturnError({ ...base, returnedAt: "2030-01-15" }), null);
  assert(
    salesTypeReturnError({
      ...base,
      residualDestination: "Inventory",
      takeOutOfService: true,
    })?.includes("inventory"),
  );
  assertEquals(
    salesTypeReturnError({ ...base, residualDestination: "Fleet", takeOutOfService: true }),
    null,
  );
});

Deno.test("an operating return ignores the destination entirely", () => {
  for (const classification of ["Operating", null]) {
    assertEquals(
      salesTypeReturnError({
        classification,
        residualDestination: undefined,
        returnedAt: "2027-03-01",
        endDate: "2029-12-31",
        takeOutOfService: true,
      }),
      null,
    );
  }
});
