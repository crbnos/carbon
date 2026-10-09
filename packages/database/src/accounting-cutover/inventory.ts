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
import { EPSILON, round } from "../precision";
import type { Database } from "../types";
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

/** A cutover inventory item with its type, for a link, and its opening value. */
export type CutoverInventoryValuedItem = CutoverInventoryItem & {
  type: ItemType;
  /** `cutoverInventoryValue`: what the opening journal debits for the item. */
  value: number;
};

/** The opening value of the items that land on one inventory account. */
export type CutoverInventoryAccountValue = { accountId: string; value: number };

type ItemType = Database["public"]["Enums"]["itemType"];

/** A row of the cutover inventory query: the item and its type. */
type CutoverInventoryRow = CutoverInventoryItem & { type: ItemType };

/**
 * The value the opening journal gives an item: on-hand × unit cost, rounded
 * once. An item with no stock on hand opens with no value.
 */
export function cutoverInventoryValue(
  item: Pick<CutoverInventoryItem, "quantity" | "unitCost">
): number {
  return item.quantity > EPSILON ? round(item.quantity * item.unitCost) : 0;
}

/**
 * The opening inventory value per inventory account, in the order the items
 * first name each account. Each item is valued by `cutoverInventoryValue` and
 * each account's sum is rounded once. An account with no value is left out.
 */
export function inventoryValueByAccount(
  items: CutoverInventoryItem[]
): CutoverInventoryAccountValue[] {
  const byAccount = new Map<string, number>();
  for (const item of items) {
    const value = cutoverInventoryValue(item);
    if (value === 0) continue;
    byAccount.set(
      item.inventoryAccountId,
      (byAccount.get(item.inventoryAccountId) ?? 0) + value
    );
  }
  return [...byAccount].map(([accountId, value]) => ({
    accountId,
    value: round(value)
  }));
}

/**
 * What the enable wizard's inventory step shows: every item with its value,
 * the value per inventory account, and the total. Read by the same query as
 * `getCutoverInventory`, and valued as the opening journal values it.
 */
export async function getCutoverInventoryValuation(
  db: CutoverDb,
  args: CutoverArgs
): Promise<{
  items: CutoverInventoryValuedItem[];
  accounts: CutoverInventoryAccountValue[];
  total: number;
}> {
  const rows = await inventoryRowsFor(db, {
    ...args,
    defaults: await getAccountDefaults(db, args.companyId)
  });
  const accounts = inventoryValueByAccount(rows);
  return {
    items: rows.map((row) => ({ ...row, value: cutoverInventoryValue(row) })),
    accounts,
    total: round(accounts.reduce((sum, account) => sum + account.value, 0))
  };
}

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
  args: CutoverArgs & { defaults: AccountDefaults }
): Promise<CutoverInventoryItem[]> {
  const rows = await inventoryRowsFor(db, args);
  return rows.map(({ type: _type, ...item }) => item);
}

async function inventoryRowsFor(
  db: CutoverDb,
  {
    companyId,
    cutoverDate,
    defaults
  }: CutoverArgs & { defaults: AccountDefaults }
): Promise<CutoverInventoryRow[]> {
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
        "item.type",
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
        "item.type",
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
      type: row.type,
      quantity: round(quantity),
      unitCost,
      costingMethod,
      inventoryAccountId: isMade
        ? defaults.finishedGoodsAccount
        : defaults.rawMaterialsAccount
    };
  });
}
