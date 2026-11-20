// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// A quote with no location (Paperless Parts imports never set one) still
// converts to a sales order with a location on the order, its lines and its
// shipment: the company's first location.
// Runs against the local database (SUPABASE_DB_URL); skipped without one.

import { parseDate } from "@internationalized/date";
import { expect } from "vitest";
import {
  alwaysPostFixture,
  type Fixture,
  seed,
  USER,
  unwrap
} from "./fixtures/always-post";
import { databaseTest } from "./fixtures/local-database";
import {
  convertDocument,
  invokePosting
} from "../../app/modules/shared/shared.service";

// A Sent quote of one Pull from Inventory line for 4 of the fixture's part,
// converted to a sales order. Returns the order id.
async function convertQuote(
  f: Fixture,
  tax?: { taxCodeId: string; taxPercent: number }
) {
  const quoteId = `${f.prefix}-quote`;
  const quoteLineId = `${f.prefix}-quote-line`;
  await seed(f, async (trx) => {
    await trx
      .insertInto("sequence")
      .values({
        table: "salesOrder",
        name: "Sales Order",
        prefix: "SO-",
        companyId: f.companyId
      })
      .execute();
    await trx
      .insertInto("quote")
      .values({
        id: quoteId,
        quoteId: "Q-1",
        customerId: f.customerId,
        status: "Sent",
        currencyCode: "USD",
        exchangeRate: 1,
        companyId: f.companyId,
        createdBy: USER
      })
      .execute();
    await trx
      .insertInto("quotePayment")
      .values({ id: quoteId, companyId: f.companyId })
      .execute();
    await trx
      .insertInto("quoteShipment")
      .values({ id: quoteId, companyId: f.companyId })
      .execute();
    await trx
      .insertInto("quoteLine")
      .values({
        id: quoteLineId,
        quoteId,
        itemId: f.partId,
        itemType: "Part",
        description: "Bracket",
        methodType: "Pull from Inventory",
        unitOfMeasureCode: "EA",
        quantity: [4],
        ...tax,
        companyId: f.companyId,
        createdBy: USER
      })
      .execute();
    await trx
      .insertInto("quoteLinePrice")
      .values({
        quoteId,
        quoteLineId,
        quantity: 4,
        unitPrice: 25,
        leadTime: 0,
        companyId: f.companyId,
        createdBy: USER
      })
      .execute();
  });

  const { convertedId } = unwrap(
    await invokePosting(
      f.service,
      "convert",
      {
        type: "quoteToSalesOrder",
        id: quoteId,
        selectedLines: { [quoteLineId]: { quantity: 4 } }
      },
      convertDocument
    )
  );
  return convertedId!;
}

databaseTest(
  "a quote with no location converts to an order at the first location",
  async () => {
    const f = await alwaysPostFixture();
    try {
      const convertedId = await convertQuote(f);
      const order = await f.db
        .selectFrom("salesOrder")
        .select("locationId")
        .where("id", "=", convertedId)
        .executeTakeFirstOrThrow();
      const lines = await f.db
        .selectFrom("salesOrderLine")
        .select("locationId")
        .where("salesOrderId", "=", convertedId)
        .execute();
      const shipment = await f.db
        .selectFrom("salesOrderShipment")
        .select("locationId")
        .where("id", "=", convertedId)
        .executeTakeFirstOrThrow();

      expect(order.locationId).toBe(f.locationId);
      expect(lines.map((line) => line.locationId)).toEqual([f.locationId]);
      expect(shipment.locationId).toBe(f.locationId);
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "a quote line with no default bin converts to the bin that holds its stock",
  async () => {
    const f = await alwaysPostFixture();
    try {
      const shelf = `${f.prefix}-shelf`;
      await seed(f, async (trx) => {
        await trx
          .insertInto("storageUnit")
          .values({
            id: shelf,
            name: "Shelf",
            locationId: f.locationId,
            companyId: f.companyId,
            createdBy: USER
          })
          .execute();
        await trx
          .insertInto("itemLedger")
          .values({
            entryType: "Positive Adjmt.",
            itemId: f.partId,
            locationId: f.locationId,
            storageUnitId: shelf,
            quantity: 10,
            companyId: f.companyId,
            createdBy: USER
          })
          .execute();
      });

      const convertedId = await convertQuote(f);

      const lines = await f.db
        .selectFrom("salesOrderLine")
        .select("storageUnitId")
        .where("salesOrderId", "=", convertedId)
        .execute();
      expect(lines).toEqual([{ storageUnitId: shelf }]);
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "a converted line keeps its tax code and takes the code's rate on the new document's date",
  async () => {
    const f = await alwaysPostFixture();
    try {
      // 17.5% until yesterday, 20% from today: the quote was rated at 17.5%.
      const yesterday = parseDate(f.today).subtract({ days: 1 }).toString();
      const taxCodeId = `${f.prefix}-vat`;
      await seed(f, async (trx) => {
        await trx
          .insertInto("taxCode")
          .values({
            id: taxCodeId,
            name: "VAT",
            companyId: f.companyId,
            createdBy: USER
          })
          .execute();
        await trx
          .insertInto("taxCodeComponent")
          .values([
            {
              taxCodeId,
              name: "VAT 17.5",
              taxPercent: 0.175,
              expirationDate: yesterday,
              sequence: 1,
              companyId: f.companyId,
              createdBy: USER
            },
            {
              taxCodeId,
              name: "VAT 20",
              taxPercent: 0.2,
              effectiveDate: f.today,
              sequence: 1,
              companyId: f.companyId,
              createdBy: USER
            }
          ])
          .execute();
      });

      const convertedId = await convertQuote(f, {
        taxCodeId,
        taxPercent: 0.175
      });

      const lines = await f.db
        .selectFrom("salesOrderLine")
        .select(["taxCodeId", "taxPercent"])
        .where("salesOrderId", "=", convertedId)
        .execute();
      expect(
        lines.map((line) => [line.taxCodeId, Number(line.taxPercent)])
      ).toEqual([[taxCodeId, 0.2]]);
    } finally {
      await f.cleanup();
    }
  }
);
