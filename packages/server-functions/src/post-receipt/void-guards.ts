// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// What must still be true before a receipt can be voided. The void reverses
// every item ledger row the posting wrote, at the bin the posting used, so the
// stock must still be there: a unit moved to another bin, picked to lineside or
// shipped made the void drive the receipt bin negative while the stock stayed
// counted where it went.

import type { KyselyDatabase } from "@carbon/database/client";
import { EPSILON } from "@carbon/utils";
import type { Kysely, Transaction } from "kysely";
import { InvalidInputError } from "../errors";

type Db = Kysely<KyselyDatabase> | Transaction<KyselyDatabase>;

export type StockPosition = {
  itemId: string;
  locationId: string | null;
  storageUnitId: string | null;
  trackedEntityId: string | null;
};

export type ReversingRow = StockPosition & { quantity: number };

const positionKey = (row: StockPosition) =>
  [
    row.itemId,
    row.locationId ?? "",
    row.storageUnitId ?? "",
    row.trackedEntityId ?? ""
  ].join("|");

/**
 * The positions the reversal would drive below zero. A tracked row is checked
 * per serial or batch, so a unit that left its bin is caught even when the bin
 * holds other stock of the item. Reversal rows that add stock (a negative
 * receipt line) need nothing.
 */
export function findVoidShortfalls(
  reversingRows: ReversingRow[],
  onHand: ReadonlyMap<string, number>
): (StockPosition & { required: number; onHand: number })[] {
  const required = new Map<string, StockPosition & { required: number }>();
  for (const row of reversingRows) {
    if (row.quantity >= 0) continue;
    const key = positionKey(row);
    const entry = required.get(key) ?? { ...row, required: 0 };
    entry.required += -row.quantity;
    required.set(key, entry);
  }

  return [...required.entries()].flatMap(([key, entry]) => {
    const available = onHand.get(key) ?? 0;
    return available + EPSILON < entry.required
      ? [
          {
            itemId: entry.itemId,
            locationId: entry.locationId,
            storageUnitId: entry.storageUnitId,
            trackedEntityId: entry.trackedEntityId,
            required: entry.required,
            onHand: available
          }
        ]
      : [];
  });
}

/** Refuses the void when the received stock is no longer where it was received. */
export async function assertReceivedStockOnHand(
  trx: Db,
  companyId: string,
  reversingRows: ReversingRow[]
): Promise<void> {
  const removing = reversingRows.filter((row) => row.quantity < 0);
  if (removing.length === 0) return;

  const itemIds = [...new Set(removing.map((row) => row.itemId))];
  const rows = await trx
    .selectFrom("itemLedger")
    .select([
      "itemId",
      "locationId",
      "storageUnitId",
      "trackedEntityId",
      (eb) => eb.fn.sum<number>("quantity").as("quantity")
    ])
    .where("companyId", "=", companyId)
    .where("itemId", "in", itemIds)
    .groupBy(["itemId", "locationId", "storageUnitId", "trackedEntityId"])
    .execute();

  // Untracked rows are compared with the bin's untracked stock; tracked rows
  // with that serial or batch alone.
  const onHand = new Map<string, number>();
  for (const row of rows) {
    onHand.set(positionKey(row), Number(row.quantity ?? 0));
  }

  if (findVoidShortfalls(removing, onHand).length > 0) {
    throw new InvalidInputError(
      "Cannot void: stock received on this receipt was moved, picked or shipped since it was received. Correct the remainder with an inventory adjustment instead."
    );
  }
}

/**
 * Locks the receipt and re-reads its status inside the void's transaction, so
 * two voids sent at once cannot both reverse it. Inspection writes read the
 * receipt FOR SHARE, so they also wait for the void to commit.
 */
export async function lockPostedReceipt(
  trx: Db,
  companyId: string,
  receiptId: string
): Promise<void> {
  const receipt = await trx
    .selectFrom("receipt")
    .select("status")
    .where("id", "=", receiptId)
    .where("companyId", "=", companyId)
    .forUpdate()
    .executeTakeFirst();
  if (receipt?.status !== "Posted") {
    throw new InvalidInputError("Can only void posted receipts");
  }
}

/**
 * Refuses the void when an inspection of the receipt rejected an untracked
 * lot. The reject route writes that lot off; the void would then take the same
 * stock out a second time.
 */
export async function assertNoRejectedUntrackedLot(
  trx: Db,
  companyId: string,
  receiptId: string
): Promise<void> {
  const rejected = await trx
    .selectFrom("inspection")
    .innerJoin("item", (join) =>
      join
        .onRef("item.id", "=", "inspection.itemId")
        .onRef("item.companyId", "=", "inspection.companyId")
    )
    .select("inspection.inspectionId")
    .where("inspection.companyId", "=", companyId)
    .where("inspection.sourceDocument", "=", "Receipt")
    .where("inspection.sourceDocumentId", "=", receiptId)
    .where("inspection.status", "=", "Failed")
    .where("item.itemTrackingType", "=", "Inventory")
    .executeTakeFirst();
  if (rejected) {
    throw new InvalidInputError(
      `Cannot void: inspection ${rejected.inspectionId} rejected this stock and wrote it off. Correct the remainder with an inventory adjustment instead.`
    );
  }
}

/** An item ledger row the void is about to insert, as a stock position. */
export function toReversingRow(row: {
  itemId: string;
  locationId?: string | null;
  storageUnitId?: string | null;
  trackedEntityId?: string | null;
  quantity: number | string;
}): ReversingRow {
  return {
    itemId: row.itemId,
    locationId: row.locationId ?? null,
    storageUnitId: row.storageUnitId ?? null,
    trackedEntityId: row.trackedEntityId ?? null,
    quantity: Number(row.quantity)
  };
}
