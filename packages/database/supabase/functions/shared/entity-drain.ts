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
