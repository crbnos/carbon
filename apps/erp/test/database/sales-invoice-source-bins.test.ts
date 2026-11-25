// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Runs against the local database (SUPABASE_DB_URL); skipped without one.

// A direct sales invoice line (no sales order) ships its stock on the
// invoice. A line with no bin takes it from a bin that holds the stock, never
// from "no storage unit" while a bin holds it, and the void puts it back in
// that bin.

import { afterAll, beforeAll, describe, expect } from "vitest";
import { postSalesInvoice } from "../../app/modules/invoicing/invoicing.service";
import { invokePosting } from "../../app/modules/shared/shared.service";
import {
  alwaysPostFixture,
  type Fixture,
  seed,
  USER,
  unwrap
} from "./fixtures/always-post";
import { handlesOf } from "./fixtures/handles";
import { databaseTest, hasLocalDatabase } from "./fixtures/local-database";

describe.skipIf(!hasLocalDatabase)("direct sales invoice source bins", () => {
  let f: Fixture;
  let binA: string;
  let binB: string;
  let quarantine: string;

  beforeAll(async () => {
    f = await alwaysPostFixture();
    binA = `${f.prefix}-a`;
    binB = `${f.prefix}-b`;
    quarantine = `${f.prefix}-quarantine`;
    await seed(f, (trx) =>
      trx
        .insertInto("storageUnit")
        .values(
          [
            { id: binA, name: "A", nettable: true },
            { id: binB, name: "B", nettable: true },
            { id: quarantine, name: "Quarantine", nettable: false }
          ].map((unit) => ({
            ...unit,
            locationId: f.locationId,
            companyId: f.companyId,
            createdBy: USER
          }))
        )
        .execute()
    );
  });

  afterAll(async () => {
    await f?.cleanup();
  });

  /** An untracked part, with `stock` on hand per bin at the location. */
  async function partWithStock(
    key: string,
    stock: [storageUnitId: string, quantity: number][]
  ) {
    const itemId = `${f.prefix}-item-${key}`;
    await seed(f, async (trx) => {
      await trx
        .insertInto("item")
        .values({
          id: itemId,
          readableId: itemId.toUpperCase(),
          name: key,
          type: "Part",
          itemTrackingType: "Inventory",
          unitOfMeasureCode: "EA",
          replenishmentSystem: "Buy",
          companyId: f.companyId,
          createdBy: USER
        })
        .execute();
      await trx
        .updateTable("itemCost")
        .set({ costingMethod: "FIFO", unitCost: 10 })
        .where("itemId", "=", itemId)
        .where("companyId", "=", f.companyId)
        .execute();
      await trx
        .insertInto("itemLedger")
        .values(
          stock.map(([storageUnitId, quantity]) => ({
            entryType: "Positive Adjmt." as const,
            documentType: "Inventory Receipt" as const,
            itemId,
            locationId: f.locationId,
            storageUnitId,
            quantity,
            companyId: f.companyId,
            createdBy: USER
          }))
        )
        .execute();
    });
    return itemId;
  }

  /** Posts a Draft invoice with one direct Part line per entry. */
  async function postDirectInvoice(
    key: string,
    lines: {
      itemId: string;
      quantity: number;
      storageUnitId?: string | null;
    }[]
  ) {
    const invoiceId = `${f.prefix}-invoice-${key}`;
    await seed(f, async (trx) => {
      await trx
        .insertInto("salesInvoice")
        .values({
          id: invoiceId,
          invoiceId: `INV-${key}`,
          customerId: f.customerId,
          currencyCode: "USD",
          exchangeRate: 1,
          status: "Draft",
          companyId: f.companyId,
          createdBy: USER
        })
        .execute();
      await trx
        .insertInto("salesInvoiceShipment")
        .values({
          id: invoiceId,
          shippingCost: 0,
          companyId: f.companyId,
          createdBy: USER
        })
        .execute();
      await trx
        .insertInto("salesInvoiceLine")
        .values(
          lines.map((line) => ({
            invoiceId,
            invoiceLineType: "Part" as const,
            itemId: line.itemId,
            methodType: "Pull from Inventory" as const,
            locationId: f.locationId,
            storageUnitId: line.storageUnitId ?? null,
            quantity: line.quantity,
            unitPrice: 50,
            exchangeRate: 1,
            unitOfMeasureCode: "EA",
            companyId: f.companyId,
            createdBy: USER
          }))
        )
        .execute();
    });
    unwrap(
      await invokePosting(
        handlesOf(f.ctx),
        "post-sales-invoice",
        { type: "post", invoiceId },
        postSalesInvoice
      )
    );
    return invoiceId;
  }

  /** The invoice's item ledger rows for one item, oldest first. */
  const ledgerRows = (invoiceId: string, itemId: string) =>
    f.db
      .selectFrom("itemLedger")
      .select(["storageUnitId", "quantity"])
      .where("companyId", "=", f.companyId)
      .where("documentId", "=", invoiceId)
      .where("itemId", "=", itemId)
      .orderBy("entryNumber")
      .execute();

  /** The bin of each shipment line the invoice wrote for one item. */
  const shipmentLineBins = async (invoiceId: string, itemId: string) =>
    (
      await f.db
        .selectFrom("shipmentLine")
        .innerJoin("shipment", "shipment.id", "shipmentLine.shipmentId")
        .select("shipmentLine.storageUnitId")
        .where("shipment.companyId", "=", f.companyId)
        .where("shipment.sourceDocumentId", "=", invoiceId)
        .where("shipmentLine.itemId", "=", itemId)
        .execute()
    ).map((row) => row.storageUnitId);

  databaseTest(
    "a line with no bin ships from the only bin that holds the stock",
    async () => {
      const itemId = await partWithStock("only-a", [[binA, 5]]);
      const invoiceId = await postDirectInvoice("only-a", [
        { itemId, quantity: 2 }
      ]);
      expect(await ledgerRows(invoiceId, itemId)).toEqual([
        { storageUnitId: binA, quantity: -2 }
      ]);
      expect(await shipmentLineBins(invoiceId, itemId)).toEqual([binA]);
    }
  );

  databaseTest(
    "a line with no bin ships from a bin that covers its quantity",
    async () => {
      const itemId = await partWithStock("covers", [
        [binA, 1],
        [binB, 5]
      ]);
      const invoiceId = await postDirectInvoice("covers", [
        { itemId, quantity: 3 }
      ]);
      expect(await ledgerRows(invoiceId, itemId)).toEqual([
        { storageUnitId: binB, quantity: -3 }
      ]);
    }
  );

  databaseTest(
    "two lines of one item do not count the same stock",
    async () => {
      // B covers the first line (4 of 5); A (3) covers the second, not B's 1 left.
      const itemId = await partWithStock("two-lines", [
        [binA, 3],
        [binB, 5]
      ]);
      const invoiceId = await postDirectInvoice("two-lines", [
        { itemId, quantity: 4 },
        { itemId, quantity: 3 }
      ]);
      expect(
        (await ledgerRows(invoiceId, itemId)).map((row) => row.storageUnitId)
      ).toEqual([binB, binA]);
    }
  );

  databaseTest("a line that names its bin ships from it", async () => {
    const itemId = await partWithStock("named", [
      [binA, 1],
      [binB, 5]
    ]);
    const invoiceId = await postDirectInvoice("named", [
      { itemId, quantity: 3, storageUnitId: binA }
    ]);
    expect(await ledgerRows(invoiceId, itemId)).toEqual([
      { storageUnitId: binA, quantity: -3 }
    ]);
  });

  databaseTest("a quarantine bin is never chosen", async () => {
    const itemId = await partWithStock("quarantine", [
      [quarantine, 10],
      [binA, 2]
    ]);
    const invoiceId = await postDirectInvoice("quarantine", [
      { itemId, quantity: 4 }
    ]);
    // A holds less than the line ships, but it is the only nettable bin.
    expect(await ledgerRows(invoiceId, itemId)).toEqual([
      { storageUnitId: binA, quantity: -4 }
    ]);
  });

  databaseTest(
    "the void puts the stock back in the bin the post took it from",
    async () => {
      const itemId = await partWithStock("void", [[binB, 5]]);
      const invoiceId = await postDirectInvoice("void", [
        { itemId, quantity: 2 }
      ]);
      unwrap(
        await invokePosting(
          handlesOf(f.ctx),
          "post-sales-invoice",
          { type: "void", invoiceId },
          postSalesInvoice
        )
      );
      expect(await ledgerRows(invoiceId, itemId)).toEqual([
        { storageUnitId: binB, quantity: -2 },
        { storageUnitId: binB, quantity: 2 }
      ]);
    }
  );
});
