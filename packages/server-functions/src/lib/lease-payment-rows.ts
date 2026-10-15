// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The ONE way a lessee lease's payment rows are cut from its terms: the ERP's
// Draft setup (`regenerateLeasePayments`, `updateDraftLease`,
// `saveDraftLeaseLine`), the daily job rolling an open-ended lease forward
// (`rollOpenEndedLeasePayments`) and Modify all call it, so they agree on the escalation, the short last period, the
// purchase option and which rows were paid outside Carbon.

import type { Database } from "@carbon/database";
import {
  generateLeasePayments,
  type LeasePaymentRowInput,
  remainingLeasePayments,
  round
} from "@carbon/utils";

type Enums = Database["public"]["Enums"];

/** The lease terms a payment row is cut from. */
export type LeasePaymentCutTerms = {
  commencementDate: string;
  /** Null is open-ended: pass `through`. */
  endDate: string | null;
  /** A row due before it was paid outside Carbon: it is Skipped. */
  invoiceFromDate: string;
  paymentFrequency: Enums["leasePaymentFrequency"];
  paymentTiming: Enums["rentalBillingTiming"];
  annualEscalationPercent: number;
};

/** The leased asset (`leaseLine`) whose rows are cut. */
export type LeasePaymentCutAsset = {
  id: string;
  /** The payment at commencement. */
  paymentAmount: number;
  purchaseOptionAmount: number | null;
  purchaseOptionReasonablyCertain: boolean;
};

export type CutLeasePaymentRow = LeasePaymentRowInput & {
  leaseLineId: string;
  status: Extract<Enums["leasePaymentStatus"], "Pending" | "Skipped">;
};

/**
 * One asset's payment rows, cut from the COMMENCEMENT so the escalation steps
 * up on its anniversaries and a lease from the 29th–31st keeps its clamped
 * months (`generateLeasePayments`: a short last period prorated by days; the
 * purchase option on the end date, only when it is reasonably certain). A row
 * due before `invoiceFromDate` was paid outside Carbon and is `Skipped`; a row
 * of 0 is never cut.
 *
 * - `through` — an open-ended lease: the last date a period may start on
 *   (`openEndedLeaseHorizon`).
 * - `after` — only the periods that start after it (the rows an open-ended
 *   lease already has end there, edited or not).
 * - `from` — Modify: only the rows from lease month `month` on, where the
 *   asset pays `paymentAtStart` (`remainingLeasePayments`, the math the
 *   Modify preview shares): its commencement payment is derived from it,
 *   and a period that started before the month (the frequency changed) is
 *   cut down to its days from there.
 *
 * Returns the commencement payment the rows are cut at, which Modify stores
 * on the asset.
 */
export function cutLeasePaymentRows(args: {
  lease: LeasePaymentCutTerms;
  asset: LeasePaymentCutAsset;
  decimals: number;
  through?: string;
  after?: string | null;
  from?: { month: number; paymentAtStart: number };
}): { commencementPayment: number; rows: CutLeasePaymentRow[] } {
  const { lease, asset, decimals, from } = args;
  const purchaseOptionAmount = asset.purchaseOptionReasonablyCertain
    ? (asset.purchaseOptionAmount ?? 0)
    : 0;
  let cut: { commencementPayment: number; rows: LeasePaymentRowInput[] };
  if (from) {
    if (!lease.endDate) {
      throw new Error("Only a lease with an end date is cut from a month");
    }
    cut = remainingLeasePayments({
      commencementDate: lease.commencementDate,
      fromMonth: from.month,
      endDate: lease.endDate,
      paymentAtStart: from.paymentAtStart,
      frequency: lease.paymentFrequency,
      timing: lease.paymentTiming,
      annualEscalationPercent: lease.annualEscalationPercent,
      purchaseOptionAmount,
      decimals
    });
  } else {
    cut = {
      commencementPayment: asset.paymentAmount,
      rows: generateLeasePayments({
        commencementDate: lease.commencementDate,
        endDate: lease.endDate,
        through: args.through,
        paymentAmount: asset.paymentAmount,
        frequency: lease.paymentFrequency,
        timing: lease.paymentTiming,
        annualEscalationPercent: lease.annualEscalationPercent,
        purchaseOptionAmount,
        decimals
      })
    };
  }

  const rows = cut.rows
    .filter(
      (row) => row.amount > 0 && (!args.after || row.periodStart > args.after)
    )
    .map(
      (row): CutLeasePaymentRow => ({
        ...row,
        leaseLineId: asset.id,
        status: row.dueDate < lease.invoiceFromDate ? "Skipped" : "Pending"
      })
    );

  return { commencementPayment: round(cut.commencementPayment), rows };
}
