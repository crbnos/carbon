// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The reads a refurbishment completion plans from. The server function runs
// them under row locks before it writes; the ERP preview runs them without
// locks and writes nothing, so both plan from the same inputs.

import type { Database } from "@carbon/database";
import type { KyselyDatabase as DB } from "@carbon/database/client";
import { round } from "@carbon/utils";
import { type Kysely, sql, type Transaction } from "kysely";
import type {
  RefurbishmentChild,
  RefurbishmentCompletionInput,
  RefurbishmentLayer
} from "./refurbishment-completion-plan";

type Handle = Kysely<DB> | Transaction<DB>;

export type RefurbishmentOrder = {
  id: string;
  serviceOrderId: string;
  status: Database["public"]["Enums"]["serviceOrderStatus"];
  projectId: string;
  trackedEntityId: string;
  itemId: string;
  expectedSellingPrice: number | null;
  abnormalRework: boolean;
};

/** One element's share of the order's Capitalized charges (WIP). */
export type RefurbishmentWipByElement = {
  projectElementId: string | null;
  amount: number;
};

export type RefurbishmentCompletionContext = {
  input: RefurbishmentCompletionInput;
  wipByElement: RefurbishmentWipByElement[];
  item: {
    replenishmentSystem:
      | Database["public"]["Enums"]["itemReplenishmentSystem"]
      | null;
    unitOfMeasureCode: string | null;
  };
  /** Full rows of the open layers and children, for the writes. */
  layerRows: Map<string, Database["public"]["Tables"]["costLedger"]["Row"]>;
  childRows: Map<string, Database["public"]["Tables"]["costLedger"]["Row"]>;
  /** Why the cap is skipped, beyond "no sale price". */
  warnings: string[];
};

// A fixed-width UTC timestamp: sorts as text in calculateCOGS order.
const createdAtText = sql<string>`to_char("createdAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US')`;

/**
 * Loads what `planRefurbishmentCompletion` needs for one order: the WIP
 * total (Σ of the order's Capitalized ledger rows, by element), the item's
 * costing method and unit cost, its open layers as calculateCOGS selects them
 * and their open children, the on-hand quantity (Average) and the sale price
 * cap (decision C4). With `lock`, the layers and children are locked
 * `FOR UPDATE`, as calculateCOGS locks them.
 */
export async function loadRefurbishmentCompletion(
  db: Handle,
  args: { companyId: string; order: RefurbishmentOrder; lock: boolean }
): Promise<RefurbishmentCompletionContext> {
  const { companyId, order, lock } = args;
  const warnings: string[] = [];

  const wip = await db
    .selectFrom("projectLedger")
    .select(({ fn }) => [
      "projectElementId",
      fn.sum<number>("amount").as("amount")
    ])
    .where("projectId", "=", order.projectId)
    .where("companyId", "=", companyId)
    .where("coverage", "=", "Capitalized")
    .groupBy("projectElementId")
    .orderBy("projectElementId")
    .execute();
  const wipByElement = wip
    .map((row) => ({
      projectElementId: row.projectElementId,
      amount: round(Number(row.amount ?? 0))
    }))
    .filter((row) => row.amount !== 0);
  const wipTotal = round(
    wipByElement.reduce((sum, row) => sum + row.amount, 0)
  );

  const item = await db
    .selectFrom("item")
    .leftJoin("itemCost", (join) =>
      join
        .onRef("itemCost.itemId", "=", "item.id")
        .onRef("itemCost.companyId", "=", "item.companyId")
    )
    .innerJoin("company", "company.id", "item.companyId")
    .select([
      "item.replenishmentSystem",
      "item.unitOfMeasureCode",
      "itemCost.costingMethod",
      "itemCost.unitCost",
      "company.baseCurrencyCode"
    ])
    .where("item.id", "=", order.itemId)
    .where("item.companyId", "=", companyId)
    .executeTakeFirst();
  if (!item?.costingMethod) {
    throw new Error(`The item of ${order.serviceOrderId} has no item cost`);
  }

  let layersQuery = db
    .selectFrom("costLedger")
    .selectAll()
    .select(createdAtText.as("createdAtText"))
    .where("itemId", "=", order.itemId)
    .where("companyId", "=", companyId)
    .where("remainingQuantity", ">", 0)
    .where("adjustment", "=", false)
    .where("appliesToCostLedgerId", "is", null)
    .where((eb) =>
      eb.or([
        eb("documentType", "is", null),
        eb("documentType", "!=", "Purchase Order")
      ])
    );
  if (lock) layersQuery = layersQuery.forUpdate();
  const layers = await layersQuery.execute();

  let childrenQuery = db
    .selectFrom("costLedger")
    .selectAll()
    .select(createdAtText.as("createdAtText"))
    .where("companyId", "=", companyId)
    .where("remainingQuantity", ">", 0)
    .where("appliesToCostLedgerId", "in", (eb) =>
      eb
        .selectFrom("costLedger")
        .select("id")
        .where("itemId", "=", order.itemId)
        .where("companyId", "=", companyId)
        .where("remainingQuantity", ">", 0)
        .where("adjustment", "=", false)
        .where("appliesToCostLedgerId", "is", null)
    );
  if (lock) childrenQuery = childrenQuery.forUpdate();
  const children = await childrenQuery.execute();

  let onHandQuantity = 0;
  if (item.costingMethod === "Average") {
    const onHand = await db
      .selectFrom("itemLedger")
      .select(({ fn }) => fn.sum<number>("quantity").as("quantity"))
      .where("itemId", "=", order.itemId)
      .where("companyId", "=", companyId)
      .executeTakeFirst();
    onHandQuantity = Number(onHand?.quantity ?? 0);
  }

  // C4: the order's expected selling price, else the item's sale price when it
  // is per the inventory unit (and in the base currency). Carbon has no sales
  // unit conversion, so a price per box must not cap a cost per each.
  let cap: number | null =
    order.expectedSellingPrice === null
      ? null
      : Number(order.expectedSellingPrice);
  if (cap === null) {
    const price = await db
      .selectFrom("itemUnitSalePrice")
      .select(["unitSalePrice", "salesUnitOfMeasureCode", "currencyCode"])
      .where("itemId", "=", order.itemId)
      .where("companyId", "=", companyId)
      .orderBy("createdAt")
      .limit(1)
      .executeTakeFirst();
    const unitSalePrice =
      price?.unitSalePrice === null || price?.unitSalePrice === undefined
        ? null
        : Number(price.unitSalePrice);
    if (price && unitSalePrice !== null && unitSalePrice > 0) {
      const unitMatches =
        !price.salesUnitOfMeasureCode ||
        price.salesUnitOfMeasureCode === item.unitOfMeasureCode;
      const currencyMatches =
        !price.currencyCode || price.currencyCode === item.baseCurrencyCode;
      if (!unitMatches) {
        warnings.push(
          `The sale price is per ${price.salesUnitOfMeasureCode}, not per ${item.unitOfMeasureCode}; the cost was not capped`
        );
      } else if (!currencyMatches) {
        warnings.push(
          `The sale price is in ${price.currencyCode}, not ${item.baseCurrencyCode}; the cost was not capped`
        );
      } else {
        cap = unitSalePrice;
      }
    }
  }

  const toLayer = (row: (typeof layers)[number]): RefurbishmentLayer => ({
    id: row.id,
    quantity: Number(row.quantity),
    remainingQuantity: Number(row.remainingQuantity),
    cost: Number(row.cost),
    trackedEntityId: row.trackedEntityId,
    postingDate: row.postingDate,
    createdAt: row.createdAtText
  });
  const toChild = (row: (typeof children)[number]): RefurbishmentChild => ({
    id: row.id,
    appliesToCostLedgerId: row.appliesToCostLedgerId as string,
    quantity: Number(row.quantity),
    remainingQuantity: Number(row.remainingQuantity),
    cost: Number(row.cost),
    createdAt: row.createdAtText
  });

  return {
    input: {
      costingMethod: item.costingMethod,
      wipTotal,
      serialId: order.trackedEntityId,
      openLayers: layers.map(toLayer),
      openChildren: children.map(toChild),
      onHandQuantity,
      currentUnitCost: Number(item.unitCost ?? 0),
      cap,
      abnormalRework: order.abnormalRework
    },
    wipByElement,
    item: {
      replenishmentSystem: item.replenishmentSystem,
      unitOfMeasureCode: item.unitOfMeasureCode
    },
    layerRows: new Map(
      layers.map(({ createdAtText: _, ...row }) => [row.id, row])
    ),
    childRows: new Map(
      children.map(({ createdAtText: _, ...row }) => [row.id, row])
    ),
    warnings
  };
}
