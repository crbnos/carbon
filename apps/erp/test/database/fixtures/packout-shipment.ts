// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { sql } from "kysely";
import { expect } from "vitest";
import { postShipment } from "../../../app/modules/inventory/inventory.service";
import {
  invokeCreate,
  invokePosting
} from "../../../app/modules/shared/shared.service";
import { type Fixture, seed, USER, unwrap } from "./always-post";
import { handlesOf } from "./handles";

/** Ship an existing packed serial from common stock on a stock sales order. */
export async function shipPackedUnit(
  f: Fixture,
  itemId: string,
  trackedEntityId: string
) {
  const salesOrderId = `${f.prefix}-so-${trackedEntityId}`;
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
        saleQuantity: 1,
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

  // The ERP picker tags the selected unit via PostgREST. Set its slot here
  // so this fixture exercises both real postings on PostgreSQL alone.
  await f.db
    .updateTable("trackedEntity")
    .set({
      attributes: sql`coalesce(attributes, '{}'::jsonb) || ${JSON.stringify({
        Shipment: shipment.id,
        "Shipment Line": line.id,
        "Shipment Line Index": 0
      })}::jsonb`
    })
    .where("companyId", "=", f.companyId)
    .where("id", "=", trackedEntityId)
    .where("itemId", "=", itemId)
    .where("status", "=", "Available")
    .returning("id")
    .executeTakeFirstOrThrow();

  unwrap(
    await invokePosting(
      handles,
      "post-shipment",
      { type: "post", shipmentId: shipment.id },
      postShipment
    )
  );
  const posted = await f.db
    .selectFrom("shipment")
    .select("status")
    .where("id", "=", shipment.id)
    .where("companyId", "=", f.companyId)
    .executeTakeFirstOrThrow();
  expect(posted.status).toBe("Posted");
  const shipped = await f.db
    .selectFrom("itemLedger")
    .select(["itemId", "trackedEntityId", "quantity"])
    .where("companyId", "=", f.companyId)
    .where("documentType", "=", "Sales Shipment")
    .where("documentId", "=", shipment.id)
    .execute();
  expect(
    shipped.map((row) => ({ ...row, quantity: Number(row.quantity) }))
  ).toEqual([{ itemId, trackedEntityId, quantity: -1 }]);
  return { salesOrderId, shipmentId: shipment.id };
}
