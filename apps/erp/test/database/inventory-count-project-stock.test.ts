// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { sql } from "kysely";
import { expect } from "vitest";
import {
  generateInventoryCountLines,
  postInventoryCount,
  recordInventoryCountUnit
} from "../../app/modules/inventory/inventory.service";
import { invokePosting } from "../../app/modules/shared/shared.service";
import { handlesOf } from "./fixtures/handles";
import { databaseTest } from "./fixtures/local-database";
import { projectPostingFixture } from "./fixtures/project-posting";

type Fixture = Awaited<ReturnType<typeof projectPostingFixture>>;

/** Two bins at a location and a Draft count of it, taken after `stock` runs. */
async function countOf(
  f: Fixture,
  stock: (args: {
    locationId: string;
    binA: string;
    binB: string;
  }) => Promise<void>
) {
  const { locationId } = await f.addStockedItem("filler", {
    quantity: 1,
    unitCost: 1
  });
  const binA = `${f.prefix}-bin-a`;
  const binB = `${f.prefix}-bin-b`;
  await f.db
    .insertInto("storageUnit")
    .values(
      [
        [binA, "A1"],
        [binB, "B2"]
      ].map(([id, name]) => ({
        id: id!,
        name: name!,
        locationId,
        companyId: f.companyId,
        createdBy: "system"
      }))
    )
    .execute();
  await stock({ locationId, binA, binB });
  const inventoryCountId = `${f.prefix}-count`;
  await f.db
    .insertInto("inventoryCount")
    .values({
      id: inventoryCountId,
      inventoryCountId: "IC-1",
      locationId,
      status: "Draft",
      companyId: f.companyId,
      createdBy: "system"
    })
    .execute();
  await generateInventoryCountLines(f.db, {
    inventoryCountId,
    companyId: f.companyId,
    locationId,
    createdBy: "system"
  });
  return { inventoryCountId, locationId, binA, binB };
}

const scan = (
  f: Fixture,
  inventoryCountId: string,
  args: { storageUnitId: string | null; code: string; quantity?: number }
) =>
  recordInventoryCountUnit(f.db, {
    inventoryCountId,
    companyId: f.companyId,
    userId: "system",
    ...args
  });

databaseTest(
  "a count of an untracked item held by two owners in one bin spreads over both lines",
  async () => {
    const f = await projectPostingFixture({ costTreatment: "Contract" });
    try {
      await f.enableProjectStock();
      const part = await f.addItem("part", { itemTrackingType: "Inventory" });
      const { inventoryCountId, binA } = await countOf(
        f,
        async ({ locationId, binA }) => {
          for (const [projectId, quantity] of [
            [null, 10],
            [f.projectId, 4]
          ] as const) {
            await f.addStripeStock({
              itemId: part.itemId,
              locationId,
              projectId,
              quantity,
              unitCost: 10,
              storageUnitId: binA
            });
          }
        }
      );

      const readable = await f.db
        .selectFrom("item")
        .select("readableId")
        .where("id", "=", part.itemId)
        .executeTakeFirstOrThrow();
      const outcome = await scan(f, inventoryCountId, {
        storageUnitId: binA,
        code: readable.readableId,
        quantity: 14
      });
      expect(outcome?.outcome).toBe("counted");

      const lines = await f.db
        .selectFrom("inventoryCountLine")
        .select(["systemQuantity", "countedQuantity"])
        .where("inventoryCountId", "=", inventoryCountId)
        .where("itemId", "=", part.itemId)
        .execute();
      // Nothing is short: neither owner's stock posts a variance.
      expect(
        lines.map((line) => Number(line.countedQuantity)).sort((a, b) => a - b)
      ).toEqual([4, 10]);
      expect(
        lines.every(
          (line) => Number(line.countedQuantity) === Number(line.systemQuantity)
        )
      ).toBe(true);
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "a serial of project stock counted in another bin moves within its owner's stock",
  async () => {
    const f = await projectPostingFixture({ costTreatment: "Contract" });
    try {
      await f.enableProjectStock();
      const part = await f.addItem("part", { itemTrackingType: "Serial" });
      const trackedEntityId = `${f.prefix}-serial`;
      const { inventoryCountId, binA, binB } = await countOf(
        f,
        async ({ locationId, binA }) => {
          await f.db.transaction().execute(async (trx) => {
            await sql`SET LOCAL "app.sync_in_progress" = 'true'`.execute(trx);
            await trx
              .insertInto("trackedEntity")
              .values({
                id: trackedEntityId,
                readableId: `${f.prefix}-SN-1`,
                itemId: part.itemId,
                quantity: 1,
                status: "Available",
                sourceDocument: "Item",
                sourceDocumentId: part.itemId,
                companyId: f.companyId,
                createdBy: "system"
              })
              .execute();
            await trx
              .insertInto("itemLedger")
              .values({
                postingDate: "2026-01-01",
                entryType: "Positive Adjmt.",
                itemId: part.itemId,
                locationId,
                storageUnitId: binA,
                trackedEntityId,
                projectId: f.projectId,
                quantity: 1,
                companyId: f.companyId,
                createdBy: "system"
              })
              .execute();
          });
        }
      );

      await scan(f, inventoryCountId, {
        storageUnitId: binB,
        code: `${f.prefix}-SN-1`
      });
      const found = await f.db
        .selectFrom("inventoryCountLine")
        .select(["projectId", "foundDuringCount"])
        .where("inventoryCountId", "=", inventoryCountId)
        .where("storageUnitId", "=", binB)
        .executeTakeFirstOrThrow();
      expect(found).toEqual({
        projectId: f.projectId,
        foundDuringCount: true
      });
      await f.db
        .updateTable("inventoryCountLine")
        .set({ countedQuantity: 0 })
        .where("inventoryCountId", "=", inventoryCountId)
        .where("storageUnitId", "=", binA)
        .where("trackedEntityId", "=", trackedEntityId)
        .execute();
      await f.db
        .updateTable("inventoryCount")
        .set({ status: "Pending" })
        .where("id", "=", inventoryCountId)
        .execute();

      const posted = await invokePosting(
        handlesOf(f.ctx),
        "post-inventory-count",
        { inventoryCountId },
        postInventoryCount
      );
      expect(posted.error).toBeNull();

      const moves = await f.db
        .selectFrom("itemLedger")
        .select(["storageUnitId", "quantity", "projectId"])
        .where("companyId", "=", f.companyId)
        .where("documentType", "=", "Inventory Count")
        .where("documentId", "=", inventoryCountId)
        .orderBy("quantity")
        .execute();
      expect(
        moves.map((row) => [
          row.storageUnitId,
          Number(row.quantity),
          row.projectId
        ])
      ).toEqual([
        [binA, -1, f.projectId],
        [binB, 1, f.projectId]
      ]);
    } finally {
      await f.cleanup();
    }
  }
);
