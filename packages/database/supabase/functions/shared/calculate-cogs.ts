import { Transaction } from "kysely";
import { DB } from "../lib/database.ts";

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
  }: {
    itemId: string;
    quantity: number;
    companyId: string;
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
        layersConsumed: [],
      };
    }

    case "Average": {
      const unitCost = Number(itemCost.unitCost ?? 0);
      return {
        unitCost,
        totalCost: unitCost * quantity,
        layersConsumed: [],
      };
    }

    case "FIFO":
    case "LIFO": {
      const orderDirection = costingMethod === "FIFO" ? "asc" : "desc";

      const layers = await trx
        .selectFrom("costLedger")
        .selectAll()
        .where("itemId", "=", itemId)
        .where("companyId", "=", companyId)
        .where("remainingQuantity", ">", 0)
        // adjustment child rows are consumed with their parent, not as layers
        .where("adjustment", "=", false)
        .where("appliesToCostLedgerId", "is", null)
        // 'Purchase Order' rows are planning/cost-history artifacts, not layers
        .where((eb) =>
          eb.or([
            eb("documentType", "is", null),
            eb("documentType", "!=", "Purchase Order"),
          ])
        )
        .orderBy("postingDate", orderDirection)
        .orderBy("createdAt", orderDirection)
        // Lock the layers for this transaction — two concurrent consumers
        // would otherwise both read the same remainingQuantity and consume
        // the layer twice (lost update).
        .forUpdate()
        .execute();

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
          unitCost: layerUnitCost,
        });

        await trx
          .updateTable("costLedger")
          .set({
            remainingQuantity: layerRemaining - quantityFromLayer,
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
          unappliedQuantity -= applyQty;
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
        layersConsumed,
      };
    }

    default:
      throw new Error(`Unsupported costing method: ${costingMethod}`);
  }
}
