// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

/**
 * Short-close-aware invoicing quantities for purchase order lines.
 *
 * A short-closed line has `receivedComplete = true` while
 * `quantityReceived < purchaseQuantity`: the buyer declared the undelivered
 * remainder will never arrive ("Stop Receiving"). Only what was actually
 * received is billable. The generated `quantityToInvoice` column
 * (purchaseQuantity - quantityInvoiced) knows nothing about receiving, so
 * invoicing paths must go through these helpers instead of the column.
 */

export type ShortCloseInvoicingLine = {
  purchaseQuantity: number | null;
  quantityReceived: number | null;
  quantityInvoiced: number | null;
  receivedComplete: boolean | null;
};

/**
 * Quantity the supplier can ultimately bill for the line: the ordered
 * quantity normally, or only the received quantity when the line is
 * short-closed.
 */
export function getBillableQuantity(line: ShortCloseInvoicingLine): number {
  const ordered = line.purchaseQuantity ?? 0;
  const received = line.quantityReceived ?? 0;
  const isShortClosed = !!line.receivedComplete && received < ordered;
  return isShortClosed ? received : ordered;
}

/**
 * Billable quantity not yet invoiced. Equals the generated
 * `quantityToInvoice` column for normal lines; capped at the received
 * quantity for short-closed lines.
 */
export function getRemainingQuantityToInvoice(
  line: ShortCloseInvoicingLine
): number {
  return Math.max(getBillableQuantity(line) - (line.quantityInvoiced ?? 0), 0);
}

/**
 * The line's completion flags once its ordered quantity becomes
 * `purchaseQuantity`. Receipt and invoice posting only ever set the flags,
 * so a quantity edit (a reopened order, a planning Increase) must restate
 * them: a line invoiced for 10 and raised to 20 still has 10 to invoice. A
 * line still short-closed (received below the ordered quantity) stays closed
 * — Stop Receiving is the buyer's decision, not a quantity fact. Once the
 * ordered quantity is set to what was received nothing is short any more, so
 * a later increase is a new request and reopens receiving.
 */
export function getCompletionAfterQuantityChange(
  line: ShortCloseInvoicingLine,
  purchaseQuantity: number
): { receivedComplete: boolean; invoicedComplete: boolean } {
  const received = line.quantityReceived ?? 0;
  const isShortClosed =
    !!line.receivedComplete && received < (line.purchaseQuantity ?? 0);
  const receivedComplete = isShortClosed || received >= purchaseQuantity;
  const invoicedComplete =
    (line.quantityInvoiced ?? 0) >=
    getBillableQuantity({ ...line, purchaseQuantity, receivedComplete });
  return { receivedComplete, invoicedComplete };
}
