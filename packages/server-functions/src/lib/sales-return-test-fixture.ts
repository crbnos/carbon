// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// An RMA for the depot repair regressions, on a `projectPostingFixture`
// company: a customer and site, a serialized machine whose serial SN-0001 the
// customer owns (Consumed, with a customer asset In Service), an Inventory
// widget with stock, a To Receive RMA with a Repair line for SN-0001 and a
// Return to Customer line for 2 widgets, and a Draft receipt of both lines
// with SN-0001 assigned.

import { sql } from "kysely";
import type { projectPostingFixture } from "./project-posting-test-fixture";

type Fixture = Awaited<ReturnType<typeof projectPostingFixture>>;

const USER = "system";

export async function salesReturnRepairFixture(f: Fixture) {
  const id = (name: string) => `${f.prefix}-rma-${name}`;
  const widget = await f.addStockedItem("widget", {
    quantity: 10,
    unitCost: 10
  });
  const ids = {
    locationId: widget.locationId,
    widgetItemId: widget.itemId,
    customerId: id("customer"),
    siteId: id("site"),
    machineItemId: id("machine"),
    serialId: id("sn-0001"),
    assetId: id("asset"),
    rmaId: id("rma"),
    repairLineId: id("line-repair"),
    returnLineId: id("line-return"),
    receiptId: id("receipt"),
    repairReceiptLineId: id("receipt-line-repair"),
    returnReceiptLineId: id("receipt-line-return")
  };

  await f.db.transaction().execute(async (trx) => {
    await sql`SET LOCAL "app.sync_in_progress" = 'true'`.execute(trx);
    await trx
      .insertInto("customer")
      .values({
        id: ids.customerId,
        readableId: "C-ACME",
        name: "Acme",
        companyId: f.companyId
      })
      .execute();
    const address = await trx
      .insertInto("address")
      .values({ addressLine1: "1 Customer Way", companyId: f.companyId })
      .returning("id")
      .executeTakeFirstOrThrow();
    await trx
      .insertInto("customerLocation")
      .values({
        id: ids.siteId,
        customerId: ids.customerId,
        addressId: address.id,
        name: "Acme plant",
        companyId: f.companyId
      })
      .execute();
    await trx
      .insertInto("item")
      .values({
        id: ids.machineItemId,
        readableId: id("MACHINE"),
        name: "Machine",
        type: "Part",
        itemTrackingType: "Serial",
        replenishmentSystem: "Buy",
        companyId: f.companyId,
        createdBy: USER
      })
      .execute();
    // A cost, so a Repair line that posted stock would post value too.
    await trx
      .deleteFrom("itemCost")
      .where("itemId", "=", ids.machineItemId)
      .execute();
    await trx
      .insertInto("itemCost")
      .values({
        itemId: ids.machineItemId,
        costingMethod: "FIFO",
        unitCost: 500,
        companyId: f.companyId,
        createdBy: USER
      })
      .execute();
    await trx
      .insertInto("trackedEntity")
      .values({
        id: ids.serialId,
        readableId: "SN-0001",
        itemId: ids.machineItemId,
        quantity: 1,
        status: "Consumed",
        sourceDocument: "Item",
        sourceDocumentId: ids.machineItemId,
        attributes: {
          Receipt: ids.receiptId,
          "Receipt Line": ids.repairReceiptLineId,
          "Receipt Line Index": 0
        },
        companyId: f.companyId,
        createdBy: USER
      })
      .execute();
    await trx
      .insertInto("customerAsset")
      .values({
        id: ids.assetId,
        trackedEntityId: ids.serialId,
        itemId: ids.machineItemId,
        customerId: ids.customerId,
        customerLocationId: ids.siteId,
        shippedDate: "2026-01-01",
        source: "Shipment",
        companyId: f.companyId,
        createdBy: USER
      })
      .execute();
    await trx
      .insertInto("sequence")
      .values([
        {
          table: "serviceOrder",
          name: "Service Order",
          prefix: "SVC",
          size: 6,
          next: 0,
          step: 1,
          companyId: f.companyId
        },
        {
          table: "shipment",
          name: "Shipment",
          prefix: "SHP",
          size: 6,
          next: 0,
          step: 1,
          companyId: f.companyId
        }
      ])
      .onConflict((oc) => oc.doNothing())
      .execute();
    await trx
      .insertInto("salesReturnOrder")
      .values({
        id: ids.rmaId,
        salesReturnOrderId: id("RMA"),
        status: "To Receive",
        customerId: ids.customerId,
        customerLocationId: ids.siteId,
        locationId: ids.locationId,
        currencyCode: "USD",
        orderDate: "2026-01-01",
        companyId: f.companyId,
        createdBy: USER
      })
      .execute();
    await trx
      .insertInto("salesReturnOrderLine")
      .values([
        {
          id: ids.repairLineId,
          salesReturnOrderId: ids.rmaId,
          lineNumber: 1,
          itemId: ids.machineItemId,
          quantity: 1,
          unitPrice: 1000,
          disposition: "Repair",
          companyId: f.companyId,
          createdBy: USER
        },
        {
          id: ids.returnLineId,
          salesReturnOrderId: ids.rmaId,
          lineNumber: 2,
          itemId: ids.widgetItemId,
          quantity: 2,
          unitPrice: 20,
          disposition: "Return to Customer",
          companyId: f.companyId,
          createdBy: USER
        }
      ])
      .execute();
    await trx
      .insertInto("receipt")
      .values({
        id: ids.receiptId,
        receiptId: id("RCV"),
        sourceDocument: "Sales Return Order",
        sourceDocumentId: ids.rmaId,
        locationId: ids.locationId,
        status: "Draft",
        companyId: f.companyId,
        createdBy: USER
      })
      .execute();
    await trx
      .insertInto("receiptLine")
      .values([
        {
          id: ids.repairReceiptLineId,
          receiptId: ids.receiptId,
          lineId: ids.repairLineId,
          itemId: ids.machineItemId,
          orderQuantity: 1,
          outstandingQuantity: 1,
          receivedQuantity: 1,
          locationId: ids.locationId,
          unitOfMeasure: "EA",
          unitPrice: 1000,
          requiresSerialTracking: true,
          requiresBatchTracking: false,
          companyId: f.companyId,
          createdBy: USER
        },
        {
          id: ids.returnReceiptLineId,
          receiptId: ids.receiptId,
          lineId: ids.returnLineId,
          itemId: ids.widgetItemId,
          orderQuantity: 2,
          outstandingQuantity: 2,
          receivedQuantity: 2,
          locationId: ids.locationId,
          unitOfMeasure: "EA",
          unitPrice: 20,
          requiresSerialTracking: false,
          requiresBatchTracking: false,
          companyId: f.companyId,
          createdBy: USER
        }
      ])
      .execute();
  });

  return ids;
}

/** The item's on-hand quantity at the location, from its stock ledger. */
export async function onHand(f: Fixture, itemId: string, locationId: string) {
  const row = await f.db
    .selectFrom("itemLedger")
    .select(({ fn }) => fn.sum<string | null>("quantity").as("quantity"))
    .where("itemId", "=", itemId)
    .where("locationId", "=", locationId)
    .where("companyId", "=", f.companyId)
    .executeTakeFirstOrThrow();
  return Number(row.quantity ?? 0);
}
