// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Runs against the local database (SUPABASE_DB_URL); skipped without one.

// A return shipment (to the supplier or back to the customer) booked each
// serial or batch row at the shipment line's bin, often no storage unit, so
// that bin went negative while the bin the unit was moved to kept it. A unit
// now leaves the bin it holds stock in, as a sales order shipment does; a
// partial batch splits there, and the void puts it back there.

import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect } from "vitest";
import {
  alwaysPostFixture,
  type Fixture,
  seed,
  USER,
  unwrap
} from "./fixtures/always-post";
import { handlesOf } from "./fixtures/handles";
import { databaseTest, hasLocalDatabase } from "./fixtures/local-database";
import { postShipment } from "../../app/modules/inventory/inventory.service";
import {
  invokeCreate,
  invokePosting
} from "../../app/modules/shared/shared.service";

describe.skipIf(!hasLocalDatabase)("return shipment tracked bins", () => {
  let f: Fixture;
  let serialItemId: string;
  let batchItemId: string;
  let received: string;
  let moved: string;

  beforeAll(async () => {
    f = await alwaysPostFixture();
    serialItemId = `${f.prefix}-serial`;
    batchItemId = `${f.prefix}-batch`;
    received = `${f.prefix}-received`;
    moved = `${f.prefix}-moved`;
    await seed(f, async (trx) => {
      await trx
        .insertInto("item")
        .values([
          {
            id: serialItemId,
            readableId: `${f.prefix}-PUMP`,
            name: "Pump",
            type: "Part",
            itemTrackingType: "Serial",
            unitOfMeasureCode: "EA",
            replenishmentSystem: "Buy",
            companyId: f.companyId,
            createdBy: USER
          },
          {
            id: batchItemId,
            readableId: `${f.prefix}-RESIN`,
            name: "Resin",
            type: "Part",
            itemTrackingType: "Batch",
            unitOfMeasureCode: "EA",
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
            id: received,
            name: "Receiving",
            locationId: f.locationId,
            companyId: f.companyId,
            createdBy: USER
          },
          {
            id: moved,
            name: "Shelf X",
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

  /**
   * A unit received into Receiving, then moved to Shelf X by a transfer (or,
   * with `moveTo: "none"`, never stocked at all).
   */
  async function unitIn(
    key: string,
    lot: { itemId: string; quantity: number; status: "Available" | "On Hold" },
    moveTo: string | "none" = moved
  ) {
    const id = `${f.prefix}-te-${key}`;
    await seed(f, async (trx) => {
      await trx
        .insertInto("trackedEntity")
        .values({
          id,
          readableId: `SN-${key}`,
          quantity: lot.quantity,
          status: lot.status,
          sourceDocument: "Item",
          sourceDocumentId: lot.itemId,
          itemId: lot.itemId,
          companyId: f.companyId,
          createdBy: USER
        })
        .execute();
      if (moveTo === "none") return;
      const row = (storageUnitId: string, quantity: number) => ({
        itemId: lot.itemId,
        trackedEntityId: id,
        quantity,
        locationId: f.locationId,
        storageUnitId,
        entryType: quantity > 0 ? "Positive Adjmt." : "Transfer",
        companyId: f.companyId,
        createdBy: USER
      });
      await trx
        .insertInto("itemLedger")
        .values([
          { ...row(received, lot.quantity), entryType: "Positive Adjmt." },
          { ...row(received, -lot.quantity), entryType: "Transfer" },
          { ...row(moveTo, lot.quantity), entryType: "Transfer" }
        ])
        .execute();
    });
    return id;
  }

  /** On-hand of the given units per bin. */
  async function onHand(trackedEntityIds: string[]) {
    const rows = await f.db
      .selectFrom("itemLedger")
      .where("trackedEntityId", "in", trackedEntityIds)
      .where("companyId", "=", f.companyId)
      .groupBy("storageUnitId")
      .select(["storageUnitId", (eb) => eb.fn.sum<number>("quantity").as("q")])
      .execute();
    return Object.fromEntries(
      rows.map((r) => [r.storageUnitId ?? "none", Number(r.q)])
    );
  }

  /** Tags the unit to the shipment's only line, which names Receiving. */
  async function tagToShipment(shipmentId: string, trackedEntityId: string) {
    const line = await f.db
      .selectFrom("shipmentLine")
      .where("shipmentId", "=", shipmentId)
      .where("companyId", "=", f.companyId)
      .select("id")
      .executeTakeFirstOrThrow();
    await seed(f, async (trx) => {
      await trx
        .updateTable("shipmentLine")
        .set({ storageUnitId: received })
        .where("id", "=", line.id)
        .where("companyId", "=", f.companyId)
        .execute();
      await trx
        .updateTable("trackedEntity")
        .set({
          attributes: JSON.stringify({
            Shipment: shipmentId,
            "Shipment Line": line.id,
            "Shipment Line Index": 0
          })
        })
        .where("id", "=", trackedEntityId)
        .where("companyId", "=", f.companyId)
        .execute();
    });
  }

  /** A To Ship purchase return of `quantity`, its shipment created and tagged. */
  async function purchaseReturn(
    key: string,
    itemId: string,
    quantity: number,
    trackedEntityId: string
  ) {
    const returnId = `${f.prefix}-pro-${key}`;
    await seed(f, async (trx) => {
      await trx
        .insertInto("purchaseReturnOrder")
        .values({
          id: returnId,
          purchaseReturnOrderId: `PRO-${key}`,
          supplierId: f.supplierId,
          currencyCode: "USD",
          orderDate: f.today,
          locationId: f.locationId,
          status: "To Ship",
          companyId: f.companyId,
          createdBy: USER
        })
        .execute();
      await trx
        .insertInto("purchaseReturnOrderLine")
        .values({
          purchaseReturnOrderId: returnId,
          itemId,
          quantity,
          companyId: f.companyId,
          createdBy: USER
        })
        .execute();
    });
    const shipment = unwrap(
      await invokeCreate(handlesOf(f.ctx), {
        type: "shipmentFromPurchaseReturnOrder",
        purchaseReturnOrderId: returnId,
        locationId: f.locationId
      })
    ) as { id: string };
    await tagToShipment(shipment.id, trackedEntityId);
    return shipment.id;
  }

  /** A received RMA line dispositioned Return to Customer, its shipment tagged. */
  async function salesReturn(
    key: string,
    itemId: string,
    trackedEntityId: string
  ) {
    const returnId = `${f.prefix}-rma-${key}`;
    await seed(f, async (trx) => {
      await trx
        .insertInto("salesReturnOrder")
        .values({
          id: returnId,
          salesReturnOrderId: `RMA-${key}`,
          customerId: f.customerId,
          currencyCode: "USD",
          orderDate: f.today,
          locationId: f.locationId,
          status: "Completed",
          companyId: f.companyId,
          createdBy: USER
        })
        .execute();
      await trx
        .insertInto("salesReturnOrderLine")
        .values({
          salesReturnOrderId: returnId,
          itemId,
          quantity: 1,
          quantityReceived: 1,
          returnType: "Return to Stock",
          disposition: "Return to Customer",
          companyId: f.companyId,
          createdBy: USER
        })
        .execute();
    });
    const shipment = unwrap(
      await invokeCreate(handlesOf(f.ctx), {
        type: "shipmentFromSalesReturnOrder",
        salesReturnOrderId: returnId,
        locationId: f.locationId
      })
    ) as { id: string };
    await tagToShipment(shipment.id, trackedEntityId);
    return shipment.id;
  }

  const post = (shipmentId: string, type: "post" | "void" = "post") =>
    invokePosting(
      handlesOf(f.ctx),
      "post-shipment",
      { type, shipmentId },
      postShipment
    );

  databaseTest(
    "a purchase return ships a serial from the bin it was moved to, and the void puts it back there",
    async () => {
      const serial = await unitIn("pro-serial", {
        itemId: serialItemId,
        quantity: 1,
        status: "Available"
      });
      const shipmentId = await purchaseReturn(
        "serial",
        serialItemId,
        1,
        serial
      );

      unwrap(await post(shipmentId));
      expect(await onHand([serial])).toEqual({ [received]: 0, [moved]: 0 });

      unwrap(await post(shipmentId, "void"));
      expect(await onHand([serial])).toEqual({ [received]: 0, [moved]: 1 });
    }
  );

  databaseTest(
    "a purchase return of part of a batch splits it in the bin it was moved to",
    async () => {
      const batch = await unitIn("pro-batch", {
        itemId: batchItemId,
        quantity: 10,
        status: "Available"
      });
      const shipmentId = await purchaseReturn("batch", batchItemId, 4, batch);

      unwrap(await post(shipmentId));

      const children = await f.db
        .selectFrom("trackedEntity")
        .where("companyId", "=", f.companyId)
        .where(sql<string>`attributes->>'Split From Entity ID'`, "=", batch)
        .select("id")
        .execute();
      expect(children).toHaveLength(1);
      // The shelf lot keeps 6 in Shelf X; the departing child nets to 0 there.
      expect(await onHand([batch])).toEqual({ [received]: 0, [moved]: 6 });
      expect(await onHand([children[0]!.id])).toEqual({ [moved]: 0 });
    }
  );

  databaseTest(
    "a purchase return refuses a serial with no stock at the location",
    async () => {
      const serial = await unitIn(
        "pro-empty",
        { itemId: serialItemId, quantity: 1, status: "Available" },
        "none"
      );
      const shipmentId = await purchaseReturn(
        "empty",
        serialItemId,
        1,
        serial
      );

      const result = await post(shipmentId);
      expect(result.error?.status).toBe(400);
      expect(result.error?.message).toMatch(/SN-pro-empty has no stock/);
      expect(await onHand([serial])).toEqual({});
    }
  );

  databaseTest(
    "a return to the customer ships a serial from the bin it was moved to",
    async () => {
      const serial = await unitIn("rma-serial", {
        itemId: serialItemId,
        quantity: 1,
        status: "On Hold"
      });
      const shipmentId = await salesReturn("serial", serialItemId, serial);

      unwrap(await post(shipmentId));
      expect(await onHand([serial])).toEqual({ [received]: 0, [moved]: 0 });

      unwrap(await post(shipmentId, "void"));
      expect(await onHand([serial])).toEqual({ [received]: 0, [moved]: 1 });
    }
  );
});
