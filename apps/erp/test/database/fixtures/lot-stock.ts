// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Kysely, KyselyDatabase } from "@carbon/database/client";
import { sql } from "kysely";

type Db = Kysely<KyselyDatabase>;

export type LotStockRow = {
  locationId: string;
  storageUnitId: string | null;
  quantity: number;
  /** The row's stock stripe: a project id, or null (the default) for
   *  unassigned stock. */
  projectId?: string | null;
};

/** An Available lot of `itemId`, its quantity the sum of its stock rows, each
 *  a Positive Adjmt. ledger row. */
export async function seedLot(
  db: Db,
  lot: {
    id: string;
    readableId: string;
    itemId: string;
    companyId: string;
    createdBy: string;
    stock: LotStockRow[];
  }
) {
  await db.transaction().execute(async (trx) => {
    await sql`SET LOCAL "app.sync_in_progress" = 'true'`.execute(trx);
    await trx
      .insertInto("trackedEntity")
      .values({
        id: lot.id,
        readableId: lot.readableId,
        quantity: lot.stock.reduce((sum, row) => sum + row.quantity, 0),
        status: "Available",
        sourceDocument: "Item",
        sourceDocumentId: lot.itemId,
        itemId: lot.itemId,
        companyId: lot.companyId,
        createdBy: lot.createdBy
      })
      .execute();
    await trx
      .insertInto("itemLedger")
      .values(
        lot.stock.map((row) => ({
          ...row,
          itemId: lot.itemId,
          trackedEntityId: lot.id,
          entryType: "Positive Adjmt." as const,
          companyId: lot.companyId,
          createdBy: lot.createdBy
        }))
      )
      .execute();
  });
}

/** The stock of a lot and the split children drawn from it, by location and
 *  storage unit. */
export async function lotStock(
  db: Db,
  companyId: string,
  lotId: string
): Promise<LotStockRow[]> {
  const rows = await db
    .selectFrom("itemLedger as il")
    .innerJoin("trackedEntity as te", "te.id", "il.trackedEntityId")
    .select(["il.locationId", "il.storageUnitId"])
    .select((eb) => eb.fn.sum<number>("il.quantity").as("quantity"))
    .where("il.companyId", "=", companyId)
    .where((eb) =>
      eb.or([
        eb("te.id", "=", lotId),
        sql<boolean>`${eb.ref("te.attributes")} ->> 'Split From Entity ID' = ${lotId}`
      ])
    )
    .groupBy(["il.locationId", "il.storageUnitId"])
    .orderBy("il.storageUnitId")
    .execute();
  return rows.map((row) => ({
    locationId: row.locationId as string,
    storageUnitId: row.storageUnitId,
    quantity: Number(row.quantity)
  }));
}

/** The stock of a lot and its split children in one storage unit, per stripe
 *  (`common` for unassigned stock). */
export async function lotStripesIn(
  db: Db,
  companyId: string,
  lotId: string,
  storageUnitId: string
): Promise<Record<string, number>> {
  const rows = await db
    .selectFrom("itemLedger as il")
    .innerJoin("trackedEntity as te", "te.id", "il.trackedEntityId")
    .select("il.projectId")
    .select((eb) => eb.fn.sum<number>("il.quantity").as("quantity"))
    .where("il.companyId", "=", companyId)
    .where("il.storageUnitId", "=", storageUnitId)
    .where((eb) =>
      eb.or([
        eb("te.id", "=", lotId),
        sql<boolean>`${eb.ref("te.attributes")} ->> 'Split From Entity ID' = ${lotId}`
      ])
    )
    .groupBy("il.projectId")
    .execute();
  return Object.fromEntries(
    rows.map((row) => [row.projectId ?? "common", Number(row.quantity)])
  );
}
