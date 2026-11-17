// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Planning reads open purchase order lines as incoming supply. Receiving an
// outside-processing line stocks nothing (the job it serves is the supply),
// so counting it too made planning see a job's quantity twice.

import { expect } from "vitest";
import {
  alwaysPostFixture,
  type Fixture,
  seed,
  USER
} from "./fixtures/always-post";
import { databaseTest } from "./fixtures/local-database";

async function openPurchaseOrder(
  f: Fixture,
  key: string,
  purchaseOrderType: "Purchase" | "Outside Processing"
) {
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
        purchaseOrderType,
        status: "To Receive",
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
        id: `${f.prefix}-pol-${key}`,
        purchaseOrderId,
        purchaseOrderLineType: "Part",
        itemId: f.partId,
        purchaseQuantity: 10,
        supplierUnitPrice: 5,
        exchangeRate: 1,
        conversionFactor: 1,
        inventoryUnitOfMeasureCode: "EA",
        locationId: f.locationId,
        companyId: f.companyId,
        createdBy: USER
      })
      .execute();
  });
  return `${f.prefix}-pol-${key}`;
}

databaseTest(
  "planning supply leaves out outside-processing purchase order lines",
  async () => {
    const f = await alwaysPostFixture();
    try {
      const bought = await openPurchaseOrder(f, "bought", "Purchase");
      const outside = await openPurchaseOrder(
        f,
        "outside",
        "Outside Processing"
      );

      const supply = await f.db
        .selectFrom("openPurchaseOrderLines")
        .select("id")
        .where("companyId", "=", f.companyId)
        .where("id", "in", [bought, outside])
        .execute();
      expect(supply.map((line) => line.id)).toEqual([bought]);
    } finally {
      await f.cleanup();
    }
  }
);
