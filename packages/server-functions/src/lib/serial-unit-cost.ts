// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Database } from "@carbon/database";
import { orderLayersForConsumption } from "./cost-layer-order";

// What ONE serial unit would leave stock at right now, without consuming
// anything: the same arithmetic calculateCOGS runs for a quantity of one —
// Standard at the standard cost, Average at the unit cost, FIFO / LIFO from
// the unit's own layer first (cost-layer-order.ts), then the unstamped layers,
// each with its price-correction children, falling back to the item's unit
// cost when no layer is left. Pure, so a whole item's units are valued from
// one read of its layers.

export type UnitCostLayer = {
  id: string;
  trackedEntityId: string | null;
  quantity: number;
  cost: number;
  remainingQuantity: number;
};

export type UnitCostChild = {
  quantity: number;
  cost: number;
  remainingQuantity: number;
};

export type UnitCostBasis = {
  costingMethod: Database["public"]["Enums"]["itemCostingMethod"];
  unitCost: number | null;
  standardCost: number | null;
};

export function serialUnitCost(args: {
  itemCost: UnitCostBasis;
  // Open layers already in FIFO / LIFO order, as calculateCOGS reads them.
  layers: UnitCostLayer[];
  // Open price-correction children per layer id, oldest first.
  childrenByLayer: ReadonlyMap<string, UnitCostChild[]>;
  trackedEntityId: string;
}): number {
  const { itemCost } = args;
  switch (itemCost.costingMethod) {
    case "Standard":
      return Number(itemCost.standardCost ?? 0);
    case "Average":
      return Number(itemCost.unitCost ?? 0);
    case "FIFO":
    case "LIFO": {
      let remaining = 1;
      let total = 0;
      const ordered = orderLayersForConsumption(args.layers, [
        args.trackedEntityId
      ]);
      for (const layer of ordered) {
        if (remaining <= 0) break;
        const layerRemaining = Number(layer.remainingQuantity);
        if (layerRemaining <= 0) continue;
        const layerUnitCost =
          Number(layer.quantity) > 0
            ? Number(layer.cost) / Number(layer.quantity)
            : 0;
        const taken = Math.min(remaining, layerRemaining);
        total += taken * layerUnitCost;
        remaining -= taken;

        let unapplied = taken;
        for (const child of args.childrenByLayer.get(layer.id) ?? []) {
          if (unapplied <= 0) break;
          const childRemaining = Number(child.remainingQuantity);
          const perUnitBump =
            Number(child.quantity) > 0
              ? Number(child.cost) / Number(child.quantity)
              : 0;
          const applied = Math.min(childRemaining, unapplied);
          total += applied * perUnitBump;
          unapplied -= applied;
        }
      }
      if (remaining > 0) total += remaining * Number(itemCost.unitCost ?? 0);
      return total;
    }
    default:
      throw new Error(`Unsupported costing method: ${itemCost.costingMethod}`);
  }
}
