// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { type Kysely, sql } from "kysely";
import type { KyselyDatabase } from "./client.ts";

export function planReceiptSerialRelease<T extends { id: string }>(
  entities: T[],
  idsWithHistory: ReadonlySet<string>
): { deleteIds: string[]; unlink: T[] } {
  return {
    deleteIds: entities
      .filter((entity) => !idsWithHistory.has(entity.id))
      .map((entity) => entity.id),
    unlink: entities.filter((entity) => idsWithHistory.has(entity.id))
  };
}

/** The tracked entities among `entityIds` that have stock movements. */
export async function idsWithStockHistory(
  db: Kysely<KyselyDatabase>,
  companyId: string,
  entityIds: string[]
): Promise<Set<string>> {
  if (entityIds.length === 0) return new Set();
  const rows = await db
    .selectFrom("itemLedger")
    .select("trackedEntityId")
    .distinct()
    .where("trackedEntityId", "in", entityIds)
    .where("companyId", "=", companyId)
    .execute();
  return new Set(rows.flatMap((row) => row.trackedEntityId ?? []));
}

/**
 * The tracked entities among `entityIds` with stock movements outside voided
 * receipts. A serial whose only movements are a receipt and that receipt's void
 * was never received, so a new receipt can take it again; a void writes its
 * reversal under the receipt's own `documentId`.
 */
export async function idsWithLiveStockHistory(
  db: Kysely<KyselyDatabase>,
  companyId: string,
  entityIds: string[]
): Promise<Set<string>> {
  if (entityIds.length === 0) return new Set();
  const rows = await db
    .selectFrom("itemLedger")
    .select("itemLedger.trackedEntityId")
    .distinct()
    .where("itemLedger.trackedEntityId", "in", entityIds)
    .where("itemLedger.companyId", "=", companyId)
    .where(({ not, exists, selectFrom }) =>
      not(
        exists(
          selectFrom("receipt")
            .select("receipt.id")
            .whereRef("receipt.id", "=", "itemLedger.documentId")
            .whereRef("receipt.companyId", "=", "itemLedger.companyId")
            .where("receipt.status", "=", "Voided")
        )
      )
    )
    .execute();
  return new Set(rows.flatMap((row) => row.trackedEntityId ?? []));
}

/** The receipts among `receiptIds` that are voided. */
export async function voidedReceiptIds(
  db: Kysely<KyselyDatabase>,
  companyId: string,
  receiptIds: string[]
): Promise<Set<string>> {
  if (receiptIds.length === 0) return new Set();
  const rows = await db
    .selectFrom("receipt")
    .select("id")
    .where("id", "in", receiptIds)
    .where("companyId", "=", companyId)
    .where("status", "=", "Voided")
    .execute();
  return new Set(rows.map((row) => row.id));
}

/**
 * Takes serial tracked entities off a receipt: one with no stock history is
 * deleted, one with history only loses its receipt link. Run it inside a
 * transaction.
 */
export async function releaseReceiptSerialEntities(
  db: Kysely<KyselyDatabase>,
  companyId: string,
  entityIds: string[]
): Promise<void> {
  if (entityIds.length === 0) return;

  const { deleteIds, unlink } = planReceiptSerialRelease(
    entityIds.map((id) => ({ id })),
    await idsWithStockHistory(db, companyId, entityIds)
  );

  if (deleteIds.length > 0) {
    await db
      .deleteFrom("trackedEntity")
      .where("id", "in", deleteIds)
      .where("companyId", "=", companyId)
      .execute();
  }

  if (unlink.length > 0) {
    await db
      .updateTable("trackedEntity")
      .set({
        attributes: sql`attributes - 'Receipt' - 'Receipt Line' - 'Receipt Line Index'`
      })
      .where(
        "id",
        "in",
        unlink.map((entity) => entity.id)
      )
      .where("companyId", "=", companyId)
      .execute();
  }
}
