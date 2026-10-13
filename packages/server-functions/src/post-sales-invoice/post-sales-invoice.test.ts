// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { sql } from "kysely";
import { expect } from "vitest";
import { projectPostingFixture } from "../lib/project-posting-test-fixture";
import { databaseTest } from "../local-database-test-fixture";
import postSalesInvoice from "./index";

databaseTest(
  "a Service line that bills a service order's part posts revenue with no second stock relief, and an unstamped line still relieves stock",
  async () => {
    const f = await projectPostingFixture();
    try {
      const order = await f.addServiceOrder("invoice");
      const { itemId, locationId } = await f.addStockedItem("part", {
        quantity: 10,
        unitCost: 10
      });
      const invoiceId = `${f.prefix}-invoice`;
      const stampedLineId = `${f.prefix}-line-stamped`;
      const plainLineId = `${f.prefix}-line-plain`;
      await f.db.transaction().execute(async (trx) => {
        await sql`SET LOCAL "app.sync_in_progress" = 'true'`.execute(trx);
        await trx
          .insertInto("account")
          .values([
            {
              id: f.account("sales"),
              name: "Sales",
              class: "Revenue",
              incomeBalance: "Income Statement",
              companyGroupId: f.groupId,
              createdBy: "system"
            },
            {
              id: f.account("receivables"),
              name: "Receivables",
              class: "Asset",
              incomeBalance: "Balance Sheet",
              companyGroupId: f.groupId,
              createdBy: "system"
            }
          ])
          .execute();
        await trx
          .updateTable("accountDefault")
          .set({
            salesAccount: f.account("sales"),
            receivablesAccount: f.account("receivables")
          })
          .where("companyId", "=", f.companyId)
          .execute();
        await trx
          .insertInto("salesInvoice")
          .values({
            id: invoiceId,
            invoiceId: `${f.prefix}-INV`,
            customerId: order.customerId,
            currencyCode: "USD",
            exchangeRate: 1,
            locationId,
            serviceOrderId: order.serviceOrderId,
            status: "Draft",
            companyId: f.companyId,
            createdBy: "system"
          })
          .execute();
        await trx
          .insertInto("salesInvoiceShipment")
          .values({
            id: invoiceId,
            shippingCost: 0,
            companyId: f.companyId,
            createdBy: "system"
          })
          .onConflict((oc) => oc.column("id").doNothing())
          .execute();
        await trx
          .insertInto("salesInvoiceLine")
          .values(
            [stampedLineId, plainLineId].map((id) => ({
              id,
              invoiceId,
              invoiceLineType: "Service" as const,
              itemId,
              quantity: 1,
              unitPrice: 120,
              exchangeRate: 1,
              locationId,
              unitOfMeasureCode: "EA",
              companyId: f.companyId,
              createdBy: "system"
            }))
          )
          .execute();
        const ledger = await trx
          .insertInto("projectLedger")
          .values({
            projectId: f.projectId,
            projectElementId: f.elementId,
            postingDate: "2026-10-01",
            costType: "Material",
            documentType: "Project Issue",
            documentId: `${f.prefix}-issue`,
            itemId,
            quantity: 1,
            amount: 10,
            coverage: "Billable",
            companyId: f.companyId,
            createdBy: "system"
          })
          .returning("id")
          .executeTakeFirstOrThrow();
        await trx
          .insertInto("projectBillableItem")
          .values({
            projectId: f.projectId,
            projectElementId: f.elementId,
            projectLedgerId: ledger.id,
            itemId,
            description: "Part",
            quantity: 1,
            unitPrice: 120,
            amount: 120,
            coverage: "Billable",
            status: "Billed",
            salesInvoiceLineId: stampedLineId,
            companyId: f.companyId,
            createdBy: "system"
          })
          .execute();
      });

      const result = await postSalesInvoice(f.ctx, {
        type: "post",
        invoiceId
      });
      expect(result.error).toBeNull();

      // Only the unstamped line relieves stock.
      const relief = await f.db
        .selectFrom("itemLedger")
        .select(["quantity", "documentType"])
        .where("documentId", "=", invoiceId)
        .where("companyId", "=", f.companyId)
        .execute();
      expect(relief.map((row) => Number(row.quantity))).toEqual([-1]);

      const lines = await f.db
        .selectFrom("journalLine")
        .select(["accountId", "description", "amount"])
        .where("documentId", "=", invoiceId)
        .where("companyId", "=", f.companyId)
        .execute();
      const cogs = lines.filter(
        (line) => line.description === "Cost of Goods Sold"
      );
      expect(cogs).toHaveLength(1);
      expect(Number(cogs[0]!.amount)).toEqual(10);
      // Both lines post revenue.
      const sales = lines
        .filter((line) => line.accountId === f.account("sales"))
        .reduce((sum, line) => sum + Number(line.amount), 0);
      expect(sales).toEqual(240);

      // A VOID returns the stamped item to Unbilled and remembers the
      // voided invoice, so a re-bill is held for review.
      const voided = await postSalesInvoice(f.ctx, {
        type: "void",
        invoiceId
      });
      expect(voided.error).toBeNull();
      const items = await f.db
        .selectFrom("projectBillableItem")
        .select(["status", "salesInvoiceLineId", "voidedSalesInvoiceId"])
        .where("projectId", "=", f.projectId)
        .where("companyId", "=", f.companyId)
        .execute();
      expect(items).toEqual([
        {
          status: "Unbilled",
          salesInvoiceLineId: null,
          voidedSalesInvoiceId: invoiceId
        }
      ]);
    } finally {
      await f.cleanup();
    }
  }
);
