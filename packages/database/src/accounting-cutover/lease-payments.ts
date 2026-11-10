// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  type LeasePaymentType,
  type LeaseTiming,
  leaseMonthsAt,
  paymentMonthIndex,
  scheduleMonthOfPayment
} from "../lease-months";
import { round } from "../precision";

// A lease's balance at the cutover, read from its schedule, has to match what
// the journals will do after it. A schedule line takes each payment off the
// balance in the month it falls due; the journals take it off when its invoice
// posts (a purchase invoice debits Lease Liabilities, a sales invoice credits
// Net Investment in Leases). The two disagree on a payment whose month is on
// one side of the cutover and whose invoice is on the other:
//
// - paid by a schedule line before the cutover, invoiced after it (or not yet):
//   the invoice will take it off again, so the opening balance adds it back;
// - invoiced before the cutover, paid by a schedule line after it: nothing
//   will take it off again, so the opening balance takes it off now.

/** One payment: whether a schedule line before the cutover has paid it, and
 *  whether its invoice was posted before the cutover. */
export type CutoverPayment = {
  amount: number;
  paidBySchedule: boolean;
  settledBeforeCutover: boolean;
};

/** What the opening balance moves by, in the payments' units: + adds to the
 *  balance the schedule left, − takes off it. */
export function cutoverPaymentAdjustment(payments: CutoverPayment[]): number {
  let adjustment = 0;
  for (const payment of payments) {
    if (payment.paidBySchedule && !payment.settledBeforeCutover) {
      adjustment += payment.amount;
    } else if (!payment.paidBySchedule && payment.settledBeforeCutover) {
      adjustment -= payment.amount;
    }
  }
  return round(adjustment);
}

/** Whether a lessee schedule has paid a payment row by its line dated
 *  `paidThrough` (the asset's last schedule line before the cutover; null when
 *  it has none). The last line of the asset's schedule has paid every row.
 *  Otherwise a row is paid in the schedule month `buildLesseeSchedule` puts it
 *  in (`scheduleMonthOfPayment`): advance rent at the start of its month,
 *  arrears rent and the other payments at the end of the month before. */
export function lesseeScheduleHasPaid(args: {
  payment: {
    periodStart: string;
    periodEnd: string;
    dueDate: string;
    paymentType: LeasePaymentType;
  };
  commencementDate: string;
  timing: LeaseTiming;
  paidThrough: { periodDate: string; isLastLine: boolean } | null;
}): boolean {
  const { paidThrough } = args;
  if (!paidThrough) return false;
  if (paidThrough.isLastLine) return true;
  const { month } = scheduleMonthOfPayment(
    paymentMonthIndex(args.payment, args.commencementDate, args.timing),
    args.timing
  );
  return month <= leaseMonthsAt(args.commencementDate, paidThrough.periodDate);
}

/** The sales and purchase invoice statuses that have posted. */
const UNPOSTED_INVOICE_STATUSES = new Set(["Draft", "Pending", "Voided"]);

/** Whether an invoice was posted before the cutover. */
export function invoicePostedBefore(
  invoice: { status: string; postingDate: string | null } | null | undefined,
  cutoverDate: string
): boolean {
  return (
    !!invoice &&
    !UNPOSTED_INVOICE_STATUSES.has(invoice.status) &&
    invoice.postingDate !== null &&
    invoice.postingDate < cutoverDate
  );
}
