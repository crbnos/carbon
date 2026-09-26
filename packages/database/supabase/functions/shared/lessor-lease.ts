import { round, RoundingMode, SCALE } from "./precision.ts";
import {
  bestRateCharge,
  fixedRateCharge,
  type RateLadder,
  type RateUnit,
  type RentalBillingCycle,
  type RentalRateMode,
} from "./rental-billing.ts";
import {
  addDays,
  daysBetweenInclusive,
  monthEnd,
  parseIsoDate,
} from "./revenue-schedule.ts";

// Lessor lease math (ASC 842) shared by activation, the recognition run and
// the app (re-exported to Node through @carbon/utils). Pure: numbers and
// `YYYY-MM-DD` strings in, numbers out — no database, no JS `Date`.
// Spec: .ai/specs/2026-09-22-revenue-recognition-and-rentals.md §4.

export type Timing = "Advance" | "Arrears";

export type LessorClassification = "Operating" | "Sales-Type";

/** Periodic rate from an annual percentage: 6 (%) → 0.005 per month. */
const monthlyRate = (annualRate: number): number => annualRate / 100 / 12;

function assertLeaseInputs(periods: number, annualRate: number): void {
  if (!Number.isInteger(periods) || periods < 1) {
    throw new Error(`A lease needs a whole number of periods, got ${periods}`);
  }
  if (!Number.isFinite(annualRate) || annualRate < 0) {
    throw new Error(`The discount rate must be zero or more, got ${annualRate}`);
  }
}

/** Discount factor for an amount `n` periods out: (1 + r)^−n. */
const discount = (r: number, n: number): number => (1 + r) ** -n;

/** PV of `periods` equal payments: annuity-immediate when billed in arrears
 *  (first payment one period out), annuity-due in advance (first payment
 *  today). A zero rate is the undiscounted sum. */
function annuity(
  payment: number,
  periods: number,
  r: number,
  timing: Timing,
): number {
  if (r === 0) return payment * periods;
  const immediate = (payment * (1 - discount(r, periods))) / r;
  return timing === "Advance" ? immediate * (1 + r) : immediate;
}

/** The lessor's present values at commencement (spec §4):
 *  - `pvRent`: the fixed rent stream alone;
 *  - `pvPayments` (PVpay): rent + the purchase option (pass it only when it
 *    is reasonably certain) + the guaranteed residual, both discounted from
 *    the end of the term — the lease payments the classification test (d)
 *    and the Lease Revenue credit use;
 *  - `pvResidual` (PVres): the unguaranteed residual, discounted the same way;
 *  - `netInvestment` (NI) = PVpay + PVres.
 *  Rounded once each, at the persist boundary. */
export function presentValue(args: {
  payment: number;
  periods: number;
  annualRate: number;
  timing: Timing;
  purchaseOption?: number;
  guaranteedResidual?: number;
  unguaranteedResidual?: number;
}): {
  pvRent: number;
  pvPayments: number;
  pvResidual: number;
  netInvestment: number;
} {
  const { payment, periods, annualRate, timing } = args;
  assertLeaseInputs(periods, annualRate);
  const r = monthlyRate(annualRate);
  const atTermEnd = discount(r, periods);

  const rent = annuity(payment, periods, r, timing);
  const payments = rent +
    ((args.purchaseOption ?? 0) + (args.guaranteedResidual ?? 0)) * atTermEnd;
  const residual = (args.unguaranteedResidual ?? 0) * atTermEnd;

  return {
    pvRent: round(rent),
    pvPayments: round(payments),
    pvResidual: round(residual),
    netInvestment: round(payments + residual),
  };
}

/** ASC 842-10-25-2: any test true ⇒ Sales-Type, else Operating.
 *  (a) ownership transfers; (b) a purchase option reasonably certain;
 *  (c) term ≥ `majorPartPercent` of the economic life; (d) PV of the lease
 *  payments ≥ `substantiallyAllPercent` of fair value; (e) specialized asset.
 *  An open-ended agreement (`termMonths` null) has no lease term to transfer
 *  the asset over, so it is always Operating — Sales-Type requires an end
 *  date; its tests are still reported for the record. Direct Financing needs
 *  a third-party residual guarantee input that v1 does not have. */
export function classifyLessorLease(
  inputs: {
    ownershipTransfers: boolean;
    purchaseOptionReasonablyCertain: boolean;
    termMonths: number | null;
    economicLifeMonths: number | null;
    pvPayments: number;
    fairValue: number | null;
    specializedAsset: boolean;
  },
  thresholds: { majorPartPercent: number; substantiallyAllPercent: number },
): {
  classification: LessorClassification;
  tests: { a: boolean; b: boolean; c: boolean; d: boolean; e: boolean };
  pvToFairValuePercent: number | null;
  termToLifePercent: number | null;
} {
  const { termMonths, economicLifeMonths, fairValue, pvPayments } = inputs;

  const termToLifePercent =
    termMonths !== null && economicLifeMonths !== null && economicLifeMonths > 0
      ? round((termMonths / economicLifeMonths) * 100)
      : null;
  const pvToFairValuePercent = fairValue !== null && fairValue > 0
    ? round((pvPayments / fairValue) * 100)
    : null;

  const tests = {
    a: inputs.ownershipTransfers,
    b: inputs.purchaseOptionReasonablyCertain,
    c: termToLifePercent !== null &&
      termToLifePercent >= thresholds.majorPartPercent,
    d: pvToFairValuePercent !== null &&
      pvToFairValuePercent >= thresholds.substantiallyAllPercent,
    e: inputs.specializedAsset,
  };

  const anyTest = tests.a || tests.b || tests.c || tests.d || tests.e;
  return {
    classification: termMonths !== null && anyTest ? "Sales-Type" : "Operating",
    tests,
    pvToFairValuePercent,
    termToLifePercent,
  };
}

export type LessorScheduleLine = {
  periodDate: string;
  openingNetInvestment: number;
  paymentAmount: number;
  interestAmount: number;
  principalAmount: number;
  closingNetInvestment: number;
};

/** The effective-interest schedule of a Sales-Type line (spec §4). Arrears:
 *  interest accrues on the opening balance, then the payment lands. Advance:
 *  the payment lands first and interest accrues on what remains. Each line is
 *  rounded as it is cut and the next opens on that rounded close; the last
 *  line's interest absorbs the drift so the term closes on `closingTarget`
 *  (purchase option + residuals) exactly. `periodDates` names each line. */
export function buildLessorSchedule(args: {
  netInvestment: number;
  payment: number;
  periods: number;
  annualRate: number;
  timing: Timing;
  closingTarget: number;
  periodDates: string[];
}): LessorScheduleLine[] {
  const { netInvestment, payment, periods, annualRate, timing } = args;
  assertLeaseInputs(periods, annualRate);
  if (args.periodDates.length !== periods) {
    throw new Error(
      `A ${periods}-period schedule needs ${periods} dates, got ${args.periodDates.length}`,
    );
  }
  const r = monthlyRate(annualRate);

  const lines: LessorScheduleLine[] = [];
  let opening = round(netInvestment);
  for (const [i, periodDate] of args.periodDates.entries()) {
    const last = i === periods - 1;
    const earningBase = timing === "Advance" ? opening - payment : opening;
    // The last line closes on the target; its interest is what gets it there.
    const interest = last
      ? round(args.closingTarget - opening + payment)
      : round(earningBase * r);
    const principal = round(payment - interest);
    const closing = last ? round(args.closingTarget) : round(opening - principal);
    lines.push({
      periodDate,
      openingNetInvestment: opening,
      paymentAmount: payment,
      interestAmount: interest,
      principalAmount: principal,
      closingNetInvestment: closing,
    });
    opening = closing;
  }
  return lines;
}

// ---------------------------------------------------------------------------
// A rental line's lease terms and classification — one implementation for
// activation (post-rental-agreement) and the app's Draft preview.
// ---------------------------------------------------------------------------

/** Days in one `28 Days` billing period, and how many of them a year holds
 *  in days — the period rate is the annual rate × 28 / 365. */
const DAYS_PER_28_DAY_PERIOD = 28;
const DAYS_PER_YEAR = 365;
const MONTHS_PER_YEAR = 12;

/** Whole calendar months from `startDate` through `endDate` (both inclusive:
 *  `endDate` is the last day of the term). 2027-01-01 → 2029-12-31 is 36;
 *  2027-01-15 → 2028-01-14 is 12; a stay shorter than a month is 0. */
export function wholeMonthsInTerm(startDate: string, endDate: string): number {
  // Validates both dates and refuses an end before the start.
  daysBetweenInclusive(startDate, endDate);
  const start = parseIsoDate(startDate);
  const after = parseIsoDate(addDays(endDate, 1));
  const months = (after.year - start.year) * MONTHS_PER_YEAR +
    (after.month - start.month);
  return after.day < start.day ? months - 1 : months;
}

export type LeasePaymentTerms = {
  /** Whole months of the term; null when the agreement is open-ended. */
  termMonths: number | null;
  /** The level payment per billing period. */
  payment: number;
  /** Number of billing periods the lease is valued over (at least 1). */
  periods: number;
  /** The annual percentage passed to `presentValue` / `buildLessorSchedule`.
   *  Those derive the PERIOD rate as annualRate / 100 / 12, which is right
   *  for a Calendar Month cycle. A 28 Days cycle's period rate must be
   *  annual × 28 / 365, so its rate is passed scaled by 12 × 28 / 365 —
   *  (annual × 12 × 28 / 365) / 12 = annual × 28 / 365. */
  annualRate: number;
};

/**
 * What a line pays, over how many periods, at what rate — the inputs of the
 * present value and of the schedule, derived one way for both.
 *
 * - Calendar Month: the month rate snapshot per period, one period per whole
 *   month of the term. Billing prices a partial first / last calendar month
 *   pro rata, so a mid-month start bills the same total rent over one more
 *   (partial) period than the lease is valued over.
 * - 28 Days: the 28-day charge (best rate or the Fixed tier over 28 days)
 *   per period, one period per WHOLE 28 days of the term; a trailing partial
 *   period is not part of the level-payment stream.
 *
 * An open-ended agreement, or a term shorter than one period, is valued over
 * one period (spec §4: open-ended ⇒ one month ⇒ always Operating) — the
 * present value needs at least one payment.
 */
export function leasePaymentTerms(args: {
  cycle: RentalBillingCycle;
  rateMode: RentalRateMode;
  rateUnit: RateUnit | null;
  rates: RateLadder;
  /** `rentalAgreement.discountRate`, annual %. */
  discountRate: number;
  startDate: string;
  endDate: string | null;
}): LeasePaymentTerms {
  const { cycle, rates, startDate, endDate } = args;
  const termMonths = endDate === null
    ? null
    : wholeMonthsInTerm(startDate, endDate);

  if (cycle === "Calendar Month") {
    if (rates.monthRate === null) {
      throw new Error("A Calendar Month agreement needs a month rate");
    }
    return {
      termMonths,
      payment: rates.monthRate,
      periods: Math.max(1, termMonths ?? 1),
      annualRate: args.discountRate,
    };
  }

  const charge = args.rateMode === "Fixed"
    ? (() => {
      if (args.rateUnit === null) {
        throw new Error("A Fixed line needs the rate unit it bills");
      }
      return fixedRateCharge(DAYS_PER_28_DAY_PERIOD, args.rateUnit, rates);
    })()
    : bestRateCharge(DAYS_PER_28_DAY_PERIOD, rates);
  const wholePeriods = endDate === null ? 1 : round(
    daysBetweenInclusive(startDate, endDate) / DAYS_PER_28_DAY_PERIOD,
    0,
    RoundingMode.Down,
  );
  return {
    termMonths,
    payment: charge.amount,
    periods: Math.max(1, wholePeriods),
    annualRate: round(
      (args.discountRate * MONTHS_PER_YEAR * DAYS_PER_28_DAY_PERIOD) /
        DAYS_PER_YEAR,
    ),
  };
}

export type ClassificationInputs = {
  inputs: Parameters<typeof classifyLessorLease>[0];
  thresholds: { majorPartPercent: number; substantiallyAllPercent: number };
  tests: ReturnType<typeof classifyLessorLease>["tests"];
  pvToFairValuePercent: number | null;
  termToLifePercent: number | null;
  pv: {
    pvRent: number;
    pvPayments: number;
    pvResidual: number;
    netInvestment: number;
  };
  payment: number;
  periods: number;
  annualRate: number;
  timing: Timing;
};

/** The purchase option that counts as a lease payment: only one reasonably
 *  certain to be exercised (spec §4, test b). */
export function certainPurchaseOption(agreement: {
  purchaseOptionAmount: number | null;
  purchaseOptionReasonablyCertain: boolean;
}): number {
  return agreement.purchaseOptionReasonablyCertain
    ? agreement.purchaseOptionAmount ?? 0
    : 0;
}

/**
 * Present value and ASC 842 classification of one line, plus the record
 * stored in `rentalAgreementLine.classificationInputs` (the shape the
 * classification UI reads).
 *
 * `pv.netInvestment` is `pvPayments + pvResidual` of the two ROUNDED values,
 * so the commencement journal (Dr NI / Cr revenue PVpay / COGS C − PVres)
 * balances to the last internal digit; `presentValue`'s own netInvestment
 * rounds the unrounded sum and can differ by one unit of the fifth decimal.
 */
export function classifyRentalLine(args: {
  terms: LeasePaymentTerms;
  timing: Timing;
  agreement: {
    ownershipTransfers: boolean;
    specializedAsset: boolean;
    purchaseOptionAmount: number | null;
    purchaseOptionReasonablyCertain: boolean;
  };
  line: {
    fairValue: number | null;
    economicLifeMonths: number | null;
    guaranteedResidualValue: number;
    unguaranteedResidualValue: number;
  };
  thresholds: { majorPartPercent: number; substantiallyAllPercent: number };
}): { classification: LessorClassification; record: ClassificationInputs } {
  const { terms, timing, agreement, line, thresholds } = args;
  const pv = presentValue({
    payment: terms.payment,
    periods: terms.periods,
    annualRate: terms.annualRate,
    timing,
    purchaseOption: certainPurchaseOption(agreement),
    guaranteedResidual: line.guaranteedResidualValue,
    unguaranteedResidual: line.unguaranteedResidualValue,
  });
  const inputs = {
    ownershipTransfers: agreement.ownershipTransfers,
    purchaseOptionReasonablyCertain: agreement.purchaseOptionReasonablyCertain,
    termMonths: terms.termMonths,
    economicLifeMonths: line.economicLifeMonths,
    pvPayments: pv.pvPayments,
    fairValue: line.fairValue,
    specializedAsset: agreement.specializedAsset,
  };
  const result = classifyLessorLease(inputs, thresholds);
  return {
    classification: result.classification,
    record: {
      inputs,
      thresholds: {
        majorPartPercent: thresholds.majorPartPercent,
        substantiallyAllPercent: thresholds.substantiallyAllPercent,
      },
      tests: result.tests,
      pvToFairValuePercent: result.pvToFairValuePercent,
      termToLifePercent: result.termToLifePercent,
      pv: {
        pvRent: pv.pvRent,
        pvPayments: pv.pvPayments,
        pvResidual: pv.pvResidual,
        netInvestment: round(pv.pvPayments + pv.pvResidual),
      },
      payment: terms.payment,
      periods: terms.periods,
      annualRate: terms.annualRate,
      timing,
    },
  };
}

/**
 * Why a line cannot be booked as a sales-type lease, or null. Base currency
 * is enforced for every agreement before this.
 *
 * A sales-type lease runs WHOLE billing periods. The net investment is valued
 * as a level payment over `leasePaymentTerms().periods`, and every sales-type
 * Rent invoice credits Net Investment in Leases in full — so the rent billed
 * must be exactly payment × periods, or the account never closes on the
 * schedule. Billing prices a partial calendar month pro rata and cuts a
 * trailing partial 28-day period, neither of which the valuation contains:
 * a Calendar Month term starts on the first of a month and ends on a month
 * end; a 28 Days term is a whole number of 28-day periods.
 */
export function salesTypeRequirementError(args: {
  name: string;
  cycle: RentalBillingCycle;
  startDate: string;
  endDate: string | null;
  fairValue: number | null;
}): string | null {
  const { name, startDate, endDate } = args;
  if (endDate === null) {
    return `${name} is a sales-type lease, which needs an agreement end date`;
  }
  if (args.fairValue === null || !(args.fairValue > 0)) {
    return `${name} is a sales-type lease; enter the unit's fair value`;
  }
  if (args.cycle === "Calendar Month") {
    if (parseIsoDate(startDate).day !== 1 || monthEnd(endDate) !== endDate) {
      return `${name} is a sales-type lease, which runs whole billing periods: start on the first of a month and end on a month end`;
    }
    return null;
  }
  const days = daysBetweenInclusive(startDate, endDate);
  if (days % DAYS_PER_28_DAY_PERIOD !== 0) {
    return `${name} is a sales-type lease, which runs whole billing periods: the term must be a whole number of 28-day periods (it is ${days} days)`;
  }
  return null;
}

/** Whether a schedule line's interest is posted by a recognition run (an
 *  Interest row). Zero earns nothing, and neither does rounding drift: an
 *  Advance lease closing on zero ends its last line at −0.00001, one unit of
 *  internal precision below zero. A line that earns none still reduces the
 *  net investment by its rent invoice, so the net investment report counts
 *  its principal once its period date passes. The unit is `1 / 10 ** SCALE`,
 *  not `10 ** -SCALE`: a negative power is not correctly rounded in every V8
 *  (Deno 1.x gives 0.000009999999999999999), a division is. */
export function earnsInterest(interestAmount: number): boolean {
  const amount = round(interestAmount);
  return amount !== 0 && !(amount < 0 && -amount <= 1 / 10 ** SCALE);
}
