// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// A back-loaded sales invoice or sales order shipment posts on the date the
// caller chose: its journal, ledgers, period and (an invoice) issue and due
// dates. A future date, or one before the accounting cutover, is refused.
// Runs against the local database; skipped without one.

import { parseDate } from "@internationalized/date";
import { expect } from "vitest";
import { postShipment } from "../../app/modules/inventory/inventory.service";
import { postSalesInvoice } from "../../app/modules/invoicing/invoicing.service";
import {
  invokeCreate,
  invokePosting
} from "../../app/modules/shared/shared.service";
import {
  alwaysPostFixture,
  type Fixture,
  newJournals,
  seed,
  stampCutover,
  stockPart,
  USER,
  unwrap
} from "./fixtures/always-post";
import { handlesOf } from "./fixtures/handles";
import { databaseTest } from "./fixtures/local-database";

/** A Draft service invoice to the fixture's customer for 100. */
async function draftSalesInvoice(f: Fixture, key: string): Promise<string> {
  const invoiceId = `${f.prefix}-sales-invoice-${key}`;
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
      .values({
        invoiceId,
        invoiceLineType: "Service",
        itemId: f.serviceId,
        quantity: 1,
        unitPrice: 100,
        exchangeRate: 1,
        unitOfMeasureCode: "EA",
        companyId: f.companyId,
        createdBy: USER
      })
      .execute();
  });
  return invoiceId;
}

/** A Draft shipment of 4 of the part on a new sales order. */
async function draftSalesOrderShipment(
  f: Fixture,
  key: string
): Promise<string> {
  const salesOrderId = `${f.prefix}-so-${key}`;
  await seed(f, async (trx) => {
    await trx
      .insertInto("salesOrder")
      .values({
        id: salesOrderId,
        salesOrderId: `SO-${key}`,
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
      .execute();
    await trx
      .insertInto("salesOrderLine")
      .values({
        salesOrderId,
        salesOrderLineType: "Part",
        itemId: f.partId,
        saleQuantity: 4,
        unitPrice: 25,
        methodType: "Pull from Inventory",
        unitOfMeasureCode: "EA",
        locationId: f.locationId,
        companyId: f.companyId,
        createdBy: USER
      })
      .execute();
  });
  const shipment = unwrap(
    await invokeCreate(handlesOf(f.ctx), {
      type: "shipmentFromSalesOrder",
      salesOrderId,
      locationId: f.locationId
    })
  );
  return shipment.id;
}

function postInvoice(f: Fixture, invoiceId: string, postingDate?: string) {
  return invokePosting(
    handlesOf(f.ctx),
    "post-sales-invoice",
    { type: "post", invoiceId, postingDate },
    postSalesInvoice
  );
}

function postSalesShipment(
  f: Fixture,
  shipmentId: string,
  postingDate?: string
) {
  return invokePosting(
    handlesOf(f.ctx),
    "post-shipment",
    { type: "post", shipmentId, postingDate },
    postShipment
  );
}

async function journalDates(f: Fixture, ids: string[]) {
  const rows = await f.db
    .selectFrom("journal")
    .select("postingDate")
    .where("companyId", "=", f.companyId)
    .where("id", "in", ids)
    .execute();
  return rows.map((row) => row.postingDate);
}

databaseTest(
  "a dated sales invoice posts its journal, issue date and due date on that date",
  async () => {
    const f = await alwaysPostFixture();
    try {
      // No cutover: the journal is Provisional, so any earlier day is allowed.
      const postingDate = parseDate(f.today).subtract({ days: 40 }).toString();
      const invoiceId = await draftSalesInvoice(f, "1");

      const journals = await newJournals(f, async () =>
        unwrap(await postInvoice(f, invoiceId, postingDate))
      );

      expect(journals.length).toBeGreaterThan(0);
      expect(
        await journalDates(
          f,
          journals.map((journal) => journal.id)
        )
      ).toEqual(journals.map(() => postingDate));
      const invoice = await f.db
        .selectFrom("salesInvoice")
        .select(["postingDate", "dateIssued", "dateDue"])
        .where("id", "=", invoiceId)
        .executeTakeFirstOrThrow();
      expect(invoice).toEqual({
        postingDate,
        dateIssued: postingDate,
        // No payment term: Net 30 from the posting date, not from today.
        dateDue: parseDate(postingDate).add({ days: 30 }).toString()
      });
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "a sales invoice dated in the future, or before the cutover, is refused",
  async () => {
    const f = await alwaysPostFixture();
    try {
      await stampCutover(f);
      const invoiceId = await draftSalesInvoice(f, "1");
      const tomorrow = parseDate(f.today).add({ days: 1 }).toString();

      const future = await postInvoice(f, invoiceId, tomorrow);
      expect(future.error?.message).toBe(
        "The posting date cannot be in the future"
      );
      const beforeCutover = await postInvoice(f, invoiceId, f.beforeCutover);
      expect(beforeCutover.error?.message).toBe(
        `The posting date cannot be before the accounting cutover (${f.cutoverDate})`
      );

      const invoice = await f.db
        .selectFrom("salesInvoice")
        .select(["postingDate"])
        .where("id", "=", invoiceId)
        .executeTakeFirstOrThrow();
      expect(invoice.postingDate).toBeNull();
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "a dated sales order shipment dates its item ledger, cost ledger and COGS journal",
  async () => {
    const f = await alwaysPostFixture();
    try {
      const postingDate = parseDate(f.today).subtract({ days: 40 }).toString();
      await stockPart(f, 10);
      const shipmentId = await draftSalesOrderShipment(f, "1");

      const journals = await newJournals(f, async () =>
        unwrap(await postSalesShipment(f, shipmentId, postingDate))
      );

      const itemLedger = await f.db
        .selectFrom("itemLedger")
        .select("postingDate")
        .where("companyId", "=", f.companyId)
        .where("documentId", "=", shipmentId)
        .execute();
      expect(itemLedger.length).toBeGreaterThan(0);
      expect(itemLedger.map((row) => row.postingDate)).toEqual(
        itemLedger.map(() => postingDate)
      );

      const costLedger = await f.db
        .selectFrom("costLedger")
        .select("postingDate")
        .where("companyId", "=", f.companyId)
        .where("documentId", "=", shipmentId)
        .execute();
      expect(costLedger.length).toBeGreaterThan(0);
      expect(costLedger.map((row) => row.postingDate)).toEqual(
        costLedger.map(() => postingDate)
      );

      expect(journals.length).toBeGreaterThan(0);
      expect(
        await journalDates(
          f,
          journals.map((journal) => journal.id)
        )
      ).toEqual(journals.map(() => postingDate));

      const shipment = await f.db
        .selectFrom("shipment")
        .select(["status", "postingDate"])
        .where("id", "=", shipmentId)
        .executeTakeFirstOrThrow();
      expect(shipment).toEqual({ status: "Posted", postingDate });
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "a sales order shipment dated in the future is refused and stays a Draft",
  async () => {
    const f = await alwaysPostFixture();
    try {
      await stockPart(f, 10);
      const shipmentId = await draftSalesOrderShipment(f, "1");
      const tomorrow = parseDate(f.today).add({ days: 1 }).toString();

      const result = await postSalesShipment(f, shipmentId, tomorrow);

      expect(result.error?.message).toBe(
        "The posting date cannot be in the future"
      );
      const shipment = await f.db
        .selectFrom("shipment")
        .select(["status", "postingDate"])
        .where("id", "=", shipmentId)
        .executeTakeFirstOrThrow();
      expect(shipment).toEqual({ status: "Draft", postingDate: null });
    } finally {
      await f.cleanup();
    }
  }
);
