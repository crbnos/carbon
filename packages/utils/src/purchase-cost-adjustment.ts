// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

export interface ReceiptLayerLike {
  id: string;
  quantity: number; // original layer quantity
  remainingQuantity: number; // unconsumed units
  projectId?: string | null; // the layer's stock stripe (null = common)
}

export interface VarianceAllocation {
  inventoryShare: number; // GL: Dr Inventory (write-up of on-hand goods)
  ppvShare: number; // GL: Dr PPV (variance on already-consumed goods)
  perLayer: {
    costLedgerId: string;
    appliedQuantity: number; // units of this layer the adjustment applies to
    adjustmentCost: number; // total cost bump for those units
    projectId?: string | null; // the layer's stock stripe, when given
  }[];
  /**
   * The consumed share, per layer: the matched units no on-hand unit covers,
   * taken from each layer's consumed units in order. Their costs add up to
   * `ppvShare` unless the layers hold fewer units than were matched. Set only
   * when there is a variance to split.
   */
  consumed?: {
    costLedgerId: string;
    projectId: string | null;
    quantity: number;
    cost: number;
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
      perLayer: []
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
      ...(layer.projectId !== undefined ? { projectId: layer.projectId } : {})
    });
    inventoryShare += adjustmentCost;
    uncovered -= applied;
  }
  // The units no on-hand unit covers were consumed: attribute them to the
  // layers' consumed units in order, so a striped layer's consumed share can
  // follow its project (Projects Phase 3).
  const consumed: NonNullable<VarianceAllocation["consumed"]> = [];
  for (const layer of layers) {
    if (uncovered <= 0) break;
    const consumedUnits = Math.max(
      layer.quantity - Math.max(layer.remainingQuantity, 0),
      0
    );
    const applied = Math.min(consumedUnits, uncovered);
    if (applied <= 0) continue;
    consumed.push({
      costLedgerId: layer.id,
      projectId: layer.projectId ?? null,
      quantity: applied,
      cost: perUnit * applied
    });
    uncovered -= applied;
  }
  return {
    inventoryShare,
    ppvShare: variance - inventoryShare,
    perLayer,
    consumed
  };
}
