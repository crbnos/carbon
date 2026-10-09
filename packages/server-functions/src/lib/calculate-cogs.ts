// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { KyselyDatabase as DB } from "@carbon/database/client";
import { isCostLayer, relieveLayers } from "@carbon/database/cost-relief";
import { sql, type Transaction } from "kysely";

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
    trackedEntityIds
  }: {
    itemId: string;
    quantity: number;
    companyId: string;
    // The serial units leaving, when the caller knows them: each is relieved
    // from the layer booked for it (specific identification) before the
    // FIFO / LIFO layers (`orderLayersForConsumption`).
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
      // The item's open layers, oldest first, and their open adjustment
      // children. Locked for this transaction: two concurrent consumers
      // would otherwise both read the same remainingQuantity and consume the
      // layer twice (lost update).
      const openLayers = trx
        .selectFrom("costLedger")
        .where("itemId", "=", itemId)
        .where("companyId", "=", companyId)
        .where("remainingQuantity", ">", 0)
        .where(isCostLayer);
      const layers = await openLayers
        .select([
          "id",
          "quantity",
          "cost",
          "remainingQuantity",
          "trackedEntityId"
        ])
        .orderBy("postingDate", "asc")
        .orderBy("createdAt", "asc")
        .forUpdate()
        .execute();
      const children = await trx
        .selectFrom("costLedger")
        .select([
          "id",
          "appliesToCostLedgerId",
          "quantity",
          "cost",
          "remainingQuantity"
        ])
        .where("companyId", "=", companyId)
        .where("appliesToCostLedgerId", "in", openLayers.select("id"))
        .where("remainingQuantity", ">", 0)
        .orderBy("createdAt", "asc")
        .forUpdate()
        .execute();
      const childrenByLayer = Map.groupBy(
        children,
        (child) => child.appliesToCostLedgerId
      );

      const relief = relieveLayers(
        layers.map((layer) => ({
          id: layer.id,
          quantity: Number(layer.quantity),
          cost: Number(layer.cost),
          remainingQuantity: Number(layer.remainingQuantity),
          trackedEntityId: layer.trackedEntityId,
          children: (childrenByLayer.get(layer.id) ?? []).map((child) => ({
            id: child.id,
            quantity: Number(child.quantity),
            cost: Number(child.cost),
            remainingQuantity: Number(child.remainingQuantity)
          }))
        })),
        costingMethod,
        { quantity, trackedEntityIds: trackedEntityIds ?? [] },
        // Negative inventory: a quantity no layer covers.
        Number(itemCost.unitCost ?? 0)
      );

      if (relief.remaining.size > 0) {
        await sql`
          UPDATE "costLedger" AS c
          SET "remainingQuantity" = v."remaining"
          FROM (VALUES ${sql.join(
            [...relief.remaining].map(
              ([id, remaining]) => sql`(${id}, ${remaining}::numeric)`
            )
          )}) AS v("id", "remaining")
          WHERE c."id" = v."id" AND c."companyId" = ${companyId}
        `.execute(trx);
      }

      return {
        unitCost: quantity > 0 ? relief.totalCost / quantity : 0,
        totalCost: relief.totalCost,
        layersConsumed: relief.layersConsumed.map((layer) => ({
          costLedgerId: layer.layerId,
          quantityConsumed: layer.quantity,
          unitCost: layer.unitCost
        }))
      };
    }

    default:
      throw new Error(`Unsupported costing method: ${costingMethod}`);
  }
}
