// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  addDays,
  classifyLesseeLease,
  isTermWithinTwelveMonths,
  type LesseeClassificationResult,
  leaseTermMonths,
  paymentMonthIndex,
  presentValueOfPayments,
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

/** A schedule month is on the books once the lease run posted it, or it is
 *  in an opening balance: both stamp `postedAt`. Its run rows are not read —
 *  they need accounting_view, and a purchasing-only viewer gets none. */
export function isScheduleLinePosted(line: LeaseScheduleLine): boolean {
  return Boolean(line.postedAt);
}

/** The lease months in order, each posted when every asset's line of that
 *  month is. */
function postedMonths(
  schedule: LeaseScheduleLine[]
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
  schedule: LeaseScheduleLine[]
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
  schedule: LeaseScheduleLine[]
): string | null {
  let end: string | null = null;
  for (const month of postedMonths(schedule)) {
    if (!month.posted) break;
    end = month.periodDate;
  }
  return end;
}

export type LeaseCarrying = {
  /** The asset's lease liability at the start of `startDate`. */
  liability: number;
  /** ROU amortization booked before `startDate`. */
  accumulated: number;
  /** ROU cost less the accumulated amortization. */
  rouAsset: number;
};

/** One asset's carrying amounts for a lifecycle action, the same way
 *  `post-lease` computes them: the last schedule line before `startDate`
 *  gives the liability, and every line before it adds its amortization. */
export function leaseCarryingAt(
  line: Pick<LeaseLine, "id" | "initialLiability" | "rouAssetCost">,
  schedule: LeaseScheduleLine[],
  startDate: string
): LeaseCarrying {
  const before = schedule.filter(
    (row) => row.leaseLineId === line.id && row.periodDate < startDate
  );
  const last = before[before.length - 1];
  const liability = last
    ? Number(last.closingLiability)
    : Number(line.initialLiability ?? 0);
  const accumulated = round(
    before.reduce((sum, row) => sum + Number(row.rouAmortization), 0)
  );
  return {
    liability,
    accumulated,
    rouAsset: round(Number(line.rouAssetCost ?? 0) - accumulated)
  };
}

/** What an asset's ending adds back to its carrying liability, as
 *  `post-lease` does: a Pending Purchase Option row due on or before
 *  `lastDay` was counted as paid by the schedule, and an ending removes it
 *  unpaid. */
export function endedPaymentsAddBack(
  payments: Pick<
    LeasePayment,
    "leaseLineId" | "paymentType" | "status" | "dueDate" | "amount"
  >[],
  leaseLineId: string,
  lastDay: string
): number {
  return round(
    payments
      .filter(
        (payment) =>
          payment.leaseLineId === leaseLineId &&
          payment.status === "Pending" &&
          payment.paymentType === "Purchase Option" &&
          payment.dueDate <= lastDay
      )
      .reduce((sum, payment) => sum + Number(payment.amount), 0)
  );
}

export type LesseeClassificationPreview = LesseeClassificationResult & {
  termMonths: number;
  pvPayments: number;
  /** The classification activation would use: an override wins. */
  applied: LesseeClassificationType;
  isOverridden: boolean;
};

type PaymentPoint = Pick<
  LeasePayment,
  | "leaseLineId"
  | "periodStart"
  | "periodEnd"
  | "dueDate"
  | "paymentType"
  | "amount"
>;

/** How activation would classify one asset, from its payment rows (the
 *  rows, not the terms, are what activation reads). Null when the dates or
 *  the rate cannot be read. */
export function previewLesseeClassification(args: {
  lease: Lease;
  line: LeaseLine;
  payments: PaymentPoint[];
  policy: LeasePolicy;
}): LesseeClassificationPreview | null {
  const { lease, line, policy } = args;
  if (!lease.commencementDate || !lease.endDate || !lease.paymentTiming) {
    return null;
  }
  try {
    const commencementDate = lease.commencementDate;
    const timing = lease.paymentTiming;
    const termMonths = leaseTermMonths(commencementDate, lease.endDate);
    const pvPayments = presentValueOfPayments({
      payments: args.payments
        .filter((payment) => payment.leaseLineId === line.id)
        .map((payment) => ({
          monthIndex: paymentMonthIndex(payment, commencementDate, timing),
          amount: Number(payment.amount)
        })),
      annualRate: Number(lease.discountRate ?? 0)
    });
    const result = classifyLesseeLease(
      {
        termMonths,
        withinTwelveMonths: isTermWithinTwelveMonths(
          commencementDate,
          lease.endDate
        ),
        pvPayments,
        fairValue: line.fairValue ?? null,
        economicLifeMonths: line.economicLifeMonths ?? null,
        ownershipTransfers: line.ownershipTransfers,
        purchaseOptionReasonablyCertain: line.purchaseOptionReasonablyCertain,
        specializedAsset: line.specializedAsset,
        shortTermExpedient: policy.shortTermExpedient
      },
      {
        majorPartPercent: policy.majorPartPercent,
        substantiallyAllPercent: policy.substantiallyAllPercent
      }
    );
    return {
      ...result,
      termMonths,
      pvPayments,
      applied: line.classificationOverride ?? result.classification,
      isOverridden: !!line.classificationOverride
    };
  } catch {
    return null;
  }
}

/** What stops a Draft from activating, as the `post-lease` activate refuses
 *  it (`activateBlocker`, `OPEN_ENDED_NEEDS_EXPEDIENT`): no asset, an asset
 *  with no payment row, a currency other than the company's base currency,
 *  or an open-ended lease while the short-term expedient is off. The Review
 *  step lists them and the setup footer disables Activate. */
export type LeaseActivationGap =
  | "noAssets"
  | "assetWithoutPayments"
  | "foreignCurrency"
  | "openEndedWithoutExpedient";

export function leaseActivationGaps(args: {
  lease: Pick<Lease, "currencyCode" | "endDate">;
  lines: Pick<LeaseLine, "id">[];
  payments: Pick<LeasePayment, "leaseLineId">[];
  baseCurrencyCode: string | null | undefined;
  policy: Pick<LeasePolicy, "shortTermExpedient">;
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
  return gaps;
}
