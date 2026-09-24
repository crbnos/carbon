import {
  assert,
  assertEquals,
  assertThrows,
} from "https://deno.land/std@0.175.0/testing/asserts.ts";
import {
  buildLessorSchedule,
  earnsInterest,
  classifyLessorLease,
  presentValue,
} from "./lessor-lease.ts";

// The worked example: 36 monthly payments of 1,000 in arrears at 6 % a year,
// with a 5,000 purchase option. Plan figures are to the cent; amounts here are
// at internal scale (5 decimals) and agree with them at the cent.
const LEASE = {
  payment: 1000,
  periods: 36,
  annualRate: 6,
  timing: "Arrears" as const,
};
const THRESHOLDS = { majorPartPercent: 75, substantiallyAllPercent: 90 };
const DATES = Array.from(
  { length: 36 },
  (_, i) =>
    `${2027 + (i - (i % 12)) / 12}-${String((i % 12) + 1).padStart(2, "0")}-01`,
);

Deno.test("present value folds a reasonably certain purchase option into the lease payments", () => {
  assertEquals(presentValue({ ...LEASE, purchaseOption: 5000 }), {
    pvRent: 32871.01624, // 32,871.02
    pvPayments: 37049.24083, // + option PV 4,178.22 = 37,049.24
    pvResidual: 0,
    netInvestment: 37049.24083,
  });
});

Deno.test("an unguaranteed residual is in the net investment but not the lease payments", () => {
  const withGuarantee = presentValue({ ...LEASE, guaranteedResidual: 5000 });
  const withoutGuarantee = presentValue({
    ...LEASE,
    unguaranteedResidual: 5000,
  });
  assertEquals(withGuarantee.pvPayments, 37049.24083);
  assertEquals(withGuarantee.pvResidual, 0);
  assertEquals(withoutGuarantee.pvPayments, 32871.01624);
  assertEquals(withoutGuarantee.pvResidual, 4178.22459);
  assertEquals(withoutGuarantee.netInvestment, withGuarantee.netInvestment);
});

Deno.test("billing in advance is an annuity-due, worth more than the same stream in arrears", () => {
  const advance = presentValue({ ...LEASE, timing: "Advance" });
  const arrears = presentValue(LEASE);
  assertEquals(advance.pvRent, 33035.37132);
  assert(advance.pvRent > arrears.pvRent);
});

Deno.test("a zero rate is the undiscounted sum", () => {
  assertEquals(
    presentValue({
      ...LEASE,
      annualRate: 0,
      purchaseOption: 5000,
      unguaranteedResidual: 2000,
    }),
    {
      pvRent: 36000,
      pvPayments: 41000,
      pvResidual: 2000,
      netInvestment: 43000,
    },
  );
});

Deno.test("present value refuses a partial term and a negative rate", () => {
  assertThrows(() => presentValue({ ...LEASE, periods: 0 }));
  assertThrows(() => presentValue({ ...LEASE, periods: 1.5 }));
  assertThrows(() => presentValue({ ...LEASE, annualRate: -1 }));
});

Deno.test("a reasonably certain purchase option makes it Sales-Type (97.5 % of fair value)", () => {
  const result = classifyLessorLease(
    {
      ownershipTransfers: false,
      purchaseOptionReasonablyCertain: true,
      termMonths: 36,
      economicLifeMonths: 120,
      pvPayments: 37049.24083,
      fairValue: 38000,
      specializedAsset: false,
    },
    THRESHOLDS,
  );
  assertEquals(result.classification, "Sales-Type");
  assertEquals(result.tests, { a: false, b: true, c: false, d: true, e: false });
  assertEquals(result.pvToFairValuePercent, 97.498);
  assertEquals(result.termToLifePercent, 30);
});

Deno.test("no test met is Operating (54.8 % of fair value, 30 % of life)", () => {
  const result = classifyLessorLease(
    {
      ownershipTransfers: false,
      purchaseOptionReasonablyCertain: false,
      termMonths: 36,
      economicLifeMonths: 120,
      pvPayments: 32871.01624,
      fairValue: 60000,
      specializedAsset: false,
    },
    THRESHOLDS,
  );
  assertEquals(result.classification, "Operating");
  assertEquals(result.pvToFairValuePercent, 54.78503);
  assertEquals(result.termToLifePercent, 30);
});

Deno.test("a term over the major-part threshold of the economic life is Sales-Type", () => {
  const result = classifyLessorLease(
    {
      ownershipTransfers: false,
      purchaseOptionReasonablyCertain: false,
      termMonths: 96,
      economicLifeMonths: 120,
      pvPayments: 10000,
      fairValue: 60000,
      specializedAsset: false,
    },
    THRESHOLDS,
  );
  assertEquals(result.tests.c, true);
  assertEquals(result.termToLifePercent, 80);
  assertEquals(result.classification, "Sales-Type");
});

Deno.test("an open-ended agreement is Operating even when a test is met", () => {
  const result = classifyLessorLease(
    {
      ownershipTransfers: true,
      purchaseOptionReasonablyCertain: false,
      termMonths: null,
      economicLifeMonths: 120,
      pvPayments: 1000,
      fairValue: null,
      specializedAsset: true,
    },
    THRESHOLDS,
  );
  assertEquals(result.classification, "Operating");
  assertEquals(result.tests.a, true);
  assertEquals(result.tests.c, false);
  assertEquals(result.tests.d, false);
  assertEquals(result.termToLifePercent, null);
  assertEquals(result.pvToFairValuePercent, null);
});

Deno.test("the effective-interest schedule closes on the purchase option exactly", () => {
  const schedule = buildLessorSchedule({
    ...LEASE,
    netInvestment: 37049.24083,
    closingTarget: 5000,
    periodDates: DATES,
  });
  assertEquals(schedule.length, 36);
  assertEquals(schedule[0], {
    periodDate: "2027-01-01",
    openingNetInvestment: 37049.24083,
    paymentAmount: 1000,
    interestAmount: 185.2462, // 185.25
    principalAmount: 814.7538, // 814.75
    closingNetInvestment: 36234.48703, // 36,234.49
  });
  assertEquals(schedule[35].periodDate, "2029-12-01");
  assertEquals(schedule[35].closingNetInvestment, 5000);
  // Every line opens on the previous close.
  for (let i = 1; i < schedule.length; i++) {
    assertEquals(
      schedule[i].openingNetInvestment,
      schedule[i - 1].closingNetInvestment,
    );
  }
  // The last line's interest absorbs only rounding drift.
  const last = schedule[35];
  assert(
    Math.abs(last.interestAmount - last.openingNetInvestment * 0.005) < 0.001,
  );
});

Deno.test("in advance the payment lands first and interest accrues on the remainder", () => {
  const { netInvestment } = presentValue({
    ...LEASE,
    timing: "Advance",
    purchaseOption: 5000,
  });
  const schedule = buildLessorSchedule({
    ...LEASE,
    timing: "Advance",
    netInvestment,
    closingTarget: 5000,
    periodDates: DATES,
  });
  assertEquals(schedule[0].interestAmount, 181.06798); // (37,213.60 − 1,000) × 0.5 %
  assertEquals(schedule[35].closingNetInvestment, 5000);
});

Deno.test("a zero-rate schedule is straight principal", () => {
  const schedule = buildLessorSchedule({
    ...LEASE,
    annualRate: 0,
    netInvestment: 41000,
    closingTarget: 5000,
    periodDates: DATES,
  });
  assert(schedule.every((line) => line.interestAmount === 0));
  assert(schedule.every((line) => line.principalAmount === 1000));
  assertEquals(schedule[0].closingNetInvestment, 40000);
  assertEquals(schedule[35].closingNetInvestment, 5000);
});

Deno.test("the schedule needs one date per period", () => {
  assertThrows(() =>
    buildLessorSchedule({
      ...LEASE,
      netInvestment: 37049.24083,
      closingTarget: 5000,
      periodDates: DATES.slice(1),
    })
  );
});

Deno.test("only real interest is posted: not zero, not one unit of closing drift", () => {
  assertEquals(earnsInterest(185.25), true);
  assertEquals(earnsInterest(-0.5), true);
  assertEquals(earnsInterest(0), false);
  assertEquals(earnsInterest(0.000001), false);
  // An Advance lease closing on zero ends one unit below zero.
  assertEquals(earnsInterest(-0.00001), false);
  assertEquals(earnsInterest(-0.00002), true);
});
