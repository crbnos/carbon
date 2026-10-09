// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The journal of a legacy payment: the lines `post-payment` writes today,
// from the stored payment and its settlements, with today's account defaults
// (.ai/specs/2026-10-08-accounting-cutover.md section 5a).
//
// Built by `rebuildPaymentJournals` (post-payment/post-payment-transaction.ts),
// the builder the void of a payment dated before the cutover uses, with the
// status of a posting before the cutover. A target books to the control
// account of its line in a Provisional journal (the invoices, memos and
// reimbursements the enable has just journaled), else to the default
// control account, as the posting does. The processor fee is not stored on
// the payment: it comes from the Stripe Connect mapping of the payment, as
// `recordStripeConnectPayment` (packages/ee/src/stripe-connect/payment.server.ts)
// passed it to the posting, on the integration's fee account, else the
// service charge default.
//
// Payments are written in posting order, a chunk at a time: a payment
// funded by an earlier payment's on-account credit books that credit to the
// control account of the earlier payment's journal.

import type { Database } from "@carbon/database";
import type { KyselyTx } from "@carbon/database/client";
import type { PaymentJournalFeeInput } from "@carbon/database/posting";
import { rebuildPaymentJournals } from "../../post-payment/post-payment-transaction";
import { legacyPayments } from "./detect";
import {
  attachJournalIds,
  chunks,
  insertProvisionalJournals,
  type LegacyJournal,
  readByIds
} from "./write";

type AccountDefaults = Database["public"]["Tables"]["accountDefault"]["Row"];

/** The integration whose mapping carries a payment's processor fee. */
const FEE_INTEGRATION = "stripe-connect";

export async function journalLegacyPayments(
  trx: KyselyTx,
  {
    companyId,
    companyGroupId,
    userId,
    cutoverDate,
    defaults
  }: {
    companyId: string;
    companyGroupId: string;
    userId: string;
    cutoverDate: string;
    defaults: AccountDefaults;
  }
): Promise<number> {
  const payments = await legacyPayments(trx, { companyId, cutoverDate });
  if (payments.length === 0) return 0;
  const feeByPaymentId = await processorFees(trx, {
    companyId,
    defaults,
    payments
  });

  let written = 0;
  for (const batch of chunks(payments)) {
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

/**
 * The processor fee each payment withheld, from its Stripe Connect mapping:
 * `metadata.feeAmount` when it is positive and in the payment's currency (or
 * names no currency), as `recordStripeConnectPayment` books it.
 */
async function processorFees(
  trx: KyselyTx,
  {
    companyId,
    defaults,
    payments
  }: {
    companyId: string;
    defaults: AccountDefaults;
    payments: Awaited<ReturnType<typeof legacyPayments>>;
  }
): Promise<Map<string, PaymentJournalFeeInput>> {
  const mappings = await readByIds(
    payments.map((payment) => payment.id),
    (ids) =>
      trx
        .selectFrom("externalIntegrationMapping")
        .select(["entityId", "externalId", "metadata"])
        .where("companyId", "=", companyId)
        .where("integration", "=", FEE_INTEGRATION)
        .where("entityType", "=", "payment")
        .where("entityId", "in", ids)
        .orderBy("createdAt")
        .execute()
  );
  const fees = new Map<string, PaymentJournalFeeInput>();
  if (mappings.length === 0) return fees;

  const integration = await trx
    .selectFrom("companyIntegration")
    .select("metadata")
    .where("companyId", "=", companyId)
    .where("id", "=", FEE_INTEGRATION)
    .executeTakeFirst();
  const integrationMetadata = (integration?.metadata ?? {}) as Record<
    string,
    unknown
  >;
  const feeAccount =
    (integrationMetadata.paymentFeeAccount as string | undefined) ||
    defaults.serviceChargeAccount;
  const paymentById = new Map(payments.map((payment) => [payment.id, payment]));
  for (const mapping of mappings) {
    const payment = paymentById.get(mapping.entityId);
    if (!payment || fees.has(payment.id)) continue;
    const metadata = (mapping.metadata ?? {}) as Record<string, unknown>;
    const feeAmount = Number(metadata.feeAmount ?? 0);
    const feeCurrency = (metadata.feeCurrency as string | null) ?? null;
    if (
      !(feeAmount > 0) ||
      (feeCurrency !== null && feeCurrency !== payment.currencyCode)
    ) {
      continue;
    }
    fees.set(payment.id, {
      amount: feeAmount,
      accountId: feeAccount,
      description: `Stripe processing fee — ${payment.reference ?? mapping.externalId}`
    });
  }
  return fees;
}
