// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { round, RoundingMode } from "./precision.ts";
import {
  addDays,
  daysBetweenInclusive,
  daysInMonth,
  monthEnd,
  parseIsoDate,
} from "./revenue-schedule.ts";

// Rental billing math shared by the posting functions, the app and the jobs
// package (re-exported to Node through @carbon/utils). Pure: `YYYY-MM-DD`
// strings and numbers in, period specs out — no database, no JS `Date`.
// Spec: .ai/specs/2026-09-22-revenue-recognition-and-rentals.md §3.

/** A rate card: an item's or a customer's day, week and month rates. A null
 *  tier is not offered. A rental unit bills ONE of them — its frequency — at
 *  a rate it carries itself; the card only supplies that rate's first value. */
export type RateLadder = {
  dayRate: number | null;
  weekRate: number | null;
  monthRate: number | null;
};

/** Where a unit's starting rate came from. */
export type RentalRateSource = "Customer" | "Customer Type" | "Item";

/** A `customerItemRentalRate` row: one customer's or one customer type's
 *  rates for an item, optionally bounded by dates. */
export type ScopedRentalRate = RateLadder & {
  customerId: string | null;
  customerTypeId: string | null;
  validFrom: string | null;
  validTo: string | null;
};

export type DefaultRentalRate = { rate: number; source: RentalRateSource };

/** A unit's starting rate for each frequency. */
export type DefaultRentalRates = Record<RateUnit, DefaultRentalRate | null>;

/** The rate a rental unit starts at for each frequency: the customer's own
 *  rate, else its customer type's, else the item's — per frequency, so a
 *  customer who agreed only a month rate still gets the item's day rate. A
 *  scoped row counts only while `asOf` (the agreement's start date) falls
 *  inside its validity, both ends inclusive — `YYYY-MM-DD` strings compare
 *  chronologically. `scoped` holds the rows for this item and currency; rows
 *  for other customers are ignored. */
export function defaultRentalRates(args: {
  customerId: string;
  customerTypeId: string | null;
  asOf: string;
  scoped: ScopedRentalRate[];
  item: RateLadder | null;
}): DefaultRentalRates {
  const { customerId, customerTypeId, asOf, scoped, item } = args;
  const effective = scoped.filter(
    (row) =>
      (!row.validFrom || row.validFrom <= asOf) &&
      (!row.validTo || row.validTo >= asOf),
  );
  const forCustomer = effective.find((row) => row.customerId === customerId);
  const forType = customerTypeId
    ? effective.find((row) => row.customerTypeId === customerTypeId)
    : undefined;
  const cards: [RateLadder | null | undefined, RentalRateSource][] = [
    [forCustomer, "Customer"],
    [forType, "Customer Type"],
    [item, "Item"],
  ];

  const pick = (unit: RateUnit): DefaultRentalRate | null => {
    for (const [card, source] of cards) {
      const rate = card?.[RATE_OF[unit]];
      if (rate !== null && rate !== undefined) return { rate, source };
    }
    return null;
  };
  return { Day: pick("Day"), Week: pick("Week"), Month: pick("Month") };
}

export type RateUnit = "Day" | "Week" | "Month";
export type RentalBillingCycle = "Calendar Month" | "28 Days";
export type RentalBillingTiming = "Advance" | "Arrears";

/** What one period bills: the frequency applied and how many whole units. */
export type RateCharge = {
  amount: number;
  rateUnitApplied: RateUnit;
  units: number;
};

/** One `rentalBillingPeriod` row to write. An adjustment carries the span of
 *  the period it credits (`periodStart` is the join key — the table is unique
 *  on it per line and adjustment flag), `days` actually used, and a negative
 *  amount. */
export type PeriodSpec = {
  periodStart: string;
  periodEnd: string;
  days: number;
  amount: number;
  rateUnitApplied: RateUnit | null;
  dueOn: string;
  isAdjustment: boolean;
};

/** A persisted period, as the generator needs to see it. */
export type ExistingBillingPeriod = {
  periodStart: string;
  periodEnd: string;
  amount: number;
  status: "Pending" | "Invoiced";
  isAdjustment: boolean;
};

/** A Pending period whose end moved: `periodStart` identifies the row. */
/** `dueOn` moves with the end for an Arrears period (it falls due on its
 *  last day); an Advance period's stays on its start. */
export type RecutPeriod = Pick<
  PeriodSpec,
  "periodStart" | "periodEnd" | "days" | "amount" | "rateUnitApplied" | "dueOn"
>;

export type RentalBillingPlan = {
  create: PeriodSpec[];
  recut: RecutPeriod[];
  adjustments: PeriodSpec[];
};

/** Days one unit of each frequency covers. On a `28 Days` cycle a month is 28
 *  days by definition — thirteen of them a year. */
const DAYS_PER_UNIT: Record<RateUnit, number> = { Day: 1, Week: 7, Month: 28 };

const RATE_OF: Record<RateUnit, keyof RateLadder> = {
  Day: "dayRate",
  Week: "weekRate",
  Month: "monthRate",
};

function assertWholeDays(days: number): void {
  if (!Number.isInteger(days) || days < 1) {
    throw new Error(
      `A rental charge needs a whole number of days, got ${days}`,
    );
  }
}

/** Whole units a stay of `days` needs — 8 days is two weeks, not 1.14. */
export const wholeRateUnits = (days: number, unit: RateUnit): number =>
  round(days / DAYS_PER_UNIT[unit], 0, RoundingMode.Up);

/** A unit's charge for `days`: whole units of its frequency × its rate,
 *  rounded because the amount is what gets persisted. */
export function rateCharge(
  days: number,
  unit: RateUnit,
  rate: number,
): RateCharge {
  assertWholeDays(days);
  if (!Number.isFinite(rate)) {
    throw new Error(`${unit} rate must be finite, got ${rate}`);
  }
  const units = wholeRateUnits(days, unit);
  return { amount: round(units * rate), rateUnitApplied: unit, units };
}

/** A month rate prorated by calendar days: `monthRate × days ÷ days in the
 *  month`, so a full month is exactly the rate. The period must sit inside
 *  one calendar month — a straddling span would be prorated against the
 *  wrong month's length. */
export function calendarMonthCharge(
  periodStart: string,
  periodEnd: string,
  monthRate: number,
): number {
  if (!Number.isFinite(monthRate)) {
    throw new Error(`Month rate must be finite, got ${monthRate}`);
  }
  // Validates both dates and refuses an end before the start.
  const days = daysBetweenInclusive(periodStart, periodEnd);
  if (periodEnd > monthEnd(periodStart)) {
    throw new Error(
      `"${periodStart}" to "${periodEnd}" is not within one calendar month`,
    );
  }
  const { year, month } = parseIsoDate(periodStart);
  return round((monthRate * days) / daysInMonth(year, month));
}

/** How far ahead billing periods are cut: today plus one billing cycle, so an
 *  open-ended (or held-over) line always has its current period and the next
 *  one. Activation generates to it, and the daily billing pass rolls every
 *  live line forward to it before billing. Calendar Month runs to the end of
 *  next month; 28 Days to today + 28. */
export function billingHorizon(
  cycle: RentalBillingCycle,
  today: string,
): string {
  return cycle === "Calendar Month"
    ? monthEnd(addDays(monthEnd(today), 1))
    : addDays(today, DAYS_PER_UNIT.Month);
}

/** What a unit bills for one period of its agreement's cycle. A Monthly unit
 *  on a Calendar Month agreement is its month rate prorated by calendar days
 *  (`calendarMonthCharge`); every other combination is whole units of the
 *  unit's frequency (`rateCharge`): a Daily unit bills the days, a Weekly
 *  unit the whole weeks the period covers. */
export function periodCharge(args: {
  cycle: RentalBillingCycle;
  rateUnit: RateUnit;
  rate: number;
  periodStart: string;
  periodEnd: string;
}): Pick<PeriodSpec, "days" | "amount" | "rateUnitApplied"> {
  const { cycle, rateUnit, rate, periodStart, periodEnd } = args;
  const days = daysBetweenInclusive(periodStart, periodEnd);
  if (cycle === "Calendar Month" && rateUnit === "Month") {
    return {
      days,
      amount: calendarMonthCharge(periodStart, periodEnd, rate),
      rateUnitApplied: "Month",
    };
  }
  const { amount, rateUnitApplied } = rateCharge(days, rateUnit, rate);
  return { days, amount, rateUnitApplied };
}

/** Cuts and prices a line's billing periods, and reconciles them with the
 *  rows already persisted.
 *
 *  Periods follow the cycle from `startDate`: calendar months (the first and
 *  last partial) or consecutive 28-day windows, each priced by
 *  `periodCharge` from the unit's own frequency and rate. `endDate` is a hard cut and the
 *  last day of a fixed term, generated in full up front; a unit still out
 *  past it keeps billing at the same rate from the day after (holdover).
 *  `returnedAt` is the final cut. Open-ended agreements roll: every period
 *  starting on or before `through`, plus one beyond it.
 *
 *  Rows are matched by `periodStart`. A generated period with no row is in
 *  `create`. A Pending row whose end moved (the return fell inside it) is in
 *  `recut`; a Pending row the generation no longer reaches is simply absent —
 *  the caller removes it. An Invoiced row billed in advance that extends past
 *  the return is credited in `adjustments` for what was billed less the
 *  charge for the days actually used — so a month already earned by a long
 *  stay yields nothing (the Texada rule), and a period the unit never
 *  reached is credited in full. Never a positive adjustment, and never a
 *  second one for the same period. */
export function generateRentalBillingPeriods(args: {
  cycle: RentalBillingCycle;
  timing: RentalBillingTiming;
  rateUnit: RateUnit;
  rate: number;
  startDate: string;
  endDate: string | null;
  returnedAt: string | null;
  through: string;
  existing: ExistingBillingPeriod[];
}): RentalBillingPlan {
  const {
    cycle,
    timing,
    rateUnit,
    rate,
    startDate,
    endDate,
    returnedAt,
    through,
    existing,
  } = args;

  parseIsoDate(startDate);
  parseIsoDate(through);
  // Both validate their date and refuse one before the start.
  if (endDate !== null) daysBetweenInclusive(startDate, endDate);
  if (returnedAt !== null) daysBetweenInclusive(startDate, returnedAt);

  const price = (periodStart: string, periodEnd: string) =>
    periodCharge({ cycle, rateUnit, rate, periodStart, periodEnd });

  const naturalEnd = (from: string): string =>
    cycle === "Calendar Month"
      ? monthEnd(from)
      : addDays(from, DAYS_PER_UNIT.Month - 1);

  const cut = (periodStart: string): PeriodSpec => {
    let periodEnd = naturalEnd(periodStart);
    // The term end is a hard cut; a holdover period starts the day after it.
    if (endDate !== null && periodStart <= endDate && endDate < periodEnd) {
      periodEnd = endDate;
    }
    if (returnedAt !== null && returnedAt < periodEnd) periodEnd = returnedAt;
    return {
      periodStart,
      periodEnd,
      ...price(periodStart, periodEnd),
      dueOn: timing === "Advance" ? periodStart : periodEnd,
      isAdjustment: false,
    };
  };

  // The last day a period must reach: the return, the whole fixed term, or
  // `through` (holdover and open-ended).
  const lastDay = returnedAt ??
    (endDate !== null && endDate > through ? endDate : through);
  const rolling = endDate === null && returnedAt === null;

  const periods: PeriodSpec[] = [];
  let cursor = startDate;
  while (cursor <= lastDay) {
    const period = cut(cursor);
    periods.push(period);
    cursor = addDays(period.periodEnd, 1);
  }
  if (rolling) periods.push(cut(cursor));

  const generatedByStart = new Map(
    periods.map((period) => [period.periodStart, period]),
  );
  const existingStarts = new Set<string>();
  const adjustedStarts = new Set<string>();
  for (const row of existing) {
    (row.isAdjustment ? adjustedStarts : existingStarts).add(row.periodStart);
  }

  const create = periods.filter(
    (period) => !existingStarts.has(period.periodStart),
  );
  const recut: RecutPeriod[] = [];
  const adjustments: PeriodSpec[] = [];
  for (const row of existing) {
    if (row.isAdjustment) continue;
    // The same period as generated now — cut at the return when there is one,
    // absent when the period starts after it.
    const now = generatedByStart.get(row.periodStart);
    if (row.status === "Pending") {
      if (now !== undefined && now.periodEnd !== row.periodEnd) {
        recut.push({
          periodStart: row.periodStart,
          periodEnd: now.periodEnd,
          days: now.days,
          amount: now.amount,
          rateUnitApplied: now.rateUnitApplied,
          dueOn: now.dueOn,
        });
      }
      continue;
    }
    if (
      returnedAt === null ||
      timing !== "Advance" ||
      row.periodEnd <= returnedAt ||
      adjustedStarts.has(row.periodStart)
    ) {
      continue;
    }
    const credit = round(row.amount - (now?.amount ?? 0));
    if (credit <= 0) continue;
    adjustments.push({
      periodStart: row.periodStart,
      periodEnd: row.periodEnd,
      days: now?.days ?? 0,
      amount: -credit,
      rateUnitApplied: now?.rateUnitApplied ?? null,
      dueOn: returnedAt,
      isAdjustment: true,
    });
  }

  return { create, recut, adjustments };
}
