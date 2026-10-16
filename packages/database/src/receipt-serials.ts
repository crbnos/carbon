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

  const history = await db
    .selectFrom("itemLedger")
    .select("trackedEntityId")
    .distinct()
    .where("trackedEntityId", "in", entityIds)
    .where("companyId", "=", companyId)
    .execute();

  const { deleteIds, unlink } = planReceiptSerialRelease(
    entityIds.map((id) => ({ id })),
    new Set(history.flatMap((row) => row.trackedEntityId ?? []))
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
