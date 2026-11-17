// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

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

/** A purchase order delivered to the fixture's location, with one batch line
 *  and one serial line that each name `lineLocationId`. */
async function purchaseOrderWithTrackedLines(
  f: Fixture,
  lineLocationId: string | null
) {
  const purchaseOrderId = `${f.prefix}-po-tracked`;
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
        purchaseOrderId: "PO-TRACKED",
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
          locationId: lineLocationId,
          companyId: f.companyId,
          createdBy: USER
        }))
      )
      .execute();
  });
  return { purchaseOrderId, batchItemId, serialItemId };
}

async function trackingFlags(f: Fixture, receiptId: string) {
  const lines = await f.db
    .selectFrom("receiptLine")
    .select(["itemId", "requiresBatchTracking", "requiresSerialTracking"])
    .where("receiptId", "=", receiptId)
    .where("companyId", "=", f.companyId)
    .execute();
  return Object.fromEntries(
    lines.map((line) => [
      line.itemId,
      { batch: line.requiresBatchTracking, serial: line.requiresSerialTracking }
    ])
  );
}

// A receipt line's flags are what make posting write the line's stock: a batch
// or serial line with neither flag posts no item ledger row.
for (const [where, lineLocation] of [
  ["the receipt's location", (f: Fixture) => f.locationId],
  ["another location", (f: Fixture) => f.otherLocationId],
  ["no location", () => null]
] as const) {
  databaseTest(
    `a receipt line for a purchase order line at ${where} keeps its batch or serial tracking`,
    async () => {
      const f = await alwaysPostFixture();
      try {
        const { purchaseOrderId, batchItemId, serialItemId } =
          await purchaseOrderWithTrackedLines(f, lineLocation(f));
        const receipt = unwrap(
          await invokeCreate(handlesOf(f.ctx), {
            type: "receiptFromPurchaseOrder",
            purchaseOrderId,
            locationId: f.locationId
          })
        );

        expect(await trackingFlags(f, receipt.id)).toEqual({
          [batchItemId]: { batch: true, serial: false },
          [serialItemId]: { batch: false, serial: true }
        });
      } finally {
        await f.cleanup();
      }
    }
  );
}
