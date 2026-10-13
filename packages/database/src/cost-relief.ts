// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// How an outbound quantity of a FIFO or LIFO item relieves its cost layers:
// the one definition of a cost layer, the order layers are relieved in, and
// the arithmetic. `calculateCOGS` (server-functions lib/calculate-cogs.ts)
// reads and locks the layers and writes what `relieveLayers` returns; the
// accounting enable's re-cost (`recostOutbound`, accounting-cutover.ts) and
// the legacy movement costs (server-functions activate-accounting/legacy)
// run a sequence of reliefs through `replayReliefs`. Pure: no reads, no
// writes.

import type { ExpressionBuilder } from "kysely";
import type { KyselyDatabase } from "./client";
import { EPSILON, round } from "./precision";

export type CostingMethod = "FIFO" | "LIFO";

type CostLedgerExpression = ExpressionBuilder<KyselyDatabase, "costLedger">;

/** A movement's own cost row: not an adjustment child, not a purchase
 *  order's planning row. */
function movementCostRow(eb: CostLedgerExpression) {
  return eb.and([
    eb("adjustment", "=", false),
    eb("appliesToCostLedgerId", "is", null),
    eb("itemId", "is not", null),
    eb.or([
      eb("documentType", "is", null),
      eb("documentType", "!=", "Purchase Order")
    ])
  ]);
}

/**
 * A cost row that opened a layer: the inbound row of a movement. A job
 * return is not one: `issue` and the SQL backflush write it as a positive
 * "Job Consumption" row with nothing remaining. Its open adjustment
 * children (`appliesToCostLedgerId`) are relieved with it.
 */
export function isCostLayer(eb: CostLedgerExpression) {
  return eb.and([
    movementCostRow(eb),
    eb("quantity", ">", 0),
    eb.or([
      eb("documentType", "is", null),
      eb("documentType", "!=", "Job Consumption")
    ])
  ]);
}

/** A cost row that relieved layers: the outbound row of a movement. */
export function isCostRelief(eb: CostLedgerExpression) {
  return eb.and([movementCostRow(eb), eb("quantity", "<", 0)]);
}

export interface OrderableCostLayer {
  trackedEntityId: string | null;
}

/**
 * Specific identification for serial units: a layer booked for ONE serial
 * (`trackedEntityId` set, e.g. a fixed asset returned to stock at its net
 * book value) belongs to that unit. The unit leaving is relieved from its own
 * layer first; every other consumer takes the unstamped layers in FIFO / LIFO
 * order and reaches a layer stamped for a DIFFERENT unit only when the
 * unstamped ones run out: relieving another unit's value beats relieving
 * value that is not on the books, but it is the last resort.
 */
export function orderLayersForConsumption<T extends OrderableCostLayer>(
  // Already in FIFO / LIFO order.
  layers: T[],
  trackedEntityIds: readonly string[] = []
): T[] {
  const leaving = new Set(trackedEntityIds);
  const own: T[] = [];
  const unstamped: T[] = [];
  const others: T[] = [];
  for (const layer of layers) {
    if (layer.trackedEntityId === null) unstamped.push(layer);
    else if (leaving.has(layer.trackedEntityId)) own.push(layer);
    else others.push(layer);
  }
  return [...own, ...unstamped, ...others];
}

/** An invoice-vs-receipt price correction carried by a layer's units. */
export type ReliefChild = {
  id: string;
  quantity: number;
  cost: number;
  remainingQuantity: number;
};

export type ReliefLayer = {
  id: string;
  quantity: number;
  cost: number;
  remainingQuantity: number;
  trackedEntityId: string | null;
  /** Its adjustment children, oldest first. */
  children: ReliefChild[];
};

/** An outbound quantity, unsigned, and the serial units leaving with it. */
export type Relief = {
  quantity: number;
  trackedEntityIds: readonly string[];
};

export type ReliefResult = {
  /** Unrounded. */
  totalCost: number;
  /** Each layer drawn on, in the order drawn, at its own unit cost. */
  layersConsumed: { layerId: string; quantity: number; unitCost: number }[];
  /** The new remaining quantity of every layer and child drawn on. */
  remaining: Map<string, number>;
};

/**
 * Relieves `relief` from an item's layers (oldest first). The serial units
 * leaving take their own layers first (`orderLayersForConsumption`), then
 * FIFO takes the oldest and LIFO the newest. Each unit costs its layer's unit
 * cost plus the per-unit bump of each child the unit carries; a quantity no
 * layer covers costs `fallbackUnitCost`, as negative stock does. Writes
 * nothing: the caller applies `remaining`.
 */
export function relieveLayers(
  layers: readonly ReliefLayer[],
  method: CostingMethod,
  relief: Relief,
  fallbackUnitCost: number
): ReliefResult {
  const ordered = orderLayersForConsumption(
    method === "LIFO" ? [...layers].reverse() : [...layers],
    relief.trackedEntityIds
  );
  let toRelieve = relief.quantity;
  let totalCost = 0;
  const layersConsumed: ReliefResult["layersConsumed"] = [];
  const remaining = new Map<string, number>();
  for (const layer of ordered) {
    if (toRelieve <= EPSILON) break;
    if (layer.remainingQuantity <= EPSILON) continue;
    const unitCost = layer.quantity > 0 ? layer.cost / layer.quantity : 0;
    const take = Math.min(toRelieve, layer.remainingQuantity);
    totalCost += take * unitCost;
    toRelieve -= take;
    layersConsumed.push({ layerId: layer.id, quantity: take, unitCost });
    remaining.set(layer.id, layer.remainingQuantity - take);

    let unapplied = take;
    for (const child of layer.children) {
      if (unapplied <= EPSILON) break;
      if (child.remainingQuantity <= EPSILON) continue;
      const bump = child.quantity > 0 ? child.cost / child.quantity : 0;
      const apply = Math.min(child.remainingQuantity, unapplied);
      totalCost += apply * bump;
      unapplied -= apply;
      remaining.set(child.id, child.remainingQuantity - apply);
    }
  }
  if (toRelieve > EPSILON) totalCost += toRelieve * fallbackUnitCost;
  return { totalCost, layersConsumed, remaining };
}

/** One step of a replay: a layer that opens, or a quantity that leaves. */
export type ReliefEvent =
  | { kind: "layer"; itemId: string; layer: ReliefLayer }
  | {
      kind: "relief";
      key: string;
      itemId: string;
      quantity: number;
      trackedEntityIds: readonly string[];
    };

/**
 * Runs `events` in order, as successive `calculateCOGS` calls would: a layer
 * event opens a layer at its own remaining quantity (newest of its item), a
 * relief event relieves its item's open layers with `relieveLayers`. Returns
 * each relief's cost (rounded) by key, and the remaining quantity (rounded)
 * of every layer and child the events opened.
 */
export function replayReliefs({
  events,
  methodByItem,
  fallbackUnitCostByItem
}: {
  events: readonly ReliefEvent[];
  methodByItem: ReadonlyMap<string, CostingMethod>;
  fallbackUnitCostByItem: ReadonlyMap<string, number>;
}): { costByKey: Map<string, number>; remainingById: Map<string, number> } {
  const open = new Map<string, ReliefLayer[]>();
  const costByKey = new Map<string, number>();
  const remainingById = new Map<string, number>();
  for (const event of events) {
    if (event.kind === "layer") {
      const layer = {
        ...event.layer,
        children: event.layer.children.map((child) => ({ ...child }))
      };
      const layers = open.get(event.itemId);
      if (layers) layers.push(layer);
      else open.set(event.itemId, [layer]);
      remainingById.set(layer.id, layer.remainingQuantity);
      for (const child of layer.children) {
        remainingById.set(child.id, child.remainingQuantity);
      }
      continue;
    }
    const method = methodByItem.get(event.itemId);
    const fallbackUnitCost = fallbackUnitCostByItem.get(event.itemId);
    if (!method || fallbackUnitCost === undefined) {
      throw new Error(
        `Item ${event.itemId} has no costing method or unit cost to relieve its layers`
      );
    }
    const layers = open.get(event.itemId) ?? [];
    const result = relieveLayers(
      layers,
      method,
      { quantity: event.quantity, trackedEntityIds: event.trackedEntityIds },
      fallbackUnitCost
    );
    costByKey.set(event.key, round(result.totalCost));
    for (const layer of layers) {
      const layerRemaining = result.remaining.get(layer.id);
      if (layerRemaining !== undefined)
        layer.remainingQuantity = layerRemaining;
      for (const child of layer.children) {
        const childRemaining = result.remaining.get(child.id);
        if (childRemaining !== undefined) {
          child.remainingQuantity = childRemaining;
        }
      }
    }
    for (const [id, quantity] of result.remaining) {
      remainingById.set(id, quantity);
    }
  }
  for (const [id, quantity] of remainingById) {
    remainingById.set(id, round(quantity));
  }
  return { costByKey, remainingById };
}
