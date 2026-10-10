// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { KyselyDatabase as DB } from "@carbon/database/client";
import { datetime } from "@carbon/utils";
import type { Transaction } from "kysely";
import { itemLedgerInStripes, type StockStripe } from "./stock-stripes";

export async function getStorageUnitId(
  trx: Transaction<DB>,
  {
    companyId,
    itemId,
    locationId,
    storageUnitId,
    stripes = [null]
  }: {
    companyId: string;
    itemId: string;
    locationId: string;
    storageUnitId?: string;
    // The stripes the demand may draw; common stock by default.
    stripes?: readonly StockStripe[];
  }
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
    await getStorageUnitWithHighestQuantity(trx, {
      companyId,
      itemId,
      locationId,
      stripes
    });

  return storageUnitWithHighestQuantity?.storageUnitId ?? undefined;
}

// The bin with the most on-hand of an item at a location, within the stripes a
// demand may draw (stock-stripes.ts). The first stripe that holds stock in any
// bin wins, so a project demand prefers its project's stock; within a stripe,
// the bin with the highest quantity wins. Returns the bin and its stripe, or
// null when no bin of those stripes holds stock.
export async function getStorageUnitWithHighestQuantity(
  trx: Transaction<DB>,
  {
    companyId,
    itemId,
    locationId,
    stripes
  }: {
    companyId: string;
    itemId: string;
    locationId: string;
    stripes: readonly StockStripe[];
  }
): Promise<{ storageUnitId: string; projectId: StockStripe } | null> {
  const bins = await trx
    .selectFrom("itemLedger")
    .where("companyId", "=", companyId)
    .where("itemId", "=", itemId)
    .where("locationId", "=", locationId)
    .where("storageUnitId", "is not", null)
    .where((eb) => itemLedgerInStripes(eb, stripes))
    .groupBy(["storageUnitId", "projectId"])
    .select([
      "storageUnitId",
      "projectId",
      (eb) => eb.fn.sum("quantity").as("totalQuantity")
    ])
    .having((eb) => eb.fn.sum("quantity"), ">", 0)
    .orderBy("totalQuantity", "desc")
    .execute();

  for (const stripe of stripes) {
    const bin = bins.find((row) => (row.projectId ?? null) === stripe);
    if (bin?.storageUnitId) {
      return { storageUnitId: bin.storageUnitId, projectId: stripe };
    }
  }
  return null;
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
