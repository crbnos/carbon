// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { sql } from "kysely";
import { expect } from "vitest";
import { invokeCreate } from "../../app/modules/shared/shared.service";
import {
  alwaysPostFixture,
  type Fixture,
  seed,
  USER,
  unwrap
} from "./fixtures/always-post";
import { handlesOf } from "./fixtures/handles";
import { databaseTest } from "./fixtures/local-database";

/** A purchase order with one batch line and one serial line. */
async function purchaseOrder(f: Fixture) {
  const purchaseOrderId = `${f.prefix}-po-batches`;
  const batchItemId = `${f.prefix}-batch`;
  const serialItemId = `${f.prefix}-serial`;
  await seed(f, async (trx) => {
    await trx
      .insertInto("item")
      .values(
        [
          { id: batchItemId, tracking: "Batch" as const },
          { id: serialItemId, tracking: "Serial" as const }
        ].map(({ id, tracking }) => ({
          id,
          readableId: id.toUpperCase(),
          name: `${tracking} part`,
          type: "Part" as const,
          itemTrackingType: tracking,
          replenishmentSystem: "Buy" as const,
          companyId: f.companyId,
          createdBy: USER
        }))
      )
      .execute();
    const interaction = await trx
      .insertInto("supplierInteraction")
      .values({ supplierId: f.supplierId, companyId: f.companyId })
      .returning("id")
      .executeTakeFirstOrThrow();
    await trx
      .insertInto("purchaseOrder")
      .values({
        id: purchaseOrderId,
        purchaseOrderId: "PO-BATCHES",
        supplierId: f.supplierId,
        supplierInteractionId: interaction.id,
        currencyCode: "USD",
        exchangeRate: 1,
        companyId: f.companyId,
        createdBy: USER
      })
      .execute();
    await trx
      .insertInto("purchaseOrderDelivery")
      .values({
        id: purchaseOrderId,
        locationId: f.locationId,
        companyId: f.companyId
      })
      .execute();
    await trx
      .insertInto("purchaseOrderLine")
      .values(
        [batchItemId, serialItemId].map((itemId) => ({
          id: `${itemId}-pol`,
          purchaseOrderId,
          purchaseOrderLineType: "Part" as const,
          itemId,
          purchaseQuantity: 5,
          supplierUnitPrice: 10,
          exchangeRate: 1,
          conversionFactor: 1,
          inventoryUnitOfMeasureCode: "EA",
          locationId: f.locationId,
          companyId: f.companyId,
          createdBy: USER
        }))
      )
      .execute();
  });
  return { purchaseOrderId, batchItemId };
}

async function receive(f: Fixture, purchaseOrderId: string, receiptId?: string) {
  return unwrap(
    await invokeCreate(handlesOf(f.ctx), {
      type: "receiptFromPurchaseOrder",
      purchaseOrderId,
      locationId: f.locationId,
      receiptId
    })
  ).id;
}

async function batchesOf(f: Fixture, receiptId: string) {
  return f.db
    .selectFrom("trackedEntity")
    .select(["itemId", "readableId", "status", "quantity"])
    .where(sql<boolean>`attributes ->> 'Receipt' = ${receiptId}`)
    .where("companyId", "=", f.companyId)
    .execute();
}

databaseTest(
  "a purchase order receipt numbers its batch from the purchase order and the day, -2 for a second delivery",
  async () => {
    const f = await alwaysPostFixture();
    try {
      const { purchaseOrderId, batchItemId } = await purchaseOrder(f);

      const first = await receive(f, purchaseOrderId);
      const [batch, ...rest] = await batchesOf(f, first);
      expect(rest).toEqual([]);
      expect(batch).toMatchObject({ itemId: batchItemId, status: "On Hold" });
      expect(Number(batch!.quantity)).toBe(5);
      expect(batch!.readableId).toMatch(/^PO-BATCHES-\d{8}$/);

      const second = await receive(f, purchaseOrderId);
      expect((await batchesOf(f, second)).map((b) => b.readableId)).toEqual([
        `${batch!.readableId}-2`
      ]);

      // Rebuilding a draft replaces its batch rather than stacking a -3.
      await receive(f, purchaseOrderId, second);
      expect((await batchesOf(f, second)).map((b) => b.readableId)).toEqual([
        `${batch!.readableId}-2`
      ]);
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "with the setting off, a purchase order receipt leaves batch numbers to the receiver",
  async () => {
    const f = await alwaysPostFixture();
    try {
      await f.db
        .updateTable("companySettings")
        .set({ receiptBatchNumbersFromPurchaseOrder: false })
        .where("id", "=", f.companyId)
        .execute();
      const { purchaseOrderId } = await purchaseOrder(f);

      expect(await batchesOf(f, await receive(f, purchaseOrderId))).toEqual([]);
    } finally {
      await f.cleanup();
    }
  }
);
