// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// A quote with no location (Paperless Parts imports never set one) still
// converts to a sales order with a location on the order, its lines and its
// shipment: the company's first location.

import { expect, vi } from "vitest";
import {
  alwaysPostFixture,
  seed,
  USER,
  unwrap
} from "../always-post-test-fixture";
import { databaseTest } from "../local-database-test-fixture";
import convert from "./index";

// `convert` builds a service-role client up front; the quote path never uses
// it, and the real one pulls in the browser UI package.
vi.mock("@carbon/auth", () => ({ getCarbonClient: () => ({}) }));
vi.mock("@carbon/env", () => ({ SUPABASE_SERVICE_ROLE_KEY: "test" }));

databaseTest(
  "a quote with no location converts to an order at the first location",
  async () => {
    const f = await alwaysPostFixture();
    try {
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
        await convert(f.ctx, {
          type: "quoteToSalesOrder",
          id: quoteId,
          selectedLines: { [quoteLineId]: { quantity: 4 } }
        })
      );

      const order = await f.db
        .selectFrom("salesOrder")
        .select("locationId")
        .where("id", "=", convertedId!)
        .executeTakeFirstOrThrow();
      const lines = await f.db
        .selectFrom("salesOrderLine")
        .select("locationId")
        .where("salesOrderId", "=", convertedId!)
        .execute();
      const shipment = await f.db
        .selectFrom("salesOrderShipment")
        .select("locationId")
        .where("id", "=", convertedId!)
        .executeTakeFirstOrThrow();

      expect(order.locationId).toBe(f.locationId);
      expect(lines.map((line) => line.locationId)).toEqual([f.locationId]);
      expect(shipment.locationId).toBe(f.locationId);
    } finally {
      await f.cleanup();
    }
  }
);
