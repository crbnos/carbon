// The one rule for a tracked entity's status after its quantity changes, shared
// by the writers that can drain an entity to zero (post-inventory-count, the
// receipt split in create, correct-stock-movement; post-inventory-adjustment
// applies the same drain inline on its Available-stock paths). A lot with no
// quantity left is Consumed, not a husk that still reads Available and clutters
// every on-hand list; a Scrapped lot stays Scrapped even at zero — it is a
// historical record and unscrap is the only way back. Pure, dependency-free
// aside from the sibling precision module.

import { round } from "./precision.ts";

export function statusAfterQuantityChange<S extends string>(
  newQuantity: number,
  currentStatus: S
): S | "Consumed" {
  if (currentStatus === "Scrapped") return currentStatus;
  return round(newQuantity) <= 0 ? "Consumed" : currentStatus;
}

/**
 * The whole settle for one quantity write: round at the persist boundary,
 * refuse a negative result, and apply the drain rule above. Every writer that
 * moves a tracked entity's quantity goes through this so the rounded value and
 * the status flip can never be derived from different numbers — a residue
 * quantity that reads as 0 after rounding must ALSO be Consumed.
 *
 * `quantity` is the settled (post-arithmetic) figure, not a delta: callers that
 * hold a delta pass `current + delta`, which is what makes one signature serve
 * both the count path (snapshot delta) and the adjustment/unpick paths.
 */
export function settleQuantity<S extends string>(input: {
  quantity: number;
  status: S;
  /** Message for a below-zero result. Landing there means the caller's own
   *  guard and this write disagree, so we refuse rather than clamp. */
  refusal?: string;
}): { quantity: number; status: S | "Consumed" } {
  const quantity = round(input.quantity);
  if (quantity < 0) {
    throw new Error(
      input.refusal ??
        `Quantity would fall to ${quantity} — refusing to write a negative tracked quantity`
    );
  }
  return {
    quantity,
    status: statusAfterQuantityChange(quantity, input.status),
  };
}
