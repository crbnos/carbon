// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The journal of a legacy payment: the lines `post-payment` writes today,
// from the stored payment and its settlements, with today's account defaults
// (.ai/specs/implemented/2026-10-08-accounting-cutover.md section 5a).
//
// Built by `rebuildPaymentJournals` (post-payment/rebuild-journal.ts), the
// builder the void of a payment dated before the cutover uses, with the
// status of a posting before the cutover. A target books to the control
// account of its line in a Provisional journal (the invoices, memos and
// reimbursements the enable has just journaled), else to the default
// control account, as the posting does. The processor fee is not stored on
// the payment: `readPaymentProcessorFees` reads it from the payment's
// integration mapping, by the rules `recordStripeConnectPayment` used when
// it passed the fee to the posting.
//
// Payments are written in posting order, a chunk at a time: a payment
// funded by an earlier payment's on-account credit books that credit to the
// control account of the earlier payment's journal.

import type { Database } from "@carbon/database";
import type { KyselyTx } from "@carbon/database/client";
import { legacyPayments } from "@carbon/database/legacy-documents";
import { readPaymentProcessorFees } from "@carbon/database/payment-processor-fee";
import { chunkArray } from "@carbon/utils";
import { rebuildPaymentJournals } from "../../post-payment/rebuild-journal";
import {
  attachJournalIds,
  insertProvisionalJournals,
  type LegacyJournal,
  ROWS_PER_STATEMENT
} from "./write";

type AccountDefaults = Database["public"]["Tables"]["accountDefault"]["Row"];

export async function journalLegacyPayments(
  trx: KyselyTx,
  {
    companyId,
    companyGroupId,
    userId,
    cutoverDate
  }: {
    companyId: string;
    companyGroupId: string;
    userId: string;
    cutoverDate: string;
    /** Not read: the processor fee reads its own account defaults. */
    defaults?: AccountDefaults;
  }
): Promise<number> {
  const payments = await legacyPayments(trx, {
    companyId,
    cutoverDate
  }).execute();
  if (payments.length === 0) return 0;
  const { fees: feeByPaymentId } = await readPaymentProcessorFees(
    trx,
    companyId,
    payments
  );

  let written = 0;
  for (const batch of chunkArray(payments, ROWS_PER_STATEMENT)) {
    const rebuilt = await rebuildPaymentJournals(trx, batch, companyId, {
      postingStatus: "Provisional",
      feeByPaymentId
    });
    const journals: LegacyJournal[] = batch.map((payment, index) => {
      const { lines, dimensions } = rebuilt[index]!;
      return {
        description: `Payment ${payment.paymentId}`,
        postingDate: String(payment.postingDate),
        sourceType: "Payment" as const,
        lines: lines.map(
          ({ companyId: _, documentLineReference, ...line }) => ({
            ...line,
            documentLineReference: documentLineReference ?? null,
            dimensions: {},
            dimensionValues: dimensions
          })
        )
      };
    });
    const journalIds = await insertProvisionalJournals(trx, {
      companyId,
      companyGroupId,
      userId,
      journals
    });
    await attachJournalIds(trx, {
      table: "payment",
      companyId,
      userId,
      rows: batch.map((payment, index) => ({
        id: payment.id,
        journalId: journalIds[index] ?? null
      }))
    });
    written += journalIds.filter(Boolean).length;
  }
  return written;
}
