/**
 * Carbon Learn — Accounting challenge checkers.
 *
 * Server-only: never import this from the module barrel. Each checker returns
 * the FIRST unmet requirement in the order the curriculum lists it, so the
 * learner is told the next thing to do rather than everything at once.
 */

import type { LearnCheckResult } from "../types";
import type { CheckerContext } from "./shared.server";
import { fail } from "./shared.server";

/**
 * A posted supplier bill is a SET of statuses, never one value. Posting lands
 * it on Open, and a bill that has since been settled reads Paid or Partially
 * Paid — a learner who did the work and then paid it must not be failed for
 * having kept going. Draft and Pending are the only ones that mean "not posted"
 * (Voided and the return states are posted, then undone, so they do not count).
 */
const POSTED_INVOICE_STATUSES = new Set([
  "Open",
  "Paid",
  "Partially Paid",
  "Overdue"
]);

/**
 * `accounting-post-purchase-invoice` — requirements, in curriculum order:
 * `invoice-exists`, `invoice-posted`.
 */
export async function checkPostPurchaseInvoice({
  scope,
  reader
}: CheckerContext): Promise<LearnCheckResult> {
  const invoices = await reader.purchaseInvoicesCreatedBy(scope);

  if (invoices.length === 0) {
    return fail(
      "invoice-exists",
      "No supplier bill created by you since you started this challenge. Enter one and check again."
    );
  }

  const posted = invoices.find((invoice) =>
    POSTED_INVOICE_STATUSES.has(invoice.status)
  );
  if (!posted) {
    const newest = invoices[0];
    return fail(
      "invoice-posted",
      `${newest.invoiceId || "Your supplier bill"} is still ${newest.status || "unposted"} — post it so it starts owing money`
    );
  }

  return {
    passed: true,
    evidence: {
      purchaseInvoiceId: posted.id,
      invoiceId: posted.invoiceId,
      status: posted.status
    }
  };
}

/**
 * `accounting-record-payment` — requirements, in curriculum order:
 * `payment-exists`, `payment-supplier`, `payment-posted`.
 */
export async function checkRecordPayment({
  scope,
  reader
}: CheckerContext): Promise<LearnCheckResult> {
  const payments = await reader.paymentsCreatedBy(scope);

  if (payments.length === 0) {
    return fail(
      "payment-exists",
      "No payment created by you since you started this challenge. Record one and check again."
    );
  }

  // `Disbursement` is money going out. A `Receipt` is a customer paying you,
  // which is the other half of the product and not what this asks for.
  const toSupplier = payments.filter(
    (payment) => payment.paymentType === "Disbursement" && payment.supplierId
  );
  if (toSupplier.length === 0) {
    return fail(
      "payment-supplier",
      "That payment is not a disbursement to a supplier — record one that pays a supplier bill"
    );
  }

  const posted = toSupplier.find((payment) => payment.status === "Posted");
  if (!posted) {
    return fail(
      "payment-posted",
      `${toSupplier[0].paymentId || "Your payment"} is still ${toSupplier[0].status || "unposted"} — post it`
    );
  }

  return {
    passed: true,
    evidence: {
      paymentId: posted.id,
      readableId: posted.paymentId,
      supplierId: posted.supplierId
    }
  };
}

/**
 * `accounting-close-a-period` — requirement: `period-closed`.
 *
 * Reads `closeStatus` (`Open | Locked | Closed`), NOT `status`, which is the
 * unrelated Active/Inactive flag on the same row. The reader scopes on
 * `closedBy`/`closedAt` because a period is created by fiscal-year setup — what
 * the learner did is close one.
 */
export async function checkCloseAPeriod({
  scope,
  reader
}: CheckerContext): Promise<LearnCheckResult> {
  const periods = await reader.accountingPeriodsClosedBy(scope);
  const closed = periods.find((period) => period.closeStatus === "Closed");

  if (!closed) {
    if (periods.length > 0) {
      const newest = periods[0];
      return fail(
        "period-closed",
        `Period ${newest.periodNumber ?? "?"} of ${newest.fiscalYear ?? "?"} is ${newest.closeStatus || "still open"}, not Closed — locking is not the same as closing`
      );
    }
    return fail(
      "period-closed",
      "No accounting period closed by you since you started this challenge. Close one and check again."
    );
  }

  return {
    passed: true,
    evidence: {
      accountingPeriodId: closed.id,
      fiscalYear: closed.fiscalYear,
      periodNumber: closed.periodNumber
    }
  };
}
