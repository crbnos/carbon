// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { expect } from "vitest";
import {
  assignShipmentSerial,
  postShipment
} from "../../../app/modules/inventory/inventory.service";
import {
  invokeCreate,
  invokePosting
} from "../../../app/modules/shared/shared.service";
import { type Fixture, seed, USER, unwrap } from "./always-post";
import { handlesOf } from "./handles";

/** Ship an existing packed serial from common stock on a stock sales order. */
export async function createPackedShipment(
  f: Fixture,
  itemId: string,
  trackedEntityId: string,
  orderSuffix = "",
  saleQuantity = 1
) {
  const salesOrderId = `${f.prefix}-so-${trackedEntityId}${orderSuffix}`;
  await seed(f, async (trx) => {
    await trx
      .insertInto("salesOrder")
      .values({
        id: salesOrderId,
        salesOrderId,
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
      .onConflict((oc) => oc.column("id").doNothing())
      .execute();
    await trx
      .insertInto("salesOrderLine")
      .values({
        salesOrderId,
        salesOrderLineType: "Part",
        itemId,
        saleQuantity,
        unitPrice: 25,
        methodType: "Pull from Inventory",
        unitOfMeasureCode: "EA",
        locationId: f.locationId,
        companyId: f.companyId,
        createdBy: USER
      })
      .execute();
  });
  const handles = handlesOf(f.ctx);
  const shipment = unwrap(
    await invokeCreate(handles, {
      type: "shipmentFromSalesOrder",
      locationId: f.locationId,
      salesOrderId
    })
  );
  const line = await f.db
    .selectFrom("shipmentLine")
    .select(["id", "requiresSerialTracking"])
    .where("companyId", "=", f.companyId)
    .where("shipmentId", "=", shipment.id)
    .where("itemId", "=", itemId)
    .executeTakeFirstOrThrow();
  expect(line.requiresSerialTracking).toBe(true);

  return { salesOrderId, shipmentId: shipment.id, shipmentLineId: line.id };
}

export async function shipPackedUnit(
  f: Fixture,
  itemId: string,
  trackedEntityId: string,
  orderSuffix = ""
) {
  const draft = await createPackedShipment(
    f,
    itemId,
    trackedEntityId,
    orderSuffix
  );
  const refusal = await assignShipmentSerial(
    f.db,
    f.companyId,
    {
      shipmentId: draft.shipmentId,
      shipmentLineId: draft.shipmentLineId,
      trackedEntityId,
      index: 0
    },
    {
      itemId,
      status: "Available",
      receiptId: undefined,
      sourceDocument: "Sales Order",
      sourceDocumentId: draft.salesOrderId,
      supplierId: null
    }
  );
  expect(refusal).toBeNull();
  return postPackedShipment(f, draft, itemId, trackedEntityId);
}

export async function postPackedShipment(
  f: Fixture,
  draft: { salesOrderId: string; shipmentId: string },
  itemId: string,
  trackedEntityId: string
) {
  const { salesOrderId, shipmentId } = draft;
  const handles = handlesOf(f.ctx);
  unwrap(
    await invokePosting(
      handles,
      "post-shipment",
      { type: "post", shipmentId },
      postShipment
    )
  );
  const posted = await f.db
    .selectFrom("shipment")
    .select("status")
    .where("id", "=", shipmentId)
    .where("companyId", "=", f.companyId)
    .executeTakeFirstOrThrow();
  expect(posted.status).toBe("Posted");
  const shipped = await f.db
    .selectFrom("itemLedger")
    .select(["itemId", "trackedEntityId", "quantity"])
    .where("companyId", "=", f.companyId)
    .where("documentType", "=", "Sales Shipment")
    .where("documentId", "=", shipmentId)
    .execute();
  expect(
    shipped.map((row) => ({ ...row, quantity: Number(row.quantity) }))
  ).toEqual([{ itemId, trackedEntityId, quantity: -1 }]);
  return { salesOrderId, shipmentId };
}
