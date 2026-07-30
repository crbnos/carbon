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
