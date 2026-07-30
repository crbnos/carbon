import { Database } from "../lib/types.ts";

export interface AdjustmentItemCost {
  costingMethod: Database["public"]["Enums"]["itemCostingMethod"];
  unitCost: number | null;
  standardCost: number | null;
}

export interface OpenCostLayer {
  quantity: number;
  remainingQuantity: number;
  cost: number;
  appliedChildCost: number;
}

// Current carrying unit cost for a POSITIVE adjustment's new layer / journal
// value. Mirrors the valuation RPC's carrying CTE: FIFO/LIFO use the
// weighted-average effective cost of open layers (including applied
// invoice-vs-receipt children); Average/Standard come straight from itemCost.
// Pure (no I/O) so it stays unit-testable with `deno test`.
export function computeCurrentUnitCost(
  itemCost: AdjustmentItemCost,
  openLayers: OpenCostLayer[]
): number {
  switch (itemCost.costingMethod) {
    case "Standard":
      return Number(itemCost.standardCost ?? 0);
    case "Average":
      return Number(itemCost.unitCost ?? 0);
    case "FIFO":
    case "LIFO": {
      let remaining = 0;
      let value = 0;
      for (const layer of openLayers) {
        const quantity = Number(layer.quantity);
        const layerRemaining = Number(layer.remainingQuantity);
        if (quantity <= 0 || layerRemaining <= 0) continue;
        const effectiveUnitCost =
          (Number(layer.cost) + Number(layer.appliedChildCost)) / quantity;
        remaining += layerRemaining;
        value += layerRemaining * effectiveUnitCost;
      }
      if (remaining <= 0) return Number(itemCost.unitCost ?? 0);
      return value / remaining;
    }
    default:
      return Number(itemCost.unitCost ?? 0);
  }
}
