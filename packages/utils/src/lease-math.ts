// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { round } from "@carbon/database/precision";
import {
  classifyLessorLease,
  type Timing,
  wholeMonthsInTerm
} from "./lessor-lease.ts";
import {
  addDays,
  daysBetweenInclusive,
  daysInMonth,
  formatIsoDate,
  parseIsoDate
} from "./revenue-schedule.ts";

// Lessee lease math (ASC 842) shared by the post-lease server function and the
// app's Draft preview. Pure: numbers and `YYYY-MM-DD` strings in, numbers out —
// no database, no JS `Date`. Spec: `.ai/specs/2026-10-11-lessee-leases.md` §1–§3.
//
// A lease month runs from the commencement day: month `m` covers
// `addMonths(commencement, m)` to the day before `addMonths(commencement, m + 1)`.
// A payment sits at a whole-month point `k` from commencement: an Advance rent
// row at the start of its period, an Arrears rent row at the end of its period,
// a purchase option or termination penalty at the end of its due date.

export type LesseeClassification = "Operating" | "Finance" | "Short-Term";
export type LeasePaymentFrequency = "Monthly" | "Quarterly" | "Annual";
export type LeasePaymentType =
  | "Rent"
  | "Purchase Option"
  | "Termination Penalty";

const MONTHS_PER_YEAR = 12;
const FREQUENCY_MONTHS: Record<LeasePaymentFrequency, number> = {
  Monthly: 1,
  Quarterly: 3,
  Annual: 12
};

/** Periodic rate from an annual percentage: 6 (%) → 0.005 per month. */
const monthlyRate = (annualRate: number): number => annualRate / 100 / 12;

/** `date` moved by whole calendar months, the day clamped to the target
 *  month's length: 2027-01-31 + 1 → 2027-02-28. */
export function addMonths(date: string, months: number): string {
  const { year, month, day } = parseIsoDate(date);
  const index = year * MONTHS_PER_YEAR + (month - 1) + months;
  const targetYear = (index - (index % MONTHS_PER_YEAR)) / MONTHS_PER_YEAR;
  const targetMonth = (index % MONTHS_PER_YEAR) + 1;
  return formatIsoDate(
    targetYear,
    targetMonth,
    Math.min(day, daysInMonth(targetYear, targetMonth))
  );
}

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
 *  (pass it only when it is reasonably certain) is one more row on `endDate`. */
export function generateLeasePayments(args: {
  commencementDate: string;
  endDate: string;
  paymentAmount: number;
  frequency: LeasePaymentFrequency;
  timing: Timing;
  annualEscalationPercent: number;
  purchaseOptionAmount: number;
  decimals: number;
}): LeasePaymentRowInput[] {
  const { commencementDate, endDate, decimals } = args;
  // Validates both dates and refuses an end before the commencement.
  daysBetweenInclusive(commencementDate, endDate);
  const step = FREQUENCY_MONTHS[args.frequency];

  const rows: LeasePaymentRowInput[] = [];
  for (let i = 0; ; i += 1) {
    const periodStart = addMonths(commencementDate, i * step);
    if (periodStart > endDate) break;
    const fullEnd = addDays(addMonths(commencementDate, (i + 1) * step), -1);
    const periodEnd = fullEnd > endDate ? endDate : fullEnd;

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

  if (args.purchaseOptionAmount > 0) {
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

/** Whole months from commencement to the start of `date`. */
function monthsBefore(commencementDate: string, date: string): number {
  if (date <= commencementDate) return 0;
  return wholeMonthsInTerm(commencementDate, addDays(date, -1));
}

/** Whole months from commencement to the end of `date`. */
function monthsThrough(commencementDate: string, date: string): number {
  if (date < commencementDate) return 0;
  return wholeMonthsInTerm(commencementDate, date);
}

/** The whole-month point `k` a payment row sits at (plan decision P4). */
export function paymentMonthIndex(
  row: Pick<
    LeasePaymentRowInput,
    "periodStart" | "periodEnd" | "dueDate" | "paymentType"
  >,
  commencementDate: string,
  timing: Timing
): number {
  if (row.paymentType !== "Rent") {
    return monthsThrough(commencementDate, row.dueDate);
  }
  return timing === "Advance"
    ? monthsBefore(commencementDate, row.periodStart)
    : monthsThrough(commencementDate, row.periodEnd);
}

export type LeasePaymentPoint = { monthIndex: number; amount: number };

/** PV of payments at whole-month points, discounted at the monthly rate. */
export function presentValueOfPayments(args: {
  payments: LeasePaymentPoint[];
  annualRate: number;
}): number {
  const r = monthlyRate(args.annualRate);
  if (!Number.isFinite(args.annualRate) || args.annualRate < 0) {
    throw new Error(
      `The discount rate must be zero or more, got ${args.annualRate}`
    );
  }
  let pv = 0;
  for (const payment of args.payments) {
    pv += payment.amount * (1 + r) ** -payment.monthIndex;
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
    args.termMonths <= MONTHS_PER_YEAR &&
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
 *  point `m + 1` last (Arrears, and an end-of-term purchase option). Each line
 *  is rounded as it is cut; the last line's interest closes the liability at
 *  exactly 0. Operating: one straight-line lease cost, the ROU amortization is
 *  cost − interest. Finance: straight-line ROU amortization over
 *  `amortizationMonths`, the cost is interest + amortization. */
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
}): LesseeScheduleLine[] {
  const { months } = args;
  if (!Number.isInteger(months) || months < 1) {
    throw new Error(`A lease needs a whole number of months, got ${months}`);
  }
  if (args.periodDates.length !== months) {
    throw new Error(
      `A ${months}-month schedule needs ${months} dates, got ${args.periodDates.length}`
    );
  }
  const r = monthlyRate(args.annualRate);

  // A payment at point k: the start of month k, unless k is past the last
  // month or the lease pays in arrears — then the end of month k − 1.
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
    if (k < months && (args.timing === "Advance" || k === 0)) {
      atStart[k] = (atStart[k] ?? 0) + payment.amount;
    } else {
      atEnd[k - 1] = (atEnd[k - 1] ?? 0) + payment.amount;
    }
  }

  const operatingCost =
    (totalPayments + args.openingRouAsset - args.openingLiability) / months;
  const financeAmortization = args.openingRouAsset / args.amortizationMonths;

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
        last && args.amortizationMonths === months
          ? rou
          : round(Math.min(financeAmortization, rou));
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
    addDays(addMonths(commencementDate, fromMonth + i + 1), -1)
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
