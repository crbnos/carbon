// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { KyselyDatabase as DB } from "@carbon/database/client";
import {
  datetime,
  resolveTrackedEntityBins,
  type TrackedEntityBin
} from "@carbon/utils";
import type { Kysely, Transaction } from "kysely";

export async function getStorageUnitId(
  trx: Transaction<DB>,
  itemId: string,
  locationId: string,
  storageUnitId?: string
): Promise<string | undefined> {
  if (storageUnitId) return storageUnitId;

  const pickMethod = await trx
    .selectFrom("pickMethod")
    .where("itemId", "=", itemId)
    .where("locationId", "=", locationId)
    .select("defaultStorageUnitId")
    .executeTakeFirst();

  if (pickMethod?.defaultStorageUnitId) return pickMethod.defaultStorageUnitId;

  const storageUnitWithHighestQuantity =
    await getStorageUnitWithHighestQuantity(trx, itemId, locationId);

  return storageUnitWithHighestQuantity ?? undefined;
}

/**
 * Where each tracked entity holds stock, and how much, per location (see
 * `resolveTrackedEntityBins`: `null` is the unassigned bin). The lookup returns
 * `undefined` for an entity with no positive bin at that location.
 */
export async function getTrackedEntityBins(
  db: Kysely<DB>,
  args: { trackedEntityIds: string[]; locationIds: string[]; companyId: string }
): Promise<
  (trackedEntityId: string, locationId: string) => TrackedEntityBin | undefined
> {
  if (args.trackedEntityIds.length === 0 || args.locationIds.length === 0) {
    return () => undefined;
  }

  const rows = await db
    .selectFrom("itemLedger")
    .where("trackedEntityId", "in", args.trackedEntityIds)
    .where("locationId", "in", args.locationIds)
    .where("companyId", "=", args.companyId)
    .select(["trackedEntityId", "locationId", "storageUnitId", "quantity"])
    .execute();

  const binsByLocation = new Map<string, Map<string, TrackedEntityBin>>();
  for (const locationId of args.locationIds) {
    binsByLocation.set(
      locationId,
      resolveTrackedEntityBins(rows.filter((r) => r.locationId === locationId))
    );
  }
  return (trackedEntityId, locationId) =>
    binsByLocation.get(locationId)?.get(trackedEntityId);
}

/** A tracked entity's on-hand in one bin; `null` is the unassigned bin. */
export async function getTrackedEntityOnHandInBin(
  trx: Transaction<DB>,
  args: {
    trackedEntityId: string;
    locationId: string;
    storageUnitId: string | null;
    companyId: string;
  }
): Promise<number> {
  const row = await trx
    .selectFrom("itemLedger")
    .where("trackedEntityId", "=", args.trackedEntityId)
    .where("locationId", "=", args.locationId)
    .where("storageUnitId", "is not distinct from", args.storageUnitId)
    .where("companyId", "=", args.companyId)
    .select((eb) => eb.fn.sum<number>("quantity").as("onHand"))
    .executeTakeFirst();
  return Number(row?.onHand ?? 0);
}

// Utility function to get the storage unit with the highest quantity
export async function getStorageUnitWithHighestQuantity(
  trx: Transaction<DB>,
  itemId: string,
  locationId: string
): Promise<string | null> {
  const storageUnitWithHighestQuantity = await trx
    .selectFrom("itemLedger")
    .where("itemId", "=", itemId)
    .where("locationId", "=", locationId)
    .where("storageUnitId", "is not", null)
    .groupBy("storageUnitId")
    .select([
      "storageUnitId",
      (eb) => eb.fn.sum("quantity").as("totalQuantity")
    ])
    .having((eb) => eb.fn.sum("quantity"), ">", 0)
    .orderBy("totalQuantity", "desc")
    .executeTakeFirst();

  return storageUnitWithHighestQuantity?.storageUnitId ?? null;
}

// Utility function to update pickMethod defaultStorageUnitId if this is the only non-null storage unit
export async function updatePickMethodDefaultStorageUnitIfNeeded(
  trx: Transaction<DB>,
  itemId: string,
  locationId: string | null | undefined,
  storageUnitId: string | null | undefined,
  companyId: string,
  userId: string
): Promise<void> {
  // Only proceed if storageUnitId and locationId are not null
  if (!storageUnitId || !locationId) return;

  // Check if there are other non-null storage units for this item/location
  const otherStorageUnits = await trx
    .selectFrom("itemLedger")
    .where("itemId", "=", itemId)
    .where("locationId", "=", locationId)
    .where("storageUnitId", "is not", null)
    .where("storageUnitId", "!=", storageUnitId)
    .select("storageUnitId")
    .executeTakeFirst();

  // If there are no other non-null storage units, update or insert pickMethod
  if (!otherStorageUnits) {
    const existingPickMethod = await trx
      .selectFrom("pickMethod")
      .where("itemId", "=", itemId)
      .where("locationId", "=", locationId)
      .where("companyId", "=", companyId)
      .select("defaultStorageUnitId")
      .executeTakeFirst();

    if (existingPickMethod) {
      // Update existing pickMethod
      await trx
        .updateTable("pickMethod")
        .set({
          defaultStorageUnitId: storageUnitId,
          updatedBy: userId,
          updatedAt: datetime.timestamp()
        })
        .where("itemId", "=", itemId)
        .where("locationId", "=", locationId)
        .where("companyId", "=", companyId)
        .execute();
    } else {
      // Insert new pickMethod
      await trx
        .insertInto("pickMethod")
        .values({
          itemId,
          locationId,
          defaultStorageUnitId: storageUnitId,
          companyId,
          createdBy: userId,
          createdAt: datetime.timestamp()
        })
        .execute();
    }
  }
}
