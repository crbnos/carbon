// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { expect, it } from "vitest";

import {
  buildLessorSchedule,
  classifyLessorLease,
  earnsInterest,
  presentValue
} from "./lessor-lease.ts";

// The worked example: 36 monthly payments of 1,000 in arrears at 6 % a year,
// with a 5,000 purchase option. Plan figures are to the cent; amounts here are
// at internal scale (5 decimals) and agree with them at the cent.
const LEASE = {
  payment: 1000,
  periods: 36,
  annualRate: 6,
  timing: "Arrears" as const
};
const THRESHOLDS = { majorPartPercent: 75, substantiallyAllPercent: 90 };
const DATES = Array.from(
  { length: 36 },
  (_, i) =>
    `${2027 + (i - (i % 12)) / 12}-${String((i % 12) + 1).padStart(2, "0")}-01`
);

it("present value folds a reasonably certain purchase option into the lease payments", () => {
  expect(presentValue({ ...LEASE, purchaseOption: 5000 })).toEqual({
    pvRent: 32871.01624, // 32,871.02
    pvPayments: 37049.24083, // + option PV 4,178.22 = 37,049.24
    pvResidual: 0,
    netInvestment: 37049.24083
  });
});

it("an unguaranteed residual is in the net investment but not the lease payments", () => {
  const withGuarantee = presentValue({ ...LEASE, guaranteedResidual: 5000 });
  const withoutGuarantee = presentValue({
    ...LEASE,
    unguaranteedResidual: 5000
  });
  expect(withGuarantee.pvPayments).toEqual(37049.24083);
  expect(withGuarantee.pvResidual).toEqual(0);
  expect(withoutGuarantee.pvPayments).toEqual(32871.01624);
  expect(withoutGuarantee.pvResidual).toEqual(4178.22459);
  expect(withoutGuarantee.netInvestment).toEqual(withGuarantee.netInvestment);
});

it("billing in advance is an annuity-due, worth more than the same stream in arrears", () => {
  const advance = presentValue({ ...LEASE, timing: "Advance" });
  const arrears = presentValue(LEASE);
  expect(advance.pvRent).toEqual(33035.37132);
  expect(advance.pvRent > arrears.pvRent).toBeTruthy();
});

it("a zero rate is the undiscounted sum", () => {
  expect(
    presentValue({
      ...LEASE,
      annualRate: 0,
      purchaseOption: 5000,
      unguaranteedResidual: 2000
    })
  ).toEqual({
    pvRent: 36000,
    pvPayments: 41000,
    pvResidual: 2000,
    netInvestment: 43000
  });
});

it("present value refuses a partial term and a negative rate", () => {
  expect(() => presentValue({ ...LEASE, periods: 0 })).toThrow();
  expect(() => presentValue({ ...LEASE, periods: 1.5 })).toThrow();
  expect(() => presentValue({ ...LEASE, annualRate: -1 })).toThrow();
});

it("a reasonably certain purchase option makes it Sale (97.5 % of fair value)", () => {
  const result = classifyLessorLease(
    {
      ownershipTransfers: false,
      purchaseOptionReasonablyCertain: true,
      termMonths: 36,
      economicLifeMonths: 120,
      pvPayments: 37049.24083,
      fairValue: 38000,
      specializedAsset: false
    },
    THRESHOLDS
  );
  expect(result.classification).toEqual("Sale");
  expect(result.tests).toEqual({
    a: false,
    b: true,
    c: false,
    d: true,
    e: false
  });
  expect(result.pvToFairValuePercent).toEqual(97.498);
  expect(result.termToLifePercent).toEqual(30);
});

it("no test met is Rental (54.8 % of fair value, 30 % of life)", () => {
  const result = classifyLessorLease(
    {
      ownershipTransfers: false,
      purchaseOptionReasonablyCertain: false,
      termMonths: 36,
      economicLifeMonths: 120,
      pvPayments: 32871.01624,
      fairValue: 60000,
      specializedAsset: false
    },
    THRESHOLDS
  );
  expect(result.classification).toEqual("Rental");
  expect(result.pvToFairValuePercent).toEqual(54.78503);
  expect(result.termToLifePercent).toEqual(30);
});

it("a term over the major-part threshold of the economic life is Sale", () => {
  const result = classifyLessorLease(
    {
      ownershipTransfers: false,
      purchaseOptionReasonablyCertain: false,
      termMonths: 96,
      economicLifeMonths: 120,
      pvPayments: 10000,
      fairValue: 60000,
      specializedAsset: false
    },
    THRESHOLDS
  );
  expect(result.tests.c).toEqual(true);
  expect(result.termToLifePercent).toEqual(80);
  expect(result.classification).toEqual("Sale");
});

it("an open-ended agreement is Rental even when a test is met", () => {
  const result = classifyLessorLease(
    {
      ownershipTransfers: true,
      purchaseOptionReasonablyCertain: false,
      termMonths: null,
      economicLifeMonths: 120,
      pvPayments: 1000,
      fairValue: null,
      specializedAsset: true
    },
    THRESHOLDS
  );
  expect(result.classification).toEqual("Rental");
  expect(result.tests.a).toEqual(true);
  expect(result.tests.c).toEqual(false);
  expect(result.tests.d).toEqual(false);
  expect(result.termToLifePercent).toEqual(null);
  expect(result.pvToFairValuePercent).toEqual(null);
});

it("the effective-interest schedule closes on the purchase option exactly", () => {
  const schedule = buildLessorSchedule({
    ...LEASE,
    netInvestment: 37049.24083,
    closingTarget: 5000,
    periodDates: DATES
  });
  expect(schedule.length).toEqual(36);
  expect(schedule[0]).toEqual({
    periodDate: "2027-01-01",
    openingNetInvestment: 37049.24083,
    paymentAmount: 1000,
    interestAmount: 185.2462, // 185.25
    principalAmount: 814.7538, // 814.75
    closingNetInvestment: 36234.48703 // 36,234.49
  });
  expect(schedule[35]!.periodDate).toEqual("2029-12-01");
  expect(schedule[35]!.closingNetInvestment).toEqual(5000);
  // Every line opens on the previous close.
  for (let i = 1; i < schedule.length; i++) {
    expect(schedule[i]!.openingNetInvestment).toEqual(
      schedule[i - 1]!.closingNetInvestment
    );
  }
  // The last line's interest absorbs only rounding drift.
  const last = schedule[35]!;
  expect(
    Math.abs(last.interestAmount - last.openingNetInvestment * 0.005) < 0.001
  ).toBeTruthy();
});

it("in advance the payment lands first and interest accrues on the remainder", () => {
  const { netInvestment } = presentValue({
    ...LEASE,
    timing: "Advance",
    purchaseOption: 5000
  });
  const schedule = buildLessorSchedule({
    ...LEASE,
    timing: "Advance",
    netInvestment,
    closingTarget: 5000,
    periodDates: DATES
  });
  expect(schedule[0]!.interestAmount).toEqual(181.06798); // (37,213.60 − 1,000) × 0.5 %
  expect(schedule[35]!.closingNetInvestment).toEqual(5000);
});

it("a zero-rate schedule is straight principal", () => {
  const schedule = buildLessorSchedule({
    ...LEASE,
    annualRate: 0,
    netInvestment: 41000,
    closingTarget: 5000,
    periodDates: DATES
  });
  expect(schedule.every((line) => line.interestAmount === 0)).toBeTruthy();
  expect(schedule.every((line) => line.principalAmount === 1000)).toBeTruthy();
  expect(schedule[0]!.closingNetInvestment).toEqual(40000);
  expect(schedule[35]!.closingNetInvestment).toEqual(5000);
});

it("the schedule needs one date per period", () => {
  expect(() =>
    buildLessorSchedule({
      ...LEASE,
      netInvestment: 37049.24083,
      closingTarget: 5000,
      periodDates: DATES.slice(1)
    })
  ).toThrow();
});

it("only real interest is posted: not zero, not one unit of closing drift", () => {
  expect(earnsInterest(185.25)).toEqual(true);
  expect(earnsInterest(-0.5)).toEqual(true);
  expect(earnsInterest(0)).toEqual(false);
  expect(earnsInterest(0.000001)).toEqual(false);
  // An Advance lease closing on zero ends one unit below zero.
  expect(earnsInterest(-0.00001)).toEqual(false);
  expect(earnsInterest(-0.00002)).toEqual(true);
});
