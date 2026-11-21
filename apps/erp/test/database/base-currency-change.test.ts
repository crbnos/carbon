// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// A base currency change relabels: every amount keeps its number, and the rows
// written in the old base follow it to the new one in the same transaction.

import { expect } from "vitest";
import { updateCompanyWithBaseCurrencyChange } from "../../app/modules/settings/settings.service";
import {
  connectLocalTestDatabase,
  databaseTest
} from "./fixtures/local-database";

type Db = Awaited<ReturnType<typeof connectLocalTestDatabase>>;

const USER = "system";

/** A company with no transactions in USD, with one of each row a change moves. */
async function trialCompany(db: Db) {
  const tag = crypto.randomUUID().replaceAll("-", "").slice(0, 12);
  const group = await db
    .insertInto("companyGroup")
    .values({ name: `Base change ${tag}`, createdBy: USER })
    .returning("id")
    .executeTakeFirstOrThrow();
  const company = await db
    .insertInto("company")
    .values({
      name: `Base change ${tag}`,
      baseCurrencyCode: "USD",
      companyGroupId: group.id
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  const companyId = company.id;
  const elimination = await db
    .insertInto("company")
    .values({
      name: `Base change ${tag} eliminations`,
      baseCurrencyCode: "USD",
      companyGroupId: group.id,
      parentCompanyId: companyId,
      isEliminationEntity: true
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  const customer = await db
    .insertInto("customer")
    .values({ name: "Customer", companyId, currencyCode: "USD", createdBy: USER })
    .returning("id")
    .executeTakeFirstOrThrow();
  const supplier = await db
    .insertInto("supplier")
    .values({ name: "Supplier", companyId, currencyCode: "USD", createdBy: USER })
    .returning("id")
    .executeTakeFirstOrThrow();
  const item = await db
    .insertInto("item")
    .values({
      readableId: `BC-${tag}`,
      name: "Part",
      type: "Part",
      itemTrackingType: "Inventory",
      companyId,
      createdBy: USER
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  await db
    .insertInto("supplierPart")
    .values({
      itemId: item.id,
      supplierId: supplier.id,
      companyId,
      currencyCode: "USD",
      createdBy: USER
    })
    .execute();
  // The item's insert writes its sale price row in the base.
  await db
    .updateTable("itemUnitSalePrice")
    .set({ unitSalePrice: 12 })
    .where("itemId", "=", item.id)
    .where("companyId", "=", companyId)
    .execute();
  await db
    .insertInto("itemRentalRate")
    .values({
      itemId: item.id,
      companyId,
      currencyCode: "USD",
      dayRate: 40,
      createdBy: USER
    })
    .execute();
  await db
    .insertInto("customerItemRentalRate")
    .values({
      itemId: item.id,
      customerId: customer.id,
      companyId,
      currencyCode: "USD",
      dayRate: 35,
      createdBy: USER
    })
    .execute();
  await db
    .insertInto("exchangeRateOverride")
    .values({ companyId, currencyCode: "EUR", rate: 0.9, createdBy: USER })
    .execute();

  const read = async () => {
    const codeOf = (table: "customer" | "supplier" | "supplierPart") =>
      db
        .selectFrom(table)
        .select("currencyCode")
        .where("companyId", "=", companyId)
        .executeTakeFirstOrThrow()
        .then((row) => row.currencyCode);
    return {
      company: await db
        .selectFrom("company")
        .select("baseCurrencyCode")
        .where("id", "=", companyId)
        .executeTakeFirstOrThrow()
        .then((row) => row.baseCurrencyCode),
      eliminationEntity: await db
        .selectFrom("company")
        .select("baseCurrencyCode")
        .where("id", "=", elimination.id)
        .executeTakeFirstOrThrow()
        .then((row) => row.baseCurrencyCode),
      customer: await codeOf("customer"),
      supplier: await codeOf("supplier"),
      supplierPart: await codeOf("supplierPart"),
      salePrices: await db
        .selectFrom("itemUnitSalePrice")
        .select(["currencyCode", "unitSalePrice"])
        .where("companyId", "=", companyId)
        .execute(),
      rentalRates: await db
        .selectFrom("itemRentalRate")
        .select(["currencyCode", "dayRate"])
        .where("companyId", "=", companyId)
        .orderBy("currencyCode")
        .execute(),
      customerRentalRates: await db
        .selectFrom("customerItemRentalRate")
        .select(["currencyCode", "dayRate"])
        .where("companyId", "=", companyId)
        .orderBy("currencyCode")
        .execute(),
      overrides: await db
        .selectFrom("exchangeRateOverride")
        .select("currencyCode")
        .where("companyId", "=", companyId)
        .execute(),
      activeCurrencies: await db
        .selectFrom("currency")
        .select("code")
        .where("companyGroupId", "=", group.id)
        .where("active", "=", true)
        .execute()
        .then((rows) => rows.map((row) => row.code))
    };
  };

  const cleanup = async () => {
    for (const table of [
      "customerItemRentalRate",
      "itemRentalRate",
      "itemUnitSalePrice",
      "supplierPart",
      "exchangeRateOverride",
      "customer",
      "supplier",
      "item"
    ] as const) {
      await db.deleteFrom(table).where("companyId", "=", companyId).execute();
    }
    await db.deleteFrom("company").where("id", "=", elimination.id).execute();
    await db.deleteFrom("company").where("id", "=", companyId).execute();
    await db
      .deleteFrom("currency")
      .where("companyGroupId", "=", group.id)
      .execute();
    await db.deleteFrom("companyGroup").where("id", "=", group.id).execute();
  };

  return { companyId, itemId: item.id, customerId: customer.id, read, cleanup };
}

const change = (
  db: Db,
  companyId: string,
  baseCurrencyCode: string,
  keepRecordCurrencies = false
) =>
  updateCompanyWithBaseCurrencyChange(db, companyId, {
    baseCurrencyCode,
    keepRecordCurrencies,
    updatedBy: USER
  });

databaseTest(
  "a change moves the old base's records, prices, rental rates and elimination entity, and keeps every amount",
  async () => {
    const db = await connectLocalTestDatabase();
    const f = await trialCompany(db);
    try {
      await change(db, f.companyId, "CAD");
      expect(await f.read()).toEqual({
        company: "CAD",
        eliminationEntity: "CAD",
        customer: "CAD",
        supplier: "CAD",
        supplierPart: "CAD",
        salePrices: [{ currencyCode: "CAD", unitSalePrice: 12 }],
        rentalRates: [{ currencyCode: "CAD", dayRate: 40 }],
        customerRentalRates: [{ currencyCode: "CAD", dayRate: 35 }],
        overrides: [],
        activeCurrencies: ["CAD"]
      });
    } finally {
      await f.cleanup();
      await db.destroy();
    }
  }
);

databaseTest(
  "keepRecordCurrencies leaves customers, suppliers and supplier parts in the old base",
  async () => {
    const db = await connectLocalTestDatabase();
    const f = await trialCompany(db);
    try {
      await change(db, f.companyId, "CAD", true);
      const after = await f.read();
      expect({
        customer: after.customer,
        supplier: after.supplier,
        supplierPart: after.supplierPart,
        salePrices: after.salePrices
      }).toEqual({
        customer: "USD",
        supplier: "USD",
        supplierPart: "USD",
        salePrices: [{ currencyCode: "CAD", unitSalePrice: 12 }]
      });
    } finally {
      await f.cleanup();
      await db.destroy();
    }
  }
);

databaseTest(
  "an item or customer with rental rates already in the new base keeps both ladders",
  async () => {
    const db = await connectLocalTestDatabase();
    const f = await trialCompany(db);
    try {
      await db
        .insertInto("itemRentalRate")
        .values({
          itemId: f.itemId,
          companyId: f.companyId,
          currencyCode: "CAD",
          dayRate: 55,
          createdBy: USER
        })
        .execute();
      await db
        .insertInto("customerItemRentalRate")
        .values({
          itemId: f.itemId,
          customerId: f.customerId,
          companyId: f.companyId,
          currencyCode: "CAD",
          dayRate: 50,
          createdBy: USER
        })
        .execute();
      await change(db, f.companyId, "CAD");
      const after = await f.read();
      expect({
        rentalRates: after.rentalRates,
        customerRentalRates: after.customerRentalRates
      }).toEqual({
        rentalRates: [
          { currencyCode: "CAD", dayRate: 55 },
          { currencyCode: "USD", dayRate: 40 }
        ],
        customerRentalRates: [
          { currencyCode: "CAD", dayRate: 50 },
          { currencyCode: "USD", dayRate: 35 }
        ]
      });
    } finally {
      await f.cleanup();
      await db.destroy();
    }
  }
);

databaseTest(
  "a save that keeps the base deletes no exchange-rate override",
  async () => {
    const db = await connectLocalTestDatabase();
    const f = await trialCompany(db);
    try {
      await change(db, f.companyId, "USD");
      const after = await f.read();
      expect({ company: after.company, overrides: after.overrides }).toEqual({
        company: "USD",
        overrides: [{ currencyCode: "EUR" }]
      });
    } finally {
      await f.cleanup();
      await db.destroy();
    }
  }
);
