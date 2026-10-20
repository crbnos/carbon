// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Kysely, KyselyDatabase } from "./client.ts";
import { round } from "./precision.ts";

export const PULLED_ITEM_TYPES = ["Material", "Part", "Consumable"] as const;

export type PullFromLine = {
  methodType: string | null;
  itemType: string | null;
  itemTrackingType: string | null;
};

// Purchase to Order, batch and serial lines count: each is consumed from a bin.
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

// The BoM editor writes an empty string when a bin is cleared.
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

// An active work center AND an active storage unit: a location with no storage
// unit has no bin a line could name.
function pullFromLocations(db: Kysely<KyselyDatabase>, companyId: string) {
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
    );
}

export async function getPullFromLocations(
  db: Kysely<KyselyDatabase>,
  companyId: string
): Promise<{ id: string; name: string }[]> {
  return pullFromLocations(db, companyId)
    .select(["location.id", "location.name"])
    .orderBy("location.name")
    .execute();
}

export async function isPullFromLocation(
  db: Kysely<KyselyDatabase>,
  companyId: string,
  locationId: string
): Promise<boolean> {
  const row = await pullFromLocations(db, companyId)
    .where("location.id", "=", locationId)
    .select("location.id")
    .executeTakeFirst();
  return row !== undefined;
}

export type StrictBackflushSettings = {
  strict: boolean;
  preventNegative: boolean;
};

/** With `locationId`, `strict` is false at a location `getPullFromLocations`
 *  leaves out. */
export async function getStrictBackflushSettings(
  db: Kysely<KyselyDatabase>,
  companyId: string,
  locationId?: string | null
): Promise<StrictBackflushSettings> {
  const row = await db
    .selectFrom("companySettings")
    .where("id", "=", companyId)
    .select(["requireBackflushStorageUnit", "preventNegativeBackflush"])
    .executeTakeFirst();
  const strict =
    row?.requireBackflushStorageUnit === true &&
    (!locationId || (await isPullFromLocation(db, companyId, locationId)));
  return {
    strict,
    preventNegative: row?.preventNegativeBackflush !== false
  };
}

export async function getMethodPartsMissingPullFrom(
  db: Kysely<KyselyDatabase>,
  args: { makeMethodId: string; companyId: string }
): Promise<string[]> {
  const { makeMethodId, companyId } = args;

  // Not `inOrder`: this module is bundled for the browser, and `./rows` brings
  // the Kysely runtime.
  const lines = await db
    .selectFrom("methodMaterial")
    .innerJoin("item", "item.id", "methodMaterial.itemId")
    .where("methodMaterial.makeMethodId", "=", makeMethodId)
    .where("methodMaterial.companyId", "=", companyId)
    .where("item.companyId", "=", companyId)
    .select([
      "methodMaterial.methodType",
      "methodMaterial.itemType",
      "methodMaterial.storageUnitIds",
      "methodMaterial.order",
      "item.id as itemId",
      "item.itemTrackingType",
      "item.readableIdWithRevision"
    ])
    .orderBy("methodMaterial.order")
    .execute();
  const locations = await getPullFromLocations(db, companyId);

  const locationIds = locations.map((location) => location.id);
  return [
    ...new Set(
      lines
        .filter(needsPullFrom)
        .filter(
          (line) =>
            missingPullFromLocations(line.storageUnitIds, locationIds).length >
            0
        )
        .map((line) => line.readableIdWithRevision ?? line.itemId)
    )
  ];
}

export function activationRefusalMessage(parts: readonly string[]): string {
  return `Set a Pull From storage unit before you activate this version: ${summarizeList(parts)}`;
}

export type PickLineBins = {
  storageUnitId: string | null;
  toStorageUnitId: string | null;
};

// A pick points the line at lineside, so its Pull From is the source of its
// oldest pick line into that bin (a later list sources from the fullest bin).
// `pickLines` must be oldest first. SQL `backflush_job_materials` matches.
export function pullFromStorageUnit(
  storageUnitId: string | null,
  pickLines: readonly PickLineBins[]
): string | null {
  if (!storageUnitId) return null;
  const pick = pickLines.find(
    (line) =>
      line.toStorageUnitId === storageUnitId &&
      line.storageUnitId !== null &&
      line.storageUnitId !== storageUnitId
  );
  return pick?.storageUnitId ?? storageUnitId;
}

// SQL `backflush_job_materials` builds the same key.
export function strictBackflushLockKey(
  companyId: string,
  storageUnitId: string,
  itemId: string
): string {
  return `strict-backflush:${companyId}:${storageUnitId}:${itemId}`;
}

export const MESSAGE_LIST_LIMIT = 5;

export function summarizeList(
  entries: readonly string[],
  limit: number = MESSAGE_LIST_LIMIT
): string {
  if (entries.length <= limit) return entries.join("; ");
  return `${entries.slice(0, limit).join("; ")}; and ${entries.length - limit} more`;
}

// `alreadyDrawn`: what earlier, unwritten rows of this backflush take from the bin.
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
