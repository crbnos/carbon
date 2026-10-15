// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Strict backflush (companySettings.requireBackflushStorageUnit,
// .ai/specs/2026-10-14-strict-backflush.md). One rule for "which material
// lines must name a Pull From storage unit", read by method activation
// (`convert`), job release and the Settings → Items card, so the three can
// never disagree about which lines count.

import type { Kysely, KyselyDatabase } from "./client.ts";
import { round } from "./precision.ts";

// The item types a backflush consumes (`issueJobOperationMaterials`, SQL
// `backflush_job_materials`). Tools and services are never consumed.
export const PULLED_ITEM_TYPES = ["Material", "Part", "Consumable"] as const;

export type PullFromLine = {
  methodType: string | null;
  itemType: string | null;
  itemTrackingType: string | null;
};

// A line is pulled from a bin when it is not built in the job (Make to Order)
// and its item holds stock. Purchase to Order lines count: the goods are
// received into a bin and backflushed from it. Batch and serial lines count
// too — the operator scans the unit, but planning and picking still read the
// line's bin.
export function needsPullFrom(line: PullFromLine): boolean {
  if (line.methodType === "Make to Order") return false;
  if (
    !PULLED_ITEM_TYPES.includes(
      line.itemType as (typeof PULLED_ITEM_TYPES)[number]
    )
  )
    return false;
  return line.itemTrackingType !== "Non-Inventory";
}

// `methodMaterial.storageUnitIds` maps locationId → storageUnitId. An empty
// string is what the BoM editor writes when a bin is cleared, so it counts as
// missing.
export function missingPullFromLocations(
  storageUnitIds: unknown,
  locationIds: readonly string[]
): string[] {
  const map =
    storageUnitIds && typeof storageUnitIds === "object"
      ? (storageUnitIds as Record<string, unknown>)
      : {};
  return locationIds.filter((locationId) => {
    const storageUnitId = map[locationId];
    return typeof storageUnitId !== "string" || storageUnitId.length === 0;
  });
}

// The locations a pulled line needs a Pull From at: each one with an active
// work center AND an active storage unit. A location with no work center
// builds nothing; one with no storage unit has no bin a line could name (a
// test lab at head office), so requiring one there would block activation
// for good.
export async function getPullFromLocations(
  db: Kysely<KyselyDatabase>,
  companyId: string
): Promise<{ id: string; name: string }[]> {
  return db
    .selectFrom("location")
    .where("location.companyId", "=", companyId)
    .where((eb) =>
      eb.exists(
        eb
          .selectFrom("workCenter")
          .whereRef("workCenter.locationId", "=", "location.id")
          .where("workCenter.companyId", "=", companyId)
          .where("workCenter.active", "=", true)
          .select("workCenter.id")
      )
    )
    .where((eb) =>
      eb.exists(
        eb
          .selectFrom("storageUnit")
          .whereRef("storageUnit.locationId", "=", "location.id")
          .where("storageUnit.companyId", "=", companyId)
          .where("storageUnit.active", "=", true)
          .select("storageUnit.id")
      )
    )
    .select(["location.id", "location.name"])
    .orderBy("location.name")
    .execute();
}

// A refusal is shown as a toast, so it names only the first `limit` entries and
// counts the rest. A 20-line BoM otherwise produced a 900-character toast that
// ran off the screen and faded before it could be read.
export const MESSAGE_LIST_LIMIT = 5;

export function summarizeList(
  entries: readonly string[],
  limit: number = MESSAGE_LIST_LIMIT
): string {
  if (entries.length <= limit) return entries.join("; ");
  return `${entries.slice(0, limit).join("; ")}; and ${entries.length - limit} more`;
}

// What the bin cannot cover. `alreadyDrawn` is what earlier rows of the same
// backflush take from this bin before they are written, so two materials of
// one operation sharing a bin cannot both count the same stock.
export function binShortfall({
  onHand,
  alreadyDrawn,
  quantity
}: {
  onHand: number;
  alreadyDrawn: number;
  quantity: number;
}): number {
  const available = Math.max(onHand - alreadyDrawn, 0);
  const shortfall = round(quantity - available);
  return shortfall > 0 ? shortfall : 0;
}
