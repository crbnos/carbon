// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { sql } from "kysely";
import { connectLocalTestDatabase } from "../local-database-test-fixture";

/**
 * A scratch company with one Transfer kanban: From storage unit A, To storage
 * unit B, quantity 5, replenishment level 10, and no stock anywhere.
 * `cleanup()` deletes the company (FK cascade) and closes the connection.
 */
export async function kanbanFixture() {
  const db = await connectLocalTestDatabase();
  const prefix = `kbtest-${crypto
    .randomUUID()
    .replaceAll("-", "")
    .slice(0, 12)}`;
  const companyId = `${prefix}-company`;
  const groupId = `${prefix}-group`;
  const locationId = `${prefix}-location`;
  const fromId = `${prefix}-su-a`;
  const toId = `${prefix}-su-b`;
  const itemId = `${prefix}-item`;
  const kanbanId = `${prefix}-kanban`;

  await db.transaction().execute(async (trx) => {
    await sql`SET LOCAL "app.sync_in_progress" = 'true'`.execute(trx);
    await trx
      .insertInto("companyGroup")
      .values({ id: groupId, name: prefix, createdBy: "system" })
      .execute();
    await trx
      .insertInto("company")
      .values({
        id: companyId,
        name: prefix,
        companyGroupId: groupId,
        baseCurrencyCode: "USD",
        timezone: "America/New_York"
      })
      .execute();
    await trx
      .insertInto("location")
      .values({
        id: locationId,
        name: "Plant",
        addressLine1: "1 Test Way",
        city: "Testville",
        postalCode: "00000",
        timezone: "America/New_York",
        companyId,
        createdBy: "system"
      })
      .execute();
    await trx
      .insertInto("storageUnit")
      .values([
        {
          id: fromId,
          name: "A",
          locationId,
          companyId,
          createdBy: "system"
        },
        {
          id: toId,
          name: "B",
          locationId,
          companyId,
          createdBy: "system"
        }
      ])
      .execute();
    await trx
      .insertInto("unitOfMeasure")
      .values({ code: "EA", name: "Each", companyId, createdBy: "system" })
      .execute();
    await trx
      .insertInto("item")
      .values({
        id: itemId,
        readableId: "KB-TEST-ITEM",
        name: "Kanban test item",
        type: "Part",
        itemTrackingType: "Inventory",
        unitOfMeasureCode: "EA",
        companyId,
        createdBy: "system"
      })
      .execute();
    await trx
      .insertInto("sequence")
      .values({
        table: "stockTransfer",
        name: "Stock Transfer",
        prefix: "ST",
        next: 0,
        size: 6,
        step: 1,
        companyId
      })
      .execute();
    await trx
      .insertInto("kanban")
      .values({
        id: kanbanId,
        itemId,
        replenishmentSystem: "Transfer",
        quantity: 5,
        replenishmentLevel: 10,
        locationId,
        fromStorageUnitId: fromId,
        storageUnitId: toId,
        companyId,
        createdBy: "system"
      })
      .execute();
  });

  const postLedger = (storageUnitId: string, quantity: number) =>
    db
      .insertInto("itemLedger")
      .values({
        entryType: quantity >= 0 ? "Positive Adjmt." : "Negative Adjmt.",
        documentType: "Inventory Receipt",
        itemId,
        locationId,
        storageUnitId,
        quantity,
        companyId,
        createdBy: "system"
      })
      .execute();

  return {
    db,
    companyId,
    kanbanId,
    fromId,
    toId,
    itemId,
    /** One itemLedger row of `delta` at the To storage unit (B). */
    adjustToBin: (delta: number) => postLedger(toId, delta),
    /** One itemLedger row of `delta` at the From storage unit (A). */
    adjustFromBin: (delta: number) => postLedger(fromId, delta),
    async cleanup() {
      await db.transaction().execute(async (trx) => {
        await sql`SET LOCAL "app.sync_in_progress" = 'true'`.execute(trx);
        await trx.deleteFrom("company").where("id", "=", companyId).execute();
        await trx
          .deleteFrom("companyGroup")
          .where("id", "=", groupId)
          .execute();
        await sql`DROP TABLE IF EXISTS ${sql.id(`searchIndex_${companyId}`)}`.execute(
          trx
        );
        await sql`DROP TABLE IF EXISTS ${sql.id(`auditLog_${companyId}`)}`.execute(
          trx
        );
      });
      await db.destroy();
    }
  };
}
