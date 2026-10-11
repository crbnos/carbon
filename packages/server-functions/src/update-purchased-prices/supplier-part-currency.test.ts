// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { sql } from "kysely";
import { expect } from "vitest";
import {
  connectLocalTestDatabase,
  databaseTest
} from "../local-database-test-fixture";
import { ServerFnContext } from "../server-fn-context";
import updatePurchasedPrices from ".";

// A USD company buying one part from a supplier on a EUR purchase order at
// 0.8 EUR per USD: 8 EUR a box of 2.
async function fixture() {
  const db = await connectLocalTestDatabase();
  const p = `upptest-${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`;
  const companyId = `${p}-company`;
  const ids = {
    item: `${p}-item`,
    supplier: `${p}-supplier`,
    order: `${p}-po`
  };

  await db.transaction().execute(async (trx) => {
    await sql`SET LOCAL "app.sync_in_progress" = 'true'`.execute(trx);
    await sql`
      INSERT INTO "companyGroup" (id, name, "createdBy") VALUES (${`${p}-group`}, ${p}, 'system');
    `.execute(trx);
    await sql`
      INSERT INTO "company" (id, name, "companyGroupId", "baseCurrencyCode")
      VALUES (${companyId}, ${p}, ${`${p}-group`}, 'USD')
    `.execute(trx);
    await sql`
      INSERT INTO "supplier" (id, name, "readableId", "currencyCode", "companyId", "createdBy")
      VALUES (${ids.supplier}, 'One', 'S1', 'EUR', ${companyId}, 'system')
    `.execute(trx);
    await sql`
      INSERT INTO "unitOfMeasure" (code, name, "companyId", "createdBy")
      VALUES ('EA', 'Each', ${companyId}, 'system')
    `.execute(trx);
    await sql`
      INSERT INTO "item" (id, "readableId", name, type, "replenishmentSystem", "defaultMethodType",
        "itemTrackingType", "unitOfMeasureCode", "companyId", "createdBy")
      VALUES (${ids.item}, 'P-1', 'Part', 'Part', 'Buy', 'Pull from Inventory', 'Inventory', 'EA',
        ${companyId}, 'system')
    `.execute(trx);
    await sql`
      INSERT INTO "supplierInteraction" (id, "companyId", "supplierId")
      VALUES (${`${p}-interaction`}, ${companyId}, ${ids.supplier})
    `.execute(trx);
    await sql`
      INSERT INTO "purchaseOrder" (id, "purchaseOrderId", "supplierId", "supplierInteractionId",
        "currencyCode", "exchangeRate", "companyId", "createdBy")
      VALUES (${ids.order}, 'PO-T', ${ids.supplier}, ${`${p}-interaction`}, 'EUR', 0.8,
        ${companyId}, 'system')
    `.execute(trx);
    await sql`
      INSERT INTO "purchaseOrderLine" ("purchaseOrderId", "purchaseOrderLineType", "itemId",
        "purchaseQuantity", "supplierUnitPrice", "exchangeRate", "conversionFactor",
        "companyId", "createdBy")
      VALUES (${ids.order}, 'Part', ${ids.item}, 5, 8, 0.8, 2, ${companyId}, 'system')
    `.execute(trx);
  });

  return {
    db,
    companyId,
    ids,
    ctx: ServerFnContext.system({ db, companyId, userId: "system" }),
    supplierPart: () =>
      db
        .selectFrom("supplierPart")
        .select(["currencyCode", "supplierUnitPrice", "conversionFactor"])
        .where("itemId", "=", ids.item)
        .where("supplierId", "=", ids.supplier)
        .executeTakeFirst(),
    async cleanup() {
      await db.transaction().execute(async (trx) => {
        await sql`SET LOCAL "app.sync_in_progress" = 'true'`.execute(trx);
        await trx.deleteFrom("company").where("id", "=", companyId).execute();
        await trx
          .deleteFrom("companyGroup")
          .where("id", "=", `${p}-group`)
          .execute();
        await sql`DROP TABLE IF EXISTS ${sql.id(`searchIndex_${companyId}`)}`.execute(
          trx
        );
      });
      await db.destroy();
    }
  };
}

databaseTest(
  "a new supplier part records the order's price as the supplier charged it",
  async () => {
    const f = await fixture();
    try {
      const result = await updatePurchasedPrices(f.ctx, {
        source: "purchaseOrder",
        purchaseOrderId: f.ids.order
      });
      expect(result.error).toBeNull();

      const part = await f.supplierPart();
      // Per purchase unit (a box of 2), in EUR — not 10 USD, not 5 per each.
      expect(part?.currencyCode).toBe("EUR");
      expect(Number(part?.supplierUnitPrice)).toBe(8);
      expect(Number(part?.conversionFactor)).toBe(2);
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "an existing supplier part keeps its currency and gets the price converted",
  async () => {
    const f = await fixture();
    try {
      await f.db
        .insertInto("supplierPart")
        .values({
          itemId: f.ids.item,
          supplierId: f.ids.supplier,
          currencyCode: "USD",
          supplierUnitPrice: 99,
          conversionFactor: 2,
          companyId: f.companyId,
          createdBy: "system"
        })
        .execute();

      const result = await updatePurchasedPrices(f.ctx, {
        source: "purchaseOrder",
        purchaseOrderId: f.ids.order
      });
      expect(result.error).toBeNull();

      const part = await f.supplierPart();
      // 8 EUR at the order's 0.8 EUR per USD.
      expect(part?.currencyCode).toBe("USD");
      expect(Number(part?.supplierUnitPrice)).toBe(10);
    } finally {
      await f.cleanup();
    }
  }
);
