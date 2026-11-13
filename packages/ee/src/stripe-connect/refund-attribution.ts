// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

/** A Stripe Connect payment mapping, as `refundedChargePayments` reads it. */
export type ChargePaymentMapping = {
  paymentId: string;
  /** When the mapping was written: a Kysely `Date` or an ISO string. */
  createdAt: Date | string;
  /**
   * Every charge behind the invoice when this payment was recorded. The list
   * is cumulative: a later installment's mapping repeats the earlier charges.
   */
  chargeIds: string[];
};

export type RefundedChargePayments =
  | { status: "void"; paymentIds: string[] }
  | { status: "manual"; reason: string };

const instant = (value: Date | string) =>
  value instanceof Date ? value.getTime() : Date.parse(value);

/**
 * The payments to void when one charge behind a Stripe invoice is refunded in
 * full or lost in a dispute. A charge belongs to the payment that first
 * recorded it: the earliest mapping that lists it. Only that payment is
 * voided, so the other installments on the invoice keep their cash.
 *
 * A payment that recorded several charges at once (one delivery saw two
 * charges) cannot be voided for one of them: the void reverses the whole
 * payment, so that case is left for a person.
 */
export function refundedChargePayments(
  mappings: ChargePaymentMapping[],
  chargeId: string
): RefundedChargePayments {
  const ordered = [...mappings].sort(
    (a, b) =>
      instant(a.createdAt) - instant(b.createdAt) ||
      a.paymentId.localeCompare(b.paymentId)
  );

  const seen = new Set<string>();
  for (const mapping of ordered) {
    const owned = mapping.chargeIds.filter((id) => !seen.has(id));
    for (const id of owned) seen.add(id);
    if (!owned.includes(chargeId)) continue;
    if (owned.length > 1) {
      return {
        status: "manual",
        reason: `Payment ${mapping.paymentId} also records charges ${owned
          .filter((id) => id !== chargeId)
          .join(
            ", "
          )}, so voiding it would reverse more than the refunded charge`
      };
    }
    return { status: "void", paymentIds: [mapping.paymentId] };
  }

  return {
    status: "manual",
    reason: `No Stripe Connect payment records charge ${chargeId}`
  };
}
