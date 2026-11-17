// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { round } from "@carbon/utils";
import { jobMaterialShortfall } from "./traveler";

/** Stock the job can draw now, against what its materials still need of the item. */
export type StockShortage = { available: number; needed: number };

type StockMaterial = {
  id: string | null;
  itemId: string | null;
  methodType: string | null;
  quantity: number | null;
  estimatedQuantity: number | null;
  /** Job-wide, not the part consumed into one unit. */
  quantityIssued: number | null;
};

/**
 * The materials the stock on hand cannot fully issue, by material id. Materials
 * of one item share its stock, so the item's stock is compared with what all of
 * them still need. Only a material pulled from inventory that is still owed is
 * listed; an item absent from `availableByItem` holds no stock.
 */
export function materialStockShortages(
  materials: StockMaterial[],
  availableByItem: Map<string, number>
): Map<string, StockShortage> {
  const owed = materials.filter(
    (material) =>
      material.id &&
      material.itemId &&
      material.methodType === "Pull from Inventory" &&
      jobMaterialShortfall(material) > 0
  );
  const neededByItem = new Map<string, number>();
  for (const material of owed) {
    neededByItem.set(
      material.itemId!,
      (neededByItem.get(material.itemId!) ?? 0) + jobMaterialShortfall(material)
    );
  }

  const shortages = new Map<string, StockShortage>();
  for (const material of owed) {
    const needed = round(neededByItem.get(material.itemId!) ?? 0);
    const available = round(
      Math.max(0, availableByItem.get(material.itemId!) ?? 0)
    );
    if (available < needed) shortages.set(material.id!, { available, needed });
  }
  return shortages;
}
