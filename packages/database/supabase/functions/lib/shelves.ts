import { Transaction } from "kysely";
import { DB } from "../lib/database.ts";

export async function getShelfId(
  trx: Transaction<DB>,
  itemId: string,
  locationId: string,
  shelfId?: string
): Promise<string | undefined> {
  if (shelfId) return shelfId;

  const pickMethod = await trx
    .selectFrom("pickMethod")
    .where("itemId", "=", itemId)
    .where("locationId", "=", locationId)
    .select("defaultShelfId")
    .executeTakeFirst();

  if (pickMethod?.defaultShelfId) return pickMethod.defaultShelfId;

  const shelfWithHighestQuantity = await getShelfWithHighestQuantity(
    trx,
    itemId,
    locationId
  );

  return shelfWithHighestQuantity ?? undefined;
}

// Utility function to get the shelf with the highest quantity
export async function getShelfWithHighestQuantity(
  trx: Transaction<DB>,
  itemId: string,
  locationId: string
): Promise<string | null> {
  const shelfWithHighestQuantity = await trx
    .selectFrom("itemLedger")
    .where("itemId", "=", itemId)
    .where("locationId", "=", locationId)
    .where("shelfId", "is not", null)
    .groupBy("shelfId")
    .select(["shelfId", (eb) => eb.fn.sum("quantity").as("totalQuantity")])
    .having((eb) => eb.fn.sum("quantity"), ">", 0)
    .orderBy("totalQuantity", "desc")
    .executeTakeFirst();

  return shelfWithHighestQuantity?.shelfId ?? null;
}

// Utility function to update pickMethod defaultShelfId if this is the only non-null shelf
export async function updatePickMethodDefaultShelfIfNeeded(
  trx: Transaction<DB>,
  itemId: string,
  locationId: string | null | undefined,
  shelfId: string | null | undefined,
  companyId: string,
  userId: string
): Promise<void> {
  // Only proceed if shelfId and locationId are not null
  if (!shelfId || !locationId) return;

  // Check if there are other non-null shelves for this item/location
  const otherShelves = await trx
    .selectFrom("itemLedger")
    .where("itemId", "=", itemId)
    .where("locationId", "=", locationId)
    .where("shelfId", "is not", null)
    .where("shelfId", "!=", shelfId)
    .select("shelfId")
    .executeTakeFirst();

  // If there are no other non-null shelves, update or insert pickMethod
  if (!otherShelves) {
    const existingPickMethod = await trx
      .selectFrom("pickMethod")
      .where("itemId", "=", itemId)
      .where("locationId", "=", locationId)
      .select("defaultShelfId")
      .executeTakeFirst();

    if (existingPickMethod) {
      // Update existing pickMethod
      await trx
        .updateTable("pickMethod")
        .set({
          defaultShelfId: shelfId,
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
          defaultShelfId: shelfId,
          companyId,
          createdBy: userId,
          createdAt: new Date().toISOString(),
        })
        .execute();
    }
  }
}
