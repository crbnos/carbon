// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Database } from "@carbon/database";
import { endOfMonth, parseDate } from "@internationalized/date";

type PaymentTermCalculationMethod =
  Database["public"]["Enums"]["paymentTermCalculationMethod"];

/**
 * The payment term an invoice falls back to when none is specified — Net 30,
 * matching Stripe's default of 30 days until an invoice is due. Without it an
 * invoice with no payment term carried no due date at all, so it could never
 * read as overdue and never surfaced in AR/AP aging.
 */
export const DEFAULT_PAYMENT_TERM: {
  daysDue: number;
  calculationMethod: PaymentTermCalculationMethod;
} = { daysDue: 30, calculationMethod: "Net" };

/**
 * Compute an invoice due date from its issue date and payment term.
 *
 * The term's calculationMethod decides the anchor for daysDue:
 * - "Net": daysDue days after the issue date.
 * - "End of Month": daysDue days after the end of the issue month.
 * - "Day of Month": due on day daysDue of the month — the first occurrence on
 *   or after the issue date, clamped to the month's length (31 → Feb 28).
 *
 * A missing payment term is not a missing due date: it falls back to
 * DEFAULT_PAYMENT_TERM (Net 30) rather than returning null.
 *
 * Dates are yyyy-MM-dd strings; returns null when dateIssued can't be parsed.
 */
export function calculateDueDate(
  dateIssued: string,
  paymentTerm?: {
    daysDue: number;
    calculationMethod: PaymentTermCalculationMethod;
  } | null
): string | null {
  const { daysDue, calculationMethod } = paymentTerm ?? DEFAULT_PAYMENT_TERM;

  try {
    const issued = parseDate(dateIssued);
    switch (calculationMethod) {
      case "End of Month":
        return endOfMonth(issued).add({ days: daysDue }).toString();
      case "Day of Month": {
        // set() clamps daysDue to the month's length
        const sameMonth = issued.set({ day: daysDue });
        return (
          sameMonth.compare(issued) >= 0
            ? sameMonth
            : issued.add({ months: 1 }).set({ day: daysDue })
        ).toString();
      }
      default:
        return issued.add({ days: daysDue }).toString();
    }
  } catch {
    return null;
  }
}
