// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { expect } from "vitest";
import { projectPostingFixture } from "../lib/project-posting-test-fixture";
import { databaseTest } from "../local-database-test-fixture";
import postProjectExpense from "../post-project-expense";
import postTimesheet from "../post-timesheet";
import createServiceOrderInvoice from "./index";

databaseTest(
  "invoicing a Completed service order drafts its tree's lines, stamps the billable items and closes the order",
  async () => {
    const f = await projectPostingFixture();
    try {
      const order = await f.addServiceOrder("invoice", { laborPrice: 95 });
      const entry = await f.db
        .insertInto("timesheetEntry")
        .values({
          employeeId: "system",
          entryDate: "2026-10-05",
          projectId: f.projectId,
          projectElementId: f.elementId,
          laborCategoryId: f.laborCategoryId,
          hours: 2,
          note: "Diagnose",
          status: "Draft",
          companyId: f.companyId,
          createdBy: "system"
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      expect(
        (await postTimesheet(f.ctx, { timesheetEntryIds: [entry.id] })).error
      ).toBeNull();
      const expense = await f.db
        .insertInto("projectExpenseEntry")
        .values({
          projectId: f.projectId,
          projectElementId: f.elementId,
          employeeId: "system",
          entryDate: "2026-10-05",
          description: "Mileage",
          amount: 40,
          companyId: f.companyId,
          createdBy: "system"
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      expect(
        (
          await postProjectExpense(f.ctx, {
            projectExpenseEntryId: expense.id
          })
        ).error
      ).toBeNull();

      // Not Completed yet: refused.
      const early = await createServiceOrderInvoice(f.ctx, {
        serviceOrderId: order.serviceOrderId
      });
      expect(early.error?.status).toEqual(422);

      await f.db
        .updateTable("serviceOrder")
        .set({ status: "Completed" })
        .where("id", "=", order.serviceOrderId)
        .where("companyId", "=", f.companyId)
        .execute();
      await f.db
        .insertInto("sequence")
        .values({
          table: "salesInvoice",
          name: "Sales Invoice",
          prefix: "INV",
          companyId: f.companyId
        })
        .onConflict((oc) => oc.doNothing())
        .execute();

      const result = await createServiceOrderInvoice(f.ctx, {
        serviceOrderId: order.serviceOrderId
      });
      expect(result.error).toBeNull();
      const invoiceId = result.data!.salesInvoiceId;

      const header = await f.db
        .selectFrom("salesInvoice")
        .select([
          "status",
          "customerId",
          "serviceOrderId",
          "locationId",
          "subtotal",
          "totalAmount"
        ])
        .where("id", "=", invoiceId)
        .where("companyId", "=", f.companyId)
        .executeTakeFirstOrThrow();
      expect(header).toMatchObject({
        status: "Draft",
        customerId: order.customerId,
        serviceOrderId: order.serviceOrderId,
        locationId: order.locationId
      });
      expect(Number(header.totalAmount)).toEqual(230);

      const lines = await f.db
        .selectFrom("salesInvoiceLine")
        .select([
          "id",
          "invoiceLineType",
          "description",
          "quantity",
          "unitPrice",
          "unitOfMeasureCode",
          "sortOrder"
        ])
        .where("invoiceId", "=", invoiceId)
        .where("companyId", "=", f.companyId)
        .orderBy("sortOrder")
        .execute();
      expect(
        lines.map((line) => [
          line.invoiceLineType,
          line.description,
          Number(line.quantity),
          Number(line.unitPrice),
          line.unitOfMeasureCode
        ])
      ).toEqual([
        ["Comment", "Design", 0, 0, "EA"],
        ["Service", "Diagnose", 2, 95, "HR"],
        ["Service", "Mileage", 1, 40, "EA"]
      ]);

      const items = await f.db
        .selectFrom("projectBillableItem")
        .select(["status", "salesInvoiceLineId", "description"])
        .where("companyId", "=", f.companyId)
        .orderBy("createdAt")
        .execute();
      expect(items).toEqual([
        {
          status: "Billed",
          salesInvoiceLineId: lines[1]!.id,
          description: "Diagnose"
        },
        {
          status: "Billed",
          salesInvoiceLineId: lines[2]!.id,
          description: "Mileage"
        }
      ]);

      const closed = await f.db
        .selectFrom("serviceOrder")
        .select(["status", "salesInvoiceId"])
        .where("id", "=", order.serviceOrderId)
        .where("companyId", "=", f.companyId)
        .executeTakeFirstOrThrow();
      expect(closed).toEqual({ status: "Closed", salesInvoiceId: invoiceId });
    } finally {
      await f.cleanup();
    }
  }
);
