// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Voiding a purchase receipt un-receives its serials and batches. The void
// reversed the stock but set every tracked entity back to Available at its
// received quantity, so a lot that was never received (one On Hold for
// inspection included) stayed pickable on shipments and jobs.

import {
  dispositionInspection,
  upsertInspectionSample
} from "@carbon/database/quality";
import {
  idsWithLiveStockHistory,
  idsWithStockHistory
} from "@carbon/database/receipt-serials";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect } from "vitest";
import { postReceipt } from "../../../app/modules/inventory/inventory.service";
import {
  invokeCreate,
  invokePosting
} from "../../../app/modules/shared/shared.service";
import {
  alwaysPostFixture,
  type Fixture,
  seed,
  USER,
  unwrap
} from "../fixtures/always-post";
import { handlesOf } from "../fixtures/handles";
import { databaseTest, hasLocalDatabase } from "../fixtures/local-database";

describe.skipIf(!hasLocalDatabase)("voiding a receipt", () => {
  let f: Fixture;
  let batchItemId: string;
  let serialItemId: string;
  let inspectedItemId: string;
  let otherBin: string;

  beforeAll(async () => {
    f = await alwaysPostFixture();
    batchItemId = `${f.prefix}-batch`;
    serialItemId = `${f.prefix}-serial`;
    inspectedItemId = `${f.prefix}-tank`;
    otherBin = `${f.prefix}-other-bin`;
    await seed(f, async (trx) => {
      await trx
        .insertInto("item")
        .values([
          {
            id: batchItemId,
            readableId: `${f.prefix}-OIL`,
            name: "Oil",
            type: "Part",
            itemTrackingType: "Batch",
            replenishmentSystem: "Buy",
            companyId: f.companyId,
            createdBy: USER
          },
          {
            id: serialItemId,
            readableId: `${f.prefix}-VEH`,
            name: "Vehicle",
            type: "Part",
            itemTrackingType: "Serial",
            replenishmentSystem: "Buy",
            companyId: f.companyId,
            createdBy: USER
          }
        ])
        .execute();
      await trx
        .insertInto("item")
        .values({
          id: inspectedItemId,
          readableId: `${f.prefix}-TANK`,
          name: "Tank",
          type: "Part",
          itemTrackingType: "Inventory",
          replenishmentSystem: "Buy",
          companyId: f.companyId,
          createdBy: USER
        })
        .execute();
      await trx
        .updateTable("itemCost")
        .set({ costingMethod: "FIFO", unitCost: 10 })
        .where("itemId", "in", [batchItemId, serialItemId, inspectedItemId])
        .where("companyId", "=", f.companyId)
        .execute();
      // A Receipt-usage inspection plan: posting creates a lot for the tank.
      await trx
        .insertInto("sequence")
        .values({
          table: "inspection",
          name: "Inspection",
          prefix: "INS",
          companyId: f.companyId
        })
        .execute();
      const document = await trx
        .insertInto("inspectionDocument")
        .values({
          partId: inspectedItemId,
          companyId: f.companyId,
          createdBy: USER
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      await trx
        .insertInto("itemInspectionDocumentAssignment")
        .values({
          itemId: inspectedItemId,
          usage: "Receipt",
          inspectionDocumentId: document.id,
          companyId: f.companyId,
          createdBy: USER
        })
        .execute();
      await trx
        .insertInto("storageUnit")
        .values({
          id: otherBin,
          name: "Other bin",
          locationId: f.locationId,
          companyId: f.companyId,
          createdBy: USER
        })
        .execute();
    });
  });

  afterAll(async () => {
    await f?.cleanup();
  });

  /** A draft receipt for `quantity` of `itemId` on a new purchase order. */
  async function draftReceipt(key: string, itemId: string, quantity: number) {
    const purchaseOrderId = `${f.prefix}-po-${key}`;
    await seed(f, async (trx) => {
      const interaction = await trx
        .insertInto("supplierInteraction")
        .values({ supplierId: f.supplierId, companyId: f.companyId })
        .returning("id")
        .executeTakeFirstOrThrow();
      await trx
        .insertInto("purchaseOrder")
        .values({
          id: purchaseOrderId,
          purchaseOrderId: `PO-${key}`,
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
        .values({
          purchaseOrderId,
          purchaseOrderLineType: "Part",
          itemId,
          purchaseQuantity: quantity,
          supplierUnitPrice: 10,
          exchangeRate: 1,
          conversionFactor: 1,
          inventoryUnitOfMeasureCode: "EA",
          locationId: f.locationId,
          companyId: f.companyId,
          createdBy: USER
        })
        .execute();
    });
    const receipt = unwrap(
      await invokeCreate(handlesOf(f.ctx), {
        type: "receiptFromPurchaseOrder",
        purchaseOrderId,
        locationId: f.locationId
      })
    );
    const line = await f.db
      .selectFrom("receiptLine")
      .where("receiptId", "=", receipt.id)
      .where("companyId", "=", f.companyId)
      .select("id")
      .executeTakeFirstOrThrow();
    return { receiptId: receipt.id, receiptLineId: line.id };
  }

  async function entitiesOf(receiptId: string) {
    return f.db
      .selectFrom("trackedEntity")
      .where(sql<boolean>`attributes ->> 'Receipt' = ${receiptId}`)
      .where("companyId", "=", f.companyId)
      .select(["id", "status", "quantity"])
      .orderBy("readableId")
      .execute();
  }

  databaseTest(
    "a voided batch receipt leaves its batch at zero, not Available",
    async () => {
      const { receiptId, receiptLineId } = await draftReceipt(
        "batch",
        batchItemId,
        5
      );
      await sql`SELECT update_receipt_line_batch_tracking(
        ${receiptLineId}, ${receiptId}, ${"LOT-1"}, ${5}
      )`.execute(f.db);

      unwrap(await invokePosting(handlesOf(f.ctx), "post-receipt", { type: "post", receiptId }, postReceipt));
      expect(
        (await entitiesOf(receiptId)).map(({ status, quantity }) => ({
          status,
          quantity: Number(quantity)
        }))
      ).toEqual([{ status: "Available", quantity: 5 }]);

      unwrap(await invokePosting(handlesOf(f.ctx), "post-receipt", { type: "void", receiptId }, postReceipt));
      const [lot] = await entitiesOf(receiptId);
      expect({ status: lot!.status, quantity: Number(lot!.quantity) }).toEqual({
        status: "Consumed",
        quantity: 0
      });

      // The void activity records what was un-received, not the zero left.
      const input = await f.db
        .selectFrom("trackedActivityInput")
        .innerJoin(
          "trackedActivity",
          "trackedActivity.id",
          "trackedActivityInput.trackedActivityId"
        )
        .where("trackedActivityInput.trackedEntityId", "=", lot!.id)
        .where("trackedActivity.type", "=", "Void Receipt")
        .select("trackedActivityInput.quantity")
        .executeTakeFirstOrThrow();
      expect(Number(input.quantity)).toBe(5);
    }
  );

  databaseTest(
    "a voided serial receipt does not release a unit On Hold for inspection",
    async () => {
      const { receiptId, receiptLineId } = await draftReceipt(
        "serial",
        serialItemId,
        2
      );
      for (const [index, serial] of ["SN-1", "SN-2"].entries()) {
        await sql`SELECT update_receipt_line_serial_tracking(
          ${receiptLineId}, ${receiptId}, ${serial}, ${index}
        )`.execute(f.db);
      }

      unwrap(await invokePosting(handlesOf(f.ctx), "post-receipt", { type: "post", receiptId }, postReceipt));
      // One unit waits on a receipt inspection, the other was rejected by it.
      const [held, rejected] = await entitiesOf(receiptId);
      await seed(f, async (trx) => {
        await trx
          .updateTable("trackedEntity")
          .set({ status: "On Hold" })
          .where("id", "=", held!.id)
          .execute();
        await trx
          .updateTable("trackedEntity")
          .set({ status: "Rejected" })
          .where("id", "=", rejected!.id)
          .execute();
      });

      unwrap(await invokePosting(handlesOf(f.ctx), "post-receipt", { type: "void", receiptId }, postReceipt));
      expect(
        (await entitiesOf(receiptId)).map(({ status, quantity }) => ({
          status,
          quantity: Number(quantity)
        }))
      ).toEqual([
        { status: "Consumed", quantity: 0 },
        { status: "Rejected", quantity: 0 }
      ]);
    }
  );

  async function onHand(itemId: string) {
    const rows = await f.db
      .selectFrom("itemLedger")
      .where("itemId", "=", itemId)
      .where("companyId", "=", f.companyId)
      .groupBy(["storageUnitId", "trackedEntityId"])
      .select([
        "storageUnitId",
        (eb) => eb.fn.sum<number>("quantity").as("quantity")
      ])
      .execute();
    return rows
      .map((row) => ({
        bin: row.storageUnitId,
        quantity: Number(row.quantity)
      }))
      .filter((row) => row.quantity !== 0);
  }

  async function receiptStatus(receiptId: string) {
    const receipt = await f.db
      .selectFrom("receipt")
      .select("status")
      .where("id", "=", receiptId)
      .executeTakeFirstOrThrow();
    return receipt.status;
  }

  databaseTest(
    "refuses a void after the received batch moved to another bin",
    async () => {
      const { receiptId, receiptLineId } = await draftReceipt(
        "moved",
        batchItemId,
        4
      );
      await sql`SELECT update_receipt_line_batch_tracking(
        ${receiptLineId}, ${receiptId}, ${"LOT-MOVED"}, ${4}
      )`.execute(f.db);
      unwrap(await invokePosting(handlesOf(f.ctx), "post-receipt", { type: "post", receiptId }, postReceipt));
      const [lot] = await entitiesOf(receiptId);
      const before = await onHand(batchItemId);
      const receivedBin = before[0]!.bin;

      // A stock transfer moves the whole batch to another bin.
      await seed(f, (trx) =>
        trx
          .insertInto("itemLedger")
          .values(
            [
              { storageUnitId: receivedBin, quantity: -4 },
              { storageUnitId: otherBin, quantity: 4 }
            ].map((move) => ({
              ...move,
              itemId: batchItemId,
              trackedEntityId: lot!.id,
              locationId: f.locationId,
              entryType: "Transfer" as const,
              documentType: "Direct Transfer" as const,
              companyId: f.companyId,
              createdBy: USER
            }))
          )
          .execute()
      );
      const moved = await onHand(batchItemId);

      const result = await invokePosting(handlesOf(f.ctx), "post-receipt", { type: "void", receiptId }, postReceipt);
      expect(result.error?.message).toMatch(/moved, picked or shipped/);
      expect(await receiptStatus(receiptId)).toBe("Posted");
      expect(await onHand(batchItemId)).toEqual(moved);
      const [after] = await entitiesOf(receiptId);
      expect(after!.status).toBe("Available");
    }
  );

  databaseTest(
    "a serial from a voided receipt can be received again as the same unit",
    async () => {
      const first = await draftReceipt("again-1", serialItemId, 1);
      await sql`SELECT update_receipt_line_serial_tracking(
        ${first.receiptLineId}, ${first.receiptId}, ${"SN-AGAIN"}, ${0}
      )`.execute(f.db);
      unwrap(
        await invokePosting(handlesOf(f.ctx), "post-receipt", { type: "post", receiptId: first.receiptId }, postReceipt)
      );
      unwrap(
        await invokePosting(handlesOf(f.ctx), "post-receipt", { type: "void", receiptId: first.receiptId }, postReceipt)
      );
      const [unit] = await entitiesOf(first.receiptId);

      // Its movements are the receipt and its void, so it is free to receive.
      expect(await idsWithStockHistory(f.db, f.companyId, [unit!.id])).toEqual(
        new Set([unit!.id])
      );
      expect(
        await idsWithLiveStockHistory(f.db, f.companyId, [unit!.id])
      ).toEqual(new Set());

      const second = await draftReceipt("again-2", serialItemId, 1);
      await sql`SELECT update_receipt_line_serial_tracking(
        p_receipt_line_id => ${second.receiptLineId},
        p_receipt_id => ${second.receiptId},
        p_serial_number => ${"SN-AGAIN"},
        p_index => ${0}::int,
        p_tracked_entity_id => ${unit!.id}::text
      )`.execute(f.db);
      unwrap(
        await invokePosting(handlesOf(f.ctx), "post-receipt", { type: "post", receiptId: second.receiptId }, postReceipt)
      );

      const [received] = await entitiesOf(second.receiptId);
      expect(received!.id).toBe(unit!.id);
      expect({
        status: received!.status,
        quantity: Number(received!.quantity)
      }).toEqual({ status: "Available", quantity: 1 });
      expect(
        await idsWithLiveStockHistory(f.db, f.companyId, [unit!.id])
      ).toEqual(new Set([unit!.id]));
    }
  );

  databaseTest(
    "the inspection of a voided receipt can no longer be dispositioned",
    async () => {
      const { receiptId } = await draftReceipt("inspect", inspectedItemId, 2);
      unwrap(await invokePosting(handlesOf(f.ctx), "post-receipt", { type: "post", receiptId }, postReceipt));
      unwrap(await invokePosting(handlesOf(f.ctx), "post-receipt", { type: "void", receiptId }, postReceipt));
      const lot = await f.db
        .selectFrom("inspection")
        .select("id")
        .where("sourceDocumentId", "=", receiptId)
        .executeTakeFirstOrThrow();

      const sample = await upsertInspectionSample(f.db, {
        inspectionId: lot.id,
        status: "Failed",
        companyId: f.companyId,
        inspectedBy: USER
      });
      expect(sample.error?.message).toBe(
        "The receipt of this inspection was voided"
      );
      const reject = await dispositionInspection(f.db, {
        id: lot.id,
        decision: "Reject",
        companyId: f.companyId,
        dispositionedBy: USER
      });
      expect(reject.error?.message).toBe(
        "The receipt of this inspection was voided"
      );
    }
  );

  databaseTest(
    "refuses a void after an inspection rejected and wrote off untracked stock",
    async () => {
      const { receiptId } = await draftReceipt("rejected", inspectedItemId, 2);
      unwrap(await invokePosting(handlesOf(f.ctx), "post-receipt", { type: "post", receiptId }, postReceipt));
      const lot = await f.db
        .selectFrom("inspection")
        .select(["id", "inspectionId"])
        .where("sourceDocumentId", "=", receiptId)
        .executeTakeFirstOrThrow();
      expect(
        (
          await upsertInspectionSample(f.db, {
            inspectionId: lot.id,
            status: "Failed",
            companyId: f.companyId,
            inspectedBy: USER
          })
        ).error
      ).toBeNull();
      const reject = await dispositionInspection(f.db, {
        id: lot.id,
        decision: "Reject",
        companyId: f.companyId,
        dispositionedBy: USER
      });
      expect(reject.data?.writeOff?.quantity).toBe(-2);

      const result = await invokePosting(handlesOf(f.ctx), "post-receipt", { type: "void", receiptId }, postReceipt);
      expect(result.error?.message).toBe(
        `Cannot void: inspection ${lot.inspectionId} rejected this stock and wrote it off. Correct the remainder with an inventory adjustment instead.`
      );
      expect(await receiptStatus(receiptId)).toBe("Posted");
    }
  );
});
