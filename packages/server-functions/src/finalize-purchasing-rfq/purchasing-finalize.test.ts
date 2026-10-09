// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { sql } from "kysely";
import { expect } from "vitest";
import finalizeSupplierQuote from "../finalize-supplier-quote";
import {
  connectLocalTestDatabase,
  databaseTest
} from "../local-database-test-fixture";
import { ServerFnContext } from "../server-fn-context";
import finalizePurchasingRfq from ".";

// One company with two suppliers, one bought part, a Draft RFQ for it and a
// supplier quote with two price breaks (purchase unit = 2 inventory units).
async function fixture() {
  const db = await connectLocalTestDatabase();
  const p = `pftest-${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`;
  const companyId = `${p}-company`;
  const ids = {
    rfq: `${p}-rfq`,
    quote: `${p}-quote`,
    quoteLine: `${p}-quote-line`,
    item: `${p}-item`,
    supplier: `${p}-s1`
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
      INSERT INTO "sequence" ("table", name, prefix, "companyId")
      VALUES ('supplierQuote', 'Supplier quote', 'PFT-', ${companyId})
    `.execute(trx);
    await sql`
      INSERT INTO "supplier" (id, name, "readableId", "companyId", "createdBy") VALUES
        (${ids.supplier}, 'One', 'S1', ${companyId}, 'system'),
        (${`${p}-s2`}, 'Two', 'S2', ${companyId}, 'system')
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
      INSERT INTO "purchasingRfq" (id, "rfqId", "rfqDate", "companyId", "createdBy")
      VALUES (${ids.rfq}, 'RFQ-T', '2026-10-01', ${companyId}, 'system')
    `.execute(trx);
    await sql`
      INSERT INTO "purchasingRfqSupplier" ("purchasingRfqId", "supplierId", "companyId", "createdBy") VALUES
        (${ids.rfq}, ${ids.supplier}, ${companyId}, 'system'),
        (${ids.rfq}, ${`${p}-s2`}, ${companyId}, 'system')
    `.execute(trx);
    await sql`
      INSERT INTO "purchasingRfqLine" (id, "purchasingRfqId", "itemId", description, quantity,
        "purchaseUnitOfMeasureCode", "inventoryUnitOfMeasureCode", "companyId", "createdBy")
      VALUES (${`${p}-rfq-line`}, ${ids.rfq}, ${ids.item}, 'Part', '{1,10}', 'EA', 'EA', ${companyId}, 'system')
    `.execute(trx);
    await sql`
      INSERT INTO "supplierInteraction" (id, "companyId", "supplierId")
      VALUES (${`${p}-interaction`}, ${companyId}, ${ids.supplier})
    `.execute(trx);
    await sql`
      INSERT INTO "supplierQuote" (id, "supplierQuoteId", "supplierId", "supplierInteractionId", status, "companyId", "createdBy")
      VALUES (${ids.quote}, 'PFT-X', ${ids.supplier}, ${`${p}-interaction`}, 'Draft', ${companyId}, 'system')
    `.execute(trx);
    await sql`
      INSERT INTO "supplierQuoteLine" (id, "supplierQuoteId", "itemId", description, quantity,
        "conversionFactor", "companyId", "createdBy")
      VALUES (${ids.quoteLine}, ${ids.quote}, ${ids.item}, 'Part', '{1,10}', 2, ${companyId}, 'system')
    `.execute(trx);
    await sql`
      INSERT INTO "supplierQuoteLinePrice" ("supplierQuoteId", "supplierQuoteLineId", quantity,
        "supplierUnitPrice", "leadTime", "companyId", "createdBy") VALUES
        (${ids.quote}, ${ids.quoteLine}, 1, 10, 5, ${companyId}, 'system'),
        (${ids.quote}, ${ids.quoteLine}, 10, 8, 5, ${companyId}, 'system')
    `.execute(trx);
  });

  return {
    db,
    companyId,
    ids,
    ctx: ServerFnContext.system({ db, companyId, userId: "system" }),
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

const count = async (
  f: Awaited<ReturnType<typeof fixture>>,
  table: "supplierQuote" | "supplierQuoteLine" | "supplierPartPrice"
) =>
  Number(
    (
      await f.db
        .selectFrom(table)
        .select((eb) => eb.fn.countAll().as("n"))
        .where("companyId", "=", f.companyId)
        .executeTakeFirstOrThrow()
    ).n
  );

databaseTest("an RFQ is finalized once", async () => {
  const f = await fixture();
  try {
    const quotesBefore = await count(f, "supplierQuote");
    const first = await finalizePurchasingRfq(f.ctx, { rfqId: f.ids.rfq });
    expect(first.error).toBeNull();
    expect(first.data?.quotes).toHaveLength(2);
    expect(await count(f, "supplierQuote")).toBe(quotesBefore + 2);
    // One line per quote for the RFQ's one line, plus the fixture quote's own.
    expect(await count(f, "supplierQuoteLine")).toBe(3);

    const rfq = await f.db
      .selectFrom("purchasingRfq")
      .select("status")
      .where("id", "=", f.ids.rfq)
      .executeTakeFirstOrThrow();
    expect(rfq.status).toBe("Requested");

    // A repeated request finds it Requested and creates nothing.
    const second = await finalizePurchasingRfq(f.ctx, { rfqId: f.ids.rfq });
    expect(second.error?.status).toBe(400);
    expect(await count(f, "supplierQuote")).toBe(quotesBefore + 2);
  } finally {
    await f.cleanup();
  }
});

databaseTest("another company's RFQ is not found", async () => {
  const f = await fixture();
  try {
    const other = ServerFnContext.system({
      db: f.db,
      companyId: "another-company",
      userId: "system"
    });
    const result = await finalizePurchasingRfq(other, { rfqId: f.ids.rfq });
    expect(result.error?.status).toBe(404);
    expect(await count(f, "supplierQuote")).toBe(1);
  } finally {
    await f.cleanup();
  }
});

databaseTest(
  "a supplier quote's prices become the supplier's price list",
  async () => {
    const f = await fixture();
    try {
      const result = await finalizeSupplierQuote(f.ctx, {
        supplierQuoteId: f.ids.quote
      });
      expect(result.error).toBeNull();

      const part = await f.db
        .selectFrom("supplierPart")
        .select(["id", "supplierUnitPrice", "minimumOrderQuantity"])
        .where("itemId", "=", f.ids.item)
        .where("supplierId", "=", f.ids.supplier)
        .executeTakeFirstOrThrow();
      // The lowest quoted price, as quoted: per purchase unit (2 inventory
      // units to one), not divided down to an inventory unit.
      expect(Number(part.supplierUnitPrice)).toBe(8);
      expect(Number(part.minimumOrderQuantity)).toBe(10);

      const breaks = await f.db
        .selectFrom("supplierPartPrice")
        .select([
          "quantity",
          "supplierUnitPrice",
          "leadTime",
          "sourceDocumentId"
        ])
        .where("supplierPartId", "=", part.id)
        .orderBy("quantity")
        .execute();
      expect(
        breaks.map((b) => [Number(b.quantity), Number(b.supplierUnitPrice)])
      ).toEqual([
        [1, 10],
        [10, 8]
      ]);
      expect(breaks.every((b) => b.sourceDocumentId === f.ids.quote)).toBe(
        true
      );

      // Finalizing again rewrites the same breaks rather than adding more.
      await finalizeSupplierQuote(f.ctx, { supplierQuoteId: f.ids.quote });
      expect(await count(f, "supplierPartPrice")).toBe(2);
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "a quote in the supplier's currency is recorded in that currency",
  async () => {
    const f = await fixture();
    try {
      await f.db
        .updateTable("supplierQuote")
        .set({ currencyCode: "EUR", exchangeRate: 0.8 })
        .where("id", "=", f.ids.quote)
        .execute();

      const result = await finalizeSupplierQuote(f.ctx, {
        supplierQuoteId: f.ids.quote
      });
      expect(result.error).toBeNull();

      const part = await f.db
        .selectFrom("supplierPart")
        .select(["currencyCode", "supplierUnitPrice"])
        .where("itemId", "=", f.ids.item)
        .where("supplierId", "=", f.ids.supplier)
        .executeTakeFirstOrThrow();
      expect(part.currencyCode).toBe("EUR");
      expect(Number(part.supplierUnitPrice)).toBe(8);
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "an existing part keeps its currency and gets the quote converted into it",
  async () => {
    const f = await fixture();
    try {
      await f.db
        .updateTable("supplierQuote")
        .set({ currencyCode: "EUR", exchangeRate: 0.8 })
        .where("id", "=", f.ids.quote)
        .execute();
      await f.db
        .insertInto("supplierPart")
        .values({
          itemId: f.ids.item,
          supplierId: f.ids.supplier,
          currencyCode: "USD",
          supplierUnitPrice: 99,
          companyId: f.companyId,
          createdBy: "system"
        })
        .execute();

      const result = await finalizeSupplierQuote(f.ctx, {
        supplierQuoteId: f.ids.quote
      });
      expect(result.error).toBeNull();

      const part = await f.db
        .selectFrom("supplierPart")
        .select(["id", "currencyCode", "supplierUnitPrice"])
        .where("itemId", "=", f.ids.item)
        .where("supplierId", "=", f.ids.supplier)
        .executeTakeFirstOrThrow();
      // 8 EUR at 0.8 EUR per USD.
      expect(part.currencyCode).toBe("USD");
      expect(Number(part.supplierUnitPrice)).toBe(10);

      const breaks = await f.db
        .selectFrom("supplierPartPrice")
        .select(["quantity", "supplierUnitPrice"])
        .where("supplierPartId", "=", part.id)
        .orderBy("quantity")
        .execute();
      expect(
        breaks.map((b) => [Number(b.quantity), Number(b.supplierUnitPrice)])
      ).toEqual([
        [1, 12.5],
        [10, 10]
      ]);
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "a line without a price and lead time finalizes nothing",
  async () => {
    const f = await fixture();
    try {
      await f.db
        .updateTable("supplierQuoteLinePrice")
        .set({ leadTime: 0 })
        .where("supplierQuoteId", "=", f.ids.quote)
        .execute();

      const result = await finalizeSupplierQuote(f.ctx, {
        supplierQuoteId: f.ids.quote
      });
      expect(result.error?.status).toBe(400);
      expect(result.error?.message).toContain("P-1");

      const quote = await f.db
        .selectFrom("supplierQuote")
        .select("status")
        .where("id", "=", f.ids.quote)
        .executeTakeFirstOrThrow();
      expect(quote.status).toBe("Draft");
      expect(await count(f, "supplierPartPrice")).toBe(0);
    } finally {
      await f.cleanup();
    }
  }
);
