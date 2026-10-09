// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Database } from "@carbon/database";
import { EPSILON } from "@carbon/utils";
import { z } from "zod";

/**
 * Input contract and pure helpers for `post-asset-transfer`. No I/O and no
 * imports beyond zod, the generated types and `@carbon/utils`, so the server function's own
 * logic can be pinned without a database.
 */

// Calendar dates travel as `YYYY-MM-DD` text end to end: the transfer, the
// journal and the ledger rows all store DATE columns, and a JavaScript Date
// would shift the day by the runtime timezone.
const calendarDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected a YYYY-MM-DD date");

/** Consume an Available serialized unit from stock into a fixed asset. */
export const capitalizeValidator = z.object({
  type: z.literal("capitalize"),
  fixedAssetClassId: z.string().min(1),
  itemId: z.string().min(1),
  trackedEntityId: z.string().min(1),
  locationId: z.string().min(1),
  storageUnitId: z.string().optional().nullable(),
  transferDate: calendarDate,
  name: z.string().optional().nullable(),
  // An existing Draft asset to fill; otherwise the function creates one.
  fixedAssetId: z.string().optional().nullable(),
  // What the unit cost to make, for a unit inventory carries at nothing (a job
  // that recorded no production or material, a no-cost issue). Refused for a
  // unit that carries a cost: that value moves from inventory as it is.
  cost: z.number().positive().optional().nullable(),
  // The other side of an entered cost: where that value was booked when it
  // was spent. Required with `cost`.
  offsetAccountId: z.string().optional().nullable()
});

/** Return an asset to stock at its net book value. */
export const returnValidator = z.object({
  type: z.literal("return"),
  fixedAssetId: z.string().min(1),
  locationId: z.string().min(1),
  storageUnitId: z.string().optional().nullable(),
  transferDate: calendarDate
});

/** Point a job at a Construction in Progress asset and sweep its WIP to it. */
export const attachJobValidator = z.object({
  type: z.literal("attachJob"),
  fixedAssetId: z.string().min(1),
  jobId: z.string().min(1)
});

/** Move a Construction in Progress asset into its in-service class. */
export const capitalizeCipValidator = z.object({
  type: z.literal("capitalizeCip"),
  fixedAssetId: z.string().min(1),
  toClassId: z.string().min(1),
  inServiceDate: calendarDate
});

/**
 * Raise an asset's cost after it was capitalized (post-capitalization): Dr the
 * class asset account / Cr `offsetAccountId`. Raise only — lowering a cost is
 * a write-down.
 */
export const adjustCostValidator = z.object({
  type: z.literal("adjustCost"),
  fixedAssetId: z.string().min(1),
  amount: z.number().positive(),
  offsetAccountId: z.string().optional().nullable(),
  locationId: z.string().min(1),
  transferDate: calendarDate
});

export const postAssetTransferInput = z.discriminatedUnion("type", [
  capitalizeValidator,
  returnValidator,
  attachJobValidator,
  capitalizeCipValidator,
  adjustCostValidator
]);

export type AssetTransferInput = z.output<typeof postAssetTransferInput>;

/** One `itemLedger` net per storage unit for a tracked entity at a location. */
export type StockByBin = {
  storageUnitId: string | null;
  onHand: number | string | null;
};

/**
 * Where a serialized unit's stock is, from its ledger nets per bin. `onHand` is
 * the unit's total at the location; `storageUnitId` is the bin with the
 * highest positive net — a picked or transferred unit has rows in more than
 * one bin, so "the first row's bin" would book the consumption against a bin
 * that no longer holds it (see `.ai/lessons.md`, tracked-entity bin resolution).
 * Falls back to `preferredStorageUnitId` only when no bin nets positive.
 */
export function resolveCapitalizationStock(
  rows: StockByBin[],
  preferredStorageUnitId: string | null = null
): { onHand: number; storageUnitId: string | null } {
  let onHand = 0;
  let bestBin: string | null = null;
  let bestQuantity = 0;
  for (const row of rows) {
    const quantity = Number(row.onHand ?? 0);
    onHand += quantity;
    if (row.storageUnitId && quantity > bestQuantity) {
      bestQuantity = quantity;
      bestBin = row.storageUnitId;
    }
  }
  return { onHand, storageUnitId: bestBin ?? preferredStorageUnitId };
}

/** Job statuses that can no longer take on a Construction in Progress asset. */
export const CLOSED_JOB_STATUSES: ReadonlySet<
  Database["public"]["Enums"]["jobStatus"]
> = new Set(["Completed", "Cancelled", "Closed"] as const);

/** Asset statuses a unit can be returned to inventory from. */
export const RETURNABLE_ASSET_STATUSES: ReadonlySet<
  Database["public"]["Enums"]["fixedAssetStatus"]
> = new Set(["Active", "Fully Depreciated"] as const);

/** Asset statuses whose cost can be adjusted. */
export const ADJUSTABLE_ASSET_STATUSES: ReadonlySet<
  Database["public"]["Enums"]["fixedAssetStatus"]
> = new Set(["Active", "Fully Depreciated"] as const);

/**
 * The cost a unit is capitalized at: what inventory carries it at, or — only
 * when that is nothing — the cost the user entered. Returns the refusal
 * message instead when neither gives the asset a value, or when a cost is
 * entered for a unit that already carries one.
 */
export function resolveCapitalizationCost(args: {
  carried: number;
  entered: number | null | undefined;
  serial: string;
  itemReadableId: string;
}): { cost: number; source: "inventory" | "entered" } | { error: string } {
  const { carried, entered, serial, itemReadableId } = args;
  if (carried > 0) {
    if (entered != null) {
      return {
        error: `${serial} is carried in inventory at a cost, so it is capitalized at that cost; clear the entered cost`
      };
    }
    return { cost: carried, source: "inventory" };
  }
  if (entered != null && entered > 0) {
    return { cost: entered, source: "entered" };
  }
  return {
    error: `${serial} has no cost in inventory, so the asset would be worth nothing. Enter what it cost, or set a unit cost on ${itemReadableId}, then capitalize it.`
  };
}

/**
 * An asset's status once its cost is raised: a Fully Depreciated asset whose
 * net book value is above its residual again has depreciation left to take,
 * so it returns to Active and the depreciation runs pick it up.
 */
export function statusAfterCostAdjustment(args: {
  status: Database["public"]["Enums"]["fixedAssetStatus"];
  acquisitionCost: number;
  accumulatedDepreciation: number;
  residualValuePercent: number;
}): Database["public"]["Enums"]["fixedAssetStatus"] {
  if (args.status !== "Fully Depreciated") return args.status;
  const residual = args.acquisitionCost * (args.residualValuePercent / 100);
  const remaining = args.acquisitionCost - args.accumulatedDepreciation;
  return remaining - residual > EPSILON ? "Active" : args.status;
}
