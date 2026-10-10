// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { KyselyDatabase as DB } from "@carbon/database/client";
import type { Transaction } from "kysely";
import { orderLayersForConsumption } from "./cost-layer-order";

export interface CostLayer {
  costLedgerId: string;
  quantityConsumed: number;
  unitCost: number;
}

export interface COGSResult {
  unitCost: number;
  totalCost: number;
  layersConsumed: CostLayer[];
}

export async function calculateCOGS(
  trx: Transaction<DB>,
  {
    itemId,
    quantity,
    companyId,
    trackedEntityIds,
    projectId
  }: {
    itemId: string;
    quantity: number;
    companyId: string;
    // The stock stripe the quantity is drawn from: a project id for that
    // project's stock, or null / undefined for common stock. Layers of any
    // other stripe are never relieved.
    projectId?: string | null;
    // The serial units leaving, when the caller knows them: each is relieved
    // from the layer booked for it (specific identification) before the
    // FIFO / LIFO layers. See cost-layer-order.ts.
    trackedEntityIds?: readonly string[];
  }
): Promise<COGSResult> {
  const itemCost = await trx
    .selectFrom("itemCost")
    .selectAll()
    .where("itemId", "=", itemId)
    .where("companyId", "=", companyId)
    .executeTakeFirstOrThrow();

  const costingMethod = itemCost.costingMethod;

  switch (costingMethod) {
    case "Standard": {
      const standardCost = Number(itemCost.standardCost ?? 0);
      return {
        unitCost: standardCost,
        totalCost: standardCost * quantity,
        layersConsumed: []
      };
    }

    case "Average": {
      const unitCost = Number(itemCost.unitCost ?? 0);
      return {
        unitCost,
        totalCost: unitCost * quantity,
        layersConsumed: []
      };
    }

    case "FIFO":
    case "LIFO": {
      const orderDirection = costingMethod === "FIFO" ? "asc" : "desc";

      const orderedLayers = await trx
        .selectFrom("costLedger")
        .selectAll()
        .where("itemId", "=", itemId)
        .where("companyId", "=", companyId)
        .where("remainingQuantity", ">", 0)
        // adjustment child rows are consumed with their parent, not as layers
        .where("adjustment", "=", false)
        .where("appliesToCostLedgerId", "is", null)
        // only the stripe the quantity leaves from
        .where((eb) =>
          projectId
            ? eb("projectId", "=", projectId)
            : eb("projectId", "is", null)
        )
        // 'Purchase Order' rows are planning/cost-history artifacts, not layers
        .where((eb) =>
          eb.or([
            eb("documentType", "is", null),
            eb("documentType", "!=", "Purchase Order")
          ])
        )
        .orderBy("postingDate", orderDirection)
        .orderBy("createdAt", orderDirection)
        // Lock the layers for this transaction — two concurrent consumers
        // would otherwise both read the same remainingQuantity and consume
        // the layer twice (lost update).
        .forUpdate()
        .execute();
      const layers = orderLayersForConsumption(orderedLayers, trackedEntityIds);

      let remainingToConsume = quantity;
      let totalCost = 0;
      const layersConsumed: CostLayer[] = [];

      for (const layer of layers) {
        if (remainingToConsume <= 0) break;

        const layerRemaining = Number(layer.remainingQuantity);
        const layerUnitCost =
          Number(layer.quantity) > 0
            ? Number(layer.cost) / Number(layer.quantity)
            : 0;

        const quantityFromLayer = Math.min(remainingToConsume, layerRemaining);
        const costFromLayer = quantityFromLayer * layerUnitCost;

        totalCost += costFromLayer;
        remainingToConsume -= quantityFromLayer;

        layersConsumed.push({
          costLedgerId: layer.id,
          quantityConsumed: quantityFromLayer,
          unitCost: layerUnitCost
        });

        await trx
          .updateTable("costLedger")
          .set({
            remainingQuantity: layerRemaining - quantityFromLayer
          })
          .where("id", "=", layer.id)
          .where("companyId", "=", companyId)
          .execute();

        // Consume the layer's cost-adjustment children (invoice-vs-receipt
        // price corrections) alongside the parent: each adjusted unit carries
        // a per-unit bump of child.cost / child.quantity.
        const children = await trx
          .selectFrom("costLedger")
          .selectAll()
          .where("appliesToCostLedgerId", "=", layer.id)
          .where("companyId", "=", companyId)
          .where("remainingQuantity", ">", 0)
          .orderBy("createdAt", "asc")
          .forUpdate()
          .execute();

        // The children of a layer cover different units of it, in order — so
        // a unit takes the next child's bump. A layer stamped for one serial
        // unit is the exception: every child on it (a moved price variance, a
        // refurbishment revaluation, a write-down) belongs to that one unit,
        // so each applies in full.
        const stamped = layer.trackedEntityId !== null;
        let unappliedQuantity = quantityFromLayer;
        for (const child of children) {
          if (unappliedQuantity <= 0) break;
          const childQty = Number(child.remainingQuantity);
          const perUnitBump =
            Number(child.quantity) > 0
              ? Number(child.cost) / Number(child.quantity)
              : 0;
          const applyQty = Math.min(childQty, unappliedQuantity);
          totalCost += applyQty * perUnitBump;
          if (!stamped) unappliedQuantity -= applyQty;
          await trx
            .updateTable("costLedger")
            .set({ remainingQuantity: childQty - applyQty })
            .where("id", "=", child.id)
            .where("companyId", "=", companyId)
            .execute();
        }
      }

      // Fallback: insufficient layers (negative inventory scenario)
      if (remainingToConsume > 0) {
        const fallbackUnitCost = Number(itemCost.unitCost ?? 0);
        totalCost += remainingToConsume * fallbackUnitCost;
      }

      const effectiveUnitCost = quantity > 0 ? totalCost / quantity : 0;

      return {
        unitCost: effectiveUnitCost,
        totalCost,
        layersConsumed
      };
    }

    default:
      throw new Error(`Unsupported costing method: ${costingMethod}`);
  }
}
