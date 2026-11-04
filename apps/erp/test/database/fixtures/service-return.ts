// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// A scratch company for the RMA service-return regressions: the service job
// fixture's company plus the receipt, shipment and service job sequences, a
// FIFO stock part (10 on hand at 25.00), a serialized unit and a plain unit,
// and helpers to raise an RMA, receive it, and ship it back. Deleted by
// `cleanup()`.

import type { Database } from "@carbon/database";
import { sql } from "kysely";
import {
  postReceipt,
  postShipment
} from "../../../app/modules/inventory/inventory.service";
import {
  invokeCreate,
  invokePosting
} from "../../../app/modules/shared/shared.service";
import { handlesOf } from "./handles";
import { PROJECT_TEST_USER } from "./project-posting";
import { serviceJobFixture } from "./service-job";

type Enums = Database["public"]["Enums"];

export async function serviceReturnFixture() {
  const f = await serviceJobFixture();
  const { db, companyId, prefix } = f;
  const USER = PROJECT_TEST_USER;
  const stock = await f.addStockedItem("stock", { quantity: 10, unitCost: 25 });
  const locationId = stock.locationId;
  const serialItemId = `${prefix}-serial-item`;
  const unitItemId = `${prefix}-unit-item`;
  let rmaCount = 0;
  let serialCount = 0;

  await db.transaction().execute(async (trx) => {
    await sql`SET LOCAL "app.sync_in_progress" = 'true'`.execute(trx);
    await trx
      .insertInto("sequence")
      .values(
        (
          [
            ["receipt", "RCV-"],
            ["shipment", "SHP-"],
            ["serviceJob", "SJ-"]
          ] as const
        ).map(([table, seqPrefix]) => ({
          table,
          name: table,
          prefix: seqPrefix,
          companyId
        }))
      )
      .onConflict((oc) => oc.doNothing())
      .execute();
    await trx
      .insertInto("unitOfMeasure")
      .values({ code: "EA", name: "Each", companyId, createdBy: USER })
      .onConflict((oc) => oc.doNothing())
      .execute();
    await trx
      .insertInto("item")
      .values([
        {
          id: serialItemId,
          readableId: `${prefix}-PUMP`,
          name: "Pump",
          type: "Part",
          itemTrackingType: "Serial",
          replenishmentSystem: "Buy",
          companyId,
          createdBy: USER
        },
        {
          id: unitItemId,
          readableId: `${prefix}-VALVE`,
          name: "Valve",
          type: "Part",
          itemTrackingType: "Inventory",
          replenishmentSystem: "Buy",
          companyId,
          createdBy: USER
        }
      ])
      .execute();
  });

  const handles = handlesOf(f.ctx);
  const postReceiptAs = (type: "post" | "void", receiptId: string) =>
    invokePosting(handles, "post-receipt", { type, receiptId }, postReceipt);
  const postShipmentAs = (type: "post" | "void", shipmentId: string) =>
    invokePosting(handles, "post-shipment", { type, shipmentId }, postShipment);

  return {
    ...f,
    locationId,
    stockItemId: stock.itemId,
    serialItemId,
    unitItemId,
    /** A Consumed serial of the serialized unit: a unit the customer owns. */
    async addSerial() {
      serialCount += 1;
      const id = `${prefix}-sn-${serialCount}`;
      await db
        .insertInto("trackedEntity")
        .values({
          id,
          readableId: `SN-${serialCount}`,
          itemId: serialItemId,
          quantity: 1,
          status: "Consumed",
          sourceDocument: "Item",
          sourceDocumentId: serialItemId,
          attributes: {},
          companyId,
          createdBy: USER
        })
        .execute();
      return id;
    },
    /** A To Receive RMA of the fixture's customer at the fixture's location. */
    async addRma(
      lines: {
        itemId: string;
        returnType: Enums["returnType"];
        problem?: string;
      }[]
    ) {
      rmaCount += 1;
      const rmaId = `${prefix}-rma-${rmaCount}`;
      await db
        .insertInto("salesReturnOrder")
        .values({
          id: rmaId,
          salesReturnOrderId: `RMA-${rmaCount}`,
          customerId: f.customerId,
          currencyCode: "USD",
          orderDate: "2026-10-01",
          locationId,
          status: "To Receive",
          companyId,
          createdBy: USER
        })
        .execute();
      const inserted = await db
        .insertInto("salesReturnOrderLine")
        .values(
          lines.map((line, index) => ({
            salesReturnOrderId: rmaId,
            lineNumber: index + 1,
            itemId: line.itemId,
            quantity: 1,
            returnType: line.returnType,
            problem: line.problem ?? null,
            unitOfMeasureCode: "EA",
            companyId,
            createdBy: USER
          }))
        )
        .returning(["id", "lineNumber"])
        .execute();
      const lineIds = inserted
        .sort((a, b) => a.lineNumber - b.lineNumber)
        .map((line) => line.id);
      return { rmaId, lineIds };
    },
    /** Creates the RMA's receipt, attaches `serials` (RMA line id → serial)
     *  to its lines, and posts it. */
    async receive(rmaId: string, serials: Record<string, string> = {}) {
      const created = await invokeCreate(handles, {
        type: "receiptFromSalesReturnOrder",
        salesReturnOrderId: rmaId,
        locationId
      });
      if (created.error) throw created.error;
      const receiptId = created.data.id;
      const receiptLines = await db
        .selectFrom("receiptLine")
        .select(["id", "lineId"])
        .where("receiptId", "=", receiptId)
        .execute();
      for (const line of receiptLines) {
        const serialId = line.lineId ? serials[line.lineId] : undefined;
        if (!serialId) continue;
        await db
          .updateTable("trackedEntity")
          .set({
            attributes: {
              Receipt: receiptId,
              "Receipt Line": line.id,
              "Receipt Line Index": 0
            }
          })
          .where("id", "=", serialId)
          .execute();
      }
      const posted = await postReceiptAs("post", receiptId);
      return { receiptId, posted };
    },
    postReceipt: postReceiptAs,
    /** Creates the RMA's ship-back shipment, attaches `serials` (RMA line id
     *  → serial) to its lines, and posts it. */
    async shipBack(rmaId: string, serials: Record<string, string> = {}) {
      const created = await invokeCreate(handles, {
        type: "shipmentFromSalesReturnOrder",
        salesReturnOrderId: rmaId,
        locationId
      });
      if (created.error) throw created.error;
      const shipmentId = created.data.id;
      const shipmentLines = await db
        .selectFrom("shipmentLine")
        .select(["id", "lineId"])
        .where("shipmentId", "=", shipmentId)
        .execute();
      for (const line of shipmentLines) {
        const serialId = line.lineId ? serials[line.lineId] : undefined;
        if (!serialId) continue;
        await db
          .updateTable("trackedEntity")
          .set({
            attributes: {
              Shipment: shipmentId,
              "Shipment Line": line.id,
              "Shipment Line Index": 0
            }
          })
          .where("id", "=", serialId)
          .execute();
      }
      const posted = await postShipmentAs("post", shipmentId);
      return { shipmentId, posted };
    },
    postShipment: postShipmentAs,
    /** The jobs naming an RMA line, newest first. */
    jobsOf(salesReturnOrderLineId: string) {
      return db
        .selectFrom("serviceJob")
        .selectAll()
        .where("salesReturnOrderLineId", "=", salesReturnOrderLineId)
        .where("companyId", "=", companyId)
        .orderBy("createdAt", "desc")
        .execute();
    },
    async rmaStatus(rmaId: string) {
      const rma = await db
        .selectFrom("salesReturnOrder")
        .select("status")
        .where("id", "=", rmaId)
        .executeTakeFirstOrThrow();
      return rma.status;
    },
    returnLines(rmaId: string) {
      return db
        .selectFrom("salesReturnOrderLine")
        .select(["id", "quantityReceived", "quantityShipped"])
        .where("salesReturnOrderId", "=", rmaId)
        .orderBy("lineNumber")
        .execute();
    },
    /** A document's journal lines as [account, amount], debits first. */
    async documentJournalLines(documentId: string) {
      const lines = await db
        .selectFrom("journalLine")
        .select(["accountId", "amount"])
        .where("documentId", "=", documentId)
        .where("companyId", "=", companyId)
        .orderBy("amount", "desc")
        .execute();
      return lines.map((line) => [line.accountId, Number(line.amount)]);
    }
  };
}
