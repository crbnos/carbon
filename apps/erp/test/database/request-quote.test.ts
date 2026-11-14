// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Runs against the local stack; skipped without one. Request Quote: one
// draft RFQ per set of suppliers, in one transaction.

import { createServiceContext } from "@carbon/api/service-fn.server";
import { sql } from "kysely";
import { expect, vi } from "vitest";
import {
  client,
  fixture,
  type PurchasingFixture,
  test
} from "./fixtures/purchasing";

// Approval rules are a commercial feature, off in the community edition that
// an unset CARBON_EDITION reads as. Set before @carbon/env is imported.
vi.hoisted(() => {
  process.env.CARBON_EDITION = "enterprise";
});

const purchasing = await import(
  "../../app/modules/purchasing/purchasing.server"
);
const service = await import("../../app/modules/purchasing/purchasing.service");

async function secondSupplierAndSequence(
  f: PurchasingFixture
) {
  const second = `${f.ids.supplier}-2`;
  await sql`
    INSERT INTO "supplier" (id, name, "readableId", "companyId", "createdBy")
    VALUES (${second}, 'Two', 'S2', ${f.companyId}, 'system')
  `.execute(f.db);
  await sql`
    INSERT INTO "sequence" ("table", name, prefix, size, step, next, "companyId")
    VALUES ('purchasingRfq', 'RFQ', 'RFQ', 6, 1, 0, ${f.companyId})
    ON CONFLICT DO NOTHING
  `.execute(f.db);
  return second;
}

test("Request Quote makes one draft RFQ per supplier", async () => {
  const f = await fixture();
  try {
    const second = await secondSupplierAndSequence(f);
    const otherItem = `${f.ids.item}-2`;
    await sql`
      INSERT INTO "item" (id, "readableId", name, type, "replenishmentSystem", "defaultMethodType",
        "itemTrackingType", "unitOfMeasureCode", "companyId", "createdBy")
      VALUES (${otherItem}, 'P-2', 'Part 2', 'Part', 'Buy', 'Pull from Inventory', 'Inventory', 'EA',
        ${f.companyId}, 'system')
    `.execute(f.db);
    // The second supplier sells the part in boxes of 10.
    await sql`
      INSERT INTO "unitOfMeasure" (code, name, "companyId", "createdBy")
      VALUES ('BX', 'Box', ${f.companyId}, 'system')
    `.execute(f.db);
    await sql`
      INSERT INTO "supplierPart" ("itemId", "supplierId", "supplierUnitOfMeasureCode",
        "conversionFactor", "companyId", "createdBy")
      VALUES (${otherItem}, ${second}, 'BX', 10, ${f.companyId}, 'system')
    `.execute(f.db);

    const result = await purchasing.requestQuoteFromItem(
      f.contextAs("system"),
      {
        lines: [
          { itemId: f.ids.item, quantity: 3, supplierIds: [f.ids.supplier] },
          { itemId: otherItem, quantity: 40, supplierIds: [second] }
        ]
      }
    );

    expect(result.error).toBeNull();
    expect(result.data?.rfqs).toHaveLength(2);

    const rows = await f.db
      .selectFrom("purchasingRfq")
      .innerJoin(
        "purchasingRfqSupplier",
        "purchasingRfqSupplier.purchasingRfqId",
        "purchasingRfq.id"
      )
      .innerJoin(
        "purchasingRfqLine",
        "purchasingRfqLine.purchasingRfqId",
        "purchasingRfq.id"
      )
      .select([
        "purchasingRfq.status",
        "purchasingRfqSupplier.supplierId",
        "purchasingRfqLine.itemId",
        "purchasingRfqLine.quantity",
        "purchasingRfqLine.purchaseUnitOfMeasureCode"
      ])
      .where("purchasingRfq.companyId", "=", f.companyId)
      .orderBy("purchasingRfqLine.itemId")
      .execute();
    expect(rows).toEqual([
      {
        status: "Draft",
        supplierId: f.ids.supplier,
        itemId: f.ids.item,
        quantity: [3],
        purchaseUnitOfMeasureCode: "EA"
      },
      {
        status: "Draft",
        supplierId: second,
        itemId: otherItem,
        quantity: [4],
        purchaseUnitOfMeasureCode: "BX"
      }
    ]);
  } finally {
    await f.cleanup();
  }
});

test("Request Quote rounds the quantity and keeps a service at EA, 1:1", async () => {
  const f = await fixture();
  try {
    await secondSupplierAndSequence(f);
    const service = `${f.ids.item}-service`;
    await sql`
      INSERT INTO "unitOfMeasure" (code, name, "companyId", "createdBy")
      VALUES ('HR', 'Hour', ${f.companyId}, 'system')
    `.execute(f.db);
    await sql`
      INSERT INTO "item" (id, "readableId", name, type, "replenishmentSystem", "defaultMethodType",
        "itemTrackingType", "unitOfMeasureCode", "companyId", "createdBy")
      VALUES (${service}, 'SV-1', 'Service', 'Service', 'Buy', 'Pull from Inventory', 'Non-Inventory',
        'HR', ${f.companyId}, 'system')
    `.execute(f.db);
    await sql`
      INSERT INTO "supplierPart" ("itemId", "supplierId", "supplierUnitOfMeasureCode",
        "conversionFactor", "companyId", "createdBy")
      VALUES (${service}, ${f.ids.supplier}, 'HR', 8, ${f.companyId}, 'system')
    `.execute(f.db);

    const result = await purchasing.requestQuoteFromItem(
      f.contextAs("system"),
      {
        lines: [
          { itemId: service, quantity: 2, supplierIds: [f.ids.supplier] },
          {
            itemId: f.ids.item,
            quantity: 0.1 * 3,
            supplierIds: [f.ids.supplier]
          }
        ]
      }
    );
    expect(result.error).toBeNull();

    const lines = await f.db
      .selectFrom("purchasingRfqLine")
      .select(["itemId", "quantity", "purchaseUnitOfMeasureCode", "conversionFactor"])
      .where("companyId", "=", f.companyId)
      .orderBy("order")
      .execute();
    expect(lines).toEqual([
      {
        itemId: service,
        quantity: [2],
        purchaseUnitOfMeasureCode: "EA",
        conversionFactor: 1
      },
      {
        itemId: f.ids.item,
        quantity: [0.3],
        purchaseUnitOfMeasureCode: "EA",
        conversionFactor: 1
      }
    ]);
  } finally {
    await f.cleanup();
  }
});

test("Request Quote refuses another company's location", async () => {
  const f = await fixture();
  try {
    await secondSupplierAndSequence(f);
    const foreign = `${f.ids.supplier}-location`;
    await sql`
      INSERT INTO "location" (id, name, "addressLine1", city, "stateProvince", "postalCode",
        "countryCode", timezone, "companyId", "createdBy")
      VALUES (${foreign}, 'Foreign', '1 Main', 'City', 'ST', '00000', 'US', 'UTC',
        ${f.otherCompanyId}, 'system')
    `.execute(f.db);

    const result = await purchasing.requestQuoteFromItem(
      f.contextAs("system"),
      {
        locationId: foreign,
        lines: [
          { itemId: f.ids.item, quantity: 1, supplierIds: [f.ids.supplier] }
        ]
      }
    );

    expect(result.error).toMatchObject({
      category: "validation",
      message: "Item, supplier or location not found"
    });
    const rfqs = await f.db
      .selectFrom("purchasingRfq")
      .select("id")
      .where("companyId", "=", f.companyId)
      .execute();
    expect(rfqs).toEqual([]);
  } finally {
    await f.cleanup();
  }
});

test("Request Quote rolls back the RFQs it made when a later one fails", async () => {
  const f = await fixture();
  try {
    const second = await secondSupplierAndSequence(f);

    // The second RFQ names one supplier twice, which its unique key refuses
    // after both RFQs are written, so the RFQ rows must roll back.
    await expect(
      service.insertRequestQuoteRfqs(f.db, {
        companyId: f.companyId,
        userId: "system",
        rfqDate: "2026-11-10",
        groups: [
          {
            supplierIds: [f.ids.supplier],
            lines: [
              { itemId: f.ids.item, quantity: 1, supplierIds: [f.ids.supplier] }
            ]
          },
          {
            supplierIds: [second, second],
            lines: [{ itemId: f.ids.item, quantity: 1, supplierIds: [second] }]
          }
        ]
      })
    ).rejects.toThrow(/purchasingRfqSupplier_unique/);

    const rfqs = await f.db
      .selectFrom("purchasingRfq")
      .select("id")
      .where("companyId", "=", f.companyId)
      .execute();
    expect(rfqs).toEqual([]);
  } finally {
    await f.cleanup();
  }
});

test("Request Quote reads the parts to buy from the real method tree", async () => {
  const f = await fixture();
  try {
    const top = `${f.ids.item}-top`;
    const part = `${f.ids.item}-bought`;
    // Inserted with the triggers on: they add the make method and the item cost
    // that the method tree joins.
    await sql`
      INSERT INTO "item" (id, "readableId", name, type, "replenishmentSystem", "defaultMethodType",
        "itemTrackingType", "unitOfMeasureCode", "companyId", "createdBy") VALUES
        (${top}, 'TOP-1', 'Top', 'Part', 'Make', 'Make to Order', 'Inventory', 'EA', ${f.companyId}, 'system'),
        (${part}, 'BUY-1', 'Bought', 'Part', 'Buy', 'Pull from Inventory', 'Inventory', 'EA', ${f.companyId}, 'system')
    `.execute(f.db);
    const method = await f.db
      .selectFrom("makeMethod")
      .select("id")
      .where("itemId", "=", top)
      .executeTakeFirstOrThrow();
    await sql`
      INSERT INTO "methodMaterial" ("makeMethodId", "itemId", "itemType", quantity, "methodType",
        "unitOfMeasureCode", "companyId", "createdBy")
      VALUES (${method.id}, ${part}, 'Part', 3, 'Pull from Inventory', 'EA', ${f.companyId}, 'system')
    `.execute(f.db);
    await sql`
      INSERT INTO "supplierPart" ("itemId", "supplierId", "companyId", "createdBy")
      VALUES (${part}, ${f.ids.supplier}, ${f.companyId}, 'system')
    `.execute(f.db);

    const result = await purchasing.getRequestQuoteRows(f.contextAs("system"), {
      itemId: top
    });

    expect(result.error).toBeNull();
    expect(result.data?.rows).toMatchObject([
      {
        itemId: part,
        quantity: 3,
        usedIn: ["TOP-1"],
        defaultSupplierId: f.ids.supplier
      }
    ]);
  } finally {
    await f.cleanup();
  }
});

test("Request Quote refuses another company's supplier and creates nothing", async () => {
  const f = await fixture();
  try {
    await secondSupplierAndSequence(f);
    const foreign = `${f.ids.supplier}-foreign`;
    await sql`
      INSERT INTO "supplier" (id, name, "readableId", "companyId", "createdBy")
      VALUES (${foreign}, 'Foreign', 'F1', ${f.otherCompanyId}, 'system')
    `.execute(f.db);

    const result = await purchasing.requestQuoteFromItem(
      f.contextAs("system"),
      {
        lines: [
          { itemId: f.ids.item, quantity: 1, supplierIds: [f.ids.supplier] },
          { itemId: f.ids.item, quantity: 1, supplierIds: [foreign] }
        ]
      }
    );

    expect(result.error).toMatchObject({
      category: "validation",
      message: "Item, supplier or location not found"
    });
    const rfqs = await f.db
      .selectFrom("purchasingRfq")
      .select("id")
      .where("companyId", "=", f.companyId)
      .execute();
    expect(rfqs).toEqual([]);
  } finally {
    await f.cleanup();
  }
});

test("Request Quote rows need parts view as well as purchasing", async () => {
  const f = await fixture();
  try {
    // The Bill of Material is read as the caller, under parts_view.
    const buyerOnly = createServiceContext({
      actor: {
        type: "user",
        userId: "pgtest-buyer",
        permissions: {
          purchasing: {
            view: [f.companyId],
            create: [f.companyId],
            update: [f.companyId],
            delete: []
          }
        }
      },
      company: { id: f.companyId, groupId: f.groupId },
      caller: client!,
      system: () => client!,
      pg: () => f.db,
      kv: () => {
        throw new Error("No operation here reads the cache");
      }
    });

    const result = await purchasing.getRequestQuoteRows(buyerOnly, {
      itemId: f.ids.item
    });
    expect(result.error).toMatchObject({ category: "forbidden" });
  } finally {
    await f.cleanup();
  }
});
