// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Receiving an outside processing purchase order is how its job operation
// records the units the supplier finished: nobody records production for it.
// Before, the receipt set the operation Done and left quantityComplete at 0.
// Runs against the local database (SUPABASE_DB_URL); skipped without one.
import { expect } from "vitest";
import { postReceipt } from "../../../app/modules/inventory/inventory.service";
import {
  invokeCreate,
  invokePosting
} from "../../../app/modules/shared/shared.service";
import {
  alwaysPostFixture,
  type Fixture,
  jobFixture,
  seed,
  USER,
  unwrap
} from "../fixtures/always-post";
import { handlesOf } from "../fixtures/handles";
import { databaseTest } from "../fixtures/local-database";

/** A job for 10 whose one operation is sent out on a purchase order for 10. */
async function outsideProcessingOrder(f: Fixture) {
  const job = await jobFixture(f, "outside");
  const purchaseOrderId = `${f.prefix}-po-outside`;
  await seed(f, async (trx) => {
    await trx
      .updateTable("job")
      .set({ quantity: 10, status: "In Progress" })
      .where("id", "=", job.jobId)
      .execute();
    await trx
      .updateTable("jobOperation")
      .set({
        operationType: "Outside Processing",
        operationQuantity: 10,
        status: "In Progress"
      })
      .where("id", "=", job.operationId)
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
        purchaseOrderId: "PO-OUTSIDE",
        purchaseOrderType: "Outside Processing",
        supplierId: f.supplierId,
        supplierInteractionId: interaction.id,
        jobId: job.jobId,
        currencyCode: "USD",
        exchangeRate: 1,
        status: "To Receive and Invoice",
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
      .values({
        purchaseOrderId,
        purchaseOrderLineType: "Part",
        itemId: f.assemblyId,
        purchaseQuantity: 10,
        supplierUnitPrice: 5,
        exchangeRate: 1,
        conversionFactor: 1,
        inventoryUnitOfMeasureCode: "EA",
        locationId: f.locationId,
        jobId: job.jobId,
        jobOperationId: job.operationId,
        companyId: f.companyId,
        createdBy: USER
      })
      .execute();
  });
  return { ...job, purchaseOrderId };
}

/** Receives `quantity` of the order's one line. */
async function receive(f: Fixture, purchaseOrderId: string, quantity: number) {
  const receipt = unwrap(
    await invokeCreate(handlesOf(f.ctx), {
      type: "receiptFromPurchaseOrder",
      purchaseOrderId,
      locationId: f.locationId
    })
  );
  await seed(f, (trx) =>
    trx
      .updateTable("receiptLine")
      .set({ receivedQuantity: quantity })
      .where("receiptId", "=", receipt.id)
      .where("companyId", "=", f.companyId)
      .execute()
  );
  unwrap(
    await invokePosting(
      handlesOf(f.ctx),
      "post-receipt",
      { type: "post", receiptId: receipt.id },
      postReceipt
    )
  );
}

async function operation(f: Fixture, operationId: string) {
  const row = await f.db
    .selectFrom("jobOperation")
    .select(["status", "quantityComplete"])
    .where("id", "=", operationId)
    .where("companyId", "=", f.companyId)
    .executeTakeFirstOrThrow();
  return { status: row.status, quantityComplete: Number(row.quantityComplete) };
}

databaseTest(
  "receiving an outside processing order completes the operation by what was received, across receipts",
  async () => {
    const f = await alwaysPostFixture();
    try {
      const order = await outsideProcessingOrder(f);

      await receive(f, order.purchaseOrderId, 4);
      expect(await operation(f, order.operationId)).toEqual({
        status: "In Progress",
        quantityComplete: 4
      });

      await receive(f, order.purchaseOrderId, 6);
      expect(await operation(f, order.operationId)).toEqual({
        status: "Done",
        quantityComplete: 10
      });
    } finally {
      await f.cleanup();
    }
  }
);
