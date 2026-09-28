import type { PlannedOrder } from "../../../purchasing/purchasing.models";

export const supplySourceTypes = [
  "Purchase Order",
  "Production Order"
] as const;
export const demandSourceTypes = ["Sales Order", "Job Material"] as const;

export type SourceType =
  | (typeof supplySourceTypes)[number]
  | (typeof demandSourceTypes)[number]
  | "Planned"
  | "Demand Forecast";

export type SupplyDemandRow = {
  id: string | null;
  sourceType: SourceType;
  quantity: number;
  dueDate: string | null;
  documentReadableId: string | null;
};

export function existingRowId(order: PlannedOrder) {
  return order.existingLineId ?? order.existingId;
}

export function mergePlannedOrders<T extends SupplyDemandRow>(
  rows: T[],
  plannedOrders: PlannedOrder[],
  conversionFactor: number,
  quantityOnHand: number
) {
  const merged: T[] = rows.map((row) => ({ ...row }));

  for (const order of plannedOrders) {
    const rowId = existingRowId(order);
    if (!rowId) continue;
    const existing = merged.find((row) => row.id === rowId);
    if (existing) existing.quantity = order.quantity ?? 0;
  }

  const newPlanned = plannedOrders
    .filter((order) => {
      const rowId = existingRowId(order);
      if (!rowId) return true;
      return !merged.some((row) => row.id === rowId);
    })
    .map((order) => ({
      ...order,
      id: null,
      sourceType: "Planned" as SourceType,
      quantity: (order.quantity ?? 0) * conversionFactor,
      documentReadableId: "Planned",
      documentId: null,
      plannedOrder: order
    }));

  let projectedQuantity = quantityOnHand;
  return [...merged, ...newPlanned]
    .sort((a, b) => (a.dueDate ?? "").localeCompare(b.dueDate ?? ""))
    .map((item) => {
      if (
        item.sourceType === "Sales Order" ||
        item.sourceType === "Job Material" ||
        item.sourceType === "Demand Forecast"
      ) {
        projectedQuantity -= item.quantity;
      } else {
        projectedQuantity += item.quantity;
      }
      return { ...item, projectedQuantity };
    });
}
