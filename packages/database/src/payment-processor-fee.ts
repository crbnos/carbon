// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The processor fee a payment withheld, read from where the payment's
// integration recorded it. A fee withheld before the cash reaches the bank
// (Stripe Connect's per-charge commission) is not stored on the payment:
// `recordStripeConnectPayment` (packages/ee/src/stripe-connect/payment.server.ts)
// writes it to the payment's `externalIntegrationMapping` row and passes it
// to `post-payment`. A journal built again from the stored payment (the void
// of a payment dated before the cutover, the enable's legacy payments) reads
// it here, with the same rules, so it books the fee the posting booked.
//
// Server-only: it reads the database.

import { type Kysely, sql, type Transaction } from "kysely";
import type { KyselyDatabase } from "./client";

/** The integration whose payment mapping carries the processor fee. */
export const PROCESSOR_FEE_INTEGRATION = "stripe-connect";

/** The refusal when a fee counts and no account takes it. Same meaning as
 *  `recordStripeConnectPayment`'s. */
export const MISSING_PROCESSOR_FEE_ACCOUNT_ERROR =
  "No service charge account is configured for Stripe processing fees (set accountDefault.serviceChargeAccount or the integration's paymentFeeAccount)";

/** A processor fee, in the payment's own currency, as `post-payment` takes it. */
export type ProcessorFee = {
  amount: number;
  accountId: string;
  description: string;
};

/** What of a payment decides its fee. */
export type ProcessorFeePayment = {
  id: string;
  currencyCode: string | null;
  reference: string | null;
};

/** What of a payment's mapping row decides its fee. */
export type ProcessorFeeMapping = {
  externalId: string | null;
  metadata: unknown;
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/**
 * The fee a mapping records, without its account. A fee counts only when
 * `metadata.feeAmount` is more than zero and `metadata.feeCurrency` is the
 * payment's currency. A fee with no currency does not count.
 */
export function countedProcessorFee(
  payment: ProcessorFeePayment,
  mapping: ProcessorFeeMapping
): { amount: number; description: string } | null {
  const metadata = record(mapping.metadata);
  const amount = Number(metadata.feeAmount ?? 0);
  const currency = (metadata.feeCurrency as string | null | undefined) ?? null;
  if (!(amount > 0) || !currency || currency !== payment.currencyCode) {
    return null;
  }
  return {
    amount,
    // The payment's reference is the Stripe invoice number, else its id,
    // which is the mapping's external id.
    description: `Stripe processing fee — ${payment.reference ?? mapping.externalId ?? payment.id}`
  };
}

/**
 * The account a counted fee books to: the integration's `paymentFeeAccount`,
 * else the service charge default. Throws when neither is set.
 */
export function processorFeeAccount(
  integrationMetadata: unknown,
  serviceChargeAccount: string | null | undefined
): string {
  const accountId =
    (record(integrationMetadata).paymentFeeAccount as string | undefined) ||
    serviceChargeAccount;
  if (!accountId) throw new Error(MISSING_PROCESSOR_FEE_ACCOUNT_ERROR);
  return accountId;
}

/**
 * The processor fee of each payment of one company, in one read per table.
 *
 * - `fees` holds a payment whose mapping records a fee that counts.
 * - `mapped` holds every payment that has a mapping row, with or without a
 *   fee. A payment with no row has no fee recorded here.
 *
 * Throws `MISSING_PROCESSOR_FEE_ACCOUNT_ERROR` when a fee counts and no
 * account takes it. When a payment has more than one row, the first one
 * written decides.
 */
export async function readPaymentProcessorFees(
  db: Kysely<KyselyDatabase> | Transaction<KyselyDatabase>,
  companyId: string,
  payments: ProcessorFeePayment[]
): Promise<{ fees: Map<string, ProcessorFee>; mapped: Set<string> }> {
  const fees = new Map<string, ProcessorFee>();
  const mapped = new Set<string>();
  const ids = [...new Set(payments.map((payment) => payment.id))];
  if (ids.length === 0) return { fees, mapped };

  const mappings = await db
    .selectFrom("externalIntegrationMapping")
    .select(["entityId", "externalId", "metadata"])
    .where("companyId", "=", companyId)
    .where("integration", "=", PROCESSOR_FEE_INTEGRATION)
    .where("entityType", "=", "payment")
    .where(sql<boolean>`"entityId" = any(${ids}::text[])`)
    .orderBy("createdAt")
    .orderBy("id")
    .execute();

  const paymentById = new Map(payments.map((payment) => [payment.id, payment]));
  const counted = new Map<string, { amount: number; description: string }>();
  for (const mapping of mappings) {
    const payment = paymentById.get(mapping.entityId);
    if (!payment || mapped.has(payment.id)) continue;
    mapped.add(payment.id);
    const fee = countedProcessorFee(payment, mapping);
    if (fee) counted.set(payment.id, fee);
  }
  if (counted.size === 0) return { fees, mapped };

  const [integration, defaults] = await Promise.all([
    db
      .selectFrom("companyIntegration")
      .select("metadata")
      .where("companyId", "=", companyId)
      .where("id", "=", PROCESSOR_FEE_INTEGRATION)
      .executeTakeFirst(),
    db
      .selectFrom("accountDefault")
      .select("serviceChargeAccount")
      .where("companyId", "=", companyId)
      .executeTakeFirst()
  ]);
  const accountId = processorFeeAccount(
    integration?.metadata,
    defaults?.serviceChargeAccount
  );
  for (const [paymentId, fee] of counted) {
    fees.set(paymentId, { ...fee, accountId });
  }
  return { fees, mapped };
}
