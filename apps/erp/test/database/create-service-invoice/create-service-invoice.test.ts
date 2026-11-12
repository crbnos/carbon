// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { sql } from "kysely";
import { expect } from "vitest";
import { postSalesInvoice } from "../../../app/modules/invoicing/invoicing.service";
import {
  deleteSalesInvoiceLineReleasingRentals,
  deleteSalesInvoiceReleasingRentals
} from "../../../app/modules/sales/sales.service";
import { createServiceInvoice } from "../../../app/modules/service/service.service";
import { invokePosting } from "../../../app/modules/shared/shared.service";
import { handlesOf } from "../fixtures/handles";
import { databaseTest } from "../fixtures/local-database";
import { PROJECT_TEST_USER } from "../fixtures/project-posting";
import { serviceJobFixture } from "../fixtures/service-job";

/** The service job fixture, plus its own AR and Sales accounts, a sale
 *  price on the charge item and a sales invoice sequence. */
async function invoiceFixture() {
  const f = await serviceJobFixture();
  await f.db.transaction().execute(async (trx) => {
    await sql`SET LOCAL "app.sync_in_progress" = 'true'`.execute(trx);
    await trx
      .insertInto("account")
      .values([
        {
          id: f.account("receivables"),
          name: "Accounts receivable",
          class: "Asset",
          incomeBalance: "Balance Sheet",
          companyGroupId: f.groupId,
          createdBy: PROJECT_TEST_USER
        },
        {
          id: f.account("sales"),
          name: "Sales",
          class: "Revenue",
          incomeBalance: "Income Statement",
          companyGroupId: f.groupId,
          createdBy: PROJECT_TEST_USER
        }
      ])
      .execute();
    await trx
      .updateTable("accountDefault")
      .set({
        receivablesAccount: f.account("receivables"),
        salesAccount: f.account("sales")
      })
      .where("companyId", "=", f.companyId)
      .execute();
    // An item insert may already have created its price row.
    await trx
      .deleteFrom("itemUnitSalePrice")
      .where("itemId", "=", f.serviceItemId)
      .execute();
    await trx
      .insertInto("itemUnitSalePrice")
      .values({
        itemId: f.serviceItemId,
        unitSalePrice: 95,
        currencyCode: "USD",
        companyId: f.companyId,
        createdBy: PROJECT_TEST_USER
      })
      .execute();
    await trx
      .insertInto("sequence")
      .values({
        table: "salesInvoice",
        name: "Sales Invoice",
        prefix: "INV",
        companyId: f.companyId
      })
      .onConflict((oc) => oc.doNothing())
      .execute();
  });

  return {
    ...f,
    createServiceInvoice(
      serviceJobId: string,
      dialog: { fixedPrice?: number } = {}
    ) {
      return invokePosting(
        handlesOf(f.ctx),
        "create-service-invoice",
        { serviceJobId, ...dialog },
        createServiceInvoice
      );
    },
    async cleanup() {
      // A posted invoice refuses its delete.
      await f.db.transaction().execute(async (trx) => {
        await sql`SET LOCAL session_replication_role = replica`.execute(trx);
        await trx
          .updateTable("salesInvoice")
          .set({ status: "Draft" })
          .where("companyId", "=", f.companyId)
          .execute();
      });
      await f.cleanup();
    }
  };
}

databaseTest(
  "invoicing a Completed Time and Materials job bills its hours on one Service line with no item and its parts, and posting it writes AR and Sales only",
  async () => {
    const f = await invoiceFixture();
    try {
      const { locationId, itemId: partId } = await f.addStockedItem("fuse", {
        quantity: 5,
        unitCost: 30
      });
      const job = await f.addJob({
        locationId,
        status: "In Progress",
        laborBillRate: 95
      });
      await f.addTime(job.id, { hours: 2 });
      await f.addTime(job.id, { hours: 1 });
      await f.db
        .insertInto("serviceJobItem")
        .values({
          serviceJobId: job.id,
          lineType: "Part",
          itemId: partId,
          description: "Fuse",
          quantity: 1,
          unitCost: 30,
          unitPrice: 120,
          companyId: f.companyId,
          createdBy: PROJECT_TEST_USER
        })
        .execute();

      // Not Completed yet: refused.
      const early = await f.createServiceInvoice(job.id);
      expect(early.error?.message).toContain("Only a Completed job");

      await f.db
        .updateTable("serviceJob")
        .set({ status: "Completed" })
        .where("id", "=", job.id)
        .where("companyId", "=", f.companyId)
        .execute();

      const result = await f.createServiceInvoice(job.id);
      expect(result.error).toBeNull();
      const invoiceId = result.data!.salesInvoiceId;

      const header = await f.db
        .selectFrom("salesInvoice")
        .select([
          "status",
          "customerId",
          "locationId",
          "customerReference",
          "totalAmount"
        ])
        .where("id", "=", invoiceId)
        .where("companyId", "=", f.companyId)
        .executeTakeFirstOrThrow();
      expect(header).toMatchObject({
        status: "Draft",
        customerId: f.customerId,
        locationId,
        customerReference: job.serviceJobId
      });
      // 3 hours at 95 is 285, and the fuse 120.
      expect(Number(header.totalAmount)).toEqual(405);

      const lines = await f.db
        .selectFrom("salesInvoiceLine")
        .select([
          "invoiceLineType",
          "itemId",
          "description",
          "quantity",
          "unitPrice",
          "unitOfMeasureCode",
          "serviceJobId"
        ])
        .where("invoiceId", "=", invoiceId)
        .where("companyId", "=", f.companyId)
        .orderBy("sortOrder")
        .execute();
      expect(
        lines.map((line) => [
          line.invoiceLineType,
          line.itemId,
          line.description,
          Number(line.quantity),
          Number(line.unitPrice),
          line.unitOfMeasureCode,
          line.serviceJobId
        ])
      ).toEqual([
        ["Service", null, "Labor", 3, 95, "EA", job.id],
        ["Service", partId, "Fuse", 1, 120, "EA", job.id]
      ]);

      const invoiced = await f.db
        .selectFrom("serviceJob")
        .select(["status", "salesInvoiceId"])
        .where("id", "=", job.id)
        .where("companyId", "=", f.companyId)
        .executeTakeFirstOrThrow();
      expect(invoiced).toEqual({ status: "Invoiced", salesInvoiceId: invoiceId });

      // Invoiced once: a second invoice is refused.
      const again = await f.createServiceInvoice(job.id);
      expect(again.error?.message).toContain("already invoiced");

      const posted = await invokePosting(
        handlesOf(f.ctx),
        "post-sales-invoice",
        { type: "post", invoiceId },
        postSalesInvoice
      );
      expect(posted.error).toBeNull();

      const journal = await f.db
        .selectFrom("journal")
        .select("id")
        .where("companyId", "=", f.companyId)
        .where("sourceType", "=", "Sales Invoice")
        .executeTakeFirstOrThrow();
      // Natural-balance signed, as stored: Dr AR, Cr Sales, and no COGS or
      // Inventory line.
      const byAccount = await f.db
        .selectFrom("journalLine")
        .select(["accountId", sql<number>`SUM("amount")`.as("amount")])
        .where("journalId", "=", journal.id)
        .groupBy("accountId")
        .execute();
      expect(
        Object.fromEntries(
          byAccount.map((line) => [line.accountId, Number(line.amount)])
        )
      ).toEqual({
        [f.account("receivables")]: 405,
        [f.account("sales")]: 405
      });

      // The part left stock when it was issued: the invoice moves none.
      const ledger = await f.db
        .selectFrom("itemLedger")
        .select("id")
        .where("companyId", "=", f.companyId)
        .where((eb) =>
          eb.or([
            eb("documentId", "=", invoiceId),
            eb("itemId", "=", partId).and("entryType", "<>", "Positive Adjmt.")
          ])
        )
        .execute();
      expect(ledger).toEqual([]);
      const shipments = await f.db
        .selectFrom("shipment")
        .select("id")
        .where("companyId", "=", f.companyId)
        .execute();
      expect(shipments).toEqual([]);
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "a Fixed Price job bills one Service line with no item at its price, and a Warranty job is refused",
  async () => {
    const f = await invoiceFixture();
    try {
      const { locationId } = await f.addStockedItem("unit", {
        quantity: 1,
        unitCost: 10
      });
      const fixed = await f.addJob({
        locationId,
        status: "Completed",
        billingMethod: "Fixed Price",
        estimateStatus: "Accepted"
      });
      await f.addTime(fixed.id, { hours: 3 });

      // No price yet: refused with the reason.
      const missing = await f.createServiceInvoice(fixed.id);
      expect(missing.error?.message).toBe("Set the job's fixed price first.");

      await f.db
        .updateTable("serviceJob")
        .set({ fixedPrice: 450 })
        .where("id", "=", fixed.id)
        .where("companyId", "=", f.companyId)
        .execute();
      const result = await f.createServiceInvoice(fixed.id);
      expect(result.error).toBeNull();
      const lines = await f.db
        .selectFrom("salesInvoiceLine")
        .select([
          "invoiceLineType",
          "itemId",
          "description",
          "quantity",
          "unitPrice",
          "unitOfMeasureCode",
          "serviceJobId"
        ])
        .where("invoiceId", "=", result.data!.salesInvoiceId)
        .where("companyId", "=", f.companyId)
        .execute();
      expect(
        lines.map((line) => [
          line.invoiceLineType,
          line.itemId,
          line.description,
          Number(line.quantity),
          Number(line.unitPrice),
          line.unitOfMeasureCode,
          line.serviceJobId
        ])
      ).toEqual([
        ["Service", null, "Fixed price service", 1, 450, "EA", fixed.id]
      ]);

      const warranty = await f.addJob({
        locationId,
        status: "Completed",
        coverage: "Warranty"
      });
      const refused = await f.createServiceInvoice(warranty.id);
      expect(refused.error?.message).toContain("Only a Billable job");

      // Billable hours on a job with no bill rate: refused.
      const unrated = await f.addJob({ locationId, status: "Completed" });
      await f.addTime(unrated.id, { hours: 1 });
      const noRate = await f.createServiceInvoice(unrated.id);
      expect(noRate.error?.message).toBe("Set the job's bill rate first.");
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "a Fixed Price job takes its price from the dialog, and its invoice posts AR and Sales only",
  async () => {
    const f = await invoiceFixture();
    try {
      const { locationId } = await f.addStockedItem("unit", {
        quantity: 1,
        unitCost: 10
      });
      const fixed = await f.addJob({
        locationId,
        status: "Completed",
        billingMethod: "Fixed Price"
      });

      const result = await f.createServiceInvoice(fixed.id, {
        fixedPrice: 500
      });
      expect(result.error).toBeNull();
      const invoiceId = result.data!.salesInvoiceId;
      const job = await f.db
        .selectFrom("serviceJob")
        .select(["status", "fixedPrice", "salesInvoiceId"])
        .where("id", "=", fixed.id)
        .where("companyId", "=", f.companyId)
        .executeTakeFirstOrThrow();
      expect({ ...job, fixedPrice: Number(job.fixedPrice) }).toEqual({
        status: "Invoiced",
        fixedPrice: 500,
        salesInvoiceId: invoiceId
      });
      const header = await f.db
        .selectFrom("salesInvoice")
        .select("totalAmount")
        .where("id", "=", invoiceId)
        .where("companyId", "=", f.companyId)
        .executeTakeFirstOrThrow();
      expect(Number(header.totalAmount)).toEqual(500);

      // A price from the dialog is refused on a job that has one.
      const priced = await f.addJob({
        locationId,
        status: "Completed",
        billingMethod: "Fixed Price"
      });
      await f.db
        .updateTable("serviceJob")
        .set({ fixedPrice: 300 })
        .where("id", "=", priced.id)
        .where("companyId", "=", f.companyId)
        .execute();
      const twice = await f.createServiceInvoice(priced.id, {
        fixedPrice: 400
      });
      expect(twice.error?.message).toContain("already has a fixed price");

      const posted = await invokePosting(
        handlesOf(f.ctx),
        "post-sales-invoice",
        { type: "post", invoiceId },
        postSalesInvoice
      );
      expect(posted.error).toBeNull();
      const journal = await f.db
        .selectFrom("journal")
        .select("id")
        .where("companyId", "=", f.companyId)
        .where("sourceType", "=", "Sales Invoice")
        .executeTakeFirstOrThrow();
      const byAccount = await f.db
        .selectFrom("journalLine")
        .select(["accountId", sql<number>`SUM("amount")`.as("amount")])
        .where("journalId", "=", journal.id)
        .groupBy("accountId")
        .execute();
      // Natural-balance signed, as stored: Dr AR, Cr Sales.
      expect(
        Object.fromEntries(
          byAccount.map((line) => [line.accountId, Number(line.amount)])
        )
      ).toEqual({
        [f.account("receivables")]: 500,
        [f.account("sales")]: 500
      });
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "deleting a Draft service invoice, or its last line of a job, puts the job back to Completed; voiding a posted one does too",
  async () => {
    const f = await invoiceFixture();
    try {
      const { locationId } = await f.addStockedItem("unit", {
        quantity: 1,
        unitCost: 10
      });
      const jobState = (id: string) =>
        f.db
          .selectFrom("serviceJob")
          .select(["status", "salesInvoiceId"])
          .where("id", "=", id)
          .where("companyId", "=", f.companyId)
          .executeTakeFirstOrThrow();

      // Delete the whole Draft invoice.
      const deleted = await f.addJob({
        locationId,
        status: "Completed",
        laborBillRate: 95
      });
      await f.addTime(deleted.id, { hours: 1 });
      const first = await f.createServiceInvoice(deleted.id);
      expect(first.error).toBeNull();
      await deleteSalesInvoiceReleasingRentals(f.db, {
        companyId: f.companyId,
        invoiceId: first.data!.salesInvoiceId,
        userId: PROJECT_TEST_USER
      });
      expect(await jobState(deleted.id)).toEqual({
        status: "Completed",
        salesInvoiceId: null
      });
      // Released: it invoices again.
      const rebilled = await f.createServiceInvoice(deleted.id);
      expect(rebilled.error).toBeNull();

      // Delete the invoice's lines one by one: the job is released only
      // when no line names it any more.
      const lined = await f.addJob({
        locationId,
        status: "Completed",
        laborBillRate: 95
      });
      await f.addTime(lined.id, { hours: 1 });
      await f.db
        .insertInto("serviceJobItem")
        .values({
          serviceJobId: lined.id,
          lineType: "Charge",
          itemId: f.serviceItemId,
          description: "Travel",
          quantity: 1,
          unitPrice: 50,
          companyId: f.companyId,
          createdBy: PROJECT_TEST_USER
        })
        .execute();
      const second = await f.createServiceInvoice(lined.id);
      expect(second.error).toBeNull();
      const secondId = second.data!.salesInvoiceId;
      const secondLines = await f.db
        .selectFrom("salesInvoiceLine")
        .select("id")
        .where("invoiceId", "=", secondId)
        .execute();
      expect(secondLines).toHaveLength(2);
      await deleteSalesInvoiceLineReleasingRentals(f.db, {
        companyId: f.companyId,
        invoiceId: secondId,
        salesInvoiceLineId: secondLines[0]!.id,
        userId: PROJECT_TEST_USER
      });
      expect(await jobState(lined.id)).toEqual({
        status: "Invoiced",
        salesInvoiceId: secondId
      });
      await deleteSalesInvoiceLineReleasingRentals(f.db, {
        companyId: f.companyId,
        invoiceId: secondId,
        salesInvoiceLineId: secondLines[1]!.id,
        userId: PROJECT_TEST_USER
      });
      expect(await jobState(lined.id)).toEqual({
        status: "Completed",
        salesInvoiceId: null
      });

      // Void a posted invoice.
      const voided = await f.addJob({
        locationId,
        status: "Completed",
        laborBillRate: 95
      });
      await f.addTime(voided.id, { hours: 1 });
      const third = await f.createServiceInvoice(voided.id);
      expect(third.error).toBeNull();
      const thirdId = third.data!.salesInvoiceId;
      const post = (type: "post" | "void") =>
        invokePosting(
          handlesOf(f.ctx),
          "post-sales-invoice",
          { type, invoiceId: thirdId },
          postSalesInvoice
        );
      expect((await post("post")).error).toBeNull();
      expect(await jobState(voided.id)).toEqual({
        status: "Invoiced",
        salesInvoiceId: thirdId
      });
      expect((await post("void")).error).toBeNull();
      expect(await jobState(voided.id)).toEqual({
        status: "Completed",
        salesInvoiceId: null
      });
    } finally {
      await f.cleanup();
    }
  }
);
