/**
 * Which Carbon documents are eligible to push to a spend platform.
 *
 * These are statements about CARBON's lifecycle, not any platform's API — a
 * released purchase order is a commitment worth mirroring, a Draft one is not;
 * an employee-party invoice is a reimbursement that originated in the platform
 * and must never be pushed back to it. A second provider changes none of it.
 */

import type { Database } from "@carbon/database";

type PurchaseOrderStatus = Database["public"]["Enums"]["purchaseOrderStatus"];

/** Released statuses that push. */
export const SPEND_PUSHED_PURCHASE_ORDER_STATUSES: PurchaseOrderStatus[] = [
  "To Receive",
  "To Receive and Invoice",
  "To Invoice",
  "Completed",
  "Closed"
];

/**
 * Settled statuses. The platform's counterpart is retired rather than updated —
 * HOW it is retired (archive, close, delete, or not at all) is the provider's
 * business; that it should no longer look open is Carbon's.
 *
 * `Completed` is deliberately NOT here, and the distinction is the whole point.
 * A Completed order is fully received AND invoiced, so its bill is arriving at
 * the platform at almost the same moment — and the platform matches a bill to an
 * order on its own, which it can only do while the order still exists. Retiring
 * it on Completed destroyed the counterpart exactly when it was about to be
 * used: the bill landed with no matching order, and the three-way match the
 * order was pushed for could never happen. (Verified against Ramp 2026-09-27:
 * an archived purchase order 404s and is absent from every list, and a draft
 * bill has no writable purchase-order field — Ramp accepted both
 * `purchase_order_id` and `purchase_order_ids` with a 201 and stored neither —
 * so the order EXISTING is the only lever Carbon has over the match.)
 *
 * `Closed` is short-closed or abandoned: no bill is coming, nothing will ever
 * match it, and retiring it is the tidying it was always meant to be.
 */
export const SPEND_SETTLED_PURCHASE_ORDER_STATUSES: PurchaseOrderStatus[] = [
  "Closed"
];

/**
 * Payable statuses that hand off.
 *
 * Read from the `purchaseInvoices` VIEW, never the table — the view DERIVES
 * status, so a fully settled invoice reads "Paid" there while the table still
 * stores "Open", and "Partially Paid"/"Overdue" exist only in the view. Reading
 * the table would hand the platform bills that are already paid.
 */
export const SPEND_PUSHED_INVOICE_STATUSES = [
  "Open",
  "Partially Paid",
  "Overdue"
];

/** Reimbursement suppliers — their invoices are the platform's own. */
export const EMPLOYEE_SUPPLIER_TYPE = "Employee";

export function isPushablePurchaseOrderStatus(
  status: PurchaseOrderStatus
): boolean {
  return SPEND_PUSHED_PURCHASE_ORDER_STATUSES.includes(status);
}

export function isSettledPurchaseOrderStatus(
  status: PurchaseOrderStatus
): boolean {
  return SPEND_SETTLED_PURCHASE_ORDER_STATUSES.includes(status);
}

export function isPushableInvoiceStatus(status: string): boolean {
  return SPEND_PUSHED_INVOICE_STATUSES.includes(status);
}
