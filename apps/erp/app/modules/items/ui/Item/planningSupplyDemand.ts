// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { PlannedOrder } from "../../../purchasing/purchasing.models";

/**
 * An order the planning chart draws: purchasing's `PlannedOrder` or
 * production's `ProductionOrder`. Each carries its own document's status enum
 * (purchase order / job), so the chart reads the status as text.
 */
export type ChartPlannedOrder = Omit<PlannedOrder, "existingStatus"> & {
  existingStatus?: string;
};

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

export function existingRowId(order: ChartPlannedOrder) {
  return order.existingLineId ?? order.existingId;
}

export type SupplySourceType = (typeof supplySourceTypes)[number];

export type ChartPeriod = { id: string; startDate: string; endDate: string };

export type BucketedSupply = {
  periodId: string;
  sourceType: SupplySourceType;
  actualQuantity: number;
};

/**
 * Open supply lines bucketed into the chart's weeks the way MRP buckets them
 * (`findPeriod` in `runMrp`): a line due before today lands in the first
 * week, one due past the last week is dropped. Summed per (week, source).
 */
export function bucketSupplyByPeriod(
  periods: ChartPeriod[],
  today: string,
  lines: { sourceType: SupplySourceType; quantity: number; dueDate: string }[]
): BucketedSupply[] {
  const first = periods[0];
  if (!first) return [];
  const byKey = new Map<string, BucketedSupply>();
  for (const line of lines) {
    if (!(line.quantity > 0)) continue;
    const period =
      line.dueDate < today
        ? first
        : periods.find(
            (p) => p.startDate <= line.dueDate && line.dueDate <= p.endDate
          );
    if (!period) continue;
    const key = `${period.id}\x1f${line.sourceType}`;
    const bucket = byKey.get(key) ?? {
      periodId: period.id,
      sourceType: line.sourceType,
      actualQuantity: 0
    };
    bucket.actualQuantity += line.quantity;
    byKey.set(key, bucket);
  }
  return [...byKey.values()];
}

/** The chart series a legend click can hide that move the projection. */
export type ProjectionSeries =
  | "supply"
  | "planned"
  | "demand"
  | "demandForecast";

export type ProjectionPoint = {
  "Purchase Order": number;
  "Production Order": number;
  Planned: number;
  /** Demand is stored negative. */
  "Sales Order": number;
  "Job Material": number;
  "Demand Forecast": number;
};

/**
 * What one week moves the projected on-hand by, counting only the series the
 * legend shows.
 */
export function projectedChange(
  point: ProjectionPoint,
  hidden: { has(series: ProjectionSeries): boolean }
): number {
  const supply = hidden.has("supply")
    ? 0
    : point["Purchase Order"] + point["Production Order"];
  const planned = hidden.has("planned") ? 0 : point.Planned;
  const demand = hidden.has("demand")
    ? 0
    : point["Sales Order"] + point["Job Material"];
  const forecast = hidden.has("demandForecast") ? 0 : point["Demand Forecast"];
  return supply + planned + demand + forecast;
}

export function mergePlannedOrders<T extends SupplyDemandRow>(
  rows: T[],
  plannedOrders: ChartPlannedOrder[],
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
