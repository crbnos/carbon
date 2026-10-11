// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  addDays,
  classifyLesseeLease,
  type LesseeClassificationResult,
  paymentMonthIndex,
  presentValueOfPayments,
  round,
  wholeMonthsInTerm
} from "@carbon/utils";
import type {
  Lease,
  LeasePayment,
  LeasePolicy,
  LeaseScheduleLine,
  LesseeClassificationType
} from "./types";

/** A schedule month is on the books when every one of its lease run rows has
 *  posted (plan decision P6). A month with no rows needs no posting. */
export function isScheduleLinePosted(line: LeaseScheduleLine): boolean {
  return (line.rows ?? []).every((row) => row.status === "Posted");
}

/** The first day of the first lease month not yet on the books: where a
 *  Modify can take effect. The commencement date when nothing has posted. */
export function firstOpenLeaseMonth(
  lease: Pick<Lease, "commencementDate">,
  schedule: LeaseScheduleLine[]
): string | null {
  if (!lease.commencementDate) return null;
  let start = lease.commencementDate;
  for (const line of schedule) {
    if (!isScheduleLinePosted(line)) break;
    start = addDays(line.periodDate, 1);
  }
  return start;
}

/** The last day of the last lease month on the books: where a Terminate or
 *  a Purchase can take effect. Null when no month has posted. */
export function lastPostedLeaseMonthEnd(
  schedule: LeaseScheduleLine[]
): string | null {
  let end: string | null = null;
  for (const line of schedule) {
    if (!isScheduleLinePosted(line)) break;
    end = line.periodDate;
  }
  return end;
}

export type LeaseCarrying = {
  /** The lease liability at the start of `startDate`. */
  liability: number;
  /** ROU amortization booked before `startDate`. */
  accumulated: number;
  /** ROU cost less the accumulated amortization. */
  rouAsset: number;
};

/** The carrying amounts a lifecycle action works from, the same way
 *  `post-lease` computes them: the last schedule line before `startDate`
 *  gives the liability, and every line before it adds its amortization. */
export function leaseCarryingAt(
  lease: Pick<Lease, "initialLiability" | "rouAssetCost">,
  schedule: LeaseScheduleLine[],
  startDate: string
): LeaseCarrying {
  const before = schedule.filter((line) => line.periodDate < startDate);
  const last = before[before.length - 1];
  const liability = last
    ? Number(last.closingLiability)
    : Number(lease.initialLiability ?? 0);
  const accumulated = round(
    before.reduce((sum, line) => sum + Number(line.rouAmortization), 0)
  );
  return {
    liability,
    accumulated,
    rouAsset: round(Number(lease.rouAssetCost ?? 0) - accumulated)
  };
}

export type LesseeClassificationPreview = LesseeClassificationResult & {
  termMonths: number;
  pvPayments: number;
  /** The classification activation would use: an override wins. */
  applied: LesseeClassificationType;
  isOverridden: boolean;
};

/** How activation would classify the lease, from its payment rows (the
 *  rows, not the terms, are what activation reads). Null when the dates or
 *  the rate cannot be read. */
export function previewLesseeClassification(args: {
  lease: Lease;
  payments: Pick<
    LeasePayment,
    "periodStart" | "periodEnd" | "dueDate" | "paymentType" | "amount"
  >[];
  policy: LeasePolicy;
}): LesseeClassificationPreview | null {
  const { lease, payments, policy } = args;
  if (!lease.commencementDate || !lease.endDate || !lease.paymentTiming) {
    return null;
  }
  try {
    const commencementDate = lease.commencementDate;
    const timing = lease.paymentTiming;
    const termMonths = wholeMonthsInTerm(commencementDate, lease.endDate);
    const pvPayments = presentValueOfPayments({
      payments: payments.map((payment) => ({
        monthIndex: paymentMonthIndex(payment, commencementDate, timing),
        amount: Number(payment.amount)
      })),
      annualRate: Number(lease.discountRate ?? 0)
    });
    const result = classifyLesseeLease(
      {
        termMonths,
        pvPayments,
        fairValue: lease.fairValue ?? null,
        economicLifeMonths: lease.economicLifeMonths ?? null,
        ownershipTransfers: lease.ownershipTransfers ?? false,
        purchaseOptionReasonablyCertain:
          lease.purchaseOptionReasonablyCertain ?? false,
        specializedAsset: lease.specializedAsset ?? false,
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
      applied: lease.classificationOverride ?? result.classification,
      isOverridden: !!lease.classificationOverride
    };
  } catch {
    return null;
  }
}
