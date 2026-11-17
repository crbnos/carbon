// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Changing a Draft receipt's location rebuilds it from the purchase order; the
// rebuild must keep the location the user chose, not fall back to the order's.

import { expect } from "vitest";
import { invokeCreate } from "../../app/modules/shared/shared.service";
import {
  alwaysPostFixture,
  type Fixture,
  seed,
  USER,
  unwrap
} from "./fixtures/always-post";
import { handlesOf } from "./fixtures/handles";
import { databaseTest } from "./fixtures/local-database";

async function purchaseOrderAt(f: Fixture): Promise<string> {
  const purchaseOrderId = `${f.prefix}-po-location`;
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
        purchaseOrderId: "PO-LOCATION",
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
        itemId: f.partId,
        purchaseQuantity: 5,
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
  return purchaseOrderId;
}

async function receiptLocation(f: Fixture, receiptId: string) {
  const row = await f.db
    .selectFrom("receipt")
    .select("locationId")
    .where("id", "=", receiptId)
    .where("companyId", "=", f.companyId)
    .executeTakeFirstOrThrow();
  return row.locationId;
}

databaseTest(
  "a new receipt takes the purchase order's location, not the caller's default",
  async () => {
    const f = await alwaysPostFixture();
    try {
      const purchaseOrderId = await purchaseOrderAt(f);
      const receipt = unwrap(
        await invokeCreate(handlesOf(f.ctx), {
          type: "receiptFromPurchaseOrder",
          purchaseOrderId,
          locationId: f.otherLocationId
        })
      );
      expect(await receiptLocation(f, receipt.id)).toBe(f.locationId);
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "a Draft receipt moved to another location keeps that location",
  async () => {
    const f = await alwaysPostFixture();
    try {
      const purchaseOrderId = await purchaseOrderAt(f);
      const receipt = unwrap(
        await invokeCreate(handlesOf(f.ctx), {
          type: "receiptFromPurchaseOrder",
          purchaseOrderId,
          locationId: f.locationId
        })
      );

      unwrap(
        await invokeCreate(handlesOf(f.ctx), {
          type: "receiptFromPurchaseOrder",
          purchaseOrderId,
          locationId: f.otherLocationId,
          receiptId: receipt.id
        })
      );
      expect(await receiptLocation(f, receipt.id)).toBe(f.otherLocationId);
    } finally {
      await f.cleanup();
    }
  }
);
