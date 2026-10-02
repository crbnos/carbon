// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  assertEquals,
  assertThrows,
} from "https://deno.land/std@0.175.0/testing/asserts.ts";
import { round } from "./precision.ts";
import {
  calendarMonthCharge,
  defaultRentalRates,
  type ExistingBillingPeriod,
  generateRentalBillingPeriods,
  type PeriodSpec,
  type RateLadder,
  type RateUnit,
  rateCharge,
  type ScopedRentalRate,
} from "./rental-billing.ts";

/** Daily and Weekly units, for the tests that need a sub-month frequency. */
const DAILY = { rateUnit: "Day", rate: 100 } as const;
const WEEKLY = { rateUnit: "Week", rate: 500 } as const;

/** A 28 Days, Advance agreement on a unit at 1,500 a month unless a test
 *  says otherwise. */
const generate = (
  overrides: Partial<Parameters<typeof generateRentalBillingPeriods>[0]>,
) =>
  generateRentalBillingPeriods({
    cycle: "28 Days",
    timing: "Advance",
    rateUnit: "Month",
    rate: 1500,
    startDate: "2026-10-01",
    endDate: null,
    returnedAt: null,
    through: "2026-10-01",
    existing: [],
    ...overrides,
  });

const period = (
  periodStart: string,
  periodEnd: string,
  days: number,
  amount: number,
  rateUnitApplied: RateUnit,
  dueOn: string,
): PeriodSpec => ({
  periodStart,
  periodEnd,
  days,
  amount,
  rateUnitApplied,
  dueOn,
  isAdjustment: false,
});

const invoiced = (
  periodStart: string,
  periodEnd: string,
  amount: number,
): ExistingBillingPeriod => ({
  periodStart,
  periodEnd,
  amount,
  status: "Invoiced",
  isAdjustment: false,
});

const pending = (
  periodStart: string,
  periodEnd: string,
  amount: number,
): ExistingBillingPeriod => ({
  ...invoiced(periodStart, periodEnd, amount),
  status: "Pending",
});

Deno.test("rateCharge bills whole units of the unit's frequency", () => {
  assertEquals(rateCharge(10, "Week", 500), {
    amount: 1000,
    rateUnitApplied: "Week",
    units: 2,
  });
  assertEquals(rateCharge(10, "Day", 100), {
    amount: 1000,
    rateUnitApplied: "Day",
    units: 10,
  });
  assertEquals(rateCharge(10, "Month", 1500), {
    amount: 1500,
    rateUnitApplied: "Month",
    units: 1,
  });
  assertEquals(rateCharge(29, "Month", 1500), {
    amount: 3000,
    rateUnitApplied: "Month",
    units: 2,
  });
});

Deno.test("rateCharge rounds at internal scale and refuses partial days and a non-finite rate", () => {
  // 3 × 0.1 is 0.30000000000000004 in floating point.
  assertEquals(rateCharge(3, "Day", 0.1).amount, 0.3);
  for (const days of [0, -1, 1.5]) {
    assertThrows(() => rateCharge(days, "Day", 100), Error, "whole number");
  }
  assertThrows(() => rateCharge(3, "Day", Number.NaN), Error, "finite");
});

Deno.test("calendarMonthCharge prorates the month rate by the month's own length", () => {
  // 17 of October's 31 days: 822.58 at settlement precision.
  assertEquals(
    calendarMonthCharge("2026-10-15", "2026-10-31", 1500),
    822.58065,
  );
  assertEquals(
    round(calendarMonthCharge("2026-10-15", "2026-10-31", 1500), 2),
    822.58,
  );
  // 10 of January's 31 days.
  assertEquals(
    calendarMonthCharge("2027-01-01", "2027-01-10", 1500),
    483.87097,
  );
  assertEquals(
    round(calendarMonthCharge("2027-01-01", "2027-01-10", 1500), 2),
    483.87,
  );
  // 10 of November's 30 days.
  assertEquals(calendarMonthCharge("2026-11-01", "2026-11-10", 1500), 500);
  // A whole month is exactly the rate, leap February included.
  assertEquals(calendarMonthCharge("2026-10-01", "2026-10-31", 1500), 1500);
  assertEquals(calendarMonthCharge("2028-02-01", "2028-02-29", 1500), 1500);
  assertThrows(
    () => calendarMonthCharge("2026-10-15", "2026-11-14", 1500),
    Error,
    "calendar month",
  );
  assertThrows(
    () => calendarMonthCharge("2026-10-15", "2026-10-14", 1500),
    Error,
    "before",
  );
  assertThrows(
    () => calendarMonthCharge("2026-10-15", "2026-10-31", Number.NaN),
    Error,
    "finite",
  );
});

Deno.test("35 days on 28 Days is two periods, each whole units of the unit's frequency", () => {
  // A Monthly unit bills its short last period as a whole month.
  const monthly = generate({ endDate: "2026-11-04" });
  assertEquals(monthly.create, [
    period("2026-10-01", "2026-10-28", 28, 1500, "Month", "2026-10-01"),
    period("2026-10-29", "2026-11-04", 7, 1500, "Month", "2026-10-29"),
  ]);
  assertEquals(monthly.recut, []);
  assertEquals(monthly.adjustments, []);
  const weekly = generate({ ...WEEKLY, endDate: "2026-11-04" });
  assertEquals(weekly.create, [
    period("2026-10-01", "2026-10-28", 28, 2000, "Week", "2026-10-01"),
    period("2026-10-29", "2026-11-04", 7, 500, "Week", "2026-10-29"),
  ]);
});

Deno.test("dueOn is the period start in advance and the period end in arrears", () => {
  const arrears = generate({ endDate: "2026-11-04", timing: "Arrears" });
  assertEquals(arrears.create.map((row) => row.dueOn), [
    "2026-10-28",
    "2026-11-04",
  ]);
  const advance = generate({ endDate: "2026-11-04", timing: "Advance" });
  assertEquals(advance.create.map((row) => row.dueOn), [
    "2026-10-01",
    "2026-10-29",
  ]);
});

Deno.test("a year on rent is thirteen 28-day periods", () => {
  // 52 weeks: 2026-10-01 through 2027-09-29 is 364 days.
  const plan = generate({ endDate: "2027-09-29" });
  assertEquals(plan.create.length, 13);
  assertEquals(
    plan.create.every((row) => row.days === 28 && row.amount === 1500),
    true,
  );
  assertEquals(plan.create[12]?.periodStart, "2027-09-02");
  assertEquals(plan.create[12]?.periodEnd, "2027-09-29");
  // The 365th day is its own one-day period, billed at the unit's frequency.
  const leapDay = generate({ ...DAILY, endDate: "2027-09-30" });
  assertEquals(leapDay.create.length, 14);
  assertEquals(
    leapDay.create[13],
    period("2027-09-30", "2027-09-30", 1, 100, "Day", "2027-09-30"),
  );
});

Deno.test("a Weekly unit bills two weeks for ten days", () => {
  const plan = generate({ ...WEEKLY, endDate: "2026-10-10" });
  assertEquals(plan.create, [
    period("2026-10-01", "2026-10-10", 10, 1000, "Week", "2026-10-01"),
  ]);
});

Deno.test("an early return on a period billed in advance credits the unearned part", () => {
  const plan = generate({
    ...WEEKLY,
    endDate: "2026-10-28",
    returnedAt: "2026-10-03",
    through: "2026-10-03",
    existing: [invoiced("2026-10-01", "2026-10-28", 2000)],
  });
  assertEquals(plan.create, []);
  assertEquals(plan.recut, []);
  // Three days on a Weekly unit is one week, 500; four weeks, 2,000, were billed.
  assertEquals(plan.adjustments, [
    {
      periodStart: "2026-10-01",
      periodEnd: "2026-10-28",
      days: 3,
      amount: -1500,
      rateUnitApplied: "Week",
      dueOn: "2026-10-03",
      isAdjustment: true,
    },
  ]);
});

Deno.test("a month already earned by a long stay yields no credit (the Texada rule)", () => {
  const plan = generate({
    endDate: "2026-10-28",
    returnedAt: "2026-10-20",
    through: "2026-10-20",
    existing: [invoiced("2026-10-01", "2026-10-28", 1500)],
  });
  // Twenty days on a Monthly unit is still the month: nothing to give back.
  assertEquals(plan.adjustments, []);
  assertEquals(plan.create, []);
  assertEquals(plan.recut, []);
});

Deno.test("an adjustment is never positive and never repeated", () => {
  // Billed less than the days used are worth: no adjustment either way.
  const underBilled = generate({
    ...WEEKLY,
    endDate: "2026-10-28",
    returnedAt: "2026-10-03",
    through: "2026-10-03",
    existing: [invoiced("2026-10-01", "2026-10-28", 200)],
  });
  assertEquals(underBilled.adjustments, []);
  // The credit already exists: the return flow ran twice.
  const alreadyCredited = generate({
    ...WEEKLY,
    endDate: "2026-10-28",
    returnedAt: "2026-10-03",
    through: "2026-10-03",
    existing: [
      invoiced("2026-10-01", "2026-10-28", 2000),
      {
        periodStart: "2026-10-01",
        periodEnd: "2026-10-28",
        amount: -1500,
        status: "Pending",
        isAdjustment: true,
      },
    ],
  });
  assertEquals(alreadyCredited.adjustments, []);
  assertEquals(alreadyCredited.create, []);
});

Deno.test("only advance billing is adjusted; a fully used period never is", () => {
  const arrears = generate({
    timing: "Arrears",
    endDate: "2026-10-28",
    returnedAt: "2026-10-03",
    through: "2026-10-03",
    existing: [invoiced("2026-10-01", "2026-10-28", 1500)],
  });
  assertEquals(arrears.adjustments, []);
  const twoPeriods = [
    invoiced("2026-10-01", "2026-10-28", 2800),
    invoiced("2026-10-29", "2026-11-04", 700),
  ];
  // Returned on the last day: both periods fully used.
  const fullyUsed = generate({
    ...DAILY,
    endDate: "2026-11-04",
    returnedAt: "2026-11-04",
    through: "2026-11-04",
    existing: twoPeriods,
  });
  assertEquals(fullyUsed.adjustments, []);
  // Four of the last period's seven days used on a Daily unit: 400 of the
  // 700 billed, so 300 comes back.
  const partlyUsed = generate({
    ...DAILY,
    endDate: "2026-11-04",
    returnedAt: "2026-11-01",
    through: "2026-11-01",
    existing: twoPeriods,
  });
  assertEquals(partlyUsed.adjustments, [
    {
      periodStart: "2026-10-29",
      periodEnd: "2026-11-04",
      days: 4,
      amount: -300,
      rateUnitApplied: "Day",
      dueOn: "2026-11-01",
      isAdjustment: true,
    },
  ]);
});

Deno.test("a period billed in advance that the unit never reached is credited in full", () => {
  const plan = generate({
    endDate: "2026-11-25",
    returnedAt: "2026-10-20",
    through: "2026-10-20",
    existing: [
      invoiced("2026-10-01", "2026-10-28", 1500),
      invoiced("2026-10-29", "2026-11-25", 1500),
    ],
  });
  assertEquals(plan.adjustments, [
    {
      periodStart: "2026-10-29",
      periodEnd: "2026-11-25",
      days: 0,
      amount: -1500,
      rateUnitApplied: null,
      dueOn: "2026-10-20",
      isAdjustment: true,
    },
  ]);
});

Deno.test("a Pending period the return falls inside is re-cut; later ones are not re-created", () => {
  const plan = generate({
    ...DAILY,
    endDate: "2026-11-25",
    returnedAt: "2026-10-03",
    through: "2026-10-03",
    existing: [
      pending("2026-10-01", "2026-10-28", 2800),
      pending("2026-10-29", "2026-11-25", 2800),
    ],
  });
  assertEquals(plan.recut, [
    {
      periodStart: "2026-10-01",
      periodEnd: "2026-10-03",
      days: 3,
      amount: 300,
      rateUnitApplied: "Day",
      dueOn: "2026-10-01",
    },
  ]);
  assertEquals(plan.create, []);
  assertEquals(plan.adjustments, []);
  // Running again over the re-cut row changes nothing.
  const again = generate({
    ...DAILY,
    endDate: "2026-11-25",
    returnedAt: "2026-10-03",
    through: "2026-10-03",
    existing: [pending("2026-10-01", "2026-10-03", 300)],
  });
  assertEquals(again, { create: [], recut: [], adjustments: [] });
});

Deno.test("an arrears period re-cut at a return falls due on its new last day", () => {
  const plan = generate({
    ...DAILY,
    timing: "Arrears",
    endDate: "2026-11-25",
    returnedAt: "2026-10-03",
    through: "2026-10-03",
    existing: [pending("2026-10-01", "2026-10-28", 2800)],
  });
  assertEquals(plan.recut, [
    {
      periodStart: "2026-10-01",
      periodEnd: "2026-10-03",
      days: 3,
      amount: 300,
      rateUnitApplied: "Day",
      dueOn: "2026-10-03",
    },
  ]);
});

Deno.test("existing periods are kept and only the missing ones are created", () => {
  const plan = generate({
    endDate: "2026-11-04",
    existing: [invoiced("2026-10-01", "2026-10-28", 1500)],
  });
  assertEquals(plan.create, [
    period("2026-10-29", "2026-11-04", 7, 1500, "Month", "2026-10-29"),
  ]);
  assertEquals(plan.recut, []);
});

Deno.test("Calendar Month: a mid-month start is a partial first period, and an open-ended agreement rolls one period ahead", () => {
  const plan = generate({
    cycle: "Calendar Month",
    startDate: "2026-10-15",
    through: "2026-10-20",
  });
  assertEquals(plan.create, [
    period("2026-10-15", "2026-10-31", 17, 822.58065, "Month", "2026-10-15"),
    period("2026-11-01", "2026-11-30", 30, 1500, "Month", "2026-11-01"),
  ]);
  assertEquals(round(plan.create[0]!.amount, 2), 822.58);
  // As `through` advances, one more period appears each month.
  const later = generate({
    cycle: "Calendar Month",
    startDate: "2026-10-15",
    through: "2026-11-01",
    existing: [
      pending("2026-10-15", "2026-10-31", 822.58065),
      pending("2026-11-01", "2026-11-30", 1500),
    ],
  });
  assertEquals(later.create, [
    period("2026-12-01", "2026-12-31", 31, 1500, "Month", "2026-12-01"),
  ]);
});

Deno.test("Calendar Month: a return cuts the final period to the days used", () => {
  const plan = generate({
    cycle: "Calendar Month",
    startDate: "2026-10-15",
    returnedAt: "2027-01-10",
    through: "2027-01-10",
  });
  assertEquals(
    plan.create.map((
      row,
    ) => [row.periodStart, row.periodEnd, row.days, row.amount]),
    [
      ["2026-10-15", "2026-10-31", 17, 822.58065],
      ["2026-11-01", "2026-11-30", 30, 1500],
      ["2026-12-01", "2026-12-31", 31, 1500],
      ["2027-01-01", "2027-01-10", 10, 483.87097],
    ],
  );
  assertEquals(round(plan.create[3]!.amount, 2), 483.87);
});

Deno.test("Calendar Month: a unit still out past the end date keeps billing (holdover)", () => {
  const holdover = generate({
    cycle: "Calendar Month",
    endDate: "2026-10-31",
    through: "2026-11-05",
  });
  assertEquals(holdover.create, [
    period("2026-10-01", "2026-10-31", 31, 1500, "Month", "2026-10-01"),
    period("2026-11-01", "2026-11-30", 30, 1500, "Month", "2026-11-01"),
  ]);
  const returned = generate({
    cycle: "Calendar Month",
    endDate: "2026-10-31",
    returnedAt: "2026-11-10",
    through: "2026-11-10",
  });
  assertEquals(returned.create, [
    period("2026-10-01", "2026-10-31", 31, 1500, "Month", "2026-10-01"),
    period("2026-11-01", "2026-11-10", 10, 500, "Month", "2026-11-01"),
  ]);
  // A mid-month end date is a hard cut: the holdover starts the day after,
  // and the two halves add up to the month.
  const midMonth = generate({
    cycle: "Calendar Month",
    endDate: "2026-11-15",
    through: "2026-11-20",
  });
  assertEquals(
    midMonth.create.map((row) => [row.periodStart, row.periodEnd, row.amount]),
    [
      ["2026-10-01", "2026-10-31", 1500],
      ["2026-11-01", "2026-11-15", 750],
      ["2026-11-16", "2026-11-30", 750],
    ],
  );
});

Deno.test("Calendar Month: an advance-billed month is credited for the unused days", () => {
  const plan = generate({
    cycle: "Calendar Month",
    endDate: "2026-12-31",
    returnedAt: "2026-10-10",
    through: "2026-10-10",
    existing: [invoiced("2026-10-01", "2026-10-31", 1500)],
  });
  assertEquals(plan.adjustments, [
    {
      periodStart: "2026-10-01",
      periodEnd: "2026-10-31",
      days: 10,
      amount: -1016.12903,
      rateUnitApplied: "Month",
      dueOn: "2026-10-10",
      isAdjustment: true,
    },
  ]);
});

Deno.test("Calendar Month: a Daily unit bills the days, a Weekly unit the whole weeks", () => {
  const terms = {
    cycle: "Calendar Month",
    startDate: "2026-10-15",
    endDate: "2026-11-30",
    through: "2026-10-15",
  } as const;
  assertEquals(generate({ ...terms, ...DAILY }).create, [
    period("2026-10-15", "2026-10-31", 17, 1700, "Day", "2026-10-15"),
    period("2026-11-01", "2026-11-30", 30, 3000, "Day", "2026-11-01"),
  ]);
  // 17 days is three weeks; November's 30 days are five.
  assertEquals(generate({ ...terms, ...WEEKLY }).create, [
    period("2026-10-15", "2026-10-31", 17, 1500, "Week", "2026-10-15"),
    period("2026-11-01", "2026-11-30", 30, 2500, "Week", "2026-11-01"),
  ]);
});

Deno.test("a fixed term is generated in full up front, whatever `through` is", () => {
  const plan = generate({
    cycle: "Calendar Month",
    startDate: "2026-10-15",
    endDate: "2026-12-20",
    through: "2026-09-22",
  });
  assertEquals(
    plan.create.map((row) => [row.periodStart, row.periodEnd, row.amount]),
    [
      ["2026-10-15", "2026-10-31", 822.58065],
      ["2026-11-01", "2026-11-30", 1500],
      ["2026-12-01", "2026-12-20", 967.74194],
    ],
  );
  // Open-ended and not yet started: just the first period.
  const notStarted = generate({ through: "2026-09-22" });
  assertEquals(notStarted.create, [
    period("2026-10-01", "2026-10-28", 28, 1500, "Month", "2026-10-01"),
  ]);
});

Deno.test("refuses a return or end before the start, and a malformed date", () => {
  assertThrows(() => generate({ returnedAt: "2026-09-30" }), Error, "before");
  assertThrows(() => generate({ endDate: "2026-09-30" }), Error, "before");
  assertThrows(() => generate({ through: "10/01/2026" }), Error, "YYYY-MM-DD");
  assertThrows(
    () => generate({ startDate: "2026-02-30" }),
    Error,
    "calendar date",
  );
});

const scoped = (
  overrides: Partial<ScopedRentalRate>,
): ScopedRentalRate => ({
  customerId: null,
  customerTypeId: null,
  validFrom: null,
  validTo: null,
  dayRate: null,
  weekRate: null,
  monthRate: 1200,
  ...overrides,
});

Deno.test("default rates: customer, then customer type, then the item — per frequency", () => {
  const item: RateLadder = { dayRate: 100, weekRate: 500, monthRate: 1500 };
  const forCustomer = scoped({ customerId: "c1", monthRate: 1100 });
  const forType = scoped({
    customerTypeId: "t1",
    weekRate: 450,
    monthRate: 1300,
  });
  const args = {
    customerId: "c1",
    customerTypeId: "t1",
    asOf: "2026-10-01",
    item,
  };

  // The customer agreed only a month rate: the week rate is the type's and
  // the day rate the item's.
  assertEquals(
    defaultRentalRates({ ...args, scoped: [forType, forCustomer] }),
    {
      Day: { rate: 100, source: "Item" },
      Week: { rate: 450, source: "Customer Type" },
      Month: { rate: 1100, source: "Customer" },
    },
  );
  assertEquals(defaultRentalRates({ ...args, scoped: [] }), {
    Day: { rate: 100, source: "Item" },
    Week: { rate: 500, source: "Item" },
    Month: { rate: 1500, source: "Item" },
  });
  assertEquals(defaultRentalRates({ ...args, scoped: [], item: null }), {
    Day: null,
    Week: null,
    Month: null,
  });
});

Deno.test("default rates: a row for another customer or type never applies", () => {
  const none = { Day: null, Week: null, Month: null };
  const result = defaultRentalRates({
    customerId: "c1",
    customerTypeId: "t1",
    asOf: "2026-10-01",
    scoped: [
      scoped({ customerId: "c2", monthRate: 900 }),
      scoped({ customerTypeId: "t2", monthRate: 950 }),
    ],
    item: null,
  });
  assertEquals(result, none);
  // A customer with no type matches no type row.
  assertEquals(
    defaultRentalRates({
      customerId: "c1",
      customerTypeId: null,
      asOf: "2026-10-01",
      scoped: [scoped({ customerTypeId: "t1" })],
      item: null,
    }),
    none,
  );
});

Deno.test("default rates: a scoped row applies only inside its validity, inclusive", () => {
  const item: RateLadder = { dayRate: null, weekRate: null, monthRate: 1500 };
  const window = scoped({
    customerId: "c1",
    monthRate: 1100,
    validFrom: "2026-10-01",
    validTo: "2026-12-31",
  });
  const at = (asOf: string) =>
    defaultRentalRates({
      customerId: "c1",
      customerTypeId: null,
      asOf,
      scoped: [window],
      item,
    }).Month?.source;

  assertEquals(at("2026-09-30"), "Item");
  assertEquals(at("2026-10-01"), "Customer");
  assertEquals(at("2026-12-31"), "Customer");
  assertEquals(at("2027-01-01"), "Item");
});

Deno.test("default rates: an expired customer rate falls through to the type", () => {
  const result = defaultRentalRates({
    customerId: "c1",
    customerTypeId: "t1",
    asOf: "2026-10-01",
    scoped: [
      scoped({ customerId: "c1", monthRate: 1100, validTo: "2026-09-30" }),
      scoped({ customerTypeId: "t1", monthRate: 1300 }),
    ],
    item: null,
  });
  assertEquals(result.Month, { rate: 1300, source: "Customer Type" });
});
