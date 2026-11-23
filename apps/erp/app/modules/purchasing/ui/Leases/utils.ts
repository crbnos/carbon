// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  addDays,
  endedPaymentsAddBack,
  equals,
  escalatedLeasePayment,
  getErrorMessage,
  isPaidBeforeOpening,
  isTermWithinTwelveMonths,
  type LeasePaymentFrequency,
  type LesseeCarrying,
  type LesseeClassificationResult,
  type LesseeLeg,
  leaseMonthsAt,
  lesseeCarryingAt,
  lesseePurchaseLegs,
  lesseeScheduleSpan,
  lesseeTerminationLegs,
  measureLesseeAsset,
  normalizeLesseeLegs,
  paymentMonthIndex,
  remainingLeasePayments,
  remeasureLease,
  round
} from "@carbon/utils";
import type {
  Lease,
  LeaseLine,
  LeasePayment,
  LeasePolicy,
  LeaseScheduleLine,
  LesseeClassificationType
} from "./types";

// The lease screens' decisions, each mirroring what `post-lease` does or
// refuses. The arithmetic itself is the shared lifecycle math in
// `@carbon/utils` (`lease-math.ts`), which the server function posts from, so
// a preview and the journal it previews cannot disagree. Pinned by
// `utils.test.ts`.

type ScheduleRow = Pick<
  LeaseScheduleLine,
  "leaseLineId" | "periodDate" | "closingLiability" | "rouAmortization"
> & { postedAt: string | null };

type PaymentRow = Pick<
  LeasePayment,
  | "leaseLineId"
  | "paymentType"
  | "status"
  | "periodStart"
  | "periodEnd"
  | "dueDate"
  | "amount"
>;

/** A schedule month is on the books once the lease run posted it, or it is
 *  in an opening balance: both stamp `postedAt`. Its run rows are not read —
 *  they need accounting_view, and a purchasing-only viewer gets none. */
export function isScheduleLinePosted(line: { postedAt: string | null }) {
  return Boolean(line.postedAt);
}

/** The lease months in order, each posted when every asset's line of that
 *  month is. */
function postedMonths(
  schedule: Pick<ScheduleRow, "periodDate" | "postedAt">[]
): { periodDate: string; posted: boolean }[] {
  const byDate = new Map<string, boolean>();
  for (const line of schedule) {
    byDate.set(
      line.periodDate,
      (byDate.get(line.periodDate) ?? true) && isScheduleLinePosted(line)
    );
  }
  return [...byDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([periodDate, posted]) => ({ periodDate, posted }));
}

/** The first day of the first lease month not yet on the books: where a
 *  Modify can take effect. The commencement date when nothing has posted.
 *  Pass the schedule of the assets the change acts on. */
export function firstOpenLeaseMonth(
  lease: Pick<Lease, "commencementDate">,
  schedule: Pick<ScheduleRow, "periodDate" | "postedAt">[]
): string | null {
  if (!lease.commencementDate) return null;
  let start = lease.commencementDate;
  for (const month of postedMonths(schedule)) {
    if (!month.posted) break;
    start = addDays(month.periodDate, 1);
  }
  return start;
}

/** The last day of the last lease month on the books: where a Terminate or
 *  a Purchase can take effect. Null when no month has posted. */
export function lastPostedLeaseMonthEnd(
  schedule: Pick<ScheduleRow, "periodDate" | "postedAt">[]
): string | null {
  let end: string | null = null;
  for (const month of postedMonths(schedule)) {
    if (!month.posted) break;
    end = month.periodDate;
  }
  return end;
}

type CarryingLine = Pick<LeaseLine, "id" | "initialLiability" | "rouAssetCost">;

/** One asset's carrying amounts for a lifecycle action whose last day under
 *  the old terms is `lastDay`, as `post-lease` computes them: the liability
 *  and amortization its schedule reaches by then, plus a Pending purchase
 *  option due by then, which the ending removes unpaid. */
export function leaseCarryingThrough(
  line: CarryingLine,
  payments: PaymentRow[],
  schedule: ScheduleRow[],
  lastDay: string
): LesseeCarrying {
  const carrying = lesseeCarryingAt({
    schedule: schedule.filter((row) => row.leaseLineId === line.id),
    startDate: addDays(lastDay, 1),
    initialLiability: line.initialLiability,
    rouAssetCost: line.rouAssetCost
  });
  return {
    ...carrying,
    liability: round(
      carrying.liability +
        endedPaymentsAddBack(
          payments.filter((payment) => payment.leaseLineId === line.id),
          lastDay
        )
    )
  };
}

type BalanceLine = CarryingLine &
  Pick<LeaseLine, "status" | "lesseeClassification">;

export type LeaseAssetBalances = {
  /** The lease liability after the last posted month. */
  liability: number;
  /** The ROU asset less the amortization posted so far. */
  netRouAsset: number;
  /** The last day of the last posted month; null at commencement. */
  postedThrough: string | null;
};

/** One asset's balances after its last posted month: null once it has
 *  ended, and for a short-term asset, which is never on the balance sheet.
 *  The `leases` view's `currentLiability` sums the same liability. */
export function leaseAssetBalances(
  line: BalanceLine,
  schedule: ScheduleRow[]
): LeaseAssetBalances | null {
  if (
    line.status !== "Active" ||
    !line.lesseeClassification ||
    line.lesseeClassification === "Short-Term"
  ) {
    return null;
  }
  const posted: ScheduleRow[] = [];
  for (const row of schedule) {
    if (row.leaseLineId !== line.id) continue;
    if (!isScheduleLinePosted(row)) break;
    posted.push(row);
  }
  const last = posted.at(-1);
  return {
    liability: last
      ? Number(last.closingLiability)
      : Number(line.initialLiability ?? 0),
    netRouAsset: round(
      Number(line.rouAssetCost ?? 0) -
        posted.reduce((sum, row) => sum + Number(row.rouAmortization), 0)
    ),
    postedThrough: last?.periodDate ?? null
  };
}

/** The asset's lease liability after its last posted month (see
 *  `leaseAssetBalances`). */
export function leaseAssetLiability(
  line: BalanceLine,
  schedule: ScheduleRow[]
): number | null {
  return leaseAssetBalances(line, schedule)?.liability ?? null;
}

export type LesseeClassificationPreview = LesseeClassificationResult & {
  termMonths: number;
  pvPayments: number;
  /** The classification activation would use: an override wins. */
  applied: LesseeClassificationType;
  isOverridden: boolean;
};

type PreviewLease = Pick<
  Lease,
  "commencementDate" | "endDate" | "paymentTiming" | "discountRate"
>;

type PreviewLine = Pick<
  LeaseLine,
  | "id"
  | "fairValue"
  | "economicLifeMonths"
  | "ownershipTransfers"
  | "purchaseOptionReasonablyCertain"
  | "specializedAsset"
  | "classificationOverride"
>;

/** How activation would classify one asset, from its payment rows (the
 *  rows, not the terms, are what activation reads): the preview, or the
 *  reason it cannot be worked out. Null while the dates or the timing are
 *  missing. */
export function previewLesseeClassification(args: {
  lease: PreviewLease;
  line: PreviewLine;
  payments: PaymentRow[];
  policy: LeasePolicy;
}):
  | { preview: LesseeClassificationPreview; error?: undefined }
  | { preview?: undefined; error: string }
  | null {
  const { lease, line, policy } = args;
  if (!lease.commencementDate || !lease.endDate || !lease.paymentTiming) {
    return null;
  }
  try {
    const { liability, termMonths, ...result } = measureLesseeAsset({
      commencementDate: lease.commencementDate,
      endDate: lease.endDate,
      timing: lease.paymentTiming,
      discountRate: Number(lease.discountRate ?? 0),
      payments: args.payments.filter(
        (payment) => payment.leaseLineId === line.id
      ),
      inputs: {
        fairValue: line.fairValue ?? null,
        economicLifeMonths: line.economicLifeMonths ?? null,
        ownershipTransfers: line.ownershipTransfers,
        purchaseOptionReasonablyCertain: line.purchaseOptionReasonablyCertain,
        specializedAsset: line.specializedAsset
      },
      shortTermExpedient: policy.shortTermExpedient,
      thresholds: {
        majorPartPercent: policy.majorPartPercent,
        substantiallyAllPercent: policy.substantiallyAllPercent
      }
    });
    return {
      preview: {
        ...result,
        termMonths,
        pvPayments: liability,
        applied: line.classificationOverride ?? result.classification,
        isOverridden: !!line.classificationOverride
      }
    };
  } catch (error) {
    return {
      error: getErrorMessage(error, "The treatment cannot be worked out")
    };
  }
}

/** Each asset's classification preview, in the lease's order, and the
 *  assets whose treatment cannot be worked out with the reason. An asset
 *  waiting for the dates is in neither. */
export function assetClassificationPreviews<
  Line extends PreviewLine & Pick<LeaseLine, "description">
>(
  lease: PreviewLease,
  lines: Line[],
  payments: PaymentRow[],
  policy: LeasePolicy
): {
  assets: { line: Line; preview: LesseeClassificationPreview }[];
  errors: { line: Line; message: string }[];
} {
  const assets: { line: Line; preview: LesseeClassificationPreview }[] = [];
  const errors: { line: Line; message: string }[] = [];
  for (const line of lines) {
    const result = previewLesseeClassification({
      lease,
      line,
      payments,
      policy
    });
    if (result?.preview) assets.push({ line, preview: result.preview });
    else if (result?.error) errors.push({ line, message: result.error });
  }
  return { assets, errors };
}

type GapLine = PreviewLine & Pick<LeaseLine, "description">;

/** The date an opening balance would be struck on, or null when the lease
 *  commenced on or after the accounting cutover (it posts a commencement
 *  journal instead). */
function openingAsOf(
  lease: Pick<Lease, "commencementDate">,
  policy: Pick<LeasePolicy, "accountingCutoverDate" | "openingAsOf">
): string | null {
  const cutover = policy.accountingCutoverDate;
  if (!cutover || !lease.commencementDate) return null;
  if (lease.commencementDate >= cutover) return null;
  return policy.openingAsOf ?? cutover;
}

export type SkippedPaymentBlocker = {
  leaseLineId: string;
  description: string;
  dueDate: string;
};

/** The Skipped payments of a capitalized asset that `post-lease` refuses to
 *  activate (`skippedPaymentBlocker`): Skipped means paid outside Carbon, so
 *  no invoice will ever relieve it from the lease liability, and it must be
 *  one an opening balance holds. A payment due before the commencement is
 *  not in the schedule's months and is left alone. */
export function skippedPaymentBlockers(args: {
  lease: PreviewLease;
  lines: GapLine[];
  payments: PaymentRow[];
  policy: LeasePolicy;
}): SkippedPaymentBlocker[] {
  const { lease, policy } = args;
  const { commencementDate, endDate, paymentTiming } = lease;
  if (!commencementDate || !endDate || !paymentTiming) return [];
  let periodDates: string[];
  try {
    periodDates = lesseeScheduleSpan(commencementDate, endDate).periodDates;
  } catch {
    // Dates that cannot be read show as a classification error instead.
    return [];
  }
  const asOf = openingAsOf(lease, policy);
  return args.lines.flatMap((line) => {
    const preview = previewLesseeClassification({
      lease,
      line,
      payments: args.payments,
      policy
    })?.preview;
    if (!preview || preview.applied === "Short-Term") return [];
    return args.payments
      .filter(
        (payment) =>
          payment.leaseLineId === line.id &&
          payment.status === "Skipped" &&
          payment.dueDate >= commencementDate &&
          !(
            asOf &&
            isPaidBeforeOpening(payment, {
              commencementDate,
              timing: paymentTiming,
              periodDates,
              asOf
            })
          )
      )
      .map((payment) => ({
        leaseLineId: line.id,
        description: line.description,
        dueDate: payment.dueDate
      }));
  });
}

/** What stops a Draft from activating, as the `post-lease` activate refuses
 *  it (`activateBlocker`, `OPEN_ENDED_NEEDS_EXPEDIENT`,
 *  `skippedPaymentBlocker`): no asset, an asset with no payment row, a
 *  currency other than the company's base currency, an open-ended lease
 *  while the short-term expedient is off, or a Skipped payment nothing
 *  relieves (`skippedPaymentBlockers` names them). The Review step lists them
 *  and the setup footer disables Activate. */
export type LeaseActivationGap =
  | "noAssets"
  | "assetWithoutPayments"
  | "foreignCurrency"
  | "openEndedWithoutExpedient"
  | "skippedPayment";

export function leaseActivationGaps(args: {
  lease: PreviewLease & Pick<Lease, "currencyCode">;
  lines: GapLine[];
  payments: PaymentRow[];
  baseCurrencyCode: string | null | undefined;
  policy: LeasePolicy;
}): LeaseActivationGap[] {
  const gaps: LeaseActivationGap[] = [];
  if (!args.lease.endDate && !args.policy.shortTermExpedient) {
    gaps.push("openEndedWithoutExpedient");
  }
  if (args.lines.length === 0) gaps.push("noAssets");
  if (
    args.lines.some(
      (line) =>
        !args.payments.some((payment) => payment.leaseLineId === line.id)
    )
  ) {
    gaps.push("assetWithoutPayments");
  }
  if (
    args.baseCurrencyCode &&
    args.lease.currencyCode &&
    args.lease.currencyCode !== args.baseCurrencyCode
  ) {
    gaps.push("foreignCurrency");
  }
  if (skippedPaymentBlockers(args).length > 0) gaps.push("skippedPayment");
  return gaps;
}

/** Whether `post-lease` would cancel the lease: an Active lease whose
 *  assets are all Active, with no Modify, Terminate or Purchase (no event),
 *  no invoiced payment and no month a lease run posted. A run holding its
 *  rows also refuses it, but run rows need accounting_view; the server says
 *  so. The run stamps the schedule line's journal (an opening balance does
 *  not). */
export function canCancelLease(args: {
  lease: Pick<Lease, "status">;
  lines: Pick<LeaseLine, "status">[];
  payments: Pick<LeasePayment, "status">[];
  schedule: Pick<LeaseScheduleLine, "journalId">[];
  events: unknown[];
}): boolean {
  return (
    args.lease.status === "Active" &&
    args.lines.every((line) => line.status === "Active") &&
    args.events.length === 0 &&
    !args.payments.some((payment) => payment.status === "Invoiced") &&
    !args.schedule.some((line) => Boolean(line.journalId))
  );
}

/** How an asset can be bought: at its purchase option's price, or — when
 *  ownership transfers and there is no option — taken on the end date for
 *  nothing. Null for a short-term asset (no right-of-use asset to move) and
 *  an open-ended lease. */
export type LeasePurchaseOffer =
  | { kind: "option"; price: number }
  | { kind: "ownership"; exerciseDate: string };

export function leasePurchaseOffer(
  lease: Pick<Lease, "endDate">,
  line: Pick<
    LeaseLine,
    "purchaseOptionAmount" | "ownershipTransfers" | "lesseeClassification"
  >
): LeasePurchaseOffer | null {
  if (!lease.endDate || line.lesseeClassification === "Short-Term") {
    return null;
  }
  const price = Number(line.purchaseOptionAmount ?? 0);
  if (price > 0) return { kind: "option", price };
  if (line.ownershipTransfers) {
    return { kind: "ownership", exerciseDate: lease.endDate };
  }
  return null;
}

/** The amount of the asset's purchase option row already invoiced on or
 *  before `exerciseDate`, or null. Its invoice settles the price. */
export function invoicedPurchaseOption(
  payments: PaymentRow[],
  leaseLineId: string,
  exerciseDate: string
): number | null {
  const row = payments.find(
    (payment) =>
      payment.leaseLineId === leaseLineId &&
      payment.paymentType === "Purchase Option" &&
      payment.status === "Invoiced" &&
      payment.dueDate <= exerciseDate
  );
  return row ? Number(row.amount) : null;
}

/** The Purchase journal and the asset's cost, as `post-lease` posts them:
 *  an invoiced option row is the price, so nothing more is payable. */
export function leasePurchasePreview(args: {
  line: CarryingLine;
  payments: PaymentRow[];
  schedule: ScheduleRow[];
  exerciseDate: string;
  price: number;
}): { legs: LesseeLeg[]; assetCost: number; invoicedOption: number | null } {
  const { line } = args;
  const invoicedOption = invoicedPurchaseOption(
    args.payments,
    line.id,
    args.exerciseDate
  );
  const carrying = leaseCarryingThrough(
    line,
    args.payments,
    args.schedule,
    args.exerciseDate
  );
  return {
    ...lesseePurchaseLegs({
      carryingLiability: carrying.liability,
      price: invoicedOption === null ? args.price : 0,
      rouAssetCost: Number(line.rouAssetCost ?? 0),
      accumulated: carrying.accumulated
    }),
    invoicedOption
  };
}

export type LeasePurchaseRefusal =
  | "ownershipDate"
  | "ownershipPrice"
  | "invoicedPrice"
  | "negativeCost";

/** Why `post-lease` would refuse this purchase, or null: an asset taken
 *  because ownership transfers is taken on the end date at 0; an option
 *  already invoiced is exercised at its invoiced price; and the asset's
 *  cost cannot be negative. */
export function leasePurchaseRefusal(args: {
  offer: LeasePurchaseOffer;
  exerciseDate: string;
  price: number;
  invoicedOption: number | null;
  assetCost: number | null;
}): LeasePurchaseRefusal | null {
  if (args.offer.kind === "ownership") {
    if (args.exerciseDate !== args.offer.exerciseDate) return "ownershipDate";
    if (!equals(args.price, 0)) return "ownershipPrice";
  }
  if (
    args.invoicedOption !== null &&
    round(args.invoicedOption) !== round(args.price)
  ) {
    return "invoicedPrice";
  }
  if (args.assetCost !== null && args.assetCost < 0) return "negativeCost";
  return null;
}

/** The Terminate journal and its gain or loss, as `post-lease` posts them. */
export function leaseTerminationPreview(args: {
  line: CarryingLine;
  payments: PaymentRow[];
  schedule: ScheduleRow[];
  terminationDate: string;
  penalty: number;
}): { legs: LesseeLeg[]; gainLoss: number } {
  const carrying = leaseCarryingThrough(
    args.line,
    args.payments,
    args.schedule,
    args.terminationDate
  );
  return lesseeTerminationLegs({
    carryingLiability: carrying.liability,
    penalty: args.penalty,
    rouAssetCost: Number(args.line.rouAssetCost ?? 0),
    accumulated: carrying.accumulated
  });
}

/** The payment an asset pays at a Modify's effective date — its commencement
 *  payment escalated on each anniversary at the lease's current escalation —
 *  which is what Modify takes as the payment from then on. Rounded to the
 *  currency, as the field shows it. */
export function leaseModifyPaymentAt(
  lease: Pick<Lease, "commencementDate" | "annualEscalationPercent">,
  line: Pick<LeaseLine, "paymentAmount">,
  effectiveDate: string,
  decimals: number
): number {
  const payment = Number(line.paymentAmount);
  if (!lease.commencementDate) return payment;
  return round(
    escalatedLeasePayment(
      payment,
      Number(lease.annualEscalationPercent ?? 0),
      leaseMonthsAt(lease.commencementDate, effectiveDate)
    ),
    decimals
  );
}

export type LeaseModifyTerms = {
  effectiveDate: string;
  endDate: string;
  /** Annual %. */
  discountRate: number;
  paymentFrequency: LeasePaymentFrequency;
  annualEscalationPercent: number;
};

type ModifyLine = BalanceLine &
  Pick<
    LeaseLine,
    "description" | "purchaseOptionAmount" | "purchaseOptionReasonablyCertain"
  >;

/** Each capitalized asset's remeasurement, as `post-lease` makes it: the
 *  remaining rows cut from the COMMENCEMENT at the payment entered for the
 *  effective date (so the escalation keeps the commencement's
 *  anniversaries), discounted at the revised rate against the carrying
 *  amounts the day before. A short-term asset only has its rows cut again.
 *  Null when the terms cannot be read. */
export function leaseModifyPreview<Line extends ModifyLine>(args: {
  lease: Pick<Lease, "commencementDate" | "paymentTiming">;
  lines: Line[];
  payments: PaymentRow[];
  schedule: ScheduleRow[];
  terms: LeaseModifyTerms;
  paymentOf: (line: Line) => number;
  decimals: number;
}): { line: Line; result: ReturnType<typeof remeasureLease> }[] | null {
  const { lease, terms } = args;
  const commencementDate = lease.commencementDate;
  const timing = lease.paymentTiming;
  if (!commencementDate || !timing || !terms.effectiveDate || !terms.endDate) {
    return null;
  }
  try {
    const fromMonth = leaseMonthsAt(commencementDate, terms.effectiveDate);
    return args.lines
      .filter((line) => line.lesseeClassification !== "Short-Term")
      .map((line) => {
        const carrying = leaseCarryingThrough(
          line,
          args.payments,
          args.schedule,
          addDays(terms.effectiveDate, -1)
        );
        const { rows } = remainingLeasePayments({
          commencementDate,
          fromMonth,
          endDate: terms.endDate,
          paymentAtStart: args.paymentOf(line),
          frequency: terms.paymentFrequency,
          timing,
          annualEscalationPercent: terms.annualEscalationPercent,
          purchaseOptionAmount: line.purchaseOptionReasonablyCertain
            ? Number(line.purchaseOptionAmount ?? 0)
            : 0,
          decimals: args.decimals
        });
        return {
          line,
          result: remeasureLease({
            carryingLiability: carrying.liability,
            carryingRouAsset: carrying.rouAsset,
            remainingPayments: rows.map((row) => ({
              monthIndex:
                paymentMonthIndex(row, commencementDate, timing) - fromMonth,
              amount: row.amount
            })),
            annualRate: terms.discountRate
          })
        };
      });
  } catch {
    // A date or rate the form has not settled yet; the server checks it.
    return null;
  }
}

/** Whether a Modify would take a short-term asset past 12 months, which
 *  `post-lease` refuses: a short-term lease stays short-term. */
export function shortTermPastTwelveMonths(
  lease: Pick<Lease, "commencementDate">,
  lines: Pick<LeaseLine, "status" | "lesseeClassification">[],
  endDate: string
): boolean {
  if (!lease.commencementDate || !endDate) return false;
  return (
    lines.some(
      (line) =>
        line.status === "Active" && line.lesseeClassification === "Short-Term"
    ) && !isTermWithinTwelveMonths(lease.commencementDate, endDate)
  );
}

export type LeaseJournalPreviewRow = {
  account: string;
  debit: number;
  credit: number;
};

/** The legs a lifecycle action posts, as the rows of its preview table:
 *  each on the side it posts to, zero legs left out. */
export function leaseJournalRows(
  legs: LesseeLeg[],
  label: (leg: LesseeLeg) => string
): LeaseJournalPreviewRow[] {
  return normalizeLesseeLegs(legs).map((leg) => ({
    account: label(leg),
    debit: leg.side === "debit" ? leg.amount : 0,
    credit: leg.side === "credit" ? leg.amount : 0
  }));
}
