import type { Database } from "../lib/types.ts";

type PaymentTermCalculationMethod =
  Database["public"]["Enums"]["paymentTermCalculationMethod"];

/**
 * The payment term an invoice falls back to when none is specified — Net 30,
 * matching Stripe's default of 30 days until an invoice is due. Without it an
 * invoice with no payment term carried no due date at all, so it could never
 * read as overdue and never surfaced in AR/AP aging.
 *
 * Mirrors DEFAULT_PAYMENT_TERM in
 * apps/erp/app/modules/invoicing/invoicing.service.ts — keep the two in sync.
 */
export const DEFAULT_PAYMENT_TERM: {
  daysDue: number;
  calculationMethod: PaymentTermCalculationMethod;
} = { daysDue: 30, calculationMethod: "Net" };

/**
 * Compute an invoice due date from its issue date and payment term. Mirrors
 * computeInvoiceDateDue in apps/erp/app/modules/invoicing/invoicing.service.ts
 * — keep the two in sync.
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
  const issued = new Date(`${dateIssued}T00:00:00Z`);
  if (Number.isNaN(issued.getTime())) return null;

  const { daysDue, calculationMethod } = paymentTerm ?? DEFAULT_PAYMENT_TERM;
  const year = issued.getUTCFullYear();
  const month = issued.getUTCMonth();

  let due: Date;
  switch (calculationMethod) {
    case "End of Month":
      // day 0 of month + 1 is the last day of the issue month
      due = new Date(Date.UTC(year, month + 1, daysDue));
      break;
    case "Day of Month": {
      due = new Date(Date.UTC(year, month, clampDay(daysDue, year, month)));
      if (due < issued) {
        due = new Date(
          Date.UTC(year, month + 1, clampDay(daysDue, year, month + 1))
        );
      }
      break;
    }
    default:
      due = new Date(Date.UTC(year, month, issued.getUTCDate() + daysDue));
  }

  return due.toISOString().slice(0, 10);
}

// Clamp a configured day-of-month into the target month's real range so day 31
// resolves to Feb 28 rather than rolling into March.
function clampDay(day: number, year: number, month: number): number {
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return Math.min(Math.max(day, 1), daysInMonth);
}
