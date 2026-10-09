// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Inventory at the cutover
// (.ai/specs/implemented/2026-10-08-accounting-cutover.md section 3, step 2).

import { sql } from "kysely";
import {
  type LayerBeforeCutover,
  unitCostAtCutover
} from "../accounting-cutover";
import { round } from "../precision";
import {
  type AccountDefaults,
  type CutoverArgs,
  type CutoverDb,
  getAccountDefaults
} from "./shared";

export type CutoverInventoryItem = {
  itemId: string;
  readableId: string;
  name: string;
  /** On-hand at the cutover across every location (`itemLedger`). */
  quantity: number;
  /** The default unit cost the reset uses. */
  unitCost: number;
  costingMethod: string;
  inventoryAccountId: string;
};

/**
 * Per inventory item, the on-hand quantity at the cutover across every
 * location and its default unit cost: the standard cost for a Standard item;
 * for a FIFO or LIFO item, the value of its stock at the cutover replayed
 * from the layers dated before it (`unitCostAtCutover`); for an Average item,
 * `itemCost.unitCost`. The inventory account follows
 * the item's replenishment, as the postings resolve it.
 */
export async function getCutoverInventory(
  db: CutoverDb,
  args: CutoverArgs
): Promise<CutoverInventoryItem[]> {
  return inventoryFor(db, {
    ...args,
    defaults: await getAccountDefaults(db, args.companyId)
  });
}

/** `getCutoverInventory` for account defaults already read. */
export async function inventoryFor(
  db: CutoverDb,
  {
    companyId,
    cutoverDate,
    defaults
  }: CutoverArgs & { defaults: AccountDefaults }
): Promise<CutoverInventoryItem[]> {
  const [onHand, layers] = await Promise.all([
    db
      .selectFrom("itemLedger")
      .innerJoin("item", (join) =>
        join
          .onRef("item.id", "=", "itemLedger.itemId")
          .onRef("item.companyId", "=", "itemLedger.companyId")
      )
      .leftJoin("itemCost", (join) =>
        join
          .onRef("itemCost.itemId", "=", "item.id")
          .onRef("itemCost.companyId", "=", "item.companyId")
      )
      .select([
        "item.id as itemId",
        "item.readableId",
        "item.name",
        "item.replenishmentSystem",
        "itemCost.costingMethod",
        "itemCost.unitCost",
        "itemCost.standardCost",
        sql<number>`sum("itemLedger"."quantity")`.as("quantity")
      ])
      .where("itemLedger.companyId", "=", companyId)
      .where("itemLedger.postingDate", "<", cutoverDate)
      .where("item.itemTrackingType", "!=", "Non-Inventory")
      .groupBy([
        "item.id",
        "item.readableId",
        "item.name",
        "item.replenishmentSystem",
        "itemCost.costingMethod",
        "itemCost.unitCost",
        "itemCost.standardCost"
      ])
      .having(sql`sum("itemLedger"."quantity")`, "<>", 0)
      .orderBy("item.readableId")
      .execute(),
    // Every layer `calculateCOGS` relieves, dated before the cutover, oldest
    // first, with the cost adjustments posted against it before the cutover.
    db
      .selectFrom("costLedger as layer")
      .leftJoin("costLedger as child", (join) =>
        join
          .onRef("child.appliesToCostLedgerId", "=", "layer.id")
          .onRef("child.companyId", "=", "layer.companyId")
          .on("child.postingDate", "<", cutoverDate)
      )
      .select([
        "layer.itemId",
        "layer.quantity",
        sql<number>`"layer"."cost" + coalesce(sum("child"."cost"), 0)`.as(
          "cost"
        )
      ])
      .where("layer.companyId", "=", companyId)
      .where("layer.postingDate", "<", cutoverDate)
      .where("layer.quantity", ">", 0)
      .where("layer.adjustment", "=", false)
      .where("layer.appliesToCostLedgerId", "is", null)
      .where((eb) =>
        eb.or([
          eb("layer.documentType", "is", null),
          eb("layer.documentType", "!=", "Purchase Order")
        ])
      )
      .groupBy([
        "layer.id",
        "layer.itemId",
        "layer.quantity",
        "layer.cost",
        "layer.postingDate",
        "layer.createdAt"
      ])
      .orderBy("layer.postingDate")
      .orderBy("layer.createdAt")
      .execute()
  ]);

  const layersByItem = new Map<string, LayerBeforeCutover[]>();
  for (const layer of layers) {
    if (!layer.itemId) continue;
    const list = layersByItem.get(layer.itemId) ?? [];
    list.push({ quantity: Number(layer.quantity), cost: Number(layer.cost) });
    layersByItem.set(layer.itemId, list);
  }

  return onHand.map((row) => {
    // Every item has an itemCost row (its interceptor writes one); one
    // without has no costing method to value its stock by.
    const costingMethod = row.costingMethod;
    if (costingMethod === null) {
      throw new Error(
        `Item ${row.readableId} has stock at the cutover but no item cost record`
      );
    }
    const quantity = Number(row.quantity);
    const unitCost =
      costingMethod === "Standard"
        ? Number(row.standardCost ?? 0)
        : costingMethod === "FIFO" || costingMethod === "LIFO"
          ? unitCostAtCutover(
              layersByItem.get(row.itemId) ?? [],
              quantity,
              costingMethod,
              Number(row.unitCost ?? 0)
            )
          : Number(row.unitCost ?? 0);
    const isMade =
      row.replenishmentSystem === "Make" ||
      row.replenishmentSystem === "Buy and Make";
    return {
      itemId: row.itemId,
      readableId: row.readableId,
      name: row.name,
      quantity: round(quantity),
      unitCost,
      costingMethod,
      inventoryAccountId: isMade
        ? defaults.finishedGoodsAccount
        : defaults.rawMaterialsAccount
    };
  });
}
