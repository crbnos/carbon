// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { datetime } from "@carbon/utils";
import { parseDate } from "@internationalized/date";
import { sql } from "kysely";
import { expect } from "vitest";
import { projectPostingFixture } from "../lib/project-posting-test-fixture";
import { databaseTest } from "../local-database-test-fixture";
import postShipment from "./index";

type Fixture = Awaited<ReturnType<typeof projectPostingFixture>>;

/**
 * A Pending shipment of serial SN-0001 on a sales order of a new customer.
 * The item has 12 labor and 24 parts warranty months. The order's site is
 * `site-order`; with `dropShipment` the order's shipment names `site-drop`.
 */
async function serialShipment(
  f: Fixture,
  { dropShipment = false }: { dropShipment?: boolean } = {}
) {
  const id = (name: string) => `${f.prefix}-${name}`;
  const ids = {
    customerId: id("customer"),
    siteOrder: id("site-order"),
    siteDrop: id("site-drop"),
    locationId: id("location"),
    itemId: id("serial-item"),
    serialId: id("sn-0001"),
    salesOrderId: id("so"),
    salesOrderLineId: id("sol"),
    shipmentId: id("shipment"),
    shipmentLineId: id("shl")
  };
  await f.db.transaction().execute(async (trx) => {
    await sql`SET LOCAL "app.sync_in_progress" = 'true'`.execute(trx);
    await trx
      .updateTable("companySettings")
      .set({ accountingEnabled: false })
      .where("id", "=", f.companyId)
      .execute();
    await trx
      .insertInto("customer")
      .values({
        id: ids.customerId,
        readableId: "C-ACME",
        name: "Acme",
        companyId: f.companyId
      })
      .execute();
    for (const siteId of [ids.siteOrder, ids.siteDrop]) {
      const address = await trx
        .insertInto("address")
        .values({ addressLine1: siteId, companyId: f.companyId })
        .returning("id")
        .executeTakeFirstOrThrow();
      await trx
        .insertInto("customerLocation")
        .values({
          id: siteId,
          customerId: ids.customerId,
          addressId: address.id,
          name: siteId,
          companyId: f.companyId
        })
        .execute();
    }
    await trx
      .insertInto("location")
      .values({
        id: ids.locationId,
        name: "Plant",
        addressLine1: "1 Main St",
        city: "Springfield",
        postalCode: "00000",
        timezone: "America/New_York",
        companyId: f.companyId,
        createdBy: "system"
      })
      .execute();
    await trx
      .insertInto("item")
      .values({
        id: ids.itemId,
        readableId: id("MACHINE"),
        name: "Machine",
        type: "Part",
        itemTrackingType: "Serial",
        replenishmentSystem: "Buy",
        companyId: f.companyId,
        createdBy: "system"
      })
      .execute();
    await trx
      .deleteFrom("itemUnitSalePrice")
      .where("itemId", "=", ids.itemId)
      .execute();
    await trx
      .insertInto("itemUnitSalePrice")
      .values({
        itemId: ids.itemId,
        unitSalePrice: 1000,
        laborWarrantyMonths: 12,
        partsWarrantyMonths: 24,
        currencyCode: "USD",
        companyId: f.companyId,
        createdBy: "system"
      })
      .execute();
    await trx
      .insertInto("trackedEntity")
      .values({
        id: ids.serialId,
        readableId: "SN-0001",
        itemId: ids.itemId,
        quantity: 1,
        status: "Available",
        sourceDocument: "Item",
        sourceDocumentId: ids.itemId,
        attributes: {
          Shipment: ids.shipmentId,
          "Shipment Line": ids.shipmentLineId
        },
        companyId: f.companyId,
        createdBy: "system"
      })
      .execute();
    await trx
      .insertInto("itemLedger")
      .values({
        postingDate: "2026-01-01",
        entryType: "Positive Adjmt.",
        itemId: ids.itemId,
        locationId: ids.locationId,
        trackedEntityId: ids.serialId,
        quantity: 1,
        companyId: f.companyId,
        createdBy: "system"
      })
      .execute();
    await trx
      .insertInto("salesOrder")
      .values({
        id: ids.salesOrderId,
        salesOrderId: id("SO"),
        customerId: ids.customerId,
        customerLocationId: ids.siteOrder,
        currencyCode: "USD",
        companyId: f.companyId,
        createdBy: "system"
      })
      .execute();
    await trx
      .insertInto("salesOrderShipment")
      .values({
        id: ids.salesOrderId,
        dropShipment,
        customerLocationId: dropShipment ? ids.siteDrop : null,
        companyId: f.companyId
      })
      .onConflict((oc) =>
        oc.column("id").doUpdateSet({
          dropShipment,
          customerLocationId: dropShipment ? ids.siteDrop : null
        })
      )
      .execute();
    await trx
      .insertInto("salesOrderLine")
      .values({
        id: ids.salesOrderLineId,
        salesOrderId: ids.salesOrderId,
        salesOrderLineType: "Part",
        itemId: ids.itemId,
        saleQuantity: 1,
        unitPrice: 1000,
        locationId: ids.locationId,
        companyId: f.companyId,
        createdBy: "system"
      })
      .execute();
    await trx
      .insertInto("shipment")
      .values({
        id: ids.shipmentId,
        shipmentId: id("SHP"),
        sourceDocument: "Sales Order",
        sourceDocumentId: ids.salesOrderId,
        locationId: ids.locationId,
        customerId: ids.customerId,
        status: "Pending",
        companyId: f.companyId,
        createdBy: "system"
      })
      .execute();
    await trx
      .insertInto("shipmentLine")
      .values({
        id: ids.shipmentLineId,
        shipmentId: ids.shipmentId,
        lineId: ids.salesOrderLineId,
        itemId: ids.itemId,
        orderQuantity: 1,
        outstandingQuantity: 1,
        shippedQuantity: 1,
        locationId: ids.locationId,
        unitOfMeasure: "EA",
        unitPrice: 1000,
        requiresSerialTracking: true,
        companyId: f.companyId,
        createdBy: "system"
      })
      .execute();
  });
  const today = datetime.today("America/New_York").toString();
  return {
    ...ids,
    today,
    laborEnd: parseDate(today).add({ months: 12 }).toString(),
    partsEnd: parseDate(today).add({ months: 24 }).toString()
  };
}

async function assetOf(f: Fixture, serialId: string) {
  return f.db
    .selectFrom("customerAsset")
    .select([
      "itemId",
      "customerId",
      "customerLocationId",
      "status",
      "shippedDate",
      "laborWarrantyEndDate",
      "partsWarrantyEndDate",
      "shipmentId",
      "source"
    ])
    .where("trackedEntityId", "=", serialId)
    .where("companyId", "=", f.companyId)
    .execute();
}

databaseTest(
  "shipping serial SN-0001 creates a customer asset with its warranty end dates, and a void returns it",
  async () => {
    const f = await projectPostingFixture();
    try {
      const s = await serialShipment(f);
      const posted = await postShipment(f.ctx, {
        type: "post",
        shipmentId: s.shipmentId
      });
      expect(posted.error).toBeNull();

      expect(await assetOf(f, s.serialId)).toEqual([
        {
          itemId: s.itemId,
          customerId: s.customerId,
          customerLocationId: s.siteOrder,
          status: "In Service",
          shippedDate: s.today,
          laborWarrantyEndDate: s.laborEnd,
          partsWarrantyEndDate: s.partsEnd,
          shipmentId: s.shipmentId,
          source: "Shipment"
        }
      ]);

      const voided = await postShipment(f.ctx, {
        type: "void",
        shipmentId: s.shipmentId
      });
      expect(voided.error).toBeNull();
      const [asset] = await assetOf(f, s.serialId);
      expect(asset?.status).toEqual("Returned");
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "a drop shipment takes the asset's site from the order's shipment",
  async () => {
    const f = await projectPostingFixture();
    try {
      const s = await serialShipment(f, { dropShipment: true });
      const posted = await postShipment(f.ctx, {
        type: "post",
        shipmentId: s.shipmentId
      });
      expect(posted.error).toBeNull();
      const [asset] = await assetOf(f, s.serialId);
      expect(asset?.customerLocationId).toEqual(s.siteDrop);
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "shipping a serial that is already an asset moves it to the new sale and restarts its warranty",
  async () => {
    const f = await projectPostingFixture();
    try {
      const s = await serialShipment(f);
      const previousCustomer = `${f.prefix}-previous-customer`;
      await f.db.transaction().execute(async (trx) => {
        await sql`SET LOCAL "app.sync_in_progress" = 'true'`.execute(trx);
        await trx
          .insertInto("customer")
          .values({
            id: previousCustomer,
            readableId: "C-PREVIOUS",
            name: "Previous owner",
            companyId: f.companyId
          })
          .execute();
        await trx
          .insertInto("customerAsset")
          .values({
            trackedEntityId: s.serialId,
            itemId: s.itemId,
            customerId: previousCustomer,
            status: "Returned",
            shippedDate: "2020-01-01",
            laborWarrantyEndDate: "2021-01-01",
            partsWarrantyEndDate: "2022-01-01",
            source: "Manual",
            companyId: f.companyId,
            createdBy: "system"
          })
          .execute();
      });

      const posted = await postShipment(f.ctx, {
        type: "post",
        shipmentId: s.shipmentId
      });
      expect(posted.error).toBeNull();
      expect(await assetOf(f, s.serialId)).toEqual([
        {
          itemId: s.itemId,
          customerId: s.customerId,
          customerLocationId: s.siteOrder,
          status: "In Service",
          shippedDate: s.today,
          laborWarrantyEndDate: s.laborEnd,
          partsWarrantyEndDate: s.partsEnd,
          shipmentId: s.shipmentId,
          source: "Manual"
        }
      ]);
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "a serial under refurbishment is refused, and ships once its order is no longer open",
  async () => {
    const f = await projectPostingFixture();
    try {
      const s = await serialShipment(f);
      const projectId = `${f.prefix}-refurb-project`;
      const serviceOrderId = `${f.prefix}-refurb-order`;
      await f.db.transaction().execute(async (trx) => {
        await sql`SET LOCAL "app.sync_in_progress" = 'true'`.execute(trx);
        await trx
          .insertInto("project")
          .values({
            id: projectId,
            name: "Refurbish SN-0001",
            identifier: "SVC-R1",
            status: "Released",
            projectType: "Service",
            costTreatment: "By Coverage",
            companyId: f.companyId,
            createdBy: "system"
          })
          .execute();
        await trx
          .insertInto("serviceOrder")
          .values({
            id: serviceOrderId,
            serviceOrderId: "SVC-R1",
            type: "Refurbishment",
            status: "Draft",
            trackedEntityId: s.serialId,
            itemId: s.itemId,
            customerId: null,
            locationId: s.locationId,
            projectId,
            companyId: f.companyId,
            createdBy: "system"
          })
          .execute();
      });

      const refused = await postShipment(f.ctx, {
        type: "post",
        shipmentId: s.shipmentId
      });
      expect(refused.error?.status).toEqual(422);
      expect(refused.error?.message).toEqual(
        "Serial SN-0001 is under refurbishment on SVC-R1. Complete the order first."
      );
      // Nothing moved: the shipment is back to Draft, the serial is in stock.
      const shipment = await f.db
        .selectFrom("shipment")
        .select("status")
        .where("id", "=", s.shipmentId)
        .executeTakeFirstOrThrow();
      expect(shipment.status).toEqual("Draft");
      const ledger = await f.db
        .selectFrom("itemLedger")
        .select("id")
        .where("itemId", "=", s.itemId)
        .where("documentType", "=", "Sales Shipment")
        .execute();
      expect(ledger).toEqual([]);
      expect(await assetOf(f, s.serialId)).toEqual([]);

      await f.db
        .updateTable("serviceOrder")
        .set({ status: "Completed" })
        .where("id", "=", serviceOrderId)
        .where("companyId", "=", f.companyId)
        .execute();
      const posted = await postShipment(f.ctx, {
        type: "post",
        shipmentId: s.shipmentId
      });
      expect(posted.error).toBeNull();
    } finally {
      await f.cleanup();
    }
  }
);
