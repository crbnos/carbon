// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Database } from "@carbon/database";
import {
  addMonths,
  type LeasePaymentType,
  leaseMonthEnd,
  leaseMonthShare,
  leaseMonthsAt,
  leaseMonthsThrough,
  paymentMonthIndex,
  scheduleMonthOfPayment
} from "@carbon/database/lease-months";
import { round } from "@carbon/database/precision";
import {
  assertDiscountRate,
  classifyLessorLease,
  discountFactor,
  monthlyRate,
  type Timing
} from "./lessor-lease.ts";
import {
  addDays,
  daysBetweenInclusive,
  parseIsoDate
} from "./revenue-schedule.ts";

// Lessee lease math (ASC 842) shared by the post-lease server function and the
// app's Draft preview. Pure: numbers and `YYYY-MM-DD` strings in, numbers out —
// no database, no JS `Date`. Spec: `.ai/specs/2026-10-11-lessee-leases.md` §1–§3.
//
// A lease month runs from the commencement day: month `m` covers
// `addMonths(commencement, m)` to the day before `addMonths(commencement, m + 1)`.
// The month arithmetic and where a payment sits (`paymentMonthIndex`) live in
// `@carbon/database/lease-months`, so the accounting cutover reads payments the
// way this schedule pays them; they are re-exported here.

export {
  addMonths,
  type LeasePaymentType,
  leaseMonthShare,
  leaseMonthsAt,
  paymentMonthIndex
} from "@carbon/database/lease-months";

export type LesseeClassification = "Operating" | "Finance" | "Short-Term";
export type LeasePaymentFrequency = "Monthly" | "Quarterly" | "Annual";

const MONTHS_PER_YEAR = 12;
const FREQUENCY_MONTHS: Record<LeasePaymentFrequency, number> = {
  Monthly: 1,
  Quarterly: 3,
  Annual: 12
};

export type LeasePaymentRowInput = {
  periodStart: string;
  periodEnd: string;
  dueDate: string;
  amount: number;
  paymentType: LeasePaymentType;
};

/** The payment rows the terms cut, from `commencementDate` through `endDate`.
 *  The escalation steps up on each anniversary of commencement. A last
 *  period shorter than the frequency is prorated by days. A purchase option
 *  (pass it only when it is reasonably certain) is one more row on `endDate`.
 *
 *  An open-ended lease (`endDate` null) has no last period: it cuts every
 *  whole period that starts on or before `through`
 *  (`openEndedLeaseHorizon`), never prorated, and has no purchase option. */
export function generateLeasePayments(args: {
  commencementDate: string;
  endDate: string | null;
  /** Open-ended only: the last date a period may start on. */
  through?: string;
  paymentAmount: number;
  frequency: LeasePaymentFrequency;
  timing: Timing;
  annualEscalationPercent: number;
  purchaseOptionAmount: number;
  decimals: number;
}): LeasePaymentRowInput[] {
  const { commencementDate, endDate, decimals } = args;
  const lastStart = endDate ?? args.through;
  if (!lastStart) {
    throw new Error("An open-ended lease needs a date to cut its rows through");
  }
  // Validates the dates and refuses an end before the commencement.
  if (endDate) daysBetweenInclusive(commencementDate, endDate);
  const step = FREQUENCY_MONTHS[args.frequency];

  const rows: LeasePaymentRowInput[] = [];
  for (let i = 0; ; i += 1) {
    const periodStart = addMonths(commencementDate, i * step);
    if (periodStart > lastStart) break;
    const fullEnd = addDays(addMonths(commencementDate, (i + 1) * step), -1);
    const periodEnd = endDate && fullEnd > endDate ? endDate : fullEnd;

    const years = (i * step - ((i * step) % MONTHS_PER_YEAR)) / MONTHS_PER_YEAR;
    const escalated =
      args.paymentAmount * (1 + args.annualEscalationPercent / 100) ** years;
    const share =
      periodEnd === fullEnd
        ? 1
        : daysBetweenInclusive(periodStart, periodEnd) /
          daysBetweenInclusive(periodStart, fullEnd);

    rows.push({
      periodStart,
      periodEnd,
      dueDate: args.timing === "Advance" ? periodStart : periodEnd,
      amount: round(escalated * share, decimals),
      paymentType: "Rent"
    });
  }

  if (endDate && args.purchaseOptionAmount > 0) {
    rows.push({
      periodStart: endDate,
      periodEnd: endDate,
      dueDate: endDate,
      amount: round(args.purchaseOptionAmount, decimals),
      paymentType: "Purchase Option"
    });
  }
  return rows;
}

/** The last date an open-ended lease's payment period may start on to be cut
 *  by `asOf`: the start of the period after the one `asOf` falls in. So the
 *  rows always reach one period ahead of today, as an open-ended contract's
 *  schedule does. */
export function openEndedLeaseHorizon(
  commencementDate: string,
  asOf: string,
  frequency: LeasePaymentFrequency
): string {
  const step = FREQUENCY_MONTHS[frequency];
  const months = leaseMonthsAt(commencementDate, asOf);
  const period = (months - (months % step)) / step;
  return addMonths(commencementDate, (period + 1) * step);
}

/** The whole lease months from `commencementDate` through `endDate`. */
export function leaseTermMonths(
  commencementDate: string,
  endDate: string
): number {
  return leaseMonthsThrough(commencementDate, endDate);
}

/** The short-term test of ASC 842: a term of 12 months or less, measured on
 *  the dates — the rounded-down whole months would let 12 months and 15
 *  days pass. The term may run through the day before the first anniversary;
 *  a lease from Feb 29 has none the next year, so it runs through Feb 28. */
export function isTermWithinTwelveMonths(
  commencementDate: string,
  endDate: string
): boolean {
  const anniversary = addMonths(commencementDate, MONTHS_PER_YEAR);
  const clamped =
    parseIsoDate(anniversary).day < parseIsoDate(commencementDate).day;
  return endDate <= (clamped ? anniversary : addDays(anniversary, -1));
}

export type LeasePaymentPoint = { monthIndex: number; amount: number };

/** PV of payments at whole-month points, discounted at the monthly rate. */
export function presentValueOfPayments(args: {
  payments: LeasePaymentPoint[];
  annualRate: number;
}): number {
  assertDiscountRate(args.annualRate);
  const r = monthlyRate(args.annualRate);
  let pv = 0;
  for (const payment of args.payments) {
    pv += payment.amount * discountFactor(r, payment.monthIndex);
  }
  return round(pv);
}

export type LesseeClassificationResult = {
  classification: LesseeClassification;
  tests: { a: boolean; b: boolean; c: boolean; d: boolean; e: boolean };
  pvToFairValuePercent: number | null;
  termToLifePercent: number | null;
};

/** ASC 842-10-25-2 for a lessee. The short-term election (term of 12 months
 *  or less, no purchase option reasonably certain) wins; otherwise any of the
 *  five tests true ⇒ Finance, else Operating. The tests are the lessor's. */
export function classifyLesseeLease(
  args: {
    termMonths: number;
    pvPayments: number;
    fairValue: number | null;
    economicLifeMonths: number | null;
    ownershipTransfers: boolean;
    purchaseOptionReasonablyCertain: boolean;
    specializedAsset: boolean;
    shortTermExpedient: boolean;
    /** `isTermWithinTwelveMonths` of the term's dates. */
    withinTwelveMonths: boolean;
  },
  thresholds: { majorPartPercent: number; substantiallyAllPercent: number }
): LesseeClassificationResult {
  const result = classifyLessorLease(
    {
      ownershipTransfers: args.ownershipTransfers,
      purchaseOptionReasonablyCertain: args.purchaseOptionReasonablyCertain,
      termMonths: args.termMonths,
      economicLifeMonths: args.economicLifeMonths,
      pvPayments: args.pvPayments,
      fairValue: args.fairValue,
      specializedAsset: args.specializedAsset
    },
    thresholds
  );
  const shortTerm =
    args.shortTermExpedient &&
    args.withinTwelveMonths &&
    !args.purchaseOptionReasonablyCertain;
  return {
    classification: shortTerm
      ? "Short-Term"
      : result.classification === "Sale"
        ? "Finance"
        : "Operating",
    tests: result.tests,
    pvToFairValuePercent: result.pvToFairValuePercent,
    termToLifePercent: result.termToLifePercent
  };
}

export type LesseeScheduleLine = {
  periodDate: string;
  openingLiability: number;
  paymentAmount: number;
  interestAmount: number;
  principalAmount: number;
  closingLiability: number;
  leaseCost: number;
  rouAmortization: number;
  closingRouAsset: number;
};

/** The monthly effective-interest schedule of a capitalized lease (spec §3).
 *  Month `m` pays the payments at point `m` first (Advance) and the ones at
 *  point `m + 1` last (Arrears, and an end-of-term purchase option) —
 *  `scheduleMonthOfPayment`. Each line is rounded as it is cut; the last
 *  line's interest closes the liability at exactly 0. Operating: one
 *  straight-line lease cost, the ROU amortization is cost − interest.
 *  Finance: straight-line ROU amortization over `amortizationMonths`, the
 *  cost is interest + amortization. A last month cut short by the end date
 *  (`lastMonthShare`, its days over a full month's — `leaseMonthShare`) takes
 *  that share of a month's straight line, not a whole month's. */
export function buildLesseeSchedule(args: {
  openingLiability: number;
  openingRouAsset: number;
  payments: LeasePaymentPoint[];
  months: number;
  annualRate: number;
  timing: Timing;
  classification: "Operating" | "Finance";
  amortizationMonths: number;
  periodDates: string[];
  /** The last month's share of a full lease month, in (0, 1]. Default 1. */
  lastMonthShare?: number;
}): LesseeScheduleLine[] {
  const { months } = args;
  if (!Number.isInteger(months) || months < 1) {
    throw new Error(
      months === 0
        ? "A lease schedule needs at least one month; a lease that ends before its first month does cannot be capitalized"
        : `A lease schedule needs a whole number of months, got ${months}`
    );
  }
  if (args.periodDates.length !== months) {
    throw new Error(
      `A ${months}-month schedule needs ${months} dates, got ${args.periodDates.length}`
    );
  }
  const share = args.lastMonthShare ?? 1;
  if (!(share > 0 && share <= 1)) {
    throw new Error(
      `The last month's share must be more than 0 and at most 1, got ${share}`
    );
  }
  const r = monthlyRate(args.annualRate);

  const atStart = new Array<number>(months).fill(0);
  const atEnd = new Array<number>(months).fill(0);
  let totalPayments = 0;
  for (const payment of args.payments) {
    const k = payment.monthIndex;
    if (k < 0 || k > months) {
      throw new Error(
        `A payment at month ${k} is outside the ${months}-month term`
      );
    }
    totalPayments += payment.amount;
    const { month, at } = scheduleMonthOfPayment(k, args.timing, months);
    const into = at === "start" ? atStart : atEnd;
    into[month] = (into[month] ?? 0) + payment.amount;
  }

  // The term in full months: the last one counts for its share.
  const termWeight = months - 1 + share;
  const operatingCost =
    (totalPayments + args.openingRouAsset - args.openingLiability) / termWeight;
  const amortizesOverTerm = args.amortizationMonths === months;
  const financeAmortization =
    args.openingRouAsset /
    (amortizesOverTerm ? termWeight : args.amortizationMonths);

  const lines: LesseeScheduleLine[] = [];
  let opening = round(args.openingLiability);
  let rou = round(args.openingRouAsset);
  for (const [m, periodDate] of args.periodDates.entries()) {
    const last = m === months - 1;
    const start = round(atStart[m] ?? 0);
    const end = round(atEnd[m] ?? 0);
    const interest = last
      ? round(start + end - opening)
      : round((opening - start) * r);
    const closing = last ? 0 : round(opening - start + interest - end);

    let leaseCost: number;
    let rouAmortization: number;
    if (args.classification === "Operating") {
      // The last month takes what is left of the ROU asset, so the straight
      // line closes on the total exactly.
      rouAmortization = last ? rou : round(round(operatingCost) - interest);
      leaseCost = round(rouAmortization + interest);
    } else {
      rouAmortization =
        last && amortizesOverTerm
          ? rou
          : round(Math.min(financeAmortization * (last ? share : 1), rou));
      leaseCost = round(interest + rouAmortization);
    }

    lines.push({
      periodDate,
      openingLiability: opening,
      paymentAmount: round(start + end),
      interestAmount: interest,
      principalAmount: round(start + end - interest),
      closingLiability: closing,
      leaseCost,
      rouAmortization,
      closingRouAsset: round(rou - rouAmortization)
    });
    opening = closing;
    rou = round(rou - rouAmortization);
  }
  return lines;
}

/** The last day of each lease month, from month `fromMonth` for `count`
 *  months: the day before `addMonths(commencement, m + 1)`. */
export function leaseMonthEnds(
  commencementDate: string,
  fromMonth: number,
  count: number
): string[] {
  return Array.from({ length: count }, (_, i) =>
    leaseMonthEnd(commencementDate, fromMonth + i)
  );
}

/** A remeasurement (ASC 842-20-35-4/5): the remaining payments re-discounted
 *  at the revised rate, the ROU asset moved by the same amount. A decrease
 *  larger than the ROU asset leaves it at 0 and the rest is a gain. */
export function remeasureLease(args: {
  carryingLiability: number;
  carryingRouAsset: number;
  remainingPayments: LeasePaymentPoint[];
  annualRate: number;
}): { liability: number; adjustment: number; rouAsset: number; gain: number } {
  const liability = presentValueOfPayments({
    payments: args.remainingPayments,
    annualRate: args.annualRate
  });
  const adjustment = round(liability - args.carryingLiability);
  const rouAsset = round(args.carryingRouAsset + adjustment);
  return rouAsset < 0
    ? { liability, adjustment, rouAsset: 0, gain: round(-rouAsset) }
    : { liability, adjustment, rouAsset, gain: 0 };
}

// --- Lifecycle math -----------------------------------------------------------
// What `post-lease` books when an asset is measured, modified, ended or bought,
// as pure functions the app's previews call too, so a preview and the journal
// it previews cannot disagree.

/** The whole years of the lease before lease month `month`: the escalation
 *  steps up on each anniversary of the commencement. */
export function leaseEscalationYears(month: number): number {
  return (month - (month % MONTHS_PER_YEAR)) / MONTHS_PER_YEAR;
}

/** The payment an asset pays in lease month `month`: its commencement
 *  payment, escalated on each anniversary. Not rounded — the rows round. */
export function escalatedLeasePayment(
  paymentAmount: number,
  annualEscalationPercent: number,
  month: number
): number {
  return (
    paymentAmount *
    (1 + annualEscalationPercent / 100) ** leaseEscalationYears(month)
  );
}

/** One asset's payment rows from lease month `fromMonth` on, cut from the
 *  COMMENCEMENT so the escalation steps up on its anniversaries and a lease
 *  from the 29th–31st keeps its clamped months. `paymentAtStart` is the
 *  payment at lease month `fromMonth` (the escalated rate then); the asset's
 *  commencement payment is derived from it. A period that started before
 *  `fromMonth` (the frequency changed) is cut down to its days from there. */
export function remainingLeasePayments(args: {
  commencementDate: string;
  fromMonth: number;
  endDate: string;
  paymentAtStart: number;
  frequency: LeasePaymentFrequency;
  timing: Timing;
  annualEscalationPercent: number;
  purchaseOptionAmount: number;
  decimals: number;
}): { commencementPayment: number; rows: LeasePaymentRowInput[] } {
  const startDate = addMonths(args.commencementDate, args.fromMonth);
  const commencementPayment =
    args.paymentAtStart /
    escalatedLeasePayment(1, args.annualEscalationPercent, args.fromMonth);
  const rows = generateLeasePayments({
    commencementDate: args.commencementDate,
    endDate: args.endDate,
    paymentAmount: commencementPayment,
    frequency: args.frequency,
    timing: args.timing,
    annualEscalationPercent: args.annualEscalationPercent,
    purchaseOptionAmount: args.purchaseOptionAmount,
    decimals: args.decimals
  }).flatMap((row): LeasePaymentRowInput[] => {
    if (row.paymentType !== "Rent" || row.periodStart >= startDate) {
      return [row];
    }
    if (row.periodEnd < startDate) return [];
    const share =
      daysBetweenInclusive(startDate, row.periodEnd) /
      daysBetweenInclusive(row.periodStart, row.periodEnd);
    return [
      {
        ...row,
        periodStart: startDate,
        dueDate: args.timing === "Advance" ? startDate : row.periodEnd,
        amount: round(row.amount * share, args.decimals)
      }
    ];
  });
  return {
    commencementPayment: round(commencementPayment),
    rows: rows.filter((row) => row.amount > 0)
  };
}

/** The lease months a schedule from lease month `fromMonth` to `endDate`
 *  covers — the whole months of the term, plus a last part month when the
 *  term does not end on a month boundary, never fewer than one — and their
 *  last days, the final one clamped to `endDate`. The months are the
 *  commencement's. `termMonths` is the whole months from `fromMonth`.
 *  `lastMonthShare` is the last month's share of a full month by days
 *  (`leaseMonthShare`), for `buildLesseeSchedule`: a part month takes that
 *  share of the lease cost. */
export function lesseeScheduleSpan(
  commencementDate: string,
  endDate: string,
  fromMonth = 0
): {
  termMonths: number;
  withinTwelveMonths: boolean;
  months: number;
  periodDates: string[];
  lastMonthShare: number;
} {
  const allMonths = leaseTermMonths(commencementDate, endDate);
  const termMonths = allMonths - fromMonth;
  const hasPartMonth = addMonths(commencementDate, allMonths) <= endDate;
  const months = Math.max(1, termMonths + (hasPartMonth ? 1 : 0));
  const periodDates = leaseMonthEnds(commencementDate, fromMonth, months).map(
    (date) => (date > endDate ? endDate : date)
  );
  const lastMonth = fromMonth + months - 1;
  return {
    termMonths,
    withinTwelveMonths: isTermWithinTwelveMonths(
      addMonths(commencementDate, fromMonth),
      endDate
    ),
    months,
    periodDates,
    // A last month that starts after the end (a span forced to one month)
    // has no days to share.
    lastMonthShare:
      addMonths(commencementDate, lastMonth) <= endDate
        ? leaseMonthShare(commencementDate, lastMonth, endDate)
        : 1
  };
}

type PaymentPosition = {
  periodStart: string;
  periodEnd: string;
  dueDate: string;
  paymentType: LeasePaymentType;
};

/** The schedule month a payment is paid in, as `buildLesseeSchedule` places
 *  it: at the start of month `k` (Advance, or point 0), else at the end of
 *  month `k − 1`. `months` is the schedule's length. */
export function lesseeScheduleMonthOf(
  payment: PaymentPosition,
  commencementDate: string,
  timing: Timing,
  months: number
): number {
  return scheduleMonthOfPayment(
    paymentMonthIndex(payment, commencementDate, timing),
    timing,
    months
  ).month;
}

/** Whether an opening balance struck on `asOf` holds a payment: the
 *  schedule pays it in a month that ends before `asOf` (the months the
 *  carrying balances have already deducted). Decided by the schedule month,
 *  not the due date — an Advance payment due inside the as-of month is still
 *  in the carrying liability. `periodDates` are the schedule's month ends
 *  (`lesseeScheduleSpan`). */
export function isPaidBeforeOpening(
  payment: PaymentPosition,
  args: {
    commencementDate: string;
    timing: Timing;
    periodDates: string[];
    asOf: string;
  }
): boolean {
  const monthsBefore = args.periodDates.filter(
    (date) => date < args.asOf
  ).length;
  return (
    lesseeScheduleMonthOf(
      payment,
      args.commencementDate,
      args.timing,
      args.periodDates.length
    ) < monthsBefore
  );
}

export type LesseeAssetInputs = {
  fairValue: number | null;
  economicLifeMonths: number | null;
  ownershipTransfers: boolean;
  purchaseOptionReasonablyCertain: boolean;
  specializedAsset: boolean;
};

/** One asset's liability — the PV of its payment rows from lease month
 *  `fromMonth` (0 at commencement) — and how it classifies over the term
 *  from there to `endDate`. The override, when there is one, is the
 *  caller's. */
export function measureLesseeAsset(args: {
  commencementDate: string;
  endDate: string;
  timing: Timing;
  /** Annual %. */
  discountRate: number;
  payments: (PaymentPosition & { amount: number })[];
  fromMonth?: number;
  inputs: LesseeAssetInputs;
  shortTermExpedient: boolean;
  thresholds: { majorPartPercent: number; substantiallyAllPercent: number };
}): LesseeClassificationResult & {
  liability: number;
  termMonths: number;
} {
  const fromMonth = args.fromMonth ?? 0;
  const span = lesseeScheduleSpan(
    args.commencementDate,
    args.endDate,
    fromMonth
  );
  const liability = presentValueOfPayments({
    payments: args.payments.map((payment) => ({
      monthIndex:
        paymentMonthIndex(payment, args.commencementDate, args.timing) -
        fromMonth,
      amount: Number(payment.amount)
    })),
    annualRate: args.discountRate
  });
  const result = classifyLesseeLease(
    {
      ...args.inputs,
      termMonths: span.termMonths,
      withinTwelveMonths: span.withinTwelveMonths,
      pvPayments: liability,
      shortTermExpedient: args.shortTermExpedient
    },
    args.thresholds
  );
  return { ...result, liability, termMonths: span.termMonths };
}

export type LesseeCarrying = {
  /** The asset's lease liability at the start of `startDate`. */
  liability: number;
  /** ROU amortization booked before `startDate`. */
  accumulated: number;
  /** ROU cost less the accumulated amortization. */
  rouAsset: number;
};

/** One asset's carrying amounts at the start of `startDate`: the closing
 *  liability of its last schedule month before the date (its initial
 *  liability when none is), and the amortization of every month before it.
 *  `schedule` is that asset's schedule lines. */
export function lesseeCarryingAt(args: {
  schedule: {
    periodDate: string;
    closingLiability: number;
    rouAmortization: number;
  }[];
  startDate: string;
  initialLiability: number | null;
  rouAssetCost: number | null;
}): LesseeCarrying {
  const before = args.schedule
    .filter((row) => row.periodDate < args.startDate)
    .sort((a, b) => a.periodDate.localeCompare(b.periodDate));
  const last = before.at(-1);
  const accumulated = round(
    before.reduce((sum, row) => sum + Number(row.rouAmortization), 0)
  );
  return {
    liability: last
      ? Number(last.closingLiability)
      : Number(args.initialLiability ?? 0),
    accumulated,
    rouAsset: round(Number(args.rouAssetCost ?? 0) - accumulated)
  };
}

/** What an asset's ending adds back to its carrying liability: a Pending
 *  Purchase Option row due on or before `lastDay` was counted as paid by
 *  the schedule, and the ending removes it unpaid. `payments` are that
 *  asset's rows. */
export function endedPaymentsAddBack(
  payments: {
    paymentType: LeasePaymentType;
    status: string;
    dueDate: string;
    amount: number;
  }[],
  lastDay: string
): number {
  return round(
    payments
      .filter(
        (payment) =>
          payment.status === "Pending" &&
          payment.paymentType === "Purchase Option" &&
          payment.dueDate <= lastDay
      )
      .reduce((sum, payment) => sum + Number(payment.amount), 0)
  );
}

/** The accounts a lessee journal posts to, by role. The server resolves each
 *  to the company's account; the app labels it. */
export type LesseeLegAccount =
  | "rightOfUseAsset"
  | "accumulatedRightOfUseAmortization"
  | "leaseLiability"
  | "gain"
  | "loss"
  | "fixedAsset"
  | "retainedEarnings";

/** One side of a lessee journal. A negative amount belongs on the other
 *  side (`normalizeLesseeLegs`). */
export type LesseeLeg = {
  side: "debit" | "credit";
  account: LesseeLegAccount;
  description: string;
  amount: number;
};

/** The legs as they post: each amount rounded, a negative one moved to the
 *  other side, and a zero one dropped. */
export function normalizeLesseeLegs(legs: LesseeLeg[]): LesseeLeg[] {
  return legs.flatMap((leg): LesseeLeg[] => {
    const amount = round(leg.amount);
    if (amount === 0) return [];
    if (amount > 0) return [{ ...leg, amount }];
    return [
      {
        ...leg,
        side: leg.side === "debit" ? "credit" : "debit",
        amount: -amount
      }
    ];
  });
}

/** Commencement: Dr ROU asset / Cr Lease liability, both at the PV. */
export function lesseeCommencementLegs(args: {
  liability: number;
}): LesseeLeg[] {
  return [
    {
      side: "debit",
      account: "rightOfUseAsset",
      description: "Right-of-use asset",
      amount: args.liability
    },
    {
      side: "credit",
      account: "leaseLiability",
      description: "Lease liability",
      amount: args.liability
    }
  ];
}

/** Opening balance of a lease that commenced before the accounting cutover:
 *  the balances its schedule reaches on the as-of date, the difference — the
 *  lease cost of the months before it — to retained earnings. */
export function lesseeOpeningBalanceLegs(args: {
  rouAssetCost: number;
  accumulated: number;
  carryingLiability: number;
}): LesseeLeg[] {
  const { rouAssetCost, accumulated, carryingLiability } = args;
  return [
    {
      side: "debit",
      account: "rightOfUseAsset",
      description: "Right-of-use asset",
      amount: rouAssetCost
    },
    {
      side: "credit",
      account: "accumulatedRightOfUseAmortization",
      description: "Accumulated right-of-use amortization",
      amount: accumulated
    },
    {
      side: "credit",
      account: "leaseLiability",
      description: "Lease liability",
      amount: carryingLiability
    },
    {
      side: "credit",
      account: "retainedEarnings",
      description: "Lease cost before the opening date",
      amount: round(rouAssetCost - accumulated - carryingLiability)
    }
  ];
}

/** Remeasurement (Modify): the ROU asset moves by the liability change; a
 *  decrease larger than the ROU asset leaves it at zero and the rest is a
 *  gain. `adjustment` = new liability − carrying liability. */
export function lesseeRemeasurementLegs(args: {
  adjustment: number;
  gain: number;
}): LesseeLeg[] {
  return [
    {
      side: "debit",
      account: "rightOfUseAsset",
      description: "Right-of-use asset remeasured",
      amount: round(args.adjustment + args.gain)
    },
    {
      side: "credit",
      account: "leaseLiability",
      description: "Lease liability remeasured",
      amount: args.adjustment
    },
    {
      side: "credit",
      account: "gain",
      description: "Gain on lease modification",
      amount: args.gain
    }
  ];
}

/** Early termination (ASC 842-20-40-1): the liability and the ROU asset
 *  leave the books, and the difference is a gain or a loss. A penalty stays
 *  in the liability as a payment row the next invoice settles. */
export function lesseeTerminationLegs(args: {
  carryingLiability: number;
  penalty: number;
  rouAssetCost: number;
  accumulated: number;
}): { legs: LesseeLeg[]; gainLoss: number } {
  const { carryingLiability, penalty, rouAssetCost, accumulated } = args;
  const gainLoss = round(
    carryingLiability - penalty - (rouAssetCost - accumulated)
  );
  return {
    gainLoss,
    legs: [
      {
        side: "debit",
        account: "leaseLiability",
        description: "Lease liability derecognized",
        amount: round(carryingLiability - penalty)
      },
      {
        side: "debit",
        account: "accumulatedRightOfUseAmortization",
        description: "Accumulated amortization derecognized",
        amount: accumulated
      },
      {
        side: "credit",
        account: "rightOfUseAsset",
        description: "Right-of-use asset derecognized",
        amount: rouAssetCost
      },
      gainLoss >= 0
        ? {
            side: "credit",
            account: "gain",
            description: "Gain on lease termination",
            amount: gainLoss
          }
        : {
            side: "debit",
            account: "loss",
            description: "Loss on lease termination",
            amount: -gainLoss
          }
    ]
  };
}

/** Purchase option exercise (ASC 842-20-40-2): not a termination. The ROU
 *  asset moves into PP&E at its net book value, adjusted by the price less
 *  the carrying liability; the price stays in the liability as a payment row
 *  the next invoice settles. A negative `assetCost` is returned, not refused:
 *  the caller decides (`post-lease` refuses it, the app disables Purchase). */
export function lesseePurchaseLegs(args: {
  carryingLiability: number;
  price: number;
  rouAssetCost: number;
  accumulated: number;
}): { legs: LesseeLeg[]; assetCost: number } {
  const { carryingLiability, price, rouAssetCost, accumulated } = args;
  const assetCost = round(
    rouAssetCost - accumulated + price - carryingLiability
  );
  return {
    assetCost,
    legs: [
      {
        side: "debit",
        account: "fixedAsset",
        description: "Leased asset purchased",
        amount: assetCost
      },
      {
        side: "debit",
        account: "accumulatedRightOfUseAmortization",
        description: "Accumulated amortization derecognized",
        amount: accumulated
      },
      {
        side: "debit",
        account: "leaseLiability",
        description: "Lease liability derecognized",
        amount: carryingLiability
      },
      {
        side: "credit",
        account: "rightOfUseAsset",
        description: "Right-of-use asset derecognized",
        amount: rouAssetCost
      },
      {
        side: "credit",
        account: "leaseLiability",
        description: "Purchase price payable",
        amount: price
      }
    ]
  };
}

type LeaseStatus = Database["public"]["Enums"]["leaseStatus"];

/** A lease that has run its course but may still owe a payment: a
 *  termination penalty, a purchase price, or a row a voided invoice
 *  returned to Pending. */
export const ENDED_LEASE_STATUSES = [
  "Expired",
  "Terminated",
  "Purchased"
] as const satisfies readonly LeaseStatus[];

/** The statuses a lease can be invoiced in: Active, or ended. A Draft lease
 *  is not yet a lease, and a Cancelled one never was. Drafting
 *  (the daily job) and posting agree on this list. */
export const BILLABLE_LEASE_STATUSES = [
  "Active",
  ...ENDED_LEASE_STATUSES
] as const satisfies readonly LeaseStatus[];

export function isBillableLeaseStatus(status: LeaseStatus): boolean {
  return (BILLABLE_LEASE_STATUSES as readonly LeaseStatus[]).includes(status);
}
