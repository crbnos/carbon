// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Transaction } from "kysely";
import { DB } from "../lib/database.ts";

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

  const storageUnitWithHighestQuantity = await getStorageUnitWithHighestQuantity(
    trx,
    itemId,
    locationId
  );

  return storageUnitWithHighestQuantity ?? undefined;
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
    .select(["storageUnitId", (eb) => eb.fn.sum("quantity").as("totalQuantity")])
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
      .select("defaultStorageUnitId")
      .executeTakeFirst();

    if (existingPickMethod) {
      // Update existing pickMethod
      await trx
        .updateTable("pickMethod")
        .set({
          defaultStorageUnitId: storageUnitId,
          updatedBy: userId,
          updatedAt: new Date().toISOString(),
        })
        .where("itemId", "=", itemId)
        .where("locationId", "=", locationId)
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
          createdAt: new Date().toISOString(),
        })
        .execute();
    }
  }
}
