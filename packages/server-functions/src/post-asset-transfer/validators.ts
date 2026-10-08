// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Database } from "@carbon/database";
import { z } from "zod";

/**
 * Input contract and pure helpers for `post-asset-transfer`. No I/O and no
 * imports beyond zod and the generated types, so the server function's own
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
  fixedAssetId: z.string().optional().nullable()
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

export const postAssetTransferInput = z.discriminatedUnion("type", [
  capitalizeValidator,
  returnValidator,
  attachJobValidator,
  capitalizeCipValidator
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
