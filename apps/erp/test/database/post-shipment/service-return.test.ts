// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Shipping a serviced unit back on its RMA posts no value, counts the unit
// shipped and puts its asset back In Service. A sales order line that
// replaces a Return for Warranty line ships to Warranty Expense.

import { sql } from "kysely";
import { expect } from "vitest";
import { databaseTest } from "../fixtures/local-database";
import { serviceReturnFixture } from "../fixtures/service-return";

type Fixture = Awaited<ReturnType<typeof serviceReturnFixture>>;

async function completeJob(f: Fixture, lineId: string) {
  await f.db
    .updateTable("serviceJob")
    .set({ status: "Completed", repairable: true })
    .where("salesReturnOrderLineId", "=", lineId)
    .where("companyId", "=", f.companyId)
    .execute();
}

databaseTest(
  "shipping a repaired unit back writes no journal, counts it shipped, puts its asset In Service and completes the RMA; a void undoes it",
  async () => {
    const f = await serviceReturnFixture();
    try {
      const serialId = await f.addSerial();
      const { rmaId, lineIds } = await f.addRma([
        { itemId: f.serialItemId, returnType: "Return for Service" }
      ]);
      const [lineId] = lineIds as [string];
      const received = await f.receive(rmaId, { [lineId]: serialId });
      expect(received.posted.error).toBeNull();

      // The job is still open: there is nothing to ship back yet.
      await expect(f.shipBack(rmaId)).rejects.toThrow(
        "have a completed service job"
      );

      await completeJob(f, lineId);
      const { shipmentId, posted } = await f.shipBack(rmaId, {
        [lineId]: serialId
      });
      expect(posted.error).toBeNull();

      expect(await f.documentJournalLines(shipmentId)).toEqual([]);
      const ledger = await f.db
        .selectFrom("itemLedger")
        .select("id")
        .where("documentId", "=", shipmentId)
        .execute();
      expect(ledger).toEqual([]);
      expect(await f.returnLines(rmaId)).toEqual([
        { id: lineId, quantityReceived: 1, quantityShipped: 1 }
      ]);
      const asset = await f.db
        .selectFrom("customerAsset")
        .select(["status", "shipmentId"])
        .where("trackedEntityId", "=", serialId)
        .executeTakeFirstOrThrow();
      expect(asset).toEqual({ status: "In Service", shipmentId });
      const serial = await f.db
        .selectFrom("trackedEntity")
        .select("status")
        .where("id", "=", serialId)
        .executeTakeFirstOrThrow();
      expect(serial.status).toBe("Consumed");
      expect(await f.rmaStatus(rmaId)).toBe("Completed");

      const voided = await f.postShipment("void", shipmentId);
      expect(voided.error).toBeNull();
      expect(await f.returnLines(rmaId)).toEqual([
        { id: lineId, quantityReceived: 1, quantityShipped: 0 }
      ]);
      const assetAfter = await f.db
        .selectFrom("customerAsset")
        .select("status")
        .where("trackedEntityId", "=", serialId)
        .executeTakeFirstOrThrow();
      expect(assetAfter.status).toBe("At Depot");
      const serialAfter = await f.db
        .selectFrom("trackedEntity")
        .select("status")
        .where("id", "=", serialId)
        .executeTakeFirstOrThrow();
      expect(serialAfter.status).toBe("Consumed");
      expect(await f.rmaStatus(rmaId)).toBe("In Progress");
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "a replacement sales order line that names a Warranty RMA line posts Dr Warranty Expense / Cr Inventory",
  async () => {
    const f = await serviceReturnFixture();
    try {
      const { rmaId, lineIds } = await f.addRma([
        { itemId: f.unitItemId, returnType: "Return for Warranty" }
      ]);
      const [warrantyLineId] = lineIds as [string];
      const received = await f.receive(rmaId);
      expect(received.posted.error).toBeNull();

      const id = (name: string) => `${f.prefix}-${name}`;
      await f.db.transaction().execute(async (trx) => {
        await sql`SET LOCAL "app.sync_in_progress" = 'true'`.execute(trx);
        await trx
          .insertInto("salesOrder")
          .values({
            id: id("so"),
            salesOrderId: id("SO"),
            customerId: f.customerId,
            currencyCode: "USD",
            companyId: f.companyId,
            createdBy: "system"
          })
          .execute();
        await trx
          .insertInto("salesOrderShipment")
          .values({ id: id("so"), companyId: f.companyId })
          .onConflict((oc) => oc.column("id").doNothing())
          .execute();
        await trx
          .insertInto("salesOrderLine")
          .values({
            id: id("sol"),
            salesOrderId: id("so"),
            salesOrderLineType: "Part",
            itemId: f.stockItemId,
            saleQuantity: 1,
            unitPrice: 0,
            locationId: f.locationId,
            salesReturnOrderLineId: warrantyLineId,
            companyId: f.companyId,
            createdBy: "system"
          })
          .execute();
        await trx
          .insertInto("shipment")
          .values({
            id: id("shipment"),
            shipmentId: id("SHP"),
            sourceDocument: "Sales Order",
            sourceDocumentId: id("so"),
            locationId: f.locationId,
            customerId: f.customerId,
            status: "Pending",
            companyId: f.companyId,
            createdBy: "system"
          })
          .execute();
        await trx
          .insertInto("shipmentLine")
          .values({
            id: id("shl"),
            shipmentId: id("shipment"),
            lineId: id("sol"),
            itemId: f.stockItemId,
            orderQuantity: 1,
            outstandingQuantity: 1,
            shippedQuantity: 1,
            locationId: f.locationId,
            unitOfMeasure: "EA",
            unitPrice: 0,
            companyId: f.companyId,
            createdBy: "system"
          })
          .execute();
      });

      const posted = await f.postShipment("post", id("shipment"));
      expect(posted.error).toBeNull();
      expect(await f.documentJournalLines(id("shipment"))).toEqual([
        [f.account("warranty"), 25],
        [f.account("inventory"), -25]
      ]);
      const debit = await f.db
        .selectFrom("journalLine")
        .select("description")
        .where("documentId", "=", id("shipment"))
        .where("accountId", "=", f.account("warranty"))
        .executeTakeFirstOrThrow();
      expect(debit.description).toBe("Warranty Expense");

      // The void reverses the same accounts.
      const voided = await f.postShipment("void", id("shipment"));
      expect(voided.error).toBeNull();
      const lines = await f.documentJournalLines(id("shipment"));
      expect(lines).toHaveLength(4);
      const byAccount = new Map<string, number>();
      for (const [account, amount] of lines as [string, number][]) {
        byAccount.set(account, (byAccount.get(account) ?? 0) + amount);
      }
      expect(Object.fromEntries(byAccount)).toEqual({
        [f.account("warranty")]: 0,
        [f.account("inventory")]: 0
      });
    } finally {
      await f.cleanup();
    }
  }
);
