import {
  assertEquals,
  assertThrows,
} from "https://deno.land/std@0.175.0/testing/asserts.ts";
import { round } from "./precision.ts";
import {
  bestRateCharge,
  calendarMonthCharge,
  type ExistingBillingPeriod,
  fixedRateCharge,
  generateRentalBillingPeriods,
  type PeriodSpec,
  type RateLadder,
  type RateUnit,
} from "./rental-billing.ts";

const RATES: RateLadder = { dayRate: 100, weekRate: 500, monthRate: 1500 };

/** A 28 Days, Best Rate, Advance agreement unless a test says otherwise. */
const generate = (
  overrides: Partial<Parameters<typeof generateRentalBillingPeriods>[0]>,
) =>
  generateRentalBillingPeriods({
    cycle: "28 Days",
    timing: "Advance",
    rateMode: "Best Rate",
    rateUnit: null,
    rates: RATES,
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

Deno.test("bestRateCharge picks the cheapest tier, ties to the larger unit", () => {
  assertEquals(bestRateCharge(3, RATES), {
    amount: 300,
    rateUnitApplied: "Day",
    units: 3,
  });
  // 10 days: 1,000 as days or as two weeks — the week wins the tie.
  assertEquals(bestRateCharge(10, RATES), {
    amount: 1000,
    rateUnitApplied: "Week",
    units: 2,
  });
  // 20 days: 2,000 as days, 1,500 as three weeks, 1,500 as a month — the month wins.
  assertEquals(bestRateCharge(20, RATES), {
    amount: 1500,
    rateUnitApplied: "Month",
    units: 1,
  });
  assertEquals(bestRateCharge(7, RATES), {
    amount: 500,
    rateUnitApplied: "Week",
    units: 1,
  });
  assertEquals(bestRateCharge(28, RATES), {
    amount: 1500,
    rateUnitApplied: "Month",
    units: 1,
  });
  // 29 days: five weeks (2,500) beat two months (3,000) and 29 days (2,900).
  assertEquals(bestRateCharge(29, RATES), {
    amount: 2500,
    rateUnitApplied: "Week",
    units: 5,
  });
});

Deno.test("bestRateCharge only considers the tiers the line has", () => {
  assertEquals(
    bestRateCharge(20, { dayRate: 100, weekRate: null, monthRate: null }),
    { amount: 2000, rateUnitApplied: "Day", units: 20 },
  );
  assertEquals(
    bestRateCharge(3, { dayRate: null, weekRate: null, monthRate: 1500 }),
    { amount: 1500, rateUnitApplied: "Month", units: 1 },
  );
  assertThrows(
    () => bestRateCharge(3, { dayRate: null, weekRate: null, monthRate: null }),
    Error,
    "tier",
  );
});

Deno.test("bestRateCharge rounds the product at internal scale and refuses partial days", () => {
  // 3 × 0.1 is 0.30000000000000004 in floating point; the amount is persisted.
  assertEquals(
    bestRateCharge(3, { dayRate: 0.1, weekRate: null, monthRate: null }).amount,
    0.3,
  );
  for (const days of [0, -1, 1.5, Number.NaN]) {
    assertThrows(() => bestRateCharge(days, RATES), Error, "whole number");
  }
});

Deno.test("fixedRateCharge bills the requested tier in whole units", () => {
  assertEquals(fixedRateCharge(10, "Week", RATES), {
    amount: 1000,
    rateUnitApplied: "Week",
    units: 2,
  });
  assertEquals(fixedRateCharge(10, "Day", RATES), {
    amount: 1000,
    rateUnitApplied: "Day",
    units: 10,
  });
  assertEquals(fixedRateCharge(10, "Month", RATES), {
    amount: 1500,
    rateUnitApplied: "Month",
    units: 1,
  });
  assertEquals(fixedRateCharge(29, "Month", RATES), {
    amount: 3000,
    rateUnitApplied: "Month",
    units: 2,
  });
  assertThrows(
    () =>
      fixedRateCharge(10, "Week", {
        dayRate: 100,
        weekRate: null,
        monthRate: 1500,
      }),
    Error,
    "no Week rate",
  );
});

Deno.test("calendarMonthCharge prorates the month tier by the month's own length", () => {
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

Deno.test("35 days on 28 Days is a month period and a week period", () => {
  const plan = generate({ endDate: "2026-11-04" });
  assertEquals(plan.create, [
    period("2026-10-01", "2026-10-28", 28, 1500, "Month", "2026-10-01"),
    period("2026-10-29", "2026-11-04", 7, 500, "Week", "2026-10-29"),
  ]);
  assertEquals(plan.recut, []);
  assertEquals(plan.adjustments, []);
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
  // The 365th day is its own one-day period at the day rate.
  const leapDay = generate({ endDate: "2027-09-30" });
  assertEquals(leapDay.create.length, 14);
  assertEquals(
    leapDay.create[13],
    period("2027-09-30", "2027-09-30", 1, 100, "Day", "2027-09-30"),
  );
});

Deno.test("a Fixed Week line bills two weeks for ten days", () => {
  const plan = generate({
    endDate: "2026-10-10",
    rateMode: "Fixed",
    rateUnit: "Week",
  });
  assertEquals(plan.create, [
    period("2026-10-01", "2026-10-10", 10, 1000, "Week", "2026-10-01"),
  ]);
  assertThrows(
    () =>
      generate({ endDate: "2026-10-10", rateMode: "Fixed", rateUnit: null }),
    Error,
    "rate unit",
  );
});

Deno.test("an early return on a period billed in advance credits the unearned part", () => {
  const plan = generate({
    endDate: "2026-10-28",
    returnedAt: "2026-10-03",
    through: "2026-10-03",
    existing: [invoiced("2026-10-01", "2026-10-28", 1500)],
  });
  assertEquals(plan.create, []);
  assertEquals(plan.recut, []);
  // Three days at the best rate is 300; 1,500 was billed.
  assertEquals(plan.adjustments, [
    {
      periodStart: "2026-10-01",
      periodEnd: "2026-10-28",
      days: 3,
      amount: -1200,
      rateUnitApplied: "Day",
      dueOn: "2026-10-03",
      isAdjustment: true,
    },
  ]);
});

Deno.test("a month tier already earned by a long stay yields no credit (the Texada rule)", () => {
  const plan = generate({
    endDate: "2026-10-28",
    returnedAt: "2026-10-20",
    through: "2026-10-20",
    existing: [invoiced("2026-10-01", "2026-10-28", 1500)],
  });
  // Twenty days at the best rate is the month tier: nothing to give back.
  assertEquals(plan.adjustments, []);
  assertEquals(plan.create, []);
  assertEquals(plan.recut, []);
});

Deno.test("an adjustment is never positive and never repeated", () => {
  // Billed less than the days used are worth: no adjustment either way.
  const underBilled = generate({
    endDate: "2026-10-28",
    returnedAt: "2026-10-03",
    through: "2026-10-03",
    existing: [invoiced("2026-10-01", "2026-10-28", 200)],
  });
  assertEquals(underBilled.adjustments, []);
  // The credit already exists: the return flow ran twice.
  const alreadyCredited = generate({
    endDate: "2026-10-28",
    returnedAt: "2026-10-03",
    through: "2026-10-03",
    existing: [
      invoiced("2026-10-01", "2026-10-28", 1500),
      {
        periodStart: "2026-10-01",
        periodEnd: "2026-10-28",
        amount: -1200,
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
    invoiced("2026-10-01", "2026-10-28", 1500),
    invoiced("2026-10-29", "2026-11-04", 500),
  ];
  // Returned on the last day: both periods fully used.
  const fullyUsed = generate({
    endDate: "2026-11-04",
    returnedAt: "2026-11-04",
    through: "2026-11-04",
    existing: twoPeriods,
  });
  assertEquals(fullyUsed.adjustments, []);
  // Four of the week's seven days used: four days at the day rate (400) beat
  // the week (500), so 100 of the advance bill comes back.
  const partlyUsed = generate({
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
      amount: -100,
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
    endDate: "2026-11-25",
    returnedAt: "2026-10-03",
    through: "2026-10-03",
    existing: [
      pending("2026-10-01", "2026-10-28", 1500),
      pending("2026-10-29", "2026-11-25", 1500),
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
    endDate: "2026-11-25",
    returnedAt: "2026-10-03",
    through: "2026-10-03",
    existing: [pending("2026-10-01", "2026-10-03", 300)],
  });
  assertEquals(again, { create: [], recut: [], adjustments: [] });
});

Deno.test("an arrears period re-cut at a return falls due on its new last day", () => {
  const plan = generate({
    timing: "Arrears",
    endDate: "2026-11-25",
    returnedAt: "2026-10-03",
    through: "2026-10-03",
    existing: [pending("2026-10-01", "2026-10-28", 1500)],
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
    period("2026-10-29", "2026-11-04", 7, 500, "Week", "2026-10-29"),
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
  assertThrows(
    () =>
      generate({
        cycle: "Calendar Month",
        rates: { dayRate: 100, weekRate: 500, monthRate: null },
      }),
    Error,
    "month rate",
  );
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
