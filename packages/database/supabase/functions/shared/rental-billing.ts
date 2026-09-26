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

/** The tiers a rental line can bill at. A null tier is not offered. */
export type RateLadder = {
  dayRate: number | null;
  weekRate: number | null;
  monthRate: number | null;
};

export type RateUnit = "Day" | "Week" | "Month";
export type RentalBillingCycle = "Calendar Month" | "28 Days";
export type RentalBillingTiming = "Advance" | "Arrears";
export type RentalRateMode = "Best Rate" | "Fixed";

/** What one period bills: the tier applied and how many whole units of it. */
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

/** Days one unit of each tier covers. The month tier is 28 days by
 *  definition — a `28 Days` cycle bills thirteen of them a year. */
const DAYS_PER_UNIT: Record<RateUnit, number> = { Day: 1, Week: 7, Month: 28 };

const RATE_OF: Record<RateUnit, keyof RateLadder> = {
  Day: "dayRate",
  Week: "weekRate",
  Month: "monthRate",
};

/** Largest tier first, so on a tie the larger unit is the one already held. */
const UNITS_LARGEST_FIRST: RateUnit[] = ["Month", "Week", "Day"];

function assertWholeDays(days: number): void {
  if (!Number.isInteger(days) || days < 1) {
    throw new Error(
      `A rental charge needs a whole number of days, got ${days}`,
    );
  }
}

/** Whole tiers a stay of `days` needs — 8 days is two weeks, not 1.14. */
export const wholeRateUnits = (days: number, unit: RateUnit): number =>
  round(days / DAYS_PER_UNIT[unit], 0, RoundingMode.Up);

/** `units × rate`, rounded because the amount is what gets persisted and what
 *  `bestRateCharge` compares — the two boundaries rounding belongs at. */
function tierCharge(days: number, unit: RateUnit, rate: number): RateCharge {
  if (!Number.isFinite(rate)) {
    throw new Error(`${unit} rate must be finite, got ${rate}`);
  }
  const units = wholeRateUnits(days, unit);
  return { amount: round(units * rate), rateUnitApplied: unit, units };
}

/** The cheapest way to bill `days` over the tiers the line offers: every
 *  tier's whole units, ties going to the larger unit (ten days is two weeks,
 *  not ten days; twenty days is a month, not three weeks). Evaluated per
 *  period, never cumulatively, so a period's charge is known when it is cut. */
export function bestRateCharge(days: number, rates: RateLadder): RateCharge {
  assertWholeDays(days);
  let best: RateCharge | null = null;
  for (const unit of UNITS_LARGEST_FIRST) {
    const rate = rates[RATE_OF[unit]];
    if (rate === null) continue;
    const candidate = tierCharge(days, unit, rate);
    // Strictly cheaper only: on a tie the larger unit, seen first, stays.
    if (best === null || candidate.amount < best.amount) best = candidate;
  }
  if (best === null) {
    throw new Error("Best rate needs at least one rate tier");
  }
  return best;
}

/** A Fixed line bills its tier for the whole units the period covers, even
 *  when another tier would be cheaper. */
export function fixedRateCharge(
  days: number,
  unit: RateUnit,
  rates: RateLadder,
): RateCharge {
  assertWholeDays(days);
  const rate = rates[RATE_OF[unit]];
  if (rate === null) {
    throw new Error(`The line bills the ${unit} tier but has no ${unit} rate`);
  }
  return tierCharge(days, unit, rate);
}

/** The month tier prorated by calendar days: `monthRate × days ÷ days in the
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

/** Cuts and prices a line's billing periods, and reconciles them with the
 *  rows already persisted.
 *
 *  Periods follow the cycle from `startDate`: calendar months (the first and
 *  last partial, priced by `calendarMonthCharge`) or consecutive 28-day
 *  windows (priced by the line's rate mode). `endDate` is a hard cut and the
 *  last day of a fixed term, generated in full up front; a unit still out
 *  past it keeps billing at the same rates from the day after (holdover).
 *  `returnedAt` is the final cut. Open-ended agreements roll: every period
 *  starting on or before `through`, plus one beyond it.
 *
 *  Rows are matched by `periodStart`. A generated period with no row is in
 *  `create`. A Pending row whose end moved (the return fell inside it) is in
 *  `recut`; a Pending row the generation no longer reaches is simply absent —
 *  the caller removes it. An Invoiced row billed in advance that extends past
 *  the return is credited in `adjustments` for what was billed less the
 *  charge for the days actually used — so a month tier already earned by a
 *  long stay yields nothing (the Texada rule), and a period the unit never
 *  reached is credited in full. Never a positive adjustment, and never a
 *  second one for the same period. */
export function generateRentalBillingPeriods(args: {
  cycle: RentalBillingCycle;
  timing: RentalBillingTiming;
  rateMode: RentalRateMode;
  rateUnit: RateUnit | null;
  rates: RateLadder;
  startDate: string;
  endDate: string | null;
  returnedAt: string | null;
  through: string;
  existing: ExistingBillingPeriod[];
}): RentalBillingPlan {
  const {
    cycle,
    timing,
    rateMode,
    rateUnit,
    rates,
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

  const price = (
    periodStart: string,
    periodEnd: string,
  ): Pick<PeriodSpec, "days" | "amount" | "rateUnitApplied"> => {
    const days = daysBetweenInclusive(periodStart, periodEnd);
    if (cycle === "Calendar Month") {
      if (rates.monthRate === null) {
        throw new Error("A Calendar Month agreement needs a month rate");
      }
      return {
        days,
        amount: calendarMonthCharge(periodStart, periodEnd, rates.monthRate),
        rateUnitApplied: "Month",
      };
    }
    if (rateMode === "Fixed") {
      if (rateUnit === null) {
        throw new Error("A Fixed line needs the rate unit it bills");
      }
      const { amount, rateUnitApplied } = fixedRateCharge(
        days,
        rateUnit,
        rates,
      );
      return { days, amount, rateUnitApplied };
    }
    const { amount, rateUnitApplied } = bestRateCharge(days, rates);
    return { days, amount, rateUnitApplied };
  };

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
