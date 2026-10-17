// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Runs against the local database (SUPABASE_DB_URL); skipped without one.

// A serial leaves the bin it is actually in. A sales shipment booked it against
// the line's bin, and a stock transfer pick took it from wherever it sat, so a
// bin it was never in went negative while the real bin kept a unit that had
// already left.

import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect } from "vitest";
import {
  alwaysPostFixture,
  type Fixture,
  seed,
  USER,
  unwrap
} from "./fixtures/always-post";
import { databaseTest, hasLocalDatabase } from "./fixtures/local-database";
import {
  postShipment,
  postStockTransfer
} from "../../app/modules/inventory/inventory.service";
import {
  invokePosting,
  invokeCreate
} from "../../app/modules/shared/shared.service";
import { handlesOf } from "./fixtures/handles";
describe.skipIf(!hasLocalDatabase)("tracked entity source bin", () => {
  let f: Fixture;
  let serialItemId: string;
  let batchItemId: string;
  let aftersales: string;
  let readyToSell: string;

  beforeAll(async () => {
    f = await alwaysPostFixture();
    serialItemId = `${f.prefix}-serial`;
    batchItemId = `${f.prefix}-batch`;
    aftersales = `${f.prefix}-aftersales`;
    readyToSell = `${f.prefix}-ready`;
    await seed(f, async (trx) => {
      await trx
        .insertInto("item")
        .values([
          {
            id: serialItemId,
            readableId: `${f.prefix}-VEH`,
            name: "Vehicle",
            type: "Part",
            itemTrackingType: "Serial",
            replenishmentSystem: "Buy",
            companyId: f.companyId,
            createdBy: USER
          },
          {
            id: batchItemId,
            readableId: `${f.prefix}-OIL`,
            name: "Oil",
            type: "Part",
            itemTrackingType: "Batch",
            replenishmentSystem: "Buy",
            companyId: f.companyId,
            createdBy: USER
          }
        ])
        .execute();
      await trx
        .updateTable("itemCost")
        .set({ costingMethod: "FIFO", unitCost: 10 })
        .where("itemId", "in", [serialItemId, batchItemId])
        .where("companyId", "=", f.companyId)
        .execute();
      await trx
        .insertInto("storageUnit")
        .values([
          {
            id: aftersales,
            name: "Aftersales",
            locationId: f.locationId,
            companyId: f.companyId,
            createdBy: USER
          },
          {
            id: readyToSell,
            name: "Ready to Sell",
            locationId: f.locationId,
            companyId: f.companyId,
            createdBy: USER
          }
        ])
        .execute();
    });
  });

  afterAll(async () => {
    await f?.cleanup();
  });

  /** A serial or batch on hand in `bin` (`null` = no storage unit), or with no stock. */
  async function stockIn(
    key: string,
    bin: string | null | "none",
    lot: { itemId: string; quantity: number } = {
      itemId: serialItemId,
      quantity: 1
    }
  ) {
    const id = `${f.prefix}-te-${key}`;
    await seed(f, async (trx) => {
      await trx
        .insertInto("trackedEntity")
        .values({
          id,
          readableId: `SN-${key}`,
          quantity: lot.quantity,
          status: "Available",
          sourceDocument: "Item",
          sourceDocumentId: lot.itemId,
          itemId: lot.itemId,
          companyId: f.companyId,
          createdBy: USER
        })
        .execute();
      if (bin === "none") return;
      await trx
        .insertInto("itemLedger")
        .values({
          itemId: lot.itemId,
          trackedEntityId: id,
          quantity: lot.quantity,
          locationId: f.locationId,
          storageUnitId: bin,
          entryType: "Positive Adjmt.",
          companyId: f.companyId,
          createdBy: USER
        })
        .execute();
    });
    return id;
  }

  async function onHand(trackedEntityId: string) {
    const rows = await f.db
      .selectFrom("itemLedger")
      .where("trackedEntityId", "=", trackedEntityId)
      .where("companyId", "=", f.companyId)
      .groupBy("storageUnitId")
      .select(["storageUnitId", (eb) => eb.fn.sum<number>("quantity").as("q")])
      .execute();
    return Object.fromEntries(
      rows.map((r) => [r.storageUnitId ?? "none", Number(r.q)])
    );
  }

  /** A sales-order shipment whose line names Ready to Sell. */
  async function shipmentFor(
    key: string,
    trackedEntityId: string,
    line: { itemId: string; quantity: number } = {
      itemId: serialItemId,
      quantity: 1
    }
  ) {
    const salesOrderId = `${f.prefix}-so-${key}`;
    await seed(f, async (trx) => {
      await trx
        .insertInto("salesOrder")
        .values({
          id: salesOrderId,
          salesOrderId: `SO-${key}`,
          customerId: f.customerId,
          currencyCode: "USD",
          exchangeRate: 1,
          locationId: f.locationId,
          companyId: f.companyId,
          createdBy: USER
        })
        .execute();
      await trx
        .insertInto("salesOrderShipment")
        .values({ id: salesOrderId, companyId: f.companyId })
        .execute();
      await trx
        .insertInto("salesOrderLine")
        .values({
          salesOrderId,
          salesOrderLineType: "Part",
          itemId: line.itemId,
          saleQuantity: line.quantity,
          unitPrice: 25,
          methodType: "Pull from Inventory",
          unitOfMeasureCode: "EA",
          locationId: f.locationId,
          storageUnitId: readyToSell,
          companyId: f.companyId,
          createdBy: USER
        })
        .execute();
    });
    const shipment = unwrap(
      await invokeCreate(handlesOf(f.ctx), {
        type: "shipmentFromSalesOrder",
        salesOrderId,
        locationId: f.locationId
      })
    );
    const shipmentLine = await f.db
      .selectFrom("shipmentLine")
      .where("shipmentId", "=", shipment.id)
      .select(["id", "storageUnitId"])
      .executeTakeFirstOrThrow();
    expect(shipmentLine.storageUnitId).toBe(readyToSell);
    await seed(f, (trx) =>
      trx
        .updateTable("trackedEntity")
        .set({
          attributes: JSON.stringify({
            Shipment: shipment.id,
            "Shipment Line": shipmentLine.id,
            "Shipment Line Index": 0
          })
        })
        .where("id", "=", trackedEntityId)
        .execute()
    );
    return shipment.id;
  }

  databaseTest(
    "a shipment takes the serial from the bin it is in, and a void puts it back there",
    async () => {
      const serial = await stockIn("ship", aftersales);
      const shipmentId = await shipmentFor("ship", serial);

      unwrap(
        await invokePosting(
          handlesOf(f.ctx),
          "post-shipment",
          { type: "post", shipmentId },
          postShipment
        )
      );
      expect(await onHand(serial)).toEqual({ [aftersales]: 0 });

      unwrap(
        await invokePosting(
          handlesOf(f.ctx),
          "post-shipment",
          { type: "void", shipmentId },
          postShipment
        )
      );
      expect(await onHand(serial)).toEqual({ [aftersales]: 1 });
    }
  );

  databaseTest(
    "a shipment takes a serial with no storage unit from no storage unit",
    async () => {
      const serial = await stockIn("ship-unassigned", null);
      const shipmentId = await shipmentFor("ship-unassigned", serial);

      unwrap(
        await invokePosting(
          handlesOf(f.ctx),
          "post-shipment",
          { type: "post", shipmentId },
          postShipment
        )
      );
      expect(await onHand(serial)).toEqual({ none: 0 });
    }
  );

  databaseTest(
    "a partial batch shipment splits and ships from the batch's own bin",
    async () => {
      const lot = { itemId: batchItemId, quantity: 10 };
      const batch = await stockIn("ship-batch", aftersales, lot);
      const shipmentId = await shipmentFor("ship-batch", batch, {
        itemId: batchItemId,
        quantity: 4
      });

      unwrap(
        await invokePosting(
          handlesOf(f.ctx),
          "post-shipment",
          { type: "post", shipmentId },
          postShipment
        )
      );

      const byBin = await f.db
        .selectFrom("itemLedger")
        .where("itemId", "=", batchItemId)
        .where("companyId", "=", f.companyId)
        .groupBy("storageUnitId")
        .select([
          "storageUnitId",
          (eb) => eb.fn.sum<number>("quantity").as("q")
        ])
        .execute();
      expect(
        Object.fromEntries(byBin.map((r) => [r.storageUnitId, Number(r.q)]))
      ).toEqual({ [aftersales]: 6 });
      expect(await onHand(batch)).toEqual({ [aftersales]: 6 });
    }
  );

  databaseTest(
    "a shipment refuses a batch whose bin cannot cover the quantity",
    async () => {
      const lot = { itemId: batchItemId, quantity: 6 };
      const batch = await stockIn("ship-batch-spread", aftersales, lot);
      // The same batch also holds 4 in another bin, so 10 in total.
      await seed(f, (trx) =>
        trx
          .insertInto("itemLedger")
          .values({
            itemId: batchItemId,
            trackedEntityId: batch,
            quantity: 4,
            locationId: f.locationId,
            storageUnitId: readyToSell,
            entryType: "Positive Adjmt.",
            companyId: f.companyId,
            createdBy: USER
          })
          .execute()
      );
      await seed(f, (trx) =>
        trx
          .updateTable("trackedEntity")
          .set({ quantity: 10 })
          .where("id", "=", batch)
          .execute()
      );
      const shipmentId = await shipmentFor("ship-batch-spread", batch, {
        itemId: batchItemId,
        quantity: 8
      });

      const result = await invokePosting(
        handlesOf(f.ctx),
        "post-shipment",
        { type: "post", shipmentId },
        postShipment
      );
      expect(result.error?.message).toMatch(
        /SN-ship-batch-spread has only 6 in one storage unit, 8 needed/
      );
      expect(await onHand(batch)).toEqual({
        [aftersales]: 6,
        [readyToSell]: 4
      });
    }
  );

  databaseTest("a shipment refuses a serial with no stock", async () => {
    const serial = await stockIn("ship-empty", "none");
    const shipmentId = await shipmentFor("ship-empty", serial);

    const result = await invokePosting(
      handlesOf(f.ctx),
      "post-shipment",
      { type: "post", shipmentId },
      postShipment
    );
    expect(result.error?.message).toMatch(/SN-ship-empty has no stock/);
    expect(await onHand(serial)).toEqual({});
  });

  /** A transfer line moving one serial from `from` to the other bin. */
  async function transferLine(key: string, from: string | null) {
    const stockTransferId = `${f.prefix}-st-${key}`;
    const lineId = `${f.prefix}-stl-${key}`;
    await seed(f, async (trx) => {
      await trx
        .insertInto("stockTransfer")
        .values({
          id: stockTransferId,
          stockTransferId: `ST-${key}`,
          locationId: f.locationId,
          status: "In Progress",
          companyId: f.companyId,
          createdBy: USER
        })
        .execute();
      await trx
        .insertInto("stockTransferLine")
        .values({
          id: lineId,
          stockTransferId,
          itemId: serialItemId,
          quantity: 1,
          requiresSerialTracking: true,
          fromStorageUnitId: from,
          toStorageUnitId: from === readyToSell ? aftersales : readyToSell,
          companyId: f.companyId,
          createdBy: USER
        })
        .execute();
    });
    return (trackedEntityId: string) =>
      invokePosting(
        f.service,
        "post-stock-transfer",
        {
          type: "serial",
          stockTransferId,
          stockTransferLineId: lineId,
          trackedEntityId,
          locationId: f.locationId
        },
        postStockTransfer
      );
  }

  databaseTest(
    "a transfer pick moves the serial out of the line's source bin",
    async () => {
      const serial = await stockIn("pick", aftersales);
      const pick = await transferLine("pick", aftersales);

      unwrap(await pick(serial));
      expect(await onHand(serial)).toEqual({
        [aftersales]: 0,
        [readyToSell]: 1
      });
    }
  );

  databaseTest(
    "a transfer pick refuses a serial held in another bin",
    async () => {
      const serial = await stockIn("pick-elsewhere", readyToSell);
      const pick = await transferLine("pick-elsewhere", aftersales);

      const result = await pick(serial);
      expect(result.error?.message).toMatch(
        /SN-pick-elsewhere is not in this line's source storage unit/
      );
      expect(await onHand(serial)).toEqual({ [readyToSell]: 1 });
    }
  );

  databaseTest(
    "the picker query lists only the source bin, and NULL is no storage unit",
    async () => {
      const unassigned = await stockIn("rpc-unassigned", null);
      const binned = await stockIn("rpc-binned", aftersales);
      const available = async (filter: boolean, bin: string | null) => {
        const { rows } = await sql<{ trackedEntityId: string }>`
          SELECT "trackedEntityId" FROM get_available_tracked_entities(
            p_item_id => ${serialItemId},
            p_company_id => ${f.companyId},
            p_location_id => ${f.locationId},
            p_filter_storage_unit => ${filter},
            p_storage_unit_id => ${bin}
          )`.execute(f.db);
        return rows.map((r) => r.trackedEntityId);
      };

      expect(await available(true, null)).toContain(unassigned);
      expect(await available(true, null)).not.toContain(binned);
      expect(await available(true, aftersales)).toContain(binned);
      expect(await available(true, aftersales)).not.toContain(unassigned);
      expect(await available(false, null)).toEqual(
        expect.arrayContaining([unassigned, binned])
      );
    }
  );

  databaseTest(
    "an empty source bin means no storage unit, not any bin",
    async () => {
      const unassigned = await stockIn("pick-unassigned", null);
      const binned = await stockIn("pick-binned", aftersales);

      unwrap(await (await transferLine("pick-unassigned", null))(unassigned));
      expect(await onHand(unassigned)).toEqual({ none: 0, [readyToSell]: 1 });

      const result = await (await transferLine("pick-binned", null))(binned);
      expect(result.error?.message).toMatch(/not in this line's source/);
    }
  );
});
