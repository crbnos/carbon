// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// What each serial unit of an item on hand would leave stock at right now —
// the cost a shipment, a scrap or a capitalization would relieve for it — so
// the inventory page can show it per serial number. Read-only: the layers are
// valued with `serialUnitCost`, the same arithmetic calculateCOGS runs, from
// one read of the item's open layers.

import type { Database } from "@carbon/database";
import { inOrder } from "@carbon/database/rows";
import { round } from "@carbon/utils";
import { sql } from "kysely";
import { z } from "zod";
import { defineServerFn } from "../define-server-fn";
import { NotFoundError } from "../errors";
import { serialUnitCost, type UnitCostChild } from "../lib/serial-unit-cost";

export const previewSerialUnitCostsInput = z.object({
  itemId: z.string().min(1),
  // Only the units on hand at this location; every location when absent.
  locationId: z.string().optional().nullable()
});

export type SerialUnitCosts = {
  costs: Record<string, number>;
  // Only a FIFO / LIFO item's unit can be recosted on its own.
  costingMethod: Database["public"]["Enums"]["itemCostingMethod"] | null;
};

const previewSerialUnitCosts = defineServerFn({
  name: "preview-serial-unit-costs",
  input: previewSerialUnitCostsInput,
  // Inventory value is accounting data: the valuation report and the
  // capitalization preview take the same permission.
  permissions: { view: "accounting" },
  async run(
    { db, companyId },
    { itemId, locationId }
  ): Promise<SerialUnitCosts> {
    const item = await db
      .selectFrom("item")
      .select("itemTrackingType")
      .where("id", "=", itemId)
      .where("companyId", "=", companyId)
      .executeTakeFirst();
    if (!item) throw new NotFoundError("Item not found");
    if (item.itemTrackingType !== "Serial") {
      return { costs: {}, costingMethod: null };
    }

    let onHandQuery = db
      .selectFrom("itemLedger")
      .select("trackedEntityId")
      .where("itemId", "=", itemId)
      .where("companyId", "=", companyId)
      .where("trackedEntityId", "is not", null)
      .groupBy("trackedEntityId")
      .having(sql<number>`SUM("quantity")`, ">", 0);
    if (locationId)
      onHandQuery = onHandQuery.where("locationId", "=", locationId);

    const [onHand, itemCost] = await inOrder([
      () => onHandQuery.execute(),
      () =>
        db
          .selectFrom("itemCost")
          .select(["costingMethod", "unitCost", "standardCost"])
          .where("itemId", "=", itemId)
          .where("companyId", "=", companyId)
          .executeTakeFirst()
    ]);
    if (!itemCost) throw new NotFoundError("Item cost not found");
    const units = onHand.flatMap((row) =>
      row.trackedEntityId ? [row.trackedEntityId] : []
    );
    if (units.length === 0) {
      return { costs: {}, costingMethod: itemCost.costingMethod };
    }

    const isLayered =
      itemCost.costingMethod === "FIFO" || itemCost.costingMethod === "LIFO";
    const direction = itemCost.costingMethod === "LIFO" ? "desc" : "asc";
    // The layers calculateCOGS would consume from, in its order.
    const layers = isLayered
      ? await db
          .selectFrom("costLedger")
          .select([
            "id",
            "trackedEntityId",
            "quantity",
            "cost",
            "remainingQuantity"
          ])
          .where("itemId", "=", itemId)
          .where("companyId", "=", companyId)
          .where("remainingQuantity", ">", 0)
          .where("adjustment", "=", false)
          .where("appliesToCostLedgerId", "is", null)
          .where((eb) =>
            eb.or([
              eb("documentType", "is", null),
              eb("documentType", "!=", "Purchase Order")
            ])
          )
          .orderBy("postingDate", direction)
          .orderBy("createdAt", direction)
          .execute()
      : [];

    const childrenByLayer = new Map<string, UnitCostChild[]>();
    if (layers.length > 0) {
      const children = await db
        .selectFrom("costLedger")
        .select([
          "appliesToCostLedgerId",
          "quantity",
          "cost",
          "remainingQuantity"
        ])
        .where(
          "appliesToCostLedgerId",
          "in",
          layers.map((layer) => layer.id)
        )
        .where("companyId", "=", companyId)
        .where("remainingQuantity", ">", 0)
        .orderBy("createdAt", "asc")
        .execute();
      for (const child of children) {
        if (!child.appliesToCostLedgerId) continue;
        const list = childrenByLayer.get(child.appliesToCostLedgerId) ?? [];
        list.push({
          quantity: Number(child.quantity),
          cost: Number(child.cost),
          remainingQuantity: Number(child.remainingQuantity)
        });
        childrenByLayer.set(child.appliesToCostLedgerId, list);
      }
    }

    const basis = {
      costingMethod: itemCost.costingMethod,
      unitCost: itemCost.unitCost == null ? null : Number(itemCost.unitCost),
      standardCost:
        itemCost.standardCost == null ? null : Number(itemCost.standardCost)
    };
    const valuedLayers = layers.map((layer) => ({
      id: layer.id,
      trackedEntityId: layer.trackedEntityId,
      quantity: Number(layer.quantity),
      cost: Number(layer.cost),
      remainingQuantity: Number(layer.remainingQuantity)
    }));

    const costs: Record<string, number> = {};
    for (const trackedEntityId of units) {
      costs[trackedEntityId] = round(
        serialUnitCost({
          itemCost: basis,
          layers: valuedLayers,
          childrenByLayer,
          trackedEntityId
        })
      );
    }
    return { costs, costingMethod: itemCost.costingMethod };
  }
});

export default previewSerialUnitCosts;
