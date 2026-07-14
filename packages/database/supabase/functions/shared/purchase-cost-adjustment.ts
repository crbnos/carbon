export interface ReceiptLayerLike {
  id: string;
  quantity: number; // original layer quantity
  remainingQuantity: number; // unconsumed units
}

export interface VarianceAllocation {
  inventoryShare: number; // GL: Dr Inventory (write-up of on-hand goods)
  ppvShare: number; // GL: Dr PPV (variance on already-consumed goods)
  perLayer: {
    costLedgerId: string;
    appliedQuantity: number; // units of this layer the adjustment applies to
    adjustmentCost: number; // total cost bump for those units
  }[];
}

/**
 * Split an invoice-vs-receipt price variance for `matchedQuantity` units across
 * the receipt layers that hold them. Units still on hand absorb their share of
 * the variance into inventory (per-layer adjustment child rows); units already
 * consumed send their share to PPV. Layers must be passed in FIFO order.
 */
export function allocateVarianceAcrossLayers(
  layers: ReceiptLayerLike[],
  matchedQuantity: number,
  variance: number
): VarianceAllocation {
  if (matchedQuantity <= 0 || Math.abs(variance) <= 0.005) {
    return {
      inventoryShare: 0,
      ppvShare: Math.abs(variance) > 0.005 ? variance : 0,
      perLayer: [],
    };
  }
  const perUnit = variance / matchedQuantity;
  let uncovered = matchedQuantity;
  let inventoryShare = 0;
  const perLayer: VarianceAllocation["perLayer"] = [];
  for (const layer of layers) {
    if (uncovered <= 0) break;
    const applied = Math.min(Math.max(layer.remainingQuantity, 0), uncovered);
    if (applied <= 0) continue;
    const adjustmentCost = perUnit * applied;
    perLayer.push({
      costLedgerId: layer.id,
      appliedQuantity: applied,
      adjustmentCost,
    });
    inventoryShare += adjustmentCost;
    uncovered -= applied;
  }
  return { inventoryShare, ppvShare: variance - inventoryShare, perLayer };
}
